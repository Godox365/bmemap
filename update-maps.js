const fs = require('fs');
const osmtogeojson = require('osmtogeojson');

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
    "https://overpass-api.de/api/interpreter", // Stabil német
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter", // Gyors orosz
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

async function updateMaps() {
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
        const geoJson = osmtogeojson(osmData);
        console.log(`⏱️  Konvertálás kész (${((Date.now() - convStart) / 1000).toFixed(2)}s)`);

        console.log(`🧩 Épületek szétválogatása a memóriában...`);
        const separated = classifyFeatures(geoJson);

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

        const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(2);
        console.log(`\n🎉 A FRISSÍTÉSI CIKLUS SIKERESEN LEFUTOTT ${totalElapsed} MÁSODPERC ALATT!`);

    } catch (err) {
        console.error(`💥 Hiba a térképek frissítése közben: ${err.message}`);
        console.log(`⏭️ Sebaj, megtartjuk a korábbi térképfájlokat.`);
    }
}

updateMaps();
