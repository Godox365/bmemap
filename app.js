/**
 * Biztonsági ellenőrzés a külső adatbázis betöltésére.
 * Amennyiben a 'room_data.js' fájl nem töltődött be, vagy a ROOM_DATABASE
 * változó nem definiált, létrehoz egy üres objektumot a futásidejű hibák elkerülése végett.
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
 * FEJLESZTŐI (DEV) MÓD DETEKTÁLÁS ÉS BEÁLLÍTÁS
 * Aktiválás: ?dev=true vagy ?dev=1 (elmenti a böngészőbe),
 * Kikapcsolás: ?dev=false vagy ?dev=0.
 */
const IS_DEV_MODE = (() => {
    if (typeof window === 'undefined' || !window.location) return false;
    const params = new URLSearchParams(window.location.search);
    const devParam = params.get('dev');
    if (devParam === 'true' || devParam === '1') {
        try { localStorage.setItem('bmemap_dev_mode', 'true'); } catch(e){}
        return true;
    }
    if (devParam === 'false' || devParam === '0') {
        try { localStorage.removeItem('bmemap_dev_mode'); } catch(e){}
        return false;
    }
    try {
        return localStorage.getItem('bmemap_dev_mode') === 'true';
    } catch(e) { return false; }
})();

if (IS_DEV_MODE && typeof document !== 'undefined') {
    if (document.documentElement) document.documentElement.classList.add('dev-mode');
    if (document.body) document.body.classList.add('dev-mode');
    else window.addEventListener('DOMContentLoaded', () => document.body.classList.add('dev-mode'));
}

function toggleDevMode(enable) {
    try {
        if (enable) localStorage.setItem('bmemap_dev_mode', 'true');
        else localStorage.removeItem('bmemap_dev_mode');
    } catch(e){}
    window.location.reload();
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

    // 3. Biztonságos Fallback szabályok (kigyomlálva a veszélyes K épület 0->1 bugot)
    if (b === 'K') {
        if (l === '-1') chars.add('f'); // Földszint/Alagsor
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
    // A keresett kifejezés normalizálása (kisbetűsítés, speciális karakterek eltávolítása)
    const cleanTerm = normalizeRoomId(term); 
    
    // Ha a keresési kifejezés 2 karakternél rövidebb, nem végzünk keresést a teljesítmény érdekében
    if (cleanTerm.length < 2) return [];

    // Az aktuális épület azonosítójának kisbetűsített formája (pl. 'k', 'q')
    const bKey = currentBuildingKey.toLowerCase();

    return geoJsonData.features.filter(f => {
        const p = f.properties;
        const name = normalizeRoomId(p.name);
        const ref = normalizeRoomId(p.ref);
        const rawLvl = getLevelsFromFeature(f)[0] || "0";
        
        // 1. Direkt egyezés vizsgálata
        // Ha a normalizált név vagy a referenciaszám közvetlenül tartalmazza a keresett kifejezést
        if (name.includes(cleanTerm) || (ref && ref.includes(cleanTerm))) return true;

        // A célpont alapvető azonosítója (referencia vagy név prioritás szerint)
        const targetCore = ref || name;
        if (!targetCore) return false;

        // A szinthez tartozó azonosító karakterek lekérése
        const lvlChars = getLevelChars(currentBuildingKey, rawLvl);
        
        // 2. Aliasok (kombinációk) generálása és vizsgálata
        const aliases = new Set();
        lvlChars.forEach(lvl => {
            // Szint + alap azonosító (pl. 'p107')
            aliases.add(lvl + targetCore);          
            // Épület azonosító + Szint + alap azonosító (pl. 'qp107')
            aliases.add(bKey + lvl + targetCore);   
            // Épület azonosító + alap azonosító (pl. 'ib028' - I épület specifikus esetekre)
            aliases.add(bKey + targetCore);         
        });

        for (const alias of aliases) {
            // Pontos egyezés a generált aliassal
            if (alias === cleanTerm) return true;
            
            // Fordított részleges egyezés (Reverse Fuzzy): 
            // Ha a felhasználó által beírt szöveg tartalmazza a generált aliast (pl. "keresem a ib028-at")
            if (cleanTerm.includes(alias)) return true;
        }

        // 3. Brute Force összetétel vizsgálata (Végső fallback)
        // Ha a keresett kifejezés az épület betűjével kezdődik, és tartalmazza a célpont magját
        if (cleanTerm.startsWith(bKey) && cleanTerm.includes(targetCore)) {
            return true; 
        }

        // 4. Szint alapú, nem numerikus karaktereket tartalmazó keresés (Régi logika megtartása)
        // Ellenőrzi, hogy a keresési kifejezés tartalmazza-e a szint betűjelét és a szoba azonosítóját
        for (const lvlChar of lvlChars) {
            if (isNaN(parseInt(lvlChar))) { 
                if (cleanTerm.includes(lvlChar) && cleanTerm.includes(targetCore)) return true; 
            }
        }

        // Ha semmilyen egyezés nem található, az elem kiszűrésre kerül
        return false;
    });
}

/**
 * Segédfüggvény a szobaazonosítók és keresési kifejezések normalizálására.
 * Eltávolítja a szóközöket, a pontokat és a kötőjeleket, majd a szöveget kisbetűssé alakítja.
 * Ez biztosítja a robusztus és formázástól független keresést.
 * * @param {string} str - A formázandó, eredeti szöveg.
 * @returns {string} A normalizált, megtisztított szöveg.
 */
function normalizeRoomId(str) {
    if(!str) return "";
    return str.replace(/[\s.\-]/g, '').toLowerCase();
}

// === ÉPÜLET KONFIGURÁCIÓ ===
const BUILDINGS = {
    "K": { name: "K Épület", center: [47.4816562, 19.0559196], zoom: 19, regex: /^K/i },
    "I": { name: "I Épület", center: [47.472616, 19.059552], zoom: 20, regex: /^I/i },
    "Q": { name: "Q Épület", center: [47.473410, 19.059555], zoom: 20, regex: /^Q/i },
    "E": { name: "E Épület", center: [47.477857, 19.057739], zoom: 20, regex: /^E/i },
    "R": { name: "R Épület", center: [47.4789527, 19.0591848], zoom: 19, regex: /^R/i },
    "KT": { name: "Könyvtár", center: [47.480874, 19.054276], zoom: 20, regex: /^KT/i }
};

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
    '--color-room':        { dark: '#00897b', light: '#00897b', label: 'Szoba Kitöltés' },
    '--color-room-stroke': { dark: '#26a69a', light: '#004d40', label: 'Szoba Körvonal' },
    '--color-room-text':   { dark: '#ffffff', light: '#000000', label: 'Szoba Felirat' },
    
    '--color-corridor':    { dark: '#444444', light: '#cccccc', label: 'Folyosó Fal' },
    '--color-corridor-fill':{ dark: 'rgba(34, 34, 34, 0.5)', light: 'rgba(200, 200, 200, 0.3)', label: 'Folyosó Kitöltés' },
    
    '--color-outline':     { dark: '#ffffff', light: '#555555', label: 'Épület Körvonal' },
    '--color-floor-fill':  { dark: '#222222', light: '#f5f5f5', label: 'Épület/Padló Kitöltés' }, // ÚJ
    
    '--color-door':        { dark: '#ffffff', light: '#333333', label: 'Ajtók' },
    '--color-highlight':   { dark: '#ffeb3b', light: '#ffab00', label: 'Kijelölés (Highlight)' },

    // --- NAVIGÁCIÓ & POI ---
    '--color-route-primary':   { dark: '#ff1744', light: '#ff1744', label: 'Útvonal (Séta)' },
    '--color-route-secondary': { dark: '#ffeb3b', light: '#f9a825', label: 'Útvonal (Lépcső/Más)' },
    '--color-arrow':           { dark: '#8b0000', light: '#8b0000', label: 'Irányjelző Nyíl' },
    
    '--color-stairs':          { dark: '#2e7d32', light: '#33691e', label: 'Lépcső Kitöltés' },
    '--color-stairs-stroke':   { dark: '#2e7d32', light: '#1b5e20', label: 'Lépcső Körvonal' }, // ÚJ
    
    '--color-elevator':        { dark: '#7e57c2', light: '#7e57c2', label: 'Lift Kitöltés' }, // ÚJ (külön)
    '--color-elevator-stroke': { dark: '#7e57c2', light: '#512da8', label: 'Lift Körvonal' }, // ÚJ
    
    '--color-toilet-fill':     { dark: '#0d47a1', light: '#0d47a1', label: 'WC Kitöltés' },
    '--color-toilet-stroke':   { dark: '#42a5f5', light: '#42a5f5', label: 'WC Körvonal' },
    
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
                '--color-room': 'rgba(61.012373144687864, 198.1596376544658, 184.1445887264592, 1)',
                '--color-room-stroke': 'rgba(0, 105, 91.99999999999994, 1)',
                '--color-room-text': 'rgba(0, 105, 91.99999999999994, 1)',
                '--color-corridor': '#cccccc',
                '--color-corridor-fill': 'rgba(0, 0, 0, 0.08)',
                '--color-outline': '#555555',
                '--color-floor-fill': '#f5f5f5',
                '--color-door': '#333333',
                '--color-highlight': '#ffab00',
                '--color-route-primary': '#ff1744',
                '--color-route-secondary': '#f9a825',
                '--color-arrow': '#8b0000',
                '--color-stairs': 'rgba(85.99610983164409, 146.51411791072172, 62.46132891200283, 1)',
                '--color-stairs-stroke': '#1b5e20',
                '--color-elevator': '#7e57c2',
                '--color-elevator-stroke': '#512da8',
                '--color-toilet-fill': 'rgba(144.84324607157689, 185.97696807796, 249.80515739820993, 1)',
                '--color-toilet-stroke': '#42a5f5',
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
    themeMode: localStorage.getItem('pref_theme') || 'dark', 
    activeColorTheme: localStorage.getItem('pref_color_theme') || 'default',
    language: localStorage.getItem('pref_language') || (typeof i18n !== 'undefined' ? i18n.currentLanguage : 'hu'),
    cacheEnabled: localStorage.getItem('pref_cache_enabled') !== 'false'
};

// MAP STYLES (OpenFreeMap vector styles - no API key, unlimited)
const MAP_STYLES = {
    dark: 'https://tiles.openfreemap.org/styles/dark',
    light: 'https://tiles.openfreemap.org/styles/positron'
};
const TILE_LAYERS = MAP_STYLES; // Visszafelé kompatibilitási hivatkozás

