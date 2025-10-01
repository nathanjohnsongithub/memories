
(async function(){
  if (location.pathname === '/login.html') return;

  const hasMarker = document.cookie.split(';').some(c => c.trim().startsWith('mem_auth_mark='));
  if (!hasMarker) {
    const retFast = encodeURIComponent(location.pathname + location.search + location.hash);
    location.replace(`/login.html?return=${retFast}`);
    return;
  }

  try {
    const response = await fetch('/api/session-check', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });

    if (response.ok) {
      return;
    }
  } catch (err) {
    console.error('auth guard error', err);
  }

  const ret = encodeURIComponent(location.pathname + location.search + location.hash);
  location.replace(`/login.html?return=${ret}`);
})();
