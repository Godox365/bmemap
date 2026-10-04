const fs = require('fs');
const path = require('path');

// Az épületek koordinátái
const BUILDINGS = {
    "k": [47.4816562, 19.0559196],
    "i": [47.472616, 19.059552],
    "q": [47.473410, 19.059555],
    "e": [47.477857, 19.057739],
    "r": [47.4789527, 19.0591848],
    "kt": [47.480874, 19.054276]
};

// Overpass szerverlista prioritás sorrendben
const OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter", // Elsődleges, stabil szerver (Németország)
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter", // Gyors válaszidejű tartalék szerver (Mail.ru)
    "https://overpass.private.coffee/api/interpreter"
];

// Összevont Overpass QL lekérdezés: minden épületet egyszerre kérünk le egyetlen kéréssel
function buildBatchQuery() {
    const findBuildings = Object.entries(BUILDINGS).map(([key, center]) => `
        way(around:5, ${center[0]}, ${center[1]})["building"]["building"!="bridge"]["building"!="roof"];
        relation(around:5, ${center[0]}, ${center[1]})["building"]["building"!="bridge"]["building"!="roof"];
    `).join("\n");

    return `[out:json][timeout:180];
        (
            ${findBuildings}
        )->.allTargetBuildings;
        
        .allTargetBuildings map_to_area -> .allSearchAreas;
        
        (
            way["indoor"](area.allSearchAreas);
            relation["indoor"](area.allSearchAreas);
            way["highway"~"corridor|steps"](area.allSearchAreas);
            node["entrance"](area.allSearchAreas);
            node["door"](area.allSearchAreas);
            way["building:part"](area.allSearchAreas);
            way["room"~"stairs|toilet|toilets"](area.allSearchAreas);
            
            .allTargetBuildings;
            
            node["amenity"~"vending_machine|microwave|atm|cafe|fast_food|restaurant"](area.allSearchAreas);
            way["amenity"~"vending_machine|microwave|atm|cafe|fast_food|restaurant"](area.allSearchAreas);
            node["shop"="kiosk"](area.allSearchAreas);
            way["shop"="kiosk"](area.allSearchAreas);
        );
        out body;
        >;
        out skel qt;`;
}

// Fallback logika: Ha az egyik szerver nem működik, megy a következőre
async function fetchWithFallback(query) {
    for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
        const server = OVERPASS_SERVERS[i];
        console.log(`\n📡 Próbálkozás a(z) ${server} szerverrel...`);
        const startTime = Date.now();
        
        try {
            const response = await fetch(server, {
                method: "POST",
                body: query,
                headers: {
                    'User-Agent': 'BMEmap-Updater/1.0'
                },
                signal: AbortSignal.timeout(60000)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.log(`❌ Hiba a szerveren (HTTP ${response.status}): ${errorText.substring(0, 100).replace(/\n/g, " ")}... Ugrás a következőre...`);
                continue; 
            }

            const data = await response.json();
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`✅ Sikeres letöltés innen: ${server} (${elapsed} másodperc alatt)`);
            return data; 
        } catch (error) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`⚠️ Hálózati hiba vagy időtúllépés (${elapsed}s után): ${error.message}`);
        }
    }
    throw new Error("🚨 AZ ÖSSZES OVERPASS SZERVER HALOTT!");
}

// Geometriai segédfüggvények a szétválogatáshoz
function pointInPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        const intersect = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function distSq(p1, p2) {
    const dx = p1[0] - p2[0], dy = p1[1] - p2[1];
    return dx * dx + dy * dy;
}

function minDistToPoly(pt, rings) {
    let minD = Infinity;
    for (const ring of rings) {
        for (const p of ring) {
            const d = distSq(pt, p);
            if (d < minD) minD = d;
        }
    }
    return minD;
}