// === SZÓTÁR (Hogy ne angolul írja ki) ===
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

// === CACHE SYSTEM (F-015) ===
const CACHE_PREFIX = "bmemap_data_";

/**
 * Be- vagy kikapcsolja az alkalmazás gyorsítótárazási (cache) funkcióját.
 * Frissíti a futásidejű beállításokat és elmenti a preferenciát a helyi tárolóba (localStorage),
 * majd vizuális visszajelzést ad a felhasználónak a művelet eredményéről.
 * * @param {boolean} isEnabled - A gyorsítótárazás kívánt állapota (true = bekapcsolva, false = kikapcsolva).
 */
function toggleCacheMode(isEnabled) {
    // Állapot frissítése a memóriában és a perzisztens tárolóban
    APP_SETTINGS.cacheEnabled = isEnabled;
    localStorage.setItem('pref_cache_enabled', isEnabled);
    
    if (!isEnabled) {
        // Kikapcsolt állapot: A meglévő adatokat nem töröljük automatikusan a felhasználó 
        // esetleges adatvesztésének elkerülése végett, csupán a jövőbeni mentéseket tiltjuk le.
        // A manuális törlésre külön gomb szolgál a felületen.
        showToast(typeof t === 'function' ? t('toasts.cache_disabled') : "Cache kikapcsolva. Nem mentünk új adatot.");
    } else {
        // Bekapcsolt állapot: Visszajelzés a sikeres aktiválásról
        showToast(typeof t === 'function' ? t('toasts.cache_enabled') : "Cache bekapcsolva. 💾");
    }
}

/**
 * Kiszámítja és visszaadja a helyi tárolóban (localStorage) felhalmozott,
 * az alkalmazáshoz tartozó gyorsítótár (cache) becsült méretét.
 * * @returns {number} A cachelemek összesített mérete bájtokban.
 */
function getCacheSize() {
    let totalBytes = 0;
    
    // Végigiterálunk a localStorage összes kulcsán
    for (let key in localStorage) {
        // Csak azokat a kulcsokat vizsgáljuk, amelyek a mi cache előtagunkkal kezdődnek
        if (key.startsWith(CACHE_PREFIX)) {
            const item = localStorage.getItem(key);
            if (item) {
                // A JavaScript UTF-16 kódolást használ, így karakterenként hozzávetőlegesen 2 bájttal számolunk
                totalBytes += item.length * 2; 
            }
        }
    }
    return totalBytes;
}

/**
 * Egy nyers, bájtokban megadott számértéket alakít át ember számára
 * könnyen olvasható, megfelelő mértékegységgel ellátott formátumra (B, KB, MB).
 * * @param {number} bytes - A formázandó adatmennyiség bájtokban.
 * @returns {string} A kerekített és mértékegységgel ellátott méret (pl. "1.25 MB").
 */
function formatBytes(bytes) {
    // Alapeset kezelése: ha a méret 0, azonnal visszatérünk
    if (bytes === 0) return '0 B';
    
    // A váltószám (1024) és az elérhető mértékegységek definiálása
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    
    // A megfelelő mértékegység indexének kiszámítása logaritmus segítségével
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    // Az érték elosztása a megfelelő hatvánnyal, majd formázás legfeljebb 2 tizedesjegyre
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Frissíti a gyorsítótár (cache) méretét megjelenítő felhasználói felületi (UI) elemet.
 * Lekéri a jelenlegi méretet, formázza azt ember számára olvasható formátumba,
 * majd beállítja a megfelelő HTML elem belső szövegét.
 */
function updateCacheSizeDisplay() {
    const el = document.getElementById('cache-size-display');
    if (el) {
        const size = getCacheSize();
        el.innerText = `A gyorsítótár jelenlegi mérete: ${formatBytes(size)}`;
    }
}

/**
 * Törli az összes alkalmazáshoz tartozó gyorsítótár (cache) bejegyzést a helyi tárolóból (localStorage).
 * A művelet végrehajtása előtt megerősítést kér a felhasználótól.
 * Sikeres törlés esetén frissíti a méretet megjelenítő UI elemet és értesítést (toast) jelenít meg.
 */
function clearAllCache() {
    if(!confirm(typeof t === 'function' ? (t('alerts.confirm_clear_cache') || "Biztosan törlöd a mentett térképeket?") : "Biztosan törlöd a mentett térképeket?")) return;
    
    const keysToRemove = [];
    for (let key in localStorage) {
        if (key.startsWith(CACHE_PREFIX)) {
            keysToRemove.push(key);
        }
    }
    
    keysToRemove.forEach(k => localStorage.removeItem(k));
    updateCacheSizeDisplay();
    showToast(typeof t === 'function' ? t('toasts.cache_cleared') : "Sikeres nagytakarítás! 🧹");
}

/**
 * Elmenti az adott épülethez tartozó térképadatokat a helyi gyorsítótárba (localStorage),
 * ellátva azt egy időbélyeggel (timestamp) az érvényességi idő későbbi ellenőrzéséhez.
 * Ha a globális beállításokban a gyorsítótárazás le van tiltva, a függvény nem végez mentést.
 * Tárhelyhiány (QuotaExceededError) vagy egyéb mentési hiba esetén megkísérli 
 * a régi bejegyzések törlését, majd újra megpróbálja a mentést.
 * * @param {string} buildingKey - Az épület azonosítója (pl. 'K', 'Q'), amely a gyorsítótár kulcsának részét képezi.
 * @param {Object} data - A menteni kívánt adat (jellemzően az épület GeoJSON objektuma).
 */
function saveToCache(buildingKey, data) {
    // HA KI VAN KAPCSOLVA, AKKOR NE MENTSÜNK SEMMIT!
    if (!APP_SETTINGS.cacheEnabled) return;

    try {
        const cacheItem = {
            timestamp: Date.now(),
            data: data
        };
        localStorage.setItem(CACHE_PREFIX + buildingKey, JSON.stringify(cacheItem));
        updateCacheSizeDisplay(); // UI frissítése mentés után
    } catch (e) {
        console.warn("Cache full or error. Clearing old entries...", e);
        cleanupCache();
        try {
            localStorage.setItem(CACHE_PREFIX + buildingKey, JSON.stringify({ timestamp: Date.now(), data: data }));
        } catch (retryErr) {
            console.error("Cache write failed completely.");
        }
    }
}

/**
 * Betölti az adott épülethez tartozó térképadatokat a helyi gyorsítótárból (localStorage).
 * Ellenőrzi, hogy a gyorsítótárazás globálisan engedélyezve van-e, illetve
 * megvizsgálja a tárolt adatok érvényességi idejét (lejáratát).
 * * @param {string} buildingKey - Az épület azonosítója (pl. 'K', 'Q'), amelyhez az adatokat keressük.
 * @returns {Object|null} A gyorsítótárazott adat objektum (jellemzően GeoJSON), vagy null, 
 * ha az adat nem található, lejárt, vagy a funkció ki van kapcsolva.
 */
function loadFromCache(buildingKey) {
    if (!APP_SETTINGS.cacheEnabled) {
        return null;
    }

    const raw = localStorage.getItem(CACHE_PREFIX + buildingKey);
    if (!raw) return null;

    try {
        const item = JSON.parse(raw);
        
        // KIVETTÜK A LEJÁRATI IDŐ (EXPIRE) ELLENŐRZÉST!
        // Ha a felhasználó offline van (PWA), a régi adat ezerszer jobb, mint az üres képernyő.
        // A frissítést amúgy is elintézi a háttérben a loadOsmData, ha van net.
        
        return item.data;
    } catch (e) {
        return null;
    }
}

/**
 * Felszabadítja a helyi tároló (localStorage) kapacitását a legrégebbi 
 * gyorsítótár-bejegyzések automatikus törlésével. Jellemzően tárhelyhiány 
 * (QuotaExceededError) esetén hívódik meg. A meglévő elemek felét távolítja el, 
 * az időbélyeg (timestamp) alapján a legrégebbiekkel kezdve.
 */
function cleanupCache() {
    // Ideiglenes tömb a gyorsítótárazott elemek metaadatainak tárolására
    const items = [];
    
    // Iterálás a localStorage összes kulcsán
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        
        // Csak azokat a kulcsokat dolgozzuk fel, amelyek az alkalmazáshoz tartoznak
        if (key.startsWith(CACHE_PREFIX)) {
            try {
                // Az időbélyeg kinyerése a kulcshoz tartozó adatból
                const item = JSON.parse(localStorage.getItem(key));
                items.push({ key: key, ts: item.timestamp });
            } catch(e) {
                // Csendes hibakezelés sérült elemek esetén
            }
        }
    }
    
    // Az elemek időrendi sorba rendezése növekvő sorrendben (legrégebbi elem az első)
    items.sort((a, b) => a.ts - b.ts);
    
    // A legrégebbi bejegyzések törlése (az összes elem pontosan felét távolítja el)
    items.slice(0, Math.ceil(items.length / 2)).forEach(item => {
        localStorage.removeItem(item.key);
    });
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
    // Biztonsági ellenőrzés: ha nincs aktívan kiválasztott elem, megszakítjuk a folyamatot.
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
    
    // Biztonsági ellenőrzés: ha nincs aktívan kiválasztott elem, megszakítjuk a folyamatot.
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
                    zoomToFeature(target);
                    openSheet(target);
                    resultsDiv.style.display = 'none';
                    document.getElementById('search-input').value = fav.name;
                    updateRightButtonState();
                } else {
                    alert(typeof t === 'function' ? t('alerts.place_not_found') : "Ez a hely ebben az épületben nem található (vagy még nem töltött be).");
                }
            };
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

/** Az aktív útvonaltervezés alapadatait tartalmazó objektum (kezdő és cél térképelemek). */
let activeRouteData = null; // { start: feature/null, end: feature }
/** A kiszámolt útvonalat alkotó pontok (gráf csomópontok) nyers kulcsainak tömbje. */
let currentRoutePath = []; 

/** Az aktuális navigáció tényleges, megerősített kiindulópontja (feature objektum). */
let activeNavSource = null;
/** Az aktuális navigáció tényleges, megerősített célpontja (feature objektum). */
let activeNavTarget = null;



// --- ÚJ POI RENDSZER GLOBÁLISAI ---
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
        
        // 2. Intelligens kameramozgatás: a térkép az elem koordinátáira navigál
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
const OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",  // Legstabilabb
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
];

/**
 * A MapLibre GL JS térképpéldány inicializálása és konfigurálása.
 * @type {maplibregl.Map}
 */
const map = new maplibregl.Map({
    container: 'map',
    style: MAP_STYLES[APP_SETTINGS.themeMode] || MAP_STYLES.dark,
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
    // Ha ez egy programozott snap befejezése, ne indítsunk újat (rekurzió elkerülése)
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
map.on('zoom', function() {
    updateDynamicVisibility();
});

map.on('zoomend', function() {
    updateDynamicVisibility();      
});

/**
 * Dinamikusan frissíti a térkép DOM elemeinek CSS változóit a jelenlegi 
 * nagyítási szint (zoom) alapján. Sima, képkockasebességű (60fps) átmenetet biztosít.
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
let _currentMapStyleMode = APP_SETTINGS.themeMode || 'dark';

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

    // 10. MAP HOVER & CLICK LISTENERS
    const FEATURE_LAYERS = ['room-fill', 'corridor-fill', 'toilet-fill', 'stairs-fill', 'elevator-fill', 'door-circle'];

    FEATURE_LAYERS.forEach(layerId => {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });

        map.on('click', layerId, (e) => {
            if (window.isMapInteractionLocked) return;
            if (!e.features || e.features.length === 0) return;

            const targetFeature = e.features[0];
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

            window.clickTimeout = setTimeout(() => {
                openSheet(featToOpen);
                window.clickTimeout = null;
            }, 200);
        });
    });

    map.on('click', 'floor-fill', (e) => {
        if (window.isMapInteractionLocked) return;
        const features = map.queryRenderedFeatures(e.point, { layers: FEATURE_LAYERS });
        if (!features || features.length === 0) {
            closeSheet();
        }
    });

    map.on('click', (e) => {
        if (window.isMapInteractionLocked) return;
        const features = map.queryRenderedFeatures(e.point, { layers: FEATURE_LAYERS.concat(['floor-fill']) });
        if (!features || features.length === 0) {
            if (activeRouteData) return; // Ne zárjuk be a sheet-et, ha aktív navigáció fut!
            closeSheet();
        }
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
        if (APP_SETTINGS.themeMode === 'dark') {
            map.setLayoutProperty('highway_path', 'visibility', 'none');
        } else {
            map.setLayoutProperty('highway_path', 'visibility', 'visible');
        }
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

let currentLevel = "0";
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
    const mode = APP_SETTINGS.themeMode; // 'dark' vagy 'light'
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
        document.body.classList.add('light-mode');
    } else {
        document.body.classList.remove('light-mode');
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

    // --- F-016: Gyorsítótár (Cache) UI frissítése ---
    // A cache engedélyezését szabályozó kapcsoló és a méretkijelző aktualizálása
    const cacheSwitch = document.getElementById('cache-switch');
    if (cacheSwitch) {
        cacheSwitch.checked = APP_SETTINGS.cacheEnabled;
        updateCacheSizeDisplay(); // A lefoglalt tárhely méretének újraszámítása és kiírása
    }
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

/**
 * Dinamikusan kiszámítja egy színtéma 3 reprezentatív színmintáját (dot) 
 * az aktuális témamód (dark/light) és az egyedi felülírások alapján.
 * @param {string} themeKey - A téma azonosítója.
 * @returns {Array<string>} 3 CSS színkód tömbje.
 */
function getThemeSampleColors(themeKey) {
    const mode = APP_SETTINGS.themeMode || 'dark';
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
    
    // Biztonsági ellenőrzés: ha a modális ablak rejtett állapotban volt, megjelenítjük
    if (!modal.classList.contains('visible')) {
        modal.classList.add('visible');
    }

    const mode = APP_SETTINGS.themeMode;
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

    // 2. A színválasztó (Pickr) komponensek aszinkron példányosítása
    // Kis késleltetés (setTimeout) alkalmazása szükséges, hogy a DOM frissülhessen a generált HTML-lel
    setTimeout(() => {
        activePickrs = []; // A tároló ürítése az új példányosítás előtt
        
        for (const [varName, data] of Object.entries(THEME_VARS)) {
            // Az aktuálisan érvényben lévő CSS változó értékének lekérése a dokumentum gyökeréről
            const currentValue = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            const containerId = `#picker-${varName.replace('--', '')}`;
            
            // Pickr komponens inicializálása az adott konténerre
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

            // Eseménykezelő: Színváltozás esetén (Live Preview funkció)
            pickr.on('change', (color, source, instance) => {
                const rgbaColor = color.toRGBA().toString();
                document.documentElement.style.setProperty(varName, rgbaColor);
                pickr.applyColor(true); 
                _applyThemeToMapLayers();
                if (varName === '--color-highlight' && selectedFeature) {
                    drawSelectedHighlight(selectedFeature);
                }
            });
            
            // Eseménykezelő: A színválasztó megnyitásakor fókuszálás a kapcsolódó térképi elemre
            pickr.on('show', () => focusOnElement(varName));
            
            // A sikeresen inicializált példány hozzáadása az aktív Pickr-ek listájához
            activePickrs.push(pickr);
        }
    }, 50);
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
    const mode = APP_SETTINGS.themeMode;
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
    const mode = APP_SETTINGS.themeMode; // 'dark' vagy 'light'
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

    // 3. A generált kód vágólapra másolása és hibakezelése fallback megoldással
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
    
    const mode = APP_SETTINGS.themeMode;
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
 * Intelligens fókusz és zoom funkció a témaszerkesztőhöz.
 * A kiválasztott stílusváltozó (CSS változó) neve alapján megkeresi a térképen 
 * a hozzá leginkább illő térképelemet (például egy mosdót, ha a mosdó színét szerkesztjük),
 * majd a kamerát arra a pontra irányítja az élő előnézet (live preview) biztosítása érdekében.
 * * @param {string} varName - A módosított téma-változó neve (pl. '--color-toilet' vagy '--color-room').
 */
function focusOnElement(varName) {
    // Biztonsági ellenőrzés: ha nincsenek betöltve térképadatok, megszakítjuk a futást
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
        // 3. Intelligens kameramozgatás: a térképet úgy pozicionálja, 
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
 */
function changeBuilding(key, autoSearchTerm = null) {
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
    
    if (autoSearchTerm) pendingSearchTerm = autoSearchTerm;

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
            
            // Biztonsági korlát: Csak akkor fogadjuk el, ha valid számok, és a távolságuk nem irreális (max 30 emelet).
            // Ezzel elkerülhető a hibás adatokból (pl. dátumok beírása) származó végtelen ciklus vagy hibás generálás.
            if (!isNaN(min) && !isNaN(max) && Math.abs(max - min) < 30) {
                // Iteráció a minimum és maximum érték között, beleértve a határokat is
                for (let i = Math.min(min, max); i <= Math.max(min, max); i++) {
                    levels.add(i.toString());
                }
            }
        } else {
            // 2. EGYSZERŰ ÉRTÉK DETEKTÁLÁS (Szigorúan csak egész számok)
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
 * Aszinkron függvény az OpenStreetMap Overpass API lekérdezésére.
 * Tartalmaz egy beépített hibatűrő mechanizmust (fallback): amennyiben az aktuális szerver
 * nem válaszol vagy időtúllépés (timeout) történik, automatikusan megpróbálja
 * a listában szereplő következő szervert.
 * @param {string} query - Az Overpass QL nyelven írt lekérdezés törzse.
 * @param {number} [serverIndex=0] - Az aktuálisan próbált szerver indexe az OVERPASS_SERVERS tömbben.
 * @returns {Promise<Object>} A lekérdezés eredménye JSON objektumként.
 * @throws {Error} Hibát dob, ha az összes elérhető szerver lekérdezése sikertelen.
 */
async function fetchOverpass(query, serverIndex = 0) {
    // Ellenőrizzük, hogy elfogytak-e a próbálkozásra szánt szerverek
    if (serverIndex >= OVERPASS_SERVERS.length) throw new Error("Minden szerver halott.");
    
    const server = OVERPASS_SERVERS[serverIndex];
    
    // Felhasználói felület frissítése az aktuális kapcsolat állapotáról
    document.getElementById('loader-status').innerText = `Connecting to ${new URL(server).hostname}...`;
    
    try {
        // Megszakításvezérlő inicializálása az időtúllépés (timeout) kezeléséhez
        const controller = new AbortController();
        
        // 10 másodperces időtúllépés beállítása a lekérdezésre
        const timeoutId = setTimeout(() => controller.abort(), 10000); 
        
        // Hálózati kérés küldése a kiválasztott szerver felé
        const response = await fetch(server, { method: "POST", body: query, signal: controller.signal });
        
        // Ha a kérés befejeződött, töröljük az időtúllépés időzítőjét
        clearTimeout(timeoutId);
        
        // Ha a válasz nem sikeres (pl. 404 vagy 500-as hiba), kivételt dobunk
        if (!response.ok) throw new Error(`Status ${response.status}`);
        
        // Sikeres válasz esetén a JSON adat visszaadása
        return await response.json();
    } catch (e) {
        // Hiba esetén (pl. hálózati hiba vagy timeout) naplózzuk a figyelmeztetést,
        // és rekurzívan megpróbáljuk a lekérdezést a következő szerverrel
        console.warn(`Server ${server} failed. Trying next...`);
        return fetchOverpass(query, serverIndex + 1);
    }
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
                map.fitBounds(
                    [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
                    {
                        padding: { top: 50, bottom: 50, left: 50, right: 50 },
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
    
    // 1. SZINT (Legalul): Szerkezeti alapelemek (Padló, Fal, Épület körvonal)
    if (p.indoor === 'level' || p['building:part'] || p.indoor === 'wall' || p.building) return 1;
    
    // 2. SZINT: Folyosók. Biztosítja, hogy az ezekből nyíló szobák vizuálisan kiemelkedjenek.
    if (p.indoor === 'corridor' || p.highway === 'corridor') return 2;
    
    // 4. SZINT (Legfelül): Ajtók és bejáratok. Garantálja, hogy ezek az apróbb elemek
    // mindig jól láthatóak és interakcióba léphetők maradjanak.
    if (p.entrance || p.door) return 4;

    // 3. SZINT (Alapértelmezett): Szobák, mosdók, lépcsők, liftek és egyéb névvel rendelkező helyiségek.
    return 3; 
}

/**
 * Feldolgozza a betöltött OpenStreetMap (OSM) adatokat és inicializálja a térképi modellt.
 * Intelligens adatkonverziót végez: ha az adat már kész GeoJSON formátumú, közvetlenül felhasználja,
 * ha nyers OSM formátumú, elvégzi a szükséges konverziót. Emellett sorba rendezi a rétegeket,
 * felépíti a logikai gráfot, megőrzi az aktuális szinti nézetet, majd frissíti a felhasználói felületet.
 * @param {Object} osmData - A letöltött térképadat (nyers OSM JSON vagy GeoJSON FeatureCollection).
 * @param {boolean} [isUpdate=false] - Jelzi, hogy a folyamat egy meglévő térkép frissítése-e 
 * (ha igaz, elkerüli a kamera zavaró, automatikus középre igazítását).
 */
function processOsmData(osmData, isUpdate = false) {
    // 1. Aktuális állapot (szint/emelet) mentése a vizuális ugrálások elkerülése végett (B-010 Fix)
    const savedLevel = currentLevel;


    // Intelligens adatkonverzió vizsgálata
    if (osmData && osmData.type === 'FeatureCollection') {
        // Statikus, előkészített GeoJSON fájl (pl. GitHub Actions által generálva) feldolgozása
        geoJsonData = osmData;
    } else {
        // Nyers OSM adatok konvertálása GeoJSON formátumba (Fallback API esetén)
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
    if (availableLevels.includes(savedLevel)) {
        currentLevel = savedLevel;
    } else {
        // Ha a mentett szint nem elérhető az új adatokban, 
        // alapértelmezetten a földszintet ('0') vagy a legelső elérhető szintet választjuk
        if (!availableLevels.includes(currentLevel)) {
            currentLevel = availableLevels.includes('0') ? '0' : (availableLevels[0] || "0");
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
 * Háromszintű betöltési logikát alkalmaz a maximális teljesítmény és megbízhatóság érdekében:
 * 1. Gyorsítótár (Cache): Azonnali megjelenítés a helyi tárolóból, ha rendelkezésre áll.
 * 2. Statikus adatfájl: Elsődleges hálózati forrás (előre generált, optimalizált JSON fájl).
 * 3. Élő Overpass API (Fallback): Tartalék megoldás a statikus fájl elérhetetlensége esetén.
 */
async function loadOsmData() {
    const loader = document.getElementById('loader');
    const buildingKey = currentBuildingKey;
    
    // 1. GYORSÍTÓTÁR (CACHE) KEZELÉSE
    // Megkíséreljük betölteni az adatokat a helyi tárolóból a várakozás nélküli megjelenítéshez.
    const cachedData = loadFromCache(buildingKey);
    
    // Jelzőváltozó, amely mutatja, hogy történt-e sikeres betöltés a gyorsítótárból
    let loadedFromCache = false;

    if (cachedData) {
        try {
            
            // Adatok feldolgozása és térkép renderelése a gyorsítótárazott adatok alapján
            processOsmData(cachedData, false);
            loader.style.display = 'none';
            loadedFromCache = true;
            
            // Függőben lévő keresés végrehajtása kis késleltetéssel (pl. automatikus épületváltás után)
            if (pendingSearchTerm) {
                setTimeout(() => {
                        if(pendingSearchTerm) {
                            document.getElementById('search-input').value = pendingSearchTerm;
                            handleSearch({ target: { value: pendingSearchTerm }, key: 'Enter' });
                            pendingSearchTerm = null;
                        }
                }, 100);
            }
            
            // URL paraméterek (pl. Deep Link megosztás) feldolgozása a betöltés befejezésekor
            processUrlParams();
        } catch (e) {
            // Hibakezelés: Sérült vagy feldolgozhatatlan gyorsítótár-bejegyzés törlése
            console.error("Cache render failed:", e);
            localStorage.removeItem(CACHE_PREFIX + buildingKey);
        }
    } else {
        // Ha nincs gyorsítótárazott adat, megjelenítjük a betöltést jelző felületet
        loader.style.display = 'block';
        document.getElementById('loader-status').innerText = "Betöltés...";
    }

    // 2. ELSŐDLEGES ADATFORRÁS: STATIKUS FÁJL LETÖLTÉSE
    // Megpróbáljuk letölteni a szerveren tárolt, előkészített adatfájlt.
    try {
        if (!loadedFromCache) document.getElementById('loader-status').innerText = "Térkép lekérése a szerverről...";
        
        // Fájl lekérése a 'data' könyvtárból az épület azonosítója alapján
        const res = await fetch(`./data/${buildingKey.toLowerCase()}_epulet.json`);
        if (!res.ok) throw new Error("Statikus fájl nem található (HTTP " + res.status + ")");
        
        const newData = await res.json();
        
        // Ellenőrizzük, hogy a hálózatról érkezett adat eltér-e a gyorsítótárazott állapottól
        const isDataNew = !cachedData || JSON.stringify(cachedData) !== JSON.stringify(newData);

        if (isDataNew) {
            // Új adatok esetén frissítjük a térképet és felülírjuk a gyorsítótárat
            processOsmData(newData, loadedFromCache);
            saveToCache(buildingKey, newData);
        } else {
        }

        // Ha eddig a pontig csak a betöltőképernyő volt látható, most elrejtjük és futtatjuk a kiegészítő funkciókat
        if (!loadedFromCache) {
            loader.style.display = 'none';
            if (pendingSearchTerm) {
                document.getElementById('search-input').value = pendingSearchTerm;
                handleSearch({ target: { value: pendingSearchTerm }, key: 'Enter' });
                pendingSearchTerm = null;
            }
            processUrlParams();
        }
        
        // Sikeres adatbetöltés esetén kilépünk, nincs szükség a tartalék (fallback) megoldásra
        return; 

    } catch (localError) {
        // Hibakezelés: Ha a statikus fájl letöltése sikertelen, továbblépünk a 3. lépésre
        console.warn("⚠️ Hiba a statikus fájl betöltésekor, indul a FALLBACK az Overpass API-ra!", localError);
        if (!loadedFromCache) document.getElementById('loader-status').innerText = "Fallback API csatlakozás...";
    }

    // 3. TARTALÉK MEGOLDÁS (FALLBACK): ÉLŐ OVERPASS API LEKÉRDEZÉS
    // Ha a statikus fájl nem elérhető, a szükséges adatokat közvetlenül az OpenStreetMap szervereiről kérjük le.
    const radius = 250;
    const center = currentBuilding.center;
    
    // Az Overpass QL lekérdezés összeállítása a releváns épületi adatok (szobák, folyosók, lépcsők) kinyeréséhez
    const query = `
        [out:json][timeout:25];
        (
            way(around:20, ${center[0]}, ${center[1]})["building"];
            relation(around:20, ${center[0]}, ${center[1]})["building"];
        )->.targetBuilding;
        .targetBuilding map_to_area -> .searchArea;
        (
            way["indoor"](area.searchArea);
            relation["indoor"](area.searchArea);
            way["highway"="corridor"](area.searchArea);
            way["highway"="steps"](area.searchArea);
            node["entrance"](area.searchArea);
            node["door"](area.searchArea);
            way["building:part"](area.searchArea);
            way["room"~"stairs|toilet|toilets"](area.searchArea);
            way(around:20, ${center[0]}, ${center[1]})["building"];
        );
        out body;
        >;
        out skel qt;
    `;

    try {
        // A lekérdezés végrehajtása a hálózaton keresztül
        const osmData = await fetchOverpass(query);
        
        // Az élő adat összehasonlítása az esetlegesen gyorsítótárazott állapottal
        const isDataNew = !cachedData || JSON.stringify(cachedData) !== JSON.stringify(osmData);

        if (isDataNew) {
            processOsmData(osmData, loadedFromCache);
            saveToCache(buildingKey, osmData);
        }

        // A felület frissítése az élő adatok sikeres betöltése után
        if (!loadedFromCache) {
            loader.style.display = 'none';
            if (pendingSearchTerm) {
                document.getElementById('search-input').value = pendingSearchTerm;
                handleSearch({ target: { value: pendingSearchTerm }, key: 'Enter' });
                pendingSearchTerm = null;
            }
            processUrlParams();
        }

    } catch (e) {
        // Végső hibakezelés: Ha sem a statikus, sem a fallback adatforrás nem működik
        console.error("Végzetes hiba, a fallback szerverek is elszálltak:", e);
        
        if (!loadedFromCache) {
            // Teljes adatkimaradás esetén vizuális hibaüzenet a felhasználónak
            document.getElementById('loader-status').innerText = "FAILED.";
            alert(typeof t === 'function' ? t('alerts.download_error') : "Hiba a letöltéskor: Minden szerver elérhetetlen.\n(Ellenőrizd az internetkapcsolatot!)");
        } else {
            // Ha van gyorsítótárazott változat, tájékoztatjuk a felhasználót az offline üzemmódról
            showToast(typeof t === 'function' ? t('toasts.offline_fallback') : "Offline mód: Nem sikerült frissíteni a szerverről.");
        }
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
 * Kirajzolja a szobákhoz és helyiségekhez tartozó szöveges címkéket (feliratokat) a térképre.
 * A funkció teljesítményoptimalizálási és vizuális okokból csak megfelelő nagyítási szint (zoom) 
 * felett fut le, kiszűri a technikai helyiségeket, és garantálja, hogy a felirat 
 * a szoba geometriájának belsejébe kerüljön.
 * @param {string} level - Az aktuálisan megjelenített szint (emelet) azonosítója.
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
    void mapContainer.offsetWidth; // Reflow kikényszerítése
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
 * Agresszív szobakereső algoritmus külső adatbázis illesztéshez.
 * Célja, hogy egy OpenStreetMap-ből származó név (name) vagy referencia (ref) alapján
 * megtalálja a legmegfelelőbb egyezést a külső szoba-adatbázisban (ROOM_DATABASE),
 * leküzdve a formátumbeli eltéréseket, elírásokat, vagy a hiányzó épület/szárny azonosítókat.
 * Szigorított szobakereső algoritmus külső adatbázis illesztéshez.
 * Célja, hogy egy OpenStreetMap-ből származó név vagy referencia alapján
 * megtalálja a pontos egyezést, de kizárja a fals pozitívokat (pl. K150 ne találja meg a K2150-et,
 * vagy az I épületes B007 ne találja meg az E007-et).
 * @param {string} osmName - Az OSM-ből származó 'name' tag értéke.
 * @param {string} osmRef - Az OSM-ből származó 'ref' tag értéke.
 * @param {string} osmLevel - Az OSM-ből származó szint adat (lehet többértékű is, pontosvesszővel elválasztva).
 * @param {string} buildingKey - Az aktuális épület azonosítója (pl. 'K', 'Q').
 * @returns {Object|null} A megtalált adatbázis rekord, vagy null, ha nincs találat.
 */
function findBestRoomMatch(osmName, osmRef, osmLevel, buildingKey) {
    if (!osmName && !osmRef) return null;
    
    // A keresési mag meghatározása
    let core = (osmRef || osmName || "").trim();
    if (core.toLowerCase().includes("névtelen") || core === "") return null;
    core = normalizeRoomId(core); 
    
    const b = buildingKey.toLowerCase(); 
    const rawLvl = osmLevel.split(';')[0];
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
        candidates.add(b + lvl + core); // pl. q + f + 11 -> qf11
        if (wing) {
            // Ha van betűs szárny (pl. KF50), megpróbáljuk az Épület + Szint + Szám kombót is (K + MF + 50)
            candidates.add(b + lvl + num);
            candidates.add(wing + lvl + num);
        }
    });

    const dbKeys = Object.keys(ROOM_DATABASE);
    
    // --- 1. KÖR: PONTOS EGYEZÉS ---
    // Ez a legbiztosabb, itt nincs kecmec.
    for (const cand of candidates) {
        for (const dbKey of dbKeys) {
            if (normalizeRoomId(dbKey) === cand) {
                return ROOM_DATABASE[dbKey]; 
            }
        }
    }
    
    // --- 2. KÖR: SZIGORÚ RÉSZLEGES EGYEZÉS (Fuzzy) ---
    for (const cand of candidates) {
        // Túl rövid karaktereket nem engedünk fuzzy keresésbe a fals pozitívok miatt
        if (cand.length < 2) continue; 
        
        const isOnlyNumbers = /^\d+$/.test(cand);

        for (const dbKey of dbKeys) {
            const cleanDbKey = normalizeRoomId(dbKey);
            
            // SZABÁLY 1: Az adatbázis kulcsnak az aktuális épület betűjével kell kezdődnie!
            // Megakadályozza, hogy az I épület "B007" keresése megtalálja az "E007"-et.
            if (!cleanDbKey.startsWith(b)) continue;

            // SZABÁLY 2: Részleges egyezés vizsgálata
            if (isOnlyNumbers) {
                // Ha csak számot keresünk (pl. "150"), levágjuk az épület betűjét a DB kulcsról.
                // A maradéknak (pl. "150") PONTOSAN egyeznie kell, nem lehet csak a része (pl. "2150").
                const withoutBuilding = cleanDbKey.replace(b, '');
                if (withoutBuilding === cand || withoutBuilding.startsWith(cand + '_')) {
                    return ROOM_DATABASE[dbKey];
                }
            } else {
                // Ha a keresett szóban van betű is (pl. "bf11" vagy "kf50"), az már elég specifikus
                // ahhoz, hogy sima "includes" vizsgálattal is biztonságos legyen (mivel az épület már egyezik).
                if (cleanDbKey.includes(cand)) {
                    return ROOM_DATABASE[dbKey];
                }
            }
        }
    }
    
    return null;
}

/**
 * Megnyitja az alsó információs panelt (Bottom Sheet) a kiválasztott térképelemhez.
 * Ez a funkció felelős az elem adatainak (név, típus, szint, férőhely, képek) 
 * megjelenítéséért, a külső adatbázissal való szinkronizációért, valamint
 * az intelligens magasságállítós panelvezérlésért. Továbbá kezeli az útvonaltervezésből 
 * való kilépést új elem kiválasztása esetén.
 * @param {Object} feature - A felhasználó által kiválasztott GeoJSON térképelem.
 */
function openSheet(feature) {
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

        // Ha a felhasználó egy teljesen új (harmadik) helyre kattint, megszakítjuk az aktív navigációt
        if (!isStart && !isEnd) {
            clearRouteAndClose(); 
            // A clearRouteAndClose függvény bezárja a panelt és törli az útvonalat a térképről.
            // A folyamat ezután folytatódik, és a panel újra kinyílik már az újonnan választott elem adataival.
        }
    }

    // Az aktuálisan fókuszban lévő elem globális regisztrálása
    selectedFeature = feature;
    
    // Intelligens kameramozgatás a kiválasztott elemre
    smartFlyTo(feature);
    
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

    // Intelligens névszűrés: Ha nincs neve, vagy a neve csak egy hosszú OSM azonosító szám
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
    
    // Alcím logika: Intelligens információ-megjelenítés OSM specifikus tagekkel
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
        // Összefűzzük őket egy szép, vesszővel elválasztott listává
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
    // Agresszív (Wingman támogatott) keresés indítása a részletesebb metaadatokért
    const roomData = findBestRoomMatch(p.name, p.ref, rawLevel, currentBuildingKey);
    
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
        webLink.innerText = url.replace('https://', '').replace('http://', '').split('/')[0]; // Csak a domaint írjuk ki szépen
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
            // Sortörések berakása a pontosvesszőknél a szép listáért
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
    const galleryEl = document.getElementById('room-gallery');

    // Chipek (kapacitás, címkék, felszereltség, funkciók, akadálymentesség) dinamikus kirajzolása
    renderRoomMeta(roomData, isAccessible);

    if (roomData || isAccessible) {
        if (noteEl) {
            const noteText = getRoomNote(roomData);
            noteEl.innerText = noteText;
            noteEl.style.display = (noteText && noteText.trim() !== "") ? 'block' : 'none';
        }
        
        if (galleryEl) {
            galleryEl.innerHTML = ""; 
            if (roomData && roomData.images && roomData.images.length > 0) {
                galleryEl.style.display = 'flex';
                roomData.images.forEach(url => {
                    const img = document.createElement('img');
                    img.src = url;
                    img.className = 'gallery-img';
                    img.onclick = () => window.open(url, '_blank');
                    galleryEl.appendChild(img);
                });
            } else {
                galleryEl.style.display = 'none';
            }
        }
    } else {
        if (noteEl) noteEl.style.display = 'none';
        if (galleryEl) galleryEl.style.display = 'none';
    }

    // Az információs panel (Sheet) vizuális megnyitása a CSS animáció aktiválásával
    const sheet = document.getElementById('bottom-sheet');
    sheet.classList.add('open');

    // A kedvenc (csillag) gomb vizuális állapotának frissítése a jelenlegi elem alapján
    updateFavoriteUI(); 
    
    // --- 5. INTELLIGENS MAGASSÁG-SZABÁLYOZÁS (AUTO-HEIGHT) ---
    setTimeout(() => {
        const autoH = getAutoHeight();
        
        // Ha van belső adatbázis rekord VAGY van OSM nyitvatartási/weboldal adat
        if (roomData || hasPoiData) {
                sheet.style.height = `${autoH}px`;
        } else {
                sheet.style.height = `${getPeekHeight() + 20}px`; 
        }
    }, 50);

    // A kiválasztott elem vizuális kiemelése (sárga keret) a térképen
    drawSelectedHighlight(feature);
    
    // A kamera automatikus ráközelítése (zoom & pan) a kiválasztott elemre
    zoomToFeature(feature);
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

        // Okos Név + Ref kombináció az itinerben is
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
    // Biztonsági ellenőrzés a kiindulópontra (null check)
    const sourceName = sourceFeature ? formatName(sourceFeature) : (typeof t === 'function' ? (t('nav.selected_point') || "Kijelölt pont") : "Kijelölt pont");

    // --- 2. FEJLÉC (Header) TARTALMÁNAK FRISSÍTÉSE ---
    
    // Főcím: Az utazás becsült idejének kiemelt megjelenítése
    const timeText = typeof t === 'function' ? t('nav.time_minutes', { time: stats.time }) : `${stats.time} perc`;
    title.innerHTML = `
        <div style="text-align:center; width:100%;">
            <span style="color:var(--color-ui-active); font-size:28px; font-weight:800; letter-spacing:-0.5px;">
                ${timeText}
            </span>
        </div>
    `;
    
    // Alcím: Az össztávolság és a célpont nevének megjelenítése
    const distText = typeof t === 'function' ? t('nav.dist_meters', { dist: stats.dist }) : `${stats.dist} m`;
    sub.innerHTML = `
        <div style="text-align:center; width:100%; font-size:15px; opacity:0.8; margin-top:-5px;">
            ${distText} <span style="margin:0 6px; opacity:0.4;">&bull;</span> ${targetName}
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
    let html = `<div style="margin-top:15px; display:flex; flex-direction:column; gap:12px;">`;
    
    const clickToViewText = typeof t === 'function' ? t('nav.click_to_view') : 'Kattints a megtekintéshez';
    const startText = typeof t === 'function' ? t('nav.start', { source: sourceName }) : `Indulás: ${sourceName}`;
    const arrivalText = typeof t === 'function' ? t('nav.arrival', { target: targetName }) : `Megérkezés: ${targetName}`;

    // Indulási pont HTML sorának generálása kattintható (fókuszáló) eseménykezelővel
    html += `
        <div class="itiner-step clickable-step" onclick="focusOnEndpoint('start')">
            <div class="itiner-icon start"><span class="material-symbols-outlined">trip_origin</span></div>
            <div class="itiner-text">
                <div style="font-weight:bold; font-size:16px;">${startText}</div>
                <div style="font-size:12px; opacity:0.6; margin-top:2px;">${clickToViewText}</div>
            </div>
        </div>
    `;

    // A navigációs lépések (irányok, szintváltások) iterálása és HTML generálása
    itinerary.forEach(step => {
        html += `
            <div class="itiner-step clickable-step" onclick="focusOnRouteSegment('${step.level}')">
                <div class="itiner-icon"><span class="material-symbols-outlined">${step.icon}</span></div>
                <div class="itiner-text">
                    <div style="font-weight:bold; font-size:16px;">${step.text}</div>
                    <div style="font-size:12px; opacity:0.6; margin-top:2px;">${clickToViewText}</div>
                </div>
            </div>
        `;
    });

    // Érkezési célpont HTML sorának generálása kattintható (fókuszáló) eseménykezelővel
    html += `
        <div class="itiner-step clickable-step" onclick="focusOnEndpoint('end')">
            <div class="itiner-icon end"><span class="material-symbols-outlined">location_on</span></div>
            <div class="itiner-text">
                <div style="font-weight:bold; font-size:16px;">${arrivalText}</div>
                <div style="font-size:12px; opacity:0.6; margin-top:2px;">${clickToViewText}</div>
            </div>
        </div>
    `;
    // Térköz hozzáadása a tartalom alján a kényelmes görgetés érdekében
    html += `</div> <div style="height:40px;"></div>`; 
    
    itineraryDiv.innerHTML = html;

    // A lábléc (footer) elrejtése a letisztult navigációs nézet érdekében
    const footer = document.querySelector('.sheet-footer');
    if (footer) footer.style.display = 'none';
    
    // A panel megjelenítése és részleges ('peek') állapotba történő összecsukása
    sheet.classList.add('open');
    collapseToPeek(); 
}

/**
 * Intelligens kameramozgatás és fókuszálás egy adott útvonalszakaszra navigáció közben.
 * Átvált a megfelelő szintre, összegyűjti az oda tartozó útvonalpontokat, majd 
 * kiszámítja azok befoglaló téglalapját (bounds). A térkép nézetét dinamikus 
 * margókkal (padding) állítja be, garantálva, hogy a lebegő felhasználói felületi 
 * elemek (például a felső keresősáv vagy az alsó információs panel) ne takarják ki a szakaszt.
 * @param {string} level - A megtekinteni kívánt szint (emelet) azonosítója.
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

    if (routePoints.length === 0) return;

    const lons = routePoints.map(p => p[0]);
    const lats = routePoints.map(p => p[1]);

    const sheet = document.getElementById('bottom-sheet');
    const sheetHeight = sheet ? sheet.getBoundingClientRect().height : 100;

    if (routePoints.length > 0) {
        map.flyTo({
            center: [lons[0], lats[0]],
            zoom: 20,
            padding: { top: 80, bottom: sheetHeight + 50, left: 50, right: 50 },
            animate: true,
            duration: 1000
        });
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

    document.getElementById('bottom-sheet').classList.remove('open');
    
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

function clearRouteAndClose() {
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

    closeSheet();
}

/**
 * Központi eseménykezelő a felhasználói keresések feldolgozására.
 * Két fő funkciót lát el:
 * 1. Enter billentyű leütése: Azonnali fókuszálás a legjobb találatra, kategória kiemelés,
 * vagy intelligens javaslat a megfelelő épületre való átváltásra.
 * 2. Gépelés (Autocomplete): Valós idejű javaslatok listázása a beírt karakterek alapján,
 * beleértve a helyi térképelemeket és a más épületekre vonatkozó figyelmeztetéseket.
 * @param {KeyboardEvent|InputEvent} e - A keresőmező (input) által kiváltott DOM esemény.
 */
function handleSearch(e) {
    // A keresett kifejezés kinyerése és a felesleges szóközök eltávolítása
    const term = e.target.value.trim();
    const resultsDiv = document.getElementById('search-results');
    
    // ==========================================
    // 1. RÉSZ: ENTER BILLENTYŰ LEÜTÉSÉNEK KEZELÉSE
    // ==========================================
    if (e.key === 'Enter') {
        
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
            updateRightButtonState();
            return;
        }

        // --- 2. Prioritás: Helyi térképelemek keresése (Jelenlegi épület) ---
        const hits = smartFilter(term); 
        if (hits.length > 0) {
            zoomToFeature(hits[0]);
            openSheet(hits[0]);
            resultsDiv.style.display = 'none'; 
            
            const val = hits[0].properties.name || hits[0].properties.ref || term;
            document.getElementById('search-input').value = val;
            updateRightButtonState();
            return; 
        }

        // --- 3. Prioritás (Végső Fallback): Intelligens Épületváltás ---
        // Ha semmi találat nincs az aktuális épületben, megnézzük, hogy a regex alapján máshol van-e
        for (const [key, data] of Object.entries(BUILDINGS)) {
            if (key !== currentBuildingKey && data.regex && data.regex.test(term)) {
                const bName = getBuildingName(key);
                showModal(
                    typeof t === 'function' ? t('modal.switch_building_title') : "Épület Váltás", 
                    typeof t === 'function' ? t('modal.switch_building_prompt', { building: bName }) : `Nincs találat itt. A keresett hely (${term}) valószínűleg a(z) ${bName}-ben van. Átváltsunk?`, 
                    () => { changeBuilding(key, term); }
                );
                // A UI frissítése: becsukjuk a listát, fókusz levétele
                resultsDiv.style.display = 'none';
                e.target.blur();
                return; 
            }
        }

        // --- 4. Ha végképp semmi ---
        showToast(typeof t === 'function' ? t('toasts.no_search_results') : "Nincs találat erre a kifejezésre.");
        return; 
    }

    // ==========================================
    // 2. RÉSZ: GÉPELÉS KÖZBENI JAVASLATOK (AUTOCOMPLETE)
    // ==========================================
    
    // Az előző javaslatok törlése a tiszta újrarendereléshez
    resultsDiv.innerHTML = '';
    let hasResults = false;

    // Ha a felhasználó kiürítette a mezőt (pl. Backspace), elrejtjük a listát
    if (term.length < 1) { 
        resultsDiv.style.display = 'none'; 
        updateRightButtonState();
        return; 
    }

    // --- 1. Automatikus Épület Javaslatok ---
    // Valós idejű ellenőrzés: figyelmezteti a felhasználót, ha valószínűleg rossz épületben keres
    for (const [key, data] of Object.entries(BUILDINGS)) {
        // Illesztés a regex szabályokra (pl. "QBF..." beírása esetén Q épület javaslata)
        if (key !== currentBuildingKey && data.regex && data.regex.test(term)) {
            const div = document.createElement('div');
            // Figyelemfelkeltő vizuális stílus (sárga szöveg) a javaslathoz
            div.className = 'result-item warning-text';
            const maybeText = typeof t === 'function' ? t('search.maybe_in_building', { building: key }) : `Talán a ${key} épületben?`;
            div.innerHTML = `<span class="material-symbols-outlined" style="vertical-align:middle; margin-right:5px;">travel_explore</span> ${maybeText}`;
            
            // Kattintás esemény: azonnali épületváltás a beírt keresőszó átadásával
            div.onclick = () => changeBuilding(key, term);
            
            resultsDiv.appendChild(div);
            hasResults = true;
        }
    }

    // --- 2. Helyi Autocomplete Találatok ---
    // Csak akkor indítunk keresést, ha legalább 2 karaktert beírt a felhasználó (teljesítményoptimalizálás)
    if (term.length >= 2) {
        const hits = smartFilter(term);
        if (hits.length > 0) {
            // A találati listát korlátozzuk az első 5 legrelevánsabb elemre a felület túlcsordulásának elkerülésére
            hits.slice(0, 5).forEach(hit => {
                const div = document.createElement('div');
                div.className = 'result-item';
                
                const name = hit.properties.name || hit.properties.ref || "???";
                const lvl = getLevelsFromFeature(hit)[0] || "?";
                const levelBadge = typeof t === 'function' ? t('search.level_badge', { level: escapeHTML(lvl) }) : `(Szint: ${escapeHTML(lvl)})`;
                
                // A javaslat összeállítása: Név (kiemelve) és a szint (halványan)
                div.innerHTML = `${escapeHTML(name)} <span style="opacity:0.6; font-size:12px; margin-left:5px;">${levelBadge}</span>`;
                
                // Kattintás esemény egy specifikus javaslatra: Fókuszálás, panel megnyitása és lista elrejtése
                div.onclick = () => { 
                    zoomToFeature(hit); 
                    openSheet(hit); 
                    resultsDiv.style.display = 'none'; 
                    document.getElementById('search-input').value = name; 

                    // UI frissítés a kiválasztás után
                    updateRightButtonState();
                };
                resultsDiv.appendChild(div);
                hasResults = true;
            });
        }
    }

    // A javaslatokat tartalmazó konténer (div) megjelenítése vagy elrejtése a találatok függvényében
    if (hasResults) {
        resultsDiv.style.display = 'block';
    } else {
        resultsDiv.style.display = 'none';
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
        
        // Az alapértelmezett viselkedés megakadályozása garantálja, hogy a gomb
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
 * A POI keresés fő belépési pontja. Megvizsgálja, hogy van-e találat az aktuális 
 * emeleten. Ha nincs, intelligensen átvált arra az emeletre, ahol a legközelebbi található.
 * @param {string} typeKey - A POI kategória kulcsa (pl. 'coffee')
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
 * Kirajzolja a térképre az aktív kategóriába tartozó POI markereket,
 * de Szigorúan csak azokat, amelyek a megadott szinten találhatóak.
 * @param {string} level - Az aktuálisan megjelenített szint
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
 * Létrehozza a térképi markert a HTML/CSS formázással,
 * ráakasztja a kattintás eseményeket és bedobja a térképre.
 * @param {Object} poi - A getPoiPositions által visszaadott objektum (coords, feature, config)
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
        // Valós földrajzi távolság kiszámítása a két pont között méterben
        let dist = turf.distance(turf.point([node1.lon, node1.lat]), turf.point([node2.lon, node2.lat])) * 1000;
        
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
        let score = turf.distance(turf.point([coords[1], coords[0]]), turf.point([currentBuilding.center[1], currentBuilding.center[0]]));
        
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
            let score = turf.distance(turf.point([coords[1], coords[0]]), turf.point([currentBuilding.center[1], currentBuilding.center[0]]));
            
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
            let dist = turf.distance(turf.point([lon, lat]), turf.point([corrLon, corrLat])) * 1000;
            
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
    // Biztonsági ellenőrzés: ha az elem érvénytelen, vagy pont típusú (tehát nem szoba alapterület), megszakítjuk a futást
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
            let d1 = turf.distance(turf.point([newLon, newLat]), turf.point([p1.lon, p1.lat])) * 1000;
            let d2 = turf.distance(turf.point([newLon, newLat]), turf.point([p2.lon, p2.lat])) * 1000;
            
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
        
        // A geometriai távolság kiszámítása a keresett koordináta és a csomópont között (kilométerről méterre váltva)
        const d = turf.distance(turf.point([targetLon, targetLat]), turf.point([lon, lat])) * 1000;
        
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
        
        // Visszaanimáljuk az eredeti magasságra
        setTimeout(() => { document.getElementById('bottom-sheet').style.height = `${getAutoHeight()}px`; }, 50);
        return;
    }

    // Ha nincs nyitva, létrehozzuk
    if (btn) btn.classList.add('active');
    document.getElementById('room-data-container').style.display = 'none'; // Eredeti tartalom elrejtése
    
    container = document.createElement('div');
    container.id = 'nearby-menu-container';
    const nearbyTitle = typeof t === 'function' ? t('sheet.nearby_prompt') : "Mit keresel a közelben?";
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
    
    // A sheet magasságának újrakalkulálása a POI rács méretéhez
    setTimeout(() => { document.getElementById('bottom-sheet').style.height = `${getAutoHeight()}px`; }, 50);
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
 * Univerzális kereső algoritmus: Megkeresi a legközelebbi adott típusú POI-t.
 * @param {string} typeKey - A keresett POI típusa (pl. 'toilet', 'coffee')
 */
function findNearestPOI(typeKey) {
    if (!selectedFeature) { 
        alert(typeof t === 'function' ? t('alerts.select_start_first') : "Először válassz ki egy kiindulópontot a térképen!"); 
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
        alert(typeof t === 'function' ? t('alerts.no_poi_found_on_map', { poi: poiName.toLowerCase() }) : `Nem találtam ${poiName.toLowerCase()}t ezen a térképen!`); 
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
        // Intelligens szintválasztás: Ha az elem elérhető az aktuális térképnézeten,
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

    // Biztonsági megszakítás, ha egyáltalán nem sikerült kezdőpontot generálni
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
    
    // Fallback megoldások, ha nem sikerült ajtót találni a célponthoz
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

    // Biztonsági megszakítás, ha nem sikerült érvényes célpontot generálni
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
        // A kiszámított hálózati útvonal kirajzolása a térképre
        drawRoute(bestPath);
        
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

        // A teljes útvonal mentése globális változóba a szint-fókuszáló algoritmus (focusOnRouteSegment) számára
        currentRoutePath = bestPath; 

        // --- KIINDULÁSI PONT (activeNavSource) VIZUÁLIS KEZELÉSE ---
        if (pendingNavSource) {
            activeNavSource = pendingNavSource;
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
        
        // A célpont regisztrálása globálisan
        activeNavTarget = target; 

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
            // A vízszintes (légvonalbeli) távolság kiszámítása a Turf.js segítségével (méterben).
            // Szintváltás esetén a vertikális elmozdulás vízszintes vetülete minimális, 
            // de a matematikai pontosság érdekében a függvény ezt is feldolgozza.
            const d = turf.distance([prev.lon, prev.lat], [current.lon, current.lat]) * 1000;
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
                const hDist = turf.distance([prev.lon, prev.lat], [current.lon, current.lat]) * 1000;
                
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
 * Generál egy lépésről lépésre követhető útvonaltervet (itinert) a navigációs útvonal alapján.
 * Célja, hogy emberi fogyasztásra alkalmas formában jelenítse meg a szintváltásokat,
 * intelligensen felismerve, hogy az adott váltás lifttel vagy lépcsővel történik-e,
 * és a folyamatos váltásokat (pl. fel a lépcsőn a földszintről a 2. emeletre) 
 * egyetlen logikai lépéssé vonja össze.
 * * @param {Array<string>} pathKeys - Az útvonalat alkotó csomópontok azonosítóinak (kulcsainak) tömbje.
 * @returns {Array<Object>} Az itiner lépéseit tartalmazó objektumok tömbje.
 */
function generateItinerary(pathKeys) {
    const steps = [];
    // Biztonsági ellenőrzés: üres útvonal esetén üres tömböt adunk vissza
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

            // --- INTELLIGENS ÖSSZEVONÁS (Smart Aggregation) ---
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
function runDijkstra(startKey, endKey) {
    // Az algoritmushoz szükséges alapvető adatszerkezetek inicializálása
    const distances = new Map(); // A csomópontokhoz vezető eddigi legrövidebb távolságok
    const prev = new Map();      // A legrövidebb útvonal fája (az előző csomópontok tárolására)
    const queue = [];            // Prioritási sorként funkcionáló tömb a feldolgozandó pontokhoz
    
    // A kezdőpont beállítása nulla távolsággal a sorba
    distances.set(startKey, 0); 
    queue.push({ key: startKey, dist: 0 });
    
    // A már véglegesített (feldolgozott) csomópontok halmaza
    const visited = new Set();
    
    // Végtelen ciklus elleni védelem inicializálása
    let loopCounter = 0; 
    const SAFETY_LIMIT = 15000; 

    // Fő iterációs ciklus, amíg van feldolgozatlan csomópont a sorban
    while (queue.length > 0) {
        // Biztonsági ellenőrzés a túlcsordulás vagy elakadás elkerülésére
        loopCounter++; 
        if (loopCounter > SAFETY_LIMIT) throw new Error("Végtelen ciklus!");
        
        // A sor rendezése távolság szerint (egyszerű prioritási sor implementáció)
        // A legkisebb távolságú (legközelebbi) csomópont kiválasztása
        queue.sort((a, b) => a.dist - b.dist);
        const { key: u, dist } = queue.shift();
        
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
                queue.push({ key: n.key, dist: alt }); 
            }
        }
    }
    
    // Ha a sor kiürült, de nem értük el a célt, nem létezik összefüggő útvonal
    return null;
}

// === ÚTVONAL ELEMZŐ (Lépcső/Lift Ikonokhoz) ===

/**
 * Elemzi a navigációs útvonalat, és azonosítja azokat a pontokat (markereket),
 * ahol szintváltás történik. Intelligensen meghatározza, hogy a szintváltás
 * lifttel vagy lépcsővel valósul-e meg, és a folyamatos (többemeletes) 
 * haladást egyetlen vizuális markerbe vonja össze.
 *
 * @param {Array<Object>} path - Az útvonal csomópontjait tartalmazó tömb (minden elem: {lat, lon, level}).
 * @returns {Array<Object>} A térképi markerek adatait tartalmazó tömb (koordináta, típus, célszint, ikon).
 */
function getVerticalMarkers(path) {
    const markers = [];
    // Biztonsági ellenőrzés: ha az útvonal hiányzik, vagy túl rövid a szintváltáshoz
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

        // 2. STRATÉGIA: Adatbázis/GeoJSON alapú megerősítés és pontosítás
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
    // A nyilakat most már natív MapLibre 'symbol' réteg (route-arrows) kezeli!
}

/**
 * Megjeleníti a kiszámított útvonalat a térképen.
 * Kirajzolja a vízszintes és függőleges szakaszokat, elhelyezi a szintváltásokat
 * jelző vizuális markereket (lift, lépcső), felrajzolja az irányjelző nyilakat,
 * majd a kamerát az útvonalat befoglaló téglalapra (bounds) igazítja.
 *
 * @param {Array<string>} pathKeys - Az útvonal csomópontjait tartalmazó kulcsok tömbje (formátum: 'lat,lon,level').
 */
function drawRoute(pathKeys) {
    _clearRouteMarkers();
    _clearArrowMarkers();
    
    const latlngs = [];
    const routeFeatures = [];
    const boundsPoints = [];

    pathKeys.forEach(k => {
        const parts = k.split(',');
        const lat = parseFloat(parts[0]);
        const lon = parseFloat(parts[1]);
        latlngs.push({ lat: lat, lon: lon, level: parts[2] });
        boundsPoints.push([lon, lat]); 
    });

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

    if (boundsPoints.length > 0) {
        const lons = boundsPoints.map(p => p[0]);
        const lats = boundsPoints.map(p => p[1]);

        const routePadding = IS_EMBED_MODE 
            ? { top: 25, bottom: 85, left: 25, right: 25 }
            : { top: 50, bottom: 150, left: 50, right: 50 };
        const routeMaxZoom = IS_EMBED_MODE ? 18.5 : 21;

        map.fitBounds(
            [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
            {
                padding: routePadding,
                maxZoom: routeMaxZoom,
                animate: true,
                duration: 1000
            }
        );
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
    
    // Biztonsági ellenőrzés a térképadatok meglétére
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
    // Prioritás: Földszint ("0"), ha létezik, egyébként a legalacsonyabb elérhető szint.
    if (availableLevels.includes("0")) {
        currentLevel = "0";
    } else if (availableLevels.length > 0) {
        currentLevel = availableLevels[0];
    } else {
        currentLevel = "0"; // Biztonsági alapértelmezés (Fallback)
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

// === INTELLIGENS KAMERAMOZGATÁS (OFFSET LOGIKA) ===

/**
 * Pozícionálja a térkép kameráját a megadott térképelemre (feature), 
 * intelligensen kompenzálva a felhasználói felület (UI) által kitakart képernyőterületeket.
 * Pixel alapú eltolást alkalmaz, hogy a fókuszpont vizuálisan mindig a szabadon 
 * látható térképrész közepére essen, majd szükség esetén végrehajtja az emeletváltást is.
 *
 * @param {Object} feature - A fókuszba helyezendő GeoJSON térképelem.
 */
function smartFlyTo(feature) {
    if (!feature) return;

    let lat, lon;
    if (feature.geometry.type === "Point") {
        lon = feature.geometry.coordinates[0];
        lat = feature.geometry.coordinates[1];
    } else {
        const c = turf.centroid(feature);
        lon = c.geometry.coordinates[0];
        lat = c.geometry.coordinates[1];
    }

    let bottomOffset = 160;
    if (IS_EMBED_MODE) {
        const embedBar = document.getElementById('embed-info-bar');
        bottomOffset = (embedBar && embedBar.classList.contains('visible')) ? 80 : 30;
    } else {
        const sheet = document.getElementById('bottom-sheet');
        const settingsModal = document.getElementById('settings-modal');

        if (sheet && sheet.classList.contains('open')) {
            bottomOffset = sheet.getBoundingClientRect().height;
        } else if (settingsModal && settingsModal.classList.contains('editor-mode')) {
            const card = settingsModal.querySelector('.settings-card');
            if (card) bottomOffset = card.getBoundingClientRect().height;
        }
    }

    const levels = getLevelsFromFeature(feature);
    if (levels.length > 0 && !levels.includes(currentLevel)) {
        switchLevel(levels[0]);
    }

    const targetZoom = IS_EMBED_MODE ? 18.2 : 20;
    map.flyTo({
        center: [lon, lat],
        zoom: targetZoom,
        padding: { 
            top: IS_EMBED_MODE ? 20 : 60, 
            bottom: bottomOffset, 
            left: IS_EMBED_MODE ? 20 : 30, 
            right: IS_EMBED_MODE ? 20 : 30 
        },
        duration: 800,
        essential: true
    });

    drawSelectedHighlight(feature);
}

function zoomToFeature(feature) {
    smartFlyTo(feature);
}

// === ALSÓ INFORMÁCIÓS PANEL (BOTTOM SHEET) MOZGATÁSI LOGIKA ===

// DOM elemek referenciáinak inicializálása a panel manipulációjához
const sheet = document.getElementById('bottom-sheet');
const handle = document.getElementById('sheet-handle');
const content = document.getElementById('sheet-scroll-content');
const footer = document.querySelector('.sheet-footer');
const header = document.querySelector('.sheet-header');

// Állapotváltozók a húzási (drag) interakció és a fizikai szimuláció nyomon követéséhez
let startY = 0;           // Az érintés/kattintás kezdeti Y koordinátája
let startHeight = 0;      // A panel magassága a húzás megkezdésekor
let isDragging = false;   // Logikai jelző a húzási folyamat állapotáról
let lastY = 0;            // Az előző mérési pont Y koordinátája a mozgási sebesség (velocity) számításához
let velocity = 0;         // A mozgás sebessége az inercia és a lendület (spring) logikájához

/**
 * Kiszámítja az alsó információs panel minimális (betekintő / peek) magasságát.
 * Ez az a vertikális méret, amelynél a fejléc, a húzófogantyú és a lábléc (az akciógombokkal) 
 * látható marad, de maga a tartalom rejtve van a felhasználó elől.
 *
 * @returns {number} A számított betekintő magasság pixelben kifejezve.
 */
function getPeekHeight() {
    // A UI komponensek aktuális magasságának lekérése, biztonsági alapértelmezett értékekkel (fallback)
    const handleH = handle.offsetHeight || 25;
    const headerH = header.offsetHeight || 60;
    const footerH = footer.offsetHeight || 80;
    
    // A komponensek magasságának összegzése, kiegészítve egy 10px-es vizuális margóval a zsúfoltság elkerülésére
    return handleH + headerH + footerH + 10;
}

/**
 * Kiszámítja a panel automatikus (optimális) magasságát a belső tartalom kiterjedése alapján.
 * A függvény biztosítja, hogy a panel alapértelmezetten ne takarja ki a képernyőt teljesen,
 * és egy meghatározott aránynál (60%) megálljon.
 *
 * @returns {number} Az ideális magasság pixelben kifejezve.
 */
function getAutoHeight() {
    const contentH = content.scrollHeight;
    const peekH = getPeekHeight();
    
    // A teljes szükséges magasság: a fix elemek (peek) és a görgethető belső tartalom összege
    const total = peekH + contentH;
    
    // A visszaadott érték maximalizálása az elérhető ablakmagasság 60%-ában
    return Math.min(total, window.innerHeight * 0.6);
}

/**
 * Összecsukja az információs panelt a minimális (peek) állapotába.
 * CSS átmenetet (transition) alkalmaz a finom animációhoz, és visszaállítja
 * a belső görgetési pozíciót az alaphelyzetbe, hogy a következő megnyitáskor 
 * a tartalom ismét a tetejétől legyen olvasható.
 */
function collapseToPeek() {
    const peekH = getPeekHeight();
    
    // A panel magasságának és az animációs átmenet paramétereinek beállítása
    sheet.style.height = `${peekH}px`;
    sheet.style.transition = 'height 0.3s ease-out';
    
    // A nyitott állapotot jelző CSS osztály fenntartása (mivel a peek is egy látható, interaktív állapot)
    sheet.classList.add('open');
    
    // A belső görgetősáv (scroll) pozíciójának nullázása a tiszta állapot eléréséhez
    document.getElementById('sheet-scroll-content').scrollTop = 0;
}

// === ESEMÉNYKEZELŐK (EVENT LISTENERS) ===

/**
 * Eseménykezelő a panel húzásának (drag) megkezdéséhez érintőképernyős eszközökön.
 * Inicializálja az állapotváltozókat és kikapcsolja a CSS animációkat az azonnali, 
 * késleltetés nélküli ujjkövetés (1:1 tracking) érdekében.
 */
let didSheetDrag = false;

function _onSheetDragStart(clientY) {
    isDragging = true;
    didSheetDrag = false;
    startY = clientY;
    lastY = startY;
    velocity = 0;
    startHeight = sheet.getBoundingClientRect().height;
    
    // Animáció letiltása a sima, azonnali reakcióhoz a húzás alatt
    sheet.style.transition = 'none'; 
    handle.style.cursor = 'grabbing';
}

function _onSheetDragMove(clientY) {
    if (!isDragging) return;
    
    const deltaY = startY - clientY;
    if (Math.abs(deltaY) > 5) {
        didSheetDrag = true;
    }
    const newHeight = startHeight + deltaY;
    
    velocity = clientY - lastY; 
    lastY = clientY;

    const peekH = getPeekHeight();
    const maxH = window.innerHeight * 0.9;

    if (newHeight >= peekH * 0.8 && newHeight <= maxH) {
        sheet.style.height = `${newHeight}px`;
    }
}

function _onSheetDragEnd() {
    if (!isDragging) return;
    
    isDragging = false;
    handle.style.cursor = 'grab';
    
    // Ruganyos (spring) animációs görbe alkalmazása a természetesebb fizikai hatásért
    sheet.style.transition = 'height 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'; 
    
    const currentHeight = sheet.getBoundingClientRect().height;
    const peekH = getPeekHeight();
    const autoH = getAutoHeight();
    const maxH = window.innerHeight * 0.85;

    if (velocity > 10) {
        sheet.style.height = `${peekH}px`;
    }
    else if (velocity < -10) {
        if (currentHeight < autoH) {
            sheet.style.height = `${autoH}px`;
        } else {
            sheet.style.height = `${maxH}px`;
        }
    }
    else {
        const distToPeek = Math.abs(currentHeight - peekH);
        const distToAuto = Math.abs(currentHeight - autoH);
        const distToMax = Math.abs(currentHeight - maxH);

        if (distToPeek < distToAuto && distToPeek < distToMax) {
            sheet.style.height = `${peekH}px`;
        } else if (distToMax < distToAuto) {
            sheet.style.height = `${maxH}px`;
        } else {
            sheet.style.height = `${autoH}px`;
        }
    }
    
    if (sheet.style.height === `${peekH}px`) {
        content.scrollTop = 0;
    }
}

handle.addEventListener('touchstart', (e) => {
    _onSheetDragStart(e.touches[0].clientY);
}, {passive: true});

handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    _onSheetDragStart(e.clientY);
});

/**
 * Globális eseménykezelő a keresőmezőn kívüli kattintások (focus lost) detektálására.
 * Ha a felhasználó a keresősávon és a találati listán kívülre kattint, 
 * a rendszer automatikusan elrejti az aktív találati listát.
 */
document.addEventListener('click', (e) => {
    const searchWrapper = document.getElementById('search-wrapper');
    const resultsDiv = document.getElementById('search-results');
    
    // Ellenőrzés: ha a kattintás nem a kereső komponensein belül történt, 
    // és a találati lista jelenleg látható
    if (!searchWrapper.contains(e.target) && resultsDiv.style.display !== 'none') {
        resultsDiv.style.display = 'none';
    }
});

document.addEventListener('touchmove', (e) => {
    _onSheetDragMove(e.touches[0].clientY);
}, {passive: true});

document.addEventListener('mousemove', (e) => {
    _onSheetDragMove(e.clientY);
});

document.addEventListener('touchend', _onSheetDragEnd);
document.addEventListener('mouseup', _onSheetDragEnd);
window.addEventListener('blur', _onSheetDragEnd);

/**
 * Eseménykezelő a húzófogantyúra (handle) történő normál kattintásra.
 * Alternatívát nyújt a húzás (drag) interakció helyett: egyszerű kattintással vált (toggle)
 * az optimális nyitott (auto) és a betekintő (peek) állapotok között.
 */
handle.addEventListener('click', () => {
    if (didSheetDrag) {
        didSheetDrag = false;
        return;
    }
    const currentH = sheet.getBoundingClientRect().height;
    const peekH = getPeekHeight();
    const autoH = getAutoHeight();

    // Egyenletes (ease-out) animáció alkalmazása a kattintásos állapotváltásnál
    sheet.style.transition = 'height 0.3s ease-out';

    // Állapotvizsgálat: ha a panel a betekintő magasság közelében van, kinyitjuk
    if (currentH < peekH + 50) {
        sheet.style.height = `${autoH}px`;
    } 
    // Ha a panel nyitva van, összecsukjuk a betekintő állapotba
    else {
        sheet.style.height = `${peekH}px`;
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

    // FIX: Ha a toast véletlenül a Bottom Sheet-ben van, áthelyezzük a body-ba,
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
    
    // FIX: Ha már fut egy eltüntető időzítő, töröljük, hogy a friss üzenet biztosan kint maradjon 3 másodpercig
    if (window.toastTimeout) {
        clearTimeout(window.toastTimeout);
    }
    
    // Az értesítés automatikus elrejtése 3000 ezredmásodperc (3 másodperc) eltelte után
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
        prompt(typeof t === 'function' ? t('alerts.copy_link_prompt') : "Másold ki az iframe kódot:", iframeSnippet);
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
            // Közvetlen egyezés vizsgálata az OSM azonosító alapján, amely garantálja a pontosságot.
            if (desc.type === 'id') {
                return geoJsonData.features.find(f => f.id === desc.val);
            }

            // B) KOORDINÁTA ALAPÚ KERESÉS (Fenntartott hely későbbi implementációnak)
            if (desc.type === 'coord') {
                // Megjegyzés: Jelenleg nincs implementálva (pl. turf.nearestPoint használható lenne), 
                // mivel az elsődleges ID alapú azonosítás lefedi a használati esetek többségét.
                return null; 
            }
            
            // C) NÉV VAGY REFERENCIA ALAPÚ KERESÉS (Okos szűrés)
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
    _currentMapStyleMode = APP_SETTINGS.themeMode || 'dark';

    enableOneFingerZoom(map);

    initBuildings();
    renderThemeSelector();
    applyTheme();

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


// === PWA & SERVICE WORKER REGISZTRÁCIÓ ===

// 1. Service Worker regisztrálása (Offline működéshez - csak normál módban)
if ('serviceWorker' in navigator && !IS_EMBED_MODE) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then((registration) => {
        }).catch((err) => {
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
    showToast(typeof t === 'function' ? t('toasts.pwa_installed') : "BMEmap sikeresen telepítve! 📱");
});

// Globális függvényexportok a HTML eseménykezelők számára
window.handleEmbedNavClick = handleEmbedNavClick;
window.openEmbedInfo = openEmbedInfo;
window.closeEmbedInfo = closeEmbedInfo;
window.copyEmbedCode = copyEmbedCode;
window.toggleDevMode = toggleDevMode;
window.startNavigationToHere = startNavigationToHere;