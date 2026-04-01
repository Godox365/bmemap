const fs = require('fs');
const osmtogeojson = require('osmtogeojson');

// Az épületeid központjai az eredeti kódodból
const BUILDINGS = {
    "k": [47.4816562, 19.0559196],
    "i": [47.472616, 19.059552],
    "q": [47.473410, 19.059555],
    "e": [47.477857, 19.057739],
    "r": [47.4789527, 19.0591848],
    "a": [47.4765122, 19.056128],
    "j": [47.479532, 19.057396]
};

// Az általad kért szerverlista prioritás sorrendben
const OVERPASS_SERVERS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

// Fallback logika: Ha az egyik beszarik, megy a következőre
async function fetchWithFallback(query) {
    for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
        const server = OVERPASS_SERVERS[i];
        console.log(`\n📡 Próbálkozás a(z) ${server} szerverrel...`);

        try {
            const response = await fetch(server, {
                method: "POST",
                body: query, // Nincs header, csak nyersen beküldjük a query-t, ahogy a HTML-ben is volt
                signal: AbortSignal.timeout(25000)
            });

            if (!response.ok) {
                // Ha nem 200 OK a válasz, kiíratjuk a pontos okot!
                const errorText = await response.text();
                console.log(`❌ Hiba a szerveren (HTTP ${response.status}): ${errorText.substring(0, 100)}... Ugrás a következőre...`);
                continue;
            }

            const data = await response.json();
            console.log(`✅ Sikeres letöltés innen: ${server}`);
            return data;
        } catch (error) {
            console.log(`⚠️ Hálózati hiba vagy időtúllépés: ${error.message}`);
        }
    }
    throw new Error("🚨 AZ ÖSSZES OVERPASS SZERVER HALOTT!");
}

async function updateMaps() {
    // Létrehozzuk a data mappát, ha nincs
    if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data');
        console.log("📁 'data' mappa létrehozva.");
    }

    // Végigmegyünk az összes épületen
    for (const [key, center] of Object.entries(BUILDINGS)) {
        console.log(`\n🏢 --- ${key.toUpperCase()} ÉPÜLET FRISSÍTÉSE ---`);

        // A te eredeti Overpass lekérdezésed a center változókkal
        const query = `[out:json][timeout:25];(way(around:20, ${center[0]}, ${center[1]})["building"];relation(around:20, ${center[0]}, ${center[1]})["building"];)->.targetBuilding;.targetBuilding map_to_area -> .searchArea;(way["indoor"](area.searchArea);relation["indoor"](area.searchArea);way["highway"="corridor"](area.searchArea);way["highway"="steps"](area.searchArea);node["entrance"](area.searchArea);node["door"](area.searchArea);way["building:part"](area.searchArea);way["room"~"stairs|toilet|toilets"](area.searchArea);way(around:20, ${center[0]}, ${center[1]})["building"];);out body;>;out skel qt;`;

        try {
            // 1. Letöltjük az OSM adatot (próbálgatva a szervereket)
            const osmData = await fetchWithFallback(query);

            // 2. Egyből konvertáljuk GeoJSON-ba!
            console.log(`⚙️  Konvertálás GeoJSON formátumba...`);
            const geoJson = osmtogeojson(osmData);

            // 3. Lementjük fájlba
            const filename = `./data/${key}_epulet.json`;
            fs.writeFileSync(filename, JSON.stringify(geoJson));
            console.log(`💾 Mentve: ${filename} (${(JSON.stringify(geoJson).length / 1024).toFixed(2)} KB)`);

            // Pihenünk 3 másodpercet a következő épület előtt, hogy ne kapjunk Rate Limitet a szervertől
            await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (err) {
            console.error(`💥 Végzetes hiba a(z) ${key.toUpperCase()} épületnél: ${err.message}`);
            process.exit(1); // Ezzel jelezzük a GitHubnak, hogy leállt a script, így kapunk hibaüzenetet!
        }
    }
    console.log("\n🎉 MINDEN ÉPÜLET SIKERESEN FRISSÍTVE ÉS KONVERTÁLVA!");
}

updateMaps();
