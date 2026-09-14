const fs = require('fs');
const path = require('path');

// 1. A meglévő lokális fájlokból kinyerhető épületek
const LOCAL_MAPS = {
    'K': { file: 'k_epulet.json', code: 'K', name: 'K épület (Központi)', hasIndoor: true, defaultZoom: 19, defaultLevel: '1', levels: 4, height: 22 },
    'I': { file: 'i_epulet.json', code: 'I', name: 'I épület (Informatika)', hasIndoor: true, defaultZoom: 20, defaultLevel: '0', levels: 5, height: 21 },
    'Q': { file: 'q_epulet.json', code: 'Q', name: 'Q épület', hasIndoor: true, defaultZoom: 20, defaultLevel: '0', levels: 6, height: 24 },
    'E': { file: 'e_epulet.json', code: 'E', name: 'E épület', hasIndoor: true, defaultZoom: 20, defaultLevel: '0', levels: 6, height: 23 },
    'R': { file: 'r_epulet.json', code: 'R', name: 'R épület', hasIndoor: true, defaultZoom: 19, defaultLevel: '0', levels: 5, height: 20 },
    'KT': { file: 'kt_epulet.json', code: 'KT', name: 'BME OMIKK Könyvtár', hasIndoor: true, defaultZoom: 20, defaultLevel: '0', levels: 3, height: 16 },
    'A': { file: 'a_epulet.json', code: 'A', name: 'A épület (Adminisztráció)', hasIndoor: false, defaultZoom: 19, defaultLevel: '0', matchName: 'A épület', levels: 3, height: 14 },
    'V1': { file: 'a_epulet.json', code: 'V1', name: 'V1 épület (Villamosságtan)', hasIndoor: false, defaultZoom: 19, defaultLevel: '0', matchName: 'V1 épület', levels: 3, height: 13 },
    'ÉL': { file: 'j_epulet.json', code: 'ÉL', name: 'ÉL épület (Építőipari labor)', hasIndoor: false, defaultZoom: 19, defaultLevel: '0', matchName: 'ÉL épület', levels: 2, height: 10 }
};

// Kiemelt OSM épületazonosítók a pontos kontúrokhoz és adatokhoz
const KNOWN_OSM_WAYS = {
    24727017: { code: 'ST', name: 'ST épület (Stoczek)', address: '1111 Budapest, Stoczek utca 2.', levels: 5, height: 18 },
    476450390: { code: 'J', name: 'J épület (Járműgépészet)', address: '1111 Budapest, Stoczek utca 4.', levels: 6, height: 20 },
    158021605: { code: 'VPK', name: 'Vásárhelyi Pál Kollégium', address: '1111 Budapest, Kruspér utca 2.', levels: 8, height: 26 },
    32801232: { code: 'KTK', name: 'Kármán Tódor Kollégium', address: '1111 Budapest, Irinyi József utca 1-17.', levels: 10, height: 32 },
    32800582: { code: 'DCS', name: 'Dcs épület (D csarnok)', address: '1111 Budapest, Bertalan Lajos utca 4-6.', levels: 2, height: 10 },
    198237195: { code: 'HÖ', name: 'Hö épület (Hőtechnika)', address: '1111 Budapest, Bertalan Lajos utca 5.', levels: 3, height: 13 },
    184335689: { code: 'FA', name: 'Fa épület (Atomfizika)', address: '1111 Budapest, Budafoki út 6-8.', levels: 1, height: 6 },
    32800575: { code: 'SPORT', name: 'BME Sporttelep', address: '1117 Budapest, Bogdánfy Ödön utca 10/B', levels: 1, height: 4 },
    776062316: { code: 'SCH', name: 'Schönherz Kollégium', address: '1117 Budapest, Irinyi József utca 42', levels: 20, height: 67 }
};

