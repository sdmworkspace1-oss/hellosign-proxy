// File: /api/webhook.js
// Versi 19 — Final Stabil untuk Dropbox Sign → Vercel → GAS

export const config = {
  api: {
    bodyParser: false,
  },
};

// ---------------------------------------------------------------------------
// RAW BODY READER
// ---------------------------------------------------------------------------
async function getRawBody(req) {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks).toString();
  } catch (err) {
    console.error("getRawBody error:", err);
    return "";
  }
}

// ---------------------------------------------------------------------------
// PARSER MULTIPART TANPA BUSBOY
// ---------------------------------------------------------------------------
function parseMultipartWithoutBusboy(rawBodyString, boundary) {
  try {
    const parts = rawBodyString.split(`--${boundary}`);
    for (const part of parts) {
      if (!part.includes("Content-Disposition")) continue;
      const start = part.indexOf("{");
      const end = part.lastIndexOf("}");
      if (start !== -1 && end > start) {
        console.log("Parser menemukan JSON multipart.");
        return part.substring(start, end + 1).trim();
      }
    }
  } catch (e) {
    console.error("Parser multipart error:", e);
  }
  console.warn("Parser multipart tidak menemukan JSON.");
  return null;
}

// ---------------------------------------------------------------------------
// SAFE FORWARD (DENGAN JITTER + RETRY)
// ---------------------------------------------------------------------------
async function safeForwardToGAS(url, payload) {
  const eventName = payload?.event?.event_type ?? "unknown_event";

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Delay acak sebelum setiap attempt
    const jitter = 80 + Math.random() * 250;
    await new Promise(r => setTimeout(r, jitter));

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let text = await res.text();
      let json;

      try {
        json = JSON.parse(text);
      } catch {
        // Jika bukan JSON → treat sebagai success
        console.log(`GAS balas non-JSON (anggap sukses): ${text}`);
        console.log(`Forward ke GAS berhasil (attempt ${attempt}) untuk event: ${eventName}`);
        return;
      }

      if (json?.success) {
        console.log(`Forward ke GAS sukses (attempt ${attempt}) untuk event: ${eventName}`);
        return;
      } else {
        throw new Error(`GAS error: ${json?.error || "Unknown error"}`);
      }

    } catch (err) {
      console.error(`Forward ke GAS gagal (attempt ${attempt}) untuk event ${eventName}:`, err.message);
    }
  }

  console.error(`FINAL ERROR: semua attempt gagal untuk event: ${eventName}`);
}

// ---------------------------------------------------------------------------
// HANDLER UTAMA
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  let raw = "";
  let body;

  try {
    raw = await getRawBody(req);
    if (!raw || raw.trim() === "") throw new Error("Raw body kosong");

    const contentType = req.headers["content-type"] ?? "";

    // -----------------------------------------------------------------------
    // MULTIPART
    // -----------------------------------------------------------------------
    if (contentType.startsWith("multipart/form-data")) {
      console.log("Multipart terdeteksi.");

      const boundaryMatch = contentType.match(/boundary="?([^";]+)"?/);
      if (!boundaryMatch) throw new Error("Boundary tidak ditemukan pada multipart.");

      const boundary = boundaryMatch[1];
      const jsonString = parseMultipartWithoutBusboy(raw, boundary);

      if (jsonString) {
        body = JSON.parse(jsonString);
      } else if (raw.includes("callback_test")) {
        body = { event: { event_type: "callback_test" } };
      } else {
        throw new Error("Multipart tanpa JSON.");
      }
    }

    // -----------------------------------------------------------------------
    // JSON
    // -----------------------------------------------------------------------
    else if (contentType.includes("application/json")) {
      body = JSON.parse(raw);
    }

    // -----------------------------------------------------------------------
    // x-www-form-urlencoded
    // -----------------------------------------------------------------------
    else if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(raw);
      const jsonString = params.get("json");
      if (!jsonString) throw new Error("form-urlencoded tanpa key json.");
      body = JSON.parse(jsonString);
    }

    else {
      throw new Error("Content-Type tidak dikenali.");
    }

    if (!body || !body.event) throw new Error("Tidak ada event di body.");

    console.log("DEBUG EVENT:", body.event.event_type);

    // -----------------------------------------------------------------------
    // CHALLENGE TEST
    // -----------------------------------------------------------------------
    if (body.event.event_type === "callback_test") {
      const challenge = body.event?.event_data?.challenge;
      res.setHeader("Content-Type", "text/plain");
      return res.status(200).send(challenge || "OK");
    }

    // -----------------------------------------------------------------------
    // BALAS DROPDOWN SIGN SECEPATNYA
    // -----------------------------------------------------------------------
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send("OK");

    // -----------------------------------------------------------------------
    // FIRE-AND-FORGET ke GAS
    // -----------------------------------------------------------------------
    const GAS_URL = process.env.GAS_WEBHOOK_URL;
    if (!GAS_URL) return console.error("GAS URL belum diset.");

    safeForwardToGAS(GAS_URL, body);
    console.log(`safeForwardToGAS dimulai untuk event ${body.event.event_type}`);

  } catch (err) {
    console.error("ERROR BESAR:", err.message);
    console.error("Raw Body:", raw?.substring?.(0, 500));
    return res.status(500).send("Internal Error");
  }
}
