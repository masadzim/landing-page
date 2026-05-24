// Ubah versi ini setiap kali ada perubahan di project
const CACHE_VERSION = 'v1.2';
const CACHE_NAME = 'kebab-factory-' + CACHE_VERSION;

const FILES = [
  './',
  './index.html',
  './manifest.json',
  './logo.png',
  './kebab-bot.png',
  './kebab1.jpeg',
  './kebab2.jpeg',
  './kebab3.jpg',
  './qris.png',
  './letuce.png',
  './Dagingkebab.png',
];

self.addEventListener('install', event => {
  console.log('SW: Install', CACHE_VERSION);
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES))
  );
});

self.addEventListener('activate', event => {
  console.log('SW: Aktif, hapus cache lama');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});self.addEventListener('install', () => {
  console.log('Service Worker Installed');
});
