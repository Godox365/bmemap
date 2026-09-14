const fs = require('fs');
const path = require('path');

const BUILDINGS = ['k', 'i', 'q', 'e', 'r', 'kt', 'a', 'j'];
const dataDir = path.join(__dirname, '..', 'data');
const outputFile = path.join(dataDir, 'search_index.json');

function generateSearchIndex() {
    console.log('🔍 Keresési index generálása az épületek GeoJSON fájljaiból...');
    const searchIndex = [];

    BUILDINGS.forEach(b => {
        const filePath = path.join(dataDir, `${b}_epulet.json`);
        if (!fs.existsSync(filePath)) {
            console.warn(`⚠️ Fájl nem található: ${filePath}`);
            return;
        }

        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const bKey = b.toUpperCase();
        let count = 0;

        (data.features || []).forEach(f => {
            const p = f.properties || {};

            // 1. Kizárjuk a folyosókat, lépcsőket és lifteket
            const isCorridor = p.highway === 'corridor' || p.indoor === 'corridor' || p.room === 'corridor';
            const isStairs = p.highway === 'steps' || p.indoor === 'steps' || p.room === 'stairs' || p.indoor === 'staircase' || p.room === 'staircase' || p.stairs === 'yes';
            const isElevator = p.highway === 'elevator' || p.room === 'elevator' || p.indoor === 'elevator' || p.amenity === 'elevator';
            if (isCorridor || isStairs || isElevator) return;

            // 2. Épület körvonal és szint/fal elemek kizárása
            if (p.building && !p.indoor && !p.room) return;
            if (p.indoor === 'level' || p.indoor === 'wall') return;

            // 3. Csak nevesített vagy ref azonosítóval rendelkező elemek
            if (p.name || p.ref || p.alt_name) {
                searchIndex.push({
                    id: f.id,
                    b: bKey,
                    ref: p.ref || undefined,
                    name: p.name || undefined,
                    alt: p.alt_name || undefined,
                    lvl: p.level !== undefined ? String(p.level).split(';')[0].trim() : '0',
                    lref: p['level:ref'] || undefined
                });
                count++;
            }
        });

        console.log(`  🏢 ${bKey} épület: ${count} kereshető terem hozzáadva.`);
    });

    // 4. BME Kampusz épületek hozzáadása a keresési indexhez
    const campusPath = path.join(dataDir, 'campus_buildings.json');
    if (fs.existsSync(campusPath)) {
        const campusData = JSON.parse(fs.readFileSync(campusPath, 'utf8'));
        let bCount = 0;
        (campusData.features || []).forEach(f => {
            const p = f.properties || {};
            const code = (p.code || p.key || '').toUpperCase();
            if (!code) return;

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
            bCount++;
        });
        console.log(`  🏛️ Kampusz: ${bCount} épület hozzáadva a keresési indexhez.`);
    }

    const jsonStr = JSON.stringify(searchIndex);
    fs.writeFileSync(outputFile, jsonStr, 'utf8');

    const sizeKb = (Buffer.byteLength(jsonStr, 'utf8') / 1024).toFixed(1);
    console.log(`\n✅ Sikeresen mentve: ${outputFile}`);
    console.log(`📊 Összesen ${searchIndex.length} kereshető elem az indexben (${sizeKb} KB nyers méret).`);
}

generateSearchIndex();
