// Film Kütüphanesi - Basit Service Worker
// Sadece PWA "yüklenebilir" kriterini karşılamak için minimal bir yapı

const CACHE_NAME = 'film-takip-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Ağ isteklerini doğrudan geçiriyoruz (özel bir önbellekleme/çevrimdışı mantığı yok)
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
