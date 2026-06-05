const CACHE = 'nuvio-api-v2';
const TTL_CATALOG = 30 * 60 * 1000; // 30 min for catalog/meta (movies don't change often)
const TTL_SHORT = 5 * 60 * 1000;    // 5 min for other APIs

// These are fetched directly by the app's JS (not through our proxy)
const CACHEABLE = {
  'api.themoviedb.org': TTL_CATALOG,
  'api.trakt.tv': TTL_SHORT,
  'api.imdbapi.dev': TTL_CATALOG,
  'api.introdb.app': TTL_CATALOG,
  'seriesgraph.com': TTL_CATALOG,
};

// Supabase now goes through /_sb/ (same origin), cached at CDN level.
// The SW caches all same-origin GET requests to /_sb/rest/v1/ too.
const SAME_ORIGIN_CACHE = {
  '/_sb/rest/v1/': TTL_CATALOG,
};

function getTTL(url) {
  try {
    const u = new URL(url);
    const hostMatch = CACHEABLE[u.hostname];
    if (hostMatch) return hostMatch;
    for (const [prefix, ttl] of Object.entries(SAME_ORIGIN_CACHE)) {
      if (u.pathname.startsWith(prefix)) return ttl;
    }
  } catch { /* ignore */ }
  return 0;
}

async function respond(event) {
  if (event.request.method !== 'GET') return fetch(event.request);
  const ttl = getTTL(event.request.url);
  if (!ttl) return fetch(event.request);

  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);

  if (cached) {
    const age = Date.now() - Number(cached.headers.get('x-sw-ts') || 0);
    if (age < ttl) return cached;
  }

  const fresh = await fetch(event.request);
  if (fresh.ok) {
    const headers = new Headers(fresh.headers);
    headers.set('x-sw-ts', String(Date.now()));
    const stored = new Response(await fresh.clone().arrayBuffer(), {
      status: fresh.status,
      statusText: fresh.statusText,
      headers,
    });
    cache.put(event.request, stored);
  }
  return fresh;
}

self.addEventListener('fetch', event => {
  event.respondWith(respond(event));
});

self.addEventListener('activate', event => {
  // Delete old cache versions
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('install', () => self.skipWaiting());
