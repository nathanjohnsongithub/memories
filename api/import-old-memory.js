const crypto = require('crypto');
const { readSessionFromCookies } = require('../lib/session');

function bufferFromBase64(b64) {
  return Buffer.from(b64, 'base64');
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB per upload
const IMPORT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_IMPORTS_PER_WINDOW = 12;
const importStore = new Map(); // key by ip

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip) return ip;
  }
  return req.socket?.remoteAddress || 'unknown';
}

function registerImport(ip) {
  if (!ip) return;
  const now = Date.now();
  const entry = importStore.get(ip) || { count: 0, first: now };
  if (now - entry.first > IMPORT_WINDOW_MS) {
    entry.count = 0;
    entry.first = now;
  }
  entry.count += 1;
  importStore.set(ip, entry);
  return entry.count;
}

function isImportRateLimited(ip) {
  const entry = importStore.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > IMPORT_WINDOW_MS) {
    importStore.delete(ip);
    return false;
  }
  return entry.count >= MAX_IMPORTS_PER_WINDOW;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // validate session cookie
  const session = readSessionFromCookies(req.headers.cookie || '');
  if (!session) return res.status(401).json({ error: 'not authenticated' });

  const clientIp = getClientIp(req);
  if (isImportRateLimited(clientIp)) {
    return res.status(429).json({ error: 'Too many uploads, please slow down' });
  }

  try {
  const { title, note, taken_at, is_private, imageBase64, filename, attribution_name } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: 'image required' });

    if (typeof imageBase64 !== 'string' || !/^data:[^;]+;base64,/.test(imageBase64)) {
      return res.status(400).json({ error: 'invalid image payload' });
    }

    if (imageBase64.length > MAX_UPLOAD_BYTES * 1.37) {
      return res.status(413).json({ error: 'upload too large' });
    }

    registerImport(clientIp);

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const IMPORTER_USER_ID = process.env.IMPORTER_USER_ID;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !IMPORTER_USER_ID) {
      return res.status(500).json({ error: 'server not configured' });
    }

    // Upload to storage via Supabase REST
  // Parse mime from data URL and strip prefix
  const mimeMatch = imageBase64.match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const fileBuf = bufferFromBase64(imageBase64.replace(/^data:[^;]+;base64,/, ''));
    if (!fileBuf.length) {
      return res.status(400).json({ error: 'empty image payload' });
    }
    if (fileBuf.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'upload too large' });
    }
    // Normalize extension based on mime when possible
    function extFromMime(mt){
      const map = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/gif':'gif', 'image/heic':'heic', 'image/heif':'heif', 'image/avif':'avif' };
      return map[mt] || (filename?.split('.').pop() || 'bin');
    }
    const safeName = (filename || 'upload').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const ext = extFromMime(mimeType);
    const base = safeName.replace(/\.[^.]+$/, '');
    const remotePath = `${crypto.randomBytes(8).toString('hex')}-${base}.${ext}`;

    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/memories/${encodeURIComponent(remotePath)}`;
    let upRes;
    try {
      upRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': mimeType || 'application/octet-stream',
          'x-upsert': 'false'
        },
        body: fileBuf
      });
    } catch (err) {
      console.error('upload fetch error', err);
      return res.status(502).json({ error: 'upload request failed', detail: String(err?.message || err), code: err?.code || null });
    }

    if (!upRes.ok) {
      const txt = await upRes.text();
      console.error('upload failed', upRes.status, txt);
      if (upRes.status === 413) {
        return res.status(413).json({ error: 'upload too large (storage)', status: 413, detail: txt });
      }
      return res.status(502).json({ error: 'upload failed', status: upRes.status, detail: txt });
    }

    // get public url
    const publicUrl = `${SUPABASE_URL.replace(/\/\/$/, '')}/storage/v1/object/public/memories/${encodeURIComponent(remotePath)}`;

    // insert into public.memories via PostgREST
    const insertUrl = `${SUPABASE_URL}/rest/v1/memories`;
    const insertRes = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        title: title || null,
        note: note || null,
        image_url: publicUrl,
        taken_at: taken_at || null,
        is_private: !!is_private,
  created_by: IMPORTER_USER_ID,
  attribution_name: ['Hannah','Nathan','Both'].includes(attribution_name) ? attribution_name : null
      })
    });

    if (!insertRes.ok) {
      const txt = await insertRes.text();
      return res.status(500).json({ error: 'insert failed', detail: txt });
    }

    const created = await insertRes.json();
    return res.status(200).json({ ok: true, created });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
};
