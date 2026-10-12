const CACHE_NAME = 'budines-shell-v40-tuner';
const SHELL_ASSETS = [
  '/',
  '/styles.css?v=tuner-20261012',
  '/js/audio-coordinator.js',
  '/js/chat.js?v=offline-chat-20260907',
  '/js/local-profile.js?v=offline-chat-20260907',
  '/js/api.js?v=tools-only-20261012',
  '/js/api.js?v=offline-chat-20260907',
  '/js/app.js?v=tuner-20261012',
  '/js/local-storage.js?v=auth-20260723',
  '/js/metronome-core.js',
  '/js/metronome-core-v2.js?v=songbook-20261012',
  '/js/metronome-editor.js?v=songbook-20261012',
  '/js/metronome.js',
  '/js/songbook-client.js?v=songbook-20261012',
  '/js/navigation.js?v=tools-only-20261012',
  '/js/truco.js?v=joint-access-20260805',
  '/js/tuner-core.js?v=tuner-20261012',
  '/js/tuner.js?v=tuner-20261012',
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
      // Fetch the new shell afresh even when a previous page populated HTTP cache.
      .then((cache) => cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('budines-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
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
    // Pages redirects /index.html to /. A redirected cached response is invalid
    // for navigation requests with redirect=manual, so use the canonical root.
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
      (await cache.match('/')) || fetch(event.request)
    ));
    return;
  }

  if (SHELL_ASSETS.includes(url.pathname + url.search)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
      (await cache.match(event.request)) || fetch(event.request)
    ));
  }
});
