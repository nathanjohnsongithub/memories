const crypto = require('crypto');
const { readSessionFromCookies } = require('../lib/session');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).end();

  // verify signed session cookie
  const session = readSessionFromCookies(req.headers.cookie || '');
  if (!session) return res.status(401).json({ error: 'not authenticated' });

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ error: 'server not configured' });
    }

    // Build filters from query params
    const url = new URL(req.url, `http://${req.headers.host}`);
    const by = (url.searchParams.get('by') || 'all').toLowerCase();
    const sort = (url.searchParams.get('sort') || 'newest').toLowerCase();
    const after = url.searchParams.get('after');
    const before = url.searchParams.get('before');

    // Base endpoint: view with author
    const base = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/memories_with_author`;
    const params = new URLSearchParams();
    params.set('select', 'id,title,note,image_url,taken_at,created_at,author_name');

  // Author filter
  if (by === 'hannah') params.set('author_name', 'eq.Hannah');
  else if (by === 'nathan') params.set('author_name', 'eq.Nathan');
  else if (by === 'both') params.set('author_name', 'eq.Both');

    // Date filters: implement OR logic using PostgREST or param
    if (after) {
      params.append('or', `(taken_at.gte.${after},and(taken_at.is.null,created_at.gte.${after}))`);
    }
    if (before) {
      params.append('or', `(taken_at.lte.${before},and(taken_at.is.null,created_at.lte.${before}))`);
    }

    // Respect public visibility by default
    params.set('is_private', 'eq.false');

    // Sort: emulate coalesce(taken_at, created_at)
    // Newest: taken_at desc nullslast, then created_at desc
    // Oldest: taken_at asc nullsfirst, then created_at asc
    if (sort === 'oldest') {
      params.append('order', 'taken_at.asc.nullsfirst');
      params.append('order', 'created_at.asc');
    } else {
      params.append('order', 'taken_at.desc.nullslast');
      params.append('order', 'created_at.desc');
    }
    // Limit
    params.set('limit', '100');
    const listUrl = `${base}?${params.toString()}`;
    const listRes = await fetch(listUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (!listRes.ok) {
      const txt = await listRes.text();
      console.error('list-memories failed', listRes.status, txt);
      return res.status(500).json({ error: 'list failed', status: listRes.status, detail: txt });
    }

    const items = await listRes.json();
    return res.status(200).json({ ok: true, items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
};