function getAllPoints(geom) {
    const pts = [];
    function walk(c) {
        if (typeof c[0] === "number") pts.push(c);
        else c.forEach(walk);
    }
    walk(geom.coordinates);
    return pts;
}

function getCenter(geom) {
    const pts = getAllPoints(geom);
    let sumX = 0, sumY = 0;
    for (const p of pts) { sumX += p[0]; sumY += p[1]; }
    return [sumX / pts.length, sumY / pts.length];
}

// Szétválogatja a letöltött nagy GeoJSON-t épületenként a koordináták alapján
function classifyFeatures(geoJson) {
    const allFeatures = geoJson.features || [];

    // 1. Megkeressük a 6 épület fő külső poligonját
    const buildingPolys = {};
    for (const [key, center] of Object.entries(BUILDINGS)) {
        const targetPt = [center[1], center[0]]; // [lon, lat]
        let bestMatch = null;
        let minD = Infinity;

        for (const f of allFeatures) {
            if (f.properties && f.properties.building && !f.properties.indoor && 
               (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon")) {
                const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat(1);
                const d = minDistToPoly(targetPt, rings);
                if (d < minD) {
                    minD = d;
                    bestMatch = f;
                }
            }
        }
        buildingPolys[key] = bestMatch;
    }

    // 2. Szétválogatjuk az összes elemet épületenként
    const separated = {};
    for (const key of Object.keys(BUILDINGS)) {
        separated[key] = [];
    }

    for (const f of allFeatures) {
        const pts = getAllPoints(f.geometry);
        const center = getCenter(f.geometry);
        const matchedKeys = new Set();

        // A) Megvizsgáljuk, melyik épület külső poligonján belül van
        for (const [key, bFeature] of Object.entries(buildingPolys)) {
            if (!bFeature) continue;
            const outerRing = bFeature.geometry.coordinates[0];
            if (pointInPoly(center, outerRing)) {
                matchedKeys.add(key);
            } else {
                // Átnyúló összekötő elemek (pl. Sóhajok hídja): ha bármelyik csúcsa bent van
                for (const pt of pts) {
                    if (pointInPoly(pt, outerRing)) {
                        matchedKeys.add(key);
                        break;
                    }
                }
            }
        }

        // B) Ha pont a külső falon van (pl. ajtók, bejáratok), a legközelebbi épülethez rendeljük
        if (matchedKeys.size === 0) {
            let closestKey = null;
            let minD = Infinity;
            for (const [key, bFeature] of Object.entries(buildingPolys)) {
                if (!bFeature) continue;
                const outerRing = bFeature.geometry.coordinates[0];
                const d = minDistToPoly(center, [outerRing]);
                if (d < minD) {
                    minD = d;
                    closestKey = key;
                }
            }
            if (closestKey) matchedKeys.add(closestKey);
        }

        // Hozzáadás az érintett épület(ek)hez
        for (const k of matchedKeys) {
            separated[k].push(f);
        }
    }

    return separated;
}

/**
 * Betölti a könyvtár bővítmény konfigurációt.
 * @param {string} [configPath='./data/library_extension.json']
 * @returns {Object|null}
 */
function loadLibraryExtensionConfig(configPath = './data/library_extension.json') {
    if (!fs.existsSync(configPath)) return null;
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        console.warn(`Nem sikerült betölteni a library_extension konfigurációt: ${e.message}`);
        return null;
    }
}

/**
 * Feldolgozza a rooms és explicitOsmIds listákat, és visszaad egy Map-et.
 * Támogatja az egyszerű string azonosítókat és az objektumokat ({ id, access, name, ref }).
 * @param {Object} config
 * @returns {Map<string, Object>}
 */
function parseRoomConfig(config) {
    const roomMap = new Map();
    if (!config) return roomMap;
    const rawList = [...(config.rooms || []), ...(config.explicitOsmIds || [])];
    for (const item of rawList) {
        if (!item) continue;
        if (typeof item === 'string') {
            if (!roomMap.has(item)) {
                roomMap.set(item, { id: item, access: 'bridge' });
            }
        } else if (typeof item === 'object' && item.id) {
            roomMap.set(item.id, {
                id: item.id,
                access: item.access || 'bridge',
                name: item.name,
                ref: item.ref
            });
        }
    }
    return roomMap;
}

/**
 * Átmásolja a konfigurációban megadott OSM elemeket (Sóhajok Hídja, olvasótermek, lépcsők, mosdók)
 * és az összekötő folyosókat a forrás épületből (K) a cél épületbe (KT).
 * @param {Object} separated - Épületkódonkénti feature lista ({ k: [...], kt: [...] })
 * @param {string} [configPath='./data/library_extension.json']
 */
function applyLibraryExtension(separated, configPath = './data/library_extension.json') {
    const config = loadLibraryExtensionConfig(configPath);
    if (!config) return separated;

    const srcKey = (config.sourceBuilding || 'k').toLowerCase();
    const dstKey = (config.targetBuilding || 'kt').toLowerCase();

    if (!separated[srcKey]) separated[srcKey] = [];
    if (!separated[dstKey]) separated[dstKey] = [];

    // Fiktív centerline eltávolítása a forrásból és a célból is
    separated[srcKey] = separated[srcKey].filter(f => f && f.id !== 'way/1530062494/centerline');
    separated[dstKey] = separated[dstKey].filter(f => f && f.id !== 'way/1530062494/centerline');

    // Korábbi futásokból származó bővítmények eltávolítása a célból a tiszta, nem felhalmozódó szinkronizáláshoz:
    separated[dstKey] = separated[dstKey].filter(f => f && (!f.properties || !f.properties.isLibraryExtension) && f.id !== 'way/1564033986');

    // A forrás épületben is eltávolítjuk a korábbi bővítmény jelöléseket:
    for (const f of separated[srcKey]) {
        if (f && f.properties && f.properties.isLibraryExtension) {
            delete f.properties.isLibraryExtension;
            delete f.properties.libraryAccess;
            delete f.properties.isForeignLevelOutline;
        }
    }

    const roomMap = parseRoomConfig(config);
    const explicitIds = new Set(roomMap.keys());
    const bridgeIds = new Set(config.bridgeOsmIds || config.bridgeIds || ['way/1564033986', 'way/1530062494']);

    const autoCfg = config.autoInfrastructure || {};
    const autoEnabled = autoCfg.enabled === true;
    const bbox = autoCfg.bbox || [19.05455, 47.48085, 19.05520, 47.48125];
    const allowedLevels = (autoCfg.levels || ['0', '1']).map(String);
    const filterTags = autoCfg.filterTags || ['corridor', 'steps', 'toilets', 'door', 'entrance', 'stairs'];
    const polygons = config.polygons || {};

    function matchFilter(f) {
        const p = f.properties || {};
        if (p.building && !p.indoor && !p.room) return false;
        if (p.indoor === 'level' || p.indoor === 'wall') return false;

        const isCorridor = p.highway === 'corridor' || p.indoor === 'corridor' || p.room === 'corridor';
        const isSteps = p.highway === 'steps' || p.indoor === 'steps' || p.room === 'stairs' || p.room === 'staircase' || p.indoor === 'staircase' || p.stairs === 'yes';
        const isToilets = p.amenity === 'toilets' || p.room === 'toilets' || p.room === 'toilet';
        const isDoor = p.door !== undefined;
        const isEntrance = p.entrance !== undefined;

        return (
            (filterTags.includes('corridor') && isCorridor) ||
            ((filterTags.includes('steps') || filterTags.includes('stairs')) && isSteps) ||
            (filterTags.includes('toilets') && isToilets) ||
            (filterTags.includes('door') && isDoor) ||
            (filterTags.includes('entrance') && isEntrance)
        );
    }

    const dstIds = new Set(separated[dstKey].map(f => f.id));
    const addedFeatures = [];

    for (const f of separated[srcKey]) {
        if (!f || !f.id) continue;
        if (f.id === 'way/1530062494/centerline') continue;
        let shouldInclude = false;

        if (explicitIds.has(f.id)) {
            shouldInclude = true;
        } else if (autoEnabled) {
            const lvl = f.properties && f.properties.level !== undefined ? String(f.properties.level) : '';
            const lvls = lvl ? lvl.split(';').map(s => s.trim()) : allowedLevels;
            if (lvls.some(l => allowedLevels.includes(l)) && matchFilter(f)) {
                const pts = getAllPoints(f.geometry);
                for (const l of lvls) {
                    if (!allowedLevels.includes(l)) continue;
                    if (polygons && Array.isArray(polygons[l]) && polygons[l].length >= 3) {
                        if (pts.some(p => pointInPoly(p, polygons[l]))) {
                            shouldInclude = true;
                            break;
                        }
                    } else {
                        if (pts.some(p => p[0] >= bbox[0] && p[0] <= bbox[2] && p[1] >= bbox[1] && p[1] <= bbox[3])) {
                            shouldInclude = true;
                            break;
                        }
                    }
                }
            }
        }

        if (shouldInclude) {
            const isLevelOrBuilding = f.properties && (f.properties.indoor === 'level' || f.properties.building);

            // A forrás épületben (K) CSAK AKKOR állítunk be bővítmény jelzést, ha nem natív szintkontúr:
            if (!isLevelOrBuilding) {
                f.properties = f.properties || {};
                f.properties.isLibraryExtension = true;
                if (roomMap.has(f.id)) {
                    const rInfo = roomMap.get(f.id);
                    f.properties.libraryAccess = rInfo.access || 'bridge';
                    if (rInfo.name && !f.properties.name) f.properties.name = rInfo.name;
                    if (rInfo.ref && !f.properties.ref) f.properties.ref = rInfo.ref;
                }
                if (bridgeIds.has(f.id) || f.id === 'way/1530062494' || f.id === 'way/1564033986') {
                    f.properties.bridge = 'yes';
                    if (!f.properties.name) f.properties.name = 'Sóhajok Hídja';
                }
            }

            // A cél épületbe (KT) másolt elem előkészítése:
            const copy = JSON.parse(JSON.stringify(f));
            copy.properties = copy.properties || {};
            copy.properties.isLibraryExtension = true;
            if (isLevelOrBuilding) {
                copy.properties.isForeignLevelOutline = true;
            }
            if (roomMap.has(copy.id)) {
                const rInfo = roomMap.get(copy.id);
                copy.properties.libraryAccess = rInfo.access || 'bridge';
                if (rInfo.name && !copy.properties.name) copy.properties.name = rInfo.name;
                if (rInfo.ref && !copy.properties.ref) copy.properties.ref = rInfo.ref;
            }
            if (bridgeIds.has(copy.id) || copy.id === 'way/1530062494' || copy.id === 'way/1564033986') {
                copy.properties.bridge = 'yes';
                if (!copy.properties.name) copy.properties.name = 'Sóhajok Hídja';
            }

            const existingIdx = separated[dstKey].findIndex(item => item && item.id === copy.id);
            if (existingIdx !== -1) {
                separated[dstKey][existingIdx] = copy;
            } else if (!dstIds.has(copy.id)) {
                dstIds.add(copy.id);
                addedFeatures.push(copy);
            }
        }
    }

    // Valós OSM híd folyosó (way/1564033986) garantált beemelése mindkét épületbe
    const realBridgeWay = {
        type: 'Feature',
        id: 'way/1564033986',
        properties: {
            highway: 'corridor',
            indoor: 'yes',
            level: '1',
            bridge: 'yes',
            name: 'Sóhajok Hídja',
            id: 'way/1564033986',
            isLibraryExtension: true,
            libraryAccess: 'bridge'
        },
        geometry: {
            type: 'LineString',
            coordinates: [
                [19.0548121, 47.4810804],
                [19.0546091, 47.4809714]
            ]
        }
    };

    const ensureBridgeWay = (list) => {
        const idx = list.findIndex(item => item && item.id === realBridgeWay.id);
        if (idx !== -1) {
            list[idx].properties = Object.assign(list[idx].properties || {}, realBridgeWay.properties);
            list[idx].geometry = realBridgeWay.geometry;
        } else {
            list.push(JSON.parse(JSON.stringify(realBridgeWay)));
        }
    };
    ensureBridgeWay(separated[srcKey]);
    ensureBridgeWay(separated[dstKey]);

    // Összekötő folyosók beemelése (ha van)
    if (Array.isArray(config.connectingCorridors)) {
        for (const conn of config.connectingCorridors) {
            if (!conn || !conn.id || conn.id === 'way/1530062494/centerline') continue;
            const connCopy = JSON.parse(JSON.stringify(conn));
            connCopy.properties = connCopy.properties || {};
            connCopy.properties.isLibraryExtension = true;

            const existingDstIdx = separated[dstKey].findIndex(item => item && item.id === connCopy.id);
            if (existingDstIdx !== -1) {
                separated[dstKey][existingDstIdx] = connCopy;
            } else if (!dstIds.has(connCopy.id)) {
                dstIds.add(connCopy.id);
                addedFeatures.push(connCopy);
            }

            const existingSrcIdx = separated[srcKey].findIndex(item => item && item.id === connCopy.id);
            if (existingSrcIdx !== -1) {
                separated[srcKey][existingSrcIdx] = JSON.parse(JSON.stringify(connCopy));
            } else {
                separated[srcKey].push(JSON.parse(JSON.stringify(connCopy)));
            }
        }
    }

    separated[dstKey].push(...addedFeatures);
    console.log(`📚 Könyvtár bővítmény alkalmazva: ${addedFeatures.length} elem átcsatolva K-ból a KT-ba.`);

    return separated;
}

