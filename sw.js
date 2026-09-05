const CACHE_NAME = 'bmemap-shell-v24';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './i18n.js',
    './locales/hu.json',
    './locales/en.json',
    './assets/flags/hu.svg',
    './assets/flags/gb.svg',
    './assets/illustrations/default_room.svg',
    './assets/illustrations/lecture_hall.svg',
    './assets/illustrations/restroom.svg',
    './assets/illustrations/elevator.svg',
    './assets/illustrations/stairs.svg',
    './assets/illustrations/buffet.svg',
    './assets/illustrations/corridor.svg',
    './assets/illustrations/lab.svg',
    './assets/illustrations/storage.svg',
    './assets/illustrations/computer.svg',
    './assets/illustrations/cloakroom.svg',
    './assets/illustrations/office.svg',
    './assets/illustrations/door.svg',
    './assets/illustrations/coffee_machine.svg',
    './assets/illustrations/vending_machine.svg',
    './assets/illustrations/microwave.svg',
    './assets/illustrations/atm.svg',
    './app.js',
    './room_data.js',
    './manifest.json',
    './icon-192.png',
    'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css',
    'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js',
    'https://unpkg.com/osmtogeojson@3.0.0-beta.5/osmtogeojson.js',
    'https://unpkg.com/@turf/turf@6/turf.min.js',
    'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/themes/nano.min.css',
    'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/pickr.min.js'
];

self.addEventListener('install', (e) => {
    // Azonnali aktiválás várakozás nélkül
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME).then(async (cache) => {
            // Egyenként, hibatűrően töltjük le az offline shell elemeket
            // A { cache: 'reload' } kötelezi a böngészőt, hogy a hálózatról kérje le a legfrissebb fájlokat (nem a HTTP lemez-cache-ből)
            return Promise.all(
                ASSETS_TO_CACHE.map(async (url) => {
                    try {
                        const response = await fetch(url, { cache: 'reload' });
                        if (response && response.ok) {
                            await cache.put(url, response);
                        }
                    } catch (err) {
                        console.warn('SW pre-cache figyelmeztetés:', url, err);
                    }
                })
            );
        })
    );
});

self.addEventListener('activate', (e) => {
    // Azonnali kliens átvétel
    e.waitUntil(self.clients.claim());
    // Régi verziójú cache-ek automatikus felszabadítása
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) return caches.delete(key);
            }));
        })
    );
});

// --- NETWORK FIRST STRATÉGIA + MEGBÍZHATÓ OFFLINE FALLBACK ---
self.addEventListener('fetch', (e) => {
    // Csak HTTP és HTTPS kérések kezelése
    if (!e.request.url.startsWith('http')) return;

    e.respondWith(
        fetch(e.request)
            .then((networkResponse) => {
                // Ha van internet, elmentjük a friss választ a cache-be
                // Mind a helyi ('basic'), mind a külső CDN ('cors') válaszokat elmentjük offline célra
                if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseToCache);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // Ha NINCS internet (offline állapot), a mentett cache-ből adjuk oda a választ
                // Az { ignoreSearch: true } opcióval a ?v=14 query paraméterrel ellátott fájlokat is megtalálja!
                return caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
                    if (cachedResponse) return cachedResponse;

                    // Offline navigációs fallback a főoldalra
                    if (e.request.mode === 'navigate') {
                        return caches.match('./index.html', { ignoreSearch: true });
                    }
                    return null;
                });
            })
    );
});