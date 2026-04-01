# BMEmap - Tekergők Térképe 🧭

Interaktív beltéri navigációs és teremkereső alkalmazás a Budapesti Műszaki és Gazdaságtudományi Egyetem kampuszához.

## 🛠 Technológiai stack

* **Frontend:** HTML5, CSS3 (Custom Variables), JavaScript (Vanilla ES6).
* **Térkép motor:** Leaflet.js.
* **Geometria:** Turf.js (térbeli számítások), osmtogeojson.
* **Adatforrás:** OpenStreetMap (OSM).
* **Automatizáció:** GitHub Actions (napi adatfrissítés), Node.js.
* **Hosting:** Netlify.

## 🚀 Funkciók

### Térkép és Megjelenítés
* **Épületválasztó:** K, I, Q, E, R, A, J épületek támogatása (később bővíthető).
* **Szintkezelés:** Emeletválasztó gombok dinamikus alias támogatással (pl. "MF", "P").
* **Dinamikus stílus:** Sötét és világos mód, beépített témaválasztó.
* **Témaszerkesztő:** Élő felület a UI és a térképi elemek színeinek módosításához.

### Keresés és Navigáció
* **Teremkereső:** Keresés név, ref vagy épületszárny alapján.
* **Útvonaltervezés:** Dijkstra-alapú navigáció két pont között.
* **Közlekedési módok:** Lépcső-preferált, lift-preferált, kiegyensúlyozott és akadálymentes útvonalak.
* **POI kereső:** Gyorsgomb a legközelebbi mosdó megkereséséhez.

### Adatkezelés és Megosztás
* **Helymegosztás:** Kijelölt terem, POI vagy útvonal megosztása Base64 kódolt URL paraméterekkel.
* **Kedvencek:** Helyszínek mentése (LocalStorage).
* **Offline Cache:** Térképadatok mentése a gyorsabb betöltés érdekében.
* **Automata Adatfrissítés:** GitHub Action script, naponta lekéri a friss OSM adatokat, GeoJSON-ná konvertálja és statikus fájlként adja.

## 📂 Projekt struktúra

* `index.html` - A fő alkalmazás váz.
* `app.js` - Logika, útvonaltervezés és eseménykezelés.
* `style.css` - UI komponensek és téma definíciók.
* `room_data.js` - Külső adatbázis a termek extra információival (férőhely, projektor, fotók).
* `update-maps.js` - Node.js script az adatok letöltéséhez és konvertálásához.
* `data/` - A generált, statikus GeoJSON térképfájlok helye.
* `.github/workflows/update.yml` - Az automatizált frissítés ütemezése.

## 🛠 Telepítés és futtatás

1.  Klónozd a repót
2.  Nyisd meg az `index.html` fájlt egy tetszőleges böngészőben.
3.  A térképek frissítéséhez futtasd a Node.js scriptet: `node update-maps.js` (szükséges hozzá az `osmtogeojson` csomag).

## 📝 Licenc

A térképi adatok forrása az OpenStreetMap közössége (a beltéri térképeket javarészt szintén én csináltam).
