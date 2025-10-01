const crypto = require('crypto');
const { issueSession, createSessionCookie } = require('../lib/session');

const ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS_PER_WINDOW = 10;
const attemptStore = new Map(); // keyed by ip

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip) return ip;
  }
  return req.socket?.remoteAddress || 'unknown';
}

function registerAttempt(ip, success) {
  if (!ip) return;
  const now = Date.now();
  const entry = attemptStore.get(ip) || { count: 0, first: now };

  if (now - entry.first > ATTEMPT_WINDOW_MS) {
    entry.count = 0;
    entry.first = now;
  }

  if (success) {
    attemptStore.delete(ip);
  } else {
    entry.count += 1;
    attemptStore.set(ip, entry);
  }
}

function isRateLimited(ip) {
  const entry = attemptStore.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.first > ATTEMPT_WINDOW_MS) {
    attemptStore.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS_PER_WINDOW;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const clientIp = getClientIp(req);
    if (isRateLimited(clientIp)) {
      return res.status(429).json({ error: 'Too many attempts, try again shortly' });
    }

    const { password } = req.body || {};
    const hashBase64 = process.env.OLD_MEM_PW_HASH;
    const saltBase64 = process.env.OLD_MEM_PW_SALT;

    if (!hashBase64 || !saltBase64) {
      return res.status(500).json({ error: 'Password not configured' });
    }

    const salt = Buffer.from(saltBase64, 'base64');
    const derived = crypto.scryptSync(password || '', salt, 64);
    const hashBuf = Buffer.from(hashBase64, 'base64');

    if (hashBuf.length === derived.length && crypto.timingSafeEqual(derived, hashBuf)) {
      const session = issueSession('legacy-user');
      const sessionCookie = createSessionCookie(session.token, { maxAge: session.maxAge });
      const markerCookie = `mem_auth_mark=1; Path=/; Max-Age=${session.maxAge}; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
      res.setHeader('Set-Cookie', [sessionCookie, markerCookie]);
      registerAttempt(clientIp, true);
      return res.status(200).json({ ok: true });
    }

    registerAttempt(clientIp, false);
    return res.status(401).json({ error: 'Invalid password' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
};
