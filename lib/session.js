const crypto = require('crypto');

const SESSION_COOKIE = 'mem_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET env var is not configured');
  }
  return secret;
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function signSession(payload) {
  const secret = getSecret();
  const data = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(data).digest();
  return `${data}.${base64UrlEncode(signature)}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;

  const secret = getSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest();
  const providedSig = base64UrlDecode(signature);
  if (expectedSig.length !== providedSig.length) return null;
  if (!crypto.timingSafeEqual(expectedSig, providedSig)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(data));
    if (!payload || typeof payload !== 'object') return null;
    if (payload.exp && Date.now() >= payload.exp) return null;
    return payload;
  } catch (err) {
    return null;
  }
}

function issueSession(userId = 'legacy-user') {
  const now = Date.now();
  const payload = {
    sub: userId,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS * 1000,
  };
  return {
    token: signSession(payload),
    maxAge: SESSION_MAX_AGE_SECONDS,
    payload,
  };
}

function readSessionFromCookies(cookieHeader = '') {
  const cookies = cookieHeader.split(';').map(c => c.trim());
  const pair = cookies.find(c => c.startsWith(`${SESSION_COOKIE}=`));
  if (!pair) return null;
  const token = pair.slice(SESSION_COOKIE.length + 1);
  return verifySessionToken(token);
}

function createSessionCookie(token, { secure = process.env.NODE_ENV === 'production', maxAge = SESSION_MAX_AGE_SECONDS } = {}) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

function clearSessionCookie() {
  const attrs = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

module.exports = {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  issueSession,
  verifySessionToken,
  readSessionFromCookies,
  createSessionCookie,
  clearSessionCookie,
};
