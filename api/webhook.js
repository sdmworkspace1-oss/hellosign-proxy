// File: /api/webhook.js
// Versi 3: Menangani format 'form-data' (untuk tes) DAN 'raw JSON' (untuk event)

export default async function handler(req, res) {
  // 1. Hanya izinkan metode POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  let body; // Kita akan definisikan 'body' secara manual

  try {
    // ---------------------------------------------------------------
    // [PERBAIKAN UTAMA: DETEKSI FORMAT DATA]
    // ---------------------------------------------------------------
    // Vercel sudah mem-parse body-nya. Kita cek formatnya.
    
    if (req.body && req.body.json) {
      // KASUS 1: Ini adalah 'callback_test' (format form-data)
      // Data JSON ada di dalam properti 'json' sebagai string.
      console.log("Mendeteksi format form-data (req.body.json). Parsing...");
      body = JSON.parse(req.body.json);
    } else {
      // KASUS 2: Ini adalah event normal (format raw JSON)
      // 'req.body' sudah menjadi objek JSON.
      console.log("Mendeteksi format raw JSON (req.body).");
      body = req.body;
    }

    // Cek lagi jika body masih kosong/invalid
    if (!body || typeof body !== 'object') {
      console.error("Body request kosong atau format tidak dikenal.", req.body);
      return res.status(400).send('Bad Request: Body not recognized');
    }

    // ---------------------------------------------------------------
    // [BAGIAN 1: HANDLE CHALLENGE TEST (Sekarang aman)]
    // ---------------------------------------------------------------
    // Kode ini sekarang aman karena 'body' sudah pasti objek JSON
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
       return; // Hentikan jika URL GAS tidak ada
    }

    try {
      // Kirim data yang SUDAH DI-PARSE (body)
      // ke GAS, tapi ubah kembali ke string
      fetch(GAS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // GAS doPost(e) mengharapkan string di e.postData.contents
        body: JSON.stringify(body) 
      });
      
      console.log(`Payload event ${body?.event?.event_type} berhasil diteruskan ke GAS.`);

    } catch (error) {
      console.error('Gagal meneruskan payload ke GAS:', error.message);
    }

  } catch (err) {
    // Tangkap error parsing JSON atau error tak terduga lainnya
    console.error("Error besar di handler:", err.message);
    console.error("Data Mentah (mungkin):", req.body);
    return res.status(500).send('Internal Server Error');
  }
}
