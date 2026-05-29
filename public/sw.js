// Service worker for HI Grade Invoicing.
// Strategy:
//   - HTML (navigation): network-first, fall back to cache only when offline.
//     This guarantees a fresh deploy shows up on the very next open instead of
//     being "one launch behind" (the old stale-while-revalidate served the
//     previous version's HTML, so the new bundle never loaded until a 2nd open).
//   - Static assets (JS/CSS/fonts/images): cache-first — safe because Vite
//     fingerprints filenames, so a new deploy fetches new hashes automatically.
//   - API and Supabase requests: network-only (never cache live data).
//   - On activation: delete old caches and take control immediately.

const CACHE = 'higrade-v2';

const NEVER_CACHE = [
  'supabase.co',
  '/api/',
  'resend.com',
  'googleapis.com',
  'fonts.gstatic.com',   // allow font CSS below but not binary blobs
];

function isNeverCache(url) {
  return NEVER_CACHE.some(p => url.includes(p));
}

self.addEventListener('install', (e) => {
  // Skip waiting so the new SW activates as soon as it installs.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Drop any caches from previous versions so a stale bundle can't linger,
  // then take control of all open tabs immediately.
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = request.url;

  // Only handle GET requests.
  if (request.method !== 'GET') return;

  // Never cache live data or API calls.
  if (isNeverCache(url)) return;

  // Navigation requests (HTML) — network-first so a new deploy loads right
  // away; fall back to cache only when the network is unavailable (offline).
  if (request.mode === 'navigate') {
    e.respondWith(networkFirst(request));
    return;
  }

  // Static assets (JS/CSS/fonts/images) — cache-first (hashed filenames ensure freshness).
  e.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}
