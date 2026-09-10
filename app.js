/**
 * Ellenőrzi a szobaadatbázis (room_data.js) elérhetőségét.
 * Ha hiányzik, üres objektummal inicializál a hibák elkerülésére.
 */
if (typeof ROOM_DATABASE === 'undefined') {
    console.warn("room_data.js nem található vagy nem töltődött be!");
    window.ROOM_DATABASE = {};
}

/**
 * XSS védelem, kiszedi a HTML tageket az OSM adatokból.
 */
function escapeHTML(str) {
    if (!str) return "";
    return String(str).replace(/[&<>'"]/g, match => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
        return map[match];
    });
}

/**
 * Gyors, allokációmentes síkbeli távolságszámítás méterben (WGS84 koordinátákhoz helyi skálán).
 * Nincs GeoJSON objektum létrehozás, nagyságrendekkel gyorsabb a turf.distance-nél belső hurkokban.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Távolság méterben
 */
function fastDistMeters(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * 111139;
    const meanLatRad = ((lat1 + lat2) * 0.5) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (111139 * Math.cos(meanLatRad));
    return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Kezdő épület adatainak azonnali, párhuzamos lekérése az oldal betöltésekor.
 */
let _initialBuildingFetchPromise = null;
let _initialBuildingKey = 'K';
try {
    if (typeof window !== 'undefined' && window.location) {
        const _params = new URLSearchParams(window.location.search);
        const _b = _params.get('b');
        if (_b) _initialBuildingKey = _b.toUpperCase();
    }
    _initialBuildingFetchPromise = fetch(`./data/${_initialBuildingKey.toLowerCase()}_epulet.json`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
} catch(e) {}

/**
 * EMBED MÓD DETEKTÁLÁS ÉS BEÁLLÍTÁS
 * Támogatja az /embed útvonalat, a ?mode=embed és a ?embed=true paramétereket.
 */
const IS_EMBED_MODE = (() => {
    if (typeof window === 'undefined' || !window.location) return false;
    const path = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(window.location.search);
    return path.startsWith('/embed') || params.get('mode') === 'embed' || params.get('embed') === 'true';
})();

if (IS_EMBED_MODE && typeof document !== 'undefined') {
    if (document.documentElement) document.documentElement.classList.add('embed-mode');
    if (document.body) document.body.classList.add('embed-mode');
    else window.addEventListener('DOMContentLoaded', () => document.body.classList.add('embed-mode'));
}

/**
 * Központi Tag Katalógus a terem felszerelésekhez, szolgáltatásokhoz és funkció-címkékhez.
 * A kisbetűs keresőkulcsokhoz hozzárendeli a Material Symbols ikont és a szép megjelenítési nevet.
 */
const TAG_CATALOG = {
    // --- Felszereltség / Infrastruktúra ---
    "projector":        { icon: "videocam",         label: "Projektor" },
    "key":              { icon: "vpn_key",          label: "Kulcsos" },
    "ac":               { icon: "ac_unit",          label: "Légkondicionált" },
    "print":            { icon: "print",            label: "Nyomtatás" },
    "scan":             { icon: "scanner",          label: "Szkennelés" },
    "pc":               { icon: "desktop_windows",  label: "Számítógép" },
    "luggage":          { icon: "luggage",          label: "Csomagmegőrző" },

    // --- Szolgáltatások / Funkciók / Teremtípusok ---
    "quiet_study":      { icon: "local_library",    label: "Csendes tanulás" },
    "study":            { icon: "menu_book",        label: "Tanuló" },
    "eat":              { icon: "restaurant",       label: "Étkezés" },
    "reserve":          { icon: "event_available",  label: "Foglalható" },
    "accessible":       { icon: "accessible",       label: "Akadálymentes" },
    "social":           { icon: "groups_2",       label: "Közösségi tér" },

    // --- Könyvtár ---
    "szakirodalom":     { icon: "book",             label: "Szakirodalom" },
    "szépirodalom":     { icon: "book",             label: "Szépirodalom" },
    "útikönyvek":       { icon: "book",             label: "Útikönyvek" },
    "szótárak":         { icon: "dictionary",       label: "Szótárak" },
    "tankönyvek":       { icon: "book",             label: "Tankönyvek" },
    "olvasójegy":       { icon: "person_book",      label: "Olvasójegy" },
    "kölcsönzés":       { icon: "bookmark",         label: "Kölcsönzés" },

    // --- Általános ---
    "info":             { icon: "info",             label: "Információ" }
};

const TAG_CATALOG_FALLBACK = { icon: "label", label: null };

/**
 * Segédfüggvény a szoba címkék többnyelvű megnevezésének lekéréséhez.
 */
function getTagLabel(cleanKey, fallbackLabel) {
    if (typeof t === 'function') {
        const trans = t(`tags.${cleanKey}`);
        if (trans && trans !== `tags.${cleanKey}`) return trans;
    }
    return fallbackLabel || cleanKey;
}

/**
 * Segédfüggvény a szoba megjegyzésének (note) többnyelvű lekéréséhez.
 * Támogatja a többnyelvű objektum formátumot ({ hu: "...", en: "..." })
 * valamint a string alapú visszamenőleges kompatibilitást.
 */
function getRoomNote(roomData) {
    if (!roomData || !roomData.note) return "";
    if (typeof roomData.note === 'object' && roomData.note !== null) {
        const lang = APP_SETTINGS.language || (typeof i18n !== 'undefined' ? i18n.currentLanguage : 'hu');
        return roomData.note[lang] || roomData.note['hu'] || roomData.note['en'] || "";
    }
    return roomData.note;
}

/**
 * Dinamikusan rendereli a szoba meta címkéit (kapacitás, címkék, felszereltség, funkciók).
 * Támogatja a string-alapú tageket, az objektumként definiált egyedi tageket ({icon, label}),
 * valamint az automatikus OSM akadálymentességet és a visszamenőleges kompatibilitást.
 * @param {Object|null} roomData - A belső szoba adatbázis bejegyzése
 * @param {boolean} isAccessible - OSM akadálymentességi jelző
 */
function renderRoomMeta(roomData, isAccessible) {
    const metaContainer = document.querySelector('.room-meta');
    if (!metaContainer) return;

    metaContainer.innerHTML = '';
    let hasAnyChip = false;

    // 1. Kapacitás (férőhely) chip
    if (roomData && roomData.capacity) {
        const capEl = document.createElement('div');
        capEl.className = 'meta-tag';
        capEl.id = 'meta-capacity';
        const capText = typeof t === 'function' ? t('sheet.capacity', { capacity: escapeHTML(roomData.capacity) }) : `${escapeHTML(roomData.capacity)} fő`;
        capEl.innerHTML = `<span class="material-symbols-outlined">group</span> ${capText}`;
        metaContainer.appendChild(capEl);
        hasAnyChip = true;
    }

    // 2. Tagek összegyűjtése
    const rawTags = [];
    if (roomData) {
        if (Array.isArray(roomData.tags)) {
            rawTags.push(...roomData.tags);
        }
        // Visszafelé kompatibilitás régi formátumhoz
        if (roomData.key && !rawTags.some(t => typeof t === 'string' && t.toLowerCase().includes('kulcs'))) {
            rawTags.push('key');
        }
        if (roomData.projector && !rawTags.some(t => typeof t === 'string' && t.toLowerCase().includes('projektor'))) {
            rawTags.push('projector');
        }
    }

    // 3. OSM akadálymentesség hozzáadása
    if (isAccessible && !rawTags.some(t => typeof t === 'string' && (t.toLowerCase().includes('akadálymentes') || t.toLowerCase() === 'accessible'))) {
        rawTags.push('accessible');
    }

    // 4. Tag chipek előállítása
    rawTags.forEach(tagItem => {
        let icon = TAG_CATALOG_FALLBACK.icon;
        let label = '';

        if (typeof tagItem === 'object' && tagItem !== null) {
            // Egyedi objektum: { icon: "...", label: "..." } vagy { icon: "...", name: "..." }
            icon = tagItem.icon || TAG_CATALOG_FALLBACK.icon;
            const rawLabel = tagItem.label || tagItem.name || '';
            label = getTagLabel(rawLabel.toLowerCase(), rawLabel);
        } else if (typeof tagItem === 'string') {
            const raw = tagItem.trim();
            if (!raw) return;
            const clean = raw.toLowerCase();
            if (TAG_CATALOG[clean]) {
                icon = TAG_CATALOG[clean].icon;
                label = getTagLabel(clean, TAG_CATALOG[clean].label || (raw.charAt(0).toUpperCase() + raw.slice(1)));
            } else {
                // Ismeretlen tag: fallback ikon + az eredeti név (első betű nagyítva, ha kisbetűs volt)
                icon = TAG_CATALOG_FALLBACK.icon;
                label = getTagLabel(clean, raw.charAt(0).toUpperCase() + raw.slice(1));
            }
        }

        if (label) {
            const chip = document.createElement('div');
            chip.className = 'meta-tag';
            chip.innerHTML = `<span class="material-symbols-outlined">${escapeHTML(icon)}</span> ${escapeHTML(label)}`;
            metaContainer.appendChild(chip);
            hasAnyChip = true;
        }
    });

    metaContainer.style.display = hasAnyChip ? 'flex' : 'none';
}

/**
 * Meghatározza egy adott épület és szint alapján a lehetséges szintazonosító karaktereket.
 * Kombinálja a nyers szintszámot, a dinamikusan betöltött aliasokat (pl. OSM-ből származó adatok),
 * valamint az épület-specifikus, fixen kódolt (hardcoded) kivételszabályokat.
 * Elsődlegesen a dinamikusan betöltött aliasokat (OSM 'level:ref') használja a fals találatok elkerülésére.
 * * @param {string} buildingKey - Az épület azonosítója (pl. 'K', 'Q', 'I').
 * @param {number|string} rawLevel - A szint nyers, eredeti értéke (pl. 0, -1, 1).
 * @returns {string[]} A szinthez tartozó lehetséges azonosítók tömbje (pl. ['-1', 'f', '0']).
 */
function getLevelChars(buildingKey, rawLevel) {
    const b = buildingKey.toUpperCase();
    const l = rawLevel.toString();
    
    let chars = new Set();

    // 1. Alapértelmezett bejegyzés: a nyers szintszám (pl. "1", "0", "-1")
    chars.add(l);

    // 2. Dinamikus aliasok (OSM 'level:ref') - EZZEL KERESÜNK ELSŐDLEGESEN! (pl. 'mf')
    if (levelAliases[l]) {
        chars.add(normalizeRoomId(levelAliases[l]));
    }

    // 3. Épület-specifikus szabályok
    if (b === 'K') {
        if (l === '0') {
            chars.add('f');
            chars.add('0');
            chars.add('kf');
        } else if (l === '1') {
            chars.add('mf');
            chars.add('m');
            chars.add('kmf');
            chars.add('km');
            // Magasföldszinten (1) töröljük a nyers '1'-et, hogy ne generáljon I. emeleti k1xx szobakódokat
            chars.delete('1');
        } else if (l === '2') {
            // A 2-es OSM szint az 1. emelet, a termek k1xx kódúak (pl. K174, K150)
            chars.add('1');
            chars.delete('2');
        } else if (l === '3') {
            // A 3-as OSM szint a 2. emelet, a termek k2xx kódúak (pl. K234, K250)
            chars.add('2');
            chars.delete('3');
        } else if (l === '4') {
            // A 4-es OSM szint a 3. emelet, a termek k3xx kódúak (pl. K350, K371)
            chars.add('3');
            chars.delete('4');
        }
    } else if (b === 'Q') {
        if (l === '-1') chars.add('p'); // Parkoló
        if (l === '0') chars.add('f');  // Földszint
    } else {
        if (l === '0') chars.add('f');
    }

    return Array.from(chars);
}

/**
 * Kereső logika (Smart Filter v3).
 * A megadott keresési kifejezés alapján szűri a betöltött térképadatokat (GeoJSON features).
 * Intelligens egyezésvizsgálatot végez, amely magában foglalja a direkt egyezést, 
 * a dinamikusan generált aliasokat (pl. épületkód + szint + szobaszám), 
 * valamint a részleges összetételeket (fuzzy search).
 * * @param {string} term - A felhasználó által bevitt keresési kifejezés.
 * @returns {Object[]} A keresési feltételeknek megfelelő térképelemek (features) tömbje.
 */
function smartFilter(term) {
    // A keresett kifejezés normalizálása (kisbetűsítés, ékezetmentesítés, speciális karakterek eltávolítása)
    const cleanTerm = normalizeRoomId(term); 
    if (cleanTerm.length < 2) return [];

    const bKey = currentBuildingKey.toLowerCase();
    const words = term.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[\s.\-_/()]+/).filter(w => w.length > 1);

    const scored = [];

    for (const f of geoJsonData.features) {
        const p = f.properties || {};

        // 1. Kizárjuk a folyosókat, lépcsőket és lifteket (ezek nem kereshető szobák/célpontok)
        const isCorridor = p.highway === 'corridor' || p.indoor === 'corridor' || p.room === 'corridor';
        const isStairs = p.highway === 'steps' || p.indoor === 'steps' || p.room === 'stairs' || p.indoor === 'staircase' || p.room === 'staircase' || p.stairs === 'yes';
        const isElevator = p.highway === 'elevator' || p.room === 'elevator' || p.indoor === 'elevator' || p.amenity === 'elevator';
        if (isCorridor || isStairs || isElevator) continue;

        // Épület körvonal és szint/fal elemek kizárása
        if (p.building && !p.indoor && !p.room) continue;
        if (p.indoor === 'level' || p.indoor === 'wall') continue;

        const name = normalizeRoomId(p.name);
        const ref = normalizeRoomId(p.ref);
        const altName = normalizeRoomId(p.alt_name);

        // Csak nevesített vagy ref számmal ellátott elemeket keresünk
        if (!name && !ref && !altName) continue;

        const rawLvl = getLevelsFromFeature(f)[0] || "0";
        const lvlChars = getLevelChars(currentBuildingKey, rawLvl);

        // Aliasok (kombinációk) dinamikus generálása
        const aliases = new Set();
        if (ref) {
            aliases.add(ref);
            aliases.add(bKey + ref);
            lvlChars.forEach(lvl => {
                if (!ref.startsWith(lvl)) {
                    aliases.add(lvl + ref);
                    aliases.add(bKey + lvl + ref);
                }
            });
            if (ref.startsWith(bKey) && ref.length > bKey.length) {
                aliases.add(ref.slice(bKey.length));
            }
        }
        if (altName) {
            aliases.add(altName);
            aliases.add(bKey + altName);
        }

        let bestScore = 0;

        // 1. Prioritás: Pontos egyezés (Exact Match)
        if (ref && (cleanTerm === ref || cleanTerm === bKey + ref)) {
            bestScore = Math.max(bestScore, 1100);
        } else if (altName && (cleanTerm === altName || cleanTerm === bKey + altName)) {
            bestScore = Math.max(bestScore, 1050);
        } else if (name && (cleanTerm === name || cleanTerm === bKey + name)) {
            bestScore = Math.max(bestScore, 1020);
        } else if (aliases.has(cleanTerm)) {
            bestScore = Math.max(bestScore, 1000);
        }

        // 2. Prioritás: Prefixes egyezés (Prefix Match)
        if (bestScore < 1000) {
            if (ref && (bKey + ref).startsWith(cleanTerm)) {
                bestScore = Math.max(bestScore, 850 - ((bKey + ref).length - cleanTerm.length) * 5);
            } else if (ref && ref.startsWith(cleanTerm)) {
                bestScore = Math.max(bestScore, 800 - (ref.length - cleanTerm.length) * 5);
            } else if (altName && altName.startsWith(cleanTerm)) {
                bestScore = Math.max(bestScore, 750);
            } else if (name && name.startsWith(cleanTerm)) {
                bestScore = Math.max(bestScore, 700);
            } else {
                for (const alias of aliases) {
                    if (alias.startsWith(cleanTerm)) {
                        bestScore = Math.max(bestScore, 750 - (alias.length - cleanTerm.length) * 5);
                        break;
                    }
                }
            }
        }

        // 3. Prioritás: Tartalmazási egyezés (Contains Match) & Többszavas keresés
        if (bestScore < 700) {
            if (words.length > 1) {
                const allWordsMatch = words.every(w => (name && name.includes(w)) || (altName && altName.includes(w)) || (ref && ref.includes(w)));
                if (allWordsMatch) {
                    bestScore = Math.max(bestScore, 650);
                }
            }
            if (altName && altName.includes(cleanTerm)) {
                bestScore = Math.max(bestScore, 600);
            } else if (name && name.includes(cleanTerm)) {
                bestScore = Math.max(bestScore, 500);
            } else if (ref && ref.includes(cleanTerm) && cleanTerm.length >= 3) {
                bestScore = Math.max(bestScore, 400);
            }
        }

        // 4. Prioritás: Természetes nyelvi keresés fallback (pl. "keresem a k133-at")
        if (bestScore === 0 && cleanTerm.length > 5) {
            for (const alias of aliases) {
                if (alias.length >= 3 && cleanTerm.includes(alias)) {
                    bestScore = Math.max(bestScore, 300);
                    break;
                }
            }
        }

        if (bestScore > 0) {
            scored.push({ feature: f, score: bestScore });
        }
    }

    // Relevancia szerint csökkenő sorrendbe rendezés
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => {
        s.feature._isLocal = true;
        s.feature._buildingKey = currentBuildingKey;
        s.feature._score = s.score;
        return s.feature;
    });
}

/**
 * Aszinkron módon betölti a campus összes épületét tartalmazó könnyűsúlyú keresési indexet.
 * @returns {Promise<Object[]>}
 */
async function loadSearchIndex() {
    if (globalSearchIndex) return globalSearchIndex;
    if (isSearchIndexLoading) return [];
    isSearchIndexLoading = true;
    try {
        const res = await fetch('./data/search_index.json');
        if (res.ok) {
            globalSearchIndex = await res.json();
        }
    } catch (err) {
        console.warn('⚠️ Nem sikerült betölteni a globális keresési indexet:', err);
    } finally {
        isSearchIndexLoading = false;
    }
    return globalSearchIndex;
}

/**
 * A globális keresési indexben keres az aktuális épülettől ELTÉRŐ épületekben.
 * Ugyanazt a pontozási logikát használja, mint a smartFilter, de egy fix pontlevonással (-150),
 * hogy az aktuális épület találatai mindig prioritást élvezzenek.
 * @param {string} term - A keresési kifejezés.
 * @returns {Object[]} A más épületekből származó találati elemek.
 */
function searchOtherBuildings(term) {
    if (!globalSearchIndex || !Array.isArray(globalSearchIndex) || globalSearchIndex.length === 0) {
        loadSearchIndex();
        return [];
    }

    const cleanTerm = normalizeRoomId(term);
    if (cleanTerm.length < 2) return [];

    const words = term.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[\s.\-_/()]+/).filter(w => w.length > 1);
    const scored = [];

    for (const item of globalSearchIndex) {
        // Kizárólag más épületekben keresünk (nincs duplikáció a jelenlegi épülettel!)
        if (item.b === currentBuildingKey) continue;

        const bKey = item.b.toLowerCase();
        const name = normalizeRoomId(item.name);
        const ref = normalizeRoomId(item.ref);
        const altName = normalizeRoomId(item.alt);

        if (!name && !ref && !altName) continue;

        const rawLvl = item.lvl || "0";
        const lvlChars = getLevelChars(item.b, rawLvl);

        const aliases = new Set();
        if (ref) {
            aliases.add(ref);
            aliases.add(bKey + ref);
            lvlChars.forEach(lvl => {
                if (!ref.startsWith(lvl)) {
                    aliases.add(lvl + ref);
                    aliases.add(bKey + lvl + ref);
                }
            });
            if (ref.startsWith(bKey) && ref.length > bKey.length) {
                aliases.add(ref.slice(bKey.length));
            }
        }
        if (altName) {
            aliases.add(altName);
            aliases.add(bKey + altName);
        }

        let bestScore = 0;

        // 1. Prioritás: Pontos egyezés (Exact Match)
        if (ref && (cleanTerm === ref || cleanTerm === bKey + ref)) {
            bestScore = Math.max(bestScore, 1100);
        } else if (altName && (cleanTerm === altName || cleanTerm === bKey + altName)) {
            bestScore = Math.max(bestScore, 1050);
        } else if (name && (cleanTerm === name || cleanTerm === bKey + name)) {
            bestScore = Math.max(bestScore, 1020);
        } else if (aliases.has(cleanTerm)) {
            bestScore = Math.max(bestScore, 1000);
        }

        // 2. Prioritás: Prefixes egyezés (Prefix Match)
        if (bestScore < 1000) {
            if (ref && (bKey + ref).startsWith(cleanTerm)) {
                bestScore = Math.max(bestScore, 850 - ((bKey + ref).length - cleanTerm.length) * 5);
            } else if (ref && ref.startsWith(cleanTerm)) {
                bestScore = Math.max(bestScore, 800 - (ref.length - cleanTerm.length) * 5);
            } else if (altName && altName.startsWith(cleanTerm)) {
                bestScore = Math.max(bestScore, 750);
            } else if (name && name.startsWith(cleanTerm)) {
                bestScore = Math.max(bestScore, 700);
            } else {
                for (const alias of aliases) {
                    if (alias.startsWith(cleanTerm)) {
                        bestScore = Math.max(bestScore, 750 - (alias.length - cleanTerm.length) * 5);
                        break;
                    }
                }
            }
        }

        // 3. Prioritás: Tartalmazási egyezés (Contains Match) & Többszavas keresés
        if (bestScore < 700) {
            if (words.length > 1) {
                const allWordsMatch = words.every(w => (name && name.includes(w)) || (altName && altName.includes(w)) || (ref && ref.includes(w)));
                if (allWordsMatch) {
                    bestScore = Math.max(bestScore, 650);
                }
            }
            if (altName && altName.includes(cleanTerm)) {
                bestScore = Math.max(bestScore, 600);
            } else if (name && name.includes(cleanTerm)) {
                bestScore = Math.max(bestScore, 500);
            } else if (ref && ref.includes(cleanTerm) && cleanTerm.length >= 3) {
                bestScore = Math.max(bestScore, 400);
            }
        }

        // 4. Prioritás: Természetes nyelvi keresés fallback (pl. "keresem a ib028-at")
        if (bestScore === 0 && cleanTerm.length > 5) {
            for (const alias of aliases) {
                if (alias.length >= 3 && cleanTerm.includes(alias)) {
                    bestScore = Math.max(bestScore, 300);
                    break;
                }
            }
        }

        if (bestScore > 0) {
            // Enyhe pontszám-levonás (-150) a más épületbeli találatoknak,
            // hogy az aktuális épület azonos szintű egyezései mindig előrébb végezzenek
            const adjustedScore = bestScore - 150;
            scored.push({
                item: {
                    id: item.id,
                    properties: {
                        ref: item.ref,
                        name: item.name,
                        alt_name: item.alt,
                        level: item.lvl,
                        'level:ref': item.lref
                    },
                    _buildingKey: item.b,
                    _isLocal: false,
                    _score: adjustedScore
                },
                score: adjustedScore
            });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
}

/**
 * Összefűzi a helyi és más épületek találatait pontszám szerint,
 * biztosítva a duplikációmentességet és a helyi épület prioritását.
 * @param {Object[]} localHits - A jelenlegi épületből származó találatok (smartFilter).
 * @param {Object[]} otherHits - A más épületekből származó találatok (searchOtherBuildings).
 * @returns {Object[]} A rendezett, egyesített találati lista.
 */
function mergeSearchResults(localHits, otherHits) {
    const combined = [];
    const seenIds = new Set();

    for (const h of localHits) {
        h._isLocal = true;
        h._buildingKey = currentBuildingKey;
        seenIds.add(h.id);
        combined.push({ hit: h, score: h._score || 1000 });
    }

    for (const o of otherHits) {
        if (!seenIds.has(o.item.id)) {
            seenIds.add(o.item.id);
            combined.push({ hit: o.item, score: o.score });
        }
    }

    combined.sort((a, b) => b.score - a.score);
    return combined.map(c => c.hit);
}

/**
 * Segédfüggvény a szobaazonosítók és keresési kifejezések normalizálására.
 * Eltávolítja az ékezeteket, szóközöket, pontokat és kötőjeleket, majd kisbetűssé alakítja a szöveget.
 * Ez biztosítja a robusztus és elgépelés-biztos keresést.
 * * @param {string} str - A formázandó, eredeti szöveg.
 * @returns {string} A normalizált, megtisztított szöveg.
 */
function normalizeRoomId(str) {
    if(!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s.\-_/()]/g, '').toLowerCase();
}

// === ÉPÜLET KONFIGURÁCIÓ ===
const BUILDINGS = {
    "K": { name: "K Épület", center: [47.4816562, 19.0559196], zoom: 19, regex: /^K/i, defaultLevel: "1" },
    "I": { name: "I Épület", center: [47.472616, 19.059552], zoom: 20, regex: /^I/i },
    "Q": { name: "Q Épület", center: [47.473410, 19.059555], zoom: 20, regex: /^Q/i },
    "E": { name: "E Épület", center: [47.477857, 19.057739], zoom: 20, regex: /^E/i },
    "R": { name: "R Épület", center: [47.4789527, 19.0591848], zoom: 19, regex: /^R/i },
    "KT": { name: "Könyvtár", center: [47.480874, 19.054276], zoom: 20, regex: /^KT/i }
};

/**
 * Visszaadja az adott épülethez tartozó alapértelmezett kezdő szintet.
 * @param {string} [buildingKey=currentBuildingKey] - Az épület azonosítója (pl. "K", "I").
 * @returns {string} Az alapértelmezett szint azonosítója (pl. "1" a K épületnél, "0" másutt).
 */
function getDefaultLevelForBuilding(buildingKey = currentBuildingKey) {
    const b = BUILDINGS[buildingKey];
    return (b && b.defaultLevel) ? b.defaultLevel : "0";
}


// === A NAGY SZÍN-BIBLIA ===
// Itt vannak definiálva a változók és az alapértelmezett értékeik (Dark / Light)
const THEME_VARS = {
    // --- ALAPOK (UI & Háttér) ---
    '--bg-body':           { dark: '#000000', light: '#ffffff', label: 'Háttér (Body)' },
    '--bg-surface':        { dark: '#1e1e1e', light: '#ffffff', label: 'Kártya Háttér' },
    '--bg-element':        { dark: '#333333', light: '#e0e0e0', label: 'Gomb/Input Háttér' },
    '--bg-button-glass':   { dark: 'rgba(255,255,255,0.1)', light: 'rgba(0,0,0,0.05)', label: 'Üveg Gomb' },
    '--text-main':         { dark: '#ffffff', light: '#1c1c1e', label: 'Fő Szöveg' },
    '--text-sub':          { dark: '#aaaaaa', light: '#666666', label: 'Másodlagos Szöveg' },
    '--border-color':      { dark: '#333333', light: '#d1d1d1', label: 'Keretek' },
    '--icon-color':        { dark: '#aaaaaa', light: '#666666', label: 'Ikonok' },
    '--icon-color-active': { dark: '#ffffff', light: '#000000', label: 'Aktív Ikon' },
    
    '--color-ui-active':   { dark: '#8A2432', light: '#8A2432', label: 'Aktív Gomb/Switch' },
    '--color-ui-active-text': { dark: '#ffffff', light: '#ffffff', label: 'Aktív Gomb Szöveg' },

    // --- TÉRKÉP ELEMEK (Szobák & Falak) ---
    '--color-room':        { dark: '#00897b', light: '#c4fff5', label: 'Szoba Kitöltés' },
    '--color-room-stroke': { dark: '#26a69a', light: '#6aa795', label: 'Szoba Körvonal' },
    '--color-room-text':   { dark: '#ffffff', light: '#000000', label: 'Szoba Felirat' },
    
    '--color-corridor':    { dark: '#444444', light: '#cccccc', label: 'Folyosó Fal' },
    '--color-corridor-fill':{ dark: 'rgba(34, 34, 34, 0.5)', light: 'rgba(0, 0, 0, 0.08)', label: 'Folyosó Kitöltés' },
    
    '--color-outline':     { dark: '#ffffff', light: '#555555', label: 'Épület Körvonal' },
    '--color-floor-fill':  { dark: '#222222', light: '#f5f5f5', label: 'Épület/Padló Kitöltés' }, // ÚJ
    
    '--color-door':        { dark: '#ffffff', light: '#333333', label: 'Ajtók' },
    '--color-highlight':   { dark: '#ffeb3b', light: '#ffab00', label: 'Kijelölés (Highlight)' },

    // --- NAVIGÁCIÓ & POI ---
    '--color-route-primary':   { dark: '#ff1744', light: '#ff1744', label: 'Útvonal (Séta)' },
    '--color-route-secondary': { dark: '#ffeb3b', light: '#f9a825', label: 'Útvonal (Lépcső/Más)' },
    '--color-arrow':           { dark: '#8b0000', light: '#8b0000', label: 'Irányjelző Nyíl' },
    
    '--color-stairs':          { dark: '#2e7d32', light: '#5baa3c', label: 'Lépcső Kitöltés' },
    '--color-stairs-stroke':   { dark: '#2e7d32', light: '#117819', label: 'Lépcső Körvonal' }, // ÚJ
    
    '--color-elevator':        { dark: '#7e57c2', light: '#7e57c2', label: 'Lift Kitöltés' }, // ÚJ (külön)
    '--color-elevator-stroke': { dark: '#7e57c2', light: '#512da8', label: 'Lift Körvonal' }, // ÚJ
    
    '--color-toilet-fill':     { dark: '#0d47a1', light: '#159fce', label: 'WC Kitöltés' },
    '--color-toilet-stroke':   { dark: '#42a5f5', light: '#3f7cad', label: 'WC Körvonal' },
    
    '--color-nav-bg':          { dark: '#4a4458', light: '#e0e0e0', label: 'Nav "Innen" Gomb' },
    '--color-nav-text':        { dark: '#e8def8', light: '#333333', label: 'Nav "Innen" Szöveg' }
};

// === SZÍNTÉMÁK DEFINÍCIÓJA ===
// SET THEMES HERE
const COLOR_THEMES = {
    'default': {
        name: 'Alapértelmezett',
        samples: ['#8A2432', '#00897b', '#ffffff'],
        overrides: { 
            dark: {}, 
            light: {
                '--bg-body': '#ffffff',
                '--bg-surface': '#ffffff',
                '--bg-element': '#e0e0e0',
                '--bg-button-glass': 'rgba(0,0,0,0.05)',
                '--text-main': '#1c1c1e',
                '--text-sub': '#666666',
                '--border-color': '#d1d1d1',
                '--icon-color': '#666666',
                '--icon-color-active': '#000000',
                '--color-ui-active': '#8A2432',
                '--color-ui-active-text': '#ffffff',
                '--color-room': '#c4fff5',
                '--color-room-stroke': '#6aa795',
                '--color-room-text': '#000000',
                '--color-corridor': '#cccccc',
                '--color-corridor-fill': 'rgba(0, 0, 0, 0.08)',
                '--color-outline': '#555555',
                '--color-floor-fill': '#f5f5f5',
                '--color-door': '#333333',
                '--color-highlight': '#ffab00',
                '--color-route-primary': '#ff1744',
                '--color-route-secondary': '#f9a825',
                '--color-arrow': '#8b0000',
                '--color-stairs': '#5baa3c',
                '--color-stairs-stroke': '#117819',
                '--color-elevator': '#7e57c2',
                '--color-elevator-stroke': '#512da8',
                '--color-toilet-fill': '#159fce',
                '--color-toilet-stroke': '#3f7cad',
                '--color-nav-bg': '#e0e0e0',
                '--color-nav-text': '#333333'
            } 
        } 
    },
    'ocean': {
        name: 'Ocean',
        samples: ['#4fc3f7', '#0277bd', '#f50057'],
        overrides: {
            dark: {
                '--color-room': '#0277bd',
                '--color-room-stroke': '#004c8c',
                '--color-toilet-fill': '#006064',
                '--color-toilet-stroke': '#26a69a',
                '--color-stairs': '#00695c',
                '--color-stairs-stroke': '#004d40',
                '--color-route-primary': '#f50057',
                '--color-ui-active': '#4fc3f7',
                '--color-ui-active-text': '#000000'
            },
            light: {
                '--color-room': '#0288d1', 
                '--color-room-stroke': '#01579b',
                '--color-route-primary': '#d81b60',
                '--color-ui-active': '#0288d1',
                '--color-ui-active-text': '#ffffff'
            }
        }
    },
    'nature': {
        name: 'Nature',
        samples: ['#a5d6a7', '#558b2f', '#e65100'],
        overrides: {
            dark: {
                '--color-room': '#558b2f',
                '--color-room-stroke': '#33691e',
                '--color-toilet-fill': '#33691e',
                '--color-toilet-stroke': '#689f38',
                '--color-stairs': '#33691e',
                '--color-stairs-stroke': '#1b5e20',
                '--color-route-primary': '#e65100',
                '--bg-body': '#1b2e1b',
                '--color-ui-active': '#a5d6a7',
                '--color-ui-active-text': '#000000'
            },
            light: {
                '--color-room': '#7cb342',
                '--color-room-stroke': '#558b2f',
                '--color-route-primary': '#ef6c00',
                '--bg-body': '#f1f8e9',
                '--color-ui-active': '#558b2f',
                '--color-ui-active-text': '#ffffff'
            }
        }
    },
    'lover': {
        name: 'Lover',
        samples: ['#ff80ce', '#62bbe3', '#ed9cff'], 
        overrides: {
            dark: {
                // UI & Text
                '--color-ui-active': '#ff80ce',      // A fő pink
                '--color-ui-active-text': '#7d2b47', // Sötétbordó szöveg
                
                // Térkép
                '--color-room': '#ff80ce',
                '--color-room-stroke': '#c5499c',    // Sötétebb pink keret
                
                // WC (Lover Sky Blue)
                '--color-toilet-fill': '#62bbe3',
                '--color-toilet-stroke': '#16a0de',
                
                // Lépcső & Lift (Purple Mist)
                '--color-stairs': '#ed9cff',
                '--color-stairs-stroke': '#b566cc',
                '--color-elevator': '#ed9cff',
                '--color-elevator-stroke': '#b566cc',
                
                // Útvonal
                '--color-route-primary': '#FF1744'
            },
            light: {
                // Light módban picit finomítunk, hogy ne égjen ki a szem fehér háttéren
                '--color-ui-active': '#f06292',
                '--color-ui-active-text': '#ffffff',
                
                '--color-room': '#f8bbd0',           // Pasztell pink
                '--color-room-stroke': '#f06292',
                
                '--color-toilet-fill': '#81d4fa',
                '--color-toilet-stroke': '#29b6f6',
                
                '--color-stairs': '#e1bee7',
                '--color-stairs-stroke': '#ba68c8',
                '--color-elevator': '#e1bee7',
                '--color-elevator-stroke': '#ba68c8'
            }
        }
    },
    'golden': {
        name: 'Golden',
        samples: ['#FBC02D', '#26C6DA', '#FFB74D'],
        overrides: {
            dark: {
                // UI & Text (Fekete szöveg az aranyon, mert úgy olvasható)
                '--color-ui-active': '#FBC02D',
                '--color-ui-active-text': '#000000',
                
                // Térkép
                '--color-room': '#FBC02D',
                '--color-room-stroke': '#c49000',    // Sötét arany/barna keret
                
                // WC (Türkiz kontraszt)
                '--color-toilet-fill': '#26C6DA',
                '--color-toilet-stroke': '#00ACC1',
                
                // Lépcső & Lift (Bronz)
                '--color-stairs': '#FFB74D',
                '--color-stairs-stroke': '#f57c00',
                '--color-elevator': '#FFA726',
                '--color-elevator-stroke': '#e65100',
                
                // Útvonal
                '--color-route-primary': '#D32F2F'
            },
            light: {
                // Light módban az arany maradhat, mert elég sötét sárga
                '--color-ui-active': '#FBC02D',
                '--color-ui-active-text': '#000000',
                
                '--color-room': '#fff176',           // Világosabb sárga fill
                '--color-room-stroke': '#fbc02d',    // Arany keret
                
                '--color-stairs': '#ffcc80',
                '--color-stairs-stroke': '#fb8c00',
                '--color-elevator': '#ffb74d',
                '--color-elevator-stroke': '#f57c00'
            }
        }
    },
    'hacker': {
        name: 'Hacker',
        samples: ['#00FF00', '#FFFFFF', '#000000'],
        overrides: {
            dark: {
                '--bg-body': '#121212',
                '--bg-surface': 'rgba(0, 0, 0, 1)',
                '--bg-element': '#333333',
                '--bg-button-glass': 'rgba(255,255,255,0.1)',
                '--text-main': '#ffffff',
                '--text-sub': '#aaaaaa',
                '--border-color': '#333333',
                '--icon-color': '#aaaaaa',
                '--icon-color-active': '#ffffff',
                '--color-ui-active': 'rgba(0, 255, 20.494345491929458, 1)',
                '--color-ui-active-text': 'rgba(0, 0, 0, 1)',
                '--color-room': 'rgba(0, 0, 0, 1)',
                '--color-room-stroke': 'rgba(9.018592812529494, 255, 0, 1)',
                '--color-room-text': '#ffffff',
                '--color-corridor': '#444444',
                '--color-corridor-fill': 'rgba(34, 34, 34, 0.5)',
                '--color-outline': '#ffffff',
                '--color-floor-fill': 'rgba(0, 0, 0, 1)',
                '--color-door': '#ffffff',
                '--color-highlight': '#ffeb3b',
                '--color-route-primary': '#ff1744',
                '--color-route-secondary': '#ffeb3b',
                '--color-arrow': '#8b0000',
                '--color-stairs': 'rgba(0, 0, 0, 1)',
                '--color-stairs-stroke': '#2e7d32',
                '--color-elevator': 'rgba(0, 0, 0, 1)',
                '--color-elevator-stroke': 'rgba(137.15401172403398, 69.56587138928865, 255, 1)',
                '--color-toilet-fill': 'rgba(0, 0, 0, 1)',
                '--color-toilet-stroke': '#42a5f5',
                '--color-nav-bg': '#4a4458',
                '--color-nav-text': '#e8def8'
            },
            light: {
                '--bg-body': '#121212',
                '--bg-surface': 'rgba(0, 0, 0, 1)',
                '--bg-element': '#333333',
                '--bg-button-glass': 'rgba(255,255,255,0.1)',
                '--text-main': '#ffffff',
                '--text-sub': '#aaaaaa',
                '--border-color': '#333333',
                '--icon-color': '#aaaaaa',
                '--icon-color-active': '#ffffff',
                '--color-ui-active': 'rgba(0, 255, 20.494345491929458, 1)',
                '--color-ui-active-text': 'rgba(0, 0, 0, 1)',
                '--color-room': 'rgba(255, 255, 255, 1)',
                '--color-room-stroke': 'rgba(9.018592812529494, 255, 0, 1)',
                '--color-room-text': 'rgba(0, 0, 0, 1)',
                '--color-corridor': 'rgba(67.99999999999997, 67.99999999999997, 67.99999999999997, 0.4)',
                '--color-corridor-fill': 'rgba(33.999999999999986, 33.999999999999986, 33.999999999999986, 0.15)',
                '--color-outline': '#ffffff',
                '--color-floor-fill': 'rgba(0, 0, 0, 1)',
                '--color-door': '#ffffff',
                '--color-highlight': 'rgba(0, 255, 0, 1)',
                '--color-route-primary': '#ff1744',
                '--color-route-secondary': '#ffeb3b',
                '--color-arrow': '#8b0000',
                '--color-stairs': 'rgba(255, 255, 255, 1)',
                '--color-stairs-stroke': '#2e7d32',
                '--color-elevator': 'rgba(255, 255, 255, 1)',
                '--color-elevator-stroke': 'rgba(137.15401172403398, 69.56587138928865, 255, 1)',
                '--color-toilet-fill': 'rgba(255, 255, 255, 1)',
                '--color-toilet-stroke': '#42a5f5',
                '--color-nav-bg': '#4a4458',
                '--color-nav-text': '#e8def8'
            }
        }
    }
};

// Felhasználó egyéni beállításai (LocalStorage-ből jön majd)
let CUSTOM_THEME_OVERRIDES = JSON.parse(localStorage.getItem('custom_theme_overrides')) || {};

// SETTINGS BŐVÍTÉS
const APP_SETTINGS = {
    elevatorMode: localStorage.getItem('pref_elevator') || 'balanced',
    toiletMode: localStorage.getItem('pref_toilet') || 'all',
    toiletAccessible: localStorage.getItem('pref_toilet_acc') === 'true',
    themeMode: localStorage.getItem('pref_theme') || 'system', 
    activeColorTheme: localStorage.getItem('pref_color_theme') || 'default',
    language: localStorage.getItem('pref_language') || (typeof i18n !== 'undefined' ? i18n.currentLanguage : 'hu')
};

/**
 * Visszaadja az aktuálisan érvényesülő témamódot ('dark' vagy 'light').
 * Ha a beállítás 'system' (vagy 'auto'), lekérdezi az operációs rendszer / böngésző preferenciáját.
 * @returns {'dark' | 'light'}
 */
function getEffectiveThemeMode() {
    const mode = APP_SETTINGS.themeMode;
    if (mode === 'system' || !mode || mode === 'auto') {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return 'dark'; // Fallback
    }
    return mode === 'light' ? 'light' : 'dark';
}

// MAP STYLES (OpenFreeMap vector styles - no API key, unlimited)
const MAP_STYLES = {
    dark: 'https://tiles.openfreemap.org/styles/dark',
    light: 'https://tiles.openfreemap.org/styles/positron'
};
const TILE_LAYERS = MAP_STYLES; // Visszafelé kompatibilitási hivatkozás

// === KATEGÓRIA FORDÍTÁSI SZÓTÁR ===
const TYPE_DICT = {
    'toilets': 'Mosdó', 'toilet': 'Mosdó', 'wc': 'WC', 'restroom': 'Mosdó',
    'steps': 'Lépcső', 'staircase': 'Lépcsőház', 'stairs': 'Lépcső',
    'elevator': 'Lift',
    'corridor': 'Folyosó',
    'room': 'Terem', 'classroom': 'Tanterem', 'auditorium': 'Előadó',
    'buffet': 'Büfé', 'kitchen': 'Konyha',
    'entrance': 'Bejárat', 'door': 'Ajtó',
    'library': 'Könyvtár',
    'area': 'Terület',
    'vending_machine': 'Automata',
    'cafe': 'Büfé',
    'fast_food': 'Gyorsétterem',
    'restaurant': 'Étterem',
    'kiosk': 'Büfé',
    'microwave': 'Mikró',
    'atm': 'ATM',
    'shop': 'Bolt'
};

// === MIGRÁCIÓ: Korábbi localStorage épületadatok kitakarítása ===
(function _cleanupLegacyLocalStorageCache() {
    try {
        const prefix = "bmemap_data_";
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        localStorage.removeItem('pref_cache_enabled');
    } catch(e) {}
})();

/**
 * Formáz egy bájtokban megadott adatmennyiséget olvasható formátumba (B, KB, MB).
 * @param {number} bytes - A méret bájtokban.
 * @returns {string} Pl. "1.2 MB"
 */
function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Lekéri a Service Worker Cache Storage becsült méretét bájtokban.
 * Elsődlegesen a modern navigator.storage.estimate API-t használja.
 * @returns {Promise<number>}
 */
async function getCacheSize() {
    if (navigator.storage && navigator.storage.estimate) {
        try {
            const estimate = await navigator.storage.estimate();
            if (estimate && typeof estimate.usage === 'number' && estimate.usage > 0) {
                return estimate.usage;
            }
        } catch (e) {}
    }
    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            let total = 0;
            for (const key of keys) {
                const cache = await caches.open(key);
                const reqs = await cache.keys();
                for (const req of reqs) {
                    const res = await cache.match(req);
                    if (res) {
                        const blob = await res.blob();
                        total += blob.size;
                    }
                }
            }
            return total;
        } catch (e) {}
    }
    return 0;
}

/**
 * Frissíti a gyorsítótár méretének kijelzését a Beállítások felületen.
 */
async function updateCacheSizeDisplay() {
    const el = document.getElementById('cache-size-display');
    if (!el) return;
    try {
        const bytes = await getCacheSize();
        el.innerText = formatBytes(bytes);
        el.style.display = 'inline-block';
    } catch (e) {
        el.innerText = '0 B';
        el.style.display = 'inline-block';
    }
}

/**
 * Törli az összes alkalmazáshoz tartozó gyorsítótárat (Service Worker Cache Storage).
 * A művelet végrehajtása előtt megerősítést kér a felhasználótól.
 */
async function clearAllCache() {
    if (!confirm(typeof t === 'function' ? (t('alerts.confirm_clear_cache') || "Biztosan törlöd a mentett térképeket?") : "Biztosan törlöd a mentett térképeket?")) return;
    
    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
    } catch (e) {
        console.warn("Hiba a gyorsítótár törlésekor:", e);
    }
    await updateCacheSizeDisplay();
    showToast(typeof t === 'function' ? t('toasts.cache_cleared') : "Sikeres nagytakarítás! 🧹");
}

/**
 * A felhasználó kedvenc helyeinek listája.
 * Betölti a mentett adatokat a helyi tárolóból (localStorage), vagy inicializál 
 * egy üres tömböt, amennyiben nincsenek korábban mentett kedvencek.
 * @type {Array<Object>}
 */
let userFavorites = JSON.parse(localStorage.getItem('bme_favorites')) || [];

/**
 * Szinkronizálja az aktuális kedvencek listáját (userFavorites) a böngésző
 * helyi tárolójával (localStorage) JSON formátumban.
 */
function saveFavorites() {
    localStorage.setItem('bme_favorites', JSON.stringify(userFavorites));
}

/**
 * Megvizsgálja, hogy a paraméterként átadott térképelem szerepel-e a felhasználó
 * elmentett kedvencei között az egyedi azonosítója (id) alapján.
 * * @param {Object} feature - A vizsgálandó GeoJSON térképelem.
 * @returns {boolean} Igaz (true) értékkel tér vissza, ha a megadott elem a kedvencek között van, ellenkező esetben hamis (false).
 */
function isFavorite(feature) {
    if (!feature || !feature.id) return false;
    return userFavorites.some(fav => fav.id === feature.id);
}

/**
 * Hozzáadja a jelenleg kiválasztott térképelemet (selectedFeature) a 
 * kedvencek listájához, vagy eltávolítja onnan, ha már szerepel benne.
 * A művelet során kinyeri az elem szükséges metaadatait (név, típus, szint, épület),
 * majd frissíti a helyi tárolót, a felhasználói felületet (UI), és újrarendereli az érintett szintet.
 */
function toggleFavoriteCurrent() {
    if (!selectedFeature) return;
    
    const id = selectedFeature.id; 
    const p = selectedFeature.properties;
    
    // Név meghatározása: elsődlegesen a 'name' vagy 'ref' tulajdonság alapján.
    let name = p.name || p.ref;
    
    // Ha nem rendelkezik saját névvel, a típusát (pl. "Mosdó") használjuk megnevezésként.
    if (!name) {
        name = (typeof getHungarianType === 'function') ? getHungarianType(p) : "Névtelen hely";
    }
    
    // A helyiség típusának és szintjének meghatározása a mentéshez.
    const type = p.room || p.indoor || p.amenity || 'Hely';
    const level = getLevelsFromFeature(selectedFeature)[0] || "0";

    if (isFavorite(selectedFeature)) {
        // Eltávolítás a kedvencek listájából az azonosító (id) alapján.
        userFavorites = userFavorites.filter(fav => fav.id !== id);
        showToast(typeof t === 'function' ? t('toasts.fav_removed') : "Eltávolítva a kedvencekből! 🗑️");
    } else {
        // Új bejegyzés hozzáadása a kedvencekhez az összegyűjtött adatokkal.
        userFavorites.push({ 
            id: id, 
            name: name, 
            type: type, 
            level: level,
            building: currentBuildingKey 
        });
        showToast(typeof t === 'function' ? t('toasts.fav_added') : "Hozzáadva a kedvencekhez! ⭐");
    }
    
    // Változások perzisztens mentése és a nézetek (UI, térkép) frissítése.
    saveFavorites();
    updateFavoriteUI(); 
    renderLevel(currentLevel, false); 
}

/**
 * Segédfüggvény POI kategória nevének többnyelvű lekéréséhez
 */
function getPoiName(key) {
    if (typeof t === 'function') {
        const trans = t(`poi.${key}`);
        if (trans && trans !== `poi.${key}`) return trans;
    }
    return (POI_TYPES && POI_TYPES[key]) ? POI_TYPES[key].name : key;
}

/**
 * Frissíti a kedvencek gomb (csillag ikon) vizuális állapotát a felhasználói felületen.
 * Megvizsgálja, hogy a jelenleg kiválasztott térképelem szerepel-e a kedvencek között,
 * és ennek megfelelően módosítja a gomb CSS osztályait.
 */
function updateFavoriteUI() {
    const btn = document.getElementById('btn-favorite');
    
    if (!selectedFeature) return;
    
    if (isFavorite(selectedFeature)) {
        // Aktív állapot beállítása: a gomb megkapja a kiemelést.
        btn.classList.add('active');
        btn.querySelector('span').innerText = 'star'; // Teli csillag (ha a font támogatja a fill-t)
    } else {
        // Inaktív állapot beállítása: a kiemelés eltávolítása.
        btn.classList.remove('active');
        btn.querySelector('span').innerText = 'star'; // Üres csillag
    }
}

/**
 * Megjeleníti a POI rácsot és a mentett kedvencek listáját a keresőmező lenyíló találati listájában.
 * Csak akkor aktiválódik, ha a keresőmező teljesen üres.
 */
function showFavoritesInSearch() {
    const input = document.getElementById('search-input');
    
    // Ha a felhasználó már elkezdett gépelni valamit, nem írjuk felül a keresési eredményeket.
    if (input.value.trim() !== "") return; 
    
    _searchSelectedIndex = -1;
    _searchUserNavigated = false;
    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = ''; // A találati lista előzetes ürítése
    
    // --- 1. POI GRID (Gyorskeresés) LÉTREHOZÁSA ---
    if (typeof POI_TYPES !== 'undefined') {
        const poiGrid = document.createElement('div');
        poiGrid.className = 'poi-grid-container';
        
        // Végigiterálunk a POI kategóriákon és legeneráljuk a gombokat
        for (const [key, config] of Object.entries(POI_TYPES)) {
            if (config.hideInGrid) continue; // Rejtett kategóriák átugrása
            const btn = document.createElement('div');
            btn.className = 'poi-grid-item';
            const poiDisplayName = getPoiName(key);
            btn.innerHTML = `
                <div class="poi-grid-icon" style="background-color: ${config.color}">
                    <span class="material-symbols-outlined">${config.icon}</span>
                </div>
                <span class="poi-grid-label">${poiDisplayName}</span>
            `;
            
            // Kattintás esemény a kategóriára
            btn.onclick = () => {
                // Eltüntetjük a lenyíló menüt
                resultsDiv.style.display = 'none';
                
                // Beírjuk a keresőbe a kategória nevét, hogy egyértelmű legyen, mit nézünk
                input.value = poiDisplayName;
                updateRightButtonState(); // X gomb megjelenítése
                
                // Mobilon levesszük a fókuszt a keresőről, hogy eltűnjön a billentyűzet
                input.blur(); 
                
                // Elindítjuk a térképi POI keresést és a kameramozgást
                showPoiCategory(key);
            };
            
            poiGrid.appendChild(btn);
        }
        resultsDiv.appendChild(poiGrid);
    }

    // --- 2. KEDVENCEK LISTÁJÁNAK HOZZÁADÁSA ---
    if (userFavorites.length > 0) {
        // Fejléc (szekció cím) létrehozása a kedvencekhez
        const header = document.createElement('div');
        header.className = 'result-item';
        header.style.color = '#aaa'; 
        header.style.cursor = 'default';
        header.style.fontSize = '12px';
        header.style.paddingTop = '12px'; // Kicsi extra hely a rács alatt
        header.innerText = (typeof t === 'function' ? t('sheet.favorite_title') : "KEDVENCEK").toUpperCase();
        resultsDiv.appendChild(header);

        // Végigiterálunk a felhasználó kedvencein
        userFavorites.forEach(fav => {
            const div = document.createElement('div');
            div.className = 'result-item';
            const favSub = typeof t === 'function' 
                ? t('search.fav_sub', { building: escapeHTML(fav.building), level: escapeHTML(fav.level) })
                : `(${escapeHTML(fav.building)} épület, ${escapeHTML(fav.level)}. szint)`;
            div.innerHTML = `<span class="material-symbols-outlined fav-icon" style="color:#ffd700">star</span> ${escapeHTML(fav.name)} <span style="color:#888; font-size:12px">${favSub}</span>`;
            
            // Kattintás eseménykezelője az adott kedvenc kiválasztásához
            div.onclick = () => {
                if (fav.building !== currentBuildingKey) {
                    changeBuilding(fav.building);
                }
                
                // Megkeressük az elemet
                const target = geoJsonData.features.find(f => f.id === fav.id);
                if (target) {
                    openSheet(target);
                    resultsDiv.style.display = 'none';
                    document.getElementById('search-input').value = fav.name;
                    updateRightButtonState();
                } else {
                    alert(typeof t === 'function' ? t('alerts.place_not_found') : "Ez a hely ebben az épületben nem található (vagy még nem töltött be).");
                }
            };
            div.addEventListener('mouseenter', () => {
                const currentItems = _getSelectableSearchResults();
                _searchSelectedIndex = currentItems.indexOf(div);
                _searchUserNavigated = true;
                _updateSearchSelection(currentItems);
            });
            resultsDiv.appendChild(div);
        });
    }
    
    // A teljes találati lista megjelenítése
    resultsDiv.style.display = 'block';
}

/**
 * Meghatározza és lefordítja egy adott térképelem (feature) típusát
 * az OpenStreetMap-hez hasonló tulajdonságcímkék (tagek) alapján.
 * @param {Object} p - A térképelem tulajdonságait (properties) tartalmazó objektum.
 * @returns {string} A helyiség vagy elem megnevezése (szótár alapján), vagy alapértelmezetten "Hely".
 */
function getHungarianType(p) {
    if (p.entrance === 'main') return typeof t === 'function' ? (t('types.main_entrance') || 'Főbejárat') : 'Főbejárat';
    if (p.entrance) return typeof t === 'function' ? (t('types.entrance') || 'Bejárat') : 'Bejárat';
    if (p.door) return typeof t === 'function' ? (t('types.door') || 'Ajtó') : 'Ajtó';
    const key = p.room || p.indoor || p.amenity || p.highway || 'unknown';
    if (typeof t === 'function') {
        const trans = t(`types.${key}`);
        if (trans && trans !== `types.${key}`) return trans;
    }
    return TYPE_DICT[key] || (key !== 'unknown' ? key : (typeof t === 'function' ? (t('types.place') || 'Hely') : 'Hely'));
}

/**
 * Felhasználói felületen (UI) megjelenő súgószövegek a különböző 
 * útvonaltervezési és navigációs preferenciákhoz (pl. lift vagy lépcső használata).
 * @constant {Object}
 */
const HINTS = {
    'stairs': "Csak akkor lift, ha nincs más út.",
    'balanced': "Alapértelmezett: Lépcső preferálása rövid távon.",
    'elevator': "Lehetőleg mindig lift.",
    'wheelchair': "Kerekeszékkel járható útvonal."
};

function getElevatorHint(mode) {
    if (typeof t === 'function') {
        const trans = t(`hints.${mode}`);
        if (trans && trans !== `hints.${mode}`) return trans;
    }
    return HINTS[mode] || "";
}

// --- GLOBÁLIS ÁLLAPOTVÁLTOZÓK ---

/** Az aktuálisan betöltött és vizsgált épület azonosítója (pl. "K"). */
let currentBuildingKey = "K"; 
/** Az aktuális épület konfigurációs objektuma a BUILDINGS listából. */
let currentBuilding = BUILDINGS[currentBuildingKey];

/** Ideiglenesen tárolt indulási pont, amikor a felhasználó a "Hova mész innen?" funkciót használja. */
let pendingNavSource = null;
/** Automatikus keresési kifejezés, amelyet épületváltás után azonnal végre kell hajtani. */
let pendingSearchTerm = null;
/** Automatikus célelem azonosító (feature ID), amelyet épületváltás után közvetlenül meg kell nyitni. */
let pendingTargetId = null;
/** Globális keresési index a campus összes épületének termeivel. */
let globalSearchIndex = null;
let isSearchIndexLoading = false;

/** Az aktív útvonaltervezés alapadatait tartalmazó objektum (kezdő és cél térképelemek). */
let activeRouteData = null; // { start: feature/null, end: feature }
/** A kiszámolt útvonalat alkotó pontok (gráf csomópontok) nyers kulcsainak tömbje. */
let currentRoutePath = []; 

/** Az aktuális navigáció kiindulópontja (feature objektum). */
let activeNavSource = null;
/** Az aktuális navigáció célpontja (feature objektum). */
let activeNavTarget = null;



// --- POI RENDSZER GLOBÁLIS VÁLTOZÓI ---
let poiMarkersGroup; // Ebben tároljuk majd a térképen lévő aktív ikonokat

let activePoiCategory = null; // Tárolja, hogy épp milyen POI-kat jelenítünk meg a térképen

const POI_TYPES = {
    coffee: {
        id: 'coffee',
        name: 'Kávéautomata',
        icon: 'local_cafe',
        color: 'var(--poi-coffee)',
        aliases: ['kávé', 'kave', 'kávéautomata', 'kaveautomata'],
        filter: (p) => p.amenity === 'vending_machine' && p.vending && p.vending.includes('coffee')
    },
    food: {
        id: 'food',
        name: 'Büfé / Kaja',
        icon: 'restaurant',
        color: 'var(--poi-food)',
        aliases: ['büfé', 'bufe', 'kaja', 'étterem', 'etterem', 'kifőzde', 'pékség'],
        filter: (p) => p.amenity === 'cafe' || p.amenity === 'fast_food' || p.amenity === 'restaurant' || p.shop === 'kiosk'
    },
    vending: {
        id: 'vending',
        name: 'Automata',
        icon: 'water_bottle',
        color: 'var(--poi-vending)',
        aliases: ['automata', 'snack', 'italautomata', 'csoki', 'innivaló', 'ital'],
        filter: (p) => p.amenity === 'vending_machine' && p.vending && (p.vending.includes('drinks') || p.vending.includes('sweets') || p.vending.includes('snack') || p.vending.includes('food'))
    },
    microwave: {
        id: 'microwave',
        name: 'Mikró',
        icon: 'microwave',
        color: 'var(--poi-microwave)',
        aliases: ['mikró', 'mikro', 'melegítő', 'mikrohullámú'],
        // Megtalálja az amenity=microwave-et ÉS a konyhába/büfébe integrált mikrókat is (microwave=yes)
        filter: (p) => p.amenity === 'microwave' || p.microwave === 'yes'
    },
    atm: {
        id: 'atm',
        name: 'ATM',
        icon: 'local_atm',
        color: 'var(--poi-atm)',
        aliases: ['atm', 'bankautomata', 'pénz', 'készpénz'],
        filter: (p) => p.amenity === 'atm'
    },
    toilet: {
        id: 'toilet',
        name: 'WC',
        icon: 'wc',
        color: 'var(--color-toilet-fill)',
        aliases: ['wc', 'vécé', 'mosdó', 'toalett', 'toilet', 'budi'],
        filter: (p) => {
            const isToilet = p.amenity === 'toilets' || p.amenity === 'toilet' || p.room === 'toilet' || p.room === 'toilets' || (p.name && p.name.toLowerCase().includes('wc'));
            if (!isToilet) return false;
            
            // Ha az akadálymentes mód aktív, csak a 'wheelchair=yes' taggel ellátott mosdók jelennek meg
            if (typeof APP_SETTINGS !== 'undefined' && APP_SETTINGS.toiletAccessible && p.wheelchair !== 'yes') return false;
            
            return true;
        }
    },
    // --- REJTETT KATEGÓRIÁK A KERESŐHÖZ ---
    stairs: {
        id: 'stairs',
        name: 'Lépcső',
        icon: 'stairs',
        color: 'var(--color-stairs)',
        hideInGrid: true, // Nem jelenik meg a vizuális rácsokban
        aliases: ['lépcső', 'lepcso', 'lépcsőház', 'stairs'],
        filter: (p) => p.highway === 'steps' || p.room === 'stairs' || p.indoor === 'staircase' || p.room === 'staircase'
    },
    elevator: {
        id: 'elevator',
        name: 'Lift',
        icon: 'elevator',
        color: 'var(--color-elevator)',
        hideInGrid: true, // Nem jelenik meg a vizuális rácsokban
        aliases: ['lift', 'felvonó', 'elevator'],
        filter: (p) => p.highway === 'elevator' || p.room === 'elevator' || p.amenity === 'elevator'
    }
};


/**
 * A térkép nézetét (kameráját) az aktív navigáció kezdő- vagy végpontjára fókuszálja.
 * Automatikusan a megfelelő szintre vált, elmozdítja a kamerát az adott pontra,
 * és a célpont esetében vizuális kiemelést (highlight) is alkalmaz.
 * @param {string} type - A fókuszálás célpontjának típusa ('start' az induláshoz, 'end' az érkezéshez).
 */
function focusOnEndpoint(type) {
    // A kívánt célpont kiválasztása a paraméter alapján
    const target = (type === 'start') ? activeNavSource : activeNavTarget;
    
    if (target) {
        // 1. Szintváltás (ha a kiválasztott elemhez tartozik szintinformáció)
        const levels = getLevelsFromFeature(target);
        if (levels.length > 0) {
            switchLevel(levels[0]);
        }
        
        // 2. Kameramozgatás: a térkép az elem koordinátáira navigál
        smartFlyTo(target);

        // 3. Vizuális kiemelés (Highlight) kezelése
        // A kiemelést kizárólag a célpontnál alkalmazzuk, a kezdőpontnál 
        // (amely gyakran csak egy virtuális koordináta) ez zavaró lehet.
        if (type === 'end') {
            // A kiemelés kirajzolása anélkül, hogy megnyitná a részletező panelt (sheet)
            drawSelectedHighlight(target);
        }
    }
}

const PRECISION = 6;

/**
 * A MapLibre GL JS térképpéldány inicializálása és konfigurálása.
 * @type {maplibregl.Map}
 */
const map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLES[getEffectiveThemeMode()] || MAP_STYLES.dark,
    center: [currentBuilding.center[1], currentBuilding.center[0]], // MapLibre: [lon, lat]!
    zoom: currentBuilding.zoom,
    attributionControl: false,
    dragRotate: true,
    pitchWithRotate: false,
    bearingSnap: 20,
    maxZoom: 22
});

// Attribution hozzáadása manuálisan (jobb alsó sarok)
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

// Forgatás engedélyezése 2 ujjal és Ctrl + egérhúzással
// Automatikus igazítás (snapping) 0°, 90°, 180°, -90° irányokba forgatás után
let _bearingSnapTimer = null;
let _isBearingSnapping = false;

// Ha a felhasználó bármilyen interakcióba kezd, azonnal leállítjuk a futó snap animációt
['dragstart', 'rotatestart', 'touchstart'].forEach(evt => {
    map.on(evt, () => {
        if (_bearingSnapTimer) { clearTimeout(_bearingSnapTimer); _bearingSnapTimer = null; }
        if (_isBearingSnapping) { map.stop(); _isBearingSnapping = false; }
    });
});

map.on('rotateend', () => {
    // Ha folyamatban lévő snap animáció fejeződik be, nem indítunk újat
    if (_isBearingSnapping) { _isBearingSnapping = false; return; }
    
    // Debounce: rövid várakozás, hogy az ujjak elengedésével járó mikro-forgatások lecsengjenek
    if (_bearingSnapTimer) clearTimeout(_bearingSnapTimer);
    _bearingSnapTimer = setTimeout(() => {
        _bearingSnapTimer = null;
        const bearing = map.getBearing();
        const snapAngles = [0, 90, 180, -90, -180];
        const threshold = 15;
        
        for (const target of snapAngles) {
            if (Math.abs(bearing - target) < threshold && Math.abs(bearing - target) > 0.1) {
                _isBearingSnapping = true;
                map.easeTo({ bearing: target, duration: 250, easing: t => t * (2 - t) });
                break;
            }
        }
    }, 80);
});

/**
 * Eseményfigyelő regisztrálása a térkép nagyítási műveletének befejezésére ('zoomend').
 * Minden egyes zoomolás után frissíti a térképen lévő dinamikus elemek 
 * láthatóságát a megfelelő részletességi szint (LOD) fenntartása érdekében.
 */
let _zoomVisibilityRaf = null;

function requestDynamicVisibilityUpdate() {
    if (_zoomVisibilityRaf) return;
    _zoomVisibilityRaf = requestAnimationFrame(() => {
        updateDynamicVisibility();
        _zoomVisibilityRaf = null;
    });
}

map.on('zoom', function() {
    requestDynamicVisibilityUpdate();
});

map.on('zoomend', function() {
    if (_zoomVisibilityRaf) {
        cancelAnimationFrame(_zoomVisibilityRaf);
        _zoomVisibilityRaf = null;
    }
    updateDynamicVisibility();      
});

/**
 * Frissíti a térkép DOM elemeinek CSS változóit az aktuális nagyítási szint (zoom) alapján.
 */
function updateDynamicVisibility() {
    const zoom = map.getZoom();

    // 1. Ikonok és POI-k skálázása (Eredeti 18.5 küszöbérték)
    let iconScale = (zoom - 18.5) / (20.5 - 18.5);
    if (iconScale < 0) iconScale = 0;
    if (iconScale > 1) iconScale = 1;
    iconScale = Math.sin(iconScale * Math.PI / 2);

    let poiScale = (zoom - 18.0) / (20.0 - 18.0);
    if (poiScale < 0) poiScale = 0;
    if (poiScale > 1) poiScale = 1;
    poiScale = Math.sin(poiScale * Math.PI / 2);

    // 2. Feliratok láthatósága és szöveg mérete (Eredeti 18.5 küszöbérték)
    let labelOpacity = (zoom - 18.5) / (19.0 - 18.5);
    if (labelOpacity < 0) labelOpacity = 0;
    if (labelOpacity > 1) labelOpacity = 1;

    let displayShort = 'none', displayMid = 'none', displayFull = 'none';
    let fontSize = '10px';

    if (zoom >= 20.5) {
        displayFull = 'block';
        fontSize = '12px';
    } else if (zoom >= 19.5) {
        displayMid = 'block';
        fontSize = '11px';
    } else if (zoom >= 18.5) {
        displayShort = 'block';
        fontSize = '10px';
    }

    const root = document.documentElement;
    root.style.setProperty('--dynamic-icon-scale', iconScale);
    root.style.setProperty('--dynamic-poi-scale', poiScale);
    root.style.setProperty('--dynamic-icon-opacity', iconScale < 0.05 ? 0 : iconScale);
    
    root.style.setProperty('--dynamic-label-opacity', labelOpacity < 0.05 ? 0 : labelOpacity);
    root.style.setProperty('--dynamic-label-size', fontSize);
    
    root.style.setProperty('--display-label-short', displayShort);
    root.style.setProperty('--display-label-mid', displayMid);
    root.style.setProperty('--display-label-full', displayFull);
}

let _mapLayersInitialized = false;
let _mapEventsInitialized = false;
let _currentMapStyleMode = getEffectiveThemeMode();

// Globális tárolók a MapLibre Marker objektumoknak
let _routeMarkers = [];
let _arrowMarkers = [];
let _poiMarkers = [];
let _favoriteMarkers = [];
let _roomIconMarkers = [];
let _roomLabelMarkers = [];

function _clearRouteMarkers() {
    _routeMarkers.forEach(({ marker }) => marker.remove());
    _routeMarkers = [];
}

function _clearArrowMarkers() {
    _arrowMarkers.forEach(({ marker }) => marker.remove());
    _arrowMarkers = [];
}

function _clearPoiMarkers() {
    _poiMarkers.forEach(m => m.remove());
    _poiMarkers = [];
}

function _clearFavoriteMarkers() {
    _favoriteMarkers.forEach(m => m.remove());
    _favoriteMarkers = [];
}

function _clearRoomIconMarkers() {
    _roomIconMarkers.forEach(m => m.remove());
    _roomIconMarkers = [];
}

function _clearRoomLabelMarkers() {
    _roomLabelMarkers.forEach(m => m.remove());
    _roomLabelMarkers = [];
}

function _resetMapPadding() {
    if (_mapLayersInitialized && map) {
        try {
            const container = map.getContainer();
            if (container && typeof map.unproject === 'function' && typeof map.jumpTo === 'function') {
                const centerLngLat = map.unproject([container.clientWidth / 2, container.clientHeight / 2]);
                map.jumpTo({
                    center: centerLngLat,
                    padding: { top: 0, bottom: 0, left: 0, right: 0 }
                });
                return;
            }
        } catch (e) {
            console.warn("Silent padding reset error:", e);
        }
        if (typeof map.setPadding === 'function') {
            map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
        }
    }
}

function _initMapSources() {
    map.addSource('indoor-geojson', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
    
    map.addSource('route-geojson', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
    
    map.addSource('highlight-geojson', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
    
    map.addSource('labels-geojson', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
}

function _initMapLayers() {
    const cs = () => getComputedStyle(document.documentElement);
    const get = (v) => cs().getPropertyValue(v).trim();
    
    // 1. PADLÓ / FAL (floor-fill)
    map.addLayer({
        id: 'floor-fill', type: 'fill', source: 'indoor-geojson',
        filter: ['all',
            ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
            ['any', ['==', ['get', 'indoor'], 'level'], ['has', 'building:part'], ['==', ['get', 'indoor'], 'wall'], ['has', 'building']]
        ],
        paint: { 'fill-color': get('--color-floor-fill'), 'fill-opacity': 0.1 }
    });
    map.addLayer({
        id: 'floor-outline', type: 'line', source: 'indoor-geojson',
        filter: ['any', ['==', ['get', 'indoor'], 'level'], ['has', 'building:part']],
        paint: { 'line-color': get('--color-outline'), 'line-width': 1 }
    });
    
    // 2. FOLYOSÓK
    map.addLayer({
        id: 'corridor-fill', type: 'fill', source: 'indoor-geojson',
        filter: ['all',
            ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
            ['==', ['get', 'indoor'], 'corridor']
        ],
        paint: { 'fill-color': get('--color-corridor-fill'), 'fill-opacity': 1 }
    });
    map.addLayer({
        id: 'corridor-line', type: 'line', source: 'indoor-geojson',
        filter: ['==', ['get', 'highway'], 'corridor'],
        paint: { 'line-color': get('--color-corridor'), 'line-width': 4, 'line-opacity': 0.5 }
    });
    
    // 3. SZOBÁK
    map.addLayer({
        id: 'room-fill', type: 'fill', source: 'indoor-geojson',
        filter: ['all', 
            ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
            ['!', ['any', ['==',['get','indoor'],'level'], ['has','building:part'], ['==',['get','indoor'],'wall'], ['has','building'], ['==',['get','indoor'],'corridor'], ['==',['get','highway'],'corridor'], ['==',['get','room'],'toilet'], ['==',['get','room'],'toilets'], ['==',['get','amenity'],'toilets'], ['==',['get','room'],'stairs'], ['==',['get','indoor'],'staircase'], ['==',['get','highway'],'steps'], ['==',['get','highway'],'elevator'], ['==',['get','room'],'elevator']]],
            ['!', ['any', ['has', 'entrance'], ['has', 'door']]]
        ],
        paint: { 'fill-color': get('--color-room'), 'fill-opacity': 0.5 }
    });
    map.addLayer({
        id: 'room-stroke', type: 'line', source: 'indoor-geojson',
        filter: ['all', 
            ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
            ['!', ['any', ['==',['get','indoor'],'level'], ['has','building:part'], ['==',['get','indoor'],'wall'], ['has','building'], ['==',['get','indoor'],'corridor'], ['==',['get','highway'],'corridor'], ['==',['get','room'],'toilet'], ['==',['get','room'],'toilets'], ['==',['get','amenity'],'toilets'], ['==',['get','room'],'stairs'], ['==',['get','indoor'],'staircase'], ['==',['get','highway'],'steps'], ['==',['get','highway'],'elevator'], ['==',['get','room'],'elevator']]],
            ['!', ['any', ['has', 'entrance'], ['has', 'door']]]
        ],
        paint: { 'line-color': get('--color-room-stroke'), 'line-width': 1.5 }
    });
    
    // 4. MOSDÓK (toilet-fill)
    map.addLayer({
        id: 'toilet-fill', type: 'fill', source: 'indoor-geojson',
        filter: ['all',
            ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
            ['any', ['==',['get','room'],'toilet'], ['==',['get','room'],'toilets'], ['==',['get','amenity'],'toilets']]
        ],
        paint: { 'fill-color': get('--color-toilet-fill'), 'fill-opacity': 0.9 }
    });
    map.addLayer({
        id: 'toilet-stroke', type: 'line', source: 'indoor-geojson',
        filter: ['any', ['==',['get','room'],'toilet'], ['==',['get','room'],'toilets'], ['==',['get','amenity'],'toilets']],
        paint: { 'line-color': get('--color-toilet-stroke'), 'line-width': 2 }
    });
    
    // 5. LÉPCSŐK
    map.addLayer({
        id: 'stairs-fill', type: 'fill', source: 'indoor-geojson',
        filter: ['all',
            ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
            ['any', ['==',['get','room'],'stairs'], ['==',['get','indoor'],'staircase'], ['==',['get','highway'],'steps']]
        ],
        paint: { 'fill-color': get('--color-stairs'), 'fill-opacity': 0.6 }
    });
    map.addLayer({
        id: 'stairs-stroke', type: 'line', source: 'indoor-geojson',
        filter: ['any', ['==',['get','room'],'stairs'], ['==',['get','indoor'],'staircase'], ['==',['get','highway'],'steps']],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
            'line-color': get('--color-stairs-stroke'),
            'line-width': ['case', ['==', ['geometry-type'], 'LineString'], 2.5, 1]
        }
    });
    
    // 6. LIFTEK
    map.addLayer({
        id: 'elevator-fill', type: 'fill', source: 'indoor-geojson',
        filter: ['all',
            ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
            ['any', ['==',['get','highway'],'elevator'], ['==',['get','room'],'elevator']]
        ],
        paint: { 'fill-color': get('--color-elevator'), 'fill-opacity': 0.6 }
    });
    map.addLayer({
        id: 'elevator-stroke', type: 'line', source: 'indoor-geojson',
        filter: ['any', ['==',['get','highway'],'elevator'], ['==',['get','room'],'elevator']],
        paint: { 'line-color': get('--color-elevator-stroke'), 'line-width': 1 }
    });
    
    // 7. AJTÓK (circle) - Dinamikus opacitás és méretezés zoom szinttől függően
    map.addLayer({
        id: 'door-circle', type: 'circle', source: 'indoor-geojson',
        filter: ['any', ['has','entrance'], ['has','door']],
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 18.5, 1.5, 20.5, 3],
            'circle-color': '#000000',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 18.5, 0, 19, 0.4, 20.5, 1],
            'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 18.5, 0, 19, 0.4, 20.5, 1]
        }
    });
    
    // 8. KIJELÖLÉS (highlight) – kontúr
    map.addLayer({
        id: 'highlight-line', type: 'line', source: 'highlight-geojson',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': get('--color-highlight'), 'line-width': 5, 'line-opacity': 0.8 }
    });
    
    // 9. ÚTVONAL
    map.addLayer({
        id: 'route-walk', type: 'line', source: 'route-geojson',
        filter: ['==', ['get', 'routeType'], 'walk'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': get('--color-route-primary'), 'line-width': 5 }
    });
    map.addLayer({
        id: 'route-transit', type: 'line', source: 'route-geojson',
        filter: ['==', ['get', 'routeType'], 'transit'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': get('--color-route-secondary'), 'line-width': 5, 'line-dasharray': [2, 2] }
    });
    map.addLayer({
        id: 'route-arrows', type: 'symbol', source: 'route-geojson',
        filter: ['==', ['get', 'routeType'], 'walk'],
        layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 100,
            'icon-image': 'route-arrow',
            'icon-keep-upright': false,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        }
    });
    map.addLayer({
        id: 'route-walkline', type: 'line', source: 'route-geojson',
        filter: ['==', ['get', 'routeType'], 'walkline'],
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [1, 2] }
    });

}

function _initMapEventListeners() {
    if (_mapEventsInitialized) return;
    _mapEventsInitialized = true;

    const FEATURE_LAYERS = ['door-circle', 'elevator-fill', 'stairs-fill', 'toilet-fill', 'room-fill', 'corridor-fill'];

    FEATURE_LAYERS.forEach(layerId => {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
    });

    map.on('click', (e) => {
        if (window.isMapInteractionLocked) return;

        const features = map.queryRenderedFeatures(e.point, { layers: FEATURE_LAYERS });
        if (!features || features.length === 0) {
            if (!activeRouteData) {
                closeSheet();
            }
            return;
        }

        const targetFeature = features[0];
        let fullFeature = null;

        if (geoJsonData && geoJsonData.features) {
            const idx = targetFeature.properties ? targetFeature.properties._featureIndex : undefined;
            if (idx !== undefined && geoJsonData.features[idx]) {
                fullFeature = geoJsonData.features[idx];
            } else if (targetFeature.id !== undefined && geoJsonData.features[targetFeature.id]) {
                fullFeature = geoJsonData.features[targetFeature.id];
            } else {
                const props = targetFeature.properties || {};
                fullFeature = geoJsonData.features.find(f => f.properties && f.properties.name === props.name && f.properties.ref === props.ref && f.properties.indoor === props.indoor);
            }
        }

        const featToOpen = fullFeature || targetFeature;

        if (window.clickTimeout) {
            clearTimeout(window.clickTimeout);
            window.clickTimeout = null;
        }

        openSheet(featToOpen);
    });
}

function _applyThemeToMapLayers() {
    if (!_mapLayersInitialized) return;
    const cs = getComputedStyle(document.documentElement);
    const get = (v) => cs.getPropertyValue(v).trim();
    
    if (map.getLayer('floor-fill')) map.setPaintProperty('floor-fill', 'fill-color', get('--color-floor-fill'));
    if (map.getLayer('floor-outline')) map.setPaintProperty('floor-outline', 'line-color', get('--color-outline'));
    if (map.getLayer('corridor-fill')) map.setPaintProperty('corridor-fill', 'fill-color', get('--color-corridor-fill'));
    if (map.getLayer('corridor-line')) map.setPaintProperty('corridor-line', 'line-color', get('--color-corridor'));
    if (map.getLayer('room-fill')) map.setPaintProperty('room-fill', 'fill-color', get('--color-room'));
    if (map.getLayer('room-stroke')) map.setPaintProperty('room-stroke', 'line-color', get('--color-room-stroke'));
    if (map.getLayer('toilet-fill')) map.setPaintProperty('toilet-fill', 'fill-color', get('--color-toilet-fill'));
    if (map.getLayer('toilet-stroke')) map.setPaintProperty('toilet-stroke', 'line-color', get('--color-toilet-stroke'));
    if (map.getLayer('stairs-fill')) map.setPaintProperty('stairs-fill', 'fill-color', get('--color-stairs'));
    if (map.getLayer('stairs-stroke')) map.setPaintProperty('stairs-stroke', 'line-color', get('--color-stairs-stroke'));
    if (map.getLayer('elevator-fill')) map.setPaintProperty('elevator-fill', 'fill-color', get('--color-elevator'));
    if (map.getLayer('elevator-stroke')) map.setPaintProperty('elevator-stroke', 'line-color', get('--color-elevator-stroke'));
    if (map.getLayer('highlight-line')) map.setPaintProperty('highlight-line', 'line-color', get('--color-highlight'));
    if (map.getLayer('highlight-circle')) map.setPaintProperty('highlight-circle', 'circle-stroke-color', get('--color-highlight'));
    if (map.getLayer('route-walk')) map.setPaintProperty('route-walk', 'line-color', get('--color-route-primary'));
    if (map.getLayer('route-transit')) map.setPaintProperty('route-transit', 'line-color', get('--color-route-secondary'));
    if (map.getLayer('room-labels')) {
        map.setPaintProperty('room-labels', 'text-color', get('--color-room-text'));
        map.setPaintProperty('room-labels', 'text-halo-color', get('--bg-body'));
    }

    // Sötét módban a szaggatott OSM footpath / folyosó réteg elrejtése
    if (map.getLayer('highway_path')) {
        if (getEffectiveThemeMode() === 'dark') {
            map.setLayoutProperty('highway_path', 'visibility', 'none');
        } else {
            map.setLayoutProperty('highway_path', 'visibility', 'visible');
        }
    }

    // OpenFreeMap egyirányú utcanyilak elrejtése
    if (map.getLayer('road_oneway')) {
        map.setLayoutProperty('road_oneway', 'visibility', 'none');
    }
    if (map.getLayer('road_oneway_opposite')) {
        map.setLayoutProperty('road_oneway_opposite', 'visibility', 'none');
    }

    _loadRouteArrowImage();
}

function _loadRouteArrowImage() {
    const cs = getComputedStyle(document.documentElement);
    const get = (v) => cs.getPropertyValue(v).trim();
    const arrowColor = get('--color-arrow') || '#2196F3';
    
    const svg = `<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
        <line x1="4" y1="12" x2="18" y2="12" stroke="${arrowColor}" stroke-width="2" stroke-linecap="round" />
        <path d="M22 12 L16 9.5 L16 14.5 Z" fill="${arrowColor}" stroke="${arrowColor}" stroke-width="1" stroke-linejoin="round" />
    </svg>`;
    const img = new Image();
    img.onload = () => {
        if (map.hasImage('route-arrow')) map.removeImage('route-arrow');
        map.addImage('route-arrow', img);
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

let currentLevel = getDefaultLevelForBuilding(currentBuildingKey);
let availableLevels = [];
let levelAliases = {}; // (Szintszám -> Megjelenített Név)
let geoJsonData = null;
let selectedFeature = null;
let navigationGraph = new Map();
let mainEntranceNode = null;
let doorNodes = new Set(); 



// === SETTINGS UI HANDLERS ===

/**
 * Megjeleníti vagy elrejti a beállítások modális ablakát.
 * A láthatóság átváltása (toggle) után frissíti a beállítások 
 * felhasználói felületét (UI) az aktuális állapotnak megfelelően.
 */
function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('visible');
    if (!modal.classList.contains('visible')) {
        _resetMapPadding();
    }
    updateSettingsUI();
}

/**
 * Alkalmazza a kiválasztott vizuális témát és módot az alkalmazásra.
 * A funkció kiszámítja a CSS változók (custom properties) végső értékét a következő 
 * prioritási sorrend alapján (a legalacsonyabbtól a legmagasabbig):
 * 1. Alapértelmezett globális értékek (THEME_VARS alapok).
 * 2. Téma specifikus előbeállítások (Preset overrides).
 * 3. Felhasználói egyedi beállítások (Custom overrides a témaszerkesztőből).
 * Ezt követően frissíti a dokumentum stílusait, beállítja a világos/sötét mód osztályait, 
 * optimalizált beállításokkal frissíti a térkép csemperétegét (Tile Layer), 
 * és végül elmenti az új preferenciákat a helyi tárolóba (localStorage).
 */
function applyTheme() {
    const root = document.documentElement;
    const mode = getEffectiveThemeMode(); // 'dark' vagy 'light' (feloldva a rendszerből, ha 'system')
    const themeKey = APP_SETTINGS.activeColorTheme;
    
    // 1. Alapértelmezett téma (Preset) betöltése
    const preset = COLOR_THEMES[themeKey] || COLOR_THEMES['default'];
    const presetOverrides = preset.overrides ? (preset.overrides[mode] || {}) : {};

    // 2. Végigmegyünk az összes definiált változón
    for (const [varName, data] of Object.entries(THEME_VARS)) {
        let finalValue = data[mode]; // Kezdünk az alappal

        // Ha a Preset felülírja
        if (presetOverrides[varName]) {
            finalValue = presetOverrides[varName];
        }

        // Ha a USER felülírja (Custom Editorból) - Ez a legerősebb!
        if (CUSTOM_THEME_OVERRIDES[themeKey] && CUSTOM_THEME_OVERRIDES[themeKey][mode] && CUSTOM_THEME_OVERRIDES[themeKey][mode][varName]) {
            finalValue = CUSTOM_THEME_OVERRIDES[themeKey][mode][varName];
        }

        root.style.setProperty(varName, finalValue);
    }

    // 3. UI Osztályok és Alaptérkép stílus
    if (mode === 'light') {
        root.classList.add('light-mode');
        if (document.body) document.body.classList.add('light-mode');
    } else {
        root.classList.remove('light-mode');
        if (document.body) document.body.classList.remove('light-mode');
    }

    // Mobil böngésző fejlécsáv (meta theme-color) szinkronizálása
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
        metaThemeColor.setAttribute('content', mode === 'light' ? '#ffffff' : '#1e1e1e');
    }

    const targetStyleUrl = (mode === 'light') ? MAP_STYLES.light : MAP_STYLES.dark;
    
    if (_mapLayersInitialized && map.setStyle) {
        if (_currentMapStyleMode !== mode) {
            _currentMapStyleMode = mode;
            _mapLayersInitialized = false;

            map.setStyle(targetStyleUrl, { diff: false });

            map.once('style.load', () => {
                // 1. GeoJSON források újraépítése
                _initMapSources();

                // 2. Beltéri rétegek újraépítése az alaptérkép FÖLÉ
                _initMapLayers();
                _mapLayersInitialized = true;

                // 3. Aktuális szint adatainak és markereinek visszatöltése
                if (geoJsonData && currentLevel !== undefined) {
                    renderLevel(currentLevel, false);
                }

                // 4. Aktív útvonal és kijelölés visszaállítása
                if (currentRoutePath && currentRoutePath.length > 0 && activeRouteData) {
                    drawRoute(currentRoutePath);
                }
                if (selectedFeature) {
                    updateSelectedHighlight(currentLevel);
                }

                // 5. Színek és útvonal nyíl ikon frissítése
                _applyThemeToMapLayers();
            });
        } else {
            _applyThemeToMapLayers();
        }
    }

    updateSettingsUI();
    localStorage.setItem('pref_theme', APP_SETTINGS.themeMode);
    localStorage.setItem('pref_color_theme', APP_SETTINGS.activeColorTheme);
}

/**
 * Szinkronizálja a beállítások grafikus felhasználói felületét (UI) az aktuális 
 * globális alkalmazás-beállításokkal (APP_SETTINGS). Frissíti a szegmentált 
 * vezérlőgombok aktív állapotát, a tájékoztató szövegeket, valamint a 
 * gyorsítótár (cache) kapcsolóját és méretkijelzőjét.
 */
function updateSettingsUI() {
    // Nyelvválasztó gombok frissítése
    const currentLang = APP_SETTINGS.language || (typeof i18n !== 'undefined' ? i18n.currentLanguage : 'hu');
    document.querySelectorAll('#seg-language .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === currentLang);
    });

    // A lift/akadálymentesítési preferenciák gombjainak vizuális frissítése
    document.querySelectorAll('#seg-elevator .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === APP_SETTINGS.elevatorMode);
    });

    // A mosdóhasználati preferenciák gombjainak vizuális frissítése
    document.querySelectorAll('#seg-toilet .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === APP_SETTINGS.toiletMode);
    });

    // Akadálymentes mosdó gombja
    const accBtn = document.getElementById('btn-toilet-acc');
    if (accBtn) {
        accBtn.classList.toggle('active', APP_SETTINGS.toiletAccessible);
    }
    
    // A világos/sötét mód választó gombjainak vizuális frissítése
    document.querySelectorAll('#seg-theme .seg-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === APP_SETTINGS.themeMode);
    });

    // A kiválasztott lift módhoz tartozó magyarázó szöveg megjelenítése
    const elHint = document.getElementById('elevator-hint');
    if (elHint) {
        elHint.innerText = getElevatorHint(APP_SETTINGS.elevatorMode);
    }

    // Gyorsítótár méretének aszinkron kiszámítása és megjelenítése
    updateCacheSizeDisplay();
}

/**
 * Beállítja és azonnal alkalmazza az alkalmazás általános megjelenítési módját 
 * (világos vagy sötét téma).
 * @param {string} mode - A beállítani kívánt mód azonosítója (pl. 'dark' vagy 'light').
 */
function setThemeMode(mode) {
    APP_SETTINGS.themeMode = mode;
    applyTheme();
    renderThemeSelector();
}

// Operációs rendszer és böngésző színséma-váltásának valós idejű figyelése (Auto / System mód)
if (typeof window !== 'undefined' && window.matchMedia) {
    const _systemSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const _onSystemSchemeChange = () => {
        if (APP_SETTINGS.themeMode === 'system' || APP_SETTINGS.themeMode === 'auto' || !APP_SETTINGS.themeMode) {
            applyTheme();
            renderThemeSelector();
        }
    };
    if (_systemSchemeQuery.addEventListener) {
        _systemSchemeQuery.addEventListener('change', _onSystemSchemeChange);
    } else if (_systemSchemeQuery.addListener) {
        _systemSchemeQuery.addListener(_onSystemSchemeChange);
    }
}

/**
 * Dinamikusan kiszámítja egy színtéma 3 reprezentatív színmintáját (dot) 
 * az aktuális témamód (dark/light) és az egyedi felülírások alapján.
 * @param {string} themeKey - A téma azonosítója.
 * @returns {Array<string>} 3 CSS színkód tömbje.
 */
function getThemeSampleColors(themeKey) {
    const mode = getEffectiveThemeMode();
    const theme = COLOR_THEMES[themeKey];
    if (!theme) return ['#8A2432', '#00897b', '#000000'];

    const getVal = (vName) => {
        if (theme.overrides && theme.overrides[mode] && theme.overrides[mode][vName]) {
            return theme.overrides[mode][vName];
        }
        if (THEME_VARS[vName] && THEME_VARS[vName][mode]) {
            return THEME_VARS[vName][mode];
        }
        return null;
    };

    const uiActive = getVal('--color-ui-active') || '#8A2432';
    const roomColor = getVal('--color-room') || '#00897b';
    const bgBody = getVal('--bg-body') || (mode === 'dark' ? '#000000' : '#ffffff');

    return [uiActive, roomColor, bgBody];
}

/**
 * Kiválasztja és alkalmazza az aktív színpalettát (színtémát).
 * A módosítás érvénybe léptetése után újrarendereli a téma-választó felületet.
 * @param {string} key - A kiválasztott színtéma azonosítója.
 */
function setColorTheme(key) {
    APP_SETTINGS.activeColorTheme = key;
    applyTheme();
    renderThemeSelector();
}

/**
 * Segédfüggvény színtémák többnyelvű megnevezésének lekéréséhez.
 */
function getThemeName(key, fallbackName) {
    if (typeof t === 'function') {
        const trans = t(`themes.${key}`);
        if (trans && trans !== `themes.${key}`) return trans;
    }
    return fallbackName || key;
}

/**
 * Dinamikus színtéma-választó lista generálása a felhasználói felületen.
 * Végigiterál az elérhető színtémákon (COLOR_THEMES), és mindegyikhez 
 * létrehoz egy választható HTML elemet, megjelenítve a téma nevét 
 * és a hozzá tartozó reprezentatív színmintákat (pöttyöket).
 */
function renderThemeSelector() {
    const container = document.getElementById('color-theme-list');
    
    if (!container) return;
    container.innerHTML = '';
    
    const currentTheme = APP_SETTINGS.activeColorTheme;

    for (const [key, data] of Object.entries(COLOR_THEMES)) {
        const div = document.createElement('div');
        const isSelected = (key === currentTheme);
        div.className = 'theme-option' + (isSelected ? ' selected' : '');
        div.dataset.key = key;
        div.onclick = () => setColorTheme(key);
        
        let dotsHtml = '';
        const colors = getThemeSampleColors(key);
        
        colors.forEach(color => {
            dotsHtml += `<div class="dot" style="background: ${color}"></div>`;
        });
        
        const themeDisplayName = getThemeName(key, data.name);

        div.innerHTML = `
            <span class="theme-name">${themeDisplayName}</span>
            <div class="color-dots">${dotsHtml}</div>
        `;
        
        container.appendChild(div);
    }
}

// === TÉMASZERKESZTŐ LOGIKA & COLOR PICKER MOTOR ===

/**
 * Az aktív színválasztó (Pickr) példányok tárolója.
 * A példányok későbbi, memóriaszivárgást megelőző takarításához (destroy) szükséges.
 * @type {Array<Object>}
 */
let activePickrs = []; 

let _pickrLoadedPromise = null;
/**
 * A Pickr CSS és JS erőforrások aszinkron, igény szerinti (lazy) betöltése.
 */
function loadPickrAssets() {
    if (typeof window !== 'undefined' && window.Pickr) {
        return Promise.resolve();
    }
    if (_pickrLoadedPromise) return _pickrLoadedPromise;
    _pickrLoadedPromise = new Promise((resolve, reject) => {
        if (!document.querySelector('link[href*="pickr"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/themes/nano.min.css';
            document.head.appendChild(link);
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@simonwep/pickr/dist/pickr.min.js';
        script.onload = () => resolve();
        script.onerror = (err) => {
            _pickrLoadedPromise = null;
            reject(err);
        };
        document.head.appendChild(script);
    });
    return _pickrLoadedPromise;
}

/**
 * Megnyitja és inicializálja a témaszerkesztő (Theme Editor) felületet.
 * Átváltja a beállítások modális ablakát szerkesztő módba, dinamikusan legenerálja 
 * az elérhető téma-változókhoz (THEME_VARS) tartozó HTML struktúrát, majd 
 * példányosítja és beállítja a Pickr színválasztó komponenseket minden egyes változóhoz.
 */
function openThemeEditor() {
    const modal = document.getElementById('settings-modal');
    const viewMain = document.getElementById('settings-view-main');
    const viewEditor = document.getElementById('settings-view-editor');
    
    // 1. Felület előkészítése és DOM manipuláció
    // Az 'editor-mode' osztály hozzáadásával a böngésző azonnal alkalmazza a szerkesztő specifikus stílusokat
    modal.classList.add('editor-mode'); 
    
    // Nézetek cseréje a modális ablakon belül (fő nézet elrejtése, szerkesztő nézet megjelenítése)
    viewMain.style.display = 'none';
    viewEditor.style.display = 'flex'; 
    
    if (!modal.classList.contains('visible')) {
        modal.classList.add('visible');
    }

    const mode = getEffectiveThemeMode();
    const themeKey = APP_SETTINGS.activeColorTheme;
    const fallbackName = (COLOR_THEMES[themeKey] || COLOR_THEMES['default']).name;
    const themeName = getThemeName(themeKey, fallbackName);
    const modeLabel = mode === 'dark' ? (typeof t === 'function' ? t('theme_editor.mode_dark') : 'Sötét') : (typeof t === 'function' ? t('theme_editor.mode_light') : 'Világos');
    const headerTitle = typeof t === 'function' ? t('theme_editor.title_format', { theme: themeName, mode: modeLabel }) : `${themeName} (${mode === 'dark' ? 'Sötét' : 'Világos'})`;

    // A fejléc (Header) HTML szerkezetének összeállítása, benne az akciógombokkal
    let html = `
        <div class="editor-header">
            <h3>${headerTitle}</h3>
            
            <div class="editor-header-actions">
                <button class="btn-header-icon primary" onclick="copyThemeCode()" title="${typeof t === 'function' ? t('theme_editor.copy_code') : 'Téma kód másolása'}">
                    <span class="material-symbols-outlined">content_copy</span>
                </button>
                <button class="btn-header-icon danger" onclick="resetThemeOverrides()" title="${typeof t === 'function' ? t('theme_editor.reset') : 'Alaphelyzet'}">
                    <span class="material-symbols-outlined">restart_alt</span>
                </button>
            </div>
        </div>
        
        <div class="editor-scroll-area">
    `;

    // A dinamikus tartalom (változók listája) HTML szerkezetének generálása
    // Végigiterál az összes definiált téma-változón, és mindegyikhez létrehoz egy sort a színválasztóval
    for (const [varName, data] of Object.entries(THEME_VARS)) {
        const cleanVarKey = varName.replace('--', '').replace(/-/g, '_');
        const labelText = typeof t === 'function' ? (t(`theme_editor.${cleanVarKey}`) || data.label || varName) : (data.label || varName);
        html += `
            <div class="editor-row" onclick="focusOnElement('${varName}')">
                <div class="editor-label">
                    <span>${labelText}</span>
                    <small>${varName}</small>
                </div>
                <div class="editor-input-group">
                    <div class="color-picker-container" id="picker-${varName.replace('--', '')}"></div>
                </div>
            </div>
        `;
    }

    // A lábléc (Footer) HTML szerkezetének hozzáadása a mentés és megszakítás gombokkal
    html += `</div> 
    
    <div class="editor-footer">
        <div class="editor-actions">
            <button class="btn-cancel" onclick="closeThemeEditor()">${typeof t === 'function' ? t('common.cancel') : 'Mégse'}</button>
            <button class="btn-save" onclick="saveThemeOverrides()">${typeof t === 'function' ? t('common.save') : 'Mentés'}</button>
        </div>
    </div>`;

    viewEditor.innerHTML = html;

    // 2. A színválasztó (Pickr) dinamikus betöltése és komponensek példányosítása
    loadPickrAssets().then(() => {
        activePickrs = []; // A tároló ürítése az új példányosítás előtt
        
        for (const [varName, data] of Object.entries(THEME_VARS)) {
            const containerId = `#picker-${varName.replace('--', '')}`;
            if (!document.querySelector(containerId)) continue;

            const currentValue = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            
            const pickr = Pickr.create({
                el: containerId,
                theme: 'nano',
                default: currentValue,
                swatches: null,
                components: {
                    preview: true,
                    opacity: true,
                    hue: true,
                    interaction: { input: true, save: false }
                }
            });

            pickr.on('change', (color, source, instance) => {
                const rgbaColor = color.toRGBA().toString();
                document.documentElement.style.setProperty(varName, rgbaColor);
                pickr.applyColor(true); 
                _applyThemeToMapLayers();
                if (varName === '--color-highlight' && selectedFeature) {
                    drawSelectedHighlight(selectedFeature);
                }
            });
            
            pickr.on('show', () => focusOnElement(varName));
            activePickrs.push(pickr);
        }
    }).catch(err => {
        console.error('Pickr betöltése sikertelen:', err);
    });
}

/**
 * Bezárja a témaszerkesztő (Theme Editor) felületet és visszaállítja a beállítások fő nézetét.
 * Megtisztítja a memóriát az aktív színválasztó (Pickr) példányok törlésével, 
 * és kezeli a vizuális állapot visszaállítását a művelet megszakítása (Mégse) esetén.
 * @param {boolean} [saved=false] - Jelzi, hogy a bezárás sikeres mentés után történik-e. 
 * Ha hamis, a rendszer visszatölti az eredeti (mentés előtti) témát.
 */
function closeThemeEditor(saved = false) {
    const modal = document.getElementById('settings-modal');
    const viewMain = document.getElementById('settings-view-main');
    const viewEditor = document.getElementById('settings-view-editor');
    
    // 1. Erőforrások felszabadítása: Az aktív színválasztó (Pickr) példányok megsemmisítése és eltávolítása a DOM-ból.
    activePickrs.forEach(p => p.destroyAndRemove());
    activePickrs = [];

    // 2. Felületi nézetváltás logikája
    // Az 'editor-mode' osztály eltávolítása a modális ablakról az eredeti, középre igazított elrendezés visszaállításához.
    modal.classList.remove('editor-mode');
    
    // A szerkesztő nézet elrejtése és a fő beállítások nézet megjelenítése.
    viewEditor.style.display = 'none';
    viewMain.style.display = 'flex';
    
    _resetMapPadding();
    
    // Visszaállítási logika: Ha a felhasználó mentés nélkül zárt be, visszatöltjük a korábban mentett témát.
    if (!saved) {
        applyTheme(); 
        renderLevel(currentLevel, false);
    }
    
    // A kiemelési (highlight) réteg állapotának helyreállítása.
    // Ha az élő előnézet (live preview) során megváltozott a kijelölés, visszaállítjuk az eredetileg kiválasztott térképelemre.
    if (selectedFeature) {
        drawSelectedHighlight(selectedFeature);
    } else {
        drawSelectedHighlight(null);
    }
}

/**
 * Elmenti a felhasználó által a témaszerkesztőben végrehajtott színmódosításokat (felülírásokat).
 * Kiolvassa az élő előnézetben (live preview) alkalmazott CSS változók aktuális értékeit a DOM-ból, 
 * frissíti velük a globális felülírási memóriát (CUSTOM_THEME_OVERRIDES), 
 * majd perzisztensen rögzíti azokat a helyi tárolóban (localStorage).
 */
function saveThemeOverrides() {
    const mode = getEffectiveThemeMode();
    const themeKey = APP_SETTINGS.activeColorTheme;
    
    // Az adatszerkezet inicializálása az adott témához és módhoz, amennyiben még nem létezik.
    if (!CUSTOM_THEME_OVERRIDES[themeKey]) CUSTOM_THEME_OVERRIDES[themeKey] = {};
    if (!CUSTOM_THEME_OVERRIDES[themeKey][mode]) CUSTOM_THEME_OVERRIDES[themeKey][mode] = {};

    // Iteráció a definiált téma-változókon: az élő nézetben beállított, számított CSS értékek kiolvasása és mentése az objektumba.
    for (const varName of Object.keys(THEME_VARS)) {
        const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        CUSTOM_THEME_OVERRIDES[themeKey][mode][varName] = val;
    }

    // A módosított felülírások JSON formátumban történő rögzítése a helyi tárolóba (localStorage).
    localStorage.setItem('custom_theme_overrides', JSON.stringify(CUSTOM_THEME_OVERRIDES));
    
    // A térkép újrarenderelése a vizuális konzisztencia biztosítása érdekében.
    renderLevel(currentLevel, false); 
    
    // A szerkesztő ablak bezárása 'saved = true' flaggel, hogy megelőzzük az értékek nemkívánatos visszaállítását.
    closeThemeEditor(true); 
}

/**
 * Vágólapra másolja az aktuális színtéma felhasználó által módosított (felülírt) értékeit.
 * Összehasonlítja a DOM-ban jelenleg érvényes CSS változókat a THEME_VARS 
 * globális alapértelmezéseivel az aktív megjelenítési mód (világos/sötét) alapján.
 * A különbségekből egy formázott JavaScript objektum-részletet generál.
 */
function copyThemeCode() {
    const mode = getEffectiveThemeMode(); // 'dark' vagy 'light'
    const fallbackThemeName = (COLOR_THEMES[APP_SETTINGS.activeColorTheme] || {}).name || "Custom";
    const themeName = getThemeName(APP_SETTINGS.activeColorTheme, fallbackThemeName);
    
    // 1. Az eltérések (felülírások) összegyűjtése a THEME_VARS alapértelmezéseihez képest
    let changes = [];
    
    for (const [varName, data] of Object.entries(THEME_VARS)) {
        // A jelenleg kiszámított és érvényben lévő CSS érték lekérése és normalizálása
        const currentVal = getComputedStyle(document.documentElement).getPropertyValue(varName).trim().toLowerCase();
        
        // Az eredeti, konfigurációban rögzített alapértelmezett érték normalizálása az összehasonlításhoz
        const defaultVal = data[mode].trim().toLowerCase();
        
        // Ha a két érték eltér, a módosítás mentésre kerül az exportálandó listába
        if (currentVal !== defaultVal) {
            // Az eredeti (formázás nélküli) érték mentése a pontos kódgenerálás érdekében
            const originalCurrentVal = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            changes.push(`    '${varName}': '${originalCurrentVal}'`);
        }
    }

    // Ha nem történt módosítás, megszakítjuk a folyamatot
    if (changes.length === 0) {
        alert(typeof t === 'function' ? t('alerts.theme_no_changes') : "Nincs mit másolni: Minden érték megegyezik az alapértelmezettel!");
        return;
    }

    // 2. A kódblokk strukturált generálása
    let output = `// ${themeName} (${mode} mód) override-ok:\n`;
    output += `${mode}: {\n`;
    output += changes.join(',\n');
    output += `\n}`;

    // 3. Kód vágólapra másolása
    navigator.clipboard.writeText(output).then(() => {
        alert(typeof t === 'function' ? t('alerts.theme_copied') : "Téma kód (csak a változtatások) másolva! 📋");
    }).catch(err => {
        console.error(err);
        prompt("Másold ki innen:", output);
    });
}

/**
 * Visszaállítja a kiválasztott színtéma aktuális módjához (világos/sötét) 
 * tartozó alapértelmezett beállításokat, törölve minden felhasználói módosítást.
 * Megerősítés után eltávolítja a vonatkozó bejegyzéseket a memóriából és a 
 * helyi tárolóból (localStorage), majd újrarendereli a felületet.
 */
function resetThemeOverrides() {
    if (!confirm('Biztos visszaállítod az eredeti színeket ennél a témánál?')) return;
    
    const mode = getEffectiveThemeMode();
    const themeKey = APP_SETTINGS.activeColorTheme;

    // A specifikus felülírások törlése a globális objektumból és a perzisztens tárolóból
    if (CUSTOM_THEME_OVERRIDES[themeKey] && CUSTOM_THEME_OVERRIDES[themeKey][mode]) {
        delete CUSTOM_THEME_OVERRIDES[themeKey][mode];
        localStorage.setItem('custom_theme_overrides', JSON.stringify(CUSTOM_THEME_OVERRIDES));
    }
    
    // A téma vizuális visszaállítása, a térkép újrarenderelése és a szerkesztő bezárása
    applyTheme(); 
    renderLevel(currentLevel, false);
    closeThemeEditor(true); // Bezárjuk és mentettnek tekintjük (resetelt állapot)
}

/**
 * Kameramozgatás és zoom a témaszerkesztőhöz a kiválasztott stílusváltozó alapján.
 * @param {string} varName - A szerkesztett CSS változó neve.
 */
function focusOnElement(varName) {
    if (!geoJsonData || !geoJsonData.features) return;

    // 1. A szűrőfüggvény meghatározása a változónév alapján
    let filterFn = null;

    // Mosdók szűrése: figyelembe veszi a 'room' és 'amenity' címkéket is a biztonságos találatért
    if (varName.includes('toilet')) {
        filterFn = f => {
            const p = f.properties;
            return p.room === 'toilet' || p.room === 'toilets' || p.room === 'wc' || p.amenity === 'toilets';
        };
    }
    // Lépcsők szűrése: beltéri lépcsők és lépcsőházak azonosítása
    else if (varName.includes('stairs')) {
        filterFn = f => {
            const p = f.properties;
            return p.room === 'stairs' || p.indoor === 'staircase' || p.highway === 'steps';
        };
    }
    // Liftek szűrése
    else if (varName.includes('elevator')) {
        filterFn = f => {
            const p = f.properties;
            return p.room === 'elevator' || p.highway === 'elevator';
        };
    }
    // Folyosók szűrése
    else if (varName.includes('corridor')) {
        filterFn = f => f.properties.indoor === 'corridor' || f.properties.highway === 'corridor';
    }
    // Ajtók és bejáratok szűrése
    else if (varName.includes('door')) {
        filterFn = f => f.properties.door || f.properties.entrance;
    }
    // Általános szobák szűrése: kizárásos alapon működik.
    // Kiszűri a technikai helyiségeket (mosdó, lépcső, lift, folyosó),
    // és azokat az elemeket keresi, amelyeknek van nevük, vagy 'room' típusúak.
    else if (varName.includes('room')) {
        filterFn = f => {
            const p = f.properties;
            const isTech = p.room === 'toilet' || p.room === 'toilets' || p.amenity === 'toilets' ||
                            p.room === 'stairs' || p.indoor === 'staircase' ||
                            p.room === 'elevator' || p.highway === 'elevator' ||
                            p.indoor === 'corridor';
            return !isTech && (p.indoor === 'room' || p.indoor === 'classroom' || p.indoor === 'auditorium' || p.name || p.ref);
        };
    }
    // Kiemelés (Highlight) szűrése: egy tetszőleges, átlagos szobát keresünk a vizuális teszteléshez
    else if (varName.includes('highlight')) {
            filterFn = f => f.properties.indoor === 'room';
    }

    // Ha a változóhoz nem tartozik specifikus térképelem (pl. általános háttérszín esetén), kilépünk
    if (!filterFn) return;

    // 2. Célpont keresése elsődlegesen az aktuálisan látható szinten
    let target = geoJsonData.features.find(f => getLevelsFromFeature(f).includes(currentLevel) && filterFn(f));
    
    // Ha a jelenlegi szinten nem található megfelelő elem, az egész épületben keresünk
    if (!target) {
        target = geoJsonData.features.find(f => filterFn(f));
    }

    // Ha sikeresen találtunk egy megfelelő referenciapontot
    if (target) {
        // 3. Kameramozgatás: a térkép pozicionálása 
        // hogy a kiválasztott elem látható legyen, és a szerkesztőablak ne takarja ki
        smartFlyTo(target);

        // 4. A vizuális kiemelés (Highlight) logikájának kezelése
        // Kizárólag akkor rajzoljuk ki a kiemelés keretét, ha konkrétan a kiemelés színét szerkesztik.
        // Más stílusok (pl. falak vagy szobák kitöltése) szerkesztésekor a keret zavaró lehet, így azt eltávolítjuk.
        if (varName.includes('highlight')) {
            drawSelectedHighlight(target);
        } else {
            // A kiemelési réteg ürítése a színek zavartalan ellenőrzéséhez
            drawSelectedHighlight(null);
        }
    }
}

/**
 * Élő előnézet (Live Preview) biztosítása a színek módosításakor.
 * Azonnal frissíti a megadott CSS változót a dokumentum gyökerén (documentElement), 
 * és vizuálisan megjeleníti a kiválasztott szín értékét (pl. hexadecimális kódot) a felületen.
 * Megjegyzés: A komplex térképelemek (pl. szobák kitöltése, canvas/SVG elemek) 
 * azonnali újrarenderelése teljesítményi okokból (a csúszka húzásának akadása miatt) 
 * szándékosan mellőzve van, így a drasztikus változások csak mentéskor érvényesülnek.
 * @param {string} varName - A módosítandó CSS változó neve (pl. '--bg-surface').
 * @param {string} value - Az új szín értéke.
 */
function handleColorChange(varName, value) {
    document.documentElement.style.setProperty(varName, value);
    if (typeof event !== 'undefined' && event && event.target && event.target.nextElementSibling) {
        event.target.nextElementSibling.innerText = value;
    }
    _applyThemeToMapLayers();
}

/**
 * Beállítja a felület nyelvét (pl. 'hu' vagy 'en').
 * Elmenti a választást és frissíti a teljes felhasználói felületet.
 * @param {string} lang - 'hu' vagy 'en'
 */
async function setLanguageMode(lang) {
    APP_SETTINGS.language = lang;
    if (typeof i18n !== 'undefined') {
        await i18n.setLanguage(lang);
    }
    updateSettingsUI();
    if (typeof initBuildings === 'function') initBuildings();
}

/**
 * Beállítja az útvonaltervezéshez használt lift és lépcső preferenciát.
 * A módosítás elmentése után frissíti a felhasználói felületet, és 
 * a megváltozott navigációs feltételeknek (súlyoknak) megfelelően 
 * azonnal újraépíti az útvonaltervezési gráfot.
 * @param {string} mode - A kiválasztott mód (pl. 'balanced', 'stairs', 'elevator').
 */
function setElevatorMode(mode) {
    APP_SETTINGS.elevatorMode = mode;
    localStorage.setItem('pref_elevator', mode);
    
    // Csendes szinkronizáció: ha a mozgás kerekesszékes, a mosdó is az lesz
    if (mode === 'wheelchair') {
        APP_SETTINGS.toiletAccessible = true;
        localStorage.setItem('pref_toilet_acc', 'true');
    }
    
    updateSettingsUI();
    buildRoutingGraph(); 
}

/**
 * Beállítja a mosdókereső algoritmus preferenciáit (pl. minden mosdó listázása, 
 * vagy csak specifikus típusok). A változtatás után szinkronizálja a felületet.
 * @param {string} mode - A kiválasztott mosdóhasználati mód.
 */
function setToiletMode(mode) {
    APP_SETTINGS.toiletMode = mode;
    updateSettingsUI();
}

function toggleToiletAccessible() {
    APP_SETTINGS.toiletAccessible = !APP_SETTINGS.toiletAccessible;
    localStorage.setItem('pref_toilet_acc', APP_SETTINGS.toiletAccessible);
    updateSettingsUI();
}

/**
 * Visszaállítja a felhasználói beállításokat (lift és mosdó preferenciák) 
 * a gyári alapértékekre. Ezt követően frissíti a felületet, újraépíti a 
 * navigációs gráfot az alapértelmezett paraméterekkel, és bezárja a modális ablakot.
 */
function resetSettings() {
    APP_SETTINGS.elevatorMode = 'balanced';
    APP_SETTINGS.toiletMode = 'all';
    updateSettingsUI();
    buildRoutingGraph();
    toggleSettings(); // Bezárás
}

/**
 * Váltakozva megjeleníti vagy elrejti az impresszum modális ablakát.
 * A vizuális ütközések és átfedések elkerülése érdekében biztosítja, 
 * hogy a beállítások (settings) panel bezáruljon az impresszum megnyitásakor.
 */
function toggleImpressum() {
    // Ha a settings nyitva van, csukjuk be
    document.getElementById('settings-modal').classList.remove('visible');
    
    const modal = document.getElementById('impressum-modal');
    modal.classList.toggle('visible');
}

/**
 * GPS alapú, automatikus épületválasztó funkció (kizárólag mobil eszközökre).
 * Ha a felhasználó mobilról böngészik, és a helymeghatározás engedélyezett,
 * a funkció kiszámítja a felhasználó távolságát az összes definiált épülettől.
 * Ha a felhasználó egy másik épület (pl. 'Q') közelében van (1000 méteren belül), 
 * mint az alapértelmezetten betöltött (pl. 'K'), a rendszer automatikusan 
 * átvált a közelebbi épületre.
 * Fontos: Nem írja felül a betöltést, ha az URL-ben megosztási kód (Deep Link) szerepel.
 */
function detectClosestBuilding() {
    // 1. Környezet vizsgálata: A funkció csak mobil eszközökön fut le.
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    if (!isMobile) return;

    // 2. Deep Link prioritás: Ha az URL tartalmaz 'share' paramétert (megosztott hivatkozás),
    // az felhasználói szándékot jelez egy konkrét épületre, így a GPS felülírást letiltjuk.
    const params = new URLSearchParams(window.location.search);
    if (params.get('share')) return;

    // 3. Geolocation API ellenőrzése és pozíció lekérése
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            // Felhasználó koordinátáinak kinyerése
            const userLat = position.coords.latitude;
            const userLon = position.coords.longitude;
            // A Turf.js [hosszúság, szélesség] formátumot vár
            const userPoint = turf.point([userLon, userLat]);

            let closestKey = null;
            let minDist = Infinity;

            // Iteráció az összes konfigurált épületen (BUILDINGS objektum)
            for (const [key, data] of Object.entries(BUILDINGS)) {
                // Épület koordinátáinak konvertálása Turf kompatibilis formátumra
                // Figyelem: A BUILDINGS[key].center [szélesség, hosszúság] formátumú
                const bPoint = turf.point([data.center[1], data.center[0]]);
                
                // Távolság kiszámítása a felhasználó és az épület között (kilométerből méterre váltva)
                const dist = turf.distance(userPoint, bPoint, { units: 'kilometers' }) * 1000; 

                // A legkisebb távolság (legközelebbi épület) nyilvántartása
                if (dist < minDist) {
                    minDist = dist;
                    closestKey = key;
                }
            }

            // 4. Épületváltás végrehajtása meghatározott feltételek mellett
            // Csak akkor történik automatikus váltás, ha:
            // - A GPS azonosított egy legközelebbi épületet
            // - Az nem egyezik meg a már betöltöttel
            // - A távolság kevesebb, mint 1 km (ne váltson, ha a felhasználó messze van az egyetemtől)
            if (closestKey && closestKey !== currentBuildingKey && minDist < 1000) {
                
                // --- Vizuális visszajelzés a felhasználónak a GPS alapú váltásról ---
                showToast(typeof t === 'function' ? t('toasts.building_detected', { building: getBuildingName(closestKey) }) : `✨ ${getBuildingName(closestKey)} észlelve`);
                
                // Globális funkció meghívása a közelebbi épület betöltésére
                changeBuilding(closestKey);
            }

        }, (error) => {
            // Hibakezelés: ha a GPS nincs engedélyezve, vagy a lekérés sikertelen
            console.warn("GPS hiba vagy elutasítva:", error.message);
        }, {
            // Geolocation opciók: nagy pontosság igénylése, 5 másodperc timeout, 1 perc cache
            enableHighAccuracy: true,
            timeout: 5000,
            maximumAge: 60000
        });
    }
}

/**
 * Segédfüggvény az épületnév többnyelvű lekéréséhez
 * @param {string} key - 'K', 'Q', 'I', 'E', 'R', 'KT', stb.
 */
function getBuildingName(key) {
    if (key === 'KT') {
        if (typeof t === 'function') {
            const trans = t('types.library');
            if (trans && trans !== 'types.library') return trans;
        }
        return "Könyvtár";
    }
    if (typeof t === 'function') {
        const trans = t('common.building_name', { name: key });
        if (trans && trans !== 'common.building_name') return trans;
    }
    return (BUILDINGS[key] && BUILDINGS[key].name) ? BUILDINGS[key].name : `${key} Épület`;
}

/**
 * Inicializálja az épületválasztó menüt a felhasználói felületen.
 * Végigiterál a konfigurált épületeken (BUILDINGS), és legenerálja 
 * a kiválasztásukhoz szükséges HTML elemeket a legördülő listában.
 */
function initBuildings() {
    const optionsDiv = document.getElementById('building-options');
    if (!optionsDiv) return;
    optionsDiv.innerHTML = "";
    
    for (const [key, data] of Object.entries(BUILDINGS)) {
        const div = document.createElement('div');
        const bName = getBuildingName(key);
        
        // Az aktuálisan kiválasztott épület vizuális kiemelése
        div.className = 'option' + (key === currentBuildingKey ? ' selected' : '');
        div.innerHTML = `<span class="material-symbols-outlined">apartment</span> ${bName}`;
        
        // Kattintás eseménykezelő az épületváltáshoz és a menü bezárásához
        div.onclick = () => {
            changeBuilding(key);
            toggleBuildingMenu();
        };
        
        optionsDiv.appendChild(div);
    }
    
    // A fejlécben megjelenő aktív épületnév frissítése
    const currentNameEl = document.getElementById('current-building-name');
    if (currentNameEl) {
        currentNameEl.innerText = getBuildingName(currentBuildingKey);
    }
}

/**
 * Globális eseményfigyelő a kattintásokra.
 * Bezárja az épületválasztó menüt, ha a felhasználó a menün kívülre kattint.
 */
document.addEventListener('click', function(event) {
    const select = document.querySelector('.custom-select');
    
    // Ha a kattintás nem a választó elemen belül történt, elrejtjük a menüt
    if (!select.contains(event.target)) {
        document.getElementById('building-options').classList.remove('show');
    }
});

/**
 * Megjeleníti vagy elrejti az épületválasztó legördülő menüt 
 * a 'show' CSS osztály hozzáadásával vagy eltávolításával.
 */
function toggleBuildingMenu() {
    document.getElementById('building-options').classList.toggle('show');
}

/**
 * Átvált egy másik épület nézetére.
 * Megtisztítja a térképet a korábbi adatoktól, rétegektől és állapotoktól,
 * majd elindítja az új épület adatainak betöltését és a nézet beállítását.
 * * @param {string} key - Az újonnan kiválasztott épület egyedi azonosítója.
 * @param {string|null} [autoSearchTerm=null] - Opcionális keresési kifejezés, amely a betöltés után automatikusan lefut.
 * @param {string|null} [targetId=null] - Opcionális célterem azonosító (feature ID), amely azonnal fókuszba kerül betöltés után.
 */
function changeBuilding(key, autoSearchTerm = null, targetId = null) {
    if (!BUILDINGS[key]) return;
    
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) {
        if (settingsModal.classList.contains('editor-mode')) {
            closeThemeEditor(false);
        }
        settingsModal.classList.remove('visible');
    }
    if (typeof closeSheet === 'function') closeSheet();
    _resetMapPadding();

    currentBuildingKey = key;
    currentBuilding = BUILDINGS[key];
    currentLevel = getDefaultLevelForBuilding(key);
    
    if (autoSearchTerm) pendingSearchTerm = autoSearchTerm;
    if (targetId) pendingTargetId = targetId;

    geoJsonData = null;
    
    if (_mapLayersInitialized) {
        const empty = { type: 'FeatureCollection', features: [] };
        if (map.getSource('indoor-geojson')) map.getSource('indoor-geojson').setData(empty);
        if (map.getSource('route-geojson')) map.getSource('route-geojson').setData(empty);
        if (map.getSource('highlight-geojson')) map.getSource('highlight-geojson').setData(empty);
        if (map.getSource('labels-geojson')) map.getSource('labels-geojson').setData(empty);
    }

    _clearRouteMarkers();
    _clearArrowMarkers();
    _clearPoiMarkers();
    _clearFavoriteMarkers();
    _clearRoomIconMarkers();
    _clearRoomLabelMarkers();
    
    activePoiCategory = null;
    pendingNavSource = null;

    document.getElementById('search-input').value = "";
    updateRightButtonState();
    
    initBuildings(); 
    loadOsmData(); 
}

/**
 * Megjelenít egy egyedi modális (felugró) ablakot a megadott címmel és szöveggel,
 * valamint beállítja a megerősítő gomb eseménykezelőjét.
 * A DOM elem klónozásával biztosítja a korábban csatolt eseménykezelők eltávolítását,
 * megelőzve a többszörös futást.
 * @param {string} title - A modális ablak címe.
 * @param {string} text - A modális ablakban megjelenő szöveges tartalom.
 * @param {Function} confirmCallback - A megerősítő gomb megnyomásakor lefutó visszahívási függvény.
 */
function showModal(title, text, confirmCallback) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-text').innerText = text;
    
    // A megerősítő gomb referenciájának lekérése
    const confirmBtn = document.getElementById('modal-confirm');
    
    // A gomb klónozása a rajta lévő event listenerek törlése céljából
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    
    // Az új kattintási esemény hozzárendelése: bezárja az ablakot, majd lefuttatja a callbacket
    newBtn.onclick = () => { closeModal(); confirmCallback(); };
    
    // A modális ablak megjelenítése a megfelelő CSS osztály hozzáadásával
    document.getElementById('custom-modal').classList.add('visible');
}

/**
 * Bezárja (elrejti) az egyedi modális ablakot a láthatóságot szabályozó CSS osztály eltávolításával.
 */
function closeModal() { 
    document.getElementById('custom-modal').classList.remove('visible'); 
}

/**
 * Egyedi azonosító kulcsot (stringet) generál a megadott koordináták és a szint alapján.
 * A szélességi és hosszúsági fokokat a globális PRECISION változó alapján kerekíti
 * az inkonzisztens lebegőpontos számítások elkerülése végett.
 * @param {number|string} lat - A földrajzi szélesség (latitude).
 * @param {number|string} lon - A földrajzi hosszúság (longitude).
 * @param {string|number} level - A szint azonosítója.
 * @returns {string} A formázott azonosító kulcs (pl. "47.47,19.05,1").
 */
function toKey(lat, lon, level) { 
    return `${parseFloat(lat).toFixed(PRECISION)},${parseFloat(lon).toFixed(PRECISION)},${level}`; 
}

/**
 * Kinyeri és feldolgozza egy térképelem (GeoJSON feature) szintadatait (level property).
 * Kezeli a többértékű mezőket, értelmezi a számtartományokat (pl. "0-2" vagy "-1-1"), 
 * és kiszűri az érvénytelen vagy hibás adatokat.
 * @param {Object} feature - A vizsgálandó GeoJSON térképelem.
 * @returns {string[]} Az érvényes szintek egyedi, növekvő sorrendbe rendezett tömbje.
 */
function getLevelsFromFeature(feature) {
    if (!feature || !feature.properties) return [];
    
    const p = feature.properties;

    // --- FALLBACK LOGIKA HIÁNYZÓ SZINTEKRE ---
    // Ha az OSM-ben lusta volt a szerkesztő, és nem adott meg szintet, 
    // de az elem egy POI, ajtó, vagy bejárat, alapértelmezetten a Földszintre ("0") rakjuk.
    if (!p.level) {
        const isPoi = p.amenity === 'vending_machine' || p.amenity === 'microwave' || p.amenity === 'atm' || p.amenity === 'cafe' || p.amenity === 'fast_food' || p.shop === 'kiosk' || p.room === 'toilet' || p.room === 'toilets' || p.amenity === 'toilets';
        if (p.entrance || p.door || isPoi) {
            return ["0"];
        }
        return []; // Ha nem POI és nincs szintje (pl. egy fa kint), azt hagyjuk békén
    }
    
    // A nyers szintadat sztringgé alakítása a biztonságos string műveletekhez
    const raw = p.level.toString();
    
    // A vesszőket pontosvesszőre cseréljük a formátum egységesítése érdekében, majd feldaraboljuk
    const parts = raw.replace(/,/g, ';').split(';');
    
    // Set adatszerkezet használata a duplikált szintek automatikus kiszűrésére
    let levels = new Set();
    
    parts.forEach(part => {
        // Felesleges szóközök eltávolítása a darabok elejéről és végéről
        part = part.trim();
        if (!part) return;

        // 1. TARTOMÁNY DETEKTÁLÁS (pl. "0-2" vagy "-1-1")
        // Reguláris kifejezés: opcionális mínusz jel, számok, kötőjel, majd ismét opcionális mínusz és számok
        const rangeMatch = part.match(/^(-?\d+)\s*-\s*(-?\d+)$/);

        if (rangeMatch) {
            const min = parseInt(rangeMatch[1]);
            const max = parseInt(rangeMatch[2]);
            
            // Érvényes számok ellenőrzése és maximális emeletkülönbség korlátozása (max 30)
            // Ezzel elkerülhető a hibás adatokból (pl. dátumok beírása) származó végtelen ciklus vagy hibás generálás.
            if (!isNaN(min) && !isNaN(max) && Math.abs(max - min) < 30) {
                // Iteráció a minimum és maximum érték között, beleértve a határokat is
                for (let i = Math.min(min, max); i <= Math.max(min, max); i++) {
                    levels.add(i.toString());
                }
            }
        } else {
            // 2. Egész számú szint detektálás
            const num = Number(part);
            
            // Ez a feltétel kiszűri a tört számokat (pl. "-0.5") és a nem numerikus, szöveges szemetet
            if (!isNaN(num) && Number.isInteger(num)) {
                    levels.add(num.toString());
            }
        }
    });
    
    // A Set objektum szabványos tömbbé alakítása és numerikus érték szerinti növekvő sorrendbe rendezése
    return Array.from(levels).sort((a,b) => parseFloat(a) - parseFloat(b));
}


/**
 * A térkép nézetét automatikusan a betöltött épület geometriájához igazítja.
 * 
 * Szigorúan animáció (panning/zooming) nélkül működik: azonnal a tökéletes, 
 * végleges helyre ugrik, hogy a vizuális élményt kizárólag a CSS "Blueprint"
 * fade-in effektus adja, rángatózás nélkül.
 */
function alignMapToBuildingCenter() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('share')) return;

    if (!geoJsonData || !geoJsonData.features || geoJsonData.features.length === 0) return;

    try {
        _resetMapPadding();
        const bbox = turf.bbox(geoJsonData); 
        
        if (bbox) {
            const sheet = document.getElementById('bottom-sheet');
            let bottomPadding = 20; 
            if (sheet && sheet.classList.contains('open')) {
                bottomPadding = sheet.getBoundingClientRect().height + 20;
            }

            if (window.innerWidth < 768) {
                // --- TELEFONOS NÉZET ---
                const centerLon = (bbox[0] + bbox[2]) / 2;
                const centerLat = (bbox[1] + bbox[3]) / 2;
                
                const targetZoom = (currentBuilding.zoom || 19) - 0.5;
                
                map.jumpTo({
                    center: [centerLon, centerLat],
                    zoom: targetZoom,
                    padding: { top: 40, bottom: bottomPadding, left: 10, right: 10 }
                });
                

            } else {
                // --- SZÁMÍTÓGÉPES NÉZET ---
                const sheetEl = document.getElementById('bottom-sheet');
                const panelOpen = sheetEl && sheetEl.classList.contains('open');
                const panelW = panelOpen ? (sheetEl.getBoundingClientRect().width || 390) : 0;
                map.fitBounds(
                    [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
                    {
                        padding: { top: 50, bottom: 50, left: panelW + 50, right: 50 },
                        animate: false
                    }
                );
                
            }
        }
    } catch (e) {
        console.warn("Auto-align error:", e);
    }
}


/**
 * Meghatározza a térképelemek vizuális rétegsorrendjét (z-index) az SVG renderelés során.
 * Célja, hogy a nagyobb súlyú elemek (pl. ajtók, szobák) feljebb kerüljenek, 
 * biztosítva a megfelelő láthatóságot és kattinthatóságot az alaprajzon.
 * @param {Object} f - A vizsgálandó GeoJSON térképelem (feature).
 * @returns {number} Az elem rétegzési súlya (1-től 4-ig), ahol a magasabb érték felsőbb réteget jelent.
 */
function getFeatureWeight(f) {
    const p = f.properties;
    
    // 4. szint: Ajtók és bejáratok
    if (p.entrance || p.door) return 4;

    // 2. szint: Folyosók
    if (p.indoor === 'corridor' || p.highway === 'corridor') return 2;

    // 1. szint: Szerkezeti padló és fal
    if (p.indoor === 'level' || p.indoor === 'wall') return 1;

    // 3. szint: Szobák és területek
    if (p.indoor === 'area' || p.indoor === 'room') return 3;

    // 1. szint: Épület és épületrész körvonalak
    if (p['building:part'] || p.building) return 1;

    return 3; 
}

/**
 * Feldolgozza a GeoJSON adatokat és beállítja a térkép szintjeit és rétegeit.
 * @param {Object} geojsonData - Az épület GeoJSON adathalmaza.
 */
function processOsmData(osmData, isUpdate = false) {
    // 1. Aktuális állapot (szint/emelet) mentése a vizuális ugrálások elkerülése végett (B-010 Fix)
    const savedLevel = currentLevel;


    // Szintadatok feldolgozása
    if (osmData && osmData.type === 'FeatureCollection') {
        // Statikus, előkészített GeoJSON fájl (pl. GitHub Actions által generálva) feldolgozása
        geoJsonData = osmData;
    } else if (typeof osmtogeojson === 'function') {
        // Nyers OSM adatok konvertálása GeoJSON formátumba (ha elérhető a könyvtár)
        geoJsonData = osmtogeojson(osmData);
    }
    
    // A térképelemek mélységi (Z-Index) rendezése a getFeatureWeight függvény alapján
    if (geoJsonData && geoJsonData.features) {
        geoJsonData.features.sort((a, b) => {
            return getFeatureWeight(a) - getFeatureWeight(b);
        });
        geoJsonData.features.forEach((f, idx) => {
            f.id = idx;
            if (!f.properties) f.properties = {};
            f.properties._featureIndex = idx;
        });
    }

    // Térképi logika és adatszerkezetek inicializálása
    processLevels(); 
    collectDoors(); 
    buildRoutingGraph(); 
    
    // 2. Az előzőleg mentett szint (emelet) állapotának biztonságos visszaállítása
    if (isUpdate && availableLevels.includes(savedLevel)) {
        currentLevel = savedLevel;
    } else {
        // Ha nem háttérfrissítésről van szó, vagy a mentett szint nem elérhető az új adatokban:
        const defaultLvl = getDefaultLevelForBuilding(currentBuildingKey);
        if (!availableLevels.includes(currentLevel)) {
            currentLevel = availableLevels.includes(defaultLvl) 
                ? defaultLvl 
                : (availableLevels.includes('0') ? '0' : (availableLevels[0] || "0"));
        }
    }

    // 3. KAMERA POZICIONÁLÁSA
    // Szigorúan azonnali beállás az adatok renderelése előtt
    if (!isUpdate) {
        alignMapToBuildingCenter();
    }

    // 4. Felhasználói felület és térkép renderelése
    renderLevel(currentLevel, !isUpdate);
    createLevelControls();
    
    // Dinamikus láthatóság (részletességi szint / LOD) frissítése az aktuális nagyításhoz
    updateDynamicVisibility();
}

/**
 * Aszinkron függvény a kiválasztott épület térképadatainak betöltésére.
 * A Service Worker Stale-While-Revalidate gyorsítótárán keresztül kéri le
 * az előkészített GeoJSON fájlt, biztosítva az azonnali és offline működést.
 */
async function loadOsmData() {
    const loader = document.getElementById('loader');
    const buildingKey = currentBuildingKey;

    loader.style.display = 'block';
    document.getElementById('loader-status').innerText = "Betöltés...";

    try {
        let data = null;
        if (_initialBuildingFetchPromise && buildingKey === _initialBuildingKey) {
            try {
                data = await _initialBuildingFetchPromise;
            } catch(e) {}
        }
        _initialBuildingFetchPromise = null;

        if (!data) {
            const res = await fetch(`./data/${buildingKey.toLowerCase()}_epulet.json`);
            if (!res.ok) throw new Error("Statikus fájl nem található (HTTP " + res.status + ")");
            data = await res.json();
        }

        processOsmData(data, false);
        loader.style.display = 'none';

        // Függőben lévő célterem vagy keresés végrehajtása kis késleltetéssel (pl. automatikus épületváltás után)
        if (pendingTargetId || pendingSearchTerm) {
            setTimeout(() => {
                if (pendingTargetId && geoJsonData && geoJsonData.features) {
                    const target = geoJsonData.features.find(f => f.id === pendingTargetId);
                    if (target) {
                        openSheet(target);
                        const lvls = getLevelsFromFeature(target);
                        if (lvls.length > 0) switchLevel(lvls[0]);
                        const tVal = target.properties.name || target.properties.ref || pendingSearchTerm || "";
                        document.getElementById('search-input').value = tVal;
                        updateRightButtonState();
                        pendingTargetId = null;
                        pendingSearchTerm = null;
                        return;
                    }
                }
                if (pendingSearchTerm) {
                    document.getElementById('search-input').value = pendingSearchTerm;
                    handleSearch({ target: { value: pendingSearchTerm }, key: 'Enter' });
                    pendingSearchTerm = null;
                }
            }, 120);
        }

        // URL paraméterek (pl. Deep Link megosztás) feldolgozása a betöltés befejezésekor
        processUrlParams();

    } catch (localError) {
        console.warn("⚠️ Hiba a térképadatok betöltésekor:", localError);
        document.getElementById('loader-status').innerText = "FAILED.";
        alert(typeof t === 'function' ? t('alerts.download_error') : "Hiba a letöltéskor: A térképfájl nem érhető el.\n(Ellenőrizd az internetkapcsolatot!)");
    }
}

/**
 * Összegyűjti és eltárolja az épület összes ajtajának és bejáratának csomópontját.
 * Végigiterál a térképadatokon (GeoJSON), megkeresi az 'entrance' vagy 'door' tulajdonsággal
 * rendelkező pont (Point) geometriákat, majd generál hozzájuk egy egyedi azonosítót 
 * (koordináta és szint alapján), amelyet a globális 'doorNodes' halmazban (Set) tárol el.
 * A funkció az útvonaltervezés (routing) logikájának előkészítéséhez szükséges.
 */
function collectDoors() {
    // A korábban eltárolt ajtó-csomópontok törlése az új adatok betöltése előtt
    doorNodes.clear();
    
    geoJsonData.features.forEach(f => {
        const p = f.properties;
        
        // Kizárólag a pont típusú geometriákat vizsgáljuk, amelyek bejáratként vagy ajtóként vannak megjelölve
        if (f.geometry.type === 'Point' && (p.entrance || p.door)) {
            const levels = getLevelsFromFeature(f);
            const lat = f.geometry.coordinates[1];
            const lon = f.geometry.coordinates[0];
            
            // Fallback: Ha az elemhez nincs szint (level) adat társítva, alapértelmezésként 
            // hozzárendeljük a leggyakoribb szinteket, hogy az útvonaltervező megtalálja
            if (levels.length === 0) levels.push("0", "1", "2", "3", "-1"); 
            
            // A csomópont hozzáadása a halmazhoz minden érintett szinten
            levels.forEach(lvl => { doorNodes.add(toKey(lat, lon, lvl)); });
        }
    });
}

/**
 * Kirajzolja a helyiségek szöveges feliratait a térképre.
 * @param {string} level - Az aktuálisan megjelenített szint azonosítója.
 */
function _drawRoomIcons(level) {
    _clearRoomIconMarkers();
    if (!geoJsonData || !geoJsonData.features) return;

    geoJsonData.features.forEach(feature => {
        const levels = getLevelsFromFeature(feature);
        if (!levels.includes(level)) return;

        const p = feature.properties;
        let iconName = null;
        let bgColor = null;

        if (p.room === 'toilet' || p.room === 'toilets' || p.amenity === 'toilets') {
            iconName = "wc";
        }
        if (p.room === 'stairs' || p.indoor === 'staircase') {
            iconName = "stairs_2";
        }
        if (p.highway === 'elevator' || p.room === 'elevator') {
            iconName = "elevator";
        }

        if (p.amenity === 'vending_machine') {
            if (p.vending && p.vending.includes('coffee')) {
                iconName = "local_cafe";
                bgColor = "var(--color-coffee)";
            } else {
                iconName = "water_bottle";
                bgColor = "#0288d1";
            }
        }
        if (p.amenity === 'cafe' || p.amenity === 'fast_food' || p.amenity === 'restaurant' || p.shop === 'kiosk') {
            iconName = "fastfood";
            bgColor = "var(--color-buffet)";
        }
        if (p.amenity === 'microwave') {
            iconName = "microwave";
            bgColor = "#ff9800";
        }
        if (p.amenity === 'atm') {
            iconName = "local_atm";
            bgColor = "#4caf50";
        }

        if (iconName && !isFavorite(feature)) {
            const center = (feature.geometry.type === "Point") 
                ? [feature.geometry.coordinates[0], feature.geometry.coordinates[1]]
                : turf.centroid(feature).geometry.coordinates;

            const el = document.createElement('div');
            el.className = 'map-icon';
            if (p._featureIndex !== undefined) el.dataset.featureIndex = p._featureIndex;
            if (p.ref || p.name) el.dataset.ref = p.ref || p.name;
            el.dataset.coords = `${center[0].toFixed(6)},${center[1].toFixed(6)}`;
            el.style.pointerEvents = 'none';

            if (bgColor) {
                el.style.pointerEvents = 'auto'; // Kattinthatóság bekapcsolása POI-knak
                el.classList.add('clickable-poi');
                el.innerHTML = `
                    <div class="poi-bg-circle" style="background-color: ${bgColor}; cursor: pointer;">
                        <span class="material-symbols-outlined">${iconName}</span>
                    </div>
                `;
                
                // Közvetlen kattintáskezelő a POI markerekhez
                el.addEventListener('click', (e) => {
                    e.stopPropagation(); // Ne vigye át a kattintást a floor-fill rétegre
                    
                    if (window.clickTimeout) {
                        clearTimeout(window.clickTimeout);
                        window.clickTimeout = null;
                    }
                    openSheet(feature);
                });
            } else {
                el.innerHTML = `<span class="material-symbols-outlined">${iconName}</span>`;
            }

            const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat([center[0], center[1]])
                .addTo(map);

            if (!bgColor) {
                marker.getElement().style.pointerEvents = 'none';
            }

            _roomIconMarkers.push(marker);
        }
    });
}

function drawLabels(level) {
    _clearRoomLabelMarkers();
    if (!geoJsonData || !geoJsonData.features || !_mapLayersInitialized) return;

    geoJsonData.features.forEach(feature => {
        const levels = getLevelsFromFeature(feature);
        if (!levels.includes(level)) return;

        const p = feature.properties;
        const isCorridor = p.indoor === 'corridor' || p.highway === 'corridor';
        const isToilet = p.amenity === 'toilets' || p.room === 'toilet' || p.room === 'toilets' || p.room === 'wc';
        const isStairs = p.highway === 'steps' || p.room === 'stairs' || p.indoor === 'staircase';
        const isElevator = p.highway === 'elevator' || p.room === 'elevator';
        const isPoi = p.amenity === 'vending_machine' || p.amenity === 'microwave' || p.amenity === 'atm' || p.amenity === 'cafe' || p.amenity === 'fast_food' || p.shop === 'kiosk';

        if (isCorridor || isToilet || isStairs || isElevator || isPoi) return;

        let shortName = "";
        if (p.ref) {
            shortName = p.ref;
        } else if (p.name) {
            // Ha nincs teremszám (ref), csak név (name), szavanként törjük több sorba, középre igazítva
            const words = p.name.trim().split(/\s+/);
            if (words.length > 3) {
                shortName = words.slice(0, 3).join('<br>');
            } else {
                shortName = words.join('<br>');
            }
        }

        let midName = p.name || p.ref || "";
        let fullName = (p.ref && p.name) ? `${p.ref} - ${p.name}` : (p.name || p.ref || "");

        if ((!shortName && !midName && !fullName) || p.indoor === 'wall') return;

        const pos = feature.geometry.type === "Point" 
            ? feature.geometry.coordinates 
            : turf.pointOnFeature(feature).geometry.coordinates;

        const el = document.createElement('div');
        el.className = 'room-label';
        
        el.innerHTML = `
            <span class="label-short">${shortName}</span>
            <span class="label-mid">${midName}</span>
            <span class="label-full">${fullName}</span>
        `;

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([pos[0], pos[1]])
            .addTo(map);

        marker.getElement().style.pointerEvents = 'none';

        _roomLabelMarkers.push(marker);
    });
}

/**
 * Újraindítja a "Blueprint" (alaprajz előtűnése) CSS animációt a térképen.
 * Kizárólag épületváltáskor és első betöltéskor hívódik meg a prémium UX érdekében.
 */
function triggerBlueprintAnimation() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;
    
    mapContainer.classList.remove('blueprint-animating');
    void mapContainer.offsetWidth; 
    mapContainer.classList.add('blueprint-animating');
}

/**
 * Megjeleníti és rendereli a térképen az adott szinthez tartozó elemeket.
 * @param {string} level - A megjelenítendő szint azonosítója (pl. '0', '1', '-1').
 * @param {boolean} animate - Indítsa-e el a Blueprint előtűnési animációt (alapból true).
 */
function renderLevel(level, animate = true) {
    if (!geoJsonData || !_mapLayersInitialized || !map.getSource('indoor-geojson')) return;

    const levelFeatures = {
        type: 'FeatureCollection',
        features: geoJsonData.features.filter(f => {
            const feats = getLevelsFromFeature(f);
            if (feats.length === 0 && (f.properties.entrance || f.properties.door)) return true;
            return feats.includes(level);
        })
    };

    map.getSource('indoor-geojson').setData(levelFeatures);

    updateRouteVisibility(level);
    updateSelectedHighlight(level);
    _drawRoomIcons(level);
    _drawFavoriteIcons(level);
    drawLabels(level);

    if (typeof renderActivePoiCategory === 'function') {
        renderActivePoiCategory(level);
    }

    if (animate && typeof triggerBlueprintAnimation === 'function') {
        triggerBlueprintAnimation();
    }
}

function _drawFavoriteIcons(level) {
    _clearFavoriteMarkers();
    if (!geoJsonData) return;

    geoJsonData.features.forEach(f => {
        if (!isFavorite(f)) return;
        const levels = getLevelsFromFeature(f);
        if (!levels.includes(level)) return;

        const center = f.geometry.type === 'Point' 
            ? f.geometry.coordinates 
            : turf.centroid(f).geometry.coordinates;

        const el = document.createElement('div');
        el.className = 'map-icon';
        el.style.pointerEvents = 'none';
        el.innerHTML = `<span class="material-symbols-outlined" style="color: gold; text-shadow: 0 0 5px black; font-size: 24px;">star</span>`;

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([center[0], center[1]])
            .addTo(map);

        marker.getElement().style.pointerEvents = 'none';

        _favoriteMarkers.push(marker);
    });
}

/**
 * Szobakereső algoritmus külső adatbázis illesztéséhez.
 * @param {Object} feature - A térképi elem.
 * @returns {Object|null} A szoba adatbázis bejegyzése vagy null.
 */
function findBestRoomMatch(osmName, osmRef, osmLevel, buildingKey, osmAltName) {
    if (!osmName && !osmRef && !osmAltName) return null;
    
    // A keresési mag meghatározása
    let core = (osmRef || osmName || osmAltName || "").trim();
    if (core.toLowerCase().includes("névtelen") || core === "") return null;
    core = normalizeRoomId(core); 
    
    const b = buildingKey.toLowerCase(); 
    const rawLvl = (osmLevel || "0").split(';')[0];
    const lvlChars = getLevelChars(buildingKey, rawLvl);

    // Különszedjük a betűs szárnyat (wing) és a számot, pl. "kf50" -> wing:"kf", num:"50"
    let wing = "";
    let num = core;
    const splitMatch = core.match(/^([a-z]+)(\d+.*)$/);
    if (splitMatch) {
        wing = splitMatch[1]; 
        num = splitMatch[2];  
    }

    const candidates = new Set();
    
    // 1. Legvalószínűbb BME formátum: Épület + Mag (pl. "k" + "150" -> "k150", "i" + "b028" -> "ib028")
    candidates.add(b + core);
    // 2. Maga a nyers azonosító (pl. "qbf11", ha az OSM-ben már benne volt az épület)
    candidates.add(core);

    // 3. Szint alapú kombinációk
    lvlChars.forEach(lvl => {
        candidates.add(b + lvl + core); // pl. q + f + 11 -> qf11, k + 1 + 50 -> k150
        candidates.add(b + lvl + num);  // pl. k + 1 + 50 -> k150
        if (wing) {
            // Ha van betűs szárny (pl. KF50), megpróbáljuk az Épület + Szint + Szám kombót is (K + MF + 50)
            candidates.add(wing + lvl + num);
        }
    });

    const dbKeys = Object.keys(ROOM_DATABASE);

    // --- 0. KÖR: NÉV SZERINTI ILLESZTÉS (szöveges megnevezésű terek, alt_name támogatással) ---
    // Hasznos olyan speciális helyekhez, mint "Auditorium Maximum" / "AudMax", "Gazdaság- és Társadalomtudományi Olvasó", "Tankönyvolvasó", "Sóhajok Hídja"
    const namesToCheck = [osmName, osmAltName].filter(Boolean).map(normalizeRoomId);
    for (const n of namesToCheck) {
        if (n.length >= 4 && !/^\d+$/.test(n)) {
            for (const dbKey of dbKeys) {
                const entry = ROOM_DATABASE[dbKey];
                if (!entry || !entry.name) continue;
                const dbName = normalizeRoomId(entry.name);
                if (dbName === n || dbName.includes(n) || n.includes(dbName)) {
                    return entry;
                }
            }
        }
    }
    
    // --- 1. KÖR: PONTOS EGYEZÉS ---
    // Támogatja a zárójeles kiegészítéssel ellátott DB kulcsokat is (pl. "kf51" === "kf51(audmax)")
    for (const cand of candidates) {
        for (const dbKey of dbKeys) {
            const cleanKey = normalizeRoomId(dbKey);
            const baseKey = normalizeRoomId(dbKey.replace(/\(.*?\)/g, ""));
            if (cleanKey === cand || baseKey === cand) {
                return ROOM_DATABASE[dbKey]; 
            }
        }
    }
    
    // --- 2. KÖR: SZIGORÚ RÉSZLEGES EGYEZÉS (Fuzzy) ---
    for (const cand of candidates) {
        if (cand.length < 2) continue; 
        
        const candNum = cand.replace(new RegExp('^' + b), '');
        const isNumeric = /^\d+$/.test(candNum);

        for (const dbKey of dbKeys) {
            const cleanDbKey = normalizeRoomId(dbKey);
            
            // SZABÁLY 1: Az adatbázis kulcsnak az aktuális épület betűjével kell kezdődnie!
            if (!cleanDbKey.startsWith(b)) continue;

            const baseDbKey = normalizeRoomId(dbKey.replace(/\(.*?\)/g, ''));
            const dbNum = baseDbKey.replace(new RegExp('^' + b), '');

            // SZABÁLY 2: Részleges egyezés vizsgálata
            if (isNumeric) {
                // Numerikus terem esetén PONTOS számazonosság kell (pl. 37 nem lehet 371)
                if (dbNum === candNum || dbNum.startsWith(candNum + '_') || dbNum.startsWith(candNum + '/')) {
                    return ROOM_DATABASE[dbKey];
                }
            } else {
                // Betűs szárny esetén a teljes kódnak egyeznie kell a DB kulcs prefixével
                if (baseDbKey === cand || baseDbKey.startsWith(cand + '_') || baseDbKey.startsWith(cand + '/')) {
                    return ROOM_DATABASE[dbKey];
                }
            }
        }
    }
    
    return null;
}

/**
 * Ellenőrzi, hogy a felület asztali (desktop) oldalsó panel módban működik-e (>= 768px).
 * @returns {boolean}
 */
function isDesktopSidePanel() {
    return window.innerWidth >= 768;
}

/**
 * Meghatározza a megfelelő alapértelmezett SVG illusztráció elérési útját
 * a térképelem típusa és tulajdonságai alapján.
 * @param {Object} feature - A kiválasztott térképelem.
 * @returns {string} Az SVG fájl elérési útja.
 */
function getDefaultIllustration(feature) {
    if (!feature || !feature.properties) return 'assets/illustrations/default_room.svg';
    const p = feature.properties;
    const nameLower = (p.name || '').toLowerCase();
    const refLower = (p.ref || '').toLowerCase();

    // 1. Mosdó / WC
    if (p.toilets || p.amenity === 'toilets' || p.amenity === 'toilet' || p.room === 'toilets' || p.room === 'toilet' || p.indoor === 'toilets' || nameLower.includes('mosdó') || nameLower.includes('wc') || nameLower.includes('toalett') || nameLower.includes('vécé')) {
        return 'assets/illustrations/restroom.svg';
    }

    // 2. Lift / Felvonó
    if (p.highway === 'elevator' || p.amenity === 'elevator' || p.elevator === 'yes' || nameLower.includes('lift') || nameLower.includes('felvonó')) {
        return 'assets/illustrations/elevator.svg';
    }

    // 3. Lépcső / Lépcsőház
    if (p.highway === 'steps' || p.stairs === 'yes' || p.room === 'stairs' || p.indoor === 'steps' || nameLower.includes('lépcső')) {
        return 'assets/illustrations/stairs.svg';
    }

    // 4. Kávéautomata (külön prioritással a büfé és az általános automata előtt)
    if ((p.amenity === 'vending_machine' && p.vending && p.vending.includes('coffee')) || nameLower.includes('kávéautomata') || nameLower.includes('kávégép')) {
        return 'assets/illustrations/coffee_machine.svg';
    }

    // 5. Automata (ital, snack, édesség)
    if (p.amenity === 'vending_machine' || nameLower.includes('italautomata') || nameLower.includes('snack') || nameLower.includes('automata')) {
        return 'assets/illustrations/vending_machine.svg';
    }

    // 6. Mikró / ételmelegítő
    if (p.amenity === 'microwave' || p.microwave === 'yes' || nameLower.includes('mikró') || nameLower.includes('mikro') || nameLower.includes('mikrohullámú')) {
        return 'assets/illustrations/microwave.svg';
    }

    // 7. ATM / Bankautomata
    if (p.amenity === 'atm' || p.amenity === 'bank' || nameLower.includes('atm') || nameLower.includes('bankautomata') || nameLower.includes('készpénz')) {
        return 'assets/illustrations/atm.svg';
    }

    // 8. Büfé / Kávézó / Étkezés
    if (p.amenity === 'cafe' || p.amenity === 'fast_food' || p.amenity === 'restaurant' || p.shop || nameLower.includes('büfé') || nameLower.includes('kávézó') || nameLower.includes('menza') || nameLower.includes('étkezde')) {
        return 'assets/illustrations/buffet.svg';
    }

    // 9. Ruhatár
    if (p.amenity === 'cloakroom' || p.room === 'cloakroom' || nameLower.includes('ruhatár') || nameLower.includes('öltöző')) {
        return 'assets/illustrations/cloakroom.svg';
    }

    // 10. Számítógépterem / PC labor
    if (p.room === 'computer_lab' || p.room === 'computer' || nameLower.includes('számítógép') || nameLower.includes('pc labor') || nameLower.includes('számítástechnika') || refLower.includes('pc')) {
        return 'assets/illustrations/computer.svg';
    }

    // 11. Labor / Műhely / Kutatóhelyiség
    if (p.room === 'laboratory' || p.room === 'lab' || nameLower.includes('labor') || nameLower.includes('műhely') || nameLower.includes('kutató')) {
        return 'assets/illustrations/lab.svg';
    }

    // 12. Iroda / Tanszék / Adminisztráció
    if (p.room === 'office' || nameLower.includes('iroda') || nameLower.includes('tanszék') || nameLower.includes('dékán') || nameLower.includes('titkárság') || nameLower.includes('fogadóóra')) {
        return 'assets/illustrations/office.svg';
    }

    // 13. Ajtó / Bejárat
    if (p.door || p.entrance || p.indoor === 'door' || p.indoor === 'entrance' || nameLower.includes('ajtó') || nameLower.includes('bejárat') || nameLower.includes('főbejárat')) {
        return 'assets/illustrations/door.svg';
    }

    // 14. Raktár / Tároló / Szertár
    if (p.room === 'storage' || p.room === 'closet' || nameLower.includes('raktár') || nameLower.includes('tároló') || nameLower.includes('szertár')) {
        return 'assets/illustrations/storage.svg';
    }

    // 15. Folyosó / Közlekedő / Aula
    if (p.highway === 'corridor' || p.indoor === 'corridor' || p.room === 'corridor' || nameLower.includes('folyosó') || nameLower.includes('közlekedő') || nameLower.includes('aula')) {
        return 'assets/illustrations/corridor.svg';
    }

    // 16. Nagyelőadó
    if (p.room === 'auditorium' || p.room === 'lecture_hall' || nameLower.includes('előadó')) {
        return 'assets/illustrations/lecture_hall.svg';
    }

    // 17. Sima tanterem / alapértelmezett szoba
    return 'assets/illustrations/default_room.svg';
}

/**
 * Szinkronizálja az információs panel belső DOM elemeinek elrendezését
 * a képernyőméret (Desktop vs. Mobil) alapján:
 * - Desktopon:
 *   1. Képek (hero) a legtetejére (a header elé)
 *   2. Cím (header) közvetlenül utána
 *   3. Navigációs akciógombok közvetlenül a cím alá (külön sávban)
 *   4. Görgethető tartalom: Nyitvatartás (poi-details-container) legfelülre, utána leírás (room-note), utána tanterem chipek (room-meta)
 * - Mobilon:
 *   1. Képek vissza a room-data-container aljára
 *   2. Akciógombok vissza a sheet legaljára (a scrollContent után)
 *   3. Chipek legfelül, utána nyitvatartás, utána leírás
 */
function syncSheetLayoutForViewport() {
    const isDesktop = isDesktopSidePanel();
    const sheet = document.getElementById('bottom-sheet');
    const galleryWrapper = document.getElementById('gallery-container') || document.getElementById('room-gallery');
    const header = document.querySelector('.sheet-header');
    const footer = document.querySelector('.sheet-footer');
    const scrollContent = document.getElementById('sheet-scroll-content');
    const dataContainer = document.getElementById('room-data-container');
    const poiContainer = document.getElementById('poi-details-container');
    const noteEl = document.getElementById('room-note');
    const metaEl = document.querySelector('.room-meta');

    if (!sheet || !galleryWrapper || !header || !footer || !scrollContent || !dataContainer) return;

    if (isDesktop) {
        // --- DESKTOP ELRENDEZÉS ---
        // 1. Képek a legtetejére (a header elé)
        if (galleryWrapper.parentElement !== sheet) {
            sheet.insertBefore(galleryWrapper, header);
        }
        // 2. Cím (header) marad utána
        // 3. Navigációs gombok közvetlenül a cím alá (külön sáv)
        if (footer.parentElement === sheet && footer.previousElementSibling !== header) {
            header.after(footer);
        }
        // 4. Görgethető tartalom logikus sorrendje: Nyitvatartás legfelül -> Leírás -> Chipek
        if (poiContainer && dataContainer.firstElementChild !== poiContainer) {
            dataContainer.insertBefore(poiContainer, dataContainer.firstElementChild);
        }
        if (noteEl && poiContainer && noteEl.previousElementSibling !== poiContainer) {
            poiContainer.after(noteEl);
        }
        if (metaEl && noteEl && metaEl.previousElementSibling !== noteEl) {
            noteEl.after(metaEl);
        }
    } else {
        // --- MOBIL ELRENDEZÉS (100% eredeti állapot visszaállítása) ---
        // 1. Képek vissza a tartalomkonténer aljára
        if (galleryWrapper.parentElement !== dataContainer) {
            dataContainer.appendChild(galleryWrapper);
        }
        // 2. Footer vissza a legalsó fix helyre
        if (footer.parentElement === sheet && sheet.lastElementChild !== footer) {
            sheet.appendChild(footer);
        }
        // 3. Mobilon: Chipek legfelül -> Nyitvatartás -> Leírás -> Galéria
        if (metaEl && dataContainer.firstElementChild !== metaEl) {
            dataContainer.insertBefore(metaEl, dataContainer.firstElementChild);
        }
        if (poiContainer && metaEl && poiContainer.previousElementSibling !== metaEl) {
            metaEl.after(poiContainer);
        }
        if (noteEl && poiContainer && noteEl.previousElementSibling !== poiContainer) {
            poiContainer.after(noteEl);
        }
        // 4. Mobilon az illusztrációs default artot rejtjük
        const defaultArt = galleryWrapper.querySelector('.gallery-default-art');
        if (defaultArt) {
            galleryWrapper.style.display = 'none';
        }
    }
}

let _galleryDragInitialized = false;
let _isGalleryDragging = false;
let _galleryStartX = 0;
let _galleryStartY = 0;
let _galleryScrollStart = 0;
let _galleryMovedDistance = 0;

/**
 * Kezeli a galéria egérrel és érintéssel történő húzását (drag-to-scroll / swipe).
 */
function initGalleryDrag() {
    if (_galleryDragInitialized) return;
    const galleryEl = document.getElementById('room-gallery');
    if (!galleryEl) return;
    _galleryDragInitialized = true;

    // Érintéses (touch) események kezelése mobilon az akaratlan képkattintások megelőzésére húzás közben
    galleryEl.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length > 0) {
            _galleryStartX = e.touches[0].pageX;
            _galleryStartY = e.touches[0].pageY;
            _galleryMovedDistance = 0;
        }
    }, { passive: true });

    galleryEl.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches.length > 0) {
            const deltaX = Math.abs(e.touches[0].pageX - _galleryStartX);
            const deltaY = Math.abs(e.touches[0].pageY - _galleryStartY);
            _galleryMovedDistance = Math.max(_galleryMovedDistance, deltaX, deltaY);
        }
    }, { passive: true });

    galleryEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.gallery-nav-btn') || e.target.closest('.gallery-dots')) return;
        if (!isDesktopSidePanel()) return;

        _isGalleryDragging = true;
        _galleryMovedDistance = 0;
        _galleryStartX = e.pageX;
        _galleryScrollStart = galleryEl.scrollLeft;
        galleryEl.style.scrollBehavior = 'auto';
        galleryEl.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
        if (!_isGalleryDragging) return;
        const deltaX = e.pageX - _galleryStartX;
        _galleryMovedDistance = Math.abs(deltaX);
        const galleryEl = document.getElementById('room-gallery');
        if (galleryEl) {
            galleryEl.scrollLeft = _galleryScrollStart - deltaX;
        }
    });

    window.addEventListener('mouseup', () => {
        if (!_isGalleryDragging) return;
        _isGalleryDragging = false;
        const galleryEl = document.getElementById('room-gallery');
        if (!galleryEl) return;
        galleryEl.style.cursor = '';
        galleryEl.style.scrollBehavior = 'smooth';
        if (_galleryMovedDistance > 10) {
            const width = galleryEl.clientWidth || 1;
            const targetIndex = Math.round(galleryEl.scrollLeft / width);
            galleryEl.scrollTo({ left: targetIndex * width, behavior: 'smooth' });
        }
    });
}

/**
 * Beállítja a képgaléria Material 3 stílusú lapozását, navigációs gombjait és indikátor pöttyöket.
 * @param {number} imageCount - A képek száma.
 */
function setupGalleryCarousel(imageCount) {
    const container = document.getElementById('gallery-container');
    const galleryEl = document.getElementById('room-gallery');
    const prevBtn = document.getElementById('gallery-nav-prev');
    const nextBtn = document.getElementById('gallery-nav-next');
    const dotsContainer = document.getElementById('gallery-dots');

    if (!galleryEl) return;

    // Mindig alaphelyzetbe állítjuk a vízszintes görgetést
    galleryEl.scrollLeft = 0;
    initGalleryDrag();

    // Csak desktopon és csak 1-nél több kép esetén jelenítünk meg navigációt
    const showControls = isDesktopSidePanel() && imageCount > 1;

    if (!showControls) {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (dotsContainer) dotsContainer.style.display = 'none';
        galleryEl.onscroll = null;
        if (container) container.onkeydown = null;
        return;
    }

    if (prevBtn) {
        prevBtn.style.display = 'flex';
        prevBtn.disabled = true;
    }
    if (nextBtn) {
        nextBtn.style.display = 'flex';
        nextBtn.disabled = (imageCount <= 1);
    }

    // Material 3 indikátor pöttyök (pill capsule) generálása
    if (dotsContainer) {
        dotsContainer.style.display = 'flex';
        dotsContainer.innerHTML = '';
        for (let i = 0; i < imageCount; i++) {
            const dot = document.createElement('button');
            dot.className = `gallery-dot${i === 0 ? ' active' : ''}`;
            dot.type = 'button';
            dot.setAttribute('aria-label', `${i + 1}. kép`);
            dot.onclick = (e) => {
                e.stopPropagation();
                const width = galleryEl.clientWidth || 1;
                galleryEl.scrollTo({ left: i * width, behavior: 'smooth' });
            };
            dotsContainer.appendChild(dot);
        }
    }

    // Görgetési állapot szinkronizálása (animáció, swipe vagy gombnyomás után)
    galleryEl.onscroll = () => {
        const width = galleryEl.clientWidth || 1;
        const activeIndex = Math.min(imageCount - 1, Math.max(0, Math.round(galleryEl.scrollLeft / width)));

        if (dotsContainer) {
            const dots = dotsContainer.children;
            for (let i = 0; i < dots.length; i++) {
                dots[i].classList.toggle('active', i === activeIndex);
            }
        }
        if (prevBtn) prevBtn.disabled = (activeIndex === 0);
        if (nextBtn) nextBtn.disabled = (activeIndex >= imageCount - 1);
    };

    // Lapozó gombok eseménykezelői
    if (prevBtn) {
        prevBtn.onclick = (e) => {
            e.stopPropagation();
            const width = galleryEl.clientWidth || 1;
            const activeIndex = Math.round(galleryEl.scrollLeft / width);
            const targetIndex = Math.max(0, activeIndex - 1);
            galleryEl.scrollTo({ left: targetIndex * width, behavior: 'smooth' });
        };
    }

    if (nextBtn) {
        nextBtn.onclick = (e) => {
            e.stopPropagation();
            const width = galleryEl.clientWidth || 1;
            const activeIndex = Math.round(galleryEl.scrollLeft / width);
            const targetIndex = Math.min(imageCount - 1, activeIndex + 1);
            galleryEl.scrollTo({ left: targetIndex * width, behavior: 'smooth' });
        };
    }

    // Billentyűzet navigáció (bal/jobb nyíl, ha a fókusz a galérián vagy benne van)
    if (container) {
        container.tabIndex = 0;
        container.onkeydown = (e) => {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (prevBtn && !prevBtn.disabled) prevBtn.click();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (nextBtn && !nextBtn.disabled) nextBtn.click();
            }
        };
    }
}

/**
 * Megnyitja az alsó információs panelt (Bottom Sheet) a kiválasztott térképelemhez.
 * @param {Object} feature - A megjelenítendő GeoJSON feature.
 */
function openSheet(feature) {
    // DOM elrendezés szinkronizálása a kijelzőméretnek megfelelően
    syncSheetLayoutForViewport();

    // EMBED MÓD KEZELÉSE: A mini floating info bar megjelenítése a bottom sheet helyett
    if (IS_EMBED_MODE) {
        openEmbedInfo(feature);
        return;
    }

    // Alaphelyzetbe állítjuk a közeli kereső menüt, ha esetleg nyitva maradt volna egy előző keresésből
    if (typeof resetNearbyMenu === 'function') resetNearbyMenu();

    // --- NAVIGÁCIÓ KEZELÉSE ÉS MEGSZAKÍTÁSA ---
    // Ha jelenleg aktív útvonaltervezés (navigáció) fut
    if (activeRouteData) {
        // Ellenőrizzük, hogy a kattintott elem megegyezik-e a már beállított kezdő- vagy végponttal
        const isStart = activeNavSource && activeNavSource.id === feature.id;
        const isEnd = activeNavTarget && activeNavTarget.id === feature.id;

        // Ha a felhasználó egy teljesen új (harmadik) helyre kattint, megszakítjuk az aktív navigációt,
        // A panel nyitva tartása a kijelölés váltásakor
        if (!isStart && !isEnd) {
            clearRouteDataOnly(); 
        }
    }

    // Az aktuálisan fókuszban lévő elem globális regisztrálása
    selectedFeature = feature;
    
    // Csatlakozópontos (hálózat alapú) indulási pont (Pending Nav Source) kezelése
    // Ha a felhasználó a "Hova mész innen?" gombot nyomta meg korábban, 
    // az új kattintás automatikusan elindítja a navigációt e két pont között.
    if (pendingNavSource) {
        startNavigation(selectedFeature, pendingNavSource);
        pendingNavSource = null;
        // Keresőmező vizuális visszaállítása
        document.getElementById('search-input').placeholder = "Keress...";
        return; // Kilépünk a függvényből, mivel a panel megnyitása helyett útvonaltervezés indul
    }

    const header = document.querySelector('.sheet-header');
    if (header) header.classList.remove('nav-mode');
    const footer = document.querySelector('.sheet-footer');
    if (footer) footer.style.display = 'flex';
    
    const p = feature.properties;
    
    // --- 1. TÍPUS FORDÍTÁSA ÉS MAGYARÍTÁS ---
    // A helyiség típusának lekérése és lefordítása magyar nyelvre
    let typeName = getHungarianType(p);
    // Formázás: Az első betű nagybetűsítése a szebb megjelenés érdekében (pl. "mosdó" -> "Mosdó")
    typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);

    // --- 2. MEGJELENÍTENDŐ NÉV (DISPLAY NAME) MEGHATÁROZÁSA ---
    let displayName = "";

    if (p.name && p.ref) {
        // Ha van Név és Ref is, megnézzük, hogy a Ref benne van-e a Névben
        const cleanName = p.name.toLowerCase().replace(/[\s-]/g, '');
        const cleanRef = p.ref.toLowerCase().replace(/[\s-]/g, '');
        
        if (cleanName.includes(cleanRef)) {
            // Ha a név már tartalmazza a kódot (pl. "QBF11 Labor"), elég csak a nevet kiírni
            displayName = p.name;
        } else {
            // Ha teljesen más a kettő (pl. Ref: "IB028", Name: "Auditorium Maximum"), összekötjük őket
            displayName = `${p.ref} - ${p.name}`;
        }
    } else {
        // Ha csak az egyik van meg, azt használjuk
        displayName = p.name || p.ref;
    }

    // Névszűrés: azonosító vagy hiányzó név kezelése
    if (!displayName || (!isNaN(displayName) && displayName.toString().length > 5)) {
        let matchedPoiName = null;
        // Megvizsgáljuk, hogy az elem illeszkedik-e valamelyik POI konfigurációra
        if (typeof POI_TYPES !== 'undefined') {
            for (const key in POI_TYPES) {
                if (POI_TYPES[key].filter(p)) { 
                    matchedPoiName = POI_TYPES[key].name; 
                    break; 
                }
            }
        }
        displayName = matchedPoiName || typeName;
    }

    // --- 3. SZINT-INFORMÁCIÓK MEGJELENÍTÉSE (Alias Logika bevonásával) ---
    let displayLevelString = "";
    
    // A) Lokális felülírás: Ha a térképelem rendelkezik egyedi szint-megnevezéssel 
    if (p['level:ref']) {
        displayLevelString = p['level:ref'];
    } 
    // B) Globális alias fordítás
    else {
        const rawLevels = getLevelsFromFeature(feature);
        const mappedLevels = rawLevels.map(lvl => {
            return levelAliases[lvl] || lvl;
        });
        displayLevelString = mappedLevels.join(', ');
    }

    // --- DOM (HTML) ELEMEK FRISSÍTÉSE ---
    document.getElementById('sheet-title').innerText = displayName;
    
    // Alcím generálása OSM tagek alapján
    let extraInfo = "";
    if (p.amenity === 'vending_machine' && p.vending) {
        // Szótár a fordításhoz
        const vDict = { 'coffee': 'Kávé', 'drinks': 'Ital', 'sweets': 'Édesség', 'snack': 'Snack', 'food': 'Étel' };
        // A pontosvesszővel elválasztott értékek szétdarabolása (pl. "coffee;drinks" -> ["coffee", "drinks"])
        const types = p.vending.split(';');
        // Lefordítjuk az elemeket, és ha nincs a szótárban, az eredetit hagyjuk meg
        const translated = types.map(tKey => {
            const raw = tKey.trim();
            if (typeof t === 'function') {
                const trans = t(`vending.${raw}`);
                if (trans && trans !== `vending.${raw}`) return trans;
            }
            return vDict[raw] || raw;
        });
        // Elemek összefűzése vesszővel elválasztott listává
        extraInfo = translated.join(', ');
    } else if (p.operator) {
        // Operátor megjelenítése (pl. ATM esetében a bank neve)
        extraInfo = p.operator; 
    }

    const lvlPrefix = typeof t === 'function' ? (t('sheet.level_prefix') || 'Szint') : 'Szint';
    if (extraInfo) {
        document.getElementById('sheet-sub').innerText = `${lvlPrefix}: ${displayLevelString} | ${extraInfo}`;
    } else if (displayName === typeName) {
        document.getElementById('sheet-sub').innerText = `${lvlPrefix}: ${displayLevelString}`;
    } else {
        document.getElementById('sheet-sub').innerText = `${lvlPrefix}: ${displayLevelString} | ${typeName}`;
    }
    
    // --- 4. KÜLSŐ ADATBÁZIS (ROOM_DATABASE) LEKÉRDEZÉSE ---
    // Kinyerjük a legelső szintet a kereséshez
    const rawLevel = getLevelsFromFeature(feature)[0] || "0";
    // Szobakeresés futtatása a részletesebb metaadatokért
    const roomData = findBestRoomMatch(p.name, p.ref, rawLevel, currentBuildingKey, p.alt_name);
    
    const dataContainer = document.getElementById('room-data-container');

    // --- 4.5 OSM POI ADATOK (Nyitvatartás, Weboldal) ---
    const poiContainer = document.getElementById('poi-details-container');
    const hoursRow = document.getElementById('poi-hours-row');
    const hoursText = document.getElementById('poi-hours-text');
    const webRow = document.getElementById('poi-website-row');
    const webLink = document.getElementById('poi-website-link');
    
    let hasPoiData = false;

    // Weboldal kezelése
    if (p.website || p['contact:website']) {
        const url = p.website || p['contact:website'];
        webLink.href = url.startsWith('http') ? url : 'https://' + url;
        webLink.innerText = url.replace('https://', '').replace('http://', '').split('/')[0]; // Domain név kiírása
        webRow.style.display = 'flex';
        hasPoiData = true;
    } else {
        webRow.style.display = 'none';
    }

    // Nyitvatartás kezelése és értelmezése
    if (p.opening_hours) {
        const rawHours = escapeHTML(p.opening_hours);
        let formattedHours = rawHours;
        let isOpenNowHtml = "";

        if (rawHours === '24/7') {
            const open247Text = typeof t === 'function' ? t('hours.open_24_7') : 'Nyitva (0-24)';
            const everydayText = typeof t === 'function' ? t('hours.everyday') : 'Mindennap nyitva';
            isOpenNowHtml = `<span class="status-open">${open247Text}</span><br>`;
            formattedHours = everydayText;
        } else {
            // Magyarítás/lokalizálás szótár az OSM napokhoz
            const daysDict = { 'Mo': 'Hétfő', 'Tu': 'Kedd', 'We': 'Szerda', 'Th': 'Csütörtök', 'Fr': 'Péntek', 'Sa': 'Szombat', 'Su': 'Vasárnap', 'off': 'Zárva', 'closed': 'Zárva' };
            
            // Szövegcsere az aktuális nyelvre
            for (const [dayKey, huFallback] of Object.entries(daysDict)) {
                let transDay = huFallback;
                if (typeof t === 'function') {
                    if (dayKey === 'off' || dayKey === 'closed') {
                        transDay = t('hours.closed');
                    } else {
                        transDay = t(`days.${dayKey}`) || huFallback;
                    }
                }
                formattedHours = formattedHours.replace(new RegExp(dayKey, 'g'), transDay);
            }
            // Sortörések beillesztése a pontosvesszőknél
            formattedHours = formattedHours.split(';').map(s => s.trim()).join('<br>');

            // EGYSZERŰ NYITVA TARTÁS ELLENŐRZŐ (Hétköznapi formátumokra)
            try {
                const now = new Date();
                const currentDayStr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][now.getDay()];
                const currentMins = now.getHours() * 60 + now.getMinutes();
                
                // Megnézzük, szerepel-e a mai nap (vagy napköz) a stringben, és kinyerjük az időt (pl. 08:00-16:00)
                const timeMatch = rawHours.match(new RegExp(`(?:${currentDayStr}|Mo-Fr).*?(\\d{2}):(\\d{2})\\s*-\\s*(\\d{2}):(\\d{2})`));
                
                if (timeMatch) {
                    const startMins = parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]);
                    const endMins = parseInt(timeMatch[3]) * 60 + parseInt(timeMatch[4]);
                    
                    if (currentMins >= startMins && currentMins <= endMins) {
                        const openText = typeof t === 'function' ? t('hours.open') : 'Nyitva';
                        isOpenNowHtml = `<span class="status-open">${openText}</span><br>`;
                    } else {
                        const closedText = typeof t === 'function' ? t('hours.closed') : 'Zárva';
                        isOpenNowHtml = `<span class="status-closed">${closedText}</span><br>`;
                    }
                }
            } catch (e) { /* Csendes hibakezelés */ }
        }

        hoursText.innerHTML = isOpenNowHtml + `<span style="opacity:0.8; font-size:13px;">${formattedHours}</span>`;
        hoursRow.style.display = 'flex';
        hasPoiData = true;
    } else {
        hoursRow.style.display = 'none';
    }

    poiContainer.style.display = hasPoiData ? 'flex' : 'none';
    
    const isAccessible = p.wheelchair === 'yes';

    // A Fő konténer láthatósága: ha BÁRMELYIK adat létezik (Terem infó VAGY POI infó VAGY Akadálymentes)
    if (roomData || hasPoiData || isAccessible) {
        dataContainer.style.display = 'block';
    } else {
        dataContainer.style.display = 'none';
    }

    // --- TEREM-ADATBÁZIS SPECIFIKUS ELEMEK KEZELÉSE ---
    const noteEl = document.getElementById('room-note');
    const galleryContainer = document.getElementById('gallery-container');
    const galleryEl = document.getElementById('room-gallery');

    // Chipek (kapacitás, címkék, felszereltség, funkciók, akadálymentesség) dinamikus kirajzolása
    renderRoomMeta(roomData, isAccessible);

    if (roomData || isAccessible) {
        if (noteEl) {
            const noteText = getRoomNote(roomData);
            if (noteText && noteText.trim() !== "") {
                const escaped = escapeHTML(noteText.trim());
                const linked = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: var(--color-ui-active); text-decoration: underline; font-weight: 500;">$1</a>');
                noteEl.innerHTML = linked;
                noteEl.style.display = 'block';
            } else {
                noteEl.innerHTML = "";
                noteEl.style.display = 'none';
            }
        }
        
        if (galleryEl) {
            galleryEl.innerHTML = ""; 
            if (roomData && roomData.images && roomData.images.length > 0) {
                if (galleryContainer) galleryContainer.style.display = 'block';
                galleryEl.style.display = 'flex';
                roomData.images.forEach((url, idx) => {
                    const img = document.createElement('img');
                    img.src = url;
                    img.className = 'gallery-img';
                    img.draggable = false;
                    img.onclick = () => {
                        if (_galleryMovedDistance > 8) return;
                        openImageViewer(roomData.images, idx);
                    };
                    galleryEl.appendChild(img);
                });
                setupGalleryCarousel(roomData.images.length);
            } else if (isDesktopSidePanel()) {
                // Desktopon stílusos kategória vektorgrafika, ha nincs fotó
                if (galleryContainer) galleryContainer.style.display = 'block';
                galleryEl.style.display = 'flex';
                const defaultArtSrc = getDefaultIllustration(feature);
                const img = document.createElement('img');
                img.src = defaultArtSrc;
                img.className = 'gallery-img gallery-default-art';
                img.alt = typeName || 'Terem';
                img.draggable = false;
                galleryEl.appendChild(img);
                setupGalleryCarousel(1);
            } else {
                if (galleryContainer) galleryContainer.style.display = 'none';
                galleryEl.style.display = 'none';
                setupGalleryCarousel(0);
            }
        }
    } else {
        if (noteEl) {
            noteEl.innerHTML = "";
            noteEl.style.display = 'none';
        }
        if (galleryEl) {
            galleryEl.innerHTML = "";
            if (isDesktopSidePanel()) {
                if (galleryContainer) galleryContainer.style.display = 'block';
                galleryEl.style.display = 'flex';
                const defaultArtSrc = getDefaultIllustration(feature);
                const img = document.createElement('img');
                img.src = defaultArtSrc;
                img.className = 'gallery-img gallery-default-art';
                img.alt = typeName || 'Helyszín';
                img.draggable = false;
                galleryEl.appendChild(img);
                setupGalleryCarousel(1);
            } else {
                if (galleryContainer) galleryContainer.style.display = 'none';
                galleryEl.style.display = 'none';
                setupGalleryCarousel(0);
            }
        }
    }

    // --- 5. MAGASSÁG-SZABÁLYOZÁS (AUTO-HEIGHT) ---
    // Azonnal kiszámítjuk a végleges célmagasságot a betöltött tartalom alapján (késleltetés nélkül)
    const autoH = getAutoHeight();
    const targetHeight = (roomData || hasPoiData) ? autoH : (getPeekHeight() + 20);

    // Az információs panel (Sheet) végleges magasságának és nyitott állapotának azonnali beállítása
    const sheet = document.getElementById('bottom-sheet');
    const wasAlreadyOpen = sheet && sheet.classList.contains('open');

    // Nyitott panel esetén magasság- és tartalomváltó átmenet indítása
    if (wasAlreadyOpen) {
        sheet.style.transition = 'height 0.35s cubic-bezier(0.2, 0, 0, 1)';
        const scrollContent = document.getElementById('sheet-scroll-content');
        const headerText = document.querySelector('.header-text-wrapper');
        if (scrollContent) {
            scrollContent.classList.remove('sheet-content-swap');
            void scrollContent.offsetWidth; // Újraindítja a CSS animációt
            scrollContent.classList.add('sheet-content-swap');
            scrollContent.scrollTop = 0; // Visszaállítja a görgetést a tetejére
        }
        if (headerText) {
            headerText.classList.remove('sheet-content-swap');
            void headerText.offsetWidth;
            headerText.classList.add('sheet-content-swap');
        }
    }

    if (isDesktopSidePanel()) {
        sheet.style.height = '';
    } else {
        sheet.style.height = `${targetHeight}px`;
        // Állapot nyilvántartás frissítése
        _sheetState = (targetHeight >= getAutoHeight() - 5) ? 'auto' : 'peek';
    }
    sheet.classList.add('open');
    sheet.classList.remove('sheet-full');

    // A kedvenc (csillag) gomb vizuális állapotának frissítése a jelenlegi elem alapján
    updateFavoriteUI(); 

    // A kiválasztott elem vizuális kiemelése (sárga keret) a térképen
    drawSelectedHighlight(feature);
    
    // Kamera mozgatása a célmagasság (targetHeight) alapján
    smartFlyTo(feature, targetHeight);
}

/**
 * Frissíti és átalakítja az alsó információs panelt (Bottom Sheet) útvonaltervezési (navigációs) nézetre.
 * Megjeleníti az útvonal összesített statisztikáit (idő, távolság), valamint egy interaktív,
 * lépésről lépésre követhető útvonaltervet (itinert).
 * @param {Object} targetFeature - A célpont GeoJSON térképeleme.
 * @param {Object} stats - Az útvonal statisztikái, jellemzően { time: szám, dist: szám } formátumban.
 * @param {Array<Object>} itinerary - Az útvonal lépéseit (szint, ikon, szöveg) tartalmazó tömb.
 * @param {Object} [sourceFeature] - A kiindulópont GeoJSON térképeleme.
 */
function updateSheetForNavigation(targetFeature, stats, itinerary, sourceFeature) {
    const sheet = document.getElementById('bottom-sheet');
    const header = document.querySelector('.sheet-header');
    
    // A panel fejlécének átállítása navigációs vizuális módba
    header.classList.add('nav-mode');

    const title = document.getElementById('sheet-title');
    const sub = document.getElementById('sheet-sub');
    const content = document.getElementById('sheet-scroll-content');
    
    /**
     * Belső segédfüggvény a térképelemek formázott és egységes megjelenítési nevének előállítására.
     * @param {Object} feat - A formázandó GeoJSON térképelem.
     * @returns {string} A formázott név.
     */
    const formatName = (feat) => {
        if (!feat || !feat.properties) return "Ismeretlen hely";
        const p = feat.properties;
        
        let name = "";
        let isPoi = false;

        // Név és ref kombinálása az itinerben
        if (p.name && p.ref) {
            const cleanName = p.name.toLowerCase().replace(/[\s-]/g, '');
            const cleanRef = p.ref.toLowerCase().replace(/[\s-]/g, '');
            if (cleanName.includes(cleanRef)) {
                name = p.name;
            } else {
                name = `${p.ref} - ${p.name}`;
            }
        } else {
            name = p.name || p.ref;
        }

        // Ha nincs neve, vagy csak egy értelmetlen OSM azonosító szám
        if (!name || (!isNaN(name) && name.toString().length > 5)) {
            let matchedPoiName = null;
            if (typeof POI_TYPES !== 'undefined') {
                for (const key in POI_TYPES) {
                    if (POI_TYPES[key].filter(p)) { 
                        matchedPoiName = POI_TYPES[key].name; 
                        isPoi = true; // Megjegyezzük, hogy ez egy POI
                        break; 
                    }
                }
            }
            name = matchedPoiName || (typeof getHungarianType === 'function' ? getHungarianType(p) : "Hely");
        }

        const lower = name.toLowerCase();
        // Kibővített szűrés: a dedikált POI-k (isPoi) sosem kapnak "terem" utótagot
        const hasType = isPoi || lower.includes('terem') || lower.includes('labor') || 
                        lower.includes('mosdó') || lower.includes('wc') || 
                        lower.includes('lépcső') || lower.includes('bejárat') || 
                        lower.includes('porta') || lower.includes('büfé') || 
                        lower.includes('automata') || lower.includes('mikró') || 
                        lower.includes('atm');
        
        // Csak az egyszerű szobaszámok (pl. "QBF11") kapják meg a " terem" végződést
        if (!hasType && name.length < 20) name += " terem";
        
        return escapeHTML(name);
    };

    // A cél- és kiindulópont megjelenítési nevének meghatározása
    const targetName = formatName(targetFeature);
    const sourceName = sourceFeature ? formatName(sourceFeature) : (typeof t === 'function' ? (t('nav.selected_point') || "Kijelölt pont") : "Kijelölt pont");

    // --- 2. FEJLÉC (Header) TARTALMÁNAK FRISSÍTÉSE ---
    
    // Főcím: Az utazás becsült idejének kiemelt megjelenítése
    const timeText = typeof t === 'function' ? t('nav.time_minutes', { time: stats.time }) : `${stats.time} perc`;
    title.innerHTML = `
        <div style="color:var(--text-main); font-size:26px; font-weight:800; letter-spacing:-0.5px; line-height:1.2;">
            ${timeText}
        </div>
    `;
    
    // Alcím: Az össztávolság és a célpont nevének megjelenítése
    const distText = typeof t === 'function' ? t('nav.dist_meters', { dist: stats.dist }) : `${stats.dist} m`;
    sub.innerHTML = `
        <div style="font-size:14px; color:var(--text-sub); margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${distText} &bull; ${targetName}">
            ${distText} <span style="margin:0 4px; opacity:0.5;">&bull;</span> ${targetName}
        </div>
    `;

    // --- 3. TARTALOM (Itiner) FELÉPÍTÉSE ---
    
    // Az általános helyiségadatok (room-data-container) elrejtése navigációs módban
    document.getElementById('room-data-container').style.display = 'none';
    
    // Az útvonalterv konténerének lekérése vagy dinamikus létrehozása, ha még nem létezik
    let itineraryDiv = document.getElementById('nav-itinerary');
    if (!itineraryDiv) {
        itineraryDiv = document.createElement('div');
        itineraryDiv.id = 'nav-itinerary';
        content.appendChild(itineraryDiv);
    }
    itineraryDiv.style.display = 'block';
    
    // Az útvonalterv HTML struktúrájának összeállítása
    let html = `<div style="display:flex; flex-direction:column; gap:12px;">`;
    
    const clickToViewText = typeof t === 'function' ? t('nav.click_to_view') : 'Kattints a megtekintéshez';
    const startText = typeof t === 'function' ? t('nav.start', { source: sourceName }) : `Indulás: ${sourceName}`;
    const arrivalText = typeof t === 'function' ? t('nav.arrival', { target: targetName }) : `Megérkezés: ${targetName}`;

    // Indulási pont HTML sorának generálása kattintható (fókuszáló) eseménykezelővel
    html += `
        <div class="itiner-step clickable-step" onclick="focusOnEndpoint('start')">
            <div class="itiner-icon start"><span class="material-symbols-outlined">trip_origin</span></div>
            <div class="itiner-text">
                <div style="font-weight:bold; font-size:15px; color:var(--text-main);">${startText}</div>
                <div style="font-size:12px; color:var(--text-sub); margin-top:2px;">${clickToViewText}</div>
            </div>
        </div>
    `;

    // A navigációs lépések (irányok, szintváltások) iterálása és HTML generálása
    itinerary.forEach(step => {
        const safeText = escapeHTML(step.text);
        const safeIcon = escapeHTML(step.icon);
        const safeLevel = escapeHTML(step.level);
        html += `
            <div class="itiner-step clickable-step" onclick="focusOnRouteSegment(this.dataset.level)" data-level="${safeLevel}">
                <div class="itiner-icon"><span class="material-symbols-outlined">${safeIcon}</span></div>
                <div class="itiner-text">
                    <div style="font-weight:bold; font-size:15px; color:var(--text-main);">${safeText}</div>
                    <div style="font-size:12px; color:var(--text-sub); margin-top:2px;">${clickToViewText}</div>
                </div>
            </div>
        `;
    });

    // Érkezési célpont HTML sorának generálása kattintható (fókuszáló) eseménykezelővel
    html += `
        <div class="itiner-step clickable-step" onclick="focusOnEndpoint('end')">
            <div class="itiner-icon end"><span class="material-symbols-outlined">location_on</span></div>
            <div class="itiner-text">
                <div style="font-weight:bold; font-size:15px; color:var(--text-main);">${arrivalText}</div>
                <div style="font-size:12px; color:var(--text-sub); margin-top:2px;">${clickToViewText}</div>
            </div>
        </div>
    `;
    // Térköz hozzáadása a tartalom alján a kényelmes görgetés érdekében
    html += `</div> <div style="height:24px;"></div>`; 
    
    itineraryDiv.innerHTML = html;

    // A képgaléria elrejtése navigációs nézetben
    const galleryContainer = document.getElementById('gallery-container');
    if (galleryContainer) galleryContainer.style.display = 'none';
    const gallery = document.getElementById('room-gallery');
    if (gallery) gallery.style.display = 'none';

    // Lábléc (footer) elrejtése navigációs nézetben
    const footer = document.querySelector('.sheet-footer');
    if (footer) footer.style.display = 'none';
    
    // A panel megjelenítése és részleges ('peek') állapotba történő összecsukása
    sheet.classList.add('open');
    collapseToPeek(); 
}

/**
 * Kameramozgatás és fókuszálás az adott útvonalszakaszra navigáció közben.
 * @param {number} segmentIndex - A fókuszálandó útvonalszakasz indexe.
 */
function focusOnRouteSegment(level) {
    if (!currentRoutePath || currentRoutePath.length === 0) return;

    switchLevel(level);

    const routePoints = [];
    currentRoutePath.forEach(key => {
        const parts = key.split(','); // Formátum: lat, lon, level
        if (parts[2] === level) {
            routePoints.push([parseFloat(parts[1]), parseFloat(parts[0])]);
        }
    });

    // Ha az indulási pont ezen a szinten van, bevonjuk annak teljes kiterjedését is
    if (activeNavSource) {
        const sLevels = getLevelsFromFeature(activeNavSource);
        if (sLevels.includes(level)) {
            _addFeatureCoordsToBounds(activeNavSource, routePoints);
        }
    }

    // Ha az érkezési pont ezen a szinten van, bevonjuk annak teljes kiterjedését is
    if (activeNavTarget) {
        const tLevels = getLevelsFromFeature(activeNavTarget);
        if (tLevels.includes(level)) {
            _addFeatureCoordsToBounds(activeNavTarget, routePoints);
        }
    }

    const validPoints = routePoints.filter(p => Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]));
    if (validPoints.length === 0) return;

    const lons = validPoints.map(p => p[0]);
    const lats = validPoints.map(p => p[1]);

    const isMobile = window.innerWidth <= 600;
    const sheet = document.getElementById('bottom-sheet');
    let padding;
    if (isDesktopSidePanel()) {
        const panelW = sheet ? (sheet.getBoundingClientRect().width || 390) : 390;
        padding = { top: 80, bottom: 50, left: panelW + 45, right: 75 };
    } else {
        const peekH = (typeof getPeekHeight === 'function') ? getPeekHeight() : 110;
        padding = { top: isMobile ? 125 : 80, bottom: peekH + 35, left: 30, right: 65 };
    }

    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    if (minLon === maxLon && minLat === maxLat) {
        map.flyTo({
            center: [minLon, minLat],
            zoom: 20,
            padding: padding,
            animate: true,
            duration: 1000
        });
    } else {
        map.fitBounds(
            [[minLon, minLat], [maxLon, maxLat]],
            {
                padding: padding,
                maxZoom: 20.2,
                animate: true,
                duration: 1000
            }
        );
    }
}

/**
 * Elindítja az útvonaltervezést (navigációt) úgy, hogy a jelenleg 
 * kiválasztott térképelem (selectedFeature) lesz a célpont.
 * Mivel az indulási pont (null), a rendszer egy későbbi interakciót vár annak megadására.
 */
function startNavigationToHere() { 
    startNavigation(selectedFeature, null); 
}

/**
 * Beállítja a jelenleg kiválasztott térképelemet navigációs indulási pontként (pendingNavSource).
 * Ezt követően bezárja az információs panelt, és a felhasználó fókuszát a keresőmezőre 
 * irányítja, amelynek helykitöltő (placeholder) szövegét dinamikusan frissíti, 
 * hogy egyértelműsítse a célpont megadásának szükségességét.
 */
function startNavigationFromHere() {
    // A kiválasztott elem regisztrálása várakozó indulási pontként
    pendingNavSource = selectedFeature; 
    
    // Az információs panel (Bottom Sheet) bezárása
    closeSheet(); 
    
    // A keresőmező manipulálása a célpont megadásának ösztönzésére
    const input = document.getElementById('search-input');
    input.value = "";
    
    // Dinamikus placeholder szöveg beállítása a kiválasztott elem referenciája alapján
    input.placeholder = `Hova mész innen: ${selectedFeature.properties.ref || "..."}?`;
    
    // Fókuszálás a keresőmezőre, hogy azonnal gépelni lehessen
    input.focus();
}

/**
 * Vizuális kiemelést (sárga keretet/aurát) rajzol a kiválasztott térképelem köré.
 * Először törli a korábbi kiemeléseket, majd egy új GeoJSON réteget hoz létre 
 * a megadott elem geometriája alapján, alkalmazva a kiemelési stílusokat (szín, vastagság).
 * @param {Object} feature - A kiemelni kívánt GeoJSON térképelem.
 */
function drawSelectedHighlight(feature) {
    if (!_mapLayersInitialized) return;
    

    document.querySelectorAll('.selected-poi').forEach(el => el.classList.remove('selected-poi'));

    if (!feature) {
        map.getSource('highlight-geojson').setData({ type: 'FeatureCollection', features: [] });
        return;
    }

    const p = feature.properties || {};
    const targetIdx = p._featureIndex;
    const targetRef = p.ref || p.name;

    let targetCoords = null;
    if (feature.geometry) {
        const c = (feature.geometry.type === "Point") 
            ? feature.geometry.coordinates 
            : (typeof turf !== 'undefined' && turf.centroid ? turf.centroid(feature).geometry.coordinates : null);
        if (c && c.length >= 2) {
            targetCoords = `${c[0].toFixed(6)},${c[1].toFixed(6)}`;
        }
    }

    let matchCount = 0;

    _roomIconMarkers.forEach(m => {
        const el = m.getElement();
        if (el && el.dataset) {
            const matchesIndex = targetIdx !== undefined && el.dataset.featureIndex == targetIdx;
            const matchesRef = targetRef && el.dataset.ref === targetRef;
            const matchesCoord = targetCoords && el.dataset.coords === targetCoords;
            if (matchesIndex || matchesRef || matchesCoord) {
                matchCount++;
                el.classList.add('selected-poi');
                const circle = el.querySelector('.poi-bg-circle');
                if (circle) circle.classList.add('selected-poi');
            }
        }
    });

    _poiMarkers.forEach(m => {
        const el = m.getElement();
        if (el && el.dataset) {
            const matchesIndex = targetIdx !== undefined && el.dataset.featureIndex == targetIdx;
            const matchesRef = targetRef && el.dataset.ref === targetRef;
            const matchesCoord = targetCoords && el.dataset.coords === targetCoords;
            if (matchesIndex || matchesRef || matchesCoord) {
                el.classList.add('selected-poi');
                const shape = el.querySelector('.poi-pin-shape');
                if (shape) shape.classList.add('selected-poi');
            }
        }
    });


    const data = feature.type === 'FeatureCollection' ? feature : { type: 'FeatureCollection', features: [feature] };
    map.getSource('highlight-geojson').setData(data);
    
    updateSelectedHighlight(currentLevel);
}

function updateSelectedHighlight(level) {
    if (!_mapLayersInitialized) return;
    
    const src = map.getSource('highlight-geojson');
    if (!src || !src._data || !src._data.features || src._data.features.length === 0) return;
    
    const feature = src._data.features[0];
    const feats = getLevelsFromFeature(feature);
    const visible = feats.length === 0 || feats.includes(level);
    
    if (map.getLayer('highlight-line')) map.setPaintProperty('highlight-line', 'line-opacity', visible ? 0.8 : 0);
    if (map.getLayer('highlight-circle')) map.setPaintProperty('highlight-circle', 'circle-stroke-opacity', visible ? 1 : 0);
}

/**
 * Bezárja az alsó információs panelt (Bottom Sheet) és visszaállítja a 
 * kiválasztással kapcsolatos térképi állapotokat (kiemelések, globális változók) 
 * az alaphelyzetükbe.
 */
function closeSheet() {
    if (IS_EMBED_MODE) {
        closeEmbedInfo();
        return;
    }

    if (typeof resetNearbyMenu === 'function') resetNearbyMenu();

    const header = document.querySelector('.sheet-header');
    if (header) header.classList.remove('nav-mode');

    const sheetEl = document.getElementById('bottom-sheet');
    if (sheetEl) {
        sheetEl.classList.remove('open');
        sheetEl.classList.remove('sheet-full');
        _sheetState = 'peek';
        setTimeout(() => {
            if (!sheetEl.classList.contains('open')) {
                sheetEl.style.height = '';
            }
        }, 350);
    }
    
    document.querySelectorAll('.selected-poi').forEach(el => el.classList.remove('selected-poi'));

    if (_mapLayersInitialized && map.getSource('highlight-geojson')) {
        map.getSource('highlight-geojson').setData({ type: 'FeatureCollection', features: [] });
    }
    _resetMapPadding();
    
    selectedFeature = null;

    _poiMarkers.forEach(m => {
        const el = m.getElement();
        if (el) {
            el.style.opacity = '1';
            el.style.filter = 'none';
            el.style.pointerEvents = 'auto';
            const shape = el.querySelector('.poi-pin-shape');
            if (shape) shape.style.transform = 'rotate(-45deg)';
        }
    });
}

function clearRouteDataOnly() {
    _resetMapPadding();
    if (_mapLayersInitialized) {
        if (map.getSource('route-geojson')) map.getSource('route-geojson').setData({ type: 'FeatureCollection', features: [] });
        if (map.getSource('highlight-geojson')) map.getSource('highlight-geojson').setData({ type: 'FeatureCollection', features: [] });
    }
    
    _clearRouteMarkers();
    _clearArrowMarkers();
    _clearPoiMarkers();
    activePoiCategory = null;
    
    pendingNavSource = null;
    activeRouteData = null;
    activeNavSource = null;
    activeNavTarget = null;
    currentRoutePath = [];
    
    const input = document.getElementById('search-input');
    input.placeholder = "Keress...";
    input.value = ""; 
    updateRightButtonState();

    const header = document.querySelector('.sheet-header');
    if (header) header.classList.remove('nav-mode');

    const footer = document.querySelector('.sheet-footer');
    if (footer) footer.style.display = 'flex'; 
    
    const btnTo = document.querySelector('.btn-nav-to');
    const btnFrom = document.querySelector('.btn-nav-from');
    if (btnTo) btnTo.style.display = 'flex';
    if (btnFrom) btnFrom.style.display = 'flex';
    
    const itinerDiv = document.getElementById('nav-itinerary');
    if (itinerDiv) itinerDiv.style.display = 'none';
    
    document.getElementById('room-data-container').style.display = 'block';
}

function clearRouteAndClose() {
    clearRouteDataOnly();
    closeSheet();
}

let _searchSelectedIndex = -1;
let _searchEnterHandled = false;
let _searchUserNavigated = false;

function _getSelectableSearchResults() {
    const resultsDiv = document.getElementById('search-results');
    if (!resultsDiv || resultsDiv.style.display === 'none') return [];
    return Array.from(resultsDiv.querySelectorAll('.result-item')).filter(el => {
        return typeof el.onclick === 'function' && el.style.cursor !== 'default';
    });
}

function _updateSearchSelection(items) {
    items.forEach((item, idx) => {
        if (idx === _searchSelectedIndex) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
}

function handleSearchKeyDown(e) {
    const resultsDiv = document.getElementById('search-results');
    if (!resultsDiv || resultsDiv.style.display === 'none') return;
    
    const items = _getSelectableSearchResults();
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        _searchUserNavigated = true;
        if (_searchSelectedIndex < items.length - 1) {
            _searchSelectedIndex++;
        } else {
            _searchSelectedIndex = 0;
        }
        _updateSearchSelection(items);
        items[_searchSelectedIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _searchUserNavigated = true;
        if (_searchSelectedIndex > 0) {
            _searchSelectedIndex--;
        } else {
            _searchSelectedIndex = items.length - 1;
        }
        _updateSearchSelection(items);
        items[_searchSelectedIndex].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
        if (_searchSelectedIndex >= 0 && _searchSelectedIndex < items.length) {
            // Ha a felhasználó nem navigált a nyilakkal, hanem közvetlenül gépelés után nyomott Entert,
            // és a beírt kifejezés egy POI kategória (pl. "kávé", "mosdó", "wc"),
            // akkor engedjük tovább a handleSearch keyup eseményére a POI kategória térképes megjelenítéséhez:
            if (!_searchUserNavigated) {
                const term = (document.getElementById('search-input').value || '').trim().toLowerCase();
                let matchedPoiKey = null;
                if (typeof POI_TYPES !== 'undefined') {
                    for (const [key, config] of Object.entries(POI_TYPES)) {
                        if (config.aliases && config.aliases.some(alias => term.includes(alias))) {
                            matchedPoiKey = key;
                            break;
                        }
                    }
                }
                if (matchedPoiKey) {
                    return;
                }
            }
            e.preventDefault();
            _searchEnterHandled = true;
            items[_searchSelectedIndex].click();
        }
    } else if (e.key === 'Escape') {
        resultsDiv.style.display = 'none';
        _searchSelectedIndex = -1;
        _searchUserNavigated = false;
    }
}

/**
 * Eseménykezelő a felhasználói keresések feldolgozására.
 * Kezeli az Enter billentyűt és az élő keresési szűrést.
 */
let _searchDebounceTimer = null;

function handleSearch(e) {
    if (_searchEnterHandled) {
        _searchEnterHandled = false;
        return;
    }

    if (e && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Escape')) {
        return;
    }

    // Az Enter billentyű leütése azonnal lefut késleltetés nélkül
    if (e && e.key === 'Enter') {
        if (_searchDebounceTimer) {
            clearTimeout(_searchDebounceTimer);
            _searchDebounceTimer = null;
        }
        _executeSearch(e);
        return;
    }

    // Gépelés (autocomplete) esetén 180 ms debounce
    if (_searchDebounceTimer) {
        clearTimeout(_searchDebounceTimer);
    }
    _searchDebounceTimer = setTimeout(() => {
        _executeSearch(e);
    }, 180);
}

function _executeSearch(e) {
    // A keresett kifejezés kinyerése és a felesleges szóközök eltávolítása
    const term = (e && e.target && e.target.value !== undefined) ? e.target.value.trim() : (document.getElementById('search-input')?.value || '').trim();
    const resultsDiv = document.getElementById('search-results');
    
    // ==========================================
    // 1. RÉSZ: ENTER BILLENTYŰ LEÜTÉSÉNEK KEZELÉSE
    // ==========================================
    if (e && e.key === 'Enter') {
        
        // --- 1. Prioritás: Generikus kategóriák (POI) kiemelése ---
        const lowerTerm = term.toLowerCase();
        let matchedPoiKey = null;
        
        for (const [key, config] of Object.entries(POI_TYPES)) {
            if (config.aliases && config.aliases.some(alias => lowerTerm.includes(alias))) {
                matchedPoiKey = key;
                break;
            }
        }

        if (matchedPoiKey) {
            showPoiCategory(matchedPoiKey); 
            resultsDiv.style.display = 'none'; 
            _searchSelectedIndex = -1;
            updateRightButtonState();
            return;
        }

        // --- 2. Prioritás: Helyi és Globális térképelemek keresése ---
        const localHits = smartFilter(term); 
        const otherHits = searchOtherBuildings(term);
        const allHits = mergeSearchResults(localHits, otherHits);

        if (allHits.length > 0) {
            const topHit = allHits[0];
            resultsDiv.style.display = 'none'; 
            _searchSelectedIndex = -1;
            _searchUserNavigated = false;

            if (topHit._isLocal) {
                openSheet(topHit);
                const val = topHit.properties.name || topHit.properties.ref || term;
                document.getElementById('search-input').value = val;
                updateRightButtonState();
                return; 
            } else {
                // Közvetlen épületváltás a célteremhez megerősítő kérdés nélkül!
                document.getElementById('search-input').value = topHit.properties.name || topHit.properties.ref || term;
                updateRightButtonState();
                changeBuilding(topHit._buildingKey, topHit.properties.name || topHit.properties.ref, topHit.id);
                return;
            }
        }

        // --- 3. Ha végképp semmi ---
        showToast(typeof t === 'function' ? t('toasts.no_search_results') : "Nincs találat erre a kifejezésre.");
        return; 
    }

    // ==========================================
    // 2. RÉSZ: GÉPELÉS KÖZBENI JAVASLATOK (AUTOCOMPLETE)
    // ==========================================
    
    // Az előző javaslatok törlése a tiszta újrarendereléshez
    resultsDiv.innerHTML = '';
    _searchSelectedIndex = -1;
    _searchUserNavigated = false;
    let hasResults = false;

    // Ha a felhasználó kiürítette a mezőt (pl. Backspace), elrejtjük a listát
    if (term.length < 1) { 
        resultsDiv.style.display = 'none'; 
        _searchSelectedIndex = -1;
        _searchUserNavigated = false;
        updateRightButtonState();
        return; 
    }

    // --- Autocomplete Találatok (Helyi és Más Épületek) ---
    // Csak akkor indítunk keresést, ha legalább 2 karaktert beírt a felhasználó (teljesítményoptimalizálás)
    if (term.length >= 2) {
        const localHits = smartFilter(term);
        const otherHits = searchOtherBuildings(term);
        const allHits = mergeSearchResults(localHits, otherHits);

        if (allHits.length > 0) {
            // A találati listát 7 legrelevánsabb elemre korlátozzuk
            allHits.slice(0, 7).forEach(hit => {
                const div = document.createElement('div');
                div.className = 'result-item';
                
                let displayName = hit.properties.name || hit.properties.ref || "???";
                if (hit.properties.name && hit.properties.ref && hit.properties.name !== hit.properties.ref) {
                    const cleanN = normalizeRoomId(hit.properties.name);
                    const cleanR = normalizeRoomId(hit.properties.ref);
                    if (!cleanN.includes(cleanR)) {
                        displayName = `${hit.properties.name} (${hit.properties.ref})`;
                    }
                }
                const rawLvl = getLevelsFromFeature(hit)[0] || hit.properties.level || "?";
                const lvl = hit.properties['level:ref'] || (hit._isLocal && typeof levelAliases !== 'undefined' && levelAliases[rawLvl]) || rawLvl;
                
                let levelBadge = "";
                if (hit._isLocal) {
                    levelBadge = typeof t === 'function' ? t('search.level_badge', { level: escapeHTML(lvl) }) : `(Szint: ${escapeHTML(lvl)})`;
                } else {
                    const bName = getBuildingName(hit._buildingKey);
                    const rawBadge = typeof t === 'function' ? t('search.level_badge', { level: escapeHTML(lvl) }) : `Szint: ${escapeHTML(lvl)}`;
                    levelBadge = `(${escapeHTML(bName)}, ${rawBadge.replace(/^\(|\)$/g, '')})`;
                }
                
                // A javaslat összeállítása: Név (kiemelve) és a szint / épület (halványan)
                div.innerHTML = `${escapeHTML(displayName)} <span style="opacity:0.6; font-size:12px; margin-left:5px;">${levelBadge}</span>`;
                
                // Kattintás esemény egy specifikus javaslatra: Fókuszálás, panel megnyitása és lista elrejtése
                div.onclick = () => { 
                    resultsDiv.style.display = 'none'; 
                    _searchSelectedIndex = -1;
                    _searchUserNavigated = false;
                    document.getElementById('search-input').value = hit.properties.name || hit.properties.ref || displayName; 
                    updateRightButtonState();

                    if (hit._isLocal) {
                        openSheet(hit); 
                    } else {
                        // Közvetlen épületváltás a célteremhez megerősítő kérdés nélkül!
                        changeBuilding(hit._buildingKey, hit.properties.name || hit.properties.ref, hit.id);
                    }
                };
                div.addEventListener('mouseenter', () => {
                    const currentItems = _getSelectableSearchResults();
                    _searchSelectedIndex = currentItems.indexOf(div);
                    _searchUserNavigated = true;
                    _updateSearchSelection(currentItems);
                });
                resultsDiv.appendChild(div);
                hasResults = true;
            });
        }
    }

    // A javaslatokat tartalmazó konténer (div) megjelenítése vagy elrejtése a találatok függvényében
    if (hasResults) {
        resultsDiv.style.display = 'block';
        const currentItems = _getSelectableSearchResults();
        if (currentItems.length > 0) {
            _searchSelectedIndex = 0;
            _searchUserNavigated = false;
            _updateSearchSelection(currentItems);
        } else {
            _searchSelectedIndex = -1;
            _searchUserNavigated = false;
        }
    } else {
        resultsDiv.style.display = 'none';
        _searchSelectedIndex = -1;
        _searchUserNavigated = false;
    }

    // A jobb oldali akciógomb (Törlés X vagy Beállítások) aktuális állapotának szinkronizálása
    updateRightButtonState();
}

// === KERESŐSÁV UI LOGIKA ===

/**
 * Kezeli a keresőmező fókuszba kerülésének eseményét.
 * Lecseréli a bal oldali ikont egy vissza nyílra, kattinthatóvá teszi,
 * és megjeleníti a kedvencek listáját, ha a mező még üres.
 */
function handleSearchFocus() {
    loadSearchIndex(); // Aszinkron előtöltés a kereső fókuszba kerülésekor
    const leftIcon = document.getElementById('search-left-icon');
    
    // Bal oldali ikon cseréje nyílra a navigációs visszajelzéshez
    leftIcon.innerText = 'arrow_back';
    
    // Az ikon interaktívvá (kattinthatóvá) tétele a CSS osztály hozzáadásával
    leftIcon.classList.add('clickable');
    
    // Fókuszba kerüléskor a kedvencek listájának automatikus megjelenítése
    showFavoritesInSearch();
}

/**
 * Kezeli a keresőmező fókuszának elvesztését (blur).
 * Kis késleltetéssel állítja vissza az eredeti kereső ikont, hogy
 * a vissza nyílra történő kattintás eseménye még sikeresen lefuthessen.
 */
function handleSearchBlur() {
    // Időzítés alkalmazása szükséges, különben a DOM azonnali újrarenderelése
    // megakadályozza a 'click' esemény lefutását az ikonon.
    setTimeout(() => {
        const leftIcon = document.getElementById('search-left-icon');
        leftIcon.innerText = 'search';
        leftIcon.classList.remove('clickable');
    }, 150);
}

/**
 * Kezeli a bal oldali (vissza) ikonra történő kattintást.
 * Eltávolítja a fókuszt a keresőmezőről, elrejti a találati/POI listát, 
 * és bezárja a virtuális billentyűzetet mobileszközökön.
 */
function handleSearchLeftClick() {
    // A találati lista és a POI grid azonnali elrejtése
    _searchSelectedIndex = -1;
    _searchUserNavigated = false;
    document.getElementById('search-results').style.display = 'none';
    
    // A fókusz eltávolítása az input mezőről (blur esemény kiváltása)
    document.getElementById('search-input').blur();
}

/**
 * Frissíti a jobb oldali akciógomb állapotát és ikonját a keresőmező
 * tartalmának függvényében.
 * Ha van beírt szöveg, törlő (close) gombbá alakul, ha nincs,
 * akkor a beállítások (tune) gombként funkcionál.
 */
function updateRightButtonState() {
    const input = document.getElementById('search-input');
    const btn = document.getElementById('btn-right-action');
    const icon = btn.querySelector('span');

    if (input.value.length > 0) {
        // Törlés mód aktiválása: a mezőben van tartalom
        icon.innerText = 'close';
        btn.classList.add('active-mode'); // A vizuális stílust a CSS kezeli
    } else {
        // Beállítások mód aktiválása: a mező üres
        icon.innerText = 'tune';
        btn.classList.remove('active-mode');
    }
}

/**
 * Kezeli a jobb oldali akciógombra történő kattintást vagy érintést.
 * Törlő módban kiüríti a keresőmezőt a fókusz megtartása mellett,
 * beállítások módban pedig megnyitja a beállítások modális ablakát.
 *
 * @param {Event} e - A kattintást vagy érintést kiváltó DOM esemény.
 */
function handleRightAction(e) {
    const input = document.getElementById('search-input');
    
    if (input.value.length > 0) {
        // --- TÖRLÉS MÓD ---
        
        // Alapértelmezett böngésző-esemény megakadályozása
        // ne vegye el a fókuszt az input mezőtől. Így a billentyűzet nyitva marad.
        e.preventDefault(); 
        
        // Mező tartalmának törlése
        input.value = '';

        // POI markerek eltávolítása a térképről a keresés törlésekor
        _clearPoiMarkers();
        activePoiCategory = null;
        
        // A gomb állapotának visszaállítása alapértelmezettre (tune ikon)
        updateRightButtonState(); 
        
        // A találati lista elrejtése és a kedvencek manuális újratöltése az üres állapothoz
        _searchSelectedIndex = -1;
        _searchUserNavigated = false;
        document.getElementById('search-results').style.display = 'none';
        showFavoritesInSearch(); 
        
    } else {
        // --- BEÁLLÍTÁSOK MÓD ---
        
        // Ebben az esetben kívánatos a fókusz elvesztése, mivel egy új
        // modális ablak kerül előtérbe.
        toggleSettings();
    }
}


/**
 * Kiszűri a megadott típusú POI-kat a jelenlegi térképadatokból,
 * és meghatározza a pontos koordinátáikat (Node vagy Centroid).
 * @param {string} typeKey - A POI_TYPES-ban definiált kulcs (pl. 'coffee', 'atm')
 */
function getPoiPositions(typeKey) {
    const config = POI_TYPES[typeKey];
    if (!config || !geoJsonData) return [];

    const positions = [];

    geoJsonData.features.forEach(feature => {
        if (config.filter(feature.properties)) {
            let coords;

            if (feature.geometry.type === 'Point') {
                coords = [feature.geometry.coordinates[0], feature.geometry.coordinates[1]];
            } else if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
                try {
                    const centroid = turf.centroid(feature);
                    coords = [centroid.geometry.coordinates[0], centroid.geometry.coordinates[1]];
                } catch (e) {
                    console.error("Hiba a centroid számításnál:", e);
                    return;
                }
            }

            if (coords) {
                positions.push({
                    coords: coords,
                    feature: feature,
                    config: config
                });
            }
        }
    });

    return positions;
}

/**
 * POI keresés indítása az aktuális vagy a többi szinten.
 * @param {string} typeKey - A keresett POI kategória kulcsa.
 */
function showPoiCategory(typeKey) {
    activePoiCategory = typeKey; // Eltároljuk az aktív keresési állapotot

    const allPois = getPoiPositions(typeKey);
    
    // --- HIBAKEZELÉS: Ha egyáltalán nincs ilyen POI az épületben ---
    if (allPois.length === 0) {
        const poiName = typeof getPoiName === 'function' ? getPoiName(typeKey) : (POI_TYPES[typeKey] ? POI_TYPES[typeKey].name : typeKey);
        const currentBName = getBuildingName(currentBuildingKey);
        showToast(typeof t === 'function' ? t('toasts.poi_not_in_building', { poi: poiName.toLowerCase(), building: currentBName }) : `Nincs ${poiName.toLowerCase()} a(z) ${currentBName}-ben! 🚫`);
        
        activePoiCategory = null;
        
        const input = document.getElementById('search-input');
        if (input) {
            input.value = '';
            input.blur();
        }
        if (typeof updateRightButtonState === 'function') updateRightButtonState();
        
        return;
    }

    const poisOnCurrentFloor = allPois.filter(poi => {
        const lvls = getLevelsFromFeature(poi.feature);
        return lvls.includes(currentLevel);
    });

    if (poisOnCurrentFloor.length > 0) {
        renderActivePoiCategory(currentLevel);
    } else {
        const mapCenter = map.getCenter();
        const centerPt = turf.point([mapCenter.lng, mapCenter.lat]);
        
        let closestPoi = null;
        let minDist = Infinity;

        allPois.forEach(poi => {
            const poiPt = turf.point([poi.coords[0], poi.coords[1]]);
            const dist = turf.distance(centerPt, poiPt);
            
            if (dist < minDist) {
                minDist = dist;
                closestPoi = poi;
            }
        });

        if (closestPoi) {
            const poiLvls = getLevelsFromFeature(closestPoi.feature);
            let targetLvl = poiLvls[0] || "0";
            
            if (poiLvls.length > 1) {
                const currentNum = parseFloat(currentLevel) || 0;
                let minDiff = Infinity;
                
                poiLvls.forEach(l => {
                    const lNum = parseFloat(l) || 0;
                    const diff = Math.abs(currentNum - lNum);
                    if (diff < minDiff) {
                        minDiff = diff;
                        targetLvl = l;
                    }
                });
            }
            
            const displayLvl = levelAliases[targetLvl] || targetLvl;
            showToast(typeof t === 'function' ? t('toasts.poi_switch_level', { level: displayLvl }) : `Nincs ezen a szinten. Átváltás a(z) ${displayLvl}. szintre...`);
            
            switchLevel(targetLvl);
            
            setTimeout(() => {
                 smartFlyTo(closestPoi.feature);
            }, 300);
        }
    }
}

/**
 * Kirajzolja a térképre az aktív kategóriába és adott szinthez tartozó POI markereket.
 * @param {string} typeKey - A POI kategória azonosítója.
 */
function renderActivePoiCategory(level) {
    if (!activePoiCategory) return;
    _clearPoiMarkers();

    const allPois = getPoiPositions(activePoiCategory);
    
    const poisOnLevel = allPois.filter(poi => {
        const lvls = getLevelsFromFeature(poi.feature);
        return lvls.includes(level);
    });

    poisOnLevel.forEach(poi => renderPoiMarker(poi));

    if (poisOnLevel.length > 0) {
        const lons = poisOnLevel.map(p => p.coords[0]);
        const lats = poisOnLevel.map(p => p.coords[1]);
        map.fitBounds(
            [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
            { padding: { top: 50, bottom: 100, left: 50, right: 50 }, maxZoom: 20, animate: true, duration: 800 }
        );
    }
}

/**
 * Létrehozza a térképi markert és regisztrálja a kattintás eseményt.
 * @param {Object} poiItem - A megjelenítendő POI elem adatai.
 */
function renderPoiMarker(poi) {
    const { coords, feature, config } = poi;

    const el = document.createElement('div');
    el.className = 'poi-marker poi-marker-container';
    el.dataset.poiMarker = "true";
    if (feature.properties && feature.properties._featureIndex !== undefined) {
        el.dataset.featureIndex = feature.properties._featureIndex;
    }
    if (coords && coords.length >= 2) {
        el.dataset.coords = `${coords[0].toFixed(6)},${coords[1].toFixed(6)}`;
    }
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'pointer';
    
    el.innerHTML = `
        <div class="poi-pin-shape" style="background-color: ${config.color}; pointer-events: auto; cursor: pointer;">
            <span class="material-symbols-outlined">${config.icon}</span>
        </div>
    `;

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([coords[0], coords[1]])
        .addTo(map);

    // Szülő container (maplibregl-marker) pointer-events beállítása expliciten
    const parentContainer = marker.getElement();
    if (parentContainer) {
        parentContainer.style.pointerEvents = 'auto';
        parentContainer.style.cursor = 'pointer';
    }

    const handlePointerDown = (e) => {
        e.stopPropagation();
    };

    const handleClick = (e) => {
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();

        openSheet(feature);
        smartFlyTo(feature);

        _poiMarkers.forEach(m => {
            const mEl = m.getElement();
            if (mEl) {
                if (m === marker) {
                    mEl.style.opacity = '0';
                    mEl.style.pointerEvents = 'none';
                } else {
                    mEl.style.opacity = '0.4';
                    mEl.style.filter = 'grayscale(50%)';
                    mEl.style.pointerEvents = 'auto';
                    const shape = mEl.querySelector('.poi-pin-shape');
                    if (shape) shape.style.transform = 'rotate(-45deg) scale(0.85)';
                }
            }
        });
    };

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('click', handleClick);

    _poiMarkers.push(marker);
}

/**
 * Felépíti a navigációs gráfot (útvonalhálózatot) az aktuális épület 
 * térképadatai és a felhasználó hozzáférhetőségi beállításai alapján.
 * Ez a gráf szolgál az A* vagy Dijkstra útvonalkereső algoritmus alapjául.
 */
function buildRoutingGraph() {
    
    // A korábbi gráf teljes ürítése
    navigationGraph.clear();
    
    // Főbejárat alaphelyzetbe állítása a legközelebbi bejárat kereséséhez
    mainEntranceNode = null;
    let potentialEntrances = [];

    // ==========================================
    // 1. SÚLYOZÁS ÉS BÜNTETÉSEK BEÁLLÍTÁSA (ACCESSIBILITY)
    // ==========================================
    
    // Alapértelmezett költségek (távolság-szorzók) meghatározása
    let stairsPenalty = 5.0; // Lépcsőhasználat büntetőszorzója (nehezebb, mint a sík séta)
    let elevatorWeight = 0.5; // Lifthasználat szorzója (gyorsabb/könnyebb a szintváltás)
    let elevatorBoardingCost = 20.0; // Extra "várakozási idő" (távolságban mérve) a liftnél

    // Költségek módosítása a felhasználói beállítás (APP_SETTINGS.elevatorMode) alapján
    switch (APP_SETTINGS.elevatorMode) {
        case 'stairs': 
            // Csak lépcső mód: A lépcsőzés olcsó (szorzó=1), a lift várakozási ideje extrém magas (500)
            stairsPenalty = 1.0; 
            elevatorBoardingCost = 500.0; 
            break;
        case 'balanced':
            // Kiegyensúlyozott mód: Kisebb lépcső büntetés, átlagos lift várakozás
            stairsPenalty = 1.5; 
            elevatorBoardingCost = 30.0; 
            break;
        case 'elevator':
            // Preferált lift mód: Lépcsőzés drága (szorzó=10), a lift azonnali (0 várakozás)
            stairsPenalty = 10.0; 
            elevatorBoardingCost = 0.0; 
            break;
        case 'wheelchair':
            // Kerekesszékes mód: Lépcsőhasználat tiltva (végtelen közeli büntetés), lift azonnali
            stairsPenalty = 9999.0; 
            elevatorBoardingCost = 0.0;
            break;
    }

    // ==========================================
    // 2. ÉL (EDGE) HOZZÁADÁS LOGIKÁJA A GRÁFHOZ
    // ==========================================
    
    /**
     * Belső segédfüggvény két csomópont összekötésére a gráfban a megfelelő súllyal.
     * @param {Object} node1 - Kezdőpont (lat, lon, level).
     * @param {Object} node2 - Végpont (lat, lon, level).
     * @param {string} type - A kapcsolat típusa ('walk', 'stairs_inter', 'elevator').
     */
    const addEdge = (node1, node2, type) => {
        // Valós földrajzi távolság kiszámítása a két pont között méterben (gyors, síkbeli)
        let dist = fastDistMeters(node1.lat, node1.lon, node2.lat, node2.lon);
        
        // Költségmódosítás a kapcsolat típusa alapján
        if (type === 'stairs_inter') {
            // A virtuális lépcsőházi bekötések (amikor a szintváltás a poligon közepén történik)
            // "olcsók" maradnak (min 4.0 méter * büntetés), hogy az algoritmus ne vigyen el 
            // egy irreálisan messzi, de valós geometriájú lépcsőhöz.
            dist = Math.max(dist, 4.0) * stairsPenalty;
        }
        else if (type === 'elevator') {
            dist = Math.max(dist, 1.0) * elevatorWeight; 
        } else {
            dist = Math.max(dist, 0.1); // Nullás távolság elkerülése a hagyományos sétánál
        }

        // Egyedi csomópont-kulcsok generálása
        const k1 = toKey(node1.lat, node1.lon, node1.level);
        const k2 = toKey(node2.lat, node2.lon, node2.level);
        
        // Önhivatkozások (loop) kiszűrése
        if (k1 === k2) return;
        
        // Csomópontok inicializálása a gráfban, ha még nem léteznek
        if (!navigationGraph.has(k1)) navigationGraph.set(k1, []);
        if (!navigationGraph.has(k2)) navigationGraph.set(k2, []);
        
        // Kétirányú kapcsolat (él) hozzáadása a gráfhoz az adott költséggel (dist)
        navigationGraph.get(k1).push({ key: k2, dist: dist, lat: node2.lat, lon: node2.lon, level: node2.level });
        navigationGraph.get(k2).push({ key: k1, dist: dist, lat: node1.lat, lon: node1.lon, level: node1.level });
    };

    // ==========================================
    // 3. TÉRKÉPELEMEK (FEATURES) FELDOLGOZÁSA ÉS BEKÖTÉSE
    // ==========================================

    // Liftek kigyűjtése
    const elevators = geoJsonData.features.filter(f => f.properties.highway === 'elevator' || f.properties.room === 'elevator');
    
    // Poligon típusú (zárt területű) lépcsőházak kigyűjtése
    const verticalStairs = geoJsonData.features.filter(f => 
        (f.properties.room === 'stairs' || f.properties.indoor === 'staircase' || f.properties.room === 'staircase')
        && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
    );

    // Általános térképelemek iterációja (folyosók, vonalas lépcsők, bejáratok)
    geoJsonData.features.forEach(f => {
        const p = f.properties;
        
        // --- FOLYOSÓK (Corridors) ---
        if (p.highway === 'corridor' && f.geometry.type === 'LineString') {
            const level = getLevelsFromFeature(f)[0] || "0"; 
            const coords = f.geometry.coordinates; 
            // A vonal szegmenseinek (töréspontjainak) összekötése lépésről lépésre
            for (let i = 0; i < coords.length - 1; i++) {
                addEdge({ lat: coords[i][1], lon: coords[i][0], level }, { lat: coords[i+1][1], lon: coords[i+1][0], level }, 'walk');
            }
        }

        // --- HAGYOMÁNYOS LÉPCSŐK (LineString Steps) ---
        if (p.highway === 'steps' && f.geometry.type === 'LineString') {
            const levels = getLevelsFromFeature(f);
            if (levels.length > 0) {
                const minL = levels[0];
                const maxL = levels[levels.length - 1];
                const coords = f.geometry.coordinates;

                if (minL === maxL) { 
                    // Szinten belüli lépcső (pl. pár fok egy küszöbnél) -> normál séta
                    const lvl = minL;
                    for (let i = 0; i < coords.length - 1; i++) {
                        addEdge({ lat: coords[i][1], lon: coords[i][0], level: lvl }, { lat: coords[i+1][1], lon: coords[i+1][0], level: lvl }, 'walk');
                    }
                } else { 
                    // Szinteket összekötő lépcső
                    // Kerekesszékes módban ezeket a kapcsolatokat nem adjuk hozzá a gráfhoz
                    if (APP_SETTINGS.elevatorMode === 'wheelchair') return; 
                    
                    const startP = { lat: coords[0][1], lon: coords[0][0] };
                    const endP = { lat: coords[coords.length-1][1], lon: coords[coords.length-1][0] };
                    
                    // Kétirányú kapcsolat a szintek között
                    addEdge({ ...startP, level: minL }, { ...endP, level: maxL }, 'stairs_inter');
                    addEdge({ ...startP, level: maxL }, { ...endP, level: minL }, 'stairs_inter');
                }
            }
        }
        
        // --- FŐBEJÁRAT/AJTÓK GYŰJTÉSE ---
        if (p.entrance || p.door) {
            potentialEntrances.push(f);
        }
    });

    // --- FŐBEJÁRAT KIVÁLASZTÁSA (PONTOZÁS ALAPJÁN) ---
    let bestEntranceScore = Infinity;
    
    potentialEntrances.forEach(f => {
        const p = f.properties;
        const isWheelchairMode = APP_SETTINGS.elevatorMode === 'wheelchair';
        
        // Ha akadálymentes mód van, de nem akadálymentes a bejárat, az nem jó
        if (isWheelchairMode && p.wheelchair !== 'yes') return;

        const lvl = getLevelsFromFeature(f)[0] || "0";
        const coords = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
        let score = fastDistMeters(coords[0], coords[1], currentBuilding.center[0], currentBuilding.center[1]);
        
        // Főbejáratoknak nagy előnyt adunk
        if (p.entrance === 'main') score -= 10000;
        else if (p.entrance === 'yes') score -= 5000;
        
        if (score < bestEntranceScore) {
            bestEntranceScore = score;
            mainEntranceNode = { lat: coords[0], lon: coords[1], level: lvl, properties: p };
        }
    });

    // Ha kerekesszékkel nem találtunk semmit, fallback a legközelebbi sima bejáratra
    if (!mainEntranceNode && APP_SETTINGS.elevatorMode === 'wheelchair') {
        console.warn("Nincs akadálymentes bejárat a térképen! Fallback normál bejáratra.");
        potentialEntrances.forEach(f => {
            const p = f.properties;
            const lvl = getLevelsFromFeature(f)[0] || "0";
            const coords = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            let score = fastDistMeters(coords[0], coords[1], currentBuilding.center[0], currentBuilding.center[1]);
            
            if (p.entrance === 'main') score -= 10000;
            else if (p.entrance === 'yes') score -= 5000;
            
            if (score < bestEntranceScore) {
                bestEntranceScore = score;
                mainEntranceNode = { lat: coords[0], lon: coords[1], level: lvl, properties: p };
            }
        });
    }

    // ==========================================
    // 4. VERTIKÁLIS KAPCSOLATOK (LIFTEK ÉS POLIGON LÉPCSŐK)
    // ==========================================

    // --- LIFTEK BEKÖTÉSE ---
    elevators.forEach(f => {
        const levels = getLevelsFromFeature(f);
        if (levels.length < 2) return; // Ha csak 1 szintje van, nem lift
        
        // A lift geometriai középpontjának (aknájának) meghatározása
        const center = turf.centroid(f);
        const liftLon = center.geometry.coordinates[0];
        const liftLat = center.geometry.coordinates[1];

        // A szintek függőleges összekötése az aknán belül
        for (let i = 0; i < levels.length - 1; i++) {
            addEdge({ lat: liftLat, lon: liftLon, level: levels[i] }, { lat: liftLat, lon: liftLon, level: levels[i+1] }, 'elevator');
        }

        // A liftakna rákötése az épület folyosóhálózatára minden érintett szinten.
        // Alkalmazza a beállított beszállási költséget (várakozási időt).
        connectVerticalShaftToCorridor(f, levels, liftLat, liftLon, elevatorBoardingCost, false, addEdge);
    });

    // --- POLIGON LÉPCSŐHÁZAK BEKÖTÉSE ---
    verticalStairs.forEach(f => {
        // Kerekesszékes módban a lépcsőházak teljes mértékben kimaradnak a gráfból
        if (APP_SETTINGS.elevatorMode === 'wheelchair') return;

        const levels = getLevelsFromFeature(f);
        if (levels.length < 2) return;
        
        // A lépcsőház geometriai középpontjának meghatározása
        const center = turf.centroid(f);
        const stairLon = center.geometry.coordinates[0];
        const stairLat = center.geometry.coordinates[1];

        // A szintek függőleges összekötése a lépcsőházon belül
        for (let i = 0; i < levels.length - 1; i++) {
            addEdge({ lat: stairLat, lon: stairLon, level: levels[i] }, { lat: stairLat, lon: stairLon, level: levels[i+1] }, 'stairs_inter');
        }

        // A lépcsőház rákötése a folyosóhálózatra.
        // 'isVirtualStair = true' paraméterrel a csatlakozási távolság nem kap extra büntetést,
        // így az algoritmus hajlandó lesz "bemenni" a poligon közepére a szintváltáshoz.
        connectVerticalShaftToCorridor(f, levels, stairLat, stairLon, 0, true, addEdge);
    });
}

/**
 * Összeköti egy vertikális akna (lift vagy lépcsőház) középpontját a legközelebbi 
 * folyosóval az összes érintett szinten a navigációs gráfban.
 * Kiszámítja a legközelebbi pontot a folyosó geometriáján, és létrehozza a kétirányú 
 * kapcsolatot a megadott felszállási költség (boardingCost) és távolság alapján.
 * * @param {Object} shaftFeature - A vertikális aknát reprezentáló GeoJSON térképelem.
 * @param {Array<string>} levels - A vertikális akna által érintett szintek tömbje.
 * @param {number} lat - Az akna középpontjának földrajzi szélessége.
 * @param {number} lon - Az akna középpontjának földrajzi hosszúsága.
 * @param {number} boardingCost - A beszállási/várakozási költség (büntetés) méterben kifejezve.
 * @param {boolean} isVirtualStair - Jelzi, ha poligon alapú lépcsőházról van szó, 
 * ahol a geometriai középpont és a folyosó távolságát minimalizálni kell.
 * @param {Function} addEdgeFn - A gráf élét hozzáadó segédfüggvény.
 */
function connectVerticalShaftToCorridor(shaftFeature, levels, lat, lon, boardingCost, isVirtualStair, addEdgeFn) {
    levels.forEach(lvl => {
        let bestDist = Infinity; 
        let bestPoint = null;
        
        // Keresési sugár meghatározása méterben.
        // Nagyobb kiterjedésű lépcsőházak esetén a geometriai középpont (centroid) 
        // távolabb eshet a folyosótól, ezért 50 méteres sugarat alkalmazunk.
        const SNAP_RADIUS = 50.0; 

        // Végigiterálunk az összes térképelemen a legközelebbi folyosó megtalálásához
        geoJsonData.features.forEach(corr => {
            if (corr.properties.highway === 'corridor' && corr.geometry.type === 'LineString') {
                const cLvls = getLevelsFromFeature(corr);
                
                // Csak az azonos szinten lévő folyosókat vizsgáljuk
                if (cLvls.includes(lvl)) {
                    const line = turf.lineString(corr.geometry.coordinates);
                    const pt = turf.point([lon, lat]);
                    
                    // A folyosó vonalának az aknához legközelebbi pontjának meghatározása
                    const snapped = turf.nearestPointOnLine(line, pt);
                    const d = snapped.properties.dist * 1000; // Távolság átváltása méterre
                    
                    // Ha a pont közelebb van az eddigi legjobbnál és a maximális sugáron belül esik
                    if (d < bestDist && d < SNAP_RADIUS) { 
                        bestDist = d; 
                        bestPoint = snapped; 
                    }
                }
            }
        });

        // Ha sikeresen találtunk csatlakozási pontot a folyosón
        if (bestPoint) {
            const corrLat = bestPoint.geometry.coordinates[1];
            const corrLon = bestPoint.geometry.coordinates[0];
            
            // Valós távolság kiszámítása az akna középpontja és a folyosói csatlakozópont között
            let dist = fastDistMeters(lat, lon, corrLat, corrLon);
            
            // Virtuális lépcsőházak esetén a belső távolságot minimalizáljuk.
            // Ezzel elkerülhető, hogy a nagy alapterületű lépcsőházak geometriai középpontja 
            // miatti távolság aránytalanul megnövelje az útvonal költségét.
            if (isVirtualStair) {
                dist = 1.0; 
            }

            // A végső költség (súly) kiszámítása a távolság és a várakozási idő (boardingCost) összeadásával
            const finalDist = dist + boardingCost;
            
            // Egyedi csomópont-kulcsok generálása a gráfhoz az összekötendő koordináták alapján
            const k1 = toKey(lat, lon, lvl);
            const k2 = toKey(corrLat, corrLon, lvl);
            
            // Csomópontok inicializálása a gráfban, ha korábban nem léteztek
            if (!navigationGraph.has(k1)) navigationGraph.set(k1, []);
            if (!navigationGraph.has(k2)) navigationGraph.set(k2, []);
            
            // A kétirányú kapcsolat (él) hozzáadása a navigációs gráfhoz
            navigationGraph.get(k1).push({ key: k2, dist: finalDist, lat: corrLat, lon: corrLon, level: lvl });
            navigationGraph.get(k2).push({ key: k1, dist: finalDist, lat: lat, lon: lon, level: lvl });
        }
    });
}

/**
 * Megkeresi és összegyűjti egy adott helyiséghez (szobához) tartozó ajtókat és bejáratokat.
 * Az azonosítás térbeli elemzésen (távolságmérésen) és szint-egyezésen alapul.
 * Az algoritmus azokat a pontokat tekinti a szoba ajtajának, amelyek megegyező szinten 
 * találhatóak, és a távolságuk a szoba falától (körvonalától) nem haladja meg az 1.2 métert.
 * * @param {Object} roomFeature - A vizsgált helyiséget reprezentáló GeoJSON térképelem (jellemzően Polygon).
 * @returns {Array<Object>} Az azonosított ajtókat tartalmazó GeoJSON elemek tömbje. 
 * Hiba vagy találat hiánya esetén üres tömbbel tér vissza.
 */
function getDoorsForRoom(roomFeature) {
    if (!roomFeature || roomFeature.geometry.type === 'Point') return [];
    
    // A szoba geometriájának (poligon) és szintadatainak inicializálása a Turf.js segítségével
    const roomPoly = turf.polygon(roomFeature.geometry.coordinates);
    const roomLevels = getLevelsFromFeature(roomFeature);
    const doors = [];

    // A szoba poligonjának átalakítása vonal-geometriává (LineString) a peremvonal menti pontos távolságméréshez
    const roomLine = turf.polygonToLine(roomPoly);
    if (!roomLine) return []; // Hibakezelés sikertelen konverzió esetén

    // Iteráció a globális térképadatok összes elemén az ajtók felkutatására
    geoJsonData.features.forEach(f => {
        // A geometriai típus szűrése: a vizsgálatot kizárólag pont (Point) típusú elemekre korlátozzuk
        if (f.geometry.type !== 'Point') return;
        
        const p = f.properties;
        
        // Logikai szűrés: csak azokat a pontokat vizsgáljuk, amelyek bejárat (entrance) vagy ajtó (door) tulajdonságúak
        if (!p.entrance && !p.door) return;

        // Szint alapú érvényesítés: megvizsgáljuk, hogy az ajtó és a szoba rendelkezik-e közös szinttel (metszet)
        const doorLevels = getLevelsFromFeature(f);
        const commonLevel = roomLevels.some(l => doorLevels.includes(l));
        if (!commonLevel) return; // Ha nincs közös szint, a pont nem tartozhat ehhez a szobához

        // Térbeli távolságmérés: az ajtó koordinátája és a szoba körvonala (fala) közötti legrövidebb távolság kiszámítása
        const pt = turf.point(f.geometry.coordinates);
        const dist = turf.pointToLineDistance(pt, roomLine, {units: 'meters'});
        
        // Tolerancia vizsgálat: ha az ajtó legfeljebb 1.2 méterre van a faltól, a szobához tartozónak tekintjük
        if (dist < 1.2) {
            doors.push(f);
        }
    });

    // Az érvényes, szobához társított ajtó-elemek listájának visszaadása
    return doors;
}

/**
 * Dinamikusan beilleszt egy új csomópontot a meglévő navigációs gráfba.
 * Elsődlegesen arra szolgál, hogy egy útvonaltervezési végpontot (például egy szoba középpontját)
 * rácsatlakoztassa a legközelebbi folyosóhálózatra (snapping). Ha a pont már létezik,
 * vagy a csatlakozás sikeres, visszatér az új vagy meglévő csomópont adataival.
 * * @param {number} targetLat - A beillesztendő pont földrajzi szélessége.
 * @param {number} targetLon - A beillesztendő pont földrajzi hosszúsága.
 * @param {string} targetLevel - A beillesztendő pont szintje (emelet azonosító).
 * @param {number} [maxDistanceMeters=5.0] - A maximális keresési sugár méterben a folyosóra illesztéshez.
 * @param {Object|null} [sourceFeature=null] - Opcionális térképelem referencia (a specifikus ajtókeresés külső logikába van kiszervezve).
 * @returns {Object|null} Az illesztett csomópont objektuma ({key, lat, lon, level}), vagy null, ha a beillesztés sikertelen.
 */
function injectNodeIntoGraph(targetLat, targetLon, targetLevel, maxDistanceMeters = 5.0, sourceFeature = null) {
    
    // --- 1. MEGLÉVŐ CSOMÓPONT KERESÉSE ---
    // Generálunk egy egyedi azonosítót a célpont koordinátái alapján.
    // Ha ezen a pontos helyen már létezik csomópont a gráfban, azonnal visszatérünk az adataival.
    const exactKey = toKey(targetLat, targetLon, targetLevel);
    if (navigationGraph.has(exactKey)) {
        return { key: exactKey, lat: targetLat, lon: targetLon, level: targetLevel };
    }

    // --- 2. FOLYOSÓRA TÖRTÉNŐ ILLESZTÉS (SNAPPING) ---
    let bestConnection = null;
    let minConnDist = Infinity;

    // Végigiterálunk a térképelemeken a legmegfelelőbb csatlakozási pont megtalálásához.
    geoJsonData.features.forEach(f => {
        // Csak a vonal típusú (LineString) folyosókat (corridor) vizsgáljuk.
        if (f.properties.highway !== 'corridor' || f.geometry.type !== 'LineString') return;
        
        // Szűrés a megfelelő szintre: csak az azonos emeleten lévő folyosókat vesszük figyelembe.
        const levels = getLevelsFromFeature(f);
        if (!levels.includes(targetLevel)) return;

        // A legközelebbi pont kiszámítása a folyosó vonalán a Turf.js segítségével.
        const line = turf.lineString(f.geometry.coordinates);
        const pt = turf.point([targetLon, targetLat]);
        const snapped = turf.nearestPointOnLine(line, pt);
        
        // A távolság átváltása kilométerből méterbe az összehasonlításhoz.
        const dist = snapped.properties.dist * 1000;

        // Ha a talált pont közelebb van az eddigi legjobbnál, és a megengedett maximális távolságon belül esik,
        // rögzítjük a csatlakozási pont adatait.
        if (dist < minConnDist && dist < maxDistanceMeters) {
            minConnDist = dist;
            bestConnection = {
                type: 'new',
                newLat: snapped.geometry.coordinates[1],
                newLon: snapped.geometry.coordinates[0],
                segment: f,
                snappedPoint: snapped
            };
        }
    });

    // --- 3. A CSATLAKOZÁSI PONT BEILLESZTÉSE A GRÁFBA ---
    if (bestConnection) {
        const newLat = bestConnection.newLat;
        const newLon = bestConnection.newLon;
        const newKey = toKey(newLat, newLon, targetLevel);
        
        // Ellenőrizzük, hogy a kiszámított új csatlakozási pont egybeesik-e egy már meglévő csomóponttal a gráfban.
        if (navigationGraph.has(newKey)) return { key: newKey, lat: newLat, lon: newLon, level: targetLevel };

        // Új csomópont inicializálása a navigációs gráf adatszerkezetében.
        if (!navigationGraph.has(newKey)) navigationGraph.set(newKey, []);

        // A folyosó vonalszakaszának és az illesztett pont indexének kinyerése.
        const coords = bestConnection.segment.geometry.coordinates;
        const idx = bestConnection.snappedPoint.properties.index;
        
        // Ha az index érvényes, beillesztjük a pontot a szegmens két eredeti végpontja (p1 és p2) közé.
        if (idx !== undefined && idx < coords.length - 1) {
            const p1 = { lat: coords[idx][1], lon: coords[idx][0], level: targetLevel };
            const p2 = { lat: coords[idx+1][1], lon: coords[idx+1][0], level: targetLevel };
            
            const k1 = toKey(p1.lat, p1.lon, p1.level);
            const k2 = toKey(p2.lat, p2.lon, p2.level);
            
            // Távolságok kiszámítása az új pont és az eredeti végpontok között.
            let d1 = fastDistMeters(newLat, newLon, p1.lat, p1.lon);
            let d2 = fastDistMeters(newLat, newLon, p2.lat, p2.lon);
            
            // Biztosítjuk, hogy ne jöjjön létre zérus hosszúságú él (minimum 10 cm).
            d1 = Math.max(d1, 0.1); 
            d2 = Math.max(d2, 0.1);
            
            // A kapcsolat típusa alapértelmezetten gyalogos séta.
            const type = 'walk'; 

            // A kétirányú élek (kapcsolatok) felépítése az új pont és a folyosó megszakított szakaszai között.
            if (navigationGraph.has(k1)) {
                navigationGraph.get(newKey).push({ key: k1, dist: d1, lat: p1.lat, lon: p1.lon, level: targetLevel });
                navigationGraph.get(k1).push({ key: newKey, dist: d1, lat: newLat, lon: newLon, level: targetLevel });
            }
            
            if (navigationGraph.has(k2)) {
                navigationGraph.get(newKey).push({ key: k2, dist: d2, lat: p2.lat, lon: p2.lon, level: targetLevel });
                navigationGraph.get(k2).push({ key: newKey, dist: d2, lat: newLat, lon: newLon, level: targetLevel });
            }
            
            // Visszatérünk a sikeresen beillesztett csomópont adataival.
            return { key: newKey, lat: newLat, lon: newLon, level: targetLevel };
        }
    }
    
    // Ha semmilyen módon nem sikerült a beillesztés (pl. nincs folyosó a közelben), null értékkel térünk vissza.
    return null;
}

/**
 * Megkeresi a navigációs gráf egy adott szintjéhez tartozó legközelebbi csomópontot 
 * a megadott koordinátákhoz képest, egy előre definiált tűréshatáron belül.
 * Ez a segédfüggvény kritikus szerepet játszik abban, hogy a felhasználói 
 * kattintásokat vagy térképi elemeket meglévő hálózati pontokhoz lehessen kötni.
 *
 * @param {number} targetLat - A célpont földrajzi szélessége.
 * @param {number} targetLon - A célpont földrajzi hosszúsága.
 * @param {string} targetLevel - A vizsgálandó szint (emelet) azonosítója.
 * @param {number} [toleranceMeters=5.0] - A keresési sugár (tűréshatár) méterben kifejezve.
 * @returns {Object|null} A legközelebbi csomópont objektuma ({key, lat, lon, level}), 
 * vagy null, ha nincs találat a tűréshatáron belül.
 */
function findNearestNodeInGraph(targetLat, targetLon, targetLevel, toleranceMeters = 5.0) {
    let minDist = Infinity; 
    let bestNode = null;
    const searchLevel = targetLevel || "0";
    
    // Iteráció a globális navigációs gráf összes csomópontján
    for (const [key, neighbors] of navigationGraph.entries()) {
        // A csomópont kulcsának (formátum: lat,lon,level) felbontása alkatrészeire
        const parts = key.split(',');
        const lat = parseFloat(parts[0]); 
        const lon = parseFloat(parts[1]); 
        const lvl = parts[2];
        
        // Szint alapú szűrés: csak az azonos emeleten lévő pontokat vizsgáljuk
        if (lvl !== searchLevel) continue;
        
        // A geometriai távolság kiszámítása a keresett koordináta és a csomópont között
        const d = fastDistMeters(targetLat, targetLon, lat, lon);
        
        // Legjobb találat frissítése, ha a távolság a tűréshatáron belül van és kisebb az eddigi minimumnál
        if (d < toleranceMeters && d < minDist) { 
            minDist = d; 
            bestNode = { key: key, lat: lat, lon: lon, level: lvl }; 
        }
    }
    
    return bestNode;
}

/**
 * Megjeleníti vagy elrejti a "Közelben" POI rácsot a Bottom Sheet-en belül.
 */
function toggleNearbyMenu() {
    const btn = document.querySelector('.btn-nearby');
    let container = document.getElementById('nearby-menu-container');
    
    // Ha már nyitva van, bezárjuk és visszaállítjuk az eredeti adatokat
    if (container) {
        container.remove();
        document.getElementById('room-data-container').style.display = 'block';
        if (btn) btn.classList.remove('active');
        
        // Visszaanimáljuk az eredeti magasságra mobilon
        if (!isDesktopSidePanel()) {
            _sheetState = 'auto';
            document.getElementById('bottom-sheet').classList.remove('sheet-full');
            setTimeout(() => { document.getElementById('bottom-sheet').style.height = `${getAutoHeight()}px`; }, 50);
        }
        return;
    }

    // Ha nincs nyitva, létrehozzuk
    if (btn) btn.classList.add('active');
    document.getElementById('room-data-container').style.display = 'none'; // Eredeti tartalom elrejtése
    
    container = document.createElement('div');
    container.id = 'nearby-menu-container';
    const nearbyPromptResolved = typeof t === 'function' ? t('poi.nearby_title', 'Mit keresel a közelben?') : "Mit keresel a közelben?";
    const nearbyTitle = (nearbyPromptResolved && nearbyPromptResolved !== 'poi.nearby_title') ? nearbyPromptResolved : "Mit keresel a közelben?";
    container.innerHTML = `<h4 style="margin: 15px 0 5px 0; text-align: center; font-size: 13px; opacity: 0.6; text-transform: uppercase;">${nearbyTitle}</h4>`;
    
    const grid = document.createElement('div');
    grid.className = 'poi-grid-container';
    grid.style.border = 'none'; // Itt nem kell elválasztó vonal
    grid.style.background = 'transparent';

    for (const [key, config] of Object.entries(POI_TYPES)) {
        if (config.hideInGrid) continue; // Rejtett kategóriák átugrása
        const item = document.createElement('div');
        item.className = 'poi-grid-item';
        const poiDisplayName = typeof getPoiName === 'function' ? getPoiName(key) : config.name;
        item.innerHTML = `
            <div class="poi-grid-icon" style="background-color: ${config.color}">
                <span class="material-symbols-outlined">${config.icon}</span>
            </div>
            <span class="poi-grid-label">${poiDisplayName}</span>
        `;
        
        item.onclick = () => {
            // Kattintás után bezárjuk a menüt és elindítjuk a keresést
            container.remove();
            document.getElementById('room-data-container').style.display = 'block';
            if (btn) btn.classList.remove('active');
            findNearestPOI(key);
        };
        grid.appendChild(item);
    }
    
    container.appendChild(grid);
    document.getElementById('sheet-scroll-content').insertBefore(container, document.getElementById('room-data-container'));
    
    // A sheet magasságának újrakalkulálása a POI rács méretéhez mobilon
    if (!isDesktopSidePanel()) {
        _sheetState = 'auto';
        document.getElementById('bottom-sheet').classList.remove('sheet-full');
        setTimeout(() => { document.getElementById('bottom-sheet').style.height = `${getAutoHeight()}px`; }, 50);
    }
}

/**
 * Visszaállítja a "Közelben" menü állapotát az alapértelmezettre.
 * Eltünteti a POI gridet és inaktívvá teszi a gombot.
 */
function resetNearbyMenu() {
    const container = document.getElementById('nearby-menu-container');
    if (container) container.remove();
    
    const btn = document.querySelector('.btn-nearby');
    if (btn) btn.classList.remove('active');
}

/**
 * Megkeresi a legközelebbi adott típusú POI-t a megadott pozícióhoz.
 * @param {string} typeKey - A POI típusa.
 * @param {string} fromKey - A kiinduló csomópont kulcsa.
 */
function findNearestPOI(typeKey) {
    if (!selectedFeature) { 
        alert(typeof t === 'function' ? t('alerts.choose_start_point', 'Először válassz ki egy kiindulópontot a térképen!') : "Először válassz ki egy kiindulópontot a térképen!"); 
        return; 
    }

    const config = POI_TYPES[typeKey];
    const c = turf.centroid(selectedFeature);
    const startLvl = getLevelsFromFeature(selectedFeature)[0] || "0";
    
    if (!geoJsonData || !geoJsonData.features) return;

    // Alap szűrés a konfiguráció alapján
    let targets = geoJsonData.features.filter(f => config.filter(f.properties));

    // Specifikus beállítások alkalmazása (pl. női/férfi WC)
    if (typeKey === 'toilet') {
        const mode = (typeof APP_SETTINGS !== 'undefined' && APP_SETTINGS.toiletMode) ? APP_SETTINGS.toiletMode : 'all';
        const isAcc = (typeof APP_SETTINGS !== 'undefined' && APP_SETTINGS.toiletAccessible);
        
        targets = targets.filter(f => {
            const p = f.properties;
            
            // Ha az akadálymentes mód aktív, a nemek szerinti szűrést ignoráljuk (mert nem lenne találat)
            if (!isAcc) {
                if (mode === 'male' && p.female === 'yes' && p.male !== 'yes') return false; 
                if (mode === 'female' && p.male === 'yes' && p.female !== 'yes') return false;
            }
            return true;
        });
    }

    if (targets.length === 0) { 
        const poiName = typeof getPoiName === 'function' ? getPoiName(typeKey) : (config ? config.name : typeKey);
        alert(typeof t === 'function' ? t('alerts.poi_not_found', { poi: poiName.toLowerCase() }, `Nem találtam ${poiName.toLowerCase()}t ezen a térképen!`) : `Nem találtam ${poiName.toLowerCase()}t ezen a térképen!`); 
        return; 
    }

    // Heurisztikus pontozás (távolság + szintváltás büntetése)
    targets.forEach(t => {
        const tc = turf.centroid(t); 
        const distAir = turf.distance(c, tc) * 1000; 
        const tLvl = getLevelsFromFeature(t)[0] || "0";
        const levelDiff = Math.abs(parseFloat(startLvl) - parseFloat(tLvl));
        
        t._score = distAir + (levelDiff * 2000); 
    });

    // A legalacsonyabb pontszámú (legjobb) jelölt kiválasztása
    const bestTarget = targets.sort((a,b) => a._score - b._score)[0];

    if (bestTarget) {
        pendingNavSource = selectedFeature; 
        startNavigation(bestTarget, selectedFeature); 
    } else {
        alert(typeof t === 'function' ? t('alerts.search_error') : "Hiba a keresés során.");
    }
}

/**
 * Elindítja az útvonaltervezést (navigációt) a gráf alapján két térképelem között.
 * Ha a kezdőpont (fromFeature) nincs megadva, az épület főbejáratától indítja a tervezést.
 * Kezeli a többajtós (multi-door) szobákat is: minden lehetséges ajtót beilleszt a gráfba,
 * és Dijkstra algoritmusával megkeresi a globálisan legrövidebb útvonalat.
 *
 * @param {Object|null} [targetFeature=null] - A célállomást reprezentáló GeoJSON elem. Ha null, az aktuálisan kiválasztott elemet használja.
 * @param {Object|null} [fromFeature=null] - A kiindulópontot reprezentáló GeoJSON elem. Ha null, a főbejárat lesz a kezdőpont.
 */
function startNavigation(targetFeature = null, fromFeature = null) {
    console.clear();
    
    // A navigációs gráf frissítése az útvonaltervezés előtt (pl. beállítások változása miatt)
    buildRoutingGraph(); 

    // --- TÉRKÉP LETISZTÍTÁSA NAVIGÁCIÓ ELŐTT ---
    // Eltávolítjuk a keresett POI pineket (cseppeket), hogy ne zavarják az útvonalat
    _clearPoiMarkers();
    activePoiCategory = null;
    // A Bottom Sheet "Közelben" radar menüjét is bezárjuk, ha nyitva lenne
    if (typeof resetNearbyMenu === 'function') resetNearbyMenu();
    
    // A célpont meghatározása (prioritás: paraméter > globális kiválasztás)
    const target = targetFeature || selectedFeature;
    if (!target) return;

    // --- ÁLLAPOT MENTÉSE ---
    // Az aktív navigációs adatok eltárolása a globális objektumban (pl. URL megosztáshoz)
    activeRouteData = {
        start: fromFeature, // Értéke null maradhat a főbejárat használata esetén
        end: target
    };

    // --- 1. KEZDŐPONTOK (START NODES) MEGHATÁROZÁSA ÉS GRÁFBA ILLESZTÉSE ---
    let startNodes = [];
    
    if (fromFeature) {
        // A) PREFERÁLT SZINT KIVÁLASZTÁSA (Start)
        const fLevels = getLevelsFromFeature(fromFeature);
        // Szintválasztás: ha az elem az aktuális szinten van, nem váltunk emeletet
        // azt a szintet kényszerítjük. Egyéb esetben az elem első elérhető szintjét használjuk.
        const preferredStartLevel = fLevels.includes(currentLevel) ? currentLevel : fLevels[0];

        // A kiinduló helyiséghez tartozó összes azonosítható ajtó kigyűjtése
        const doors = getDoorsForRoom(fromFeature);
        
        if (doors.length > 0) {
            doors.forEach(door => {
                const doorLevels = getLevelsFromFeature(door);
                // Az ajtó szintjének meghatározása (fallback a preferált szintre, ha nincs megadva)
                const finalLvl = doorLevels.length > 0 ? doorLevels[0] : preferredStartLevel;
                
                // Szűrés: Csak azokat az ajtókat illesztjük a gráfba, amelyek a preferált szinten találhatóak
                if (doorLevels.includes(preferredStartLevel) || finalLvl === preferredStartLevel) {
                    const coords = door.geometry.coordinates;
                    const node = injectNodeIntoGraph(coords[1], coords[0], preferredStartLevel, 5.0);
                    if (node) startNodes.push(node);
                }
            });
        }
        
        // Fallback: Ha nem találtunk megfelelő ajtót a szinten, a helyiség geometriai középpontját (centroid) használjuk
        if (startNodes.length === 0) {
            let c = turf.centroid(fromFeature);
            const node = injectNodeIntoGraph(c.geometry.coordinates[1], c.geometry.coordinates[0], preferredStartLevel, 20.0, fromFeature);
            if (node) startNodes.push(node);
        }
    } else {
        // B) FŐBEJÁRAT HASZNÁLATA
        if (!mainEntranceNode) { 
            alert(typeof t === 'function' ? t('alerts.no_entrance') : "Nincs bejárat definiálva!"); 
            return; 
        }
        // A főbejárat csomópontjának beillesztése a hálózatba
        const node = injectNodeIntoGraph(mainEntranceNode.lat, mainEntranceNode.lon, mainEntranceNode.level, 5.0);
        if (node) {
            startNodes.push(node);
        } else {
            startNodes.push({ key: toKey(mainEntranceNode.lat, mainEntranceNode.lon, mainEntranceNode.level), ...mainEntranceNode });
        }
    }

    if (startNodes.length === 0) { 
        alert(typeof t === 'function' ? t('alerts.no_start_point') : "Nem található start útvonalpont!"); 
        return; 
    }

    // --- 2. CÉLPONTOK (END NODES) MEGHATÁROZÁSA ÉS GRÁFBA ILLESZTÉSE ---
    let endNodes = [];
    
    // C) PREFERÁLT SZINT KIVÁLASZTÁSA (Cél)
    const tLevels = getLevelsFromFeature(target);
    // A célpont preferált szintjének meghatározása az aktuális nézet alapján
    const preferredEndLevel = tLevels.includes(currentLevel) ? currentLevel : tLevels[0];

    // A cél helyiséghez tartozó ajtók kigyűjtése
    const targetDoors = getDoorsForRoom(target);
    if (targetDoors.length > 0) {
        targetDoors.forEach(door => {
            const doorLevels = getLevelsFromFeature(door);
            
            if (tLevels.length > 1) {
                // Többszintes célpont (pl. Lépcső/Lift): Csak a preferált (aktuálisan nézett) szintre navigálunk
                if (doorLevels.includes(preferredEndLevel)) {
                        const coords = door.geometry.coordinates;
                        const node = injectNodeIntoGraph(coords[1], coords[0], preferredEndLevel, 5.0);
                        if (node) endNodes.push(node);
                }
            } else {
                // Egyszintes célpont (pl. Szoba): Bármelyik megtalált ajtó alkalmas célpont lehet
                const dl = doorLevels[0] || preferredEndLevel;
                const coords = door.geometry.coordinates;
                const node = injectNodeIntoGraph(coords[1], coords[0], dl, 5.0);
                if (node) endNodes.push(node);
            }
        });
    }
    
    // Alternatív célpont-meghatározás ajtó hiányában
    if (endNodes.length === 0) {
        let tLat, tLon;
        
        // A célpont geometriai középpontjának (centroid) kiszámítása
        if (target.geometry.type === "Point") { 
            tLat = target.geometry.coordinates[1]; 
            tLon = target.geometry.coordinates[0]; 
        } else { 
            const c = turf.centroid(target); 
            tLat = c.geometry.coordinates[1]; 
            tLon = c.geometry.coordinates[0]; 
        }
        
        // Megkíséreljük a középpontot a gráfhoz illeszteni egy nagyobb keresési sugárral (20m)
        const node = injectNodeIntoGraph(tLat, tLon, preferredEndLevel, 20.0, target);
        if (node) endNodes.push(node);
        
        // Végső fallback: a gráf legközelebbi meglévő csomópontjának megkeresése (40m sugárban)
        if (endNodes.length === 0) {
            const near = findNearestNodeInGraph(tLat, tLon, preferredEndLevel, 40.0);
            if (near) endNodes.push(near);
        }
    }

    if (endNodes.length === 0) { 
        alert(typeof t === 'function' ? t('alerts.no_target_point') : "Nem található cél útvonalpont!"); 
        return; 
    }

    // --- 3. ÚTVONALKERESÉS (DIJKSTRA ALGORITMUS) ---
    let bestPath = null;
    let minDistance = Infinity; 
    let bestStartNode = null;
    let bestEndNode = null;


    // A legrövidebb útvonal meghatározása az összes lehetséges kezdő- és végpont kombináció vizsgálatával
    startNodes.forEach(sNode => {
        endNodes.forEach(eNode => {
            try {
                const result = runDijkstra(sNode.key, eNode.key);
                if (result) {
                    // Ha a talált útvonal rövidebb az eddigi minimumnál, frissítjük a legjobb eredményt
                    if (result.distance < minDistance) {
                        minDistance = result.distance;
                        bestPath = result.path;
                        bestStartNode = sNode;
                        bestEndNode = eNode;
                    }
                }
            } catch (e) { 
                // Nincs elérhető útvonal ezen két pont között
            }
        });
    });

    // Megszakítás, ha a teljes gráfban nem található összefüggő útvonal
    if (!bestPath) { 
        alert(typeof t === 'function' ? t('alerts.no_route') : "Nincs útvonal!"); 
        return; 
    }

    // --- 4. VIZUÁLIS MEGJELENÍTÉS ÉS UI FRISSÍTÉS ---
    try {
        // A célpont regisztrálása globálisan
        activeNavTarget = target; 

        // --- KIINDULÁSI PONT (activeNavSource) VIZUÁLIS KEZELÉSE ---
        if (pendingNavSource) {
            activeNavSource = pendingNavSource;
        } else if (fromFeature) {
            activeNavSource = fromFeature;
        } else {
            // Ha a navigáció a Főbejárattól indult, létrehozunk egy virtuális GeoJSON elemet a megjelenítéshez
            const startParts = bestPath[0].split(',');
            
            // Dinamikus név a bejárat típusa alapján
            let entranceName = typeof t === 'function' ? (t('types.main_entrance') || "Főbejárat") : "Főbejárat";
            if (mainEntranceNode && mainEntranceNode.properties) {
                if (mainEntranceNode.properties.wheelchair === 'yes') {
                    entranceName = typeof t === 'function' ? (t('types.main_entrance') || "Akadálymentes Főbejárat") : "Akadálymentes Főbejárat";
                } else if (mainEntranceNode.properties.entrance && mainEntranceNode.properties.entrance !== 'main') {
                    entranceName = typeof t === 'function' ? (t('types.entrance') || "Bejárat") : "Bejárat";
                }
            }

            activeNavSource = {
                type: "Feature",
                id: "main_entrance_virtual",
                geometry: {
                    type: "Point",
                    // Megjegyzés: A GeoJSON szabvány longitude, latitude (lon, lat) sorrendet követ
                    coordinates: [parseFloat(startParts[1]), parseFloat(startParts[0])]
                },
                properties: {
                    name: entranceName,
                    level: startParts[2],
                    indoor: "entrance"
                }
            };
        }

        // A teljes útvonal mentése globális változóba a szint-fókuszáló algoritmus (focusOnRouteSegment) számára
        currentRoutePath = bestPath; 

        // A célpont vizuális kiemelése a térképen
        drawSelectedHighlight(target);

        // A kiszámított hálózati útvonal kirajzolása a térképre (a kiindulási és érkezési objektum teljes befoglalásával)
        drawRoute(bestPath, activeNavSource, activeNavTarget);
        
        // "Last Mile" gyalogos vonalak rajzolása a középpontok és az útvonal kezdő/végpontjai között
        if(fromFeature) {
                const c = turf.centroid(fromFeature);
                drawWalkLine(c.geometry.coordinates[1], c.geometry.coordinates[0], bestStartNode.lat, bestStartNode.lon, bestStartNode.level);
        } else if (mainEntranceNode) {
                drawWalkLine(mainEntranceNode.lat, mainEntranceNode.lon, bestStartNode.lat, bestStartNode.lon, bestStartNode.level);
        }
        
        if (target.geometry.type !== "Point") {
            const c = turf.centroid(target);
            drawWalkLine(c.geometry.coordinates[1], c.geometry.coordinates[0], bestEndNode.lat, bestEndNode.lon, bestEndNode.level);
        } else {
                drawWalkLine(target.geometry.coordinates[1], target.geometry.coordinates[0], bestEndNode.lat, bestEndNode.lon, bestEndNode.level);
        } 

        // Az útvonal statisztikáinak és az instrukciók (itiner) generálása
        const stats = calculateRouteStats(bestPath);
        const itinerary = generateItinerary(bestPath);
        
        if (IS_EMBED_MODE) {
            updateEmbedForNavigation(target, stats, activeNavSource);
        } else {
            // Az információs panel (Bottom Sheet) frissítése a navigációs adatokkal
            updateSheetForNavigation(target, stats, itinerary, activeNavSource);

            // A panel összecsukása "peek" (részleges betekintő) állapotba
            collapseToPeek();
        }

    } catch (err) { 
        console.error(err); 
        alert(typeof t === 'function' ? t('alerts.general_error', { message: err.message }) : ("Hiba: " + err.message)); 
    }
}

// === NAVIGÁCIÓS ADATOK ÉS ITINER ===

/**
 * Kiszámítja egy megadott útvonal összesített statisztikáit (távolság és becsült utazási idő).
 * Az algoritmus figyelembe veszi az átlagos gyaloglási sebességet, valamint 
 * a szintváltásokból (lépcsőzés, liftezés) eredő fizikai és időbeli sajátosságokat 
 * (például a liftre való várakozási időt).
 * * @param {Array<string>} pathKeys - Az útvonalat alkotó csomópontok kulcsainak tömbje (formátum: 'lat,lon,level').
 * @returns {Object} Az útvonal statisztikáit tartalmazó objektum, amely tartalmazza az össztávolságot méterben (dist) és a becsült időt percben (time).
 */
function calculateRouteStats(pathKeys) {
    let totalDist = 0;
    let totalTime = 0;
    
    // FIZIKAI ÉS IDŐBELI ÁLLANDÓK
    const WALK_SPEED = 1.3; // Átlagos gyaloglási sebesség (méter/másodperc)
    
    // Szintváltásokból eredő időbeli büntetések (másodpercben kifejezve)
    const STAIRS_PENALTY = 15; // Lépcsőhasználat ideje emeletenként
    const ELEVATOR_WAIT = 45;  // A lift megérkezésére és a beszállásra fordított fix várakozási idő
    
    // CIKLUSVÁLTOZÓK
    let prev = null;           // Az előzőleg vizsgált csomópont adatai a távolságméréshez
    let activeElevator = false; // Állapotjelző a folyamatos lifthasználat (több emelet megtétele) nyomon követésére

    pathKeys.forEach(key => {
        // A csomópont kulcsának felbontása földrajzi koordinátákra és emeletszintre
        const parts = key.split(',');
        const current = { lat: parseFloat(parts[0]), lon: parseFloat(parts[1]), level: parts[2] };
        
        if (prev) {
            // --- 1. TÁVOLSÁG KISZÁMÍTÁSA ---
            // A vízszintes (légvonalbeli) távolság kiszámítása (méterben).
            const d = fastDistMeters(prev.lat, prev.lon, current.lat, current.lon);
            totalDist += d;
            
            // --- 2. IDŐSZÜKSÉGLET KISZÁMÍTÁSA ---
            if (prev.level === current.level) {
                // Azonos szinten történő haladás (séta)
                totalTime += (d / WALK_SPEED);
                activeElevator = false; // A lifthasználat megszakadt
            } else {
                // Szintváltás esete
                // Detektáljuk, hogy a szintváltás lifttel vagy lépcsővel történik-e.
                // Heurisztika: Mivel a liftakna geometriailag egy pontban helyezkedik el a térképen,
                // a minimális vízszintes elmozdulás lifthasználatra utal.
                const hDist = d;
                
                if (hDist < 5.0) { 
                    // Lift (vagy csigalépcső) detektálása
                    // A várakozási és beszállási időt csak a beszálláskor (egyszer) adjuk hozzá
                    if (!activeElevator) {
                            totalTime += ELEVATOR_WAIT;
                            activeElevator = true;
                    }
                    // Maga az utazási idő a lifttel (emeletenként hozzávetőlegesen 10 másodperc)
                    totalTime += 10; 
                } else {
                    // Lépcső detektálása (a lépcsőfokok miatti jelentősebb vízszintes elmozdulás alapján)
                    activeElevator = false;
                    totalTime += STAIRS_PENALTY;
                }
            }
        }
        // Az aktuális csomópont mentése a következő iterációhoz
        prev = current;
    });

    // Visszatérés a kerekített statisztikai adatokkal az UI számára
    return {
        dist: Math.round(totalDist),
        time: Math.ceil(totalTime / 60) // A másodpercek átváltása percre (felfelé kerekítve)
    };
}

/**
 * Útvonaltervet (itinert) generál a kiszámított navigációs útvonal alapján.
 * @param {Array<string>} pathKeys - Az útvonal csomópontjainak kulcsai.
 * @returns {Array<Object>} Az itiner lépéseinek tömbje.
 */
function generateItinerary(pathKeys) {
    const steps = [];
    if (!pathKeys || pathKeys.length === 0) return steps;

    // Az indulási szint inicializálása az első csomópont adatai alapján
    let lastLevel = pathKeys[0].split(',')[2];

    /**
     * Belső segédfüggvény: Térbeli (geometriai) adatalapú elemzés a vertikális közlekedő
     * (lift vagy lépcső) pontos típusának meghatározására.
     * * @param {string|number} lat - Földrajzi szélesség.
     * @param {string|number} lon - Földrajzi hosszúság.
     * @param {string} level - A vizsgált emeletszint.
     * @returns {string|null} 'Lift', 'Lépcső' vagy null, ha nincs egyértelmű térképi adat a közelben.
     */
    const detectVerticalType = (lat, lon, level) => {
        // A koordináták számmá konvertálása a matematikai műveletekhez
        const targetLat = parseFloat(lat);
        const targetLon = parseFloat(lon);
        
        // Keresési tolerancia: kb. 5 méteres sugár a koordináta pontossági hibáinak kiküszöbölésére
        const threshold = 0.00005; 

        // Vizsgálat megkezdése, ha rendelkezésre állnak az épület térképi adatai
        if (geoJsonData && geoJsonData.features) {
            for (const f of geoJsonData.features) {
                const p = f.properties;
                
                // A vizsgált térképelem OSM tulajdonságainak ellenőrzése
                const isElevator = p.highway === 'elevator' || p.amenity === 'elevator' || p.room === 'elevator' || p.lift_gate;
                const isStairs = p.highway === 'steps' || p.room === 'stairs' || p.indoor === 'staircase' || p.room === 'staircase';

                // Csak a releváns (vertikális) elemeket vizsgáljuk tovább
                if (!isElevator && !isStairs) continue;

                try {
                    // A vertikális elem geometriai középpontjának (centroid) meghatározása
                    const center = turf.center(f);
                    const c = center.geometry.coordinates; // Formátum: [lon, lat]
                    
                    // Távolság (Euklideszi) számítása a vizsgált csomópont és a vertikális elem között
                    const dist = Math.sqrt(Math.pow(c[1] - targetLat, 2) + Math.pow(c[0] - targetLon, 2));
                    
                    // Ha a pont a tűréshatáron belülre esik, sikeres a detektálás
                    if (dist < threshold) {
                        return isElevator ? 'Lift' : 'Lépcső';
                    }
                } catch(e) {
                    // Hibakezelés a hibás/hiányos geometriájú elemeknél
                }
            }
        }
        // Nincs megfelelő találat a térképi adatok alapján
        return null; 
    };

    // Iteráció a teljes útvonalon, a szintváltások (transition) keresésére
    for (let i = 1; i < pathKeys.length; i++) {
        const currKey = pathKeys[i];
        const prevKey = pathKeys[i-1];
        
        const currParts = currKey.split(',');
        const currLevel = currParts[2];
        
        // Ha a jelenlegi csomópont szintje eltér az előzőtől, szintváltást detektáltunk
        if (currLevel !== lastLevel) {
            // Az irány meghatározása a szintek numerikus összehasonlításával
            const direction = parseFloat(currLevel) > parseFloat(lastLevel) ? 'FEL' : 'LE';
            
            // A célzott szint felhasználóbarát (magyarított/alias) megnevezése
            const label = levelAliases[currLevel] || currLevel;
            
            // 1. STRATÉGIA: Adatalapú detektálás (Keresés a térképelemek között)
            // Megvizsgáljuk az érkezési pont környezetét
            let type = detectVerticalType(currParts[0], currParts[1], currLevel);
            
            // Ha nincs találat, megvizsgáljuk az indulási pont környezetét
            if (!type) {
                    const prevParts = prevKey.split(',');
                    type = detectVerticalType(prevParts[0], prevParts[1], prevParts[2]);
            }

            // 2. STRATÉGIA: Matematikai/Geometriai heurisztika (Fallback)
            // Ha az adat alapú keresés sikertelen, a vertikális és horizontális elmozdulás arányából következtetünk
            if (!type) {
                const p = prevKey.split(',');
                const c = currKey.split(',');
                // Vízszintes távolság kiszámítása a szintváltás két pontja között méterben
                const dist = turf.distance([p[1], p[0]], [c[1], c[0]]) * 1000;
                
                // Szigorú heurisztika: A lift mozgása jellemzően teljesen függőleges (minimális, < 2m elmozdulás),
                // míg a lépcső geometriája jelentős vízszintes elmozdulást eredményez
                type = (dist < 2.0) ? 'Lift' : 'Lépcső';
            }

            // --- Vizuális reprezentáció (Ikon) meghatározása ---
            let icon = 'north_east'; // Alapértelmezett, általános felfelé mutató nyíl
            
            if (type === 'Lift') {
                icon = 'elevator';
            } else if (type === 'Lépcső') {
                // Dedikált lépcső ikon használata a Material Symbols készletből
                icon = 'stairs'; 
            }

            // --- SZAKASZOK ÖSSZEVONÁSA ---
            // Ha a felhasználó folyamatosan több szintet megy fel/le ugyanazon a lépcsőn/liften,
            // ezeket nem külön lépésekként ("Fel az 1-re", "Fel a 2-re"), hanem egyetlen végső
            // instrukcióként jelenítjük meg ("Fel a 2. szintre").
            const lastStep = steps[steps.length - 1];

            const formatStepText = (mType, dir, lvlLabel) => {
                const isStairs = mType === 'Lépcső' || mType === 'stairs';
                const isUp = dir === 'FEL';
                const key = isStairs 
                    ? (isUp ? 'nav.step_stairs_up' : 'nav.step_stairs_down')
                    : (isUp ? 'nav.step_elevator_up' : 'nav.step_elevator_down');
                if (typeof t === 'function') {
                    const trans = t(key, { level: lvlLabel });
                    if (trans && trans !== key) return trans;
                }
                return `${mType} ${dir} a(z) ${lvlLabel}. szintre`;
            };
            
            if (lastStep && lastStep.type === 'transition' && 
                lastStep.moveType === type && lastStep.direction === direction) {
                
                // A meglévő lépés frissítése a legújabb célszinttel
                lastStep.text = formatStepText(type, direction, label);
                lastStep.level = currLevel; 
            } else {
                // Új, önálló instrukció rögzítése az itinerben
                steps.push({
                    type: 'transition',
                    moveType: type,          // Pl. 'Lift' vagy 'Lépcső'
                    direction: direction,    // 'FEL' vagy 'LE'
                    text: formatStepText(type, direction, label),
                    icon: icon,              // Material ikon azonosító
                    level: currLevel         // Emelet azonosítója (későbbi fókuszáláshoz)
                });
            }

            // Állapot frissítése a következő iterációhoz
            lastLevel = currLevel;
        }
    }
    
    return steps;
}

/**
 * Kiszámítja a legrövidebb útvonalat két csomópont között a navigációs gráfban 
 * a Dijkstra-algoritmus segítségével.
 * Az algoritmus figyelembe veszi az élek súlyozását, valamint extra költséget (büntetést)
 * számít fel az idegen szobák ajtajain való áthaladásra, hogy a tervezés során
 * a folyosókat részesítse előnyben a szobákon keresztüli "levágásokkal" szemben.
 *
 * @param {string} startKey - A kiindulási csomópont egyedi azonosítója (kulcsa).
 * @param {string} endKey - A célcsomópont egyedi azonosítója (kulcsa).
 * @returns {Object|null} Egy objektum, amely tartalmazza a kiszámított útvonalat (path)
 * és a teljes távolságot/költséget (distance). Ha nincs elérhető útvonal, null értékkel tér vissza.
 * @throws {Error} Hibát dob, ha az iterációk száma meghaladja a biztonsági korlátot.
 */
/**
 * Prioritási sor (Min-Heap) az útvonalkereséshez.
 */
class MinHeap {
    constructor() {
        this.heap = [];
    }

    get size() {
        return this.heap.length;
    }

    push(item) {
        this.heap.push(item);
        this._siftUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        if (this.heap.length === 1) return this.heap.pop();
        const top = this.heap[0];
        this.heap[0] = this.heap.pop();
        this._siftDown(0);
        return top;
    }

    _siftUp(index) {
        let curr = index;
        while (curr > 0) {
            const parent = (curr - 1) >> 1;
            if (this.heap[curr].dist < this.heap[parent].dist) {
                const temp = this.heap[curr];
                this.heap[curr] = this.heap[parent];
                this.heap[parent] = temp;
                curr = parent;
            } else {
                break;
            }
        }
    }

    _siftDown(index) {
        let curr = index;
        const len = this.heap.length;
        const half = len >> 1;
        while (curr < half) {
            let left = (curr << 1) + 1;
            let right = left + 1;
            let smallest = curr;

            if (left < len && this.heap[left].dist < this.heap[smallest].dist) {
                smallest = left;
            }
            if (right < len && this.heap[right].dist < this.heap[smallest].dist) {
                smallest = right;
            }

            if (smallest !== curr) {
                const temp = this.heap[curr];
                this.heap[curr] = this.heap[smallest];
                this.heap[smallest] = temp;
                curr = smallest;
            } else {
                break;
            }
        }
    }
}

/**
 * Futtatja a Dijkstra útvonalkereső algoritmust két tetszőleges gráfcsomópont között.
 *
 * @param {string} startKey - A kiindulópont egyedi azonosítója (kulcsa).
 * @param {string} endKey - A célcsomópont egyedi azonosítója (kulcsa).
 * @returns {Object|null} Egy objektum, amely tartalmazza a kiszámított útvonalat (path)
 * és a teljes távolságot/költséget (distance). Ha nincs elérhető útvonal, null értékkel tér vissza.
 * @throws {Error} Hibát dob, ha az iterációk száma meghaladja a biztonsági korlátot.
 */
function runDijkstra(startKey, endKey) {
    // Az algoritmushoz szükséges alapvető adatszerkezetek inicializálása
    const distances = new Map(); // A csomópontokhoz vezető eddigi legrövidebb távolságok
    const prev = new Map();      // A legrövidebb útvonal fája (az előző csomópontok tárolására)
    const heap = new MinHeap();  // Gyors bináris min-heap prioritási sor
    
    // A kezdőpont beállítása nulla távolsággal a sorba
    distances.set(startKey, 0); 
    heap.push({ key: startKey, dist: 0 });
    
    // A már véglegesített (feldolgozott) csomópontok halmaza
    const visited = new Set();
    
    // Végtelen ciklus elleni védelem inicializálása
    let loopCounter = 0; 
    const SAFETY_LIMIT = 50000; 

    // Fő iterációs ciklus, amíg van feldolgozatlan csomópont a prioritási sorban
    while (heap.size > 0) {
        // Biztonsági ellenőrzés a túlcsordulás vagy elakadás elkerülésére
        loopCounter++; 
        if (loopCounter > SAFETY_LIMIT) throw new Error("Végtelen ciklus!");
        
        // A legkisebb távolságú csomópont kivétele O(log N) időben
        const node = heap.pop();
        if (!node) break;
        const { key: u, dist } = node;
        
        // Ha elértük a célcsomópontot, visszafejtjük az útvonalat
        if (u === endKey) {
            const path = []; 
            let curr = endKey;
            
            // Visszafelé haladva felépítjük a teljes útvonalat a kezdőpontig
            while (curr) { 
                path.push(curr); 
                curr = prev.get(curr); 
            }
            
            // Visszatérés a helyes sorrendbe fordított útvonallal és a végső költséggel
            return { path: path.reverse(), distance: dist };
        }
        
        // Ha a csomópontot már korábban feldolgoztuk egy rövidebb útvonalon, átugorjuk
        if (visited.has(u)) continue; 
        visited.add(u);
        
        // A jelenlegi csomópont szomszédainak lekérése a globális navigációs gráfból
        const neighbors = navigationGraph.get(u) || [];
        
        for (const n of neighbors) {
            // Biztonsági ellenőrzés az érvénytelen távolságok kiszűrésére
            if (!n.dist || isNaN(n.dist)) continue;
            
            // --- AJTÓ BÜNTETÉS (Door Penalty) LOGIKA ---
            let penalty = 0;
            
            // Ellenőrizzük, hogy a vizsgált csomópont egy ajtó-e
            if (doorNodes.has(n.key)) {
                // Ha az ajtó nem az indulási és nem is az érkezési helyiséghez tartozik,
                // jelentős költségbüntetést (50.0) alkalmazunk, hogy az algoritmus
                // inkább a folyosón haladjon, és ne vágjon át idegen szobákon.
                if (n.key !== startKey && n.key !== endKey) { 
                    penalty = 50.0; 
                }
            }

            // Az új alternatív távolság/költség kiszámítása a szomszédhoz
            const alt = dist + n.dist + penalty;
            const currentDist = distances.get(n.key) !== undefined ? distances.get(n.key) : Infinity;
            
            // Ha a most talált útvonal rövidebb az eddig ismertnél, frissítjük az értékeket
            if (alt < currentDist) { 
                distances.set(n.key, alt); 
                prev.set(n.key, u); 
                heap.push({ key: n.key, dist: alt }); 
            }
        }
    }
    
    // Ha a sor kiürült, de nem értük el a célt, nem létezik összefüggő útvonal
    return null;
}

// === ÚTVONAL ELEMZŐ (Lépcső/Lift Ikonokhoz) ===

/**
 * Azonosítja az útvonal szintváltási pontjait (lépcső, lift).
 * @param {Array<string>} pathKeys - Az útvonal csomópontjainak kulcsai.
 * @returns {Array<Object>} A szintváltó markerek tömbje.
 */
function getVerticalMarkers(path) {
    const markers = [];
    if (!path || path.length < 2) return markers;

    /**
     * Belső segédfüggvény: Meghatározza egy konkrét szintváltó szegmens típusát (lift vagy lépcső).
     * @param {Object} pStart - A szintváltás induló csomópontja.
     * @param {Object} pEnd - A szintváltás érkezési csomópontja.
     * @returns {string} A vertikális elem típusa: 'elevator' vagy 'stairs'.
     */
    const detectSegmentType = (pStart, pEnd) => {
        // 1. STRATÉGIA: Matematikai/Geometriai heurisztika
        // Kiszámítjuk a horizontális elmozdulást a két pont között (méterben)
        const hDist = turf.distance([pStart.lon, pStart.lat], [pEnd.lon, pEnd.lat]) * 1000;
        
        // Heurisztika: A minimális horizontális elmozdulás (< 2.0 méter) liftre utal,
        // az ennél nagyobb elmozdulás jellemzően a lépcső geometriájából adódik.
        let type = (hDist < 2.0) ? 'elevator' : 'stairs';

        // 2. STRATÉGIA: GeoJSON adatok alapján történő típusmeghatározás
        // Ellenőrizzük a térképadatokat a pont környezetében
        if (typeof geoJsonData !== 'undefined' && geoJsonData.features) {
            const pt = turf.point([pStart.lon, pStart.lat]);
            
            // Keressünk releváns (vertikális) térképelemet egy megadott tűréshatáron belül
            const nearFeature = geoJsonData.features.find(f => {
                const p = f.properties;
                
                // Ellenőrizzük a lift tulajdonságokat (highway, room vagy amenity alapú jelölések)
                const isElevator = p.highway === 'elevator' || p.room === 'elevator' || p.amenity === 'elevator';
                // Ellenőrizzük a lépcső tulajdonságokat (vonalas és poligonális jelölések egyaránt)
                const isStairs = p.room === 'stairs' || p.indoor === 'staircase' || p.room === 'staircase' || p.highway === 'steps';
                
                if (!isElevator && !isStairs) return false;

                // Távolság kiszámítása a csomópont és a vizsgált térképelem között
                let dist;
                if (f.geometry.type === 'Point') {
                    dist = turf.distance(pt, f) * 1000;
                } else {
                    // Poligonok vagy vonalak esetén az egyszerűség kedvéért a geometriai
                    // középpontot (centroid) használjuk a távolságbecsléshez.
                    const c = turf.centroid(f);
                    dist = turf.distance(pt, c) * 1000;
                }
                
                // Ha a talált elem a 6 méteres keresési sugáron belül esik, elfogadjuk egyezésként
                if (dist < 6.0) return true;
                return false;
            });
            
            // Ha találtunk megerősítő térképelemet, a metaadatai alapján felülírjuk a matematikai becslést
            if (nearFeature) {
                const p = nearFeature.properties;
                if (p.highway === 'elevator' || p.room === 'elevator' || p.amenity === 'elevator') {
                    type = 'elevator';
                } else {
                    // Minden egyéb vertikális elem (pl. highway=steps, room=stairs) lépcsőként lesz azonosítva
                    type = 'stairs';
                }
            }
        }
        
        return type;
    };

    // Fő iterációs ciklus az útvonal szegmensein
    for (let i = 0; i < path.length - 1; i++) {
        const curr = path[i];
        const next = path[i+1];

        // Szintváltás detektálása az aktuális és a következő csomópont között
        if (curr.level !== next.level) {
            
            // Meghatározzuk a szintváltás kiinduló típusát (lift vagy lépcső)
            const currentType = detectSegmentType(curr, next);
            
            const startLevel = curr.level;
            let finalLevel = next.level;
            
            // Előretekintő index a folyamatos vertikális haladás azonosításához
            let j = i + 1;
            let floorEntryPoint = next; 

            // Addig vizsgáljuk az elkövetkező pontokat, amíg ugyanazon a vertikális vonalon haladunk
            while (j < path.length - 1) {
                const p1 = path[j];
                const p2 = path[j+1];
                
                if (p1.level === p2.level) {
                    // A) Horizontális mozgás az adott (köztes) szinten
                    // Kiszámítjuk a távolságot attól a ponttól, ahol felértünk erre a szintre
                    const distOnFloor = turf.distance([floorEntryPoint.lon, floorEntryPoint.lat], [p2.lon, p2.lat]) * 1000;
                    
                    // Ha több mint 15 métert haladunk vízszintesen, megszakítjuk az összevonást
                    // (pl. átsétálunk a folyosó másik végén lévő lépcsőhöz)
                    if (distOnFloor > 15.0) break; 
                } else {
                    // B) Újabb vertikális szintváltás detektálása (p1 -> p2)
                    const nextSegmentType = detectSegmentType(p1, p2);
                    
                    // Ha a közlekedő típusa megváltozik (pl. lépcsőről átszállunk egy liftbe), 
                    // az összevonást megszakítjuk
                    if (nextSegmentType !== currentType) break;

                    // A vertikális haladás folytatódik: frissítjük az érkezési pontot és a célszintet
                    floorEntryPoint = p2;
                    finalLevel = p2.level; 
                }
                j++; // Lépés a következő szegmensre
            }

            // Ha tényleges (legalább 1 emeletnyi) elmozdulás történt, rögzítjük a markert
            if (startLevel !== finalLevel) {
                // Irány és vizuális jelölések (ikon, felirat) meghatározása
                const direction = parseFloat(finalLevel) > parseFloat(startLevel) ? 'up' : 'down';
                const iconArrow = direction === 'up' ? 'arrow_upward' : 'arrow_downward';
                
                // A célszint felhasználóbarát nevének lekérése (pl. "Fsz." a "0" helyett)
                const displayLevel = (typeof levelAliases !== 'undefined' && levelAliases[finalLevel]) ? levelAliases[finalLevel] : finalLevel;

                // Marker objektum hozzáadása a megjelenítendő elemek listájához
                markers.push({
                    lat: curr.lat,
                    lon: curr.lon,
                    level: curr.level,
                    type: currentType,        // 'elevator' vagy 'stairs' (meghatározza a marker alapikonját)
                    targetLabel: displayLevel, // A megcélzott emelet (pl. "2.")
                    icon: iconArrow           // Az irányt jelző (fel/le) kiegészítő ikon
                });
            }
            
            // Az iterátor frissítése az átugrott (összevont) szegmensek számával,
            // hogy ne vizsgáljuk újra a már lefedett útvonalrészt
            i = j - 1; 
        }
    }
    
    return markers;
}

// === IRÁNYJELZŐ NYILAK GENERÁLÁSA ===

/**
 * Létrehozza és megjeleníti az útvonalat mutató irányjelző nyilakat a térképen.
 * Az algoritmus csak a megfelelő hosszúságú (4 méternél hosszabb), azonos szinten lévő
 * vízszintes szakaszok felezőpontjába helyez el egy SVG alapú, a haladási iránynak
 * megfelelően dinamikusan elforgatott nyilat.
 *
 * @param {Array<string>} pathKeys - Az útvonal csomópontjait tartalmazó kulcsok tömbje (formátum: 'lat,lon,level').
 */
function drawDirectionArrows(pathKeys) {
    _clearArrowMarkers();
    // Irányjelző nyilak MapLibre 'symbol' rétegen (route-arrows)
}

/**
 * Rekurzívan kinyeri az összes [lon, lat] koordinátapárt egy GeoJSON koordináta tömbből.
 */
function _extractCoordsRecursive(coords, out) {
    if (!Array.isArray(coords)) return;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        out.push([coords[0], coords[1]]);
    } else {
        coords.forEach(c => _extractCoordsRecursive(c, out));
    }
}

/**
 * Hozzáadja egy térképi objektum (terem, POI, bejárat) teljes befoglaló téglalapját (bbox)
 * és minden egyes csúcspontját a kamera befoglaló (bounds) listájához.
 */
function _addFeatureCoordsToBounds(feature, boundsPoints) {
    if (!feature) return;
    try {
        if (feature.geometry) {
            // 1. Befoglaló téglalap (Bounding Box) 4 sarka
            if (typeof turf !== 'undefined' && typeof turf.bbox === 'function') {
                const bbox = turf.bbox(feature);
                if (bbox && bbox.length === 4 && !bbox.some(isNaN)) {
                    boundsPoints.push([bbox[0], bbox[1]]); // SW
                    boundsPoints.push([bbox[2], bbox[3]]); // NE
                    boundsPoints.push([bbox[0], bbox[3]]); // NW
                    boundsPoints.push([bbox[2], bbox[1]]); // SE
                }
            }
            // 2. Minden konkrét töréspont
            if (typeof turf !== 'undefined' && typeof turf.coordAll === 'function') {
                const coords = turf.coordAll(feature);
                coords.forEach(pt => {
                    if (Array.isArray(pt) && pt.length >= 2 && !isNaN(pt[0]) && !isNaN(pt[1])) {
                        boundsPoints.push([pt[0], pt[1]]);
                    }
                });
            } else if (feature.geometry.coordinates) {
                _extractCoordsRecursive(feature.geometry.coordinates, boundsPoints);
            }
            return;
        }
        if (feature.coordinates && Array.isArray(feature.coordinates)) {
            _extractCoordsRecursive(feature.coordinates, boundsPoints);
            return;
        }
        if (feature.lon !== undefined && feature.lat !== undefined) {
            boundsPoints.push([parseFloat(feature.lon), parseFloat(feature.lat)]);
            return;
        }
    } catch (e) {
        console.warn("Error adding feature coords to bounds:", e);
    }
}

/**
 * Megjeleníti a kiszámított útvonalat a térképen.
 * Kirajzolja a vízszintes és függőleges szakaszokat, elhelyezi a szintváltásokat
 * jelző vizuális markereket (lift, lépcső), felrajzolja az irányjelző nyilakat,
 * majd a kamerát az útvonalat, valamint a kiindulási és érkezési objektumot
 * TELJES EGÉSZÉBEN befoglaló téglalapra (fitBounds) igazítja.
 *
 * @param {Array<string>} pathKeys - Az útvonal csomópontjait tartalmazó kulcsok tömbje (formátum: 'lat,lon,level').
 * @param {Object|null} [sourceFeature=null] - Opcionális kiindulási objektum (terem/hely).
 * @param {Object|null} [targetFeature=null] - Opcionális érkezési objektum (terem/hely).
 */
function drawRoute(pathKeys, sourceFeature = null, targetFeature = null) {
    _clearRouteMarkers();
    _clearArrowMarkers();
    
    const latlngs = [];
    const routeFeatures = [];
    const boundsPoints = [];

    // 1. Útvonal pontjainak regisztrálása
    pathKeys.forEach(k => {
        const parts = k.split(',');
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        latlngs.push({ lat: lat, lon: lon, level: parts[2] });
        boundsPoints.push([lon, lat]); 
    });

    // 2. Kiindulási objektum (terem / POI / bejárat) teljes bevonása a kameranézetbe
    const startObj = sourceFeature || activeNavSource || (activeRouteData && activeRouteData.start);
    if (startObj) {
        _addFeatureCoordsToBounds(startObj, boundsPoints);
    } else if (mainEntranceNode) {
        boundsPoints.push([mainEntranceNode.lon, mainEntranceNode.lat]);
    }

    // 3. Érkezési objektum (terem / POI) teljes bevonása a kameranézetbe
    const endObj = targetFeature || activeNavTarget || (activeRouteData && activeRouteData.end);
    if (endObj) {
        _addFeatureCoordsToBounds(endObj, boundsPoints);
    }

    for (let i = 0; i < latlngs.length - 1; i++) {
        const p1 = latlngs[i]; 
        const p2 = latlngs[i+1];
        const isStairs = p1.level !== p2.level;
        
        routeFeatures.push({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[p1.lon, p1.lat], [p2.lon, p2.lat]]
            },
            properties: {
                routeType: isStairs ? 'transit' : 'walk',
                level: p1.level,
                levels: isStairs ? [p1.level, p2.level] : null
            }
        });
    }

    if (_mapLayersInitialized && map.getSource('route-geojson')) {
        map.getSource('route-geojson').setData({ type: 'FeatureCollection', features: routeFeatures });
    }

    const vMarkers = getVerticalMarkers(latlngs);
    
    vMarkers.forEach(vm => {
        const el = document.createElement('div');
        el.className = 'nav-marker-container';
        el.dataset.level = vm.level;

        if (vm.type === 'elevator') {
            el.innerHTML = `<div class="nav-badge-elevator"><span>${vm.targetLabel}</span></div>`;
        } else {
            el.innerHTML = `<div class="nav-badge-stairs"><span class="material-symbols-outlined nav-arrow">${vm.icon}</span><span>${vm.targetLabel}</span></div>`;
        }

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([vm.lon, vm.lat])
            .addTo(map);

        marker.getElement().style.pointerEvents = 'none';

        _routeMarkers.push({ marker: marker, level: vm.level });
    });

    drawDirectionArrows(pathKeys);

    // 4. fitBounds a teljes útvonal befoglalására
    const validPoints = boundsPoints.filter(p => Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1]));
    if (validPoints.length > 0) {
        const lons = validPoints.map(p => p[0]);
        const lats = validPoints.map(p => p[1]);

        const isMobile = window.innerWidth <= 600;
        let routePadding;
        
        if (IS_EMBED_MODE) {
            const embedBar = document.getElementById('embed-info-bar');
            const bPad = (embedBar && embedBar.classList.contains('visible')) ? 95 : 35;
            routePadding = { top: 30, bottom: bPad, left: 30, right: 65 };
        } else if (isDesktopSidePanel()) {
            const sheetEl = document.getElementById('bottom-sheet');
            const panelW = sheetEl ? (sheetEl.getBoundingClientRect().width || 390) : 390;
            // Desktopon a bal oldali panel szélessége + margó védi a látványt
            routePadding = { 
                top: 80, 
                bottom: 50, 
                left: panelW + 45, 
                right: 75 
            };
        } else {
            // Mobilon a felső top-bar és az alsó betekintő sáv magassága
            const peekH = (typeof getPeekHeight === 'function') ? getPeekHeight() : 110;
            routePadding = { 
                top: isMobile ? 125 : 80, 
                bottom: peekH + 35, 
                left: 30, 
                right: 65 
            };
        }

        const routeMaxZoom = IS_EMBED_MODE ? 18.5 : 20.2;
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);

        if (minLon === maxLon && minLat === maxLat) {
            map.flyTo({
                center: [minLon, minLat],
                zoom: 19.5,
                padding: routePadding,
                animate: true,
                duration: 1000
            });
        } else {
            map.fitBounds(
                [[minLon, minLat], [maxLon, maxLat]],
                {
                    padding: routePadding,
                    maxZoom: routeMaxZoom,
                    animate: true,
                    duration: 1000
                }
            );
        }
    }
    
    switchLevel(latlngs[0].level);
}

function drawWalkLine(lat1, lon1, lat2, lon2, level) {
    if (!_mapLayersInitialized) return;
    const src = map.getSource('route-geojson');
    if (!src) return;

    const currentData = src._data || { type: 'FeatureCollection', features: [] };
    const features = [...currentData.features];
    
    features.push({
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: [[lon1, lat1], [lon2, lat2]]
        },
        properties: {
            routeType: 'walkline',
            level: level
        }
    });

    src.setData({ type: 'FeatureCollection', features: features });
}

function updateRouteVisibility(level) {
    if (!_mapLayersInitialized) return;

    if (map.getLayer('route-walk')) {
        map.setPaintProperty('route-walk', 'line-opacity', ['case', ['==', ['get', 'level'], level], 1, 0.1]);
    }
    if (map.getLayer('route-transit')) {
        map.setPaintProperty('route-transit', 'line-opacity', 
            ['case', 
                ['any', 
                    ['==', ['get', 'level'], level], 
                    ['in', level, ['coalesce', ['get', 'levels'], ['literal', []]]]
                ], 
                1, 0.1
            ]
        );
    }
    if (map.getLayer('route-walkline')) {
        map.setPaintProperty('route-walkline', 'line-opacity', ['case', ['==', ['get', 'level'], level], 0.7, 0.1]);
    }
    if (map.getLayer('route-arrows')) {
        map.setPaintProperty('route-arrows', 'icon-opacity', ['case', ['==', ['get', 'level'], level], 1, 0.1]);
    }

    _routeMarkers.forEach(({ marker, level: mLevel }) => {
        if (marker.getElement()) {
            marker.getElement().style.display = mLevel === level ? 'block' : 'none';
        }
    });

    _arrowMarkers.forEach(({ marker, level: mLevel }) => {
        if (marker.getElement()) {
            marker.getElement().style.display = mLevel === level ? 'block' : 'none';
        }
    });
}

/**
 * Elemzi a betöltött GeoJSON térképadatokat, és kinyeri az épületben elérhető 
 * összes szint (emelet) azonosítóját. Emellett összegyűjti a szintekhez tartozó 
 * felhasználóbarát megnevezéseket (aliasokat), majd inicializálja az alapértelmezett nézetet.
 */
function processLevels() {
    const levels = new Set();
    // A globális alias szótár ürítése az újratöltés előtt
    levelAliases = {}; 
    
    if (!geoJsonData) return;
    
    geoJsonData.features.forEach(feature => { 
        const p = feature.properties;
        
        // Szűrés a releváns térképelemekre: csak a tényleges navigációs vagy 
        // infrastrukturális elemek szintadatait vesszük figyelembe.
        const isRelevant = (
            p.highway === 'corridor' || p.highway === 'steps' || p.room || 
            p.amenity === 'toilets' || p.entrance || p.door ||
            p.indoor === 'room' || p.indoor === 'area' || p.indoor === 'corridor'
        );

        if (isRelevant) {
            const feats = getLevelsFromFeature(feature); 
            
            // Az elem által érintett összes szint hozzáadása a halmazhoz (Set), 
            // amely automatikusan kiszűri a duplikátumokat.
            feats.forEach(l => levels.add(l));

            // --- ALIASOK (Megnevezések) GYŰJTÉSE ---
            // Szigorú logika: Az alternatív szintmegnevezéseket (pl. 'level:ref') 
            // kizárólag olyan elemekből nyerjük ki, amelyek pontosan egy szinten helyezkednek el.
            // Ezzel elkerülhető, hogy a többszintes elemek (pl. lépcsőházak, 'level=2-3') 
            // hibás adatokat generáljanak a szintválasztó gombok számára.
            if (p['level:ref'] && feats.length === 1) {
                levelAliases[feats[0]] = p['level:ref'];
            }
        }
    });
    
    // A halmaz szabványos tömbbé alakítása és numerikus értékeik alapján növekvő sorrendbe rendezése
    availableLevels = Array.from(levels).sort((a, b) => parseFloat(a) - parseFloat(b));
    
    // Az alapértelmezett (indulási) szint meghatározása.
    // Prioritás: Az épület konfigurált alapértelmezett szintje (K esetén "1", máshol "0"), ha létezik,
    // egyébként a földszint ("0"), majd a legalacsonyabb elérhető szint.
    const defaultLvl = getDefaultLevelForBuilding(currentBuildingKey);
    if (availableLevels.includes(defaultLvl)) {
        currentLevel = defaultLvl;
    } else if (availableLevels.includes("0")) {
        currentLevel = "0";
    } else if (availableLevels.length > 0) {
        currentLevel = availableLevels[0];
    } else {
        currentLevel = defaultLvl; // Biztonsági alapértelmezés (Fallback)
    }
}

/**
 * Létrehozza és a térképhez adja a szintválasztó (emeletváltó) vezérlőelemeket.
 * A funkció először eltávolítja a korábbi vezérlőket, majd az elérhető szintek
 * (availableLevels) alapján generálja a gombokat. Kezeli az események (kattintás,
 * görgetés, érintés) továbbterjedésének megakadályozását a térkép felé.
 */
function createLevelControls() {
    document.querySelectorAll('.level-control').forEach(e => e.remove());
    
    const div = document.createElement('div');
    div.className = 'level-control';
    
    ['wheel', 'touchstart', 'touchmove', 'mousedown', 'click'].forEach(evt => {
        div.addEventListener(evt, e => e.stopPropagation());
    });

    availableLevels.slice().reverse().forEach(lvl => {
        const btn = document.createElement('button');
        btn.dataset.level = lvl; 
        const label = levelAliases[lvl] || lvl;
        btn.innerText = label;
        btn.className = 'level-btn ' + (lvl === currentLevel ? 'active' : '');
        btn.onclick = (e) => { 
            e.stopPropagation(); 
            switchLevel(lvl); 
        };
        div.appendChild(btn);
    });
    
    const container = map.getContainer ? map.getContainer() : document.getElementById('map');
    container.appendChild(div);
    
    setTimeout(() => {
        updateLevelUI();
    }, 50);
}

/**
 * Frissíti a szintválasztó gombok vizuális állapotát a felhasználói felületen,
 * és automatikusan a látható terület (scroll) közepére görgeti az aktív gombot.
 */
function updateLevelUI() {
    document.querySelectorAll('.level-btn').forEach(btn => {
        if (btn.dataset.level === currentLevel.toString()) {
            // Aktív állapot beállítása
            btn.classList.add('active');
            
            // --- AUTOMATIKUS GÖRGETÉS ---
            const container = btn.parentNode; // Ez a .level-control div
            
            // Kiszámoljuk a gomb középpontjának helyét a konténeren belül
            const scrollPos = btn.offsetTop - (container.offsetHeight / 2) + (btn.offsetHeight / 2);
            
            // Sima, animált görgetés a kiszámított pozícióba
            container.scrollTo({
                top: scrollPos,
                behavior: 'smooth'
            });
            
        } else {
            // Inaktív állapot
            btn.classList.remove('active');
        }
    });
}

/**
 * Végrehajtja a térkép szintjének (emeletének) megváltoztatását.
 * Frissíti a globális állapottároló változót, újrarendereli a térkép vizuális elemeit
 * az új szintnek megfelelően, és szinkronizálja a felhasználói felületet (UI).
 *
 * @param {string|number} level - A megjeleníteni kívánt szint azonosítója.
 */
function switchLevel(level) {
    // A globális változó frissítése, biztosítva a sztring típusú tárolást
    currentLevel = level.toString(); 
    
    // 1. A térkép vizuális elemeinek újrarenderelése azonnal, animáció nélkül
    renderLevel(currentLevel, false);
    
    // 2. A szintválasztó gombok állapotának (aktív kijelölés) frissítése a felületen
    updateLevelUI();
    
    // A szintváltás tényének és paramétereinek naplózása hibakeresési célból
}

// === KAMERAMOZGATÁS (ADAPTÍV ZOOM ÉS OFFSET) ===

// Debounce állapot a redundáns, egymás után közvetlenül lefutó repülések kiszűrésére
let _lastFlyToTime = 0;
let _lastFlyToCoords = null;

/**
 * Visszaadja az alsó információs panel (Bottom Sheet) célzott végleges magasságát.
 * Nem az éppen animálódó köztes magasságot (offsetHeight) nézi, hanem:
 * 1. Ha van közvetlenül átadott explicit célmagasság, azt használja.
 * 2. Ha a sheet.style.height attribútumban már be van állítva a végcél (pl. "280px"), azt veszi.
 * 3. Ha a sheet most nyílik meg, a tartalom alapján kalkulált getAutoHeight() értéket használja.
 *
 * @param {number} [explicitHeight] - Opcionális, előre ismert célmagasság pixelben.
 * @returns {number} A panel végleges magassága pixelben.
 */
function getSheetTargetHeight(explicitHeight) {
    if (typeof explicitHeight === 'number' && explicitHeight > 0) {
        return explicitHeight;
    }
    const sheet = document.getElementById('bottom-sheet');
    if (!sheet) return 160;

    // 1. Ha a style.height attribútumban már ott van a célmagasság (pl. "280px")
    if (sheet.style.height && sheet.style.height.endsWith('px')) {
        const val = parseFloat(sheet.style.height);
        if (!isNaN(val) && val > 50) return val;
    }

    // 2. Ha még nincs style.height vagy zárt a panel, a tartalom alapján számoljuk a célmagasságot
    if (typeof getAutoHeight === 'function') {
        const autoH = getAutoHeight();
        if (autoH > 50) return autoH;
    }

    if (typeof getPeekHeight === 'function') {
        return getPeekHeight();
    }

    return 240;
}

/**
 * A térkép kameráját a megadott térképelemre mozgatja adaptív zoom-méretezéssel.
 * @param {Object} feature - A cél térképi elem.
 */
function smartFlyTo(feature, explicitBottomHeight) {
    if (!feature || !feature.geometry) return;

    // 1. Koordináta meghatározás
    let lon, lat;
    if (feature.geometry.type === "Point") {
        lon = feature.geometry.coordinates[0];
        lat = feature.geometry.coordinates[1];
    } else {
        const c = turf.centroid(feature);
        lon = c.geometry.coordinates[0];
        lat = c.geometry.coordinates[1];
    }

    // 2. Időzített híváskorlátozás (debounce) azonos koordináták esetén
    const now = Date.now();
    if (_lastFlyToCoords && (now - _lastFlyToTime < 250)) {
        const dLon = Math.abs(_lastFlyToCoords[0] - lon);
        const dLat = Math.abs(_lastFlyToCoords[1] - lat);
        if (dLon < 0.00005 && dLat < 0.00005) {
            return;
        }
    }
    _lastFlyToTime = now;
    _lastFlyToCoords = [lon, lat];

    // 3. Emeletváltás, ha a kiválasztott elem más szinten van
    const levels = getLevelsFromFeature(feature);
    if (levels.length > 0 && !levels.includes(currentLevel)) {
        switchLevel(levels[0]);
    }

    // 4. Bounding box számítása
    let bounds;
    if (feature.geometry.type === "Point") {
        bounds = [[lon, lat], [lon, lat]];
    } else {
        const bbox = turf.bbox(feature);
        bounds = [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
    }

    // 5. UI Padding és kitakarások kiszámítása
    const isMobile = window.innerWidth <= 600;
    let topPad = 70;
    let bottomPad = 160;
    let leftPad = isMobile ? 25 : 45;
    let rightPad = isMobile ? 65 : 75; // .level-control védelem a jobb oldalon

    if (IS_EMBED_MODE) {
        topPad = 25;
        const embedBar = document.getElementById('embed-info-bar');
        bottomPad = (embedBar && embedBar.classList.contains('visible')) ? 90 : 35;
        leftPad = 25;
        rightPad = 65;
    } else if (isDesktopSidePanel()) {
        // --- DESKTOP: bal oldali panel kitakarás ---
        topPad = 75;
        const sheetEl = document.getElementById('bottom-sheet');
        const panelOpen = sheetEl && sheetEl.classList.contains('open');
        const panelW = panelOpen ? (sheetEl.getBoundingClientRect().width || 390) : 0;
        leftPad = panelW > 0 ? (panelW + 40) : 45;
        bottomPad = 40;
        rightPad = 75;
    } else {
        // Felső sáv (#top-bar) kitakarása
        topPad = isMobile ? 120 : 75;

        // Alsó panel célmagasságának meghatározása (az animációtól FÜGGETLEN végleges érték!)
        const settingsModal = document.getElementById('settings-modal');
        let finalBottomHeight = 0;

        if (settingsModal && settingsModal.classList.contains('editor-mode')) {
            const card = settingsModal.querySelector('.settings-card');
            if (card) finalBottomHeight = card.getBoundingClientRect().height;
        } else {
            finalBottomHeight = getSheetTargetHeight(explicitBottomHeight);
        }

        // Kitakart terület maximális korlátja a képernyőmagasság 50%-ában
        const maxAllowedBottom = window.innerHeight * 0.5;
        finalBottomHeight = Math.min(Math.max(160, finalBottomHeight), maxAllowedBottom);
        bottomPad = finalBottomHeight + 20;
    }

    // Környezeti kontextus margó: hogy a terem körül a folyosó és ajtó is tisztán látsszon
    const contextMargin = isMobile ? 25 : 40;
    const computedPadding = {
        top: Math.round(topPad + contextMargin),
        bottom: Math.round(bottomPad + contextMargin),
        left: Math.round(leftPad + contextMargin),
        right: Math.round(rightPad + contextMargin)
    };

    // 6. Optimális Zoom határok
    const maxComfortZoom = IS_EMBED_MODE ? 18.5 : 19.35;
    const minComfortZoom = 18.2;

    // 7. Kamera kiszámítása a MapLibre cameraForBounds funkciójával
    let camera = null;
    try {
        camera = map.cameraForBounds(bounds, {
            padding: computedPadding,
            maxZoom: maxComfortZoom
        });
    } catch (e) {
        console.warn("cameraForBounds error:", e);
    }

    if (camera && camera.center) {
        const finalZoom = Math.min(maxComfortZoom, Math.max(minComfortZoom, camera.zoom));
        map.flyTo({
            center: camera.center,
            zoom: finalZoom,
            duration: 750,
            essential: true
        });
    } else {
        // Fallback: Ha a cameraForBounds nem tudná kiszámítani (pl. extrém kis ablakméret)
        map.flyTo({
            center: [lon, lat],
            zoom: maxComfortZoom,
            padding: { 
                top: topPad, 
                bottom: bottomPad, 
                left: leftPad, 
                right: rightPad 
            },
            duration: 750,
            essential: true
        });
    }

    drawSelectedHighlight(feature);
}

function zoomToFeature(feature, explicitHeight) {
    smartFlyTo(feature, explicitHeight);
}

// === ALSÓ INFORMÁCIÓS PANEL (BOTTOM SHEET) MOZGATÁSI LOGIKA ===

// DOM elemek referenciáinak inicializálása a panel manipulációjához
const sheet = document.getElementById('bottom-sheet');
const handle = document.getElementById('sheet-handle');
const content = document.getElementById('sheet-scroll-content');
const footer = document.querySelector('.sheet-footer');
const header = document.querySelector('.sheet-header');

// Állapotváltozók a húzási (drag) interakció és a fizikai szimuláció nyomon követéséhez
let _sheetState = 'peek';        // 'peek' | 'auto' | 'full' — aktuális snap pont állapot
let _isDraggingSheet = false;     // Logikai jelző a húzási folyamat állapotáról
let _potentialScrollDrag = false; // Full módban a scroll tetejéről indult-e lefelé húzás
let _dragStartY = 0;              // Az érintés/kattintás kezdeti Y koordinátája
let _dragStartHeight = 0;         // A panel magassága a húzás megkezdésekor
let _dragLastY = 0;               // Az előző mérési pont Y koordinátája
let _dragLastTime = 0;            // Az előző mérési pont időbélyege (performance.now())
let _dragVelocity = 0;            // Időalapú mozgási sebesség (px/ms)
let _didSheetDrag = false;        // Kattintás vs húzás megkülönböztetése
let _activeTouchId = null;        // Aktív érintés azonosítója (multi-touch védelem)

/**
 * Kiszámítja az alsó információs panel minimális (betekintő / peek) magasságát.
 * Ez az a vertikális méret, amelynél a fejléc, a húzófogantyú és a lábléc (az akciógombokkal) 
 * látható marad, de maga a tartalom rejtve van a felhasználó elől.
 *
 * @returns {number} A számított betekintő magasság pixelben kifejezve.
 */
function getPeekHeight() {
    // A UI komponensek aktuális magasságának lekérése, biztonsági alapértelmezett értékekkel (fallback)
    const handleH = (handle && handle.offsetHeight) || 25;
    const headerH = (header && header.offsetHeight) || 60;
    const isNav = header && header.classList.contains('nav-mode');
    if (isNav) {
        return handleH + headerH + 15;
    }
    const footerH = (footer && footer.style.display !== 'none') ? (footer.offsetHeight || 80) : 0;
    
    // A komponensek magasságának összegzése, kiegészítve egy 10px-es vizuális margóval a zsúfoltság elkerülésére
    return handleH + headerH + footerH + 10;
}

/**
 * Kiszámítja a belső görgethető tartalom valós, természetes magasságát.
 * Elkerüli a flex: 1 által mesterségesen kifeszített méretek (content.scrollHeight) téves mérését.
 * @returns {number} A belső elemek tényleges magassága pixelben.
 */
function getScrollContentHeight() {
    if (!content) return 0;
    const nearby = document.getElementById('nearby-menu-container');
    if (nearby && nearby.style.display !== 'none' && nearby.offsetHeight > 0) {
        return nearby.offsetHeight;
    }
    const itinerary = document.getElementById('nav-itinerary');
    if (itinerary && itinerary.style.display !== 'none' && itinerary.offsetHeight > 0) {
        return itinerary.offsetHeight;
    }
    const dataContainer = document.getElementById('room-data-container');
    if (dataContainer && dataContainer.style.display !== 'none' && dataContainer.offsetHeight > 0) {
        return dataContainer.offsetHeight;
    }
    let sum = 0;
    for (const child of content.children) {
        if (child.style.display !== 'none') {
            sum += (child.offsetHeight || 0);
        }
    }
    if (sum > 0) return sum;
    return content.scrollHeight || 0;
}

/**
 * Kiszámítja a panel automatikus (optimális) magasságát a belső tartalom kiterjedése alapján.
 * A függvény biztosítja, hogy a panel alapértelmezetten ne takarja ki a képernyőt teljesen,
 * és egy meghatározott aránynál (60%) megálljon.
 *
 * @returns {number} Az ideális magasság pixelben kifejezve.
 */
function getAutoHeight() {
    const contentH = getScrollContentHeight();
    const peekH = getPeekHeight();
    
    // A teljes szükséges magasság: a fix elemek (peek) és a valós belső tartalom összege
    const total = peekH + contentH + 15;
    
    // A visszaadott érték maximalizálása az elérhető ablakmagasság 60%-ában
    return Math.min(total, window.innerHeight * 0.6);
}

/**
 * Kiszámítja a teljes képernyős állapot magasságát.
 * @returns {number} A teljes viewport magasság pixelben.
 */
function getFullHeight() {
    return window.innerHeight;
}

/**
 * Visszaadja az elérhető snap pontok magasságait egy objektumban.
 * @returns {{peek: number, auto: number, full: number}}
 */
function _getSnapPoints() {
    return {
        peek: getPeekHeight(),
        auto: getAutoHeight(),
        full: getFullHeight()
    };
}

/**
 * Összecsukja az információs panelt a minimális (peek) állapotába.
 * CSS átmenetet (transition) alkalmaz a finom animációhoz, és visszaállítja
 * a belső görgetési pozíciót az alaphelyzetbe, hogy a következő megnyitáskor 
 * a tartalom ismét a tetejétől legyen olvasható.
 */
function collapseToPeek() {
    if (isDesktopSidePanel()) {
        sheet.style.height = '';
        sheet.classList.add('open');
        const scrollContent = document.getElementById('sheet-scroll-content');
        if (scrollContent) scrollContent.scrollTop = 0;
        return;
    }

    const peekH = getPeekHeight();
    
    // A panel magasságának és az animációs átmenet paramétereinek beállítása
    sheet.style.height = `${peekH}px`;
    sheet.style.transition = 'height 0.3s ease-out';
    
    // A nyitott állapotot jelző CSS osztály fenntartása (mivel a peek is egy látható, interaktív állapot)
    sheet.classList.add('open');
    sheet.classList.remove('sheet-full');
    _sheetState = 'peek';
    
    // A belső görgetősáv (scroll) pozíciójának nullázása a tiszta állapot eléréséhez
    content.scrollTop = 0;
}

// === ESEMÉNYKEZELŐK (EVENT LISTENERS) ===

/**
 * Beállítja a panelt egy adott snap pontra, animációval.
 * @param {'peek'|'auto'|'full'} target - A cél snap pont neve.
 */
function _snapSheetTo(target) {
    const snaps = _getSnapPoints();
    const targetH = snaps[target];
    
    // Ruganyos (spring) animációs görbe alkalmazása a természetesebb fizikai hatásért
    sheet.style.transition = 'height 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    sheet.style.height = `${targetH}px`;
    
    // Állapot frissítés
    _sheetState = target;
    
    if (target === 'full') {
        sheet.classList.add('sheet-full');
    } else {
        sheet.classList.remove('sheet-full');
    }
    
    if (target === 'peek') {
        content.scrollTop = 0;
    }
}

/**
 * Események: A panel húzásának megkezdése.
 * A teljes sheet felületéről indítható, nem csak a handle-ből.
 * @param {number} clientY - Az érintés/kattintás Y koordinátája.
 * @param {'handle'|'content'} source - Honnan indult a gesztus.
 */
function _onSheetDragStart(clientY, source) {
    if (isDesktopSidePanel()) return;
    
    _dragStartY = clientY;
    _dragLastY = clientY;
    _dragLastTime = performance.now();
    _dragVelocity = 0;
    _didSheetDrag = false;
    _dragStartHeight = sheet.getBoundingClientRect().height;
    
    if (_sheetState === 'full') {
        if (source === 'handle') {
            // Full módban a fejléc/handle érintése azonnal sheet draget indít
            _isDraggingSheet = true;
            _potentialScrollDrag = false;
            sheet.style.transition = 'none';
        } else {
            // Tartalom érintése full módban:
            if (content.scrollTop <= 0) {
                // A tartalom legtetején vagyunk: potenciális visszahúzás
                _potentialScrollDrag = true;
                _isDraggingSheet = false;
            } else {
                // A tartalom le van görgetve: hagyjuk a belső scrollt
                _potentialScrollDrag = false;
                _isDraggingSheet = false;
            }
        }
    } else {
        // Peek vagy Auto módban a sheet BÁRMELY pontjának érintése sheet draget indít
        _isDraggingSheet = true;
        _potentialScrollDrag = false;
        sheet.style.transition = 'none';
    }
}

let _sheetRafId = null;
let _pendingSheetHeight = null;

/**
 * Események: A panel húzása közben (touchmove / mousemove).
 * Kezeli a scroll↔drag koordinációt.
 * @param {number} clientY - Az érintés/kattintás aktuális Y koordinátája.
 * @param {Event} event - Az eredeti touch/mouse event a preventDefault() híváshoz.
 */
function _onSheetDragMove(clientY, event) {
    const deltaY = _dragStartY - clientY; // >0: felfelé húzás, <0: lefelé húzás
    
    // Disambiguálás full-screen módban a scroll tetején:
    if (_potentialScrollDrag) {
        if (deltaY < -6 && content.scrollTop <= 0) {
            // Lefelé húzás a tartalom tetejéről -> sheet drag aktiválása!
            _potentialScrollDrag = false;
            _isDraggingSheet = true;
            _dragStartHeight = sheet.getBoundingClientRect().height;
            _dragStartY = clientY;
            _dragLastY = clientY;
            _dragLastTime = performance.now();
            sheet.style.transition = 'none';
        } else if (deltaY > 6) {
            // Felfelé húzás -> a user lejjebb akar görgetni a tartalomban!
            _potentialScrollDrag = false;
            _isDraggingSheet = false;
            return;
        } else {
            return;
        }
    }
    
    if (!_isDraggingSheet) return;
    
    if (Math.abs(deltaY) > 5) {
        _didSheetDrag = true;
    }
    
    // Időalapú velocity számítás (px/ms)
    const now = performance.now();
    const dt = now - _dragLastTime;
    if (dt > 0) {
        _dragVelocity = (clientY - _dragLastY) / dt;
    }
    _dragLastY = clientY;
    _dragLastTime = now;
    
    // Húzás közben tiltjuk a natív böngésző scrollt
    if (event && event.cancelable) {
        event.preventDefault();
    }
    
    const snaps = _getSnapPoints();
    const newHeight = _dragStartHeight + deltaY;
    
    // Húzási határok: alulról peek * 0.75, felülről a képernyő teteje
    if (newHeight >= snaps.peek * 0.75 && newHeight <= snaps.full) {
        _pendingSheetHeight = newHeight;
        if (!_sheetRafId) {
            _sheetRafId = requestAnimationFrame(() => {
                if (_pendingSheetHeight !== null) {
                    sheet.style.height = `${_pendingSheetHeight}px`;
                }
                _sheetRafId = null;
            });
        }
    }
}

/**
 * Események: A húzás befejeződése (touchend / mouseup).
 * Snap logika: a panel a legközelebbi snap pontra ugrik, velocity és zónák alapján.
 */
function _onSheetDragEnd() {
    if (_sheetRafId) {
        cancelAnimationFrame(_sheetRafId);
        _sheetRafId = null;
    }
    _pendingSheetHeight = null;
    _potentialScrollDrag = false;
    
    if (!_isDraggingSheet) return;
    _isDraggingSheet = false;
    
    const currentHeight = sheet.getBoundingClientRect().height;
    const snaps = _getSnapPoints();
    
    let target;
    
    // 1. Határozott lendület (Flick) esetén sebesség alapú döntés
    if (_dragVelocity > 0.35) {
        // Lefelé flick
        if (currentHeight > snaps.auto + 30) {
            target = (_dragVelocity > 0.9) ? 'peek' : 'auto';
        } else {
            target = 'peek';
        }
    } else if (_dragVelocity < -0.35) {
        // Felfelé flick
        if (currentHeight < snaps.auto - 20) {
            target = 'auto';
        } else {
            target = 'full';
        }
    } else {
        // 2. Távolság / Pozíció alapú felezőpontos snap zónák:
        // A legközelebbi snap magassági pozíció beállítása
        // soha semmilyen körülmények között nem maradhat a kettő között!
        const midPeekAuto = (snaps.peek + snaps.auto) / 2;
        const midAutoFull = (snaps.auto + snaps.full) / 2;
        
        if (currentHeight < midPeekAuto) {
            target = 'peek';
        } else if (currentHeight < midAutoFull) {
            target = 'auto';
        } else {
            target = 'full';
        }
    }
    
    _snapSheetTo(target);
}

// --- ESEMÉNYFIGYELŐK REGISZTRÁLÁSA ---

// Érintés indítása a sheet teljes felületén
sheet.addEventListener('touchstart', (e) => {
    if (isDesktopSidePanel()) return;
    
    // Ne zavarjuk a gombokat, linkeket, űrlapmezőket, galériaképeket
    const tag = e.target.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.gallery-img')) return;
    
    const touch = e.changedTouches[0];
    _activeTouchId = touch.identifier;
    
    const source = (e.target.closest('#sheet-handle') || e.target.closest('.sheet-header')) ? 'handle' : 'content';
    _onSheetDragStart(touch.clientY, source);
}, { passive: true });

// Érintés mozgatása és befejezése a WINDOW objektumon (így ujjcsúszáskor sem vész el az esemény!)
window.addEventListener('touchmove', (e) => {
    if (!_isDraggingSheet && !_potentialScrollDrag) return;
    
    let touch = null;
    for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === _activeTouchId) {
            touch = e.touches[i];
            break;
        }
    }
    if (!touch) touch = e.touches[0];
    if (!touch) return;
    
    _onSheetDragMove(touch.clientY, e);
}, { passive: false });

window.addEventListener('touchend', () => {
    if (_isDraggingSheet || _potentialScrollDrag) {
        _onSheetDragEnd();
    }
});

window.addEventListener('touchcancel', () => {
    if (_isDraggingSheet || _potentialScrollDrag) {
        _onSheetDragEnd();
    }
});

// Egér események (asztali / laptop touchpad teszteléshez)
sheet.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (isDesktopSidePanel()) return;
    
    const tag = e.target.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.gallery-img')) return;
    
    e.preventDefault();
    const source = (e.target.closest('#sheet-handle') || e.target.closest('.sheet-header')) ? 'handle' : 'content';
    _onSheetDragStart(e.clientY, source);
});

window.addEventListener('mousemove', (e) => {
    if (!_isDraggingSheet && !_potentialScrollDrag) return;
    _onSheetDragMove(e.clientY, e);
});

window.addEventListener('mouseup', () => {
    if (_isDraggingSheet || _potentialScrollDrag) {
        _onSheetDragEnd();
    }
});

window.addEventListener('blur', () => {
    if (_isDraggingSheet || _potentialScrollDrag) {
        _onSheetDragEnd();
    }
});

/**
 * Eseménykezelő a húzófogantyúra (handle) történő normál kattintásra.
 * 3 állapot közti váltás: Peek → Auto → Full → Peek
 */
handle.addEventListener('click', () => {
    if (isDesktopSidePanel()) return;
    if (_didSheetDrag) {
        _didSheetDrag = false;
        return;
    }
    
    // Egyenletes (ease-out) animáció alkalmazása a kattintásos állapotváltásnál
    sheet.style.transition = 'height 0.3s ease-out';

    if (_sheetState === 'peek') {
        _snapSheetTo('auto');
    } else if (_sheetState === 'auto') {
        _snapSheetTo('full');
    } else {
        _snapSheetTo('peek');
    }
});


/**
 * Globális eseménykezelők a felületen kívüli (focus lost / backdrop) kattintások detektálására.
 */
let _modalMouseDownTarget = null;
document.addEventListener('mousedown', (e) => {
    _modalMouseDownTarget = e.target;
});

document.addEventListener('click', (e) => {
    // 1. Keresőmezőn kívüli kattintás -> találati lista elrejtése
    const searchWrapper = document.getElementById('search-wrapper');
    const resultsDiv = document.getElementById('search-results');
    
    if (searchWrapper && resultsDiv && !searchWrapper.contains(e.target) && resultsDiv.style.display !== 'none') {
        resultsDiv.style.display = 'none';
    }

    // 2. Beállítások kártyán kívüli (backdrop) kattintás -> modal bezárása (desktop és mobil)
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal && settingsModal.classList.contains('visible') && !settingsModal.classList.contains('editor-mode')) {
        if (e.target === settingsModal && _modalMouseDownTarget === settingsModal) {
            toggleSettings();
        }
    }

    // 3. Impresszum kártyán kívüli (backdrop) kattintás -> modal bezárása
    const impressumModal = document.getElementById('impressum-modal');
    if (impressumModal && impressumModal.classList.contains('visible')) {
        if (e.target === impressumModal && _modalMouseDownTarget === impressumModal) {
            toggleImpressum();
        }
    }
});

// Escape billentyű leütésére a nyitott modális ablakok bezárása
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const sm = document.getElementById('settings-modal');
        if (sm && sm.classList.contains('visible') && !sm.classList.contains('editor-mode')) {
            toggleSettings();
        }
        const im = document.getElementById('impressum-modal');
        if (im && im.classList.contains('visible')) {
            toggleImpressum();
        }
    }
});


// === MEGOSZTÁS ÉS MÉLYHIVATKOZÁS (DEEP LINK) LOGIKA ===

/**
 * Kinyeri a legmegbízhatóbb egyedi azonosítót egy térképelemből (GeoJSON feature)
 * a megosztási hivatkozások és állapotmentés számára. 
 * Azonosítási prioritás: 1. OSM ID, 2. Referencia (ref) vagy Név (name), 3. Geometriai középpont.
 *
 * @param {Object} feature - A feldolgozandó GeoJSON térképelem.
 * @returns {Object|null} Az azonosítót ({type, val|lat, lon, lvl}) tartalmazó objektum, 
 * vagy null, ha a bemenet érvénytelen.
 */
function getFeatureId(feature) {
    if (!feature) return null;
    
    const p = feature.properties;
    const lvl = getLevelsFromFeature(feature)[0] || "0";

    // 1. PRIORITÁS: OSM ID (A legpontosabb, globálisan egyedi azonosító)
    // Használatával elkerülhető a névütközésekből adódó pontatlan helymeghatározás.
    if (feature.id) {
        return { type: 'id', val: feature.id, lvl: lvl };
    }

    // 2. PRIORITÁS: Referencia azonosító vagy Név (Tartalék megoldás)
    if (p.ref) {
        return { type: 'ref', val: p.ref, lvl: lvl };
    }
    if (p.name) {
        return { type: 'name', val: p.name, lvl: lvl };
    }
    
    // 3. PRIORITÁS: Földrajzi koordináta (Végső tartalék megoldás)
    // A térképelem geometriai középpontjának (centroid) kiszámítása a Turf.js segítségével.
    const c = turf.centroid(feature);
    return { 
        type: 'coord', 
        // A koordinátákat 6 tizedesjegy pontosságra (kb. 10 cm) kerekítjük az URL rövidsége érdekében
        lat: c.geometry.coordinates[1].toFixed(6), 
        lon: c.geometry.coordinates[0].toFixed(6),
        lvl: lvl
    };
}

/**
 * Megjelenít egy rövid ideig tartó, vizuális értesítést (toast notification) a képernyőn.
 *
 * @param {string} message - A megjelenítendő tájékoztató szöveg.
 */
function showToast(message) {
    const t = document.getElementById('toast-notification');
    if (!t) return;

    // Toast elem áthelyezése a body-ba a helyes pozicionáláshoz
    // hogy zárt sheet esetén is mindig a képernyőn (látható) maradjon!
    if (t.parentNode.id === 'bottom-sheet') {
        document.body.appendChild(t);
    }
    
    // Szöveges tartalom dinamikus frissítése, amennyiben paraméterként megadásra került
    if (message) {
        t.innerText = message; 
    }
    
    // A láthatóságot vezérlő CSS osztály hozzáadása
    t.classList.add('visible');
    
    // Korábbi időzítő törlése új értesítéskor
    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
    }
    
    // Értesítés elrejtése 3 másodperc után
    window.toastTimeout = setTimeout(() => {
        t.classList.remove('visible');
    }, 3000);
}

/**
 * Generál egy egyedi URL-t (mélyhivatkozást) az alkalmazás aktuális állapotáról, 
 * majd automatikusan a felhasználó vágólapjára másolja azt.
 * Képes teljes útvonalak (navigáció) vagy egyedi kiválasztott helyszínek megosztására.
 */
function shareCurrentState() {
    // Az alapvető adatcsomag inicializálása az aktuális épület azonosítójával
    let payload = { b: currentBuildingKey }; 

    if (activeRouteData) {
        // --- ÚTVONAL MEGOSZTÁSI MÓD ---
        payload.mode = 'route';
        // A kezdőpont és a célpont azonosítóinak kinyerése
        // Megjegyzés: activeRouteData.start lehet null (pl. Főbejárat használata esetén)
        payload.s = getFeatureId(activeRouteData.start); 
        payload.e = getFeatureId(activeRouteData.end);   
    } else if (selectedFeature) {
        // --- EGYEDI HELYSZÍN MEGOSZTÁSI MÓD ---
        payload.mode = 'loc';
        payload.t = getFeatureId(selectedFeature);
    } else {
        // Megszakítás: nincs megosztható állapot
        return; 
    }

    // --- ADATKÓDOLÁS (Serialization & Encoding) ---
    // Az objektum JSON formátummá alakítása
    const jsonStr = JSON.stringify(payload);
    
    // Biztonságos Base64 kódolás generálása UTF-8 karakterek (pl. ékezetek) támogatásával
    const encoded = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g,
        function toSolidBytes(match, p1) { return String.fromCharCode('0x' + p1); }));

    // A jelenlegi böngésző URL-jének feldolgozása és a kódolt adatcsomag hozzáfűzése a lekérdezési paraméterekhez
    const url = new URL(window.location.href);
    url.searchParams.set('share', encoded);

    // --- VÁGÓLAPRA MÁSOLÁS ---
    // Kísérlet a generált URL vágólapra helyezésére a Clipboard API használatával
    navigator.clipboard.writeText(url.toString()).then(() => {
        // Sikeres másolás esetén értesítés megjelenítése
        showToast(typeof t === 'function' ? t('toasts.link_copied') : "Link másolva! 📋");
    }).catch(err => {
        // Hibakezelés: ha a böngésző biztonsági okokból blokkolja a vágólap hozzáférést,
        // egy manuális prompt ablakot biztosítunk a másoláshoz
        console.error('Copy failed', err);
        prompt(typeof t === 'function' ? t('alerts.copy_link_prompt') : "Másold ki a linket:", url.toString());
    });
}

/**
 * Generál egy HTML iframe beágyazási kódot az aktuális helyszínhez vagy navigációs útvonalhoz,
 * majd a vágólapra másolja azt.
 */
function copyEmbedCode() {
    const origin = (window.location.origin && window.location.origin.startsWith('http')) 
        ? window.location.origin 
        : 'https://bmemap.hu';
    let embedUrl = `${origin}/embed`;
    const params = new URLSearchParams();
    params.set('mode', 'embed');
    params.set('b', currentBuildingKey);

    if (activeRouteData && activeRouteData.end) {
        const p = activeRouteData.end.properties || {};
        const refOrName = p.ref || p.name;
        if (refOrName) {
            params.set('room', refOrName);
        } else if (activeRouteData.end.id) {
            params.set('id', activeRouteData.end.id);
        }
        params.set('nav', 'true');
    } else if (selectedFeature) {
        const p = selectedFeature.properties || {};
        const refOrName = p.ref || p.name;
        if (refOrName) {
            params.set('room', refOrName);
        } else if (selectedFeature.id) {
            params.set('id', selectedFeature.id);
        }
    }

    const currentLang = APP_SETTINGS.language || 'hu';
    if (currentLang !== 'hu') {
        params.set('lang', currentLang);
    }

    const finalUrl = `${embedUrl}?${params.toString()}`;
    const iframeSnippet = `<iframe src="${finalUrl}" width="100%" height="420" style="border:0; border-radius:16px;" loading="lazy" allow="geolocation" title="BME Térkép"></iframe>`;

    navigator.clipboard.writeText(iframeSnippet).then(() => {
        showToast(typeof t === 'function' ? (t('toasts.embed_copied') || "Iframe beágyazási kód másolva! 📋") : "Iframe beágyazási kód másolva! 📋");
    }).catch(err => {
        console.error('Embed copy failed', err);
        prompt(typeof t === 'function' ? t('alerts.copy_embed_prompt', 'Másold ki az iframe kódot:') : "Másold ki az iframe kódot:", iframeSnippet);
    });
}

// === 3. URL FELDOLGOZÁS ÉS ÁLLAPOTVISSZAÁLLÍTÁS (DEEP LINKING) ===

/**
 * Feldolgozza a böngésző URL-jében található lekérdezési paramétereket (query parameters),
 * specifikusan a megosztási (share) kódot keresve. Ha talál ilyet, dekódolja az adatokat,
 * és automatikusan visszaállítja az alkalmazás állapotát (egy adott helyszín megjelenítése 
 * vagy egy útvonaltervezés elindítása).
 */
async function processUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const shareCode = params.get('share');
    
    // Ha nincs megosztási kód az URL-ben, a függvény esemény nélkül kilép
    if (!shareCode) return;

    try {
        // --- ADATDEKÓDOLÁS ---
        // A kódolási folyamat visszafordítása: Base64 -> UTF-8 kompatibilis string -> JSON objektum
        const jsonStr = decodeURIComponent(atob(shareCode).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        
        const data = JSON.parse(jsonStr);

        // Megjegyzés: Az esetleges épületváltás logikáját (ha a link más épületre mutat, 
        // mint az alapértelmezett) az inicializációs fázisban, a térképadatok (loadOsmData) 
        // betöltése előtt kell kezelni a redundáns hálózati kérések elkerülése végett.
        // Itt már feltételezzük, hogy a megfelelő épület adatai be vannak töltve az OSM-ből.
        
        /**
         * Belső segédfüggvény a megosztott adatokban szereplő térképelem (feature) 
         * azonosítására a memóriában lévő GeoJSON adathalmazból.
         * * @param {Object} desc - A térképelem leíró objektuma (type, val, lvl).
         * @returns {Object|null} A megtalált GeoJSON elem, vagy null, ha nincs találat.
         */
        const findFeat = (desc) => {
            if (!desc) return null;
            
            // A) ID ALAPÚ KERESÉS (Legmagasabb prioritás)
            // Egyezés vizsgálata az OSM azonosító alapján
            if (desc.type === 'id') {
                return geoJsonData.features.find(f => f.id === desc.val);
            }

            // B) KOORDINÁTA ALAPÚ KERESÉS
            if (desc.type === 'coord') {
                // Megjegyzés: Jelenleg nincs implementálva (pl. turf.nearestPoint használható lenne), 
                // mivel az elsődleges ID alapú azonosítás lefedi a használati esetek többségét.
                return null; 
            }
            
            // C) NÉV VAGY REFERENCIA ALAPÚ KERESÉS
            // A smartFilter algoritmus használata a találatok listázására
            const hits = smartFilter(desc.val);
            if (hits.length > 0 && desc.lvl) {
                // Ha van szintinformáció, megpróbáljuk a pontosan azonos szinten lévő elemet kiválasztani
                const exact = hits.find(h => getLevelsFromFeature(h).includes(desc.lvl));
                return exact || hits[0]; // Fallback: az első találat
            }
            return hits[0];
        };

        // --- ÁLLAPOT VISSZAÁLLÍTÁSA A MÓD ALAPJÁN ---

        // 1. EGYEDI HELYSZÍN MÓD ('loc')
        if (data.mode === 'loc') {
            const target = findFeat(data.t);
            if (target) {
                // Időzített végrehajtás (300ms késleltetés) a térkép renderelési ciklusának 
                // lezárására, biztosítva az animáció (flyTo) zavartalan futását.
                setTimeout(() => {
                    openSheet(target);
                }, 300);
            }
        } 
        // 2. ÚTVONALTERVEZÉSI MÓD ('route')
        else if (data.mode === 'route') {
            const endFeature = findFeat(data.e);
            const startFeature = findFeat(data.s); // Null érték esetén a főbejárat lesz a kiindulópont
            
            if (endFeature) {
                // A célpont vizuális kiemelése a térképen
                drawSelectedHighlight(endFeature);

                // --- INFORMÁCIÓS PANEL (UI) ELŐKÉSZÍTÉSE ---
                // A panel fejlécének dinamikus kitöltése a célpont adataival, 
                // hogy a betekintő (peek) nézet azonnal releváns információt mutasson.
                const p = endFeature.properties;
                let typeName = getHungarianType(p);
                typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);
                
                // A megjelenítendő név (displayName) prioritásos meghatározása
                let displayName = p.name || p.ref;
                if (!displayName) {
                    displayName = typeName;
                }
        
                // A szint (emelet) megjelenítési formátumának összeállítása
                let displayLevelString = "";
                if (p['level:ref']) {
                    displayLevelString = p['level:ref'];
                } else {
                    const rawLevels = getLevelsFromFeature(endFeature);
                    const mappedLevels = rawLevels.map(lvl => levelAliases[lvl] || lvl);
                    displayLevelString = mappedLevels.join(', ');
                }
        
                // Az értékek DOM-ba történő beillesztése
                document.getElementById('sheet-title').innerText = displayName;
                if (displayName === typeName) {
                    document.getElementById('sheet-sub').innerText = `Szint: ${displayLevelString}`;
                } else {
                    document.getElementById('sheet-sub').innerText = `Szint: ${displayLevelString} | ${typeName}`;
                }

                // A navigációs motor elindítása a paraméterekből kinyert pontokkal
                startNavigation(endFeature, startFeature);
            }
        }
        
        // --- URL TISZTÍTÁSA ---
        // A megosztási paraméter eltávolítása a böngésző címsorából a History API segítségével.
        // Ez megakadályozza az állapot ismételt feldolgozását egy esetleges oldalfrissítés során.
        if (!IS_EMBED_MODE) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

    } catch (e) {
        // Hibakezelés a dekódolási vagy parsing hibák naplózására
        console.error("Deep Link Error:", e);
    }
}

// === EMBED MÓD SEGÉDFÜGGVÉNYEK ===

/**
 * Megjeleníti a mini info bar-t embed módban a kiválasztott terem/helyiség adataival.
 * Beállítja a mélyhivatkozásokat a megnyitás és a navigáció gombokhoz.
 * @param {Object} feature - A kiválasztott GeoJSON térképelem.
 */
function openEmbedInfo(feature) {
    if (!feature) return;

    selectedFeature = feature;
    smartFlyTo(feature);
    drawSelectedHighlight(feature);

    const p = feature.properties || {};

    // 1. Típus meghatározása
    let typeName = getHungarianType(p);
    typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);

    // 2. Megjelenítendő név (displayName)
    let displayName = "";
    if (p.name && p.ref) {
        const cleanName = p.name.toLowerCase().replace(/[\s-]/g, '');
        const cleanRef = p.ref.toLowerCase().replace(/[\s-]/g, '');
        displayName = cleanName.includes(cleanRef) ? p.name : `${p.ref} - ${p.name}`;
    } else {
        displayName = p.name || p.ref;
    }

    if (!displayName || (!isNaN(displayName) && displayName.toString().length > 5)) {
        let matchedPoiName = null;
        if (typeof POI_TYPES !== 'undefined') {
            for (const key in POI_TYPES) {
                if (POI_TYPES[key].filter(p)) {
                    matchedPoiName = POI_TYPES[key].name;
                    break;
                }
            }
        }
        displayName = matchedPoiName || typeName;
    }

    // 3. Szint szöveg
    let displayLevelString = "";
    if (p['level:ref']) {
        displayLevelString = p['level:ref'];
    } else {
        const rawLevels = getLevelsFromFeature(feature);
        const mappedLevels = rawLevels.map(lvl => levelAliases[lvl] || lvl);
        displayLevelString = mappedLevels.join(', ');
    }

    let extraInfo = "";
    if (p.amenity === 'vending_machine' && p.vending) {
        const vDict = { 'coffee': 'Kávé', 'drinks': 'Ital', 'sweets': 'Édesség', 'snack': 'Snack', 'food': 'Étel' };
        const types = p.vending.split(';');
        const translated = types.map(tKey => {
            const raw = tKey.trim();
            if (typeof t === 'function') {
                const trans = t(`vending.${raw}`);
                if (trans && trans !== `vending.${raw}`) return trans;
            }
            return vDict[raw] || raw;
        });
        extraInfo = translated.join(', ');
    } else if (p.operator) {
        extraInfo = p.operator;
    }

    let lvlPrefix = "Szint";
    if (typeof t === 'function') {
        const trans = t('sheet.level_prefix');
        if (trans && trans !== 'sheet.level_prefix') {
            lvlPrefix = trans;
        } else if (typeof i18n !== 'undefined' && i18n.currentLanguage === 'en') {
            lvlPrefix = "Level";
        }
    }
    let subText = "";
    if (extraInfo) {
        subText = `${lvlPrefix}: ${displayLevelString} | ${extraInfo}`;
    } else if (displayName === typeName) {
        subText = `${lvlPrefix}: ${displayLevelString}`;
    } else {
        subText = `${lvlPrefix}: ${displayLevelString} | ${typeName}`;
    }

    // DOM elemek frissítése
    const titleEl = document.getElementById('embed-info-title');
    const subEl = document.getElementById('embed-info-sub');
    if (titleEl) titleEl.innerText = displayName;
    if (subEl) subEl.innerText = subText;

    // Navigáció gomb alaphelyzetbe állítása
    const navBtn = document.getElementById('embed-nav-btn');
    if (navBtn) {
        navBtn.innerHTML = '<span class="material-symbols-outlined">directions</span>';
        navBtn.setAttribute('data-i18n-title', 'embed.nav_to');
        navBtn.setAttribute('title', (typeof t === 'function' && t('embed.nav_to') !== 'embed.nav_to') ? t('embed.nav_to') : 'Útvonal ide');
    }

    const embedBar = document.getElementById('embed-info-bar');
    if (embedBar) {
        embedBar.classList.remove('nav-active');
        embedBar.classList.add('visible');
    }

    // Megnyitás teljes nézetben link
    const origin = (window.location.origin && window.location.origin.startsWith('http')) 
        ? window.location.origin 
        : 'https://bmemap.hu';

    const locPayload = {
        b: currentBuildingKey,
        mode: 'loc',
        t: getFeatureId(feature)
    };
    const locJsonStr = JSON.stringify(locPayload);
    const locEncoded = btoa(encodeURIComponent(locJsonStr).replace(/%([0-9A-F]{2})/g,
        (match, p1) => String.fromCharCode('0x' + p1)));
    
    const openFullBtn = document.getElementById('embed-open-full');
    if (openFullBtn) {
        openFullBtn.href = `${origin}/?share=${locEncoded}`;
    }

    // Értesítés a beágyazó szülő ablaknak (pl. Embed Konfigurátor)
    const roomVal = p.ref || p.name || displayName || '';
    if (window.parent && window.parent !== window) {
        try {
            window.parent.postMessage({
                type: 'bmemap_embed_select',
                building: currentBuildingKey,
                featureId: feature.id || null,
                room: roomVal,
                ref: p.ref || '',
                name: p.name || '',
                displayName: displayName || roomVal || 'Kiválasztott terem',
                level: (getLevelsFromFeature(feature) || [])[0] || '',
                shareCode: locEncoded
            }, '*');
            console.log('[BMEmap Embed] Sent bmemap_embed_select:', roomVal, currentBuildingKey);
        } catch(e) {
            console.warn('[BMEmap Embed] postMessage error:', e);
        }
    }
}

/**
 * Kezeli az embed módbeli navigáció gomb kattintását.
 * Közvetlenül az iframe-en belül indítja el az útvonaltervezést (a főbejárattól ide).
 */
function handleEmbedNavClick() {
    if (!selectedFeature) return;
    
    // Ha már aktív navigáció fut ehhez a célponthoz, kattintásra újra kiszámoljuk vagy frissítjük
    startNavigation(selectedFeature, null);
}

/**
 * Frissíti az embed mini info bar-t aktív navigáció esetén (távolság, menetidő, mélyhivatkozás).
 * @param {Object} target - A célpont GeoJSON feature
 * @param {Object} stats - { time, dist } statisztikák
 * @param {Object} source - A kezdőpont feature
 */
function updateEmbedForNavigation(target, stats, source) {
    const titleEl = document.getElementById('embed-info-title');
    const subEl = document.getElementById('embed-info-sub');
    
    const p = target.properties || {};
    let displayName = p.name || p.ref || (typeof getHungarianType === 'function' ? getHungarianType(p) : "Célpont");
    if (titleEl) titleEl.innerText = displayName;

    // Statisztika szöveg összeállítása (pl. "🚶 2 perc • 120 m")
    let timeStr = `${stats.time} perc`;
    let distStr = `${stats.dist} m`;
    if (typeof t === 'function') {
        const tTime = t('nav.time_minutes', { time: stats.time });
        if (tTime && tTime !== 'nav.time_minutes') {
            timeStr = tTime;
        } else if (typeof i18n !== 'undefined' && i18n.currentLanguage === 'en') {
            timeStr = `${stats.time} min`;
        }

        const tDist = t('nav.dist_meters', { dist: stats.dist });
        if (tDist && tDist !== 'nav.dist_meters') {
            distStr = tDist;
        }
    }
    if (subEl) {
        subEl.innerText = `🚶 ${timeStr} • ${distStr}`;
    }

    const embedBar = document.getElementById('embed-info-bar');
    if (embedBar) {
        embedBar.classList.add('nav-active');
        embedBar.classList.add('visible');
    }

    // Megnyitás új lapon link frissítése navigációs share kódra
    const origin = (window.location.origin && window.location.origin.startsWith('http')) 
        ? window.location.origin 
        : 'https://bmemap.hu';

    const routePayload = {
        b: currentBuildingKey,
        mode: 'route',
        s: null, // Főbejárat
        e: getFeatureId(target)
    };
    const routeJsonStr = JSON.stringify(routePayload);
    const routeEncoded = btoa(encodeURIComponent(routeJsonStr).replace(/%([0-9A-F]{2})/g,
        (match, p1) => String.fromCharCode('0x' + p1)));

    const openFullBtn = document.getElementById('embed-open-full');
    if (openFullBtn) {
        openFullBtn.href = `${origin}/?share=${routeEncoded}`;
    }

    // Értesítés a beágyazó szülő ablaknak (pl. Embed Konfigurátor)
    const roomVal = p.ref || p.name || displayName || '';
    if (window.parent && window.parent !== window) {
        try {
            window.parent.postMessage({
                type: 'bmemap_embed_nav',
                building: currentBuildingKey,
                featureId: target.id || null,
                room: roomVal,
                ref: p.ref || '',
                name: p.name || '',
                displayName: displayName || roomVal || 'Célpont',
                level: (getLevelsFromFeature(target) || [])[0] || '',
                shareCode: routeEncoded
            }, '*');
            console.log('[BMEmap Embed] Sent bmemap_embed_nav:', roomVal, currentBuildingKey);
        } catch(e) {
            console.warn('[BMEmap Embed] postMessage error:', e);
        }
    }
}

/**
 * Bezárja az embed info bar-t és törli a kijelölést és az aktív útvonalat.
 */
function closeEmbedInfo() {
    const embedBar = document.getElementById('embed-info-bar');
    if (embedBar) {
        embedBar.classList.remove('visible');
        embedBar.classList.remove('nav-active');
    }
    if (activeRouteData) {
        clearRouteAndClose();
    }
    selectedFeature = null;
    drawSelectedHighlight(null);
}

/**
 * Feldolgozza az embed mód specifikus URL paramétereit:
 * room / r, id, level / floor, theme, nav.
 */
function processEmbedParams() {
    if (!IS_EMBED_MODE) return;

    const params = new URLSearchParams(window.location.search);

    // 1. Téma felülbírálása, ha az URL-ben meg van adva
    const themeParam = params.get('theme');
    if (themeParam === 'dark' || themeParam === 'light') {
        setThemeMode(themeParam);
    }

    // 2. Szint beállítása
    const levelParam = params.get('level') || params.get('floor');
    if (levelParam && typeof switchLevel === 'function') {
        switchLevel(levelParam);
    }

    // 3. Ha közvetlen share kód van az embed URL-ben, azt a processUrlParams dolgozza fel
    const shareParam = params.get('share');
    if (shareParam) {
        processUrlParams();
        return;
    }

    // 4. Automatikus navigáció kérése (nav=true / nav=1)
    const autoNav = params.get('nav') === 'true' || params.get('nav') === '1' || params.get('mode') === 'route';

    // 5. Terem vagy POI keresése és megnyitása
    const roomParam = params.get('room') || params.get('r');
    const idParam = params.get('id');

    if (!roomParam && !idParam) return;

    if (!geoJsonData || !geoJsonData.features || geoJsonData.features.length === 0) {
        let retries = 0;
        const checkDataInterval = setInterval(() => {
            retries++;
            if (geoJsonData && geoJsonData.features && geoJsonData.features.length > 0) {
                clearInterval(checkDataInterval);
                _selectEmbedFeature(roomParam, idParam, levelParam, autoNav);
            } else if (retries > 50) {
                clearInterval(checkDataInterval);
            }
        }, 100);
    } else {
        _selectEmbedFeature(roomParam, idParam, levelParam, autoNav);
    }
}

function _selectEmbedFeature(roomParam, idParam, levelParam, autoNav = false) {
    if (!geoJsonData || !geoJsonData.features) return;

    let target = null;

    // A) ID alapú keresés
    if (idParam) {
        const numId = parseInt(idParam, 10);
        target = geoJsonData.features.find(f => f.id === numId || f.id === idParam || f.id === idParam.toString());
    }

    // B) Teremnév / ref alapú keresés (ha szám, akkor ID-ként is teszteljük)
    if (!target && roomParam) {
        const cleanQuery = roomParam.trim();
        if (!isNaN(cleanQuery) && cleanQuery.length > 3) {
            const numId = parseInt(cleanQuery, 10);
            target = geoJsonData.features.find(f => f.id === numId || f.id === cleanQuery);
        }
        // 1. Pontos ref egyezés
        if (!target) {
            target = geoJsonData.features.find(f => f.properties && f.properties.ref && f.properties.ref.toLowerCase() === cleanQuery.toLowerCase());
        }
        // 2. Pontos név egyezés
        if (!target) {
            target = geoJsonData.features.find(f => f.properties && f.properties.name && f.properties.name.toLowerCase() === cleanQuery.toLowerCase());
        }
        // 3. smartFilter algoritmus használata
        if (!target && typeof smartFilter === 'function') {
            const hits = smartFilter(cleanQuery);
            if (hits.length > 0) {
                if (levelParam) {
                    target = hits.find(h => getLevelsFromFeature(h).includes(levelParam)) || hits[0];
                } else {
                    target = hits[0];
                }
            }
        }
    }

    if (target) {
        setTimeout(() => {
            openEmbedInfo(target);
            if (autoNav) {
                setTimeout(() => {
                    startNavigation(target, null);
                }, 200);
            }
        }, 300);
    }
}

// === GLOBÁLIS ÁLLAPOTVÁLTOZÓK A GESZTUSKEZELÉSHEZ ===

// Globális állapotjelző, amely megakadályozza a térképi elemekre történő véletlen 
// kattintást (kiválasztást) egy komplex gesztus (pl. egyujjas nagyítás) végrehajtása közben.
window.isMapInteractionLocked = false;

// Időzítő (timeout) referencia a kattintási események szándékos késleltetéséhez vagy megszakításához.
window.clickTimeout = null; 

/**
 * Engedélyezi az egyujjas nagyítási (one-finger zoom) funkciót a térképen.
 * Ez egy fejlett érintésvezérlési gesztus: a felhasználó duplán koppint a képernyőre, 
 * majd a második érintést lenyomva tartva fel-le húzza az ujját a térkép nagyításához 
 * vagy kicsinyítéséhez.
 *
 * @param {Object} map - A MapLibre GL térképpéldány, amelyen a gesztuskezelést implementáljuk.
 */
function enableOneFingerZoom(map) {
    const container = map.getCanvas();
    
    let lastTap = 0;
    let startY = 0;
    let startZoom = 0;
    let isZooming = false;

    container.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;

        if (window.clickTimeout) {
            clearTimeout(window.clickTimeout);
            window.clickTimeout = null;
        }

        const now = Date.now();
        
        if (now - lastTap < 300) {
            window.isMapInteractionLocked = true;
            isZooming = true;
            
            startY = e.touches[0].clientY;
            startZoom = map.getZoom();
            
            map.dragPan.disable();
        }
        lastTap = now;
    });

    container.addEventListener('touchmove', (e) => {
        if (!isZooming) return;
        
        window.isMapInteractionLocked = true;

        const y = e.touches[0].clientY;
        const delta = y - startY; 
        
        if (Math.abs(delta) > 10) {
            if (e.cancelable) e.preventDefault();
            
            const sensitivity = 250; 
            const zoomChange = delta / sensitivity;
            
            map.setZoom(startZoom + zoomChange);
        }
    }, { passive: false });

    container.addEventListener('touchend', (e) => {
        if (isZooming || window.isMapInteractionLocked) {
            isZooming = false;
            
            map.dragPan.enable();

            setTimeout(() => {
                window.isMapInteractionLocked = false;
            }, 400);
        }
    });
}

// === ALKALMAZÁS INICIALIZÁLÁSA ===
map.on('load', async () => {
    _initMapSources();
    _initMapLayers();
    _initMapEventListeners();
    _mapLayersInitialized = true;
    _currentMapStyleMode = getEffectiveThemeMode();

    enableOneFingerZoom(map);

    initBuildings();
    renderThemeSelector();
    applyTheme();
    syncSheetLayoutForViewport();

    // Az i18n inicializálása a térkép és UI elkészülése UTÁN történik,
    // így a languageChanged esemény már minden elemet és réteget készen talál.
    if (typeof i18n !== 'undefined') {
        await i18n.init();
        APP_SETTINGS.language = i18n.currentLanguage;
    }

    if (!IS_EMBED_MODE) {
        updateSettingsUI();
    }

    const params = new URLSearchParams(window.location.search);
    const shareCode = params.get('share');
    const buildingParam = params.get('building') || params.get('b');

    let buildingToLoad = "K"; 

    if (buildingParam) {
        const searchKey = buildingParam.trim().toUpperCase();
        const matchedKey = Object.keys(BUILDINGS).find(key => key.toUpperCase() === searchKey);
        
        if (matchedKey) {
            buildingToLoad = matchedKey;
        } else {
            console.warn("Ismeretlen épület paraméter az URL-ben:", buildingParam);
        }
    }

    if (shareCode) {
        try {
            const jsonStr = decodeURIComponent(atob(shareCode).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            
            const data = JSON.parse(jsonStr);
            
            if (data.b && BUILDINGS[data.b]) {
                buildingToLoad = data.b;
            }
        } catch(e) { 
            console.warn("Invalid Share Code"); 
        }
    }

    if (buildingToLoad !== currentBuildingKey) {
        changeBuilding(buildingToLoad); 
    } else {
        loadOsmData(); 
    }

    if (!IS_EMBED_MODE) {
        detectClosestBuilding();
    } else {
        processEmbedParams();
    }

    // Globális keresési index csendes előtöltése a háttérben
    setTimeout(() => {
        loadSearchIndex();
    }, 1200);
});

// Nyelvváltás eseményfigyelő
window.addEventListener('languageChanged', () => {
    if (!IS_EMBED_MODE) {
        updateSettingsUI();
        renderThemeSelector();
    }
    if (typeof initBuildings === 'function') initBuildings();
    if (activeRouteData && activeNavTarget && activeNavSource && currentRoutePath) {
        const stats = calculateRouteStats(currentRoutePath);
        const itinerary = generateItinerary(currentRoutePath);
        updateSheetForNavigation(activeNavTarget, stats, itinerary, activeNavSource);
    } else if (selectedFeature) {
        if (IS_EMBED_MODE) {
            openEmbedInfo(selectedFeature);
        } else if (document.getElementById('bottom-sheet') && document.getElementById('bottom-sheet').classList.contains('open')) {
            openSheet(selectedFeature);
        }
    }
});

// Képernyőméret változás (Desktop ↔ Mobil) eseményfigyelő
window.addEventListener('resize', () => {
    syncSheetLayoutForViewport();
    const sheet = document.getElementById('bottom-sheet');
    if (!sheet || !sheet.classList.contains('open')) return;

    if (isDesktopSidePanel()) {
        sheet.style.height = '';
        const galleryEl = document.getElementById('room-gallery');
        const dotsContainer = document.getElementById('gallery-dots');
        if (galleryEl && dotsContainer) {
            const activeDot = dotsContainer.querySelector('.gallery-dot.active');
            if (activeDot) {
                const index = Array.from(dotsContainer.children).indexOf(activeDot);
                if (index >= 0) {
                    galleryEl.scrollLeft = index * galleryEl.clientWidth;
                }
            }
        }
    } else {
        const snaps = _getSnapPoints();
        if (_sheetState === 'full') {
            sheet.style.height = `${snaps.full}px`;
        } else if (_sheetState === 'peek') {
            sheet.style.height = `${snaps.peek}px`;
        } else {
            sheet.style.height = `${snaps.auto}px`;
        }
    }
});


// === PWA & SERVICE WORKER REGISZTRÁCIÓ ===

if ('serviceWorker' in navigator && !IS_EMBED_MODE) {
    let isRefreshing = false;
    // Ha null, ez a legelső látogatás (még sosem volt korábban aktív SW ezen a böngészőn)
    let hadPreviousController = !!navigator.serviceWorker.controller;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Első telepítéskor a SW most vette át a klienst először: NE töltsünk újra!
        if (!hadPreviousController) {
            hadPreviousController = true;
            return;
        }
        // Valódi verziófrissítéskor (pl. v39 -> v40) viszont újratöltünk, hogy a legfrissebb kód fusson
        if (!isRefreshing) {
            isRefreshing = true;
            window.location.reload();
        }
    });

    window.addEventListener('load', () => {
        // updateViaCache: 'none' megakadályozza a sw.js HTTP gyorsítótárazását
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
            .then((registration) => {
                // Azonnali háttérellenőrzés az induláskor
                registration.update();

                // Amikor az app visszatér az előtérbe (mobil háttérből visszaváltva)
                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible') {
                        registration.update();
                    }
                });
            })
            .catch((err) => {
                console.warn("SW regisztrációs hiba:", err);
            });
    });
}

// 2. "Add to Home Screen" (Telepítés) logika kezelése
let deferredPrompt;
const installSection = document.getElementById('pwa-install-section');
const installBtn = document.getElementById('btn-install-app');

// A böngésző szól, ha az app telepíthető (Android/Chrome)
window.addEventListener('beforeinstallprompt', (e) => {
    // Megakadályozzuk az automatikus, tolakodó felugró ablakot
    e.preventDefault();
    // Eltároljuk az eseményt, hogy később (gombnyomásra) előhívhassuk
    deferredPrompt = e;
    // Megjelenítjük a telepítés gombot a Beállításokban
    if (installSection) installSection.style.display = 'block';
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
            // Előhívjuk a rendszer telepítő ablakát
            deferredPrompt.prompt();
            // Megvárjuk a felhasználó döntését
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                installSection.style.display = 'none'; // Eltüntetjük a gombot
            }
            // A promptot csak egyszer lehet használni
            deferredPrompt = null;
        }
    });
}

// Ha a felhasználó már telepítette az appot, elrejtjük a gombot
window.addEventListener('appinstalled', () => {
    if (installSection) installSection.style.display = 'none';
    showToast(typeof t === 'function' ? t('toasts.installed', 'BMEmap sikeresen telepítve! 📱') : "BMEmap sikeresen telepítve! 📱");
});

// Globális függvényexportok a HTML eseménykezelők számára
window.handleEmbedNavClick = handleEmbedNavClick;
window.openEmbedInfo = openEmbedInfo;
window.closeEmbedInfo = closeEmbedInfo;
window.copyEmbedCode = copyEmbedCode;
window.startNavigationToHere = startNavigationToHere;

// ==========================================================================
// BEÉPÍTETT KÉPNÉZEGETŐ (LIGHTBOX) MODUL
// ==========================================================================

let _viewerImages = [];
let _viewerIndex = 0;
let _viewerScale = 1;
let _viewerPanX = 0;
let _viewerPanY = 0;
let _viewerIsOpen = false;
let _viewerIsDragging = false;
let _viewerDragStartX = 0;
let _viewerDragStartY = 0;
let _viewerInitialPanX = 0;
let _viewerInitialPanY = 0;
let _viewerPinchStartDistance = 0;
let _viewerPinchStartScale = 1;
let _viewerTouchStartX = 0;
let _viewerTouchStartY = 0;
let _viewerTouchStartTime = 0;
let _viewerLastTapTime = 0;
let _viewerEventsInitialized = false;

function _getTouchDistance(t1, t2) {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

function _clampViewerPan() {
    if (_viewerScale <= 1) {
        _viewerPanX = 0;
        _viewerPanY = 0;
        return;
    }
    const container = document.getElementById('viewer-image-container');
    const img = document.getElementById('viewer-img');
    if (!container || !img) return;
    
    const scaledW = img.offsetWidth * _viewerScale;
    const scaledH = img.offsetHeight * _viewerScale;
    const maxPanX = Math.max(0, (scaledW - container.clientWidth) / 2 + 50);
    const maxPanY = Math.max(0, (scaledH - container.clientHeight) / 2 + 50);
    
    _viewerPanX = Math.max(-maxPanX, Math.min(maxPanX, _viewerPanX));
    _viewerPanY = Math.max(-maxPanY, Math.min(maxPanY, _viewerPanY));
}

function _applyViewerTransform(animate = false) {
    const img = document.getElementById('viewer-img');
    const container = document.getElementById('viewer-image-container');
    if (!img) return;
    
    img.style.transition = animate ? 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)' : 'none';
    img.style.transform = `translate(${_viewerPanX}px, ${_viewerPanY}px) scale(${_viewerScale})`;
    
    if (container) {
        if (_viewerScale > 1) {
            container.classList.add('grabbing');
        } else {
            container.classList.remove('grabbing');
        }
    }
}

function _resetViewerTransform(animate = false) {
    _viewerScale = 1;
    _viewerPanX = 0;
    _viewerPanY = 0;
    _applyViewerTransform(animate);
}

function _renderViewerContent() {
    const img = document.getElementById('viewer-img');
    const counter = document.getElementById('viewer-counter');
    const prevBtn = document.getElementById('viewer-prev-btn');
    const nextBtn = document.getElementById('viewer-next-btn');
    
    if (img && _viewerImages[_viewerIndex]) {
        img.src = _viewerImages[_viewerIndex];
    }
    
    const count = _viewerImages.length;
    if (count > 1) {
        if (prevBtn) prevBtn.style.display = 'flex';
        if (nextBtn) nextBtn.style.display = 'flex';
        if (counter) {
            counter.style.display = 'block';
            counter.innerText = `${_viewerIndex + 1} / ${count}`;
        }
    } else {
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';
        if (counter) counter.style.display = 'none';
    }
}

function openImageViewer(images, startIndex = 0) {
    if (!images) return;
    _viewerImages = Array.isArray(images) ? images : [images];
    if (_viewerImages.length === 0) return;
    
    _viewerIndex = Math.max(0, Math.min(startIndex, _viewerImages.length - 1));
    _viewerIsOpen = true;
    _viewerIsDragging = false;
    
    _resetViewerTransform(false);
    _renderViewerContent();
    
    const modal = document.getElementById('image-viewer-modal');
    if (modal) {
        modal.style.display = 'flex';
        void modal.offsetWidth; // Reflow az animációhoz
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    }
    
    _initViewerEvents();
    window.addEventListener('keydown', _onViewerKeyDown);
}

function closeImageViewer() {
    _viewerIsOpen = false;
    _viewerIsDragging = false;
    const modal = document.getElementById('image-viewer-modal');
    if (modal) {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        setTimeout(() => {
            if (!modal.classList.contains('open')) {
                modal.style.display = 'none';
                const img = document.getElementById('viewer-img');
                if (img) img.src = '';
            }
        }, 250);
    }
    window.removeEventListener('keydown', _onViewerKeyDown);
    _resetViewerTransform(false);
}

function navigateImageViewer(direction) {
    if (!_viewerImages || _viewerImages.length <= 1) return;
    _resetViewerTransform(false);
    
    _viewerIndex += direction;
    if (_viewerIndex < 0) {
        _viewerIndex = _viewerImages.length - 1;
    } else if (_viewerIndex >= _viewerImages.length) {
        _viewerIndex = 0;
    }
    
    _renderViewerContent();
}

function _onViewerWheel(e) {
    if (!_viewerIsOpen) return;
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.18 : 0.85;
    const newScale = Math.max(1, Math.min(5, _viewerScale * zoomFactor));
    
    if (newScale === 1) {
        _viewerScale = 1;
        _viewerPanX = 0;
        _viewerPanY = 0;
    } else {
        _viewerScale = newScale;
        _clampViewerPan();
    }
    _applyViewerTransform(true);
}

function _onViewerMouseDown(e) {
    if (!_viewerIsOpen || e.button !== 0) return;
    if (e.target.closest('.viewer-btn')) return;
    
    _viewerIsDragging = true;
    _viewerDragStartX = e.clientX;
    _viewerDragStartY = e.clientY;
    _viewerInitialPanX = _viewerPanX;
    _viewerInitialPanY = _viewerPanY;
}

function _onViewerMouseMove(e) {
    if (!_viewerIsOpen || !_viewerIsDragging) return;
    const dx = e.clientX - _viewerDragStartX;
    const dy = e.clientY - _viewerDragStartY;
    
    if (_viewerScale > 1) {
        _viewerPanX = _viewerInitialPanX + dx;
        _viewerPanY = _viewerInitialPanY + dy;
        _clampViewerPan();
        _applyViewerTransform(false);
    } else if (_viewerImages.length > 1) {
        _viewerPanX = dx;
        _applyViewerTransform(false);
    }
}

function _onViewerMouseUp(e) {
    if (!_viewerIsOpen || !_viewerIsDragging) return;
    _viewerIsDragging = false;
    
    const dx = e.clientX - _viewerDragStartX;
    const dy = e.clientY - _viewerDragStartY;
    const dist = Math.hypot(dx, dy);
    
    if (_viewerScale > 1) {
        _clampViewerPan();
        _applyViewerTransform(true);
        return;
    }
    
    // Normál méret
    _viewerScale = 1;
    if (_viewerImages.length > 1 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) {
            navigateImageViewer(1);
        } else {
            navigateImageViewer(-1);
        }
    } else if (dist < 6 && (e.target === document.getElementById('viewer-image-container') || e.target === document.getElementById('image-viewer-modal'))) {
        closeImageViewer();
    } else {
        _resetViewerTransform(true);
    }
}

function _onViewerTouchStart(e) {
    if (!_viewerIsOpen) return;
    if (e.target.closest('.viewer-btn')) return;
    
    if (e.touches.length === 2) {
        // Kétujjas pinch kezdete
        _viewerPinchStartDistance = _getTouchDistance(e.touches[0], e.touches[1]);
        _viewerPinchStartScale = _viewerScale;
        _viewerIsDragging = false;
    } else if (e.touches.length === 1) {
        // Egyujjas érintés (pan, swipe vagy koppintás)
        _viewerIsDragging = true;
        _viewerTouchStartX = e.touches[0].clientX;
        _viewerTouchStartY = e.touches[0].clientY;
        _viewerTouchStartTime = Date.now();
        _viewerInitialPanX = _viewerPanX;
        _viewerInitialPanY = _viewerPanY;
        
        // Dupla koppintás detektálása (zoom toggle 1x <-> 2.5x)
        const now = Date.now();
        if (now - _viewerLastTapTime < 320) {
            e.preventDefault();
            if (_viewerScale > 1.05) {
                _resetViewerTransform(true);
            } else {
                _viewerScale = 2.5;
                _clampViewerPan();
                _applyViewerTransform(true);
            }
            _viewerLastTapTime = 0;
            _viewerIsDragging = false;
            return;
        }
        _viewerLastTapTime = now;
    }
}

function _onViewerTouchMove(e) {
    if (!_viewerIsOpen) return;
    
    if (e.touches.length === 2 && _viewerPinchStartDistance > 0) {
        e.preventDefault();
        const currentDist = _getTouchDistance(e.touches[0], e.touches[1]);
        const ratio = currentDist / _viewerPinchStartDistance;
        _viewerScale = Math.max(0.8, Math.min(5, _viewerPinchStartScale * ratio));
        if (_viewerScale > 1) {
            _clampViewerPan();
        } else {
            _viewerPanX = 0;
            _viewerPanY = 0;
        }
        _applyViewerTransform(false);
    } else if (e.touches.length === 1 && _viewerIsDragging) {
        e.preventDefault();
        const dx = e.touches[0].clientX - _viewerTouchStartX;
        const dy = e.touches[0].clientY - _viewerTouchStartY;
        
        if (_viewerScale > 1.05) {
            _viewerPanX = _viewerInitialPanX + dx;
            _viewerPanY = _viewerInitialPanY + dy;
            _clampViewerPan();
            _applyViewerTransform(false);
        } else if (_viewerImages.length > 1) {
            // Normál méretben élőkép lapozási feedback (vízszintes elmozdulás)
            _viewerPanX = dx;
            _applyViewerTransform(false);
        }
    }
}

function _onViewerTouchEnd(e) {
    if (!_viewerIsOpen) return;
    
    if (e.touches.length === 0) {
        const touch = e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0] : null;
        const dx = touch ? touch.clientX - _viewerTouchStartX : 0;
        const dy = touch ? touch.clientY - _viewerTouchStartY : 0;
        const dt = Date.now() - _viewerTouchStartTime;
        
        if (_viewerScale > 1.05) {
            _clampViewerPan();
            _applyViewerTransform(true);
        } else {
            // Normál méret (scale <= 1.05)
            _viewerScale = 1;
            
            // Swipe észlelés, ha több kép van
            if (_viewerIsDragging && _viewerImages.length > 1 && 
                (Math.abs(dx) > 40 || (dt < 350 && Math.abs(dx) > 25)) && 
                Math.abs(dx) > Math.abs(dy)) {
                if (dx < 0) {
                    navigateImageViewer(1);
                } else {
                    navigateImageViewer(-1);
                }
            } else if (_viewerIsDragging && Math.hypot(dx, dy) < 8 && 
                       (e.target === document.getElementById('viewer-image-container') || 
                        e.target === document.getElementById('image-viewer-modal'))) {
                // Koppintás a háttérre -> bezárás
                closeImageViewer();
            } else {
                // Küszöbérték alatt visszatérés az alaphelyzetbe
                _resetViewerTransform(true);
            }
        }
        _viewerIsDragging = false;
        _viewerPinchStartDistance = 0;
    } else if (e.touches.length === 1) {
        _viewerTouchStartX = e.touches[0].clientX;
        _viewerTouchStartY = e.touches[0].clientY;
        _viewerInitialPanX = _viewerPanX;
        _viewerInitialPanY = _viewerPanY;
        _viewerIsDragging = true;
    }
}

function _onViewerDoubleClick(e) {
    if (!_viewerIsOpen) return;
    if (e.target.closest('.viewer-btn')) return;
    
    if (_viewerScale > 1.05) {
        _resetViewerTransform(true);
    } else {
        _viewerScale = 2.5;
        _clampViewerPan();
        _applyViewerTransform(true);
    }
}

function _onViewerKeyDown(e) {
    if (!_viewerIsOpen) return;
    
    if (e.key === 'Escape') {
        e.preventDefault();
        closeImageViewer();
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateImageViewer(-1);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateImageViewer(1);
    }
}

function _initViewerEvents() {
    if (_viewerEventsInitialized) return;
    _viewerEventsInitialized = true;
    
    const modal = document.getElementById('image-viewer-modal');
    const container = document.getElementById('viewer-image-container');
    if (container) {
        container.addEventListener('wheel', _onViewerWheel, { passive: false });
        container.addEventListener('mousedown', _onViewerMouseDown);
        container.addEventListener('dblclick', _onViewerDoubleClick);
    }
    
    if (modal) {
        modal.addEventListener('touchstart', _onViewerTouchStart, { passive: false });
    }
    
    window.addEventListener('mousemove', _onViewerMouseMove);
    window.addEventListener('mouseup', _onViewerMouseUp);
    window.addEventListener('touchmove', _onViewerTouchMove, { passive: false });
    window.addEventListener('touchend', _onViewerTouchEnd);
    window.addEventListener('touchcancel', _onViewerTouchEnd);
}

window.openImageViewer = openImageViewer;
window.closeImageViewer = closeImageViewer;
window.navigateImageViewer = navigateImageViewer;