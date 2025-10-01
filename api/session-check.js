const { readSessionFromCookies } = require('../lib/session');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  const session = readSessionFromCookies(req.headers.cookie || '');
  if (!session) {
    return res.status(401).json({ error: 'not authenticated' });
  }

  return res.status(200).json({ ok: true });
};
