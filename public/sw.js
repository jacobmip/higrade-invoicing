// Service worker for HI Grade Invoicing.
// Strategy:
//   - App shell (HTML, JS, CSS, fonts): cache-first with background revalidation
//     so the app loads instantly from the device even when iOS reloads the page.
//   - API and Supabase requests: network-only (never cache live data).
//   - On activation: take control immediately so the first load is also covered.

const CACHE = 'higrade-v1';

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
  // Take control of all open tabs immediately.
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = request.url;

  // Only handle GET requests.
  if (request.method !== 'GET') return;

  // Never cache live data or API calls.
  if (isNeverCache(url)) return;

  // Navigation requests (HTML) — serve from cache, revalidate in background.
  if (request.mode === 'navigate') {
    e.respondWith(staleWhileRevalidate(request));
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

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || await fetchPromise || new Response('Offline', { status: 503 });
}