/**
 * Frissíti a helyi k_epulet.json és kt_epulet.json fájlokat a library_extension.json alapján (offline/helyi mód).
 * @param {string} [dataDir='./data']
 */
function syncLocalLibraryExtension(dataDir = './data') {
    const kPath = path.join(dataDir, 'k_epulet.json');
    const ktPath = path.join(dataDir, 'kt_epulet.json');

    if (!fs.existsSync(kPath) || !fs.existsSync(ktPath)) {
        console.warn("⚠️ Nem található k_epulet.json vagy kt_epulet.json a bővítmény alkalmazásához.");
        return;
    }

    const kData = JSON.parse(fs.readFileSync(kPath, 'utf8'));
    const ktData = JSON.parse(fs.readFileSync(ktPath, 'utf8'));

    const separated = {
        k: kData.features || [],
        kt: ktData.features || []
    };

    applyLibraryExtension(separated, path.join(dataDir, 'library_extension.json'));

    kData.features = separated.k;
    ktData.features = separated.kt;

    fs.writeFileSync(kPath, JSON.stringify(kData), 'utf8');
    fs.writeFileSync(ktPath, JSON.stringify(ktData), 'utf8');
    console.log(`💾 Mentve: ${ktPath} (${ktData.features.length} elem)`);
}

/**
 * Legenerálja a globális keresési indexet az épületek GeoJSON fájljaiból és a campus épületekből.
 * @param {string} [dataDir='./data'] - Az adatfájlokat tartalmazó könyvtár elérési útja.
 * @returns {Object[]} A generált keresési index tömbje.
 */
function generateSearchIndex(dataDir = './data') {
    const indoorBuildings = ['k', 'i', 'q', 'e', 'r', 'kt', 'a', 'j'];
    const searchIndex = [];
    const seenIndexKeys = new Set();

    const config = loadLibraryExtensionConfig(path.join(dataDir, 'library_extension.json'));
    const roomMap = parseRoomConfig(config);
    const explicitIds = new Set(roomMap.keys());
    const bridgeIds = new Set((config && (config.bridgeOsmIds || config.bridgeIds)) || ['way/1564033986', 'way/1530062494']);

    // Beltéri termek feldolgozása
    for (const b of indoorBuildings) {
        const filePath = path.join(dataDir, `${b}_epulet.json`);
        if (!fs.existsSync(filePath)) continue;

        let data;
        try {
            data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.warn(`Hiba a(z) ${filePath} olvasásakor: ${e.message}`);
            continue;
        }

        const bKey = b.toUpperCase();
        for (const f of data.features || []) {
            const p = f.properties || {};

            const isCorridor = p.highway === 'corridor' || p.indoor === 'corridor' || p.room === 'corridor';
            const isStairs = p.highway === 'steps' || p.indoor === 'steps' || p.room === 'stairs' || p.indoor === 'staircase' || p.room === 'staircase' || p.stairs === 'yes';
            const isElevator = p.highway === 'elevator' || p.room === 'elevator' || p.indoor === 'elevator' || p.amenity === 'elevator';
            const isNamedBridge = (p.bridge === 'yes' || bridgeIds.has(f.id) || explicitIds.has(f.id) || p.isLibraryExtension || (p.name && /híd|bridge/i.test(p.name))) && p.name;
            if ((isCorridor || isStairs || isElevator) && !isNamedBridge) continue;

            if (p.building && !p.indoor && !p.room) continue;
            if (p.indoor === 'level' || p.indoor === 'wall') continue;

            if (p.name || p.ref || p.alt_name) {
                const isLibExt = explicitIds.has(f.id) || p.isLibraryExtension === true;
                let assignedBuilding = bKey;
                let access = '';
                if (isLibExt) {
                    const rInfo = roomMap.get(f.id);
                    access = p.libraryAccess || (rInfo && rInfo.access) || (bridgeIds.has(f.id) ? 'bridge' : '');
                    if (access === 'bridge') {
                        assignedBuilding = 'KT';
                    } else if (access === 'k' || access === 'both') {
                        assignedBuilding = 'K';
                    } else {
                        assignedBuilding = 'KT';
                    }
                }
                const itemKey = `${f.id}_${assignedBuilding}`;
                if (seenIndexKeys.has(itemKey)) continue;
                seenIndexKeys.add(itemKey);

                if (isLibExt) {
                    const existingIdx = searchIndex.findIndex(x => x.id === f.id);
                    if (existingIdx !== -1) {
                        searchIndex.splice(existingIdx, 1);
                    }
                }

                const indexItem = {
                    id: f.id,
                    b: assignedBuilding,
                    ref: p.ref || undefined,
                    name: p.name || undefined,
                    alt: p.alt_name || undefined,
                    lvl: p.level !== undefined ? String(p.level).split(';')[0].trim() : '0',
                    lref: p['level:ref'] || undefined
                };
                if (isLibExt) {
                    indexItem.isLibraryExtension = true;
                    if (access) indexItem.libraryAccess = access;
                }

                searchIndex.push(indexItem);
            }
        }
    }

    // Kampusz épületek hozzáadása
    const campusPath = path.join(dataDir, 'campus_buildings.json');
    if (fs.existsSync(campusPath)) {
        try {
            const campusData = JSON.parse(fs.readFileSync(campusPath, 'utf8'));
            for (const f of campusData.features || []) {
                const p = f.properties || {};
                const code = (p.code || p.key || '').toUpperCase();
                if (!code) continue;

                let alt = `${p.name || ''} ${code} épület`;
                if (code === 'ÉL') {
                    alt += ' BME Sportközpont sportcsarnok fitness terem fallabda küzdősport';
                } else if (code === 'KT') {
                    alt += ' Könyvtár OMIKK olvasóterem könyvtár';
                } else if (code === 'SPORT') {
                    alt += ' Sporttelep sportpálya tenisz atlétika futópálya foci';
                }

                searchIndex.push({
                    id: f.id || `campus_${code.toLowerCase()}`,
                    b: code,
                    ref: code,
                    name: p.name || `${code} épület`,
                    alt: alt.trim(),
                    lvl: '0',
                    isBuilding: true,
                    hasIndoor: p.hasIndoor === true || p.hasIndoor === 'true'
                });
            }
        } catch (e) {
            console.warn(`Hiba a campus_buildings.json olvasásakor: ${e.message}`);
        }
    }

    const outputFile = path.join(dataDir, 'search_index.json');
    const indexStr = JSON.stringify(searchIndex);
    fs.writeFileSync(outputFile, indexStr, 'utf8');
    const indexKb = (Buffer.byteLength(indexStr, 'utf8') / 1024).toFixed(1);
    console.log(`Keresési index mentve: ${outputFile} (${searchIndex.length} elem, ${indexKb} KB)`);

    return searchIndex;
}

async function updateMaps() {
    if (process.argv.includes('--index-only')) {
        console.log("Keresési index generálása a meglévő fájlokból (--index-only)...");
        generateSearchIndex('./data');
        return;
    }

    if (process.argv.includes('--expand-library') || process.argv.includes('--sync-library')) {
        console.log("📚 Könyvtár bővítmény szinkronizálása meglévő adatokból (--expand-library)...");
        syncLocalLibraryExtension('./data');
        generateSearchIndex('./data');
        return;
    }

    const totalStart = Date.now();

    // Létrehozzuk a data mappát, ha nincs
    if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data');
        console.log("📁 'data' mappa létrehozva.");
    }

    console.log("🚀 ÉPÜLETEK EGYSZERRE TÖRTÉNŐ LETÖLTÉSE (BATCH MÓD)...");
    const query = buildBatchQuery();

    try {
        const osmData = await fetchWithFallback(query);

        console.log(`⚙️  Konvertálás GeoJSON formátumba...`);
        const convStart = Date.now();
        const osmtogeojson = require('osmtogeojson');
        const geoJson = osmtogeojson(osmData);
        console.log(`⏱️  Konvertálás kész (${((Date.now() - convStart) / 1000).toFixed(2)}s)`);

        console.log(`🧩 Épületek szétválogatása a memóriában...`);
        const separated = classifyFeatures(geoJson);

        // Könyvtár bővítmény alkalmazása
        applyLibraryExtension(separated, './data/library_extension.json');

        // Kiírjuk a fájlokat az egyes épületekhez
        for (const [key, features] of Object.entries(separated)) {
            const outGeoJson = {
                type: "FeatureCollection",
                features: features
            };
            const filename = `./data/${key}_epulet.json`;
            const jsonStr = JSON.stringify(outGeoJson);
            fs.writeFileSync(filename, jsonStr);
            const sizeKb = (Buffer.byteLength(jsonStr) / 1024).toFixed(1);
            console.log(`💾 Mentve: ${filename.padEnd(22)} (${features.length} elem, ${sizeKb} KB)`);
        }

        // Globális keresési index generálása
        generateSearchIndex('./data');

        const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(2);
        console.log(`\n🎉 A FRISSÍTÉSI CIKLUS SIKERESEN LEFUTOTT ${totalElapsed} MÁSODPERC ALATT!`);

    } catch (err) {
        console.error(`💥 Hiba a térképek frissítése közben: ${err.message}`);
        console.log(`⏭️ Sebaj, megtartjuk a korábbi térképfájlokat.`);
    }
}

if (require.main === module) {
    updateMaps();
}

module.exports = {
    updateMaps,
    generateSearchIndex,
    applyLibraryExtension,
    syncLocalLibraryExtension
};
