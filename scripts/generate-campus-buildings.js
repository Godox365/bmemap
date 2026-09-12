const fs = require('fs');
const path = require('path');

// 1. A meglévő lokális fájlokból kinyerhető épületek
const LOCAL_MAPS = {
    'K': { file: 'k_epulet.json', code: 'K', name: 'K épület (Központi)', hasIndoor: true, defaultZoom: 19, defaultLevel: '1' },
    'I': { file: 'i_epulet.json', code: 'I', name: 'I épület (Informatika)', hasIndoor: true, defaultZoom: 20, defaultLevel: '0' },
    'Q': { file: 'q_epulet.json', code: 'Q', name: 'Q épület', hasIndoor: true, defaultZoom: 20, defaultLevel: '0' },
    'E': { file: 'e_epulet.json', code: 'E', name: 'E épület', hasIndoor: true, defaultZoom: 20, defaultLevel: '0' },
    'R': { file: 'r_epulet.json', code: 'R', name: 'R épület', hasIndoor: true, defaultZoom: 19, defaultLevel: '0' },
    'KT': { file: 'kt_epulet.json', code: 'KT', name: 'BME OMIKK Könyvtár', hasIndoor: true, defaultZoom: 20, defaultLevel: '0' },
    'A': { file: 'a_epulet.json', code: 'A', name: 'A épület (Adminisztráció)', hasIndoor: false, defaultZoom: 19, defaultLevel: '0', matchName: 'A épület' },
    'V1': { file: 'a_epulet.json', code: 'V1', name: 'V1 épület (Villamosságtan)', hasIndoor: false, defaultZoom: 19, defaultLevel: '0', matchName: 'V1 épület' },
    'ÉL': { file: 'j_epulet.json', code: 'ÉL', name: 'ÉL épület (Építőipari labor)', hasIndoor: false, defaultZoom: 19, defaultLevel: '0', matchName: 'ÉL épület' }
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

// Overpass API szerverek a hiányzó épületek lekéréséhez
const OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
];

// Lekérdezi a hiányzó BME épületeket OSM-ből
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
                signal: AbortSignal.timeout(30000)
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
    
    // Specifikus BME megfeleltetések
    const matches = [
        { regex: /\bCH\b|^CH/i, code: 'CH', name: 'CH épület (Kémia)' },
        { regex: /\bF\b|^F ép/i, code: 'F', name: 'F épület (Fizika)' },
        { regex: /\bD\b|^D ép/i, code: 'D', name: 'D épület (Gépészet)' },
        { regex: /\bMM\b|^MM/i, code: 'MM', name: 'MM épület (Műszaki Mechanika)' },
        { regex: /\bMG\b|^MG/i, code: 'MG', name: 'MG épület (Mezőgazdasági Géptan)' },
        { regex: /\bT\b|^T ép/i, code: 'T', name: 'T épület' },
        { regex: /\bH\b|^H ép/i, code: 'H', name: 'H épület (Hőerőmű)' },
        { regex: /\bJ\b|^J ép/i, code: 'J', name: 'J épület (Járműgépészet)' },
        { regex: /\bST\b|^ST ép/i, code: 'ST', name: 'ST épület (Sportközpont)' },
        { regex: /\bV2\b|^V2 ép/i, code: 'V2', name: 'V2 épület' },
        { regex: /\bZ\b|^Z ép/i, code: 'Z', name: 'Z épület' },
        { regex: /\bDC\b|^DC ép/i, code: 'DC', name: 'DC épület' },
        { regex: /\bL\b|^L ép/i, code: 'L', name: 'L épület (Labor)' },
        { regex: /Kármán|KTK/i, code: 'KTK', name: 'Kármán Tódor Kollégium' },
        { regex: /Schönherz|SCH/i, code: 'SCH', name: 'Schönherz Kollégium' },
        { regex: /Martos/i, code: 'MFK', name: 'Martos Flóra Kollégium' },
        { regex: /Bercsényi/i, code: 'BMB', name: 'Bercsényi Kollégium' },
        { regex: /Wigner/i, code: 'WJK', name: 'Wigner Jenő Kollégium' },
        { regex: /Baross/i, code: 'BGK', name: 'Baross Gábor Kollégium' }
    ];

    for (const m of matches) {
        if (m.regex.test(raw) || (altName && m.regex.test(altName))) {
            return { code: m.code, name: m.name };
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
                        defaultLevel: cfg.defaultLevel || "0"
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

    // 2. További épületek lekérése Overpassból
    console.log("\n🌐 2. Lépés: További BME épületek felkutatása Overpassból...");
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

        // 1. Zárt Way elemek feldolgozása
        for (const el of osmData.elements) {
            if (el.type === 'way' && el.nodes && el.tags && el.tags.building) {
                const detected = detectBuildingCode(el.tags.name, el.tags.ref, el.tags.alt_name);
                if (!detected || seenCodes.has(detected.code)) continue;

                const ring = el.nodes.map(id => nodeMap.get(id)).filter(Boolean);
                if (ring.length < 4) continue;

                const geometry = { type: "Polygon", coordinates: [ring] };
                const center = calculateCentroid(geometry.coordinates, geometry.type);
                const bbox = calculateBBox(geometry.coordinates, geometry.type);

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
                        address: el.tags['addr:street'] ? `${el.tags['addr:postcode'] || ''} Budapest, ${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}`.trim() : undefined
                    },
                    geometry: geometry
                });
                seenCodes.add(detected.code);
                console.log(`  ✨ ${detected.code} épület hozzáadva Overpassból (${detected.name})`);
            }
        }

        // 2. Multipolygon Relációk feldolgozása (ha vannak)
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
                        address: el.tags['addr:street'] ? `${el.tags['addr:postcode'] || ''} Budapest, ${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}`.trim() : undefined
                    },
                    geometry: geometry
                });
                seenCodes.add(detected.code);
                console.log(`  ✨ ${detected.code} reláció épület hozzáadva Overpassból (${detected.name})`);
            }
        }
    } else {
        console.log("  ℹ️ Overpass lekérdezés kihagyva vagy sikertelen, a lokális épületek kerülnek mentésre.");
    }

    // 3. Mentés data/campus_buildings.json-be
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
