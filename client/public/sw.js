const CACHE_NAME = 'lenory-cache-v5';
const OFFLINE_URL = '/offline.html';

const STATIC_ASSETS = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/offline.html',
  '/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.log('Cache addAll failed (non-fatal):', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // API calls: network-first, fallback offline JSON
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'You are offline. Please check your connection.' }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Supabase: network-only
  if (url.hostname.includes('supabase') || url.hostname.includes('groq.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Dev-server source files: network-only
  if (url.pathname.startsWith('/src/') || url.pathname.includes('.ts') || url.pathname.includes('.tsx')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell navigation pages — stale-while-revalidate
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const fetchPromise = fetch(event.request)
            .then((response) => {
              if (response.ok) cache.put(event.request, response.clone());
              return response;
            })
            .catch(() => cached || caches.match(OFFLINE_URL).then(r => r || new Response('Offline', { status: 503 })));
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // Static assets — cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
