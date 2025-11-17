// File: /api/webhook.js
// Versi 15: Final (Menerapkan 'safeForwardToGAS' dengan Delay + Retry)

// ---------------------------------------------------------------
// [KONFIGURASI VERCEL]
// ---------------------------------------------------------------
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
// [FUNGSI HELPER 2: Parser Manual]
// ---------------------------------------------------------------
function parseMultipartWithoutBusboy(rawBodyString, boundary) {
  try {
    const parts = rawBodyString.split(new RegExp(`\\r?\\n?--${boundary}`));
    for (const part of parts) {
      if (!part.includes('Content-Disposition')) continue;
      const jsonStart = part.indexOf('{');
      const jsonEnd = part.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        console.log("Parser manual menemukan JSON di dalam part.");
        return part.substring(jsonStart, jsonEnd + 1).trim(); 
      }
    }
  } catch (err) {
    console.error("Error di dalam parser manual:", err.message);
  }
  console.warn("Parser manual TIDAK menemukan JSON di part manapun.");
  return null;
}

// ---------------------------------------------------------------
// [FUNGSI HELPER 3: SOLUSI TEMAN ANDA (Safe Forwarder)]
// ---------------------------------------------------------------
async function safeForwardToGAS(url, payload) {
  // 1. Jeda awal 350ms agar tidak "bertabrakan" di GAS
  await new Promise(r => setTimeout(r, 350));

  // 2. Coba kirim 3x jika gagal
  for (let i = 1; i <= 3; i++) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      console.log(`Forward ke GAS berhasil (attempt ${i}) untuk event: ${payload?.event?.event_type}`);
      return; // Berhasil, keluar dari fungsi
    } catch (err) {
      console.error(`Forward ke GAS gagal (attempt ${i}) untuk event: ${payload?.event?.event_type}:`, err.message);
      if (i < 3) {
         await new Promise(r => setTimeout(r, 500)); // Jeda 500ms sebelum retry
      }
    }
  }
  console.error(`FINAL ERROR: Semua 3 attempt ke GAS gagal untuk event: ${payload?.event?.event_type}`);
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

    // Logika Parsing
    if (contentType.startsWith('multipart/form-data')) {
      console.log("Mendeteksi multipart/form-data.");
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) throw new Error("Multipart tapi tidak ada boundary.");
      let boundary = boundaryMatch[1].trim().replace(/^"|"$/g, "");
      const jsonString = parseMultipartWithoutBusboy(rawBodyString, boundary);
      if (!jsonString) {
        console.warn("Parser multipart tidak menemukan JSON. Mengecek raw body...");
        if (rawBodyString.includes("callback_test")) {
          console.warn("Fallback: Mendeteksi 'callback_test', membuat body manual.");
          body = { event: { event_type: "callback_test" } };
        } else {
          throw new Error("Multipart tanpa JSON dan tidak dapat diparse.");
        }
      } else {
        body = JSON.parse(jsonString);
      }
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
    console.log(`DEBUG: Objek body setelah parse: ${body?.event?.event_type}`);

    // [BAGIAN 1: HANDLE CHALLENGE TEST]
    if (body?.event?.event_type === 'callback_test') {
      const challenge = body?.event?.event_data?.challenge;
      if (challenge) {
        console.log("Menerima callback_test (ADA challenge), membalas...");
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send(challenge);
      } else {
        console.log("Menerima callback_test (TANPA challenge), membalas 'Hello API Event Received'.");
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send("Hello API Event Received");
      }
    }

    // [BAGIAN 2: HANDLE EVENT BIASA]
    console.log(`Menerima event: ${body?.event?.event_type || 'Unknown'}`);
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send('Hello API Event Received'); // Balasan ke Dropbox Sign SELESAI di sini.

    // ---------------------------------------------------------------
    // [BAGIAN 3: FORWARD KE GOOGLE APPS SCRIPT (FIXED)]
    // ---------------------------------------------------------------
    // (Mengganti blok try/catch lama dengan pemanggilan fungsi aman)
    
    const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
    if (!GAS_WEBHOOK_URL) {
       console.error("FATAL ERROR: GAS_WEBHOOK_URL belum di-set di Vercel!");
       return;
    }
    
    // Panggil fungsi 'safeForwardToGAS' tanpa 'await'
    // Ini membuat Vercel merespon ke Dropbox Sign,
    // TAPI tetap menjalankan 'safeForwardToGAS' di latar belakang.
    safeForwardToGAS(GAS_WEBHOOK_URL, body);
    
    console.log(`Proses 'safeForwardToGAS' untuk event ${body?.event?.event_type} telah dimulai di latar belakang.`);

  } catch (err) {
    console.error("Error besar di handler:", err.message);
    console.error("Raw Body String (jika ada):", rawBodyString ? rawBodyString.substring(0, 500) + "..." : "[rawBodyString is undefined]");
    return res.status(500).send('Internal Server Error');
  }
}
