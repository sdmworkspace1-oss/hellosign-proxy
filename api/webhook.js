// File: /api/webhook.js
// Versi 8: Diagnosis (Menambahkan 1 log untuk melihat body yang di-parse)

// --- (Semua kode di atas sini SAMA PERSIS dengan Versi 7) ---
// ... (export config, getRawBody) ...

// FUNGSI HELPER 2: Parser Manual (Versi Paling Aman)
function parseMultipartWithoutBusboy(rawBodyString, boundary) {
  try {
    const parts = rawBodyString.split(new RegExp(`\\r?\\n?--${boundary}`));
    for (const part of parts) {
      if (!part.includes('Content-Disposition')) continue;
      if (!part.includes('name="json"')) continue;
      const jsonStart = part.indexOf('{');
      const jsonEnd = part.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        return part.substring(jsonStart, jsonEnd + 1).trim(); 
      }
    }
  } catch (err) { console.error("Error di dalam parser manual:", err.message); }
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
      if (!boundaryMatch) throw new Error("Multipart tapi tidak ada boundary.");
      let boundary = boundaryMatch[1].trim().replace(/^"|"$/g, "");
      const jsonString = parseMultipartWithoutBusboy(rawBodyString, boundary);
      if (!jsonString) throw new Error("Tidak menemukan field 'json' di multipart body.");
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
    // [SATU-SATUNYA PERUBAHAN ADA DI SINI]
    // ---------------------------------------------------------------
    // Kita log objek 'body' SETELAH di-parse, SEBELUM dicek.
    // Ini akan menunjukkan kepada kita JSON yang tidak lengkap itu.
    console.log("DEBUG: Objek body setelah parse:", JSON.stringify(body));
    // ---------------------------------------------------------------

    // [BAGIAN 1: HANDLE CHALLENGE TEST]
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

    // ... (Sisa kode (BAGIAN 2 & 3) sama persis) ...
    console.log(`Menerima event: ${body?.event?.event_type || 'Unknown'}`);
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send('Hello API Event Received');
    const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
    if (!GAS_WEBHOOK_URL) {
       console.error("FATAL ERROR: GAS_WEBHOOK_URL belum di-set di Vercel!");
       return;
    }
    try {
      fetch(GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'json' },
        body: JSON.stringify(body) 
      });
      console.log(`Payload event ${body?.event?.event_type} berhasil diteruskan ke GAS.`);
    } catch (error) {
      console.error('Gagal meneruskan payload ke GAS:', error.message);
    }

  } catch (err) {
    console.error("Error besar di handler:", err.message);
    console.error("Raw Body String (jika ada):", rawBodyString.substring(0, 500) + "...");
    return res.status(500).send('Internal Server Error');
  }
}
