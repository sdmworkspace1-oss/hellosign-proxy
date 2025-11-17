// File: /api/webhook.js
// Versi 7: Final (Menggabungkan 3 Perbaikan Presisi dari Review)

// ---------------------------------------------------------------
// [KONFIGURASI VERCEL]
// ---------------------------------------------------------------
// Kita nonaktifkan body-parser bawaan Vercel
export const config = {
  api: {
    bodyParser: false,
  },
};

// ---------------------------------------------------------------
// [FUNGSI HELPER 1: Get Raw Body]
// ---------------------------------------------------------------
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

// ---------------------------------------------------------------
// [FUNGSI HELPER 2: Parser Manual (Versi Paling Aman)]
// ---------------------------------------------------------------
// (Termasuk perbaikan CRLF dan pengecekan 'name="json"')
function parseMultipartWithoutBusboy(rawBodyString, boundary) {
  try {
    // FIX 2: Gunakan RegExp untuk menangani CRLF (\r\n)
    const parts = rawBodyString.split(new RegExp(`\\r?\\n?--${boundary}`));

    for (const part of parts) {
      // FIX 3: Cek ketat, abaikan part kosong atau footer
      if (!part.includes('Content-Disposition')) continue;
      if (!part.includes('name="json"')) continue;

      // cari JSON di dalam part
      const jsonStart = part.indexOf('{');
      const jsonEnd = part.lastIndexOf('}');

      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        // .trim() untuk jaga-jaga jika ada spasi di sekitar JSON
        return part.substring(jsonStart, jsonEnd + 1).trim(); 
      }
    }
  } catch (err) {
    console.error("Error di dalam parser manual:", err.message);
  }

  return null;
}

// ---------------------------------------------------------------
// [HANDLER UTAMA]
// ---------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  let body;
  let rawBodyString;

  try {
    rawBodyString = await getRawBody(req);
    if (!rawBodyString) {
      console.error("Request body kosong.");
      return res.status(400).send('Bad Request: Empty body');
    }

    const contentType = req.headers['content-type'] || '';

    // Logika Parsing (berdasarkan Content-Type)
    if (contentType.startsWith('multipart/form-data')) {
      console.log("Mendeteksi multipart/form-data (Test Button).");
      
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) {
         throw new Error("Multipart tapi tidak ada boundary.");
      }
      
      // FIX 1: Handle boundary dengan/tanpa tanda kutip
      let boundary = boundaryMatch[1].trim().replace(/^"|"$/g, "");

      const jsonString = parseMultipartWithoutBusboy(rawBodyString, boundary);
      if (!jsonString) {
         throw new Error("Tidak menemukan field 'json' di multipart body.");
      }
      body = JSON.parse(jsonString);

    } else if (contentType.includes('application/json')) {
      console.log("Mendeteksi raw JSON (Real Event).");
      body = JSON.parse(rawBodyString);
    
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
       console.log("Mendeteksi form-urlencoded (Test Button).");
       const params = new URLSearchParams(rawBodyString);
       const jsonString = params.get('json'); 
       if (!jsonString) throw new Error("form-urlencoded tapi tidak ada key 'json'.");
       body = JSON.parse(jsonString);

    } else {
       throw new Error(`Content-Type tidak dikenal atau tidak didukung: ${contentType}`);
    }
    
    if (!body || typeof body !== 'object') {
      throw new Error("Gagal mem-parsing body menjadi objek.");
    }

    // ---------------------------------------------------------------
    // [BAGIAN 1: HANDLE CHALLENGE TEST]
    // ---------------------------------------------------------------
    if (body?.event?.event_type === 'callback_test') {
      const challenge = body?.event?.event_data?.challenge;
      if (!challenge) {
        console.error("callback_test diterima, tapi challenge tidak ditemukan.");
        return res.status(400).send('Bad Request: Challenge missing');
      }
      
      console.log("Menerima callback_test, membalas dengan challenge...");
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(challenge);
    }

    // ---------------------------------------------------------------
    // [BAGIAN 2: HANDLE EVENT BIASA]
    // ---------------------------------------------------------------
    console.log(`Menerima event: ${body?.event?.event_type || 'Unknown'}`);
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send('Hello API Event Received');

    // ---------------------------------------------------------------
    // [BAGIAN 3: FORWARD KE GOOGLE APPS SCRIPT]
    // ---------------------------------------------------------------
    const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
    if (!GAS_WEBHOOK_URL) {
       console.error("FATAL ERROR: GAS_WEBHOOK_URL belum di-set di Vercel!");
       return;
    }

    try {
      fetch(GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body) 
      });
      console.log(`Payload event ${body?.event?.event_type} berhasil diteruskan ke GAS.`);
    } catch (error) {
      console.error('Gagal meneruskan payload ke GAS:', error.message);
    }

  } catch (err) {
    console.error("Error besar di handler:", err.message);
    console.error("Raw Body String (jika ada):", rawBodyString.substring(0, 500) + "..."); // Truncate long body
    return res.status(500).send('Internal Server Error');
  }
}
