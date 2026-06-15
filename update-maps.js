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
    "https://overpass-api.de/api/interpreter", //Stabil német
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter", //Gyors orosz, de volt, hogy lehalt pár hónapra
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
];

// Fallback logika: Ha az egyik nem működik, megy a következőre
async function fetchWithFallback(query) {
    for (let i = 0; i < OVERPASS_SERVERS.length; i++) {
        const server = OVERPASS_SERVERS[i];
        console.log(`\n📡 Próbálkozás a(z) ${server} szerverrel...`);
        
        try {
            const response = await fetch(server, {
                method: "POST",
                body: query,
                headers: {
                    // Bemutatkozunk, így (remélhetőleg) nem bannolnak ki a szerverek.
                    'User-Agent': 'BMEmap-Updater/1.0'
                },
                signal: AbortSignal.timeout(25000)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.log(`❌ Hiba a szerveren (HTTP ${response.status}): ${errorText.substring(0, 100).replace(/\n/g, " ")}... Ugrás a következőre...`);
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
        const query = `[out:json][timeout:120];
                        // 1. Megkeressük az 5m-en belüli épület Vonalakat és Relációkat (kizárva a hidakat és tetőket)
                        (
                            way(around:5, ${center[0]}, ${center[1]})["building"]["building"!="bridge"]["building"!="roof"];
                            relation(around:5, ${center[0]}, ${center[1]})["building"]["building"!="bridge"]["building"!="roof"];
                        )->.targetBuilding;
                        
                        // 2. Ezt a halmazt alakítjuk keresési területté
                        .targetBuilding map_to_area -> .searchArea;
                        
                        // 3. Jöhetnek a belső adatok
                        (
                            // Meglévő geometriai adatok
                            way["indoor"](area.searchArea);
                            relation["indoor"](area.searchArea);
                            way["highway"~"corridor|steps"](area.searchArea);
                            node["entrance"](area.searchArea);
                            node["door"](area.searchArea);
                            way["building:part"](area.searchArea);
                            way["room"~"stairs|toilet|toilets"](area.searchArea);
                            
                            // Maga az épület körvonala a térképhez
                            .targetBuilding;
                            
                            // POI ADATOK
                            node["amenity"~"vending_machine|microwave|atm|cafe|fast_food|restaurant"](area.searchArea);
                            way["amenity"~"vending_machine|microwave|atm|cafe|fast_food|restaurant"](area.searchArea);
                            node["shop"="kiosk"](area.searchArea);
                            way["shop"="kiosk"](area.searchArea);
                        );
                        out body;
                        >;
                        out skel qt;`;

        try {
            const osmData = await fetchWithFallback(query);
            
            console.log(`⚙️  Konvertálás GeoJSON formátumba...`);
            const geoJson = osmtogeojson(osmData);

            const filename = `./data/${key}_epulet.json`;
            fs.writeFileSync(filename, JSON.stringify(geoJson));
            console.log(`💾 Mentve: ${filename} (${(JSON.stringify(geoJson).length / 1024).toFixed(2)} KB)`);

            // Rate limit miatt várunk 5 másodpercet
            await new Promise(resolve => setTimeout(resolve, 5000));

        } catch (err) {
            // Csak kiírjuk a hibát, és a ciklus megy tovább a következő épületre.
            console.error(`💥 Hiba a(z) ${key.toUpperCase()} épületnél: ${err.message}`);
            console.log(`⏭️ Sebaj, megtartjuk a régit, ugrás a következő épületre...`);
        }
    }
    console.log("\n🎉 A FRISSÍTÉSI CIKLUS LEFUTOTT!");
}

updateMaps();
