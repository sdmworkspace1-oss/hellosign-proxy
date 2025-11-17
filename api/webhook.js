// File: /api/webhook.js
// Versi 5: Menangani 'multipart/form-data' dengan ekstraksi string JSON

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
// [FUNGSI HELPER]
// ---------------------------------------------------------------
// Fungsi ini membaca data mentah dari request stream
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

// ---------------------------------------------------------------
// [HANDLER UTAMA]
// ---------------------------------------------------------------
export default async function handler(req, res) {
  // 1. Hanya izinkan metode POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  let body; // Ini akan menjadi objek JSON kita
  let rawBodyString; // Ini adalah data mentah

  try {
    // ---------------------------------------------------------------
    // [PERBAIKAN UTAMA: CARA MEMBACA BODY]
    // ---------------------------------------------------------------
    rawBodyString = await getRawBody(req);
    
    if (!rawBodyString) {
      console.error("Request body benar-benar kosong.");
      return res.status(400).send('Bad Request: Empty body');
    }

    const contentType = req.headers['content-type'] || '';
    
    if (contentType.includes('application/json')) {
      // KASUS 1: Ini adalah event normal (format raw JSON)
      console.log("Mendeteksi format raw JSON (Real Event). Parsing...");
      body = JSON.parse(rawBodyString);
    
    } else if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
      // KASUS 2: Ini adalah 'callback_test' (format form-data ATAU urlencoded)
      console.log(`Mendeteksi format form/multipart (Test Button). CT: ${contentType}`);
      
      // EKSTRAK JSON DARI STRING MENTAH
      // Kita cari '{' pertama dan '}' terakhir di dalam string
      const jsonStartIndex = rawBodyString.indexOf('{');
      const jsonEndIndex = rawBodyString.lastIndexOf('}');

      if (jsonStartIndex !== -1 && jsonEndIndex > jsonStartIndex) {
        // Ekstrak string JSON-nya
        const jsonString = rawBodyString.substring(jsonStartIndex, jsonEndIndex + 1);
        
        console.log("Berhasil mengekstrak string JSON dari body mentah.");
        body = JSON.parse(jsonString);
      } else {
        console.error("Tidak dapat menemukan string JSON ({...}) di dalam body mentah.", rawBodyString);
        return res.status(400).send('Bad Request: Invalid test format, JSON not found');
      }
      
    } else {
      // Kasus aneh jika content-type tidak dikenal
      console.warn(`Content-Type tidak dikenal: ${contentType}. Mencoba ekstraksi JSON...`);
      // Ini blok yang gagal sebelumnya, kita ubah logikanya
      const jsonStartIndex = rawBodyString.indexOf('{');
      const jsonEndIndex = rawBodyString.lastIndexOf('}');
      if (jsonStartIndex !== -1 && jsonEndIndex > jsonStartIndex) {
        const jsonString = rawBodyString.substring(jsonStartIndex, jsonEndIndex + 1);
        body = JSON.parse(jsonString);
      } else {
         throw new Error("Tidak dapat menemukan JSON di body dengan Content-Type tidak dikenal.");
      }
    }

    // Jika 'body' masih belum ter-parse, lempar error
    if (!body || typeof body !== 'object') {
      throw new Error("Gagal mem-parsing body menjadi objek.");
    }

    // ---------------------------------------------------------------
    // [BAGIAN 1: HANDLE CHALLENGE TEST (Sekarang aman)]
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
    // [BAGIAN 2: HANDLE EVENT BIASA (Sekarang aman)]
    // ---------------------------------------------------------------
    console.log(`Menerima event: ${body?.event?.event_type || 'Unknown'}`);
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send('Hello API Event Received');

    // ---------------------------------------------------------------
    // [BAGIAN 3: FORWARD KE GOOGLE APPS SCRIPT (Sekarang aman)]
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
    // Tangkap error (misalnya JSON parse error)
    console.error("Error besar di handler:", err.message);
    console.error("Raw Body String (jika ada):", rawBodyString);
    return res.status(500).send('Internal Server Error');
  }
}
