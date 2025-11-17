// File: /api/webhook.js
// Ini adalah Serverless Function Node.js yang berjalan di Vercel

export default async function handler(req, res) {
  // 1. Hanya izinkan metode POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  // 'body' akan otomatis di-parse oleh Vercel
  const body = req.body;

  // ---------------------------------------------------------------
  // [BAGIAN PENTING 1: HANDLE CHALLENGE TEST]
  // ---------------------------------------------------------------
  // Jika ini adalah 'callback_test', balas dengan challenge-nya.
  if (body.event && body.event.event_type === 'callback_test') {
    try {
      const challenge = body.event.event_data.challenge;
      console.log("Menerima callback_test, membalas dengan challenge...");

      // Kirim balasan challenge sebagai text/plain
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(challenge);
    } catch (error) {
      console.error("Error saat handle callback_test:", error.message);
      return res.status(500).send('Error handling test');
    }
  }

  // ---------------------------------------------------------------
  // [BAGIAN PENTING 2: HANDLE EVENT BIASA]
  // ---------------------------------------------------------------
  // Untuk SEMUA event lainnya, segera balas HelloSign
  // dengan string yang mereka wajibkan.
  console.log(`Menerima event: ${body.event ? body.event.event_type : 'Unknown'}`);
  res.setHeader('Content-Type', 'text/plain');
  res.status(200).send('Hello API Event Received');

  // ---------------------------------------------------------------
  // [BAGIAN PENTING 3: FORWARD KE GOOGLE APPS SCRIPT]
  // ---------------------------------------------------------------
  // Dapatkan URL Web App GAS Anda dari Environment Variables Vercel
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;

  if (!GAS_WEBHOOK_URL) {
     console.error("ERROR: GAS_WEBHOOK_URL belum di-set di Vercel!");
     return; // Hentikan di sini jika URL tidak ada
  }

  // SETELAH merespon HelloSign, kita teruskan datanya ke GAS.
  // Kita tidak perlu 'await' karena kita tidak peduli balasannya.
  try {
    fetch(GAS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Vercel sudah memberi kita JSON (req.body),
      // tapi GAS 'doPost(e)' mengharapkan string di e.postData.contents
      // Jadi, kita kirim kembali sebagai string.
      body: JSON.stringify(body) 
    });

    console.log(`Payload event ${body.event.event_type} berhasil diteruskan ke GAS.`);

  } catch (error) {
    // Jika gagal meneruskan, catat error di log Vercel
    console.error('Gagal meneruskan payload ke GAS:', error.message);
  }
}