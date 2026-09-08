const CACHE_NAME = 'bmemap-shell-v38';
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
    './data/search_index.json',
    './data/k_epulet.json',
    './data/q_epulet.json',
    './data/i_epulet.json',
    './manifest.json',
    './icon-192.png',
    'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css',
    'https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js',
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

// --- STRATÉGIA: NAVIGÁCIÓRA NETWORK-FIRST (TIMEOUT-TAL), STATIKUS FÁJLOKRA SWR ---
self.addEventListener('fetch', (e) => {
    if (!e.request.url.startsWith('http')) return;
    if (e.request.method !== 'GET') return;

    const url = new URL(e.request.url);

    // 1. Navigációs kérések (HTML): Network-First 1.5 mp-es időtúllépéssel
    if (e.request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === '/') {
        e.respondWith(
            new Promise((resolve) => {
                let resolved = false;
                const timeoutId = setTimeout(async () => {
                    if (!resolved) {
                        resolved = true;
                        const cached = await caches.match('./index.html', { ignoreSearch: true });
                        if (cached) resolve(cached);
                    }
                }, 1500);

                fetch(e.request)
                    .then(async (networkResponse) => {
                        clearTimeout(timeoutId);
                        if (networkResponse && networkResponse.status === 200) {
                            const cache = await caches.open(CACHE_NAME);
                            cache.put(e.request, networkResponse.clone());
                        }
                        if (!resolved) {
                            resolved = true;
                            resolve(networkResponse);
                        }
                    })
                    .catch(async () => {
                        clearTimeout(timeoutId);
                        if (!resolved) {
                            resolved = true;
                            const cached = await caches.match(e.request, { ignoreSearch: true })
                                        || await caches.match('./index.html', { ignoreSearch: true });
                            resolve(cached);
                        }
                    });
            })
        );
        return;
    }

    // 2. Statikus erőforrások (JS, CSS, SVG, képek, GeoJSON): Stale-While-Revalidate
    e.respondWith(
        caches.match(e.request, { ignoreSearch: true }).then((cachedResponse) => {
            const fetchPromise = fetch(e.request)
                .then(async (networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                        const cache = await caches.open(CACHE_NAME);
                        cache.put(e.request, networkResponse.clone());
                    }
                    return networkResponse;
                })
                .catch(() => null);

            return cachedResponse || fetchPromise;
        })
    );
});