const CACHE_NAME = 'bmemap-shell-v9';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './i18n.js',
    './locales/hu.json',
    './locales/en.json',
    './assets/flags/hu.svg',
    './assets/flags/gb.svg',
    './app.js',
    './room_data.js',
    'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css',
    'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js'
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
    // Chrome extension request-eket és nem-HTTP request-eket kihagyjuk
    if (!e.request.url.startsWith('http')) return;
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