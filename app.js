 // Biztonsági háló: Ha a fájl nincs ott, legyen egy üres objektum
    if (typeof ROOM_DATABASE === 'undefined') {
        console.warn("room_data.js nem található vagy nem töltődött be!");
        window.ROOM_DATABASE = {};
    }

    // === SEGÉDFÜGGVÉNY: EMELET BETŰJELEK (Dynamic & Hardcoded) ===
    function getLevelChars(buildingKey, rawLevel) {
        const b = buildingKey.toUpperCase();
        const l = rawLevel.toString();
        let chars = new Set();

        // 1. Nyers szám (pl "1")
        chars.add(l);

        // 2. Dinamikus Alias (level:ref az OSM-ből)
        // Ha ehhez a szinthez találtunk aliast (pl "MF"), adjuk hozzá
        if (levelAliases[l]) {
            chars.add(normalizeRoomId(levelAliases[l])); // pl "mf"
        }

        // 3. Hardcoded szabályok (Fallback / Legacy support)
        if (b === 'K') {
            if (l === '-1') { chars.add('f'); chars.add('0'); }
            if (l === '0') { chars.add('1'); }
        } else if (b === 'Q') {
            if (l === '-1') chars.add('p');
            // A többit most már az OSM level:ref intézi, de meghagyhatjuk a biztonság kedvéért
            if (l === '0') chars.add('f'); 
        } else {
            if (l === '0') chars.add('f');
        }

        return Array.from(chars);
    }

    // === KERESŐ LOGIKA (SMART FILTER v3) ===
    function smartFilter(term) {
        const cleanTerm = normalizeRoomId(term); 
        if (cleanTerm.length < 2) return [];

        const bKey = currentBuildingKey.toLowerCase();

        return geoJsonData.features.filter(f => {
            const p = f.properties;
            const name = normalizeRoomId(p.name);
            const ref = normalizeRoomId(p.ref);
            const rawLvl = getLevelsFromFeature(f)[0] || "0";
            
            // 1. Direkt egyezés
            if (name.includes(cleanTerm) || (ref && ref.includes(cleanTerm))) return true;

            const targetCore = ref || name;
            if (!targetCore) return false;

            const lvlChars = getLevelChars(currentBuildingKey, rawLvl);
            
            // 2. Alias generálás
            const aliases = new Set();
            lvlChars.forEach(lvl => {
                aliases.add(lvl + targetCore);          // p107
                aliases.add(bKey + lvl + targetCore);   // qp107
                // Sima épület + mag (ez hiányozhatott az I-nél)
                aliases.add(bKey + targetCore);         // ib028
            });

            for (const alias of aliases) {
                if (alias === cleanTerm) return true;
                // Reverse Fuzzy: Ha a keresésben benne van az alias (pl. keresés: "keresem a ib028-at")
                if (cleanTerm.includes(alias)) return true;
            }

            // 3. Brute Force összetétel (A VÉGSŐ MENEKÜLÉS)
            // Ha a keresés kezdődik az épület betűjével, és utána jön a terem neve
            if (cleanTerm.startsWith(bKey) && cleanTerm.includes(targetCore)) {
                return true; 
            }

            // Szint alapú keresés (marad a régi)
            for (const lvlChar of lvlChars) {
                if (isNaN(parseInt(lvlChar))) { 
                    if (cleanTerm.includes(lvlChar) && cleanTerm.includes(targetCore)) return true; 
                }
            }

            return false;
        });
    }

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
        "A": { name: "A Épület", center: [47.4765122, 19.056128], zoom: 19, regex: /^A/i },
        "J": { name: "J Épület", center: [47.479532, 19.057396], zoom: 19, regex: /^J/i } 
    };

    // === A NAGY SZÍN-BIBLIA ===
    // Itt vannak definiálva a változók és az alapértelmezett értékeik (Dark / Light)
    const THEME_VARS = {
        // --- ALAPOK (UI & Háttér) ---
        '--bg-body':           { dark: '#121212', light: '#f0f2f5', label: 'Háttér (Body)' },
        '--bg-surface':        { dark: '#1e1e1e', light: '#ffffff', label: 'Kártya Háttér' },
        '--bg-element':        { dark: '#333333', light: '#e0e0e0', label: 'Gomb/Input Háttér' },
        '--bg-button-glass':   { dark: 'rgba(255,255,255,0.1)', light: 'rgba(0,0,0,0.05)', label: 'Üveg Gomb' },
        '--text-main':         { dark: '#ffffff', light: '#1c1c1e', label: 'Fő Szöveg' },
        '--text-sub':          { dark: '#aaaaaa', light: '#666666', label: 'Másodlagos Szöveg' },
        '--border-color':      { dark: '#333333', light: '#d1d1d1', label: 'Keretek' },
        '--icon-color':        { dark: '#aaaaaa', light: '#666666', label: 'Ikonok' },
        '--icon-color-active': { dark: '#ffffff', light: '#000000', label: 'Aktív Ikon' },
        
        // --- UI AKTÍV ÁLLAPOTOK (Floor Selector, Switchek) ---
        '--color-ui-active':   { dark: '#d0bcff', light: '#6200ee', label: 'Aktív Gomb/Switch' },
        '--color-ui-active-text': { dark: '#381e72', light: '#ffffff', label: 'Aktív Gomb Szöveg' },

        // --- TÉRKÉP ELEMEK (Szobák & Falak) ---
        '--color-room':        { dark: '#00897b', light: '#00897b', label: 'Szoba Kitöltés' },
        '--color-room-stroke': { dark: '#00897b', light: '#00695c', label: 'Szoba Körvonal' }, // ÚJ
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
            samples: ['#d0bcff', '#00897b', '#ff1744'],
            overrides: { 
                dark: {}, 
                light: {
                    '--bg-body': '#0066ff',
                    '--bg-surface': '#ffffff',
                    '--bg-element': '#e0e0e0',
                    '--bg-button-glass': '#000000',
                    '--text-main': '#1c1c1e',
                    '--text-sub': '#666666',
                    '--border-color': '#d1d1d1',
                    '--icon-color': '#666666',
                    '--icon-color-active': '#000000',
                    '--color-ui-active': 'rgba(144.8250257743968, 102.68933898854078, 205.01886403990557, 1)',
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
        themeMode: localStorage.getItem('pref_theme') || 'dark', 
        activeColorTheme: localStorage.getItem('pref_color_theme') || 'default', // &lt;--- Mentjük ezt is
        cacheEnabled: localStorage.getItem('pref_cache_enabled') !== 'false' // Default true
    };
    
    // TILE LAYERS
    const TILE_LAYERS = {
        dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png' 
    };
    let currentTileLayer = null;

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
        'shop': 'Bolt'
    };

    // === CACHE SYSTEM (F-015) ===
    const CACHE_PREFIX = "bmemap_data_";
    const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 1 hétig érvényes

    function toggleCacheMode(isEnabled) {
        APP_SETTINGS.cacheEnabled = isEnabled;
        localStorage.setItem('pref_cache_enabled', isEnabled);
        
        if (!isEnabled) {
            // Ha kikapcsolja, opcionálisan törölhetnénk is, de inkább csak nem mentünk újat.
            // De a user elvárása lehet, hogy "ne foglalj helyet".
            // Maradjunk annyiban: csak a mentést tiltjuk, a törlésre ott a gomb.
            showToast("Cache kikapcsolva. Nem mentünk új adatot.");
        } else {
            showToast("Cache bekapcsolva. 💾");
        }
    }

    function getCacheSize() {
        let totalBytes = 0;
        for (let key in localStorage) {
            if (key.startsWith(CACHE_PREFIX)) {
                const item = localStorage.getItem(key);
                if (item) totalBytes += item.length * 2; // UTF-16 char ~ 2 bytes
            }
        }
        return totalBytes;
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function updateCacheSizeDisplay() {
        const el = document.getElementById('cache-size-display');
        if (el) {
            const size = getCacheSize();
            el.innerText = `A gyorsítótár jelenlegi mérete: ${formatBytes(size)}`;
        }
    }

    function clearAllCache() {
        if(!confirm("Biztosan törlöd a mentett térképeket?")) return;
        
        const keysToRemove = [];
        for (let key in localStorage) {
            if (key.startsWith(CACHE_PREFIX)) {
                keysToRemove.push(key);
            }
        }
        
        keysToRemove.forEach(k => localStorage.removeItem(k));
        updateCacheSizeDisplay();
        showToast("Sikeres nagytakarítás! 🧹");
    }

    function saveToCache(buildingKey, data) {
        // HA KI VAN KAPCSOLVA, AKKOR NE MENTSÜNK SEMMIT!
        if (!APP_SETTINGS.cacheEnabled) return;

        try {
            const cacheItem = {
                timestamp: Date.now(),
                data: data
            };
            localStorage.setItem(CACHE_PREFIX + buildingKey, JSON.stringify(cacheItem));
            console.log(`Cache saved for ${buildingKey}`);
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

    function loadFromCache(buildingKey) {
        // Ha ki van kapcsolva, akkor úgy teszünk, mintha nem lenne adat -> Network load
        if (!APP_SETTINGS.cacheEnabled) {
            console.log("Cache disabled by user settings.");
            return null;
        }

        const raw = localStorage.getItem(CACHE_PREFIX + buildingKey);
        if (!raw) return null;

        try {
            const item = JSON.parse(raw);
            if (Date.now() - item.timestamp > CACHE_EXPIRY_MS) {
                console.log("Cache expired for", buildingKey);
                localStorage.removeItem(CACHE_PREFIX + buildingKey);
                updateCacheSizeDisplay();
                return null;
            }
            console.log(`Loaded ${buildingKey} from cache!`);
            return item.data;
        } catch (e) {
            return null;
        }
    }

    function cleanupCache() {
        // Töröljük a legrégebbi elemeket, hogy helyet csináljunk
        const items = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(CACHE_PREFIX)) {
                try {
                    const item = JSON.parse(localStorage.getItem(key));
                    items.push({ key: key, ts: item.timestamp });
                } catch(e) {}
            }
        }
        // Időrendben sorba rendezzük (legrégebbi elöl)
        items.sort((a, b) => a.ts - b.ts);
        
        // Töröljük a felét
        items.slice(0, Math.ceil(items.length / 2)).forEach(item => {
            localStorage.removeItem(item.key);
        });
    }

    // === FAVORITES SYSTEM ===
    let userFavorites = JSON.parse(localStorage.getItem('bme_favorites')) || [];

    function saveFavorites() {
        localStorage.setItem('bme_favorites', JSON.stringify(userFavorites));
    }

    function isFavorite(feature) {
        if (!feature || !feature.id) return false;
        return userFavorites.some(fav => fav.id === feature.id);
    }

    // KEDVENCEK
    function toggleFavoriteCurrent() {
        if (!selectedFeature) return;
        
        const id = selectedFeature.id; 
        const p = selectedFeature.properties;
        let name = p.name || p.ref;
        // Ha nincs neve, akkor a típusát használjuk (pl. "Férfi mosdó")
        if (!name) {
            name = (typeof getHungarianType === 'function') ? getHungarianType(p) : "Névtelen hely";
        }
        const type = p.room || p.indoor || p.amenity || 'Hely';
        const level = getLevelsFromFeature(selectedFeature)[0] || "0";

        if (isFavorite(selectedFeature)) {
            // Törlés
            userFavorites = userFavorites.filter(fav => fav.id !== id);
            // Nincs showToast hívás!
        } else {
            // Hozzáadás
            userFavorites.push({ 
                id: id, 
                name: name, 
                type: type, 
                level: level,
                building: currentBuildingKey 
            });
            showToast("Hozzáadva a kedvencekhez! ⭐");
        }
        
        saveFavorites();
        updateFavoriteUI(); 
        renderLevel(currentLevel); 
    }

    function updateFavoriteUI() {
        const btn = document.getElementById('btn-favorite');
        if (!selectedFeature) return;
        
        if (isFavorite(selectedFeature)) {
            btn.classList.add('active');
            btn.querySelector('span').innerText = 'star'; // Teli csillag (ha a font támogatja a fill-t)
        } else {
            btn.classList.remove('active');
            btn.querySelector('span').innerText = 'star'; // Üres csillag
        }
    }

    function showFavoritesInSearch() {
        const input = document.getElementById('search-input');
        if (input.value.trim() !== "") return; // Ha már írt valamit, ne zavarjuk
        
        const resultsDiv = document.getElementById('search-results');
        resultsDiv.innerHTML = '';
        
        if (userFavorites.length === 0) return; // Nincs kedvenc, nincs lista

        // Fejléc
        const header = document.createElement('div');
        header.className = 'result-item';
        header.style.color = '#aaa'; 
        header.style.cursor = 'default';
        header.style.fontSize = '12px';
        header.innerText = "KEDVENCEK";
        resultsDiv.appendChild(header);

        userFavorites.forEach(fav => {
            const div = document.createElement('div');
            div.className = 'result-item';
            div.innerHTML = `<span class="material-symbols-outlined fav-icon" style="color:#ffd700">star</span> ${fav.name} <span style="color:#888; font-size:12px">(${fav.building} épület, ${fav.level}. szint)</span>`;
            
            div.onclick = () => {
                // Ha másik épületben van
                if (fav.building !== currentBuildingKey) {
                    changeBuilding(fav.building);
                    // Kis hack: várni kell a betöltésre, majd megkeresni ID alapján
                    // Ezt most egyszerűsítjük: átváltunk, és a usernek kell megkeresnie? 
                    // NEM, profik vagyunk: ID alapú keresés a loadOsmData végén?
                    // Ezt a Deep Link logika már tudja! Használjuk azt!
                    // De most egyszerűsítsünk: Csak váltsunk épületet, ha kell.
                    setTimeout(() => {
                         // Itt kéne megkeresni az ID-t az új tömbben...
                         // Ez aszinkron pokol lehet, egyelőre maradjunk azonos épületnél vagy figyelmeztessünk.
                    }, 1000);
                }
                
                // Ha azonos épület (vagy már betöltött)
                const target = geoJsonData.features.find(f => f.id === fav.id);
                if (target) {
                    zoomToFeature(target);
                    openSheet(target);
                    resultsDiv.style.display = 'none';

                    document.getElementById('search-input').value = fav.name;

                    // --- B-003 FIX: Ikon frissítése ---
                    updateRightButtonState();

                } else {
                    // Ha azonos épület de nem találja (ritka)
                    alert("Ez a hely ebben az épületben nem található (vagy még nem töltött be).");
                }
            };
            resultsDiv.appendChild(div);
        });
        resultsDiv.style.display = 'block';
    }

    function getHungarianType(p) {
        // Megnézzük a releváns tageket
        const key = p.room || p.indoor || p.amenity || p.highway || 'unknown';
        return TYPE_DICT[key] || (key !== 'unknown' ? key : 'Hely');
    }

    // UI Szövegek
    const HINTS = {
        'stairs': "Csak akkor lift, ha nincs más út.",
        'balanced': "Rövid távon lépcső, emeletek között lift.",
        'elevator': "Lehetőleg mindig lift.",
        'wheelchair': "Kerekeszékkel járható útvonal."
    };

    let currentBuildingKey = "K"; 
    let currentBuilding = BUILDINGS[currentBuildingKey];
    let pendingNavSource = null;
    let pendingSearchTerm = null;

    let activeRouteData = null; // { start: feature/null, end: feature }
    let currentRoutePath = []; // Itt tároljuk a nyers útvonal kulcsokat

    // Itt tároljuk az aktív navigáció kezdő- és végpontját (feature objektumok)
    let activeNavSource = null;
    let activeNavTarget = null;

    // ÚJ: Erre kattintva odaugrik a térkép az induláshoz vagy érkezéshez
    function focusOnEndpoint(type) {
        // Kiválasztjuk a megfelelőt
        const target = (type === 'start') ? activeNavSource : activeNavTarget;
        
        if (target) {
            // 1. Szintváltás (Ha van szint infó)
            const levels = getLevelsFromFeature(target);
            if (levels.length > 0) {
                switchLevel(levels[0]);
            }
            
            // 2. Smart FlyTo (Oda viszi a kamerát)
            smartFlyTo(target);

            // 3. JAVÍTÁS: Célpont kijelölése (Highlight)
            // Csak akkor rajzolunk keretet, ha ez a CÉL állomás.
            // A Start pontnál (főleg ha virtuális pont) nem biztos, hogy akarunk highlightot,
            // vagy nincs is hozzá megfelelő geometria (pl. csak egy pont).
            if (type === 'end') {
                // Ez csak kirajzolja a sárga vonalat, NEM nyit sheetet, NEM lép ki.
                drawSelectedHighlight(target);
            }
        }
    }

    const PRECISION = 6; 
    const OVERPASS_SERVERS = [
        "https://overpass-api.de/api/interpreter",           // A hivatalos, legstabilabb (néha rate-limitel)
        "https://overpass.kumi.systems/api/interpreter",     // Stabil svájci/német szerver
        "https://overpass.private.coffee/api/interpreter",   // Nem túl jó szerver de elvileg kéne működnie
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter" // A haldokló szerver a legvégére fallbacknek
    ];

    // Zoom control nélkül, testreszabott attribution-nel és SMOOTH ZOOM beállításokkal
    const map = L.map('map', { 
        zoomControl: false, 
        attributionControl: false,
        // --- F-014: SMOOTH ZOOM BEÁLLÍTÁSOK ---
        zoomSnap: 0,       // Engedi a tört zoom szinteket (pl. 18.5)
        zoomDelta: 0.1,    // Finomabb lépések
        wheelPxPerZoomLevel: 120 // Egér görgő finomítása (opcionális)
    }).setView(currentBuilding.center, currentBuilding.zoom);

    // --- ÚJ: NAGY TELJESÍTMÉNYŰ RENDERER (B-007 Fix) ---
    // A padding: 2 azt jelenti, hogy a látható területen kívül még 
    // +2 képernyőnyi területet előre kirajzol SVG-ben.
    const smoothRenderer = L.svg({ padding: 2.0 });

    // Saját, rövidebb copyright a jobb alsó sarokba
    L.control.attribution({
    }).addAttribution('&copy; OSM contributors').addTo(map);

    // A map létrehozása után add hozzá ezt az eseményfigyelőt:
    map.on('zoomend', function() {
        updateLabelsVisibility();       // Címkék (korábbi funkció)
        updateDynamicVisibility();      // ÚJ: Ikonok/Ajtók
    });

    function updateDynamicVisibility() {
        const zoom = map.getZoom();
        const width = window.innerWidth;
        const mapContainer = map.getContainer(); // A <div id="map">

        // Reseteljük az osztályokat
        mapContainer.classList.remove('map-container-mid', 'map-container-low');

        // MOBIL NÉZET (< 600px) - Szigorúbb határok
        if (width < 600) {
            if (zoom < 19) {
                // Távoli: Minden rejtve (Hamarabb tűnik el!)
                mapContainer.classList.add('map-container-low');
            } else if (zoom >= 19 && zoom < 21) {
                // Közepes: Kicsi ikonok
                mapContainer.classList.add('map-container-mid');
            }
            // 21+: Normál
        } 
        // ASZTALI NÉZET (>= 600px)
        else {
            if (zoom < 18.5) {
                // Távoli: Minden rejtve (Sokkal hamarabb, mint eddig!)
                mapContainer.classList.add('map-container-low');
            } else if (zoom >= 18.5 && zoom < 20.5) {
                // Közepes
                mapContainer.classList.add('map-container-mid');
            }
            // 20.5+: Normál (Csak nagyon közelről nagy)
        }
        
        // Címkék frissítése (Ez a másik réteg)
        updateLabelsVisibility();
    }

    function updateLabelsVisibility() {
        const currentZoom = map.getZoom();
        const width = window.innerWidth;
        
        // Mobilon 20, Asztalin 19 a határ a feliratoknak
        const limit = width < 600 ? 20 : 19;
        
        if (currentZoom >= limit) {
            if (labelLayerGroup.getLayers().length === 0) {
                drawLabels(currentLevel);
            }
        } else {
            labelLayerGroup.clearLayers();
        }
    }

    map.createPane('floorPane'); map.getPane('floorPane').style.zIndex = 200;
    map.createPane('labelPane'); map.getPane('labelPane').style.zIndex = 450; // Z-Index: Legyen a szobák felett, de a navigáció/ikonok alatt
    map.createPane('routePane'); map.getPane('routePane').style.zIndex = 650; 
    map.createPane('highlightPane'); map.getPane('highlightPane').style.zIndex = 640;
    map.createPane('arrowPane'); map.getPane('arrowPane').style.zIndex = 660; // A Z-indexe legyen a vonal fölött, de a markerek alatt
    map.createPane('navMarkerPane'); map.getPane('navMarkerPane').style.zIndex = 700; // A legfelső réteg a navigációs ikonoknak

    let indoorLayerGroup = L.layerGroup().addTo(map);
    let iconLayerGroup = L.layerGroup().addTo(map);
    let routeLayerGroup = L.layerGroup().addTo(map);
    let routeMarkersLayerGroup = L.layerGroup().addTo(map);
    let routeArrowsLayerGroup = L.layerGroup().addTo(map);
    let highlightLayerGroup = L.layerGroup().addTo(map); 
    let selectedHighlightLayer = L.layerGroup().addTo(map);
    let labelLayerGroup = L.layerGroup().addTo(map);

    let currentLevel = "0";
    let availableLevels = [];
    let levelAliases = {}; // (Szintszám -> Megjelenített Név)
    let geoJsonData = null;
    let selectedFeature = null;
    let navigationGraph = new Map();
    let mainEntranceNode = null;
    let doorNodes = new Set(); 

    // === SETTINGS UI HANDLERS ===
    function toggleSettings() {
        const modal = document.getElementById('settings-modal');
        modal.classList.toggle('visible');
        updateSettingsUI();
    }

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

        // 3. UI Osztályok és Tile Layer (Marad a régi logika)
        if (mode === 'light') {
            document.body.classList.add('light-mode');
            document.getElementById('theme-shame-msg').classList.add('visible');
        } else {
            document.body.classList.remove('light-mode');
            document.getElementById('theme-shame-msg').classList.remove('visible');
        }

        const newUrl = (mode === 'light') ? TILE_LAYERS.light : TILE_LAYERS.dark;

        // OPTIMALIZÁLT TILE LAYER BEÁLLÍTÁSOK
        const tileOptions = { 
            attribution: '&copy; OSM contributors', 
            maxZoom: 22,
            keepBuffer: 25,       // Sokkal több csempét tart a memóriában (B-007)
            updateWhenIdle: false // Azonnal tölt, nem csak megálláskor
        };

        if (currentTileLayer && currentTileLayer._url !== newUrl) {
            map.removeLayer(currentTileLayer);
            currentTileLayer = L.tileLayer(newUrl, tileOptions).addTo(map);
            currentTileLayer.bringToBack();
        } else if (!currentTileLayer) {
            currentTileLayer = L.tileLayer(newUrl, tileOptions).addTo(map);
            currentTileLayer.bringToBack();
        }

        updateSettingsUI();
        localStorage.setItem('pref_theme', APP_SETTINGS.themeMode);
        localStorage.setItem('pref_color_theme', APP_SETTINGS.activeColorTheme);
    }

    function updateSettingsUI() {
        // Gombok állapotának frissítése
        document.querySelectorAll('#seg-elevator .seg-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.val === APP_SETTINGS.elevatorMode);
        });
        document.querySelectorAll('#seg-toilet .seg-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.val === APP_SETTINGS.toiletMode);
        });
        
        // Theme gombok frissítése
        document.querySelectorAll('#seg-theme .seg-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.val === APP_SETTINGS.themeMode);
        });
        document.getElementById('elevator-hint').innerText = HINTS[APP_SETTINGS.elevatorMode];

        // --- F-016: CACHE UI UPDATE ---
        const cacheSwitch = document.getElementById('cache-switch');
        if (cacheSwitch) {
            cacheSwitch.checked = APP_SETTINGS.cacheEnabled;
            updateCacheSizeDisplay(); // Frissítjük a méretet is
        }
    }

    function setThemeMode(mode) {
        APP_SETTINGS.themeMode = mode;
        applyTheme();
    }
    
    function setColorTheme(key) {
        APP_SETTINGS.activeColorTheme = key;
        applyTheme();
        renderLevel(currentLevel); // Színek miatt újra kell rajzolni
        renderThemeSelector(); // UI frissítés
    }

    // DINAMIKUS TÉMA LISTA GENERÁTOR
    function renderThemeSelector() {
        const container = document.getElementById('color-theme-list');
        if (!container) return;
        container.innerHTML = '';
        
        const currentTheme = APP_SETTINGS.activeColorTheme;

        for (const [key, data] of Object.entries(COLOR_THEMES)) {
            const div = document.createElement('div');
            
            // --- ITT A JAVÍTÁS: .selected osztály hozzáadása ---
            const isSelected = (key === currentTheme);
            div.className = 'theme-option' + (isSelected ? ' selected' : '');
            
            div.dataset.key = key;
            div.onclick = () => setColorTheme(key);
            
            // Pöttyök generálása
            let dotsHtml = '';
            // Ha van samples, használjuk, ha nincs, vegyük az első 3 színt a definícióból
            const colors = data.samples || Object.values(data.colors || {}).slice(0,3);
            
            colors.forEach(color => {
                dotsHtml += `<div class="dot" style="background: ${color}"></div>`;
            });
            
            div.innerHTML = `
                <span class="theme-name">${data.name}</span>
                <div class="color-dots">${dotsHtml}</div>
            `;
            container.appendChild(div);
        }
    }

    // === TÉMASZERKESZTŐ LOGIKA & COLOR PICKER MOTOR ===

    let activePickrs = []; // Tároljuk a picker példányokat, hogy takarítani tudjunk

    function openThemeEditor() {
        const modal = document.getElementById('settings-modal');
        const viewMain = document.getElementById('settings-view-main');
        const viewEditor = document.getElementById('settings-view-editor');
        
        // 1. ELŐKÉSZÍTÉS (Még mielőtt bármit renderelnénk)
        // Azonnal ráadjuk az osztályt, így a böngésző már az új stílusokkal számol
        modal.classList.add('editor-mode'); 
        
        // Nézet váltás (még a háttérben)
        viewMain.style.display = 'none';
        viewEditor.style.display = 'flex'; 
        
        // Ha a modal esetleg nem volt látható (pl. külső hívás), most jelenítjük meg
        // De mivel a settingsből nyitottuk, már látható, csak átalakul.
        if (!modal.classList.contains('visible')) {
            modal.classList.add('visible');
        }

        const mode = APP_SETTINGS.themeMode;
        const themeKey = APP_SETTINGS.activeColorTheme;
        const themeName = (COLOR_THEMES[themeKey] || COLOR_THEMES['default']).name;

        // --- ÚJ HTML STRUKTÚRA ---
        let html = `
            <div class="editor-header">
                <h3>${themeName} (${mode === 'dark' ? 'Sötét' : 'Világos'})</h3>
                
                <div class="editor-header-actions">
                    <button class="btn-header-icon primary" onclick="copyThemeCode()" title="Téma kód másolása">
                        <span class="material-symbols-outlined">content_copy</span>
                    </button>
                    <button class="btn-header-icon danger" onclick="resetThemeOverrides()" title="Alaphelyzet">
                        <span class="material-symbols-outlined">restart_alt</span>
                    </button>
                </div>
            </div>
            
            <div class="editor-scroll-area">
        `;

        for (const [varName, data] of Object.entries(THEME_VARS)) {
            html += `
                <div class="editor-row" onclick="focusOnElement('${varName}')">
                    <div class="editor-label">
                        <span>${data.label || varName}</span>
                        <small>${varName}</small>
                    </div>
                    <div class="editor-input-group">
                        <div class="color-picker-container" id="picker-${varName.replace('--', '')}"></div>
                    </div>
                </div>
            `;
        }

        // TISZTA FOOTER: Csak Mégse és Mentés
        html += `</div> 
        
        <div class="editor-footer">
            <div class="editor-actions">
                <button class="btn-cancel" onclick="closeThemeEditor()">Mégse</button>
                <button class="btn-save" onclick="saveThemeOverrides()">Mentés</button>
            </div>
        </div>`;

        viewEditor.innerHTML = html;

        // PICKR PÉLDÁNYOSÍTÁS (Változatlan)
        setTimeout(() => {
            activePickrs = [];
            for (const [varName, data] of Object.entries(THEME_VARS)) {
                const currentValue = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
                const containerId = `#picker-${varName.replace('--', '')}`;
                
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

                    if (varName === '--color-highlight') {
                        selectedHighlightLayer.eachLayer(l => {
                            if (l.feature) drawSelectedHighlight(l.feature);
                        });
                    }
                });
                
                pickr.on('show', () => focusOnElement(varName));
                activePickrs.push(pickr);
            }
        }, 50);
    }

    function closeThemeEditor(saved = false) {
        const modal = document.getElementById('settings-modal');
        const viewMain = document.getElementById('settings-view-main');
        const viewEditor = document.getElementById('settings-view-editor');
        
        // 1. PICKR TAKARÍTÁS (Ez gyors)
        activePickrs.forEach(p => p.destroyAndRemove());
        activePickrs = [];

        // 2. VISSZAVÁLTÁS LOGIKA
        // Először levesszük az editor módot, hogy visszauorjon középre a kártya
        modal.classList.remove('editor-mode');
        
        // Aztán cseréljük a tartalmat
        viewEditor.style.display = 'none';
        viewMain.style.display = 'flex';
        
        // Kijelölés törlése (ha csak a preview miatt volt)
        // De csak akkor, ha nem volt eleve kiválasztva valami a főképernyőn!
        // Egyszerűsítés: Ha nem mentettünk, visszatöltjük a témát.
        if (!saved) {
            applyTheme(); 
            renderLevel(currentLevel);
        }
        
        // Ha highlight preview volt, azt állítsuk vissza a normál selectedFeature-re (ha van)
        if (selectedFeature) {
            drawSelectedHighlight(selectedFeature);
        } else {
            selectedHighlightLayer.clearLayers();
        }
    }

    function saveThemeOverrides() {
        const mode = APP_SETTINGS.themeMode;
        const themeKey = APP_SETTINGS.activeColorTheme;
        
        if (!CUSTOM_THEME_OVERRIDES[themeKey]) CUSTOM_THEME_OVERRIDES[themeKey] = {};
        if (!CUSTOM_THEME_OVERRIDES[themeKey][mode]) CUSTOM_THEME_OVERRIDES[themeKey][mode] = {};

        // Végigmegyünk a változókon és elmentjük a jelenlegi (live preview-olt) értéket
        for (const varName of Object.keys(THEME_VARS)) {
            const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            CUSTOM_THEME_OVERRIDES[themeKey][mode][varName] = val;
        }

        localStorage.setItem('custom_theme_overrides', JSON.stringify(CUSTOM_THEME_OVERRIDES));
        
        renderLevel(currentLevel); // Renderelés a biztonság kedvéért
        closeThemeEditor(true); // TRUE = Mentettünk, nem kell revert
    }

    function copyThemeCode() {
        const mode = APP_SETTINGS.themeMode; // 'dark' vagy 'light'
        const themeName = (COLOR_THEMES[APP_SETTINGS.activeColorTheme] || {}).name || "Custom";
        
        // 1. Megnézzük, mi változott az ALAPÉRTELMEZETT (THEME_VARS) értékekhez képest
        let changes = [];
        
        for (const [varName, data] of Object.entries(THEME_VARS)) {
            // A jelenlegi (számított/beállított) érték
            const currentVal = getComputedStyle(document.documentElement).getPropertyValue(varName).trim().toLowerCase();
            
            // Az eredeti, gyári alapértelmezett érték (a kódból)
            // Figyelem: A THEME_VARS-ban lévő értékek lehetnek nagybetűsek is, normalizáljuk kicsire a hasonlításhoz!
            const defaultVal = data[mode].trim().toLowerCase();
            
            // Ha különbözik, akkor ez egy override, amit menteni kell
            if (currentVal !== defaultVal) {
                // Az eredeti (nem kisbetűsített) current értéket mentjük el, hogy szép legyen
                const originalCurrentVal = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
                changes.push(`    '${varName}': '${originalCurrentVal}'`);
            }
        }

        if (changes.length === 0) {
            alert("Nincs mit másolni: Minden érték megegyezik az alapértelmezettel!");
            return;
        }

        // 2. Kód generálása
        let output = `// ${themeName} (${mode} mód) override-ok:\n`;
        output += `${mode}: {\n`;
        output += changes.join(',\n');
        output += `\n}`;

        // 3. Vágólapra másolás
        navigator.clipboard.writeText(output).then(() => {
            alert("Téma kód (csak a változtatások) másolva! 📋");
        }).catch(err => {
            console.error(err);
            prompt("Másold ki innen:", output);
        });
    }

    function resetThemeOverrides() {
        if (!confirm('Biztos visszaállítod az eredeti színeket ennél a témánál?')) return;
        
        const mode = APP_SETTINGS.themeMode;
        const themeKey = APP_SETTINGS.activeColorTheme;

        if (CUSTOM_THEME_OVERRIDES[themeKey] && CUSTOM_THEME_OVERRIDES[themeKey][mode]) {
            delete CUSTOM_THEME_OVERRIDES[themeKey][mode];
            localStorage.setItem('custom_theme_overrides', JSON.stringify(CUSTOM_THEME_OVERRIDES));
        }
        
        // Visszaállítás és bezárás
        applyTheme(); 
        renderLevel(currentLevel);
        closeThemeEditor(true); // Bezárjuk és mentettnek tekintjük (resetelt állapot)
    }

    // === INTELLIGENS FÓKUSZ ÉS ZOOM ===
    function focusOnElement(varName) {
        if (!geoJsonData || !geoJsonData.features) return;

        // 1. Meghatározzuk, mit keresünk a változónév alapján (B-008 Fix)
        let filterFn = null;

        // WC: Bővített szűrés (amenity is játszik)
        if (varName.includes('toilet')) {
            filterFn = f => {
                const p = f.properties;
                return p.room === 'toilet' || p.room === 'toilets' || p.room === 'wc' || p.amenity === 'toilets';
            };
        }
        // Lépcső
        else if (varName.includes('stairs')) {
            filterFn = f => {
                const p = f.properties;
                return p.room === 'stairs' || p.indoor === 'staircase' || p.highway === 'steps';
            };
        }
        // Lift
        else if (varName.includes('elevator')) {
            filterFn = f => {
                const p = f.properties;
                return p.room === 'elevator' || p.highway === 'elevator';
            };
        }
        // Folyosó
        else if (varName.includes('corridor')) {
            filterFn = f => f.properties.indoor === 'corridor' || f.properties.highway === 'corridor';
        }
        // Ajtó
        else if (varName.includes('door')) {
            filterFn = f => f.properties.door || f.properties.entrance;
        }
        // Szoba (Kizárásos alapon: ami nem technikai helyiség, de van neve vagy indoor=room)
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
        // Highlight (Kivétel: Itt direkt keresünk valamit, hogy rátegyük a highlightot)
        else if (varName.includes('highlight')) {
             filterFn = f => f.properties.indoor === 'room';
        }

        // Ha nincs specifikus elem (pl. háttérszín), nem csinálunk semmit
        if (!filterFn) return;

        // 2. Keresünk egy ILYEN elemet a JELENLEGI szinten
        let target = geoJsonData.features.find(f => getLevelsFromFeature(f).includes(currentLevel) && filterFn(f));
        
        // Ha a jelenlegi szinten nincs, keresünk bárhol az épületben
        if (!target) {
            target = geoJsonData.features.find(f => filterFn(f));
        }

        if (target) {
            // 3. Smart FlyTo (Ez viszi oda a kamerát úgy, hogy ne takarja ki az editor)
            smartFlyTo(target);

            // 4. KIJELÖLÉS KEZELÉSE (B-008 Lényeg)
            // CSAK akkor rajzolunk highlightot, ha KONKRÉTAN a highlight színét állítjuk!
            // Minden más esetben (fal, kitöltés, stroke) zavaró lenne, ezért levesszük.
            if (varName.includes('highlight')) {
                drawSelectedHighlight(target);
            } else {
                // Tiszta vizet a pohárba: töröljük a kijelölést, hogy lásd a színeket
                selectedHighlightLayer.clearLayers();
            }
        }
    }

    // LIVE PREVIEW: Azonnal frissíti a CSS változót
    function handleColorChange(varName, value) {
        document.documentElement.style.setProperty(varName, value);
        // Hex kód frissítése
        event.target.nextElementSibling.innerText = value;
        // Ha valami drasztikusat (pl szoba szín) változtatunk, újra kell rajzolni a réteget
        // De csak óvatosan, mert lassíthatja a dragginget.
        // A CSS változók (háttér, gombok) azonnaliak, de a canvas/SVG alapú dolgokhoz (room fill) kellhet a render.
        // renderLevel(currentLevel); // Ezt inkább hagyjuk a mentésre, vagy ha nagyon kell, debounce-al.
    }

    function setElevatorMode(mode) {
        APP_SETTINGS.elevatorMode = mode;
        updateSettingsUI();
        // Gráf újraépítése az új súlyokkal!
        buildRoutingGraph(); 
    }

    function setToiletMode(mode) {
        APP_SETTINGS.toiletMode = mode;
        updateSettingsUI();
    }

    function resetSettings() {
        APP_SETTINGS.elevatorMode = 'balanced';
        APP_SETTINGS.toiletMode = 'all';
        updateSettingsUI();
        buildRoutingGraph();
        toggleSettings(); // Bezárás
    }

    function toggleImpressum() {
        // Ha a settings nyitva van, csukjuk be
        document.getElementById('settings-modal').classList.remove('visible');
        
        const modal = document.getElementById('impressum-modal');
        modal.classList.toggle('visible');
    }

    // === GPS ALAPÚ ÉPÜLET VÁLASZTÓ (MOBILON) ===
    function detectClosestBuilding() {
        // 1. Csak mobilon fusson
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        if (!isMobile) return;

        // 2. Ha Deep Link (Megosztás) van, NE írjuk felül GPS-el!
        const params = new URLSearchParams(window.location.search);
        if (params.get('share')) return;

        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((position) => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;
                const userPoint = turf.point([userLon, userLat]);

                let closestKey = null;
                let minDist = Infinity;

                // Távolságok ellenőrzése minden épülethez
                for (const [key, data] of Object.entries(BUILDINGS)) {
                    // A BUILDINGS-ben [lat, lon] van, a Turf [lon, lat]-ot vár!
                    const bPoint = turf.point([data.center[1], data.center[0]]);
                    const dist = turf.distance(userPoint, bPoint, { units: 'kilometers' }) * 1000; // méterben

                    if (dist < minDist) {
                        minDist = dist;
                        closestKey = key;
                    }
                }

                // 3. Váltás logika
                // Csak akkor váltunk, ha:
                // - Találtunk épületet
                // - Nem az, ami most be van töltve
                // - És 1000 méteren belül vagyunk (ne váltson át, ha otthonról nézed)
                if (closestKey && closestKey !== currentBuildingKey && minDist < 1000) {
                    console.log(`GPS: ${closestKey} épület észlelve (${Math.round(minDist)}m). Váltás...`);
                    showToast(`📍 GPS: ${BUILDINGS[closestKey].name} észlelve. Betöltés...`);
                    changeBuilding(closestKey);
                }

            }, (error) => {
                console.warn("GPS hiba vagy elutasítva:", error.message);
            }, {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 60000
            });
        }
    }

    function initBuildings() {
        const optionsDiv = document.getElementById('building-options');
        optionsDiv.innerHTML = "";
        
        for (const [key, data] of Object.entries(BUILDINGS)) {
            const div = document.createElement('div');
            div.className = 'option' + (key === currentBuildingKey ? ' selected' : '');
            div.innerHTML = `<span class="material-symbols-outlined">apartment</span> ${data.name}`;
            div.onclick = () => {
                changeBuilding(key);
                toggleBuildingMenu();
            };
            optionsDiv.appendChild(div);
        }
        document.getElementById('current-building-name').innerText = BUILDINGS[currentBuildingKey].name;
    }
    
    document.addEventListener('click', function(event) {
        const select = document.querySelector('.custom-select');
        if (!select.contains(event.target)) {
            document.getElementById('building-options').classList.remove('show');
        }
    });

    function toggleBuildingMenu() {
        document.getElementById('building-options').classList.toggle('show');
    }

    function changeBuilding(key, autoSearchTerm = null) {
        if (!BUILDINGS[key]) return;
        currentBuildingKey = key;
        currentBuilding = BUILDINGS[key];
        
        if (autoSearchTerm) pendingSearchTerm = autoSearchTerm;

        geoJsonData = null;
        indoorLayerGroup.clearLayers();
        iconLayerGroup.clearLayers();
        routeLayerGroup.clearLayers();
        highlightLayerGroup.clearLayers();
        selectedHighlightLayer.clearLayers();
        pendingNavSource = null;

        document.getElementById('search-input').value = "";

        // --- B-003 FIX: Ikon visszaállítása alaphelyzetbe (Tune) ---
        updateRightButtonState();
        
        initBuildings(); 
        // --- MÓDOSÍTÁS: Előbb hívjuk a loadert/betöltést, aztán a nézetet ---
        // Így a loader már kint lesz, ha esetleg a setView megakadna (bár a fenti fix miatt nem fog).
        loadOsmData(); 
        
        // A setView mehet a végére, vagy maradhat itt, most már mindegy.
        map.setView(currentBuilding.center, currentBuilding.zoom);
    }

    function showModal(title, text, confirmCallback) {
        document.getElementById('modal-title').innerText = title;
        document.getElementById('modal-text').innerText = text;
        const confirmBtn = document.getElementById('modal-confirm');
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        newBtn.onclick = () => { closeModal(); confirmCallback(); };
        document.getElementById('custom-modal').classList.add('visible');
    }
    function closeModal() { document.getElementById('custom-modal').classList.remove('visible'); }

    function toKey(lat, lon, level) { return `${parseFloat(lat).toFixed(PRECISION)},${parseFloat(lon).toFixed(PRECISION)},${level}`; }

    function getLevelsFromFeature(feature) {
        if (!feature || !feature.properties || !feature.properties.level) return [];
        
        const raw = feature.properties.level.toString();
        // Minden elválasztót pontosvesszőre cserélünk, aztán darabolunk
        const parts = raw.replace(/,/g, ';').split(';');
        
        let levels = new Set();
        
        parts.forEach(part => {
            part = part.trim();
            if (!part) return;

            // 1. TARTOMÁNY DETEKTÁLÁS (pl. "0-2" vagy "-1-1")
            // Regex: (szám) - (szám)
            const rangeMatch = part.match(/^(-?\d+)\s*-\s*(-?\d+)$/);

            if (rangeMatch) {
                const min = parseInt(rangeMatch[1]);
                const max = parseInt(rangeMatch[2]);
                
                // Biztonsági fék: Csak ha valid számok és nem túl nagy a távolság (max 30 emelet)
                // Ez kiszűri a véletlen dátumokat vagy hülyeségeket
                if (!isNaN(min) && !isNaN(max) && Math.abs(max - min) < 30) {
                    for (let i = Math.min(min, max); i <= Math.max(min, max); i++) {
                        levels.add(i.toString());
                    }
                }
            } else {
                // 2. SIMA ÉRTÉK DETEKTÁLÁS (Szigorú Integers Only)
                // Ez kiszűri a "-0.5"-öt és a szöveges szemetet
                const num = Number(part);
                if (!isNaN(num) && Number.isInteger(num)) {
                     levels.add(num.toString());
                }
            }
        });
        
        return Array.from(levels).sort((a,b) => parseFloat(a) - parseFloat(b));
    }

    async function fetchOverpass(query, serverIndex = 0) {
        if (serverIndex >= OVERPASS_SERVERS.length) throw new Error("Minden szerver halott.");
        const server = OVERPASS_SERVERS[serverIndex];
        document.getElementById('loader-status').innerText = `Connecting to ${new URL(server).hostname}...`;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); 
            const response = await fetch(server, { method: "POST", body: query, signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`Status ${response.status}`);
            return await response.json();
        } catch (e) {
            console.warn(`Server ${server} failed. Trying next...`);
            return fetchOverpass(query, serverIndex + 1);
        }
    }

    // === ÚJ: ÉPÜLET KÖZÉPPONTRA IGAZÍTÁS ===
    function alignMapToBuildingCenter() {
        // Ha van megosztott link (share paraméter), akkor NE rángassuk a térképet, 
        // mert a processUrlParams majd odaviszi a kamerát a konkrét szobára.
        const params = new URLSearchParams(window.location.search);
        if (params.get('share')) return;

        if (!geoJsonData || !geoJsonData.features || geoJsonData.features.length === 0) return;

        try {
            // A teljes betöltött geometria befoglaló doboza (BBOX) [minX, minY, maxX, maxY]
            const bbox = turf.bbox(geoJsonData); 
            
            if (bbox) {
                // Kiszámoljuk a geometriai középpontot
                const centerLon = (bbox[0] + bbox[2]) / 2;
                const centerLat = (bbox[1] + bbox[3]) / 2;
                
                // Finom igazítás a valós középpontra
                // A panTo animálva viszi oda, ami szép visszajelzés, hogy "betöltöttem"
                map.panTo([centerLat, centerLon]);
                console.log("Map aligned to building center:", centerLat, centerLon);
            }
        } catch (e) {
            console.warn("Auto-align error:", e);
        }
    }


    // === B-009 FIX: RÉTEG SORRENDEZÉS (Z-INDEX) ===
    // Meghatározza, mi kerüljön alulra és mi felülre az SVG-ben.
    // Minél nagyobb a szám, annál feljebb lesz (kattinthatóbb).
    function getFeatureWeight(f) {
        const p = f.properties;
        
        // 1. SZINT: Háttér (Padló, Fal, Épület körvonal) - LEGALUL
        if (p.indoor === 'level' || p['building:part'] || p.indoor === 'wall') return 1;
        
        // 2. SZINT: Folyosó (Hogy a szobák "kiemelkedjenek" belőle)
        if (p.indoor === 'corridor' || p.highway === 'corridor') return 2;
        
        // 3. SZINT: Szobák / WC / Lépcső / Lift (A lényeg!)
        // Ez az alapértelmezett, ide esik minden névvel rendelkező hely is.
        
        // 4. SZINT: Ajtók / Bejáratok (Hogy mindig eltalálhatóak legyenek) - LEGFELÜL
        if (p.entrance || p.door) return 4;

        return 3; // Szobák alapértelmezett súlya
    }

    // Ez a függvény felel az OSM JSON -> Térkép konverzióért
    // Ez a függvény felel az adat -> Térkép konverzióért
    function processOsmData(osmData, isUpdate = false) {
        // 1. ÁLLAPOT MENTÉSE (B-010 Fix)
        const savedLevel = currentLevel;

        console.log("🛠️ processOsmData indítása... Adat típusa:", osmData ? (osmData.type || "Nyers OSM API adat") : "UNDEFINED!");

        // OKOS KONVERZIÓ:
        // Ha az adat már GeoJSON (mert a GitHub Action legyártotta nekünk)
        if (osmData && osmData.type === 'FeatureCollection') {
            console.log("✅ Kész GeoJSON-t kaptunk (Statikus fájl), kihagyjuk a konvertálást.");
            geoJsonData = osmData;
        } 
        // Ha nyers OSM adat (mert a fallback API-ról jött)
        else {
            console.log("⚙️ Nyers OSM adatot kaptunk (Fallback), osmtogeojson konvertálás indul...");
            geoJsonData = osmtogeojson(osmData);
        }
        
        // Z-Index rendezés (Padló alulra, szoba felülre)
        if (geoJsonData && geoJsonData.features) {
            geoJsonData.features.sort((a, b) => {
                return getFeatureWeight(a) - getFeatureWeight(b);
            });
        }

        processLevels(); 
        collectDoors(); 
        buildRoutingGraph(); 
        
        // 2. ÁLLAPOT VISSZATÖLTÉSE (B-010 Fix)
        if (availableLevels.includes(savedLevel)) {
            currentLevel = savedLevel;
        } else {
            if (!availableLevels.includes(currentLevel)) {
                currentLevel = availableLevels.includes('0') ? '0' : (availableLevels[0] || "0");
            }
        }

        renderLevel(currentLevel);
        createLevelControls();

        // Ha ez frissítés, nem rángatjuk a kamerát
        if (!isUpdate) {
            alignMapToBuildingCenter();
        }
        
        updateDynamicVisibility();
    }

    async function loadOsmData() {
        const loader = document.getElementById('loader');
        const buildingKey = currentBuildingKey;
        
        // 1. CACHE KEZELÉS (Azonnali megjelenítés)
        const cachedData = loadFromCache(buildingKey);
        let loadedFromCache = false;

        if (cachedData) {
            try {
                console.log("Rendering from cache...");
                processOsmData(cachedData, false);
                loader.style.display = 'none';
                loadedFromCache = true;
                
                if (pendingSearchTerm) {
                    setTimeout(() => {
                         if(pendingSearchTerm) {
                             document.getElementById('search-input').value = pendingSearchTerm;
                             handleSearch({ target: { value: pendingSearchTerm }, key: 'Enter' });
                             pendingSearchTerm = null;
                         }
                    }, 100);
                }
                processUrlParams();
            } catch (e) {
                console.error("Cache render failed:", e);
                localStorage.removeItem(CACHE_PREFIX + buildingKey);
            }
        } else {
            loader.style.display = 'block';
            document.getElementById('loader-status').innerText = "Betöltés...";
        }

        // 2. ELSŐDLEGES ADATFORRÁS: A GitHub Action által generált statikus fájl
        try {
            if (!loadedFromCache) document.getElementById('loader-status').innerText = "Térkép lekérése a szerverről...";
            
            // Fájl lekérése a data mappából
            const res = await fetch(`./data/${buildingKey.toLowerCase()}_epulet.json`);
            if (!res.ok) throw new Error("Statikus fájl nem található (HTTP " + res.status + ")");
            
            const newData = await res.json();
            const isDataNew = !cachedData || JSON.stringify(cachedData) !== JSON.stringify(newData);

            if (isDataNew) {
                console.log("Új statikus adat érkezett, frissítés...");
                processOsmData(newData, loadedFromCache);
                saveToCache(buildingKey, newData);
            } else {
                console.log("A statikus adat up-to-date.");
            }

            if (!loadedFromCache) {
                loader.style.display = 'none';
                if (pendingSearchTerm) {
                    document.getElementById('search-input').value = pendingSearchTerm;
                    handleSearch({ target: { value: pendingSearchTerm }, key: 'Enter' });
                    pendingSearchTerm = null;
                }
                processUrlParams();
            }
            
            return; // Ha idáig eljutottunk, minden szuper, kilépünk a függvényből!

        } catch (localError) {
            console.warn("⚠️ Hiba a statikus fájl betöltésekor, indul a FALLBACK az Overpass API-ra!", localError);
            if (!loadedFromCache) document.getElementById('loader-status').innerText = "Fallback API csatlakozás...";
        }

        // 3. FALLBACK: Ha a statikus fájl nincs meg, kérdezzük le élőben az Overpass-tól
        const radius = 250;
        const center = currentBuilding.center;
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
            const osmData = await fetchOverpass(query);
            const isDataNew = !cachedData || JSON.stringify(cachedData) !== JSON.stringify(osmData);

            if (isDataNew) {
                console.log("Új élő adat érkezett (Fallback), frissítés...");
                processOsmData(osmData, loadedFromCache);
                saveToCache(buildingKey, osmData);
            }

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
            console.error("Végzetes hiba, a fallback szerverek is elszálltak:", e);
            if (!loadedFromCache) {
                document.getElementById('loader-status').innerText = "FAILED.";
                alert("Hiba a letöltéskor: Minden szerver elérhetetlen.\n(Ellenőrizd az internetkapcsolatot!)");
            } else {
                showToast("Offline mód: Nem sikerült frissíteni a szerverről.");
            }
        }
    }

    function collectDoors() {
        doorNodes.clear();
        geoJsonData.features.forEach(f => {
            const p = f.properties;
            if (f.geometry.type === 'Point' && (p.entrance || p.door)) {
                const levels = getLevelsFromFeature(f);
                const lat = f.geometry.coordinates[1];
                const lon = f.geometry.coordinates[0];
                if (levels.length === 0) levels.push("0", "1", "2", "3", "-1"); 
                levels.forEach(lvl => { doorNodes.add(toKey(lat, lon, lvl)); });
            }
        });
    }

    function drawLabels(level) {
        labelLayerGroup.clearLayers();

        // HA NINCS ADAT, NE CSINÁLJ SEMMIT! - Biztonsági ellenőrzés (Crash fix)
        if (!geoJsonData || !geoJsonData.features) return;
        
        // Csak ha elég közel vagyunk (biztos ami biztos 19+)
        if (map.getZoom() < 19) return;

        geoJsonData.features.forEach(feature => {
            // 1. Szűrés: Csak a jelenlegi szinten lévő dolgok kellenek
            const levels = getLevelsFromFeature(feature);
            if (!levels.includes(level)) return;

            const p = feature.properties;

            // --- SZŰRÉS (BLACKLIST) ---
            // Nem kérünk címkét: Folyosó, WC, Lépcső, Lift
            const isCorridor = p.indoor === 'corridor' || p.highway === 'corridor';
            const isToilet = p.amenity === 'toilets' || p.room === 'toilet' || p.room === 'toilets' || p.room === 'wc';
            const isStairs = p.highway === 'steps' || p.room === 'stairs' || p.indoor === 'staircase';
            const isElevator = p.highway === 'elevator' || p.room === 'elevator';

            // Ha bármelyik ezek közül, akkor SKIP
            if (isCorridor || isToilet || isStairs || isElevator) return;
            
            // 2. Mi legyen a felirat? (Ref > Név > Semmi)
            // Rövid nevek előnyben, hogy kiférjenek.
            let labelText = p.ref;
            
            // Ha nincs ref, de van név (pl. "Büfé"), mehet az.
            // De ha a név nagyon hosszú, inkább hagyjuk, vagy vágjuk?
            if (!labelText && p.name) {
                // Csak akkor írjuk ki a nevet, ha nem túl hosszú (pl. < 15 karakter)
                if (p.name.length < 15) labelText = p.name;
            }

            // Ha még mindig nincs, vagy ez csak egy fal
            if (!labelText || p.indoor === 'wall') return;

            // 3. Pozíció keresése (L-alak support)
            let centerLat, centerLon;

            if (feature.geometry.type === "Point") {
                centerLat = feature.geometry.coordinates[1];
                centerLon = feature.geometry.coordinates[0];
            } else {
                // ITT A TRÜKK: turf.pointOnFeature
                // Ez garantálja, hogy a pont a poligon BELSEJÉBEN lesz.
                const pointOnPoly = turf.pointOnFeature(feature);
                centerLat = pointOnPoly.geometry.coordinates[1];
                centerLon = pointOnPoly.geometry.coordinates[0];
            }

            // 4. Marker kirajzolása (DivIcon szöveggel)
            const labelIcon = L.divIcon({
                className: 'room-label',
                html: labelText,
                iconSize: [40, 20], // Kb. méret, de a CSS flexbox kezeli
                iconAnchor: [20, 10] // Középre igazítva
            });

            L.marker([centerLat, centerLon], {
                icon: labelIcon,
                interactive: false,
                pane: 'labelPane'
            }).addTo(labelLayerGroup);
        });
    }

    function renderLevel(level) {
        indoorLayerGroup.clearLayers();
        iconLayerGroup.clearLayers();
        highlightLayerGroup.clearLayers();
        updateRouteVisibility(level);
        updateSelectedHighlight(level); 

        L.geoJSON(geoJsonData, {
            // --- A gyors renderer bekötése ---
            renderer: smoothRenderer,

            filter: function(feature) {
                const feats = getLevelsFromFeature(feature);
                if (feats.length === 0 && (feature.properties.entrance || feature.properties.door)) return true; 
                return feats.includes(level);
            },
            style: function(feature) {
                const p = feature.properties;
                // ALAPÉRTELMEZETT SZOBA STÍLUS
                // Most már külön stroke és fill változót használunk!
                let style = { 
                    color: "var(--color-room-stroke)", 
                    weight: 1, 
                    fillColor: "var(--color-room)", 
                    fillOpacity: 0.5, 
                    pane: 'overlayPane' 
                };
                
                // 1. ÉPÜLET ALAP / FALAK / PADLÓ
                if (p.indoor === 'level' || p['building:part'] || p.indoor === 'wall') {
                    style = { 
                        color: "var(--color-outline)", 
                        weight: 1, 
                        fillColor: "var(--color-floor-fill)", // ÚJ: Padló szín
                        fillOpacity: (p.indoor === 'wall') ? 0.0 : 0.1, // Falnak nincs fill, padlónak van
                        pane: 'floorPane' 
                    };
                }
                // 2. FOLYOSÓK
                else if (p.indoor === 'corridor') {
                    style = { 
                        color: "var(--color-corridor)", 
                        weight: 0, 
                        fillColor: "var(--color-corridor-fill)", 
                        fillOpacity: 1, 
                        stroke: false 
                    };
                }
                else if (p.highway === 'corridor') {
                    style = { color: "var(--color-corridor)", weight: 4, opacity: 0.5 };
                }
                // 3. WC
                else if (p.room === 'toilet' || p.room === 'toilets' || p.amenity === 'toilets') {
                    style = { 
                        fillColor: "var(--color-toilet-fill)", 
                        color: "var(--color-toilet-stroke)", 
                        weight: 2, 
                        fillOpacity: 0.9 
                    };
                }
                // 4. LÉPCSŐ (Külön stílus)
                else if (p.room === 'stairs' || p.indoor === 'staircase' || p.highway === 'steps') {
                    style = { 
                        fillColor: "var(--color-stairs)", 
                        color: "var(--color-stairs-stroke)", 
                        fillOpacity: 0.6, 
                        weight: 1 
                    };
                }
                // 5. LIFT (Most már külön stílus!)
                else if (p.highway === 'elevator' || p.room === 'elevator') {
                    style = { 
                        fillColor: "var(--color-elevator)", 
                        color: "var(--color-elevator-stroke)", 
                        fillOpacity: 0.6, 
                        weight: 1 
                    };
                }
                // 6. AJTÓK
                else if (p.entrance || p.door) {
                    style = { color: "var(--color-door)", weight: 3, radius: 2, opacity: 0.8 };
                }
                
                // --- POI STÍLUSOK (Ezek maradnak hardcoded, vagy hozzáadhatsz változót ha kell) ---
                else if (p.amenity === 'vending_machine') {
                    style = { color: "var(--color-coffee)", fillColor: "var(--color-coffee)", fillOpacity: 0.8, weight: 1 };
                }
                else if (p.amenity === 'cafe' || p.shop === 'kiosk' || p.amenity === 'fast_food') {
                    style = { color: "var(--color-buffet)", fillColor: "var(--color-buffet)", fillOpacity: 0.7, weight: 1 };
                }

                // KEDVENC KIEMELÉS
                if (isFavorite(feature)) {
                    style.color = "var(--color-fav)";
                    style.weight = 3;
                    style.fillOpacity = Math.max(style.fillOpacity, 0.6);
                }
                
                return style;
            },
            pointToLayer: function(feature, latlng) {
                 if (feature.properties.entrance || feature.properties.door) {
                     return L.circleMarker(latlng, { 
                         radius: 3, 
                         color: 'white', 
                         fillColor: 'black', 
                         fillOpacity: 1,
                         className: 'door-marker' 
                     });
                 }
                 return L.marker(latlng);
            },
            onEachFeature: function(feature, layer) {
                const p = feature.properties;
                
                // IKONOK LOGIKA
                let iconName = null;
                if (p.room === 'toilet' || p.room === 'toilets' || p.amenity === 'toilets') iconName = "wc";
                if (p.room === 'stairs' || p.indoor === 'staircase') iconName = "stairs_2";
                if (p.highway === 'elevator' || p.room === 'elevator') iconName = "elevator"; 
                
                if (p.amenity === 'vending_machine') {
                    if (p.vending === 'coffee') iconName = "coffee_maker";
                    else iconName = "fastfood"; 
                }
                if (p.amenity === 'cafe' || p.amenity === 'fast_food') iconName = "restaurant";
                
                const center = (feature.geometry.type === "Point") 
                    ? [feature.geometry.coordinates[1], feature.geometry.coordinates[0]]
                    : [turf.centroid(feature).geometry.coordinates[1], turf.centroid(feature).geometry.coordinates[0]];

                if (isFavorite(feature)) {
                    L.marker(center, {
                        icon: L.divIcon({ 
                            className: 'map-icon', 
                            html: `<span class="material-symbols-outlined" style="color: gold; text-shadow: 0 0 5px black; font-size: 24px;">star</span>` 
                        }),
                        interactive: false,
                        zIndexOffset: 1000 
                    }).addTo(iconLayerGroup);
                }

                if (iconName && !isFavorite(feature)) { 
                     L.marker(center, {
                        icon: L.divIcon({ className: 'map-icon', html: `<span class="material-symbols-outlined">${iconName}</span>` }),
                        interactive: false 
                    }).addTo(iconLayerGroup);
                }

                layer.on('click', (e) => {
                    // Ha zárolva van (épp zoomolsz), ignoráljuk
                    if (window.isMapInteractionLocked) return;

                    L.DomEvent.stopPropagation(e);

                    // HA MÁR VOLT EGY VÁRAKOZÓ KLIKK, AZT TÖRÖLJÜK (Biztos ami biztos)
                    if (window.clickTimeout) {
                        clearTimeout(window.clickTimeout);
                        window.clickTimeout = null;
                    }

                    // ÚJ: KÉSLELTETETT VÉGREHAJTÁS
                    // Várunk 250ms-t. Ha addig nem jön újabb touchstart (ami törölné ezt),
                    // akkor ez egy sima kattintás volt.
                    window.clickTimeout = setTimeout(() => {
                        if (layer.options.pane !== 'floorPane') openSheet(feature);
                        else closeSheet();
                        
                        window.clickTimeout = null; // Takarítás
                    }, 250); 
                });
            }
        }).addTo(indoorLayerGroup);

        drawLabels(level);
    }

    // === AGRESSZÍV ADATBÁZIS KERESŐ v3 (WINGMAN SUPPORT) ===
    function findBestRoomMatch(osmName, osmRef, osmLevel, buildingKey) {
        if (!osmName && !osmRef) return null;
        
        let core = (osmRef || osmName || "").trim();
        if (core.toLowerCase().includes("névtelen") || core === "") return null;
        core = normalizeRoomId(core); // pl. "107" vagy "b107"
        
        const b = buildingKey.toLowerCase(); 
        const rawLvl = osmLevel.split(';')[0];
        const lvlChars = getLevelChars(buildingKey, rawLvl); // pl. ["-1", "p", "0"]

        // SZÉTSZEDJÜK A MAGOT (Ha van benne betű, pl "b107")
        let wing = "";
        let num = core;
        // Regex: Elején betűk, utána számok (pl. "b" + "107")
        const splitMatch = core.match(/^([a-z]+)(\d+.*)$/);
        if (splitMatch) {
            wing = splitMatch[1]; // "b"
            num = splitMatch[2];  // "107"
        }

        // PERMUTÁCIÓK GENERÁLÁSA
        const candidates = new Set();
        
        // 1. Alapok
        candidates.add(core); // "b107"
        if (wing) candidates.add(num); // "107" (szárny nélkül is próbáljuk)

        lvlChars.forEach(lvl => {
            // 2. Szint + Mag (pl. "p107", "pb107")
            if (!core.startsWith(lvl)) candidates.add(lvl + core);
            
            // 3. Épület + Mag (pl. "q107", "qb107")
            candidates.add(b + core);

            // 4. Épület + Szint + Mag (Standard: "qp107", "qpb107")
            candidates.add(b + lvl + core); 
            
            // 5. WINGMAN LOGIKA (A Hiányzó Láncszem!)
            // Ha van szárny, próbáljuk meg a szintet középre rakni: Épület + Szárny + Szint + Szám
            // Pl: Q + B + P + 107 -> "qbp107"
            if (wing) {
                candidates.add(b + wing + lvl + num); // "qbp107"
                candidates.add(wing + lvl + num);     // "bp107"
            }
            
            // K épület fix: "kf83" (Épület + Szint + Szám) - ez a 4-es pontban már benne van (b+lvl+core)
            // De ha a core "f83", akkor "k"+"f83" = "kf83".
        });

        console.log(`🔎 DB Keresés: "${core}" (Wing:${wing}, Lvl:${lvlChars}) ->`, Array.from(candidates));

        const dbKeys = Object.keys(ROOM_DATABASE);
        
        // Pontos egyezés keresése
        for (const cand of candidates) {
            for (const dbKey of dbKeys) {
                const cleanDbKey = normalizeRoomId(dbKey);
                if (cleanDbKey === cand) {
                    console.log(`   ✅ TALÁLAT (Pontos): ${dbKey}`);
                    return ROOM_DATABASE[dbKey];
                }
            }
        }
        
        // Ha nincs pontos, jöhet a részleges (Fuzzy) - csak óvatosan
        for (const cand of candidates) {
            if (cand.length < 3) continue; // Túl rövidbe nem keresünk
            for (const dbKey of dbKeys) {
                const cleanDbKey = normalizeRoomId(dbKey);
                // DB tartalmazza a jelöltet (pl. db="qbp107_labor", cand="qbp107")
                if (cleanDbKey.includes(cand)) {
                    console.log(`   ✅ TALÁLAT (Fuzzy): ${dbKey}`);
                    return ROOM_DATABASE[dbKey];
                }
            }
        }
        
        return null;
    }

    // === MODIFIED OPEN SHEET (DYNAMIC HEIGHT + SMART MATCH) ===
    function openSheet(feature) {
        // --- NAVIGÁCIÓ MEGSZAKÍTÁSA ---
        // Ha navigációs módban vagyunk, és a user egy harmadik helyre kattint (nem Start/Cél),
        // akkor lépjünk ki a navigációból és mutassuk az új hely adatait.
        if (activeRouteData) {
            const isStart = activeNavSource && activeNavSource.id === feature.id;
            const isEnd = activeNavTarget && activeNavTarget.id === feature.id;

            if (!isStart && !isEnd) {
                clearRouteAndClose(); 
                // A clearRouteAndClose bezárja a sheetet és törli a vonalakat.
                // A függvény további része viszont azonnal újranyitja a sheetet az új hellyel.
            }
        }

        selectedFeature = feature;
        
        // Navigációs start pont választás kezelése
        if (pendingNavSource) {
            startNavigation(selectedFeature, pendingNavSource);
            pendingNavSource = null;
            document.getElementById('search-input').placeholder = "Keress...";
            return;
        }
        
        const p = feature.properties;
        
        // --- 1. TÍPUS FORDÍTÁSA ÉS MAGYARÍTÁS ---
        let typeName = getHungarianType(p);
        // Nagybetűsítés (pl. "mosdó" -> "Mosdó")
        typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);

        // --- 2. NÉV MEGHATÁROZÁSA ---
        // Ha van neve (K155), az a név. Ha nincs, akkor a Típusa (Mosdó).
        let displayName = p.name || p.ref;
        if (!displayName) {
            displayName = typeName;
        }

        // --- 3. SZINT MEGJELENÍTÉS (Alias Logic) ---
        let displayLevelString = "";
        
        // A) Ha az adott feature-nek van saját szint-neve (pl. "1;2" a "2-3" helyett), azt használjuk
        if (p['level:ref']) {
            displayLevelString = p['level:ref'];
        } 
        // B) Ha nincs, akkor megnézzük a globális aliasokat (pl "1" -> "MF")
        else {
            const rawLevels = getLevelsFromFeature(feature);
            const mappedLevels = rawLevels.map(lvl => {
                return levelAliases[lvl] || lvl;
            });
            displayLevelString = mappedLevels.join(', ');
        }

        // DOM Update
        document.getElementById('sheet-title').innerText = displayName;
        
        // Alcím logika: Ne írjuk ki kétszer ugyanazt
        if (displayName === typeName) {
            // Ha a név a típus (pl "Mosdó"), akkor csak a szintet írjuk mellé
            document.getElementById('sheet-sub').innerText = `Szint: ${displayLevelString}`;
        } else {
            // Ha van rendes neve, akkor írjuk ki a típusát is
            document.getElementById('sheet-sub').innerText = `Szint: ${displayLevelString} | ${typeName}`;
        }
        
        // --- ADATBÁZIS KERESÉS ---
        const rawLevel = getLevelsFromFeature(feature)[0] || "0";
        // Itt javítottam a korábbi roomData keresést is, hogy biztos jó legyen
        const roomData = findBestRoomMatch(p.name, p.ref, rawLevel, currentBuildingKey);
        
        const dataContainer = document.getElementById('room-data-container');
        
        if (roomData) {
            dataContainer.style.display = 'block';
            document.getElementById('meta-capacity').innerHTML = `<span class="material-symbols-outlined">group</span> ${roomData.capacity} fő`;
            
            const projEl = document.getElementById('meta-projector');
            const keyEl = document.getElementById('meta-key');
            
            projEl.style.display = roomData.projector ? 'flex' : 'none';
            keyEl.style.display = roomData.key ? 'flex' : 'none';
            
            document.getElementById('room-note').innerText = roomData.note || "";
            
            const gallery = document.getElementById('room-gallery');
            gallery.innerHTML = "";
            if (roomData.images && roomData.images.length > 0) {
                roomData.images.forEach(url => {
                    const img = document.createElement('img');
                    img.src = url;
                    img.className = 'gallery-img';
                    img.onclick = () => window.open(url, '_blank');
                    gallery.appendChild(img);
                });
            }
        } else {
            dataContainer.style.display = 'none';
        }

        const sheet = document.getElementById('bottom-sheet');
        sheet.classList.add('open');

        updateFavoriteUI(); //Beállítja, hogy sárga-e a csillag
        
        // Auto-height logika (pici késleltetéssel, hogy a DOM frissüljön)
        setTimeout(() => {
            const autoH = getAutoHeight();
            const content = document.getElementById('sheet-scroll-content');
            
            // Ha van tartalom (adatbázis találat), nyissuk ki nagyra
            if (roomData) {
                 sheet.style.height = `${autoH}px`;
            } else {
                 // Ha nincs tartalom (csak cím), akkor elég a Peek vagy picit nagyobb
                 // De maradjunk az autoH-nál, mert az igazodik a tartalomhoz
                 sheet.style.height = `${getPeekHeight() + 20}px`; 
            }
        }, 50);

        drawSelectedHighlight(feature);
        zoomToFeature(feature);
    }

    // ÚJ PARAMÉTER: sourceFeature hozzáadva a végére
    function updateSheetForNavigation(targetFeature, stats, itinerary, sourceFeature) {
        const sheet = document.getElementById('bottom-sheet');
        const header = document.querySelector('.sheet-header');
        
        // Header mód bekapcs
        header.classList.add('nav-mode');

        const title = document.getElementById('sheet-title');
        const sub = document.getElementById('sheet-sub');
        const content = document.getElementById('sheet-scroll-content');
        
        // 1. CÉL NÉV MEGHATÁROZÁSA (Reusable logika)
        const formatName = (feat) => {
            if (!feat || !feat.properties) return "Ismeretlen hely";
            const p = feat.properties;
            // Ha van név/ref, azt használjuk, ha nincs, akkor a típust magyarul
            let name = p.name || p.ref || (typeof getHungarianType === 'function' ? getHungarianType(p) : "Hely");
            
            // "Terem" utótag okos hozzáadása
            const lower = name.toLowerCase();
            const hasType = lower.includes('terem') || lower.includes('labor') || 
                            lower.includes('mosdó') || lower.includes('wc') || 
                            lower.includes('lépcső') || lower.includes('bejárat') || 
                            lower.includes('porta') || lower.includes('büfé');
            if (!hasType && name.length < 20) name += " terem";
            return name;
        };

        const targetName = formatName(targetFeature);
        // ÚJ: Start név meghatározása (Null check fontos!)
        const sourceName = sourceFeature ? formatName(sourceFeature) : "Kijelölt pont";

        // 2. FEJLÉC (Header)
        title.innerHTML = `
            <div style="text-align:center; width:100%;">
                <span style="color:var(--color-ui-active); font-size:28px; font-weight:800; letter-spacing:-0.5px;">
                    ${stats.time} perc
                </span>
            </div>
        `;
        
        sub.innerHTML = `
            <div style="text-align:center; width:100%; font-size:15px; opacity:0.8; margin-top:-5px;">
                ${stats.dist} m <span style="margin:0 6px; opacity:0.4;">&bull;</span> ${targetName}
            </div>
        `;

        // 3. TARTALOM (Itiner)
        document.getElementById('room-data-container').style.display = 'none';
        
        let itineraryDiv = document.getElementById('nav-itinerary');
        if (!itineraryDiv) {
            itineraryDiv = document.createElement('div');
            itineraryDiv.id = 'nav-itinerary';
            content.appendChild(itineraryDiv);
        }
        itineraryDiv.style.display = 'block';
        
        let html = `<div style="margin-top:15px; display:flex; flex-direction:column; gap:12px;">`;
        
        // START SOR (Most már névvel és klikkel!)
        html += `
            <div class="itiner-step clickable-step" onclick="focusOnEndpoint('start')">
                <div class="itiner-icon start"><span class="material-symbols-outlined">trip_origin</span></div>
                <div class="itiner-text">
                    <div style="font-weight:bold; font-size:16px;">Indulás: ${sourceName}</div>
                    <div style="font-size:12px; opacity:0.6; margin-top:2px;">Kattints a megtekintéshez</div>
                </div>
            </div>
        `;

        // LÉPÉSEK
        itinerary.forEach(step => {
            html += `
                <div class="itiner-step clickable-step" onclick="focusOnRouteSegment('${step.level}')">
                    <div class="itiner-icon"><span class="material-symbols-outlined">${step.icon}</span></div>
                    <div class="itiner-text">
                        <div style="font-weight:bold; font-size:16px;">${step.text}</div>
                        <div style="font-size:12px; opacity:0.6; margin-top:2px;">Kattints a megtekintéshez</div>
                    </div>
                </div>
            `;
        });

        // CÉL SOR (Most már klikkel!)
        html += `
            <div class="itiner-step clickable-step" onclick="focusOnEndpoint('end')">
                <div class="itiner-icon end"><span class="material-symbols-outlined">location_on</span></div>
                <div class="itiner-text">
                    <div style="font-weight:bold; font-size:16px;">Megérkezés: ${targetName}</div>
                    <div style="font-size:12px; opacity:0.6; margin-top:2px;">Kattints a megtekintéshez</div>
                </div>
            </div>
        `;
        html += `</div> <div style="height:40px;"></div>`; 
        
        itineraryDiv.innerHTML = html;

        // Footer elrejtés
        const footer = document.querySelector('.sheet-footer');
        if (footer) footer.style.display = 'none';
        
        sheet.classList.add('open');
        collapseToPeek(); 
    }

    // === OKOS ÚTVONAL FÓKUSZ (Navigációhoz) ===
    function focusOnRouteSegment(level) {
        if (!currentRoutePath || currentRoutePath.length === 0) return;

        // 1. Szintváltás
        switchLevel(level);

        // 2. Pontok összegyűjtése az adott szinten
        const routePoints = [];
        currentRoutePath.forEach(key => {
            const parts = key.split(','); // lat, lon, level
            if (parts[2] === level) {
                routePoints.push([parseFloat(parts[0]), parseFloat(parts[1])]);
            }
        });

        if (routePoints.length === 0) return;

        // 3. Befoglaló téglalap (Bounds)
        const bounds = L.latLngBounds(routePoints);

        // 4. Dinamikus Padding számítás (Hogy ne takarja ki a Sheet)
        const sheet = document.getElementById('bottom-sheet');
        // Megnézzük, mennyi helyet foglal el alul a sheet (plusz a headerje)
        // Ha "open" (nagy), akkor sokat, ha "peek", akkor kevesebbet.
        const sheetHeight = sheet.getBoundingClientRect().height;

        // EXTRA HELY (Padding)
        // Fent: 80px (Hogy ne lógjon bele a Keresőbe/Headerbe)
        // Lent: sheetHeight + 50px (Hogy a Sheet fölött legyen, kis ráhagyással)
        // Oldalt: 50px (Hogy ne tapadjon a képernyő szélére)
        
        map.fitBounds(bounds, {
            paddingTopLeft: [50, 80], 
            paddingBottomRight: [50, sheetHeight + 50], 
            maxZoom: 21, // Ne zoomoljon rá túlságosan, ha csak 1 méteres a szakasz
            animate: true,
            duration: 1.0 // Szép lassú animáció
        });
    }

    function startNavigationToHere() { startNavigation(selectedFeature, null); }
    function startNavigationFromHere() {
        pendingNavSource = selectedFeature; 
        closeSheet(); 
        const input = document.getElementById('search-input');
        input.value = "";
        input.placeholder = `Hova mész innen: ${selectedFeature.properties.ref || "..."}?`;
        input.focus();
    }

    function drawSelectedHighlight(feature) {
        selectedHighlightLayer.clearLayers();
        const highlight = L.geoJSON(feature, {
            style: { color: "var(--color-highlight)", weight: 5, fill: false, opacity: 0.8, pane: 'highlightPane' },
            pointToLayer: function(f, latlng) { return L.circleMarker(latlng, { radius: 10, color: "var(--color-highlight)", fill: false }); }
        });
        highlight.feature = feature; highlight.eachLayer(l => l.feature = feature); 
        selectedHighlightLayer.addLayer(highlight);
        updateSelectedHighlight(currentLevel);
    }

    function updateSelectedHighlight(level) {
        selectedHighlightLayer.eachLayer(l => {
            if (!l.feature) return;
            const feats = getLevelsFromFeature(l.feature);
            if(feats.includes(level)) l.setStyle({opacity: 0.8, fillOpacity: 0});
            else l.setStyle({opacity: 0, fillOpacity: 0});
        });
    }

    function closeSheet() {
        document.getElementById('bottom-sheet').classList.remove('open');
        highlightLayerGroup.clearLayers();
        selectedHighlightLayer.clearLayers();
        selectedFeature = null;
    }
    // TAKARÍTÁS
    function clearRouteAndClose() {
        routeLayerGroup.clearLayers();
        routeMarkersLayerGroup.clearLayers(); 
        routeArrowsLayerGroup.clearLayers();
        selectedHighlightLayer.clearLayers();
        pendingNavSource = null;
        activeRouteData = null;
        activeNavSource = null; // Takarítjuk ezt is
        activeNavTarget = null; 
        
        const input = document.getElementById('search-input');
        input.placeholder = "Keress...";
        input.value = ""; 
        updateRightButtonState();

        // --- KIKAPCSOLJUK A NAVIGÁCIÓS STÍLUST ---
        const header = document.querySelector('.sheet-header');
        if (header) header.classList.remove('nav-mode');

        // --- UI VISSZAÁLLÍTÁS ---
        const footer = document.querySelector('.sheet-footer');
        if (footer) footer.style.display = 'flex'; // Footer visszahozása!
        
        // Navigációs gombok vissza
        const btnTo = document.querySelector('.btn-nav-to');
        const btnFrom = document.querySelector('.btn-nav-from');
        if (btnTo) btnTo.style.display = 'flex';
        if (btnFrom) btnFrom.style.display = 'flex';
        
        const itinerDiv = document.getElementById('nav-itinerary');
        if (itinerDiv) itinerDiv.style.display = 'none';
        
        document.getElementById('room-data-container').style.display = 'block';

        closeSheet();
    }

    function handleSearch(e) {
        const term = e.target.value.trim();
        const resultsDiv = document.getElementById('search-results');
        
        // ENTER LEÜTÉS KEZELÉSE
        if (e.key === 'Enter') {
            // 1. Prioritás: Ha van PONTOS épület találat (pl. "QBF11" -> Q épület)
            for (const [key, data] of Object.entries(BUILDINGS)) {
                if (key !== currentBuildingKey && data.regex && data.regex.test(term)) {
                    // Ha Entert nyomott és egyértelműen más épület, azonnal ajánljuk fel (Modal)
                    showModal("Épület Váltás", `A keresett hely (${term}) valószínűleg a(z) ${data.name}-ben van. Átváltsunk?`, () => {
                        changeBuilding(key, term); 
                    });
                    return; // Megállunk, nem zoomolunk random helyi találatra
                }
            }

            // 2. Prioritás: Helyi találatok
            const hits = smartFilter(term); 
            if (hits.length > 0) {
                // Ha van helyi találat, oda viszünk (kivéve ha fenti épület check bejelzett volna)
                zoomToFeature(hits[0]);
                openSheet(hits[0]);
                resultsDiv.style.display = 'none'; 
                
                const val = hits[0].properties.name || hits[0].properties.ref || term;
                document.getElementById('search-input').value = val;

                // --- B-003 FIX: Ikon frissítése (Enter után) ---
                updateRightButtonState();

                return;
            }

            // 3. Kategória highlight (WC, Lépcső...)
            const genericTerms = ["wc", "vécé", "mosdó", "toalett", "toilet", "lépcső", "lépcsőház", "stairs"];
            if (genericTerms.some(t => term.toLowerCase().includes(t))) { 
                highlightCategory(term); 
                resultsDiv.style.display = 'none'; 

                // --- B-003 FIX: Itt is frissítjük, bár a szöveg marad ---
                updateRightButtonState();
                return;
            }
            
            return; // Semmi nem történt
        }

        // --- GÉPELÉS KÖZBENI LISTA (AUTOCOMPLETE) ---
        
        // Töröljük az előző listát
        resultsDiv.innerHTML = '';
        let hasResults = false;

        if (term.length < 1) { 
            resultsDiv.style.display = 'none'; 
            // Ha törölt mindent backspace-szel, frissítsünk
            updateRightButtonState();
            return; 
        }

        // 1. ÉPÜLET JAVASLATOK (Mindig ellenőrizzük!)
        // Ha a user beírja: "QBF...", akkor itt felajánljuk a Q épületet
        for (const [key, data] of Object.entries(BUILDINGS)) {
            // Csak ha NEM a mostani épület, és illeszkedik a regex (pl. /^Q/i)
            if (key !== currentBuildingKey && data.regex && data.regex.test(term)) {
                const div = document.createElement('div');
                // Sárga/Figyelemfelkeltő stílus
                div.className = 'result-item warning-text';
                div.innerHTML = `<span class="material-symbols-outlined" style="vertical-align:middle; margin-right:5px;">travel_explore</span> Talán a ${key} épületben?`;
                div.onclick = () => changeBuilding(key, term);
                resultsDiv.appendChild(div);
                hasResults = true;
            }
        }

        // 2. HELYI TALÁLATOK
        if (term.length >= 2) {
            const hits = smartFilter(term);
            if (hits.length > 0) {
                hits.slice(0, 5).forEach(hit => {
                    const div = document.createElement('div');
                    div.className = 'result-item';
                    
                    const name = hit.properties.name || hit.properties.ref || "???";
                    const lvl = getLevelsFromFeature(hit)[0] || "?";
                    
                    // Extra infó a név mellett
                    div.innerHTML = `${name} <span style="opacity:0.6; font-size:12px; margin-left:5px;">(Szint: ${lvl})</span>`;
                    
                    div.onclick = () => { 
                        zoomToFeature(hit); 
                        openSheet(hit); 
                        resultsDiv.style.display = 'none'; 
                        document.getElementById('search-input').value = name; 

                        // --- B-003 FIX: Ikon frissítése (Kattintás után) ---
                        updateRightButtonState();
                    };
                    resultsDiv.appendChild(div);
                    hasResults = true;
                });
            }
        }

        // Megjelenítés
        if (hasResults) {
            resultsDiv.style.display = 'block';
        } else {
            resultsDiv.style.display = 'none';
        }

        // Gépelés közben az oninput intézi, de nem árt
        updateRightButtonState();
    }

    // === KERESŐSÁV UI LOGIKA (F-006 & F-007) ===

    // 1. BAL IKON (Search / Back)
    function handleSearchFocus() {
        const leftIcon = document.getElementById('search-left-icon');
        // Ikon csere: Nyíl
        leftIcon.innerText = 'arrow_back';
        // Klikkelhetővé tesszük
        leftIcon.classList.add('clickable');
        
        // Ha fókuszba kerül, mutassuk a kedvenceket (ha üres)
        showFavoritesInSearch();
    }

    function handleSearchBlur() {
        // Kis késleltetés kell, különben a "click" esemény nem fut le a nyílon,
        // mert a blur előbb elrejti/átalakítja a gombot.
        setTimeout(() => {
            const leftIcon = document.getElementById('search-left-icon');
            leftIcon.innerText = 'search';
            leftIcon.classList.remove('clickable');
        }, 150);
    }

    function handleSearchLeftClick() {
        // Ha rányom a nyílra -> Blur (Billentyűzet le, fókusz el)
        document.getElementById('search-input').blur();
    }

    // 2. JOBB GOMB (Settings / Clear)
    function updateRightButtonState() {
        const input = document.getElementById('search-input');
        const btn = document.getElementById('btn-right-action');
        const icon = btn.querySelector('span');

        if (input.value.length > 0) {
            // Törlés mód
            icon.innerText = 'close';
            btn.classList.add('active-mode'); // CSS kezeli a színt
            // btn.style.color törölve!
        } else {
            // Settings mód
            icon.innerText = 'tune';
            btn.classList.remove('active-mode');
            // btn.style.color törölve!
        }
    }

    function handleRightAction(e) {
        const input = document.getElementById('search-input');
        
        if (input.value.length > 0) {
            // TÖRLÉS MÓD
            
            // EZ A KULCS: Megakadályozzuk, hogy a gomb ellopja a fókuszt az inputtól!
            // Így nem fut le a 'blur', nem tűnik el a 'Back' nyíl, és írhatsz tovább azonnal.
            e.preventDefault(); 
            
            input.value = '';
            updateRightButtonState(); // Ikon csere vissza tune-ra
            
            // Mivel a fókusz megmaradt, manuálisan frissítjük a listát (üres mező -> kedvencek)
            document.getElementById('search-results').style.display = 'none';
            showFavoritesInSearch(); 
            
        } else {
            // SETTINGS MÓD
            // Itt nem kell preventDefault, sőt, jobb is ha elveszi a fókuszt, 
            // mert megnyílik a modal.
            toggleSettings();
        }
    }

    /* ITT VOLT SMARTFILTER
    function smartFilter(term) {
        const cleanTerm = term.toLowerCase().trim();
        let strippedTerm = null;
        if (currentBuilding.regex.test(cleanTerm)) { strippedTerm = cleanTerm.replace(currentBuilding.regex, ''); }
        return geoJsonData.features.filter(f => {
            const p = f.properties; const name = (p.name || "").toLowerCase(); const ref = (p.ref || "").toLowerCase(); const levels = getLevelsFromFeature(f);
            if (name.includes(cleanTerm) || ref.includes(cleanTerm)) return true;
            if (strippedTerm && strippedTerm.length > 1) { if (name.includes(strippedTerm) || ref.includes(strippedTerm)) return true; }
            return false;
        });
    }
    */

    function highlightCategory(term) {
        highlightLayerGroup.clearLayers();
        const isToilet = ["wc", "vécé", "mosdó", "toalett", "toilet"].some(t => term.includes(t));
        const isStairs = ["lépcső", "lépcsőház", "stairs"].some(t => term.includes(t));
        L.geoJSON(geoJsonData, {
            filter: function(feature) {
                const levels = getLevelsFromFeature(feature);
                if (!levels.includes(currentLevel)) return false;
                const p = feature.properties;
                if (isToilet && (p.room === 'toilet' || p.room === 'toilets' || p.amenity === 'toilets')) return true;
                if (isStairs && (p.room === 'stairs' || p.indoor === 'staircase')) return true;
                return false;
            },
            style: { color: "#ffeb3b", weight: 4, fillOpacity: 0.1 } 
        }).addTo(highlightLayerGroup);
        document.getElementById('bottom-sheet').classList.remove('open');
    }

    function buildRoutingGraph() {
        console.log(`Building Graph (${APP_SETTINGS.elevatorMode})...`);
        navigationGraph.clear();
        mainEntranceNode = null;
        let minEntranceDist = Infinity;

        // SÚLYOZÁS BEÁLLÍTÁSA
        let stairsPenalty = 5.0; // Alap: Lépcső nehéz
        let elevatorWeight = 0.5; // Alap: Lift könnyű
        let elevatorBoardingCost = 20.0; // Alap: 20 méter "várakozási idő" büntetés a liftnek

        switch (APP_SETTINGS.elevatorMode) {
            case 'stairs': 
                stairsPenalty = 1.0; 
                elevatorBoardingCost = 500.0; 
                break;
            case 'balanced':
                stairsPenalty = 1.5; 
                elevatorBoardingCost = 30.0; 
                break;
            case 'elevator':
                stairsPenalty = 10.0; 
                elevatorBoardingCost = 0.0; 
                break;
            case 'wheelchair':
                stairsPenalty = 9999.0; 
                elevatorBoardingCost = 0.0;
                break;
        }

        const addEdge = (node1, node2, type) => {
            let dist = turf.distance(turf.point([node1.lon, node1.lat]), turf.point([node2.lon, node2.lat])) * 1000;
            
            if (type === 'stairs_inter') {
                // JAVÍTÁS: 15.0 helyett 4.0 méter. 
                // Így a virtuális lépcső "olcsó" lesz (kb 20 pont), és nem éri meg elmenni a távoli igazi lépcsőhöz.
                // Ha van geometry (dist > 0), akkor azt használja, ha nincs (virtuális), akkor a 4.0-t.
                dist = Math.max(dist, 4.0) * stairsPenalty;
            }
            else if (type === 'elevator') {
                dist = Math.max(dist, 1.0) * elevatorWeight; 
            } else {
                dist = Math.max(dist, 0.1); 
            }

            const k1 = toKey(node1.lat, node1.lon, node1.level);
            const k2 = toKey(node2.lat, node2.lon, node2.level);
            
            if (k1 === k2) return;
            if (!navigationGraph.has(k1)) navigationGraph.set(k1, []);
            if (!navigationGraph.has(k2)) navigationGraph.set(k2, []);
            
            navigationGraph.get(k1).push({ key: k2, dist: dist, lat: node2.lat, lon: node2.lon, level: node2.level });
            navigationGraph.get(k2).push({ key: k1, dist: dist, lat: node1.lat, lon: node1.lon, level: node1.level });
        };

        const elevators = geoJsonData.features.filter(f => f.properties.highway === 'elevator' || f.properties.room === 'elevator');
        
        // Poligon lépcsőházak
        const verticalStairs = geoJsonData.features.filter(f => 
            (f.properties.room === 'stairs' || f.properties.indoor === 'staircase' || f.properties.room === 'staircase')
            && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
        );

        geoJsonData.features.forEach(f => {
            const p = f.properties;
            
            // Folyosók
            if (p.highway === 'corridor' && f.geometry.type === 'LineString') {
                const level = getLevelsFromFeature(f)[0] || "0"; 
                const coords = f.geometry.coordinates; 
                for (let i = 0; i < coords.length - 1; i++) {
                    addEdge({ lat: coords[i][1], lon: coords[i][0], level }, { lat: coords[i+1][1], lon: coords[i+1][0], level }, 'walk');
                }
            }

            // Hagyományos Lépcsők (Vonalak)
            if (p.highway === 'steps' && f.geometry.type === 'LineString') {
                const levels = getLevelsFromFeature(f);
                if (levels.length > 0) {
                    const minL = levels[0];
                    const maxL = levels[levels.length - 1];
                    const coords = f.geometry.coordinates;

                    if (minL === maxL) { 
                        const lvl = minL;
                        for (let i = 0; i < coords.length - 1; i++) {
                            addEdge({ lat: coords[i][1], lon: coords[i][0], level: lvl }, { lat: coords[i+1][1], lon: coords[i+1][0], level: lvl }, 'walk');
                        }
                    } else { 
                        if (APP_SETTINGS.elevatorMode === 'wheelchair') return; 
                        
                        const startP = { lat: coords[0][1], lon: coords[0][0] };
                        const endP = { lat: coords[coords.length-1][1], lon: coords[coords.length-1][0] };
                        addEdge({ ...startP, level: minL }, { ...endP, level: maxL }, 'stairs_inter');
                        addEdge({ ...startP, level: maxL }, { ...endP, level: minL }, 'stairs_inter');
                    }
                }
            }
            
            if (p.entrance === 'main' || p.entrance === 'yes') {
                 const lvl = getLevelsFromFeature(f)[0] || "0";
                 const coords = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
                 const dist = turf.distance(turf.point([coords[1], coords[0]]), turf.point([currentBuilding.center[1], currentBuilding.center[0]]));
                 if (dist < minEntranceDist) { minEntranceDist = dist; mainEntranceNode = { lat: coords[0], lon: coords[1], level: lvl }; }
            }
        });

        // Liftek Bekötése
        elevators.forEach(f => {
            const levels = getLevelsFromFeature(f);
            if (levels.length < 2) return;
            const center = turf.centroid(f);
            const liftLon = center.geometry.coordinates[0];
            const liftLat = center.geometry.coordinates[1];

            for (let i = 0; i < levels.length - 1; i++) {
                addEdge({ lat: liftLat, lon: liftLon, level: levels[i] }, { lat: liftLat, lon: liftLon, level: levels[i+1] }, 'elevator');
            }

            // Lift: Van beszállási költség, és a távolságot (dist) hozzáadjuk
            connectVerticalShaftToCorridor(f, levels, liftLat, liftLon, elevatorBoardingCost, false, addEdge);
        });

        // Poligon Lépcsőházak Bekötése
        verticalStairs.forEach(f => {
            if (APP_SETTINGS.elevatorMode === 'wheelchair') return;

            const levels = getLevelsFromFeature(f);
            if (levels.length < 2) return;
            const center = turf.centroid(f);
            const stairLon = center.geometry.coordinates[0];
            const stairLat = center.geometry.coordinates[1];

            for (let i = 0; i < levels.length - 1; i++) {
                addEdge({ lat: stairLat, lon: stairLon, level: levels[i] }, { lat: stairLat, lon: stairLon, level: levels[i+1] }, 'stairs_inter');
            }

            // Lépcsőház: 0 beszállási költség, és "ingyen" behúzás (isVirtualStair = true)
            connectVerticalShaftToCorridor(f, levels, stairLat, stairLon, 0, true, addEdge);
        });
    }

    // Segédfüggvény frissítve (isVirtualStair paraméterrel)
    function connectVerticalShaftToCorridor(shaftFeature, levels, lat, lon, boardingCost, isVirtualStair, addEdgeFn) {
        levels.forEach(lvl => {
            let bestDist = Infinity; let bestPoint = null;
            
            // JAVÍTÁS: Megnöveltük a keresési sugarat 30m -> 50m-re.
            // Nagy lépcsőházaknál a centroid messze lehet a folyosótól.
            const SNAP_RADIUS = 50.0; 

            geoJsonData.features.forEach(corr => {
                if (corr.properties.highway === 'corridor' && corr.geometry.type === 'LineString') {
                    const cLvls = getLevelsFromFeature(corr);
                    if (cLvls.includes(lvl)) {
                        const line = turf.lineString(corr.geometry.coordinates);
                        const pt = turf.point([lon, lat]);
                        const snapped = turf.nearestPointOnLine(line, pt);
                        const d = snapped.properties.dist * 1000;
                        if (d < bestDist && d < SNAP_RADIUS) { bestDist = d; bestPoint = snapped; }
                    }
                }
            });

            if (bestPoint) {
                const corrLat = bestPoint.geometry.coordinates[1];
                const corrLon = bestPoint.geometry.coordinates[0];
                let dist = turf.distance(turf.point([lon, lat]), turf.point([corrLon, corrLat])) * 1000;
                
                // JAVÍTÁS: Ha ez egy virtuális lépcsőház, akkor a centroid-folyosó távolságot
                // gyakorlatilag lenullázzuk (legyen 1 méter).
                // Így nem büntetjük azt, hogy a szoba nagy, és a közepe messze van az ajtótól.
                if (isVirtualStair) {
                    dist = 1.0; 
                }

                const finalDist = dist + boardingCost;
                
                const k1 = toKey(lat, lon, lvl);
                const k2 = toKey(corrLat, corrLon, lvl);
                
                // Ha még nincs ilyen node, létrehozzuk
                if (!navigationGraph.has(k1)) navigationGraph.set(k1, []);
                if (!navigationGraph.has(k2)) navigationGraph.set(k2, []);
                
                navigationGraph.get(k1).push({ key: k2, dist: finalDist, lat: corrLat, lon: corrLon, level: lvl });
                navigationGraph.get(k2).push({ key: k1, dist: finalDist, lat: lat, lon: lon, level: lvl });
            }
        });
    }

    // === ÚJ: AJTÓKERESŐ LOGIKA ===
    function getDoorsForRoom(roomFeature) {
        if (!roomFeature || roomFeature.geometry.type === 'Point') return [];
        
        const roomPoly = turf.polygon(roomFeature.geometry.coordinates);
        const roomLevels = getLevelsFromFeature(roomFeature);
        const doors = [];

        // Átalakítjuk a poligont vonallá a távolságméréshez
        const roomLine = turf.polygonToLine(roomPoly);
        if (!roomLine) return []; // Hiba esetén

        geoJsonData.features.forEach(f => {
            // Csak pont típusú ajtókat keresünk
            if (f.geometry.type !== 'Point') return;
            const p = f.properties;
            if (!p.entrance && !p.door) return;

            // Szint ellenőrzés: Az ajtónak ugyanazon a szinten kell lennie
            const doorLevels = getLevelsFromFeature(f);
            // Metszet keresése a szintek között (ha van közös szint)
            const commonLevel = roomLevels.some(l => doorLevels.includes(l));
            if (!commonLevel) return;

            // Távolság ellenőrzés: Rajta van-e a falon? (Max 1.2 méter tűréssel)
            const pt = turf.point(f.geometry.coordinates);
            const dist = turf.pointToLineDistance(pt, roomLine, {units: 'meters'});
            
            if (dist < 1.2) {
                doors.push(f);
            }
        });

        return doors;
    }

    function injectNodeIntoGraph(targetLat, targetLon, targetLevel, maxDistanceMeters = 5.0, sourceFeature = null) {
        // A "sourceFeature" alapú ajtókeresést KIVETTÜK, mert a startNavigation már megcsinálta!
        
        // 1. MEGLÉVŐ CSOMÓPONT KERESÉSE (Pontos egyezés)
        const exactKey = toKey(targetLat, targetLon, targetLevel);
        if (navigationGraph.has(exactKey)) {
            return { key: exactKey, lat: targetLat, lon: targetLon, level: targetLevel };
        }

        // 2. KORRIDOR VETÍTÉS (Snapping)
        let bestConnection = null;
        let minConnDist = Infinity;

        geoJsonData.features.forEach(f => {
            if (f.properties.highway !== 'corridor' || f.geometry.type !== 'LineString') return;
            const levels = getLevelsFromFeature(f);
            if (!levels.includes(targetLevel)) return;

            const line = turf.lineString(f.geometry.coordinates);
            const pt = turf.point([targetLon, targetLat]);
            const snapped = turf.nearestPointOnLine(line, pt);
            const dist = snapped.properties.dist * 1000;

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

        // 3. VÉGREHAJTÁS
        if (bestConnection) {
            const newLat = bestConnection.newLat;
            const newLon = bestConnection.newLon;
            const newKey = toKey(newLat, newLon, targetLevel);
            
            // Ha ez a pont már létezik a gráfon (véletlenül pont oda esett), használjuk
            if (navigationGraph.has(newKey)) return { key: newKey, lat: newLat, lon: newLon, level: targetLevel };

            if (!navigationGraph.has(newKey)) navigationGraph.set(newKey, []);

            const coords = bestConnection.segment.geometry.coordinates;
            const idx = bestConnection.snappedPoint.properties.index;
            
            if (idx !== undefined && idx < coords.length - 1) {
                const p1 = { lat: coords[idx][1], lon: coords[idx][0], level: targetLevel };
                const p2 = { lat: coords[idx+1][1], lon: coords[idx+1][0], level: targetLevel };
                const k1 = toKey(p1.lat, p1.lon, p1.level);
                const k2 = toKey(p2.lat, p2.lon, p2.level);
                
                let d1 = turf.distance(turf.point([newLon, newLat]), turf.point([p1.lon, p1.lat])) * 1000;
                let d2 = turf.distance(turf.point([newLon, newLat]), turf.point([p2.lon, p2.lat])) * 1000;
                d1 = Math.max(d1, 0.1); d2 = Math.max(d2, 0.1);
                
                // Milyen típusú út volt ez? (alap: walk)
                // Egyszerűsítés: feltételezzük, hogy séta.
                const type = 'walk'; 

                if (navigationGraph.has(k1)) {
                    navigationGraph.get(newKey).push({ key: k1, dist: d1, lat: p1.lat, lon: p1.lon, level: targetLevel });
                    navigationGraph.get(k1).push({ key: newKey, dist: d1, lat: newLat, lon: newLon, level: targetLevel });
                }
                if (navigationGraph.has(k2)) {
                    navigationGraph.get(newKey).push({ key: k2, dist: d2, lat: p2.lat, lon: p2.lon, level: targetLevel });
                    navigationGraph.get(k2).push({ key: newKey, dist: d2, lat: newLat, lon: newLon, level: targetLevel });
                }
                return { key: newKey, lat: newLat, lon: newLon, level: targetLevel };
            }
        }
        return null;
    }

    function findNearestNodeInGraph(targetLat, targetLon, targetLevel, toleranceMeters = 5.0) {
        let minDist = Infinity; let bestNode = null;
        const searchLevel = targetLevel || "0";
        for (const [key, neighbors] of navigationGraph.entries()) {
            const parts = key.split(',');
            const lat = parseFloat(parts[0]); const lon = parseFloat(parts[1]); const lvl = parts[2];
            if (lvl !== searchLevel) continue;
            const d = turf.distance(turf.point([targetLon, targetLat]), turf.point([lon, lat])) * 1000;
            if (d < toleranceMeters && d < minDist) { minDist = d; bestNode = { key: key, lat: lat, lon: lon, level: lvl }; }
        }
        return bestNode;
    }

    function findSmartToilet() {
        // 1. START ELLENŐRZÉS
        if (!selectedFeature) { 
            alert("Válassz ki egy helyet (Start), ahonnan WC-t keresel!"); 
            return; 
        }

        const c = turf.centroid(selectedFeature);
        const startLvl = getLevelsFromFeature(selectedFeature)[0] || "0";
        
        // 2. SZŰRÉS (Settings alapján)
        const mode = (typeof APP_SETTINGS !== 'undefined' && APP_SETTINGS.toiletMode) ? APP_SETTINGS.toiletMode : 'all';
        
        if (!geoJsonData || !geoJsonData.features) return;

        const toilets = geoJsonData.features.filter(f => {
            const p = f.properties; 
            if (!p) return false;
            
            // WC definíciók
            const isToilet = (p.room === 'toilet' || p.room === 'toilets' || p.room === 'wc' || p.amenity === 'toilets' || p.amenity === 'toilet');
            
            if (!isToilet) return false;

            // Nemek szűrése
            if (mode === 'all') return true;
            if (mode === 'male' && p.female === 'yes' && p.male !== 'yes') return false; 
            if (mode === 'female' && p.male === 'yes' && p.female !== 'yes') return false;
            return true;
        });

        if (toilets.length === 0) { 
            alert("Nem találtam WC-t az adatokban!"); 
            return; 
        }

        // 3. PONTOZÁS (Csak távolság és szint alapján)
        // Nem futtatunk Dijkstrát, bízunk a geometriában.
        toilets.forEach(t => {
            const tc = turf.centroid(t); 
            const distAir = turf.distance(c, tc) * 1000; // méter
            const tLvl = getLevelsFromFeature(t)[0] || "0";
            const levelDiff = Math.abs(parseFloat(startLvl) - parseFloat(tLvl));
            
            // Brutális büntetés az emeletre (hogy a saját szinten maradjon)
            // + Ha a "start" és a "cél" nagyon közel van (pl. szomszéd szoba), az a nyerő.
            t._score = distAir + (levelDiff * 2000); 
        });

        // 4. KIVÁLASZTÁS
        // A legkisebb pontszámú (legközelebbi) nyer
        const bestToilet = toilets.sort((a,b) => a._score - b._score)[0];

        if (bestToilet) {
            // 5. INDÍTÁS
            // Átadjuk a munkát a jól működő startNavigation-nek!
            // Ő majd elintézi a gráfépítést, ajtókeresést és a többit.

            console.log(`Navigálás ide: ${bestToilet.properties.name || "WC"} (Score: ${Math.round(bestToilet._score)})`);
            
            // Fontos: beállítjuk a Start pontot globálisan, hogy a navigáció tudja, honnan indulunk
            pendingNavSource = selectedFeature; 
            
            // JAVÍTÁS: Átadjuk a start pontot (selectedFeature) második paraméterként!
            startNavigation(bestToilet, selectedFeature); 
        } else {
            alert("Hiba: Nem sikerült kiválasztani a WC-t.");
        }
    }

    function startNavigation(targetFeature = null, fromFeature = null) {
        console.clear();
        buildRoutingGraph(); 
        
        const target = targetFeature || selectedFeature;
        if (!target) return;

        // --- STATE MENTÉSE (MEGOSZTÁSHOZ) ---
        activeRouteData = {
            start: fromFeature, // Lehet null (ha Main Entrance)
            end: target
        };

        // --- 1. START PONTOK BEKÖTÉSE (LISTA) ---
        let startNodes = [];
        
        if (fromFeature) {
            // A) PREFERÁLT SZINT KIVÁLASZTÁSA (Start)
            const fLevels = getLevelsFromFeature(fromFeature);
            // Ha a feature létezik az aktuális nézeten, akkor KÉNYSZERÍTJÜK azt a szintet.
            // Ha nem (pl. másik emeleten van), akkor marad az első elérhető szintje.
            const preferredStartLevel = fLevels.includes(currentLevel) ? currentLevel : fLevels[0];

            const doors = getDoorsForRoom(fromFeature);
            
            if (doors.length > 0) {
                doors.forEach(door => {
                    const doorLevels = getLevelsFromFeature(door);
                    // Csak akkor vesszük fel az ajtót, ha passzol a preferált szinthez!
                    // (Vagy ha az ajtónak nincs szintje, akkor a szobáét örökli)
                    const finalLvl = doorLevels.length > 0 ? doorLevels[0] : preferredStartLevel;
                    
                    // Ha az ajtó szintjei között, VAGY a kényszerített szinten van
                    if (doorLevels.includes(preferredStartLevel) || finalLvl === preferredStartLevel) {
                        const coords = door.geometry.coordinates;
                        const node = injectNodeIntoGraph(coords[1], coords[0], preferredStartLevel, 5.0);
                        if (node) startNodes.push(node);
                    }
                });
            }
            
            // Ha nincs ajtó (vagy nem a mi szintünkön van), marad a Centroid a preferált szinten
            if (startNodes.length === 0) {
                let c = turf.centroid(fromFeature);
                const node = injectNodeIntoGraph(c.geometry.coordinates[1], c.geometry.coordinates[0], preferredStartLevel, 20.0, fromFeature);
                if (node) startNodes.push(node);
            }
        } else {
            // Főbejárat (Main Entrance)
            if (!mainEntranceNode) { alert("Nincs bejárat definiálva!"); return; }
            const node = injectNodeIntoGraph(mainEntranceNode.lat, mainEntranceNode.lon, mainEntranceNode.level, 5.0);
            if (node) startNodes.push(node);
            else startNodes.push({ key: toKey(mainEntranceNode.lat, mainEntranceNode.lon, mainEntranceNode.level), ...mainEntranceNode });
        }

        if (startNodes.length === 0) { alert("Nem található start útvonalpont!"); return; }

        // --- 2. CÉL PONTOK BEKÖTÉSE (LISTA) ---
        let endNodes = [];
        
        // B) PREFERÁLT SZINT KIVÁLASZTÁSA (Cél)
        const tLevels = getLevelsFromFeature(target);
        // Ugyanaz a logika: ha a cél látható a mostani szinten, oda vigyen.
        // (Bár célnál ez ritkább, de pl. lépcsőnél hasznos: "ehhez a lépcsőhöz ezen a szinten")
        const preferredEndLevel = tLevels.includes(currentLevel) ? currentLevel : tLevels[0];

        const targetDoors = getDoorsForRoom(target);
        if (targetDoors.length > 0) {
            targetDoors.forEach(door => {
                const doorLevels = getLevelsFromFeature(door);
                // Itt megengedőbbek vagyunk: a cél bármelyik ajtaja jó lehet, DE
                // ha van preferált szint, próbáljuk azt előnyben részesíteni?
                // A Multi-Door logika miatt inkább felvesszük az összeset, és a Dijkstra dönt.
                // DE: Ha ez egy lift/lépcső, akkor csak a preferált szintre kéne navigálni.
                
                // Módosítás: Ha a feature több szintes (pl lépcső), akkor CSAK a preferált szintre teszünk pontot.
                // Ha szoba (általában 1 szintes), akkor mindegy.
                
                if (tLevels.length > 1) {
                    // Többszintes objektum (Lépcső/Lift): Csak az aktuális szintre navigáljon
                    if (doorLevels.includes(preferredEndLevel)) {
                         const coords = door.geometry.coordinates;
                         const node = injectNodeIntoGraph(coords[1], coords[0], preferredEndLevel, 5.0);
                         if (node) endNodes.push(node);
                    }
                } else {
                    // Egyszintes (Szoba): Jöhet bármelyik ajtó
                    const dl = doorLevels[0] || preferredEndLevel;
                    const coords = door.geometry.coordinates;
                    const node = injectNodeIntoGraph(coords[1], coords[0], dl, 5.0);
                    if (node) endNodes.push(node);
                }
            });
        }
        
        if (endNodes.length === 0) {
            // Centroid fallback
            let tLat, tLon;
            if (target.geometry.type === "Point") { tLat = target.geometry.coordinates[1]; tLon = target.geometry.coordinates[0]; } 
            else { const c = turf.centroid(target); tLat = c.geometry.coordinates[1]; tLon = c.geometry.coordinates[0]; }
            
            const node = injectNodeIntoGraph(tLat, tLon, preferredEndLevel, 20.0, target);
            if (node) endNodes.push(node);
            
            // Végső fallback
            if (endNodes.length === 0) {
                const near = findNearestNodeInGraph(tLat, tLon, preferredEndLevel, 40.0);
                if (near) endNodes.push(near);
            }
        }

        if (endNodes.length === 0) { alert("Nem található cél útvonalpont!"); return; }

        // --- 3. VERSENYFUTÁS ---
        let bestPath = null;
        let minDistance = Infinity; 
        let bestStartNode = null;
        let bestEndNode = null;

        console.log(`Routing: ${startNodes.length} start (Lvl: ${startNodes[0]?.level}) x ${endNodes.length} end (Lvl: ${endNodes[0]?.level})`);

        startNodes.forEach(sNode => {
            endNodes.forEach(eNode => {
                try {
                    const result = runDijkstra(sNode.key, eNode.key);
                    if (result) {
                        if (result.distance < minDistance) {
                            minDistance = result.distance;
                            bestPath = result.path;
                            bestStartNode = sNode;
                            bestEndNode = eNode;
                        }
                    }
                } catch (e) { /* no path */ }
            });
        });

        if (!bestPath) { alert("Nincs útvonal!"); return; }

        // --- 4. RAJZOLÁS ---
        try {
            drawRoute(bestPath);
            
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

            // --- F-013 & F-009: STATISZTIKA ÉS UI UPDATE ---

            currentRoutePath = bestPath; // Elmentjük a teljes útvonalat globálisan, hogy a focusOnRouteSegment lássa

            // --- JAVÍTÁS: Főbejárat kezelése ---
            if (pendingNavSource) {
                activeNavSource = pendingNavSource;
            } else {
                // Ha nincs kijelölt forrás, akkor a Főbejárattól indulunk (útvonal 0. pontja)
                const startParts = bestPath[0].split(',');
                activeNavSource = {
                    type: "Feature",
                    id: "main_entrance_virtual",
                    geometry: {
                        type: "Point",
                        // Figyelem: A kulcsban lat,lon van, a GeoJSON-ban lon,lat kell!
                        coordinates: [parseFloat(startParts[1]), parseFloat(startParts[0])]
                    },
                    properties: {
                        name: "Főbejárat", // Ezt fogja kiírni!
                        level: startParts[2],
                        indoor: "entrance"
                    }
                };
            }
            
            activeNavTarget = target; // Ez az "Ide" feature (a cél)

            const stats = calculateRouteStats(bestPath);
            const itinerary = generateItinerary(bestPath);
            
            // ÚJ: Átadjuk a start feature-t is a függvénynek!
            updateSheetForNavigation(target, stats, itinerary, activeNavSource);

            collapseToPeek();

        } catch (err) { console.error(err); alert("Hiba: " + err.message); }
    }

    // === F-013 & F-009: NAVIGÁCIÓS ADATOK ÉS ITINER ===

    function calculateRouteStats(pathKeys) {
        let totalDist = 0;
        let totalTime = 0;
        const WALK_SPEED = 1.3; // m/s (séta tempó)
        
        // Büntetések (másodpercben)
        const STAIRS_PENALTY = 15; // Emeletenként
        const ELEVATOR_WAIT = 45;  // Fix várakozás + beszállás
        
        // Előző pont adatai
        let prev = null;
        let activeElevator = false;

        pathKeys.forEach(key => {
            const parts = key.split(',');
            const current = { lat: parseFloat(parts[0]), lon: parseFloat(parts[1]), level: parts[2] };
            
            if (prev) {
                // 1. Távolság (Vízszintes)
                // Ha szintváltás van, a vízszintes távolság elhanyagolható (vagy 0),
                // de a turf.distance kiszámolja.
                const d = turf.distance([prev.lon, prev.lat], [current.lon, current.lat]) * 1000;
                totalDist += d;
                
                // 2. Idő
                if (prev.level === current.level) {
                    // Sima séta
                    totalTime += (d / WALK_SPEED);
                    activeElevator = false;
                } else {
                    // Szintváltás
                    // Detektáljuk, hogy ez lift vagy lépcső
                    // (Egyszerűsítés: Ha nagyot ugrik koordinátában, az nem lift. De a gráfban a lift egy helyben áll.)
                    const hDist = turf.distance([prev.lon, prev.lat], [current.lon, current.lat]) * 1000;
                    
                    if (hDist < 5.0) { // Ez valószínűleg lift (vagy csigalépcső)
                         // Ha már "liftben vagyunk" (több emeletet megyünk), nem adunk hozzá újabb várakozást
                         if (!activeElevator) {
                             totalTime += ELEVATOR_WAIT;
                             activeElevator = true;
                         }
                         // Maga az utazás ideje (pl. 10mp / emelet)
                         totalTime += 10; 
                    } else {
                        // Lépcső (messzebb vannak a fokok)
                        activeElevator = false;
                        totalTime += STAIRS_PENALTY;
                    }
                }
            }
            prev = current;
        });

        return {
            dist: Math.round(totalDist),
            time: Math.ceil(totalTime / 60) // Percben
        };
    }

    function generateItinerary(pathKeys) {
        const steps = [];
        if (!pathKeys || pathKeys.length === 0) return steps;

        let lastLevel = pathKeys[0].split(',')[2];

        // --- ÚJ: ADAT ALAPÚ DETEKTÁLÁS ---
        const detectVerticalType = (lat, lon, level) => {
            // 1. Átalakítás számokká a pontosság kedvéért
            const targetLat = parseFloat(lat);
            const targetLon = parseFloat(lon);
            const threshold = 0.00005; // Kb 5 méter sugarú körben keresünk feature-t

            // 2. Keresés a GeoJSON adatokban
            // Csak akkor keresünk, ha van adat. Ez egy gyors szűrés.
            if (geoJsonData && geoJsonData.features) {
                for (const f of geoJsonData.features) {
                    const p = f.properties;
                    
                    // Csak a releváns típusokat nézzük
                    const isElevator = p.highway === 'elevator' || p.amenity === 'elevator' || p.room === 'elevator' || p.lift_gate;
                    const isStairs = p.highway === 'steps' || p.room === 'stairs' || p.indoor === 'staircase' || p.room === 'staircase';

                    if (!isElevator && !isStairs) continue;

                    // Geometria ellenőrzése: Benne van-e a pont?
                    // (Egyszerűsítve: megnézzük a bounding boxot vagy a távolságot)
                    try {
                        const center = turf.center(f);
                        const c = center.geometry.coordinates;
                        // Turf koordináta: [lon, lat] !!!
                        const dist = Math.sqrt(Math.pow(c[1] - targetLat, 2) + Math.pow(c[0] - targetLon, 2));
                        
                        // Ha nagyon közel van a ponthoz (egyezés)
                        if (dist < threshold) {
                            return isElevator ? 'Lift' : 'Lépcső';
                        }
                    } catch(e) {}
                }
            }
            return null; // Nem találtunk konkrét adatot
        };

        for (let i = 1; i < pathKeys.length; i++) {
            const currKey = pathKeys[i];
            const prevKey = pathKeys[i-1];
            const currParts = currKey.split(',');
            const currLevel = currParts[2];
            
            // Ha SZINTVÁLTÁS történt
            if (currLevel !== lastLevel) {
                const direction = parseFloat(currLevel) > parseFloat(lastLevel) ? 'FEL' : 'LE';
                const label = levelAliases[currLevel] || currLevel;
                
                // 1. Próbáljuk meg adatból kitalálni (a kezdőpont vagy a végpont alapján)
                // Megnézzük az előző pontot (ahonnan indultunk) és a mostanit (ahova érkeztünk)
                let type = detectVerticalType(currParts[0], currParts[1], currLevel);
                
                // Ha az érkezési ponton nem találtunk, megnézzük az indulásit
                if (!type) {
                     const prevParts = prevKey.split(',');
                     type = detectVerticalType(prevParts[0], prevParts[1], prevParts[2]);
                }

                // 2. Ha adatból sincs meg, jön a MATEMATIKA (Fallback)
                if (!type) {
                    const p = prevKey.split(',');
                    const c = currKey.split(',');
                    // Távolság méterben
                    const dist = turf.distance([p[1], p[0]], [c[1], c[0]]) * 1000;
                    
                    // SZIGORÚBB KÜSZÖB: 
                    // A lift szinte mindig függőleges (< 2m elcsúszás).
                    // A lépcsőnek van hossza (> 2m).
                    type = (dist < 2.0) ? 'Lift' : 'Lépcső';
                }

                // Ikon kiválasztása
                // Ha van 'stairs' ikon a fontkészletben, használjuk azt, ha nincs, marad a nyíl
                let icon = 'north_east'; // Default FEL
                if (type === 'Lift') icon = 'elevator';
                else if (direction === 'LE') icon = 'south_east'; // Lépcső LE
                else icon = 'north_east'; // Lépcső FEL
                
                // Próbáljuk meg a specifikus lépcső ikont, ha lépcső
                // (Megjegyzés: a Material Symbols-ban van 'stairs' ikon, ha betöltötted)
                if (type === 'Lépcső') icon = 'stairs'; // Ha ez nem jelenik meg jól, cseréld vissza a nyilakra!

                // --- OKOS ÖSSZEVONÁS ---
                const lastStep = steps[steps.length - 1];
                
                if (lastStep && lastStep.type === 'transition' && 
                    lastStep.moveType === type && lastStep.direction === direction) {
                    
                    // FRISSÍTÉS
                    lastStep.text = `${type} ${direction} a(z) ${label}. szintre`;
                    lastStep.level = currLevel; 
                } else {
                    // ÚJ LÉPÉS
                    steps.push({
                        type: 'transition',
                        moveType: type,
                        direction: direction,
                        text: `${type} ${direction} a(z) ${label}. szintre`,
                        icon: icon,
                        level: currLevel
                    });
                }

                lastLevel = currLevel;
            }
        }
        
        return steps;
    }

    function runDijkstra(startKey, endKey) {
        const distances = new Map(); 
        const prev = new Map(); 
        const queue = [];
        
        distances.set(startKey, 0); 
        queue.push({ key: startKey, dist: 0 });
        
        const visited = new Set();
        let loopCounter = 0; const SAFETY_LIMIT = 15000; // Kicsit emeltem a limiten

        while (queue.length > 0) {
            loopCounter++; if (loopCounter > SAFETY_LIMIT) throw new Error("Végtelen ciklus!");
            
            queue.sort((a, b) => a.dist - b.dist);
            const { key: u, dist } = queue.shift();
            
            if (u === endKey) {
                const path = []; let curr = endKey;
                while (curr) { path.push(curr); curr = prev.get(curr); }
                // ITT A LÉNYEG: Visszaadjuk a távolságot is!
                return { path: path.reverse(), distance: dist };
            }
            
            if (visited.has(u)) continue; 
            visited.add(u);
            
            const neighbors = navigationGraph.get(u) || [];
            for (const n of neighbors) {
                if (!n.dist || isNaN(n.dist)) continue;
                
                // Door Penalty (Ajtón átmenés büntetése)
                let penalty = 0;
                // Csak akkor büntetünk, ha NEM a start vagy cél konkrét ajtaja
                if (doorNodes.has(n.key)) {
                    if (n.key !== startKey && n.key !== endKey) { 
                        penalty = 50.0; 
                    }
                }

                const alt = dist + n.dist + penalty;
                const currentDist = distances.get(n.key) !== undefined ? distances.get(n.key) : Infinity;
                
                if (alt < currentDist) { 
                    distances.set(n.key, alt); 
                    prev.set(n.key, u); 
                    queue.push({ key: n.key, dist: alt }); 
                }
            }
        }
        return null;
    }

    // === ÚTVONAL ELEMZŐ (Lépcső/Lift Ikonokhoz) ===
    function getVerticalMarkers(path) {
        const markers = [];
        if (!path || path.length < 2) return markers;

        // SEGÉDFÜGGVÉNY: Eldönti egy szintről-szintre ugrásról, hogy Lift vagy Lépcső-e
        const detectSegmentType = (pStart, pEnd) => {
            // 1. Matematikai becslés (Horizontális távolság)
            const hDist = turf.distance([pStart.lon, pStart.lat], [pEnd.lon, pEnd.lat]) * 1000;
            
            // Alapértelmezés: Ha kicsi a távolság, gyanúsan lift...
            let type = (hDist < 2.0) ? 'elevator' : 'stairs';

            // 2. Adatbázis/GeoJSON ellenőrzés (Pontosítás)
            // Megnézzük, van-e a közelben lift VAGY lépcsőház feature
            if (typeof geoJsonData !== 'undefined' && geoJsonData.features) {
                const pt = turf.point([pStart.lon, pStart.lat]);
                
                // Keressünk liftet vagy lépcsőházat a közelben (5 méter)
                const nearFeature = geoJsonData.features.find(f => {
                    const p = f.properties;
                    // LIFT CHECK
                    const isElevator = p.highway === 'elevator' || p.room === 'elevator' || p.amenity === 'elevator';
                    // STAIRS CHECK (Poligonok is!)
                    const isStairs = p.room === 'stairs' || p.indoor === 'staircase' || p.room === 'staircase' || p.highway === 'steps';
                    
                    if (!isElevator && !isStairs) return false;

                    // Geometriai távolság
                    let dist;
                    if (f.geometry.type === 'Point') {
                        dist = turf.distance(pt, f) * 1000;
                    } else {
                        // Poligonnál/Vonalnál a centroidot vagy a legközelebbi pontot nézzük
                        // Egyszerűsítés: Centroid
                        const c = turf.centroid(f);
                        dist = turf.distance(pt, c) * 1000;
                    }
                    
                    // Ha 5 méteren belül van, akkor ez az!
                    if (dist < 6.0) return true;
                    return false;
                });
                
                if (nearFeature) {
                    const p = nearFeature.properties;
                    if (p.highway === 'elevator' || p.room === 'elevator' || p.amenity === 'elevator') {
                        type = 'elevator';
                    } else {
                        // Minden más esetben (highway=steps VAGY room=stairs poligon) LÉPCSŐ
                        type = 'stairs';
                    }
                }
            }
            
            return type;
        };

        for (let i = 0; i < path.length - 1; i++) {
            const curr = path[i];
            const next = path[i+1];

            // 1. START: Itt kezdődik a szintváltás
            if (curr.level !== next.level) {
                
                // Meghatározzuk a KEZDŐ típust (pl. "stairs")
                const currentType = detectSegmentType(curr, next);
                
                const startLevel = curr.level;
                let finalLevel = next.level;
                
                // j: A felfedező index
                let j = i + 1;
                let floorEntryPoint = next; 

                while (j < path.length - 1) {
                    const p1 = path[j];
                    const p2 = path[j+1];
                    
                    // A) Sétálunk a köztes emeleten (nincs szintváltás)
                    if (p1.level === p2.level) {
                        const distOnFloor = turf.distance([floorEntryPoint.lon, floorEntryPoint.lat], [p2.lon, p2.lat]) * 1000;
                        if (distOnFloor > 15.0) break; 
                    } 
                    // B) Újabb szintváltás történik (p1 -> p2)
                    else {
                        const nextSegmentType = detectSegmentType(p1, p2);
                        // Ha a típus megváltozik (lépcső -> lift), megszakítjuk
                        if (nextSegmentType !== currentType) break;

                        floorEntryPoint = p2;
                        finalLevel = p2.level; 
                    }
                    j++;
                }

                if (startLevel !== finalLevel) {
                    const direction = parseFloat(finalLevel) > parseFloat(startLevel) ? 'up' : 'down';
                    const iconArrow = direction === 'up' ? 'arrow_upward' : 'arrow_downward';
                    const displayLevel = (typeof levelAliases !== 'undefined' && levelAliases[finalLevel]) ? levelAliases[finalLevel] : finalLevel;

                    markers.push({
                        lat: curr.lat,
                        lon: curr.lon,
                        level: curr.level,
                        type: currentType, 
                        targetLabel: displayLevel,
                        icon: iconArrow
                    });
                }
                i = j - 1; 
            }
        }
        return markers;
    }

    // === IRÁNYJELZŐ NYILAK GENERÁLÁSA ===
    function drawDirectionArrows(pathKeys) {
        routeArrowsLayerGroup.clearLayers();

        const points = pathKeys.map(k => {
            const p = k.split(',');
            return { lat: parseFloat(p[0]), lon: parseFloat(p[1]), level: p[2] };
        });

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i+1];

            // Csak vízszintes szakaszon
            if (p1.level === p2.level) {
                const pt1 = turf.point([p1.lon, p1.lat]);
                const pt2 = turf.point([p2.lon, p2.lat]);
                const dist = turf.distance(pt1, pt2) * 1000;

                // Csak ha elég hosszú a szakasz (> 4m)
                if (dist > 4.0) {
                    const bearing = turf.bearing(pt1, pt2);
                    const mid = turf.midpoint(pt1, pt2);
                    
                    // --- ITT A MÓDOSÍTOTT SVG ---
                    const arrowSvg = `
                        <svg viewBox="0 0 24 24" 
                             style="width: 100%; height: 100%; transform: rotate(${bearing}deg) scale(0.7); overflow: visible; opacity: 1.0;"> <line x1="12" y1="22" x2="12" y2="8" 
                                  stroke="var(--color-arrow)" 
                                  stroke-width="2" 
                                  stroke-linecap="round" />
                            
                            <path d="M12 2 L9.5 8 L14.5 8 Z" 
                                  fill="var(--color-arrow)" 
                                  stroke="var(--color-arrow)" 
                                  stroke-width="1" 
                                  stroke-linejoin="round" /> 
                        </svg>
                    `;

                    const arrowIcon = L.divIcon({
                        className: 'arrow-svg-icon',
                        html: arrowSvg,
                        iconSize: [24, 24], 
                        iconAnchor: [12, 12] 
                    });

                    const marker = L.marker([mid.geometry.coordinates[1], mid.geometry.coordinates[0]], {
                        icon: arrowIcon,
                        interactive: false,
                        pane: 'arrowPane'
                    });
                    
                    marker.feature = { properties: { level: p1.level } };
                    routeArrowsLayerGroup.addLayer(marker);
                }
            }
        }
    }

    function drawRoute(pathKeys) {
        routeLayerGroup.clearLayers();
        routeMarkersLayerGroup.clearLayers(); // Töröljük a régi markereket
        routeArrowsLayerGroup.clearLayers();
        
        const latlngs = [];
        const boundsPoints = [];

        pathKeys.forEach(k => {
            const parts = k.split(',');
            const lat = parseFloat(parts[0]);
            const lon = parseFloat(parts[1]);
            latlngs.push({ lat: lat, lon: lon, level: parts[2] });
            boundsPoints.push([lat, lon]); 
        });

        // 1. VONALAK RAJZOLÁSA (Régi logika)
        for (let i = 0; i < latlngs.length - 1; i++) {
            const p1 = latlngs[i]; 
            const p2 = latlngs[i+1];
            const isStairs = p1.level !== p2.level;
            
            const style = { 
                color: isStairs ? 'var(--color-route-secondary)' : 'var(--color-route-primary)', 
                weight: 5, 
                dashArray: isStairs ? '10, 10' : null, 
                pane: 'routePane' 
            };
            
            const polyline = L.polyline([[p1.lat, p1.lon], [p2.lat, p2.lon]], style);
            polyline.feature = { properties: { level: p1.level, levels: isStairs ? [p1.level, p2.level] : null } };
            routeLayerGroup.addLayer(polyline);
        }

        // 2. VERTIKÁLIS MARKEREK GENERÁLÁSA (ÚJ!)
        const vMarkers = getVerticalMarkers(latlngs);
        
        vMarkers.forEach(vm => {
            let html = '';
            if (vm.type === 'elevator') {
                html = `<div class="nav-marker-container">
                            <div class="nav-badge-elevator">
                                <span>${vm.targetLabel}</span>
                            </div>
                        </div>`;
            } else {
                html = `<div class="nav-marker-container">
                            <div class="nav-badge-stairs">
                                <span class="material-symbols-outlined nav-arrow">${vm.icon}</span>
                                <span>${vm.targetLabel}</span>
                            </div>
                        </div>`;
            }

            const icon = L.divIcon({
                className: 'custom-div-icon', // Üres class, hogy ne legyen default háttér
                html: html,
                iconSize: [40, 40],
                iconAnchor: [20, 20] 
            });

            const marker = L.marker([vm.lat, vm.lon], { 
                icon: icon, 
                interactive: false, 
                pane: 'navMarkerPane'
            });
            // Fontos: Elmentjük a szintet a markerbe, hogy szűrhető legyen!
            marker.feature = { properties: { level: vm.level } };
            routeMarkersLayerGroup.addLayer(marker);
        });

        // 3. IRÁNYJELZŐ NYILAK
        drawDirectionArrows(pathKeys);

        // 4. ZOOM ÉS START
        if (boundsPoints.length > 0) {
            const bounds = L.latLngBounds(boundsPoints);
            map.fitBounds(bounds, {
                paddingTopLeft: [50, 50],
                paddingBottomRight: [50, 150],
                animate: true, duration: 1.0
            });
        }
        switchLevel(latlngs[0].level);
    }
    function drawWalkLine(lat1, lon1, lat2, lon2, level) {
        const polyline = L.polyline([[lat1, lon1], [lat2, lon2]], { color: 'white', weight: 2, dashArray: '5, 5', opacity: 0.7, pane: 'routePane' });
        polyline.feature = { properties: { level: level } };
        routeLayerGroup.addLayer(polyline);
    }
    // LÁTHATÓSÁG KEZELÉSE (Markerek is!)
    function updateRouteVisibility(level) {
        // Vonalak
        routeLayerGroup.eachLayer(layer => {
            const p = layer.feature.properties;
            if ((p.levels && p.levels.includes(level)) || p.level === level) layer.setStyle({ opacity: 1 });
            else layer.setStyle({ opacity: 0.1 });
        });
        
        // Markerek
        routeMarkersLayerGroup.eachLayer(layer => {
            const p = layer.feature.properties;
            if (p.level === level) {
                layer.setOpacity(1);
                // Biztos ami biztos, tegyük a DOM-ban is láthatóvá (Leaflet néha csak opacityt állít)
                if(layer._icon) layer._icon.style.display = 'block';
            } else {
                layer.setOpacity(0);
                if(layer._icon) layer._icon.style.display = 'none';
            }
        });

        // NYILAK - Ugyanaz a logika, mint a markereknél
        routeArrowsLayerGroup.eachLayer(layer => {
            const p = layer.feature.properties;
            if (p.level === level) {
                layer.setOpacity(1);
                if(layer._icon) layer._icon.style.display = 'block';
            } else {
                layer.setOpacity(0);
                if(layer._icon) layer._icon.style.display = 'none';
            }
        });
    }

    function processLevels() {
        const levels = new Set();
        levelAliases = {}; // Reset
        
        if (!geoJsonData) return;
        
        geoJsonData.features.forEach(feature => { 
            const p = feature.properties;
            
            // Relevancia szűrés
            const isRelevant = (
                p.highway === 'corridor' || p.highway === 'steps' || p.room || 
                p.amenity === 'toilets' || p.entrance || p.door ||
                p.indoor === 'room' || p.indoor === 'area' || p.indoor === 'corridor'
            );

            if (isRelevant) {
                const feats = getLevelsFromFeature(feature); 
                
                // Szintek gyűjtése
                feats.forEach(l => levels.add(l));

                // ALIAS GYŰJTÉS (JAVÍTVA)
                // Csak akkor mentsük el globális aliasként (a gombokhoz),
                // ha a feature KIZÁRÓLAG EGY szinten van!
                // Így a "level=2-3, level:ref=1;2" nem cseszi el a gombokat.
                if (p['level:ref'] && feats.length === 1) {
                    levelAliases[feats[0]] = p['level:ref'];
                }
            }
        });
        
        availableLevels = Array.from(levels).sort((a, b) => parseFloat(a) - parseFloat(b));
        
        if (availableLevels.includes("0")) currentLevel = "0";
        else if (availableLevels.length > 0) currentLevel = availableLevels[0];
        else currentLevel = "0";
    }

    function createLevelControls() {
        document.querySelectorAll('.level-control').forEach(e => e.remove());
        const control = L.control({ position: 'topright' });
        
        control.onAdd = function(map) {
            const div = L.DomUtil.create('div', 'level-control');
            
            L.DomEvent.disableScrollPropagation(div);
            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.on(div, 'touchstart', L.DomEvent.stopPropagation);
            L.DomEvent.on(div, 'touchmove', L.DomEvent.stopPropagation);

            // Gombok generálása
            availableLevels.slice().reverse().forEach(lvl => {
                const btn = document.createElement('button');
                
                // ITT A LÉNYEG: Elmentjük a technikai szintet (pl. "1")
                btn.dataset.level = lvl; 
                
                // A felirat jöhet az aliasból (pl. "MF")
                const label = levelAliases[lvl] || lvl;
                btn.innerText = label;
                
                // Kezdő állapot beállítása
                btn.className = 'level-btn ' + (lvl === currentLevel ? 'active' : '');
                
                btn.onclick = (e) => { 
                    L.DomEvent.stopPropagation(e); 
                    switchLevel(lvl); 
                };
                div.appendChild(btn);
            });
            return div;
        };
        control.addTo(map);
    }

    function updateLevelUI() {
        // Végigmegyünk az összes gombon
        document.querySelectorAll('.level-btn').forEach(btn => {
            // Összehasonlítjuk a gomb rejtett adatát a jelenlegi szinttel
            if (btn.dataset.level === currentLevel.toString()) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function switchLevel(level) {
        currentLevel = level.toString(); // Biztos ami biztos, legyen string
        
        // 1. Térkép frissítése
        renderLevel(currentLevel);
        
        // 2. UI Gombok frissítése (EZT ADTUK HOZZÁ)
        updateLevelUI();
        
        console.log("Switched to level:", currentLevel, "(Alias:", levelAliases[currentLevel] || "N/A", ")");
    }
    /* ITT VOLT SMARTFILTER
    function smartFilter(term) {
        const cleanTerm = term.toLowerCase().trim();
        let strippedTerm = null;
        if (currentBuilding.regex.test(cleanTerm)) { strippedTerm = cleanTerm.replace(currentBuilding.regex, ''); }
        return geoJsonData.features.filter(f => {
            const p = f.properties; const name = (p.name || "").toLowerCase(); const ref = (p.ref || "").toLowerCase(); const levels = getLevelsFromFeature(f);
            if (name.includes(cleanTerm) || ref.includes(cleanTerm)) return true;
            if (strippedTerm && strippedTerm.length > 1) { if (name.includes(strippedTerm) || ref.includes(strippedTerm)) return true; }
            return false;
        });
    }
    */

    // === OKOS KAMERA MOZGATÁS (OFFSET LOGIKA) ===
    function smartFlyTo(feature) {
        if (!feature) return;

        // 1. Koordináta meghatározása (Középpont)
        let lat, lon;
        if (feature.geometry.type === "Point") {
            lat = feature.geometry.coordinates[1];
            lon = feature.geometry.coordinates[0];
        } else {
            const c = turf.centroid(feature);
            lat = c.geometry.coordinates[1];
            lon = c.geometry.coordinates[0];
        }

        // 2. Mennyit takar ki az UI az aljából?
        let bottomOffset = 0;
        
        const sheet = document.getElementById('bottom-sheet');
        const settingsModal = document.getElementById('settings-modal');
        
        // A) Ha a Bottom Sheet nyitva van (Sheet mód)
        if (sheet.classList.contains('open')) {
            // A látható magasságot vesszük figyelembe
            bottomOffset = sheet.getBoundingClientRect().height;
        } 
        // B) Ha a Theme Editor nyitva van (Editor mód)
        else if (settingsModal.classList.contains('editor-mode')) {
            // A kártya magassága
            const card = settingsModal.querySelector('.settings-card');
            if (card) bottomOffset = card.getBoundingClientRect().height;
        }

        // 3. Cél Zoom Szint
        const targetZoom = 20;

        // 4. MÁGIA: Pixel alapú eltolás
        // Átvetítjük a koordinátát pixelekre az adott zoom szinten
        const centerPoint = map.project([lat, lon], targetZoom);
        
        // Hozzáadunk az Y tengelyhez (lefelé) a takarás felét.
        // Miért? Mert ha a kamera lejjebb néz, a célpont feljebb kerül a képernyőn.
        // Ha 300px a sheet, akkor 150px-el lejjebb kell célozni a kamerával,
        // hogy a pont 150px-el feljebb (a maradék hely közepén) legyen.
        centerPoint.y += (bottomOffset / 2); // Kicsit kevesebbet is lehet (pl / 2.2), ha a fejlécet is beszámítjuk

        // Visszavetítjük koordinátára
        const targetLatLng = map.unproject(centerPoint, targetZoom);

        // Repülés
        map.flyTo(targetLatLng, targetZoom, {
            animate: true,
            duration: 0.8 // Kicsit gyorsabb, pattogósabb
        });
        
        // Ha szükséges, szintet váltunk
        const levels = getLevelsFromFeature(feature);
        if (levels.length > 0 && !levels.includes(currentLevel)) {
            switchLevel(levels[0]);
        }
    }

    function zoomToFeature(feature) {
         smartFlyTo(feature);
    }

    // === BOTTOM SHEET DRAG LOGIC v2 (SNAP & SPRING) ===
    const sheet = document.getElementById('bottom-sheet');
    const handle = document.getElementById('sheet-handle');
    const content = document.getElementById('sheet-scroll-content');
    const footer = document.querySelector('.sheet-footer');
    const header = document.querySelector('.sheet-header');
    
    let startY = 0;
    let startHeight = 0;
    let isDragging = false;
    let lastY = 0; // Sebességméréshez
    let velocity = 0;

    // Kiszámolja a minimum magasságot (Peek), ahol csak a gombok és a cím látszik
    function getPeekHeight() {
        const handleH = handle.offsetHeight || 25;
        const headerH = header.offsetHeight || 60;
        const footerH = footer.offsetHeight || 80;
        // +10px ráhagyás, hogy ne legyen zsúfolt
        return handleH + headerH + footerH + 10;
    }

    // Kiszámolja az "Auto" magasságot (tartalomhoz igazítva)
    function getAutoHeight() {
        const contentH = content.scrollHeight;
        const peekH = getPeekHeight();
        const total = peekH + contentH;
        // De ne legyen nagyobb, mint a képernyő 60%-a alapból
        return Math.min(total, window.innerHeight * 0.6);
    }

    function collapseToPeek() {
        const peekH = getPeekHeight();
        sheet.style.height = `${peekH}px`;
        sheet.style.transition = 'height 0.3s ease-out';
        sheet.classList.add('open');
        // Ha esetleg el volt görgetve a tartalom, tekerjük vissza
        document.getElementById('sheet-scroll-content').scrollTop = 0;
    }

    // === ESEMÉNYEK ===

    handle.addEventListener('touchstart', (e) => {
        isDragging = true;
        startY = e.touches[0].clientY;
        lastY = startY;
        velocity = 0;
        startHeight = sheet.getBoundingClientRect().height;
        sheet.style.transition = 'none'; // Drag közben nincs animáció (azonnali reakció)
    }, {passive: true});

    // === KLIKK A KERESŐN KÍVÜL (Focus Lost) ===
    document.addEventListener('click', (e) => {
        const searchWrapper = document.getElementById('search-wrapper');
        const resultsDiv = document.getElementById('search-results');
        
        // Ha a kattintás NEM a keresőben történt, és a lista látható
        if (!searchWrapper.contains(e.target) && resultsDiv.style.display !== 'none') {
            resultsDiv.style.display = 'none';
        }
    });

    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const currentY = e.touches[0].clientY;
        const deltaY = startY - currentY; // Felfelé pozitív
        const newHeight = startHeight + deltaY;
        
        // Sebesség számítása (Pöccintéshez)
        velocity = currentY - lastY; // Pozitív = lefelé, Negatív = felfelé
        lastY = currentY;

        const peekH = getPeekHeight();
        const maxH = window.innerHeight * 0.9;

        // Csak ésszerű határok között engedjük húzni
        if (newHeight >= peekH * 0.8 && newHeight <= maxH) {
            sheet.style.height = `${newHeight}px`;
        }
    }, {passive: true});

    document.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        sheet.style.transition = 'height 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)'; // Ruganyos effekt (Spring)
        
        const currentHeight = sheet.getBoundingClientRect().height;
        const peekH = getPeekHeight();
        const autoH = getAutoHeight();
        const maxH = window.innerHeight * 0.85;

        // LOGIKA: Hova ugorjon elengedéskor?
        
        // 1. Ha lefelé pöccintettél (gyors mozdulat) -> PEEK
        if (velocity > 10) {
            sheet.style.height = `${peekH}px`;
        }
        // 2. Ha felfelé pöccintettél -> AUTO (vagy MAX)
        else if (velocity < -10) {
            if (currentHeight < autoH) sheet.style.height = `${autoH}px`;
            else sheet.style.height = `${maxH}px`;
        }
        // 3. Ha lassan húztad, nézzük a pozíciót
        else {
            // Távolságok a snap pontoktól
            const distToPeek = Math.abs(currentHeight - peekH);
            const distToAuto = Math.abs(currentHeight - autoH);
            const distToMax = Math.abs(currentHeight - maxH);

            // Melyikhez van legközelebb?
            if (distToPeek < distToAuto && distToPeek < distToMax) {
                sheet.style.height = `${peekH}px`;
            } else if (distToMax < distToAuto) {
                sheet.style.height = `${maxH}px`;
            } else {
                sheet.style.height = `${autoH}px`;
            }
        }
        
        // Ha PEEK-be megyünk, rejtsük el a scrollbart vizuálisan (opcionális clean up)
        if (sheet.style.height === `${peekH}px`) content.scrollTop = 0;
    });

    // KLIKK A FOGANTYÚRA (Toggle)
    handle.addEventListener('click', () => {
        const currentH = sheet.getBoundingClientRect().height;
        const peekH = getPeekHeight();
        const autoH = getAutoHeight();

        sheet.style.transition = 'height 0.3s ease-out';

        // Ha lent van (vagy közel hozzá) -> NYITÁS
        if (currentH < peekH + 50) {
            sheet.style.height = `${autoH}px`;
        } 
        // Ha nyitva van -> ZÁRÁS (PEEK)
        else {
            sheet.style.height = `${peekH}px`;
        }
    });


    // === SHARE & DEEP LINK LOGIC ===

    // 1. ADAT KINYERÉSE FEATURE-BŐL (PRIORITÁS FIX)
    function getFeatureId(feature) {
        if (!feature) return null;
        const p = feature.properties;
        const lvl = getLevelsFromFeature(feature)[0] || "0";

        // --- ITT A VÁLTOZÁS: AZ ID KERÜLT AZ ELSŐ HELYRE ---
        
        // 1. OSM ID (A legpontosabb, egyedi azonosító)
        // Ezzel elkerüljük, hogy név alapján véletlenül a szomszéd folyosót találja meg.
        if (feature.id) return { type: 'id', val: feature.id, lvl: lvl };

        // 2. Ref / Név (Csak fallback, ha valamiért nincs ID)
        if (p.ref) return { type: 'ref', val: p.ref, lvl: lvl };
        if (p.name) return { type: 'name', val: p.name, lvl: lvl };
        
        // 3. Koordináta (Végső eset)
        const c = turf.centroid(feature);
        return { 
            type: 'coord', 
            lat: c.geometry.coordinates[1].toFixed(6), 
            lon: c.geometry.coordinates[0].toFixed(6),
            lvl: lvl
        };
    }

    // 1. A FELOKOSÍTOTT TOAST (Szöveget is vár)
    function showToast(message) {
        const t = document.getElementById('toast-notification');
        if (message) t.innerText = message; // Ha kap szöveget, átírja
        t.classList.add('visible');
        setTimeout(() => t.classList.remove('visible'), 3000);
    }

    // 2. MEGOSZTÁS GOMB KEZELŐ
    function shareCurrentState() {
        let payload = { b: currentBuildingKey }; // Épület mindig kell

        if (activeRouteData) {
            // Útvonal megosztása
            payload.mode = 'route';
            payload.s = getFeatureId(activeRouteData.start); // Start (lehet null -> Main Entrance)
            payload.e = getFeatureId(activeRouteData.end);   // End
        } else if (selectedFeature) {
            // Csak egy hely megosztása
            payload.mode = 'loc';
            payload.t = getFeatureId(selectedFeature);
        } else {
            return; // Nincs mit megosztani
        }

        // Kódolás: JSON -> String -> UTF8 Fix -> Base64
        const jsonStr = JSON.stringify(payload);
        // UTF-8 karakterek kezelése btoa előtt:
        const encoded = btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g,
            function toSolidBytes(match, p1) { return String.fromCharCode('0x' + p1); }));

        // URL generálás
        const url = new URL(window.location.href);
        url.searchParams.set('share', encoded);

        // Vágólapra másolás
        navigator.clipboard.writeText(url.toString()).then(() => {
            showToast("Link másolva! 📋");
        }).catch(err => {
            console.error('Copy failed', err);
            prompt("Másold ki a linket:", url.toString());
        });
    }

    // 3. URL FELDOLGOZÁS (BETÖLTÉSKOR)
    async function processUrlParams() {
        const params = new URLSearchParams(window.location.search);
        const shareCode = params.get('share');
        if (!shareCode) return;

        try {
            // Dekódolás: Base64 -> UTF8 Fix -> JSON
            const jsonStr = decodeURIComponent(atob(shareCode).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            
            const data = JSON.parse(jsonStr);
            console.log("Deep Link Data:", data);

            // Ha más épületben vagyunk, mint a link, VÁLTÁS!
            // (Ez trükkös, mert a changeBuilding újratölti az adatokat)
            // Ezért ezt a logikát a loadOsmData hívása ELŐTT kell kezelni az init-ben.
            
            // ITT már feltételezzük, hogy jó épületben vagyunk és betöltött az OSM.
            
            // Feature kereső segéd (ID Supporttal)
            const findFeat = (desc) => {
                if (!desc) return null;
                
                // A) ID ALAPÚ KERESÉS (Legpontosabb)
                if (desc.type === 'id') {
                    // Közvetlen keresés a memóriában lévő adatok között
                    return geoJsonData.features.find(f => f.id === desc.val);
                }

                // B) KOORDINÁTA ALAPÚ (Még mindig TODO, de ritka)
                if (desc.type === 'coord') {
                    return null; // Ide jöhetne egy turf.nearest, de az ID most megoldja
                }
                
                // C) NÉV/REF ALAPÚ (Smart Filter)
                const hits = smartFilter(desc.val);
                if (hits.length > 0 && desc.lvl) {
                    const exact = hits.find(h => getLevelsFromFeature(h).includes(desc.lvl));
                    return exact || hits[0];
                }
                return hits[0];
            };

            if (data.mode === 'loc') {
                const target = findFeat(data.t);
                if (target) {
                    // FIX: Kivettük a zoomToFeature-t (az openSheet úgyis hívja).
                    // Kis késleltetés (300ms) kell, hogy a renderelés után a térkép "magához térjen" és a flyTo működjön.
                    setTimeout(() => {
                        openSheet(target);
                    }, 300);
                }
            } else if (data.mode === 'route') {
                const endFeature = findFeat(data.e);
                const startFeature = findFeat(data.s); // Ha null, az a Main Entrance lesz a startNavigation-ben
                
                if (endFeature) {
                    // Sárga keret kirajzolása a célpontra
                    drawSelectedHighlight(endFeature);

                    // A sheet fejlécének kitöltése a célpont adataival,
                    // hogy a navigációs "peek" nézetben is a helyes név jelenjen meg.
                    const p = endFeature.properties;
                    let typeName = getHungarianType(p);
                    typeName = typeName.charAt(0).toUpperCase() + typeName.slice(1);
                    
                    let displayName = p.name || p.ref;
                    if (!displayName) {
                        displayName = typeName;
                    }
            
                    let displayLevelString = "";
                    if (p['level:ref']) {
                        displayLevelString = p['level:ref'];
                    } else {
                        const rawLevels = getLevelsFromFeature(endFeature);
                        const mappedLevels = rawLevels.map(lvl => levelAliases[lvl] || lvl);
                        displayLevelString = mappedLevels.join(', ');
                    }
            
                    document.getElementById('sheet-title').innerText = displayName;
                    if (displayName === typeName) {
                        document.getElementById('sheet-sub').innerText = `Szin: ${displayLevelString}`;
                    } else {
                        document.getElementById('sheet-sub').innerText = `Szin: ${displayLevelString} | ${typeName}`;
                    }

                    // Navigáció indítása
                    startNavigation(endFeature, startFeature);
                }
            }
            
            // URL tisztítása (hogy frissítéskor ne fusson le újra)
            window.history.replaceState({}, document.title, window.location.pathname);

        } catch (e) {
            console.error("Deep Link Error:", e);
        }
    }

    // === GLOBÁLIS ZÁR A GESZTUSOKHOZ ===
    // Ez akadályozza meg, hogy zoomolás közben kattintsunk
    window.isMapInteractionLocked = false;
    window.clickTimeout = null; // ÚJ: A kattintás késleltetéséhez

    // === F-014: ONE FINGER ZOOM (Safe Mode) ===
    function enableOneFingerZoom(map) {
        const container = map.getContainer();
        let lastTap = 0;
        let startY = 0;
        let startZoom = 0;
        let isZooming = false;

        container.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) return;

            // ÚJ: Ha bármilyen érintés történik, azonnal töröljük az előző (várakozó) kattintást!
            // Ez a kulcs: a második ujjlenyomás megöli az első kattintást.
            if (window.clickTimeout) {
                clearTimeout(window.clickTimeout);
                window.clickTimeout = null;
            }

            const now = Date.now();
            
            // Ha dupla koppintás gyanús (300ms-en belül)
            if (now - lastTap < 300) {
                window.isMapInteractionLocked = true;
                isZooming = true;
                startY = e.touches[0].clientY;
                startZoom = map.getZoom();
                map.dragging.disable();
            }
            lastTap = now;
        });

        container.addEventListener('touchmove', (e) => {
            if (!isZooming) return;
            
            // Zár megerősítése mozgás közben
            window.isMapInteractionLocked = true;

            const y = e.touches[0].clientY;
            const delta = y - startY; 
            
            if (Math.abs(delta) > 10) {
                if(e.cancelable) e.preventDefault();
                
                const sensitivity = 250; 
                const zoomChange = delta / sensitivity;
                map.setZoom(startZoom + zoomChange, { animate: false });
            }
        }, { passive: false });

        container.addEventListener('touchend', (e) => {
            // Ha vége a gesztusnak (akár zoomoltunk, akár csak dupla kopp volt)
            if (isZooming || window.isMapInteractionLocked) {
                isZooming = false;
                map.dragging.enable();

                // 2. KÉSLELTETETT FELOLDÁS
                // Fontos: A 'click' esemény a touchend UTÁN sül el pár milliszekundummal.
                // Ezért várunk 400ms-t, mielőtt visszaengedjük a kattintást.
                setTimeout(() => {
                    window.isMapInteractionLocked = false;
                }, 400);
            }
        });
    }

    enableOneFingerZoom(map);

    // === INITIALIZATION ===
    initBuildings();
    renderThemeSelector();
    applyTheme();

    // 1. URL Check: Melyik épületet töltsük be?
    const params = new URLSearchParams(window.location.search);
    const shareCode = params.get('share');
    let buildingToLoad = "K"; // Default

    if (shareCode) {
        try {
            // Csak az épületkódot szedjük ki gyorsan
            const jsonStr = decodeURIComponent(atob(shareCode).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            const data = JSON.parse(jsonStr);
            if (data.b && BUILDINGS[data.b]) {
                buildingToLoad = data.b;
                console.log("Deep Link Building Switch:", buildingToLoad);
            }
        } catch(e) { console.warn("Invalid Share Code"); }
    }

    // 2. Épület beállítása és betöltése
    if (buildingToLoad !== currentBuildingKey) {
        changeBuilding(buildingToLoad); 
    } else {
        loadOsmData(); // Ha maradt a K, töltsük be kézzel
    }

    // 3. GPS ellenőrzés indítása a háttérben
    detectClosestBuilding(); 

    // 3. Deep Link feldolgozása (Csak miután az OSM betöltött!)
    // Ehhez bele kell nyúlni a loadOsmData-ba! (Lásd F pont)