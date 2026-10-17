const CACHE = 'stepsense-sample-v2';
const ASSETS = ['/', '/camera.html', '/app.js', '/logic.js', '/tracking.js', '/perception.js', '/local-detector.js', '/local-detector-worker.js', '/depth.js', '/depth-worker.js', '/styles.css', '/demo-scene.svg', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('stepsense-sample-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Frame uploads, API results, and readiness are never cached.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !ASSETS.includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => (await caches.match(event.request)) || Response.error()));
});