// Geometriai segédfüggvény: súlypont / középpont kiszámítása
function calculateCentroid(coordinates, geomType) {
    let pts = [];
    if (geomType === 'Polygon') {
        pts = coordinates[0];
    } else if (geomType === 'MultiPolygon') {
        pts = coordinates[0][0];
    }
    if (!pts || pts.length === 0) return [19.055, 47.481];

    let sumX = 0, sumY = 0;
    for (const p of pts) {
        sumX += p[0];
        sumY += p[1];
    }
    return [+(sumX / pts.length).toFixed(7), +(sumY / pts.length).toFixed(7)];
}

// Bounding box kiszámítása
function calculateBBox(coordinates, geomType) {
    let pts = [];
    function walk(c) {
        if (typeof c[0] === 'number') pts.push(c);
        else c.forEach(walk);
    }
    walk(coordinates);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
    }
    return [minX, minY, maxX, maxY];
}

// Közvetlen OSM API lekérdezés egyetlen way-hez
async function fetchOsmWay(id) {
    try {
        const url = `https://api.openstreetmap.org/api/0.6/way/${id}/full.json`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'BMEmap-CampusBuilder/1.0' },
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        console.warn(`  ⚠️ Nem sikerült letölteni a(z) ${id} OSM way-t:`, e.message);
        return null;
    }
}

// Overpass API szerverek a további épületek felkutatásához
const OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
];

const BME_QUERY = `[out:json][timeout:30];
(
  way["building"](47.468,19.048,47.485,19.065)["building"!="roof"]["building"!="bridge"];
  relation["building"](47.468,19.048,47.485,19.065)["building"!="roof"]["building"!="bridge"];
);
out body;
>;
out skel qt;`;

async function fetchFromOverpass() {
    for (const server of OVERPASS_SERVERS) {
        try {
            console.log(`📡 Kapcsolódás az Overpass szerverhez (${server})...`);
            const res = await fetch(server, {
                method: "POST",
                body: BME_QUERY,
                headers: { 'User-Agent': 'BMEmap-CampusBuilder/1.0' },
                signal: AbortSignal.timeout(35000)
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.log(`⚠️ Hiba a(z) ${server} szerverrel: ${e.message}`);
        }
    }
    return null;
}

// Kód és tiszta név detektálása OSM tagekből
function detectBuildingCode(name, ref, altName) {
    const raw = (ref || name || "").trim();
    
    // Specifikus BME megfeleltetések (ST megelőzi a J-t, J nem egyezhet a Stoczek Józseffel)
    const matches = [
        { regex: /\bCH\b|^CH/i, code: 'CH', name: 'CH épület (Kémia)', levels: 4, height: 19 },
        { regex: /\bF\b|^F ép/i, code: 'F', name: 'F épület (Fizika)', levels: 4, height: 18 },
        { regex: /\bD\b|^D ép/i, code: 'D', name: 'D épület (Gépészet)', levels: 4, height: 16 },
        { regex: /\bMM\b|^MM/i, code: 'MM', name: 'MM épület (Műszaki Mechanika)', levels: 4, height: 16 },
        { regex: /\bMG\b|^MG/i, code: 'MG', name: 'MG épület (Mezőgazdasági Géptan)', levels: 3, height: 13 },
        { regex: /\bT\b|^T ép/i, code: 'T', name: 'T épület', levels: 4, height: 16 },
        { regex: /\bH\b|^H ép/i, code: 'H', name: 'H épület (Hőerőmű)', levels: 3, height: 15 },
        { regex: /\bST\b|^ST ép/i, code: 'ST', name: 'ST épület (Stoczek)', levels: 5, height: 18 },
        { regex: /^(?:(?:Épület|Building)\s+)?J(?:\s+épület|\s+Building|\b)(?!ózsef)/i, code: 'J', name: 'J épület (Járműgépészet)', levels: 6, height: 20 },
        { regex: /\bV2\b|^V2 ép/i, code: 'V2', name: 'V2 épület', levels: 4, height: 16 },
        { regex: /\bZ\b|^Z ép/i, code: 'Z', name: 'Z épület', levels: 4, height: 15 },
        { regex: /\bDC\b|^DC ép/i, code: 'DC', name: 'DC épület', levels: 4, height: 16 },
        { regex: /\bL\b|^L ép/i, code: 'L', name: 'L épület (Labor)', levels: 3, height: 13 },
        { regex: /D\s*csarnok|Dcs/i, code: 'DCS', name: 'Dcs épület (D csarnok)', levels: 2, height: 10 },
        { regex: /Hőtechnika|H[öő]/i, code: 'HÖ', name: 'Hö épület (Hőtechnika)', levels: 3, height: 13 },
        { regex: /Atomfizika|\bFa\b/i, code: 'FA', name: 'Fa épület (Atomfizika)', levels: 1, height: 6 },
        { regex: /Vásárhelyi|VPK/i, code: 'VPK', name: 'Vásárhelyi Pál Kollégium', levels: 8, height: 26 },
        { regex: /Kármán|KTK/i, code: 'KTK', name: 'Kármán Tódor Kollégium', levels: 10, height: 32 },
        { regex: /Schönherz|SCH/i, code: 'SCH', name: 'Schönherz Kollégium', levels: 20, height: 67 },
        { regex: /Martos/i, code: 'MFK', name: 'Martos Flóra Kollégium', levels: 5, height: 18 },
        { regex: /Bercsényi/i, code: 'BMB', name: 'Bercsényi Kollégium', levels: 5, height: 18 },
        { regex: /Wigner/i, code: 'WJK', name: 'Wigner Jenő Kollégium', levels: 4, height: 15 },
        { regex: /Baross/i, code: 'BGK', name: 'Baross Gábor Kollégium', levels: 4, height: 15 },
        { regex: /Sporttelep|Bogdánfy/i, code: 'SPORT', name: 'BME Sporttelep', levels: 1, height: 4 }
    ];

    for (const m of matches) {
        if (m.regex.test(raw) || (altName && m.regex.test(altName))) {
            return { code: m.code, name: m.name, levels: m.levels, height: m.height };
        }
    }

    // Általános "X épület" minta
    const m = raw.match(/^([A-Z0-9]{1,3})\s+épület/i);
    if (m) {
        return { code: m[1].toUpperCase(), name: `${m[1].toUpperCase()} épület` };
    }

    return null;
}

async function buildCampusGeoJson() {
    console.log("🚀 BME Kampusz épületkontúrok előállítása...");
    const dataDir = path.resolve(__dirname, '../data');
    const features = [];
    const seenCodes = new Set();

    // 1. Lokális adatok kinyerése
    console.log("📦 1. Lépés: Lokális épületfájlok feldolgozása...");
    for (const [key, cfg] of Object.entries(LOCAL_MAPS)) {
        const filePath = path.join(dataDir, cfg.file);
        if (!fs.existsSync(filePath)) continue;

        try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const bPolys = content.features.filter(f => 
                f.properties && f.properties.building && !f.properties.indoor &&
                (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
            );

            let best = null;
            if (cfg.matchName) {
                best = bPolys.find(f => f.properties.name === cfg.matchName) || bPolys[0];
            } else {
                best = bPolys[0];
            }

            if (best) {
                const center = calculateCentroid(best.geometry.coordinates, best.geometry.type);
                const bbox = calculateBBox(best.geometry.coordinates, best.geometry.type);
                
                features.push({
                    type: "Feature",
                    id: `bme_${cfg.code.toLowerCase()}`,
                    properties: {
                        key: cfg.code,
                        code: cfg.code,
                        name: cfg.name,
                        hasIndoor: cfg.hasIndoor,
                        center: center,
                        bbox: bbox,
                        defaultZoom: cfg.defaultZoom || 19,
                        defaultLevel: cfg.defaultLevel || "0",
                        levels: cfg.levels,
                        height: cfg.height
                    },
                    geometry: best.geometry
                });
                seenCodes.add(cfg.code);
                console.log(`  ✅ ${cfg.code} épület hozzáadva (Lokális fájl: ${cfg.file})`);
            }
        } catch (e) {
            console.warn(`  ⚠️ Hiba a(z) ${cfg.file} feldolgozásakor:`, e.message);
        }
    }

    // 2. Kiemelt OSM épületek letöltése közvetlenül az OSM API-ból
    console.log("\n📍 2. Lépés: Kiemelt BME épületek letöltése közvetlenül az OSM API-ból...");
    for (const [idStr, meta] of Object.entries(KNOWN_OSM_WAYS)) {
        if (seenCodes.has(meta.code)) continue;
        const osmObj = await fetchOsmWay(idStr);
        if (!osmObj || !osmObj.elements) continue;

        const nodeMap = new Map();
        for (const el of osmObj.elements) {
            if (el.type === 'node') nodeMap.set(el.id, [el.lon, el.lat]);
        }

        const way = osmObj.elements.find(el => el.type === 'way' && el.id === Number(idStr));
        if (!way || !way.nodes) continue;

        const ring = way.nodes.map(nid => nodeMap.get(nid)).filter(Boolean);
        if (ring.length < 4) continue;

        const geometry = { type: "Polygon", coordinates: [ring] };
        const center = calculateCentroid(geometry.coordinates, geometry.type);
        const bbox = calculateBBox(geometry.coordinates, geometry.type);

        features.push({
            type: "Feature",
            id: `bme_${meta.code.toLowerCase()}`,
            properties: {
                key: meta.code,
                code: meta.code,
                name: meta.name,
                hasIndoor: false,
                center: center,
                bbox: bbox,
                defaultZoom: 19,
                address: meta.address,
                levels: meta.levels,
                height: meta.height
            },
            geometry: geometry
        });
        seenCodes.add(meta.code);
        console.log(`  ✅ ${meta.code} épület hozzáadva (OSM way ${idStr}: ${meta.name})`);
    }

    // 3. További épületek lekérése Overpassból
    console.log("\n🌐 3. Lépés: További BME épületek felkutatása Overpassból...");
    let osmData = null;
    try {
        osmData = await fetchFromOverpass();
    } catch(e) {
        console.log("  ⚠️ Overpass nem érhető el közvetlenül:", e.message);
    }

    if (osmData && osmData.elements) {
        console.log(`  📦 ${osmData.elements.length} OSM elem feldolgozása...`);
        const nodeMap = new Map();
        for (const el of osmData.elements) {
            if (el.type === 'node') nodeMap.set(el.id, [el.lon, el.lat]);
        }

        // 3.1 Zárt Way elemek feldolgozása
        for (const el of osmData.elements) {
            if (el.type === 'way' && el.nodes && el.tags && el.tags.building) {
                const detected = detectBuildingCode(el.tags.name, el.tags.ref, el.tags.alt_name);
                if (!detected || seenCodes.has(detected.code)) continue;

                const ring = el.nodes.map(id => nodeMap.get(id)).filter(Boolean);
                if (ring.length < 4) continue;

                const geometry = { type: "Polygon", coordinates: [ring] };
                const center = calculateCentroid(geometry.coordinates, geometry.type);
                const bbox = calculateBBox(geometry.coordinates, geometry.type);

                const levels = el.tags['building:levels'] ? parseInt(el.tags['building:levels'], 10) : (detected.levels || 4);
                const height = el.tags['height'] ? parseFloat(el.tags['height']) : (detected.height || levels * 4);

                features.push({
                    type: "Feature",
                    id: `bme_${detected.code.toLowerCase()}`,
                    properties: {
                        key: detected.code,
                        code: detected.code,
                        name: detected.name,
                        hasIndoor: false,
                        center: center,
                        bbox: bbox,
                        defaultZoom: 19,
                        address: el.tags['addr:street'] ? `${el.tags['addr:postcode'] || ''} Budapest, ${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}`.trim() : undefined,
                        levels: levels,
                        height: height
                    },
                    geometry: geometry
                });
                seenCodes.add(detected.code);
                console.log(`  ✨ ${detected.code} épület hozzáadva Overpassból (${detected.name})`);
            }
        }

        // 3.2 Multipolygon Relációk feldolgozása (ha vannak)
        const wayMap = new Map();
        for (const el of osmData.elements) {
            if (el.type === 'way') wayMap.set(el.id, el);
        }
        for (const el of osmData.elements) {
            if (el.type === 'relation' && el.tags && el.tags.building) {
                const detected = detectBuildingCode(el.tags.name, el.tags.ref, el.tags.alt_name);
                if (!detected || seenCodes.has(detected.code)) continue;

                const outerWays = (el.members || []).filter(m => m.type === 'way' && (m.role === 'outer' || !m.role));
                const rings = [];
                for (const m of outerWays) {
                    const w = wayMap.get(m.ref);
                    if (w && w.nodes) {
                        const ring = w.nodes.map(id => nodeMap.get(id)).filter(Boolean);
                        if (ring.length >= 4) rings.push(ring);
                    }
                }
                if (rings.length === 0) continue;

                const geometry = { type: "MultiPolygon", coordinates: rings.map(r => [r]) };
                const center = calculateCentroid(geometry.coordinates, geometry.type);
                const bbox = calculateBBox(geometry.coordinates, geometry.type);

                const levels = el.tags['building:levels'] ? parseInt(el.tags['building:levels'], 10) : (detected.levels || 4);
                const height = el.tags['height'] ? parseFloat(el.tags['height']) : (detected.height || levels * 4);

                features.push({
                    type: "Feature",
                    id: `bme_${detected.code.toLowerCase()}`,
                    properties: {
                        key: detected.code,
                        code: detected.code,
                        name: detected.name,
                        hasIndoor: false,
                        center: center,
                        bbox: bbox,
                        defaultZoom: 19,
                        address: el.tags['addr:street'] ? `${el.tags['addr:postcode'] || ''} Budapest, ${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}`.trim() : undefined,
                        levels: levels,
                        height: height
                    },
                    geometry: geometry
                });
                seenCodes.add(detected.code);
                console.log(`  ✨ ${detected.code} reláció épület hozzáadva Overpassból (${detected.name})`);
            }
        }
    } else {
        console.log("  ℹ️ Overpass lekérdezés nem tért vissza adatokkal, korábbi generált adatok megőrzése...");
        const targetPath = path.join(dataDir, 'campus_buildings.json');
        if (fs.existsSync(targetPath)) {
            try {
                const prevData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
                for (const f of prevData.features || []) {
                    const code = (f.properties && (f.properties.code || f.properties.key));
                    if (code && !seenCodes.has(code)) {
                        features.push(f);
                        seenCodes.add(code);
                        console.log(`  ♻️ ${code} épület megőrizve meglévő adatokból`);
                    }
                }
            } catch (e) {
                console.warn("  ⚠️ Nem sikerült olvasni a meglévő campus_buildings.json fájlt:", e.message);
            }
        }
    }

    // 4. Mentés data/campus_buildings.json-be
    const output = {
        type: "FeatureCollection",
        features: features
    };

    const targetPath = path.join(dataDir, 'campus_buildings.json');
    const jsonStr = JSON.stringify(output, null, 2);
    fs.writeFileSync(targetPath, jsonStr, 'utf8');

    const sizeKb = (Buffer.byteLength(jsonStr, 'utf8') / 1024).toFixed(1);
    console.log(`\n🎉 Kész! Mentve: ${targetPath} (${features.length} épület, ${sizeKb} KB)`);
}

buildCampusGeoJson();

