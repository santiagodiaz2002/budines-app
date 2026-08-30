const CACHE_NAME = 'budines-shell-v35-operations';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/styles.css?v=operations-20260830',
  '/js/audio-coordinator.js',
  '/js/api.js?v=operations-20260830',
  '/js/app.js?v=operations-20260830',
  '/js/format.js',
  '/js/local-storage.js?v=auth-20260723',
  '/js/metronome-core.js',
  '/js/metronome-core-v2.js?v=metronome-continuous-20260716',
  '/js/metronome-editor.js?v=redesign13-20260730',
  '/js/metronome.js',
  '/js/navigation.js?v=redesign13-20260730',
  '/js/truco.js?v=joint-access-20260805',
  '/js/tuner-core.js',
  '/js/tuner.js?v=redesign13-20260730',
  '/js/validation.js?v=operations-20260830',
  '/manifest.webmanifest',
  '/branding/logo-luz-en-ruinas.png',
  '/media/joint-clean.png',
  '/media/smoke.png',
  '/icons/favicon-16.png',
  '/icons/favicon-32.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-1024.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin || event.request.method !== 'GET') {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
