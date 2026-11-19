// Network first, fall back to cache, so the app opens even with bad signal.
const C = 'knockmap-v20';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const appFile = u.origin === location.origin || u.host === 'cdnjs.cloudflare.com' || u.host === 'cdn.jsdelivr.net';
  if (!appFile) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open(C).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
