// Virtual Waitress — Service Worker
// Caches all assets so the menu works even with poor network (common in restaurants)

const CACHE = 'vw-v68';
// Three files. Each earns its place:
//   '/'              — the HTML shell; without it, offline shows the browser error page
//   '/manifest.json' — PWA install prompt and home-screen icon (500 bytes)
//   '/icons/icon.svg'— referenced directly in the push handler below (310 bytes)
//
// Everything else (images, logos, Next.js chunks) caches on first request via the
// fetch handler. No hand-kept list means no drift when files are added or renamed.
const ASSETS = [
  '/',
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

// Fetch: serve from cache first, fall back to network —
// but only for our own static assets. Supabase calls (API + Realtime) must
// always go live, never be cached, or the dashboard/orders would go stale.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request)
      .then(cached => cached || fetch(e.request))
      .catch(() => new Response('', { status: 503, statusText: 'Offline' }))
  );
});

// Push: show a system notification even if the dashboard tab is closed.
self.addEventListener('push', e => {
  let data = { title: 'Virtual Waitress', body: 'You have a new alert.' };
  try { data = e.data.json(); } catch (err) { /* fall back to default text above */ }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: 'vw-alert',
      renotify: true
    })
  );
});

// Notification click: focus an open dashboard tab, or open a new one.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/waiter.html')) return client.focus();
      }
      return clients.openWindow('/waiter.html');
    })
  );
});
