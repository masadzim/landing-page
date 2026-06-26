// ============================================================
// Vercel Serverless Function — Reverse Proxy ke Google Apps Script
// ============================================================
// Tujuan:
//  1. Menyembunyikan URL asli Apps Script dari client
//  2. Menghindari masalah CORS (Apps Script kadang inkonsisten
//     dengan header CORS pada beberapa metode/redirect)
//  3. Menangani redirect 302 dari Apps Script secara otomatis
//     (fetch() browser kadang gagal follow redirect ke
//     googleusercontent.com untuk response besar)
//
// Cara pakai dari frontend:
//   GANTI:  APPS_SCRIPT_URL = 'https://script.google.com/macros/.../exec'
//   JADI :  APPS_SCRIPT_URL = '/api/proxy'
//
// Endpoint ini meneruskan SEMUA method (GET/POST), query string,
// dan body apa adanya ke Apps Script, lalu mengembalikan
// response JSON ke client.
// ============================================================

// ⚠️ GANTI dengan URL Web App Apps Script kamu (yang berakhiran /exec)
const GAS_URL ='kebab-factory-backend-production.up.railway.app';

export default async function handler(req, res) {
  // ── CORS Headers ─────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // ── Bangun target URL: teruskan semua query string ──────
    const url = new URL(req.url, 'http://x');
    const targetUrl = GAS_URL + (url.search || '');

    // ── Siapkan opsi fetch ───────────────────────────────────
    const fetchOptions = {
      method: req.method,
      redirect: 'follow', // ikuti redirect 302 dari Apps Script
    };

    if (req.method === 'POST') {
      // Apps Script doPost mengharapkan body urlencoded
      const contentType = req.headers['content-type'] || 'application/x-www-form-urlencoded';
      fetchOptions.headers = { 'Content-Type': contentType };

      // Body bisa berupa object (sudah diparse Vercel) atau string mentah
      let bodyData = req.body;
      if (contentType.includes('application/x-www-form-urlencoded') && typeof bodyData === 'object') {
        bodyData = new URLSearchParams(bodyData).toString();
      } else if (typeof bodyData !== 'string') {
        bodyData = JSON.stringify(bodyData);
      }
      fetchOptions.body = bodyData;
    }

    // ── Fetch ke Apps Script ─────────────────────────────────
    const gasRes  = await fetch(targetUrl, fetchOptions);
    const text    = await gasRes.text();

    // ── Coba parse sebagai JSON, fallback ke text ────────────
    res.setHeader('Content-Type', 'application/json');
    try {
      const json = JSON.parse(text);
      return res.status(gasRes.status).json(json);
    } catch (e) {
      // Bukan JSON valid — kemungkinan error HTML dari Google
      console.error('GAS response bukan JSON:', text.slice(0, 300));
      return res.status(502).json({
        success: false,
        error: 'Respons tidak valid dari server backend.',
      });
    }

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({
      success: false,
      error: 'Gagal terhubung ke server: ' + err.message,
    });
  }
}

// ── Config: Vercel butuh ini agar req.body tidak otomatis di-parse sebagai JSON ──
export const config = {
  api: {
    bodyParser: {
      // Biarkan urlencoded body tetap terbaca sebagai object
      sizeLimit: '5mb',
    },
  },
};
