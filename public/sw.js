// ---------------------------------------------------------------------------
// Service worker.
//
// Its first job is to exist: Chrome will not offer "Install" without one. Its
// second is to keep the app openable when the connection drops — the shop's
// internet going down should not take the invoice list with it.
//
// The strategy is NETWORK FIRST, deliberately. Nothing here is fingerprinted —
// app.js is always app.js — so a cache-first worker would happily run last
// week's JavaScript against this week's data for as long as the cache lived.
// Every request tries the network, and the cache is only reached for when the
// network cannot answer. Slightly slower; never wrong.
//
// Firestore, Auth and the Firebase CDN are cross-origin and are not touched at
// all. Firestore does its own offline persistence, and a service worker
// guessing at API responses would be a liability, not a feature.
// ---------------------------------------------------------------------------

const VERSION = 'v1';
const CACHE = `express-invoicing-${VERSION}`;

// The screens and their code. Listed one by one rather than through addAll so
// that a single missing file cannot fail the whole install.
const SHELL = [
  './',
  'index.html', 'login.html', 'dashboard.html',
  'invoices.html', 'invoice.html', 'quotes.html', 'quote.html',
  'orders.html', 'order.html', 'payments.html', 'payment.html',
  'customers.html', 'customer.html', 'items.html', 'item.html',
  'recurring.html', 'statements.html', 'reports.html', 'search.html',
  'import.html', 'settings.html', 'shortcuts.html', 'print.html', 'quick.html',
  'css/app.css',
  'manifest.webmanifest',
  'img/icon-192.png', 'img/icon-512.png', 'img/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    // Take over straight away. Waiting for every tab to close would leave a
    // fixed bug sitting unused on a machine that is never restarted.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((name) => (name === CACHE ? null : caches.delete(name))));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // Firestore, Auth, the CDN
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      // Only keep a copy of a real answer. Caching an error page would serve
      // that error back later, offline, as though it were the app.
      if (response && response.status === 200 && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      return response;
    } catch (err) {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      // A page that was never opened before the connection went: give the
      // entry point, which knows where to send them once they are back.
      if (request.mode === 'navigate') {
        const fallback = await caches.match('index.html');
        if (fallback) return fallback;
      }
      throw err;
    }
  })());
});
