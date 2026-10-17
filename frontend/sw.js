const CACHE = 'myeyes-pwa-v11-pip-object-alerts';
const ASSETS = [
  '/',
  '/index.html',
  '/camera.html',
  '/homePage.css',
  '/integration.css',
  '/styles.css',
  '/site.js',
  '/app.js',
  '/logic.js',
  '/camera.js',
  '/picture-in-picture.js',
  '/video-frames.js',
  '/phone-notifications.js',
  '/object-alerts.js',
  '/backend-detector.js',
  '/local-detector.js',
  '/depth-controller.js',
  '/depth-ui.js',
  '/depth-sensors.js',
  '/depth-geometry.js',
  '/depth-model.js',
  '/standalone.js',
  '/gradient.js',
  '/manifest.webmanifest',
  '/demo-scene.svg',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith('myeyes-sample-') || key.startsWith('myeyes-pwa-') || key.startsWith('clearpath-pwa-') || key.startsWith('stepsense-sample-')) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
const RUNTIME_PREFIXES = ['/vendor/', '/vendor-depth/'];
const isRuntime = path => RUNTIME_PREFIXES.some(prefix => path.startsWith(prefix));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Frame uploads, API results, and readiness are never cached.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!ASSETS.includes(url.pathname) && !isRuntime(url.pathname)) return;
  // Model files are immutable and large, so a cache hit is served without a network round trip.
  if (isRuntime(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then((hit) => hit || fetch(event.request).then((response) => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy))); }
      return response;
    })));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => (await caches.open(CACHE).then(cache => cache.match(event.request))) || Response.error()));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || '/#camera', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ('navigate' in client) await client.navigate(destination);
      return client.focus();
    }
    return self.clients.openWindow(destination);
  }));
});
