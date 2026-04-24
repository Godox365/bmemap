// Átírtuk v2-re, hogy a böngésző észrevegye a változást és lecserélje a régi bugos workert!
const CACHE_NAME = 'bmemap-shell-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './room_data.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (e) => {
    // Azonnali telepítés várakozás nélkül
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('activate', (e) => {
    // Azonnali átvétel
    e.waitUntil(self.clients.claim());
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) return caches.delete(key);
            }));
        })
    );
});

// --- NETWORK FIRST STRATÉGIA ---
self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request)
            .then((networkResponse) => {
                // Ha van net, és sikeres a letöltés, lementjük a friss verziót a cache-be
                if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseToCache);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // Ha NINCS net (vagy hiba van), akkor adjuk oda a lementett offline verziót
                return caches.match(e.request);
            })
    );
});