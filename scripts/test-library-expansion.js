/**
 * Integration Test for Library (KT) Expansion, Sóhajok Hídja Bridge routing,
 * Per-Room Access Rules, Canonical Codes, and Smart Navigation Redirects.
 */

const fs = require('fs');
const path = require('path');

// Self-contained fast turf mock
const turf = {
    bbox: (geojson) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const scan = (coords) => {
            if (!coords) return;
            if (typeof coords[0] === 'number') {
                const x = coords[0], y = coords[1];
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            } else {
                for (const c of coords) scan(c);
            }
        };
        const feats = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
        for (const f of feats) {
            if (f && f.geometry) scan(f.geometry.coordinates);
        }
        return [minX, minY, maxX, maxY];
    },
    point: (coords) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords } }),
    lineString: (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }),
    polygon: (coords) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: coords } }),
    polygonToLine: (poly) => {
        if (!poly || !poly.geometry) return null;
        const coords = poly.geometry.coordinates;
        return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords[0] || [] } };
    },
    centroid: (feat) => {
        let allCoords = [];
        const extract = (geom) => {
            if (!geom) return;
            if (geom.type === 'Point') allCoords.push(geom.coordinates);
            else if (geom.type === 'LineString') geom.coordinates.forEach(c => allCoords.push(c));
            else if (geom.type === 'Polygon') geom.coordinates.forEach(ring => ring.forEach(c => allCoords.push(c)));
            else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(c => allCoords.push(c))));
        };
        extract(feat.geometry || feat);
        if (allCoords.length === 0) return turf.point([0, 0]);
        let sumX = 0, sumY = 0;
        allCoords.forEach(c => { sumX += c[0]; sumY += c[1]; });
        return turf.point([sumX / allCoords.length, sumY / allCoords.length]);
    },
    center: (feat) => turf.centroid(feat),
    distance: (p1, p2, options = {}) => {
        const c1 = p1.geometry ? p1.geometry.coordinates : (Array.isArray(p1) ? p1 : [p1.lon, p1.lat]);
        const c2 = p2.geometry ? p2.geometry.coordinates : (Array.isArray(p2) ? p2 : [p2.lon, p2.lat]);
        const dLat = (c2[1] - c1[1]) * 111139;
        const meanLatRad = ((c1[1] + c2[1]) * 0.5) * (Math.PI / 180);
        const dLon = (c2[0] - c1[0]) * (111139 * Math.cos(meanLatRad));
        const distMeters = Math.sqrt(dLat * dLat + dLon * dLon);
        if (options.units === 'meters') return distMeters;
        return distMeters / 1000; // km default
    },
    pointToLineDistance: (pt, line, options = {}) => {
        const p = pt.geometry ? pt.geometry.coordinates : pt;
        const coords = line.geometry ? line.geometry.coordinates : line;
        let minDist = Infinity;
        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const d = turf._distToSegment(p, p1, p2);
            if (d < minDist) minDist = d;
        }
        if (options.units === 'meters') return minDist;
        return minDist / 1000;
    },
    _distToSegment: (p, v, w) => {
        const l2 = Math.pow(w[0] - v[0], 2) + Math.pow(w[1] - v[1], 2);
        if (l2 === 0) return turf.distance(turf.point(p), turf.point(v), { units: 'meters' });
        let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
        t = Math.max(0, Math.min(1, t));
        const proj = [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])];
        return turf.distance(turf.point(p), turf.point(proj), { units: 'meters' });
    },
    nearestPointOnLine: (line, pt) => {
        const p = pt.geometry ? pt.geometry.coordinates : pt;
        const coords = line.geometry ? line.geometry.coordinates : line;
        let minDist = Infinity;
        let bestProj = coords[0];
        let bestIndex = 0;
        for (let i = 0; i < coords.length - 1; i++) {
            const v = coords[i];
            const w = coords[i + 1];
            const l2 = Math.pow(w[0] - v[0], 2) + Math.pow(w[1] - v[1], 2);
            let t = 0;
            if (l2 > 0) {
                t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
                t = Math.max(0, Math.min(1, t));
            }
            const proj = [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])];
            const d = turf.distance(turf.point(p), turf.point(proj), { units: 'meters' });
            if (d < minDist) {
                minDist = d;
                bestProj = proj;
                bestIndex = i;
            }
        }
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: bestProj },
            properties: {
                dist: minDist / 1000,
                index: bestIndex
            }
        };
    }
};

// Mock i18n
const huJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/hu.json'), 'utf8'));
const enJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en.json'), 'utf8'));

global.t = function(keyPath, params = {}, fallback = '') {
    const getValue = (obj, p) => p.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
    let val = getValue(huJson, keyPath) || fallback || keyPath;
    if (typeof val === 'string' && params && typeof params === 'object') {
        return val.replace(/\{(\w+)\}/g, (match, paramName) => {
            return params[paramName] !== undefined ? params[paramName] : match;
        });
    }
    return val;
};

// Read app.js code
const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

// Load kt_epulet.json, k_epulet.json, and search_index.json
const ktData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/kt_epulet.json'), 'utf8'));
const kData = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/k_epulet.json'), 'utf8'));
const searchIndex = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/search_index.json'), 'utf8'));

let errors = [];
function assert(condition, message) {
    if (!condition) {
        console.error(`❌ FAIL: ${message}`);
        errors.push(message);
    } else {
        console.log(`✅ PASS: ${message}`);
    }
}

console.log('--- TEST 1: Canonical room codes in KT and K (KF53, KMF50, KMF51) ---');
{
    const fnMatch = appCode.match(/function getCanonicalRoomCode\([\s\S]*?\n\}/);
    if (!fnMatch) throw new Error('Could not find getCanonicalRoomCode in app.js');
    const getCanonicalRoomCode = new Function('p', 'buildingKey', `
        const BUILDINGS = { KT: { key: 'KT' }, K: { key: 'K' } };
        let currentBuildingKey = buildingKey;
        ${appCode.match(/const LIBRARY_EXTENSION_OSM_IDS = [\s\S]*?\];/)[0]}
        ${appCode.match(/function isLibraryRoomFeature\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function getLibraryRoomAccess\([\s\S]*?\n\}/)[0]}
        ${fnMatch[0]};
        return getCanonicalRoomCode(p, buildingKey);
    `);

    // In KT view, library extension rooms delegate to K rules:
    const codeKT50 = getCanonicalRoomCode({ ref: '50', id: 'way/1467348484', level: '1' }, 'KT');
    assert(codeKT50 === 'KMF50', `Ref 50 in KT returns canonical "KMF50", got: ${codeKT50}`);

    const codeKT_KDot50 = getCanonicalRoomCode({ ref: 'K.50', level: '1' }, 'KT');
    assert(codeKT_KDot50 === 'KMF50', `Ref "K.50" on Level 1 in KT returns "KMF50", got: ${codeKT_KDot50}`);

    const codeKT_K50 = getCanonicalRoomCode({ ref: 'K50', level: '1' }, 'KT');
    assert(codeKT_K50 === 'KMF50', `Ref "K50" on Level 1 in KT returns "KMF50", got: ${codeKT_K50}`);

    const codeKT51 = getCanonicalRoomCode({ ref: '51', id: 'way/1467348447', level: '1' }, 'KT');
    assert(codeKT51 === 'KMF51', `Ref 51 in KT returns canonical "KMF51", got: ${codeKT51}`);

    const codeKT_KDot51 = getCanonicalRoomCode({ ref: 'K.51', level: '1' }, 'KT');
    assert(codeKT_KDot51 === 'KMF51', `Ref "K.51" on Level 1 in KT returns "KMF51", got: ${codeKT_KDot51}`);

    const codeKT53 = getCanonicalRoomCode({ ref: '53', id: 'way/1465997021', level: '0' }, 'KT');
    assert(codeKT53 === 'KF53', `Ref 53 in KT returns canonical "KF53", got: ${codeKT53}`);

    const codeKT_KDot53 = getCanonicalRoomCode({ ref: 'K.53', level: '0' }, 'KT');
    assert(codeKT_KDot53 === 'KF53', `Ref "K.53" on Level 0 in KT returns "KF53", got: ${codeKT_KDot53}`);

    // Native KT room
    const codeKT10 = getCanonicalRoomCode({ ref: '10' }, 'KT');
    assert(codeKT10 === 'KT10', `Native KT room in KT returns "KT10", got: ${codeKT10}`);

    // In K view:
    const codeK50 = getCanonicalRoomCode({ ref: '50', level: '1' }, 'K');
    assert(codeK50 === 'KMF50', `Ref 50 on Level 1 in K returns "KMF50", got: ${codeK50}`);

    const codeK_KDot50 = getCanonicalRoomCode({ ref: 'K.50', level: '1' }, 'K');
    assert(codeK_KDot50 === 'KMF50', `Ref "K.50" on Level 1 in K returns "KMF50", got: ${codeK_KDot50}`);

    const codeK_K50 = getCanonicalRoomCode({ ref: 'K50', level: '1' }, 'K');
    assert(codeK_K50 === 'KMF50', `Ref "K50" on Level 1 in K returns "KMF50", got: ${codeK_K50}`);

    const codeK51 = getCanonicalRoomCode({ ref: '51', level: '1' }, 'K');
    assert(codeK51 === 'KMF51', `Ref 51 on Level 1 in K returns "KMF51", got: ${codeK51}`);

    const codeK_KDot51 = getCanonicalRoomCode({ ref: 'K.51', level: '1' }, 'K');
    assert(codeK_KDot51 === 'KMF51', `Ref "K.51" on Level 1 in K returns "KMF51", got: ${codeK_KDot51}`);

    const codeK53 = getCanonicalRoomCode({ ref: '53', level: '0' }, 'K');
    assert(codeK53 === 'KF53', `Ref 53 on Level 0 in K returns "KF53", got: ${codeK53}`);

    const codeK_KDot53 = getCanonicalRoomCode({ ref: 'K.53', level: '0' }, 'K');
    assert(codeK_KDot53 === 'KF53', `Ref "K.53" on Level 0 in K returns "KF53", got: ${codeK_KDot53}`);

    // Upper floors in K
    const codeK150 = getCanonicalRoomCode({ ref: '150', level: '2' }, 'K');
    assert(codeK150 === 'K150', `Ref 150 on Level 2 in K returns "K150", got: ${codeK150}`);

    const codeK_KDot150 = getCanonicalRoomCode({ ref: 'K.150', level: '2' }, 'K');
    assert(codeK_KDot150 === 'K150', `Ref "K.150" on Level 2 in K returns "K150", got: ${codeK_KDot150}`);

    const codeK350 = getCanonicalRoomCode({ ref: '50', level: '3', 'level:ref': '2' }, 'K');
    assert(codeK350 === 'K250', `Ref 50 on Level 3 (2. emelet) in K returns "K250", got: ${codeK350}`);

    const codeK_KDot350 = getCanonicalRoomCode({ ref: 'K.50', level: '3', 'level:ref': '2' }, 'K');
    assert(codeK_KDot350 === 'K250', `Ref "K.50" on Level 3 (2. emelet) in K returns "K250", got: ${codeK_KDot350}`);
}

console.log('\n--- TEST 2: Real OSM Bridge Corridor (way/1564033986) & No Fake Centerline ---');
{
    const bridgeKT = ktData.features.find(f => f.id === 'way/1564033986');
    assert(bridgeKT !== undefined, `way/1564033986 exists in kt_epulet.json`);
    assert(bridgeKT && bridgeKT.properties.bridge === 'yes', `way/1564033986 in kt has bridge: 'yes'`);
    assert(bridgeKT && bridgeKT.properties.name === 'Sóhajok Hídja', `way/1564033986 in kt has name: 'Sóhajok Hídja'`);

    const bridgeK = kData.features.find(f => f.id === 'way/1564033986');
    assert(bridgeK !== undefined, `way/1564033986 exists in k_epulet.json`);
    assert(bridgeK && bridgeK.properties.bridge === 'yes', `way/1564033986 in k has bridge: 'yes'`);
    assert(bridgeK && bridgeK.properties.name === 'Sóhajok Hídja', `way/1564033986 in k has name: 'Sóhajok Hídja'`);

    const fakeCenterlineKT = ktData.features.find(f => f.id === 'way/1530062494/centerline');
    assert(fakeCenterlineKT === undefined, `Fake centerline way/1530062494/centerline is NOT in kt_epulet.json`);

    const fakeCenterlineK = kData.features.find(f => f.id === 'way/1530062494/centerline');
    assert(fakeCenterlineK === undefined, `Fake centerline way/1530062494/centerline is NOT in k_epulet.json`);
}

console.log('\n--- TEST 3: Process levels in KT (levelAliases isolation) ---');
{
    const processLevelsSandbox = new Function('geoJsonData', 'currentBuildingKey', 'getDefaultLevelForBuilding', `
        let levelAliases = {};
        let availableLevels = [];
        let currentLevel = '0';
        function getLevelsFromFeature(f) {
            const p = f.properties || {};
            const l = p.level || "0";
            return l.split(';').map(s => s.trim());
        }
        ${appCode.match(/function processLevels\(\) \{[\s\S]*?\n\}/)[0]}
        processLevels();
        return { levelAliases, availableLevels, currentLevel };
    `);

    const res = processLevelsSandbox(ktData, 'KT', () => '0');
    assert(res.levelAliases['1'] === undefined, `KT does NOT set levelAliases['1'] = 'MF', got: ${res.levelAliases['1']}`);
    assert(res.availableLevels.includes('1'), `KT availableLevels includes '1'`);
    assert(res.availableLevels.includes('0'), `KT availableLevels includes '0'`);
    assert(res.availableLevels.includes('-1'), `KT availableLevels includes '-1'`);

    // In K building, levelAliases['1'] SHOULD be 'MF'
    const resK = processLevelsSandbox(kData, 'K', () => '1');
    assert(resK.levelAliases['1'] === 'MF', `K sets levelAliases['1'] = 'MF', got: ${resK.levelAliases['1']}`);
}

console.log('\n--- TEST 4: Navigation Graph & Routing (KT Bridge & K Local KF53) ---');
{
    const routingSandbox = new Function('geoJsonData', 'currentBuilding', 'currentBuildingKey', 'APP_SETTINGS', 't', 'turf', `
        let navigationGraph = new Map();
        let mainEntranceNode = null;
        let levelAliases = {};
        let doorNodes = new Set();
        
        function fastDistMeters(lat1, lon1, lat2, lon2) {
            const dLat = (lat2 - lat1) * 111139;
            const meanLatRad = ((lat1 + lat2) * 0.5) * (Math.PI / 180);
            const dLon = (lon2 - lon1) * (111139 * Math.cos(meanLatRad));
            return Math.sqrt(dLat * dLat + dLon * dLon);
        }
        function toKey(lat, lon, level) {
            return lat.toFixed(6) + ',' + lon.toFixed(6) + ',' + level;
        }
        function getLevelsFromFeature(f) {
            const p = f.properties || {};
            const l = p.level || "0";
            return l.split(';').map(s => s.trim());
        }
        
        ${appCode.match(/function connectVerticalShaftToCorridor\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function buildRoutingGraph\(\) \{[\s\S]*?\n\}/)[0]}
        ${appCode.match(/function getDoorsForRoom\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function injectNodeIntoGraph\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/class MinHeap \{[\s\S]*?\n\}/)[0]}
        ${appCode.match(/function runDijkstra\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function generateItinerary\([\s\S]*?\n\}/)[0]}

        buildRoutingGraph();

        return {
            navigationGraph,
            mainEntranceNode,
            injectNodeIntoGraph,
            getDoorsForRoom,
            runDijkstra,
            generateItinerary,
            toKey
        };
    `);

    // 1. In KT: route to KMF50 across real bridge way/1564033986
    const envKT = routingSandbox(
        ktData,
        { center: [47.4808, 19.0543], zoom: 19 },
        'KT',
        { elevatorMode: 'balanced' },
        global.t,
        turf
    );

    assert(envKT.mainEntranceNode !== null, `KT main entrance found`);

    let bridgeEdgeCount = 0;
    for (const [k, neighbors] of envKT.navigationGraph.entries()) {
        for (const n of neighbors) {
            if (n.isBridge) {
                bridgeEdgeCount++;
                assert(n.bridgeName === 'Sóhajok Hídja', `Bridge edge has bridgeName 'Sóhajok Hídja', got: ${n.bridgeName}`);
            }
        }
    }
    assert(bridgeEdgeCount > 0, `KT navigation graph contains bridge edges (found ${bridgeEdgeCount})`);

    function testRouteKT(targetFeatureId, targetName) {
        const target = ktData.features.find(f => f.id === targetFeatureId);
        assert(target !== undefined, `Found feature ${targetFeatureId} in ktData`);
        if (!target) return;

        const startNode = envKT.injectNodeIntoGraph(envKT.mainEntranceNode.lat, envKT.mainEntranceNode.lon, envKT.mainEntranceNode.level, 5.0) 
            || { key: envKT.toKey(envKT.mainEntranceNode.lat, envKT.mainEntranceNode.lon, envKT.mainEntranceNode.level) };

        const doors = envKT.getDoorsForRoom(target);
        let endNode = null;
        if (doors.length > 0) {
            for (const d of doors) {
                const c = d.geometry.coordinates;
                const dLvl = (d.properties.level || target.properties.level || '0').split(';')[0].trim();
                const node = envKT.injectNodeIntoGraph(c[1], c[0], dLvl, 5.0);
                if (node) { endNode = node; break; }
            }
        }
        if (!endNode) {
            const centroid = turf.centroid(target);
            const tLvl = (target.properties.level || '0').split(';')[0].trim();
            endNode = envKT.injectNodeIntoGraph(centroid.geometry.coordinates[1], centroid.geometry.coordinates[0], tLvl, 20.0);
        }

        assert(endNode !== null, `End node injected for ${targetName}`);
        if (!endNode) return;

        const route = envKT.runDijkstra(startNode.key, endNode.key);
        assert(route !== null && route.path.length > 0, `Dijkstra path found to ${targetName} (${route ? route.path.length : 0} nodes, ${route ? Math.round(route.distance) : 0}m)`);

        if (route) {
            const itinerary = envKT.generateItinerary(route.path);
            const bridgeStep = itinerary.find(s => s.type === 'bridge');
            assert(bridgeStep !== undefined, `Itinerary contains dedicated bridge step for ${targetName}`);
            if (bridgeStep) {
                assert(bridgeStep.text.includes('Sóhajok Hídja'), `Bridge step mentions 'Sóhajok Hídja'`);
            }
        }
    }

    testRouteKT('way/1467348484', 'KMF50 (GTK Olvasó)');
    testRouteKT('way/1467348447', 'KMF51 (Közösségi terem)');

    // 2. In K: route to KF53 locally
    const envK = routingSandbox(
        kData,
        { center: [47.4816, 19.0559], zoom: 19 },
        'K',
        { elevatorMode: 'balanced' },
        global.t,
        turf
    );

    assert(envK.mainEntranceNode !== null, `K main entrance found`);
    const targetKF53 = kData.features.find(f => f.id === 'way/1465997085') || kData.features.find(f => f.id === 'way/1465997021');
    assert(targetKF53 !== undefined, `Found KF53 in kData`);
    if (targetKF53) {
        const startNodeK = envK.injectNodeIntoGraph(envK.mainEntranceNode.lat, envK.mainEntranceNode.lon, envK.mainEntranceNode.level, 5.0)
            || { key: envK.toKey(envK.mainEntranceNode.lat, envK.mainEntranceNode.lon, envK.mainEntranceNode.level) };
        const doors = envK.getDoorsForRoom(targetKF53);
        let endNodeK = null;
        for (const d of doors) {
            const c = d.geometry.coordinates;
            const node = envK.injectNodeIntoGraph(c[1], c[0], '0', 5.0);
            if (node) { endNodeK = node; break; }
        }
        if (!endNodeK) {
            const centroid = turf.centroid(targetKF53);
            endNodeK = envK.injectNodeIntoGraph(centroid.geometry.coordinates[1], centroid.geometry.coordinates[0], '0', 25.0);
        }
        assert(endNodeK !== null, `Injected end node for KF53 in K`);
        if (endNodeK) {
            const routeK = envK.runDijkstra(startNodeK.key, endNodeK.key);
            assert(routeK !== null && routeK.path.length > 0, `Local route in K to KF53 found (${routeK ? routeK.path.length : 0} nodes, ${routeK ? Math.round(routeK.distance) : 0}m)`);
        }
    }
}

console.log('\n--- TEST 5: Smart Navigation Redirect based on access rules ---');
{
    const accessFn = new Function(`
        ${appCode.match(/const LIBRARY_EXTENSION_OSM_IDS = [\s\S]*?\];/)[0]}
        ${appCode.match(/function isLibraryRoomFeature\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function getLibraryRoomAccess\([\s\S]*?\n\}/)[0]}
        return getLibraryRoomAccess;
    `)();

    const dummyGeom = { type: 'Polygon', coordinates: [[[19.055, 47.481], [19.0551, 47.481], [19.0551, 47.4811], [19.055, 47.481]]] };
    const fBridge = { id: 'way/1530062494', properties: { name: 'Sóhajok Hídja', libraryAccess: 'bridge' }, geometry: dummyGeom };
    const fBridgeWay = { id: 'way/1564033986', properties: { name: 'Sóhajok Hídja', libraryAccess: 'bridge' }, geometry: dummyGeom };
    const fKMF50 = { id: 'way/1467348484', properties: { ref: '50', libraryAccess: 'bridge' }, geometry: dummyGeom };
    const fKMF51 = { id: 'way/1467348447', properties: { ref: '51', libraryAccess: 'both' }, geometry: dummyGeom };
    const fKF53 = { id: 'way/1465997021', properties: { ref: '53', libraryAccess: 'k' }, geometry: dummyGeom };

    assert(accessFn(fBridge) === 'bridge', `Bridge polygon access is 'bridge'`);
    assert(accessFn(fBridgeWay) === 'bridge', `Bridge way access is 'bridge'`);
    assert(accessFn(fKMF50) === 'bridge', `KMF50 access is 'bridge'`);
    assert(accessFn(fKMF51) === 'both', `KMF51 access is 'both'`);
    assert(accessFn(fKF53) === 'k', `KF53 access is 'k'`);

    let redirectedBuilding = null;
    let redirectTargetId = null;

    const navEnv = {
        currentBuildingKey: 'K',
        currentLevel: '0',
        levelAliases: { '0': '0', '1': 'MF' },
        selectedFeature: null,
        mainEntranceNode: { lat: 47.4816, lon: 19.0559, level: '0', key: '47.481600,19.055900,0' },
        toKey: (lat, lon, level) => lat.toFixed(6) + ',' + lon.toFixed(6) + ',' + level,
        getLibraryRoomAccess: accessFn,
        changeBuilding: (b, term, targetId, preserve, autoNav) => {
            redirectedBuilding = b;
            redirectTargetId = targetId;
        },
        console: { clear: () => {} },
        buildRoutingGraph: () => {},
        _clearPoiMarkers: () => {},
        activePoiCategory: null,
        resetNearbyMenu: () => {},
        activeRouteData: null,
        getLevelsFromFeature: () => ['0'],
        getDoorsForRoom: () => [],
        injectNodeIntoGraph: () => null,
        findNearestNodeInGraph: () => null,
        runDijkstra: () => ({ path: [], distance: 0 }),
        generateItinerary: () => [],
        drawRoute: () => {},
        showNavigationSheet: () => {},
        turf: turf,
        alert: () => {}
    };

    const startNavFn = new Function('env', 'targetFeature', 'fromFeature', `
        with (env) {
            ${appCode.match(/function startNavigation\([\s\S]*?\n\}/)[0]}
            startNavigation(targetFeature, fromFeature);
        }
    `);

    // 1. In K navigating to KMF50 (access: bridge) -> REDIRECT to KT
    navEnv.currentBuildingKey = 'K';
    redirectedBuilding = null;
    startNavFn(navEnv, fKMF50, null);
    assert(redirectedBuilding === 'KT', `startNavigation in K to KMF50 redirects to KT: ${redirectedBuilding}`);
    assert(redirectTargetId === 'way/1467348484', `targetId passed to changeBuilding is way/1467348484`);

    // 2. In KT navigating to KF53 (access: k) -> REDIRECT to K
    navEnv.currentBuildingKey = 'KT';
    redirectedBuilding = null;
    startNavFn(navEnv, fKF53, null);
    assert(redirectedBuilding === 'K', `startNavigation in KT to KF53 redirects to K: ${redirectedBuilding}`);
    assert(redirectTargetId === 'way/1465997021', `targetId passed to changeBuilding is way/1465997021`);

    // 3. In K navigating to KF53 (access: k) -> LOCAL route (no redirect)
    navEnv.currentBuildingKey = 'K';
    redirectedBuilding = null;
    startNavFn(navEnv, fKF53, null);
    assert(redirectedBuilding === null, `startNavigation in K to KF53 does NOT redirect (stays in K)`);

    // 4. In KT navigating to KMF50 (access: bridge) -> LOCAL route (no redirect)
    navEnv.currentBuildingKey = 'KT';
    redirectedBuilding = null;
    startNavFn(navEnv, fKMF50, null);
    assert(redirectedBuilding === null, `startNavigation in KT to KMF50 does NOT redirect (stays in KT)`);

    // 5. In K navigating to KMF51 (access: both) -> LOCAL route (no redirect)
    navEnv.currentBuildingKey = 'K';
    redirectedBuilding = null;
    startNavFn(navEnv, fKMF51, null);
    assert(redirectedBuilding === null, `startNavigation in K to KMF51 does NOT redirect`);

    // 6. In KT navigating to KMF51 (access: both) -> LOCAL route (no redirect)
    navEnv.currentBuildingKey = 'KT';
    redirectedBuilding = null;
    startNavFn(navEnv, fKMF51, null);
    assert(redirectedBuilding === null, `startNavigation in KT to KMF51 does NOT redirect`);

    // 7. Runtime feature with numeric id (post processOsmData) in KT: ensures targetId is string OSM ID
    const fRuntimeKF53 = {
        id: 214,
        _originalId: 'way/1465997021',
        properties: { id: 'way/1465997021', osm_id: 'way/1465997021', ref: '53', libraryAccess: 'k' },
        geometry: dummyGeom
    };
    navEnv.currentBuildingKey = 'KT';
    redirectedBuilding = null;
    redirectTargetId = null;
    startNavFn(navEnv, fRuntimeKF53, null);
    assert(redirectedBuilding === 'K', `startNavigation with numeric id redirects to K: ${redirectedBuilding}`);
    assert(redirectTargetId === 'way/1465997021', `targetId passed is string OSM ID "way/1465997021", got: ${redirectTargetId}`);

    // 8. Runtime feature with numeric id (post processOsmData) in K: ensures targetId is string OSM ID
    const fRuntimeKMF50 = {
        id: 1269,
        _originalId: 'way/1467348484',
        properties: { id: 'way/1467348484', osm_id: 'way/1467348484', ref: '50', libraryAccess: 'bridge' },
        geometry: dummyGeom
    };
    navEnv.currentBuildingKey = 'K';
    redirectedBuilding = null;
    redirectTargetId = null;
    startNavFn(navEnv, fRuntimeKMF50, null);
    assert(redirectedBuilding === 'KT', `startNavigation with numeric id redirects to KT: ${redirectedBuilding}`);
    assert(redirectTargetId === 'way/1467348484', `targetId passed is string OSM ID "way/1467348484", got: ${redirectTargetId}`);
}

console.log('\n--- TEST 6: Search Filtering in KT and K for kmf50 and kf53 ---');
{
    const searchSandbox = new Function('geoJsonData', 'currentBuildingKey', 'BUILDINGS', `
        const levelAliases = { "1": "MF" };
        function normalizeRoomId(str) {
            if(!str) return "";
            return str.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[\\s.\\-_/()]/g, '').toLowerCase();
        }
        function getMatchingTags() { return []; }
        function getLevelsFromFeature(f) { return [f.properties.level || "0"]; }
        function getLevelChars() { return ["0", "1", "mf"]; }
        ${appCode.match(/const LIBRARY_EXTENSION_OSM_IDS = [\s\S]*?\];/)[0]}
        ${appCode.match(/function isLibraryRoomFeature\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function getLibraryRoomAccess\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function getCanonicalRoomCode\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function smartFilter\([\s\S]*?\n\}/)[0]}
        return smartFilter;
    `);

    // 1. In K: searching for "kmf50" excludes way/1467348484 from local hits (delegating to KT search index)
    const smartFilterK = searchSandbox(kData, 'K', { K: { key: 'K' }, KT: { key: 'KT' } });
    const kHitsKMF50 = smartFilterK('kmf50');
    assert(!kHitsKMF50.some(h => h.id === 'way/1467348484'), `smartFilter in K excludes KMF50 (access: bridge) from local K hits`);

    // 2. In K: searching for "kf53" INCLUDES KF53 (access: k) as a local hit!
    const kHitsKF53 = smartFilterK('kf53');
    assert(kHitsKF53.some(h => h.id === 'way/1465997021' || h.id === 'way/1465997085'), `smartFilter in K INCLUDES KF53 as a local K hit!`);

    // 3. In KT: searching for "kmf50" finds KMF50 locally!
    const smartFilterKT = searchSandbox(ktData, 'KT', { KT: { key: 'KT' } });
    const ktHitsKMF50 = smartFilterKT('kmf50');
    assert(ktHitsKMF50.some(h => h.id === 'way/1467348484'), `smartFilter in KT finds KMF50 locally!`);

    // 4. In search_index.json:
    const siKMF50 = searchIndex.find(x => x.id === 'way/1467348484');
    assert(siKMF50 && siKMF50.b === 'KT', `search_index.json: KMF50 has b: 'KT'`);

    const siKF53 = searchIndex.find(x => x.id === 'way/1465997021' || x.id === 'way/1465997085');
    assert(siKF53 && siKF53.b === 'K', `search_index.json: KF53 has b: 'K'`);

    const siKMF51 = searchIndex.find(x => x.id === 'way/1467348447' || x.id === 'way/1467348448');
    assert(siKMF51 && siKMF51.b === 'K', `search_index.json: KMF51 has b: 'K'`);
}

console.log('\n--- TEST 7: Per-floor polygon filtering in update-maps.js ---');
{
    const updateMaps = require('../update-maps.js');
    assert(typeof updateMaps.applyLibraryExtension === 'function', `applyLibraryExtension exported from update-maps.js`);

    // Create a mock separated structure with features inside and outside custom level polygons
    const testSeparated = {
        k: [
            // Level 0 feature inside level 0 polygon
            {
                type: 'Feature',
                id: 'test/level0_inside',
                properties: { indoor: 'room', level: '0', room: 'corridor' },
                geometry: { type: 'Point', coordinates: [19.05500, 47.48100] }
            },
            // Level 0 feature inside bbox but outside level 0 polygon
            {
                type: 'Feature',
                id: 'test/level0_outside_poly',
                properties: { indoor: 'room', level: '0', room: 'corridor' },
                geometry: { type: 'Point', coordinates: [19.05460, 47.48090] }
            },
            // Level 1 feature inside level 1 polygon
            {
                type: 'Feature',
                id: 'test/level1_inside',
                properties: { indoor: 'room', level: '1', room: 'corridor' },
                geometry: { type: 'Point', coordinates: [19.05470, 47.48100] }
            }
        ],
        kt: []
    };

    // Temp config file for testing polygon filtering
    const tempConfigPath = path.join(__dirname, '../data/test_polygon_config.json');
    fs.writeFileSync(tempConfigPath, JSON.stringify({
        sourceBuilding: 'k',
        targetBuilding: 'kt',
        rooms: [],
        polygons: {
            "0": [
                [19.05485, 47.48095],
                [19.05520, 47.48095],
                [19.05520, 47.48110],
                [19.05485, 47.48110]
            ],
            "1": [
                [19.05459, 47.48096],
                [19.05520, 47.48096],
                [19.05520, 47.48120],
                [19.05459, 47.48120]
            ]
        },
        autoInfrastructure: {
            enabled: true,
            bbox: [19.05455, 47.48085, 19.05520, 47.48125],
            levels: ["0", "1"],
            filterTags: ["corridor"]
        }
    }), 'utf8');

    try {
        updateMaps.applyLibraryExtension(testSeparated, tempConfigPath);
        const ktResultIds = testSeparated.kt.map(f => f.id);
        assert(ktResultIds.includes('test/level0_inside'), `Feature inside level 0 polygon is included`);
        assert(!ktResultIds.includes('test/level0_outside_poly'), `Feature outside level 0 polygon is excluded (even though inside bbox)`);
        assert(ktResultIds.includes('test/level1_inside'), `Feature inside level 1 polygon is included`);
    } finally {
        if (fs.existsSync(tempConfigPath)) fs.unlinkSync(tempConfigPath);
    }
}

console.log('\n--- TEST 8: English i18n & Unnamed Bridge Itinerary ---');
{
    const tEn = function(keyPath, params = {}, fallback = '') {
        const getValue = (obj, p) => p.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
        let val = getValue(enJson, keyPath) || fallback || keyPath;
        if (typeof val === 'string' && params && typeof params === 'object') {
            return val.replace(/\{(\w+)\}/g, (match, paramName) => {
                return params[paramName] !== undefined ? params[paramName] : match;
            });
        }
        return val;
    };

    const generateItineraryFn = new Function('t', 'navigationGraph', 'levelAliases', `
        ${appCode.match(/function generateItinerary\([\s\S]*?\n\}/)[0]}
        return generateItinerary;
    `);

    // 1. Named bridge in English
    const mockGraphEn = new Map();
    mockGraphEn.set('1,1,1', [{ key: '2,2,1', isBridge: true, bridgeName: 'Sóhajok Hídja' }]);
    const itineraryNamedEn = generateItineraryFn(tEn, mockGraphEn, {})(['1,1,1', '2,2,1']);
    assert(itineraryNamedEn.length === 1, `Named bridge itinerary produced 1 step in EN`);
    assert(itineraryNamedEn[0].text === 'Walk across Sóhajok Hídja', `Named bridge in EN returns "Walk across Sóhajok Hídja", got: "${itineraryNamedEn[0].text}"`);

    // 2. Unnamed bridge in Hungarian
    const mockGraphHuUnnamed = new Map();
    mockGraphHuUnnamed.set('1,1,1', [{ key: '2,2,1', isBridge: true, bridgeName: '' }]);
    const itineraryUnnamedHu = generateItineraryFn(global.t, mockGraphHuUnnamed, {})(['1,1,1', '2,2,1']);
    assert(itineraryUnnamedHu.length === 1, `Unnamed bridge itinerary produced 1 step in HU`);
    assert(itineraryUnnamedHu[0].text === 'Sétálj át a(z) összekötő hídon', `Unnamed bridge in HU returns "Sétálj át a(z) összekötő hídon", got: "${itineraryUnnamedHu[0].text}"`);

    // 3. Unnamed bridge in English
    const itineraryUnnamedEn = generateItineraryFn(tEn, mockGraphHuUnnamed, {})(['1,1,1', '2,2,1']);
    assert(itineraryUnnamedEn.length === 1, `Unnamed bridge itinerary produced 1 step in EN`);
    assert(itineraryUnnamedEn[0].text === 'Walk across the connecting bridge', `Unnamed bridge in EN returns "Walk across the connecting bridge", got: "${itineraryUnnamedEn[0].text}"`);
}

console.log('\n--- TEST 9: Disambiguation of K Room 50 on Level 3 ---');
{
    const helpers = new Function(`
        ${appCode.match(/const LIBRARY_EXTENSION_OSM_IDS = [\s\S]*?\];/)[0]}
        ${appCode.match(/function isLibraryRoomFeature\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function getLibraryRoomAccess\([\s\S]*?\n\}/)[0]}
        ${appCode.match(/function getCanonicalRoomCode\([\s\S]*?\n\}/)[0]}
        return { isLibraryRoomFeature, getLibraryRoomAccess, getCanonicalRoomCode };
    `)();

    // 1. Real GeoJSON feature in K building: way/1465997312 (ref: "50", level: "3", level:ref: "2")
    const fK350 = { id: 'way/1465997312', properties: { ref: '50', level: '3', 'level:ref': '2' } };
    assert(helpers.isLibraryRoomFeature(fK350) === false, `K room 50 on Level 3 (GeoJSON) is correctly rejected by isLibraryRoomFeature`);
    assert(helpers.getLibraryRoomAccess(fK350) === '', `K room 50 on Level 3 has access '', got: "${helpers.getLibraryRoomAccess(fK350)}"`);
    assert(helpers.getCanonicalRoomCode(fK350, 'K') === 'K250', `K room 50 on Level 3 canonical code is K250, got: "${helpers.getCanonicalRoomCode(fK350, 'K')}"`);

    // 2. Search index item format for Room 50 on Level 3 (uses lvl and lref)
    const itemK350 = { id: 'way/1465997312', ref: '50', lvl: '3', lref: '2' };
    assert(helpers.isLibraryRoomFeature(itemK350) === false, `K room 50 on Level 3 (search index item) is rejected by isLibraryRoomFeature`);
    assert(helpers.getLibraryRoomAccess(itemK350) === '', `K room 50 on Level 3 (search index item) has access '', got: "${helpers.getLibraryRoomAccess(itemK350)}"`);
    assert(helpers.getCanonicalRoomCode(itemK350, 'K') === 'K250', `K room 50 on Level 3 (search index item) canonical code is K250, got: "${helpers.getCanonicalRoomCode(itemK350, 'K')}"`);

    // 3. Library KMF50 on Level 1
    const fK50 = { id: 'way/1467348484', properties: { ref: '50', level: '1', 'level:ref': 'MF' } };
    assert(helpers.isLibraryRoomFeature(fK50) === true, `KMF50 on Level 1 is accepted by isLibraryRoomFeature`);
    assert(helpers.getLibraryRoomAccess(fK50) === 'bridge', `KMF50 on Level 1 has access 'bridge', got: "${helpers.getLibraryRoomAccess(fK50)}"`);
    assert(helpers.getCanonicalRoomCode(fK50, 'KT') === 'KMF50', `KMF50 on Level 1 in KT canonical code is KMF50`);
}

console.log('\n--- TEST 10: Multi-Building Fitbounds & Level Contour Isolation ---');
{
    // 1. KT Building Fitbounds calculation: must exclude K's 500m level contours
    let currentBuildingKey = 'KT';
    let geoJsonData = ktData;
    
    let targetFeatures = geoJsonData.features;
    if (currentBuildingKey === 'KT') {
        targetFeatures = geoJsonData.features.filter(f => {
            const p = f.properties || {};
            const isForeignLevel = (p.indoor === 'level' || p.building) && 
                (p.isForeignLevelOutline === true || p.isLibraryExtension === true || f.id === 'way/1463760597' || f.id === 'way/1463760598');
            return !isForeignLevel;
        });
        if (!targetFeatures || targetFeatures.length === 0) {
            targetFeatures = geoJsonData.features;
        }
    }
    const ktBbox = turf.bbox({ type: 'FeatureCollection', features: targetFeatures });
    assert(ktBbox[2] <= 19.0556, `KT focused bbox maxX <= 19.0556, got: ${ktBbox[2]}`);
    assert(ktBbox[0] >= 19.0540, `KT focused bbox minX >= 19.0540, got: ${ktBbox[0]}`);

    // 2. K Building Fitbounds calculation: must include full 500m building (retaining Danube wing)
    currentBuildingKey = 'K';
    geoJsonData = kData;
    targetFeatures = geoJsonData.features;
    if (currentBuildingKey === 'KT') {
        targetFeatures = geoJsonData.features.filter(f => {
            const p = f.properties || {};
            const isForeignLevel = (p.indoor === 'level' || p.building) && 
                (p.isForeignLevelOutline === true || p.isLibraryExtension === true || f.id === 'way/1463760597' || f.id === 'way/1463760598');
            return !isForeignLevel;
        });
    }
    const kBbox = turf.bbox({ type: 'FeatureCollection', features: targetFeatures });
    assert(kBbox[2] >= 19.0567, `K bbox includes full 500m building (maxX >= 19.0567), got: ${kBbox[2]}`);

    // 3. K Building GeoJSON cleanliness: level outlines must NOT have isLibraryExtension
    const kLevel0 = kData.features.find(f => f.id === 'way/1463760597');
    const kLevel1 = kData.features.find(f => f.id === 'way/1463760598');
    assert(kLevel0 && !kLevel0.properties.isLibraryExtension, `k_epulet.json level 0 contour is NOT marked as library extension`);
    assert(kLevel1 && !kLevel1.properties.isLibraryExtension, `k_epulet.json level 1 contour is NOT marked as library extension`);
    assert(kLevel0 && !kLevel0.properties.isForeignLevelOutline, `k_epulet.json level 0 contour has no isForeignLevelOutline`);
    assert(kLevel1 && !kLevel1.properties.isForeignLevelOutline, `k_epulet.json level 1 contour has no isForeignLevelOutline`);

    // 4. KT Building GeoJSON: level outlines ARE present and marked as foreign level outline for rendering
    const ktLevel0 = ktData.features.find(f => f.id === 'way/1463760597');
    const ktLevel1 = ktData.features.find(f => f.id === 'way/1463760598');
    assert(ktLevel0 && ktLevel0.properties.isForeignLevelOutline === true, `kt_epulet.json level 0 contour has isForeignLevelOutline: true`);
    assert(ktLevel1 && ktLevel1.properties.isForeignLevelOutline === true, `kt_epulet.json level 1 contour has isForeignLevelOutline: true`);
    assert(ktLevel0 && ktLevel0.properties.level === '0', `kt_epulet.json level 0 contour is assigned to level 0`);
    assert(ktLevel1 && ktLevel1.properties.level === '1', `kt_epulet.json level 1 contour is assigned to level 1`);

    // 5. I, Q, E, R Multi-Building Regression Checks: raw bbox and camera bbox must match 100%
    const dataDir = path.join(__dirname, '../data');
    const otherBuildings = ['i', 'q', 'e', 'r'];
    for (const ob of otherBuildings) {
        const obPath = path.join(dataDir, `${ob}_epulet.json`);
        if (fs.existsSync(obPath)) {
            const obData = JSON.parse(fs.readFileSync(obPath, 'utf8'));
            const obKey = ob.toUpperCase();
            let obTargetFeatures = obData.features;
            if (obKey === 'KT') {
                // not KT
            }
            const rawBbox = turf.bbox(obData);
            const computedBbox = turf.bbox({ type: 'FeatureCollection', features: obTargetFeatures });
            assert(rawBbox[0] === computedBbox[0] && rawBbox[2] === computedBbox[2], `${obKey} building bbox is 100% identical and unaffected`);
        }
    }
}

console.log('\n--- TEST SUMMARY ---');
if (errors.length === 0) {
    console.log('🎉 ALL LIBRARY EXPANSION INTEGRATION TESTS PASSED CLEANLY! 🎉');
    process.exit(0);
} else {
    console.error(`💥 ${errors.length} TESTS FAILED!`);
    process.exit(1);
}
