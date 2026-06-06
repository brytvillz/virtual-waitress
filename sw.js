// Virtual Waitress — Service Worker
// Caches all assets so the menu works even with poor network (common in restaurants)

const CACHE = 'vw-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon.svg'
];

// Install: cache everything on first load
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: remove old caches when app updates
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: serve from cache first, fall back to network
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
