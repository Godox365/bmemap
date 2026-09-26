# Announcements – Szerkesztési Útmutató

A bejelentések szerkesztése: [`data/announcements.json`](./data/announcements.json)

A fájl egy JSON tömb, ahol minden elem egy bejelentés. Az elemek **dátum szerint csökkenő sorrendben** jelennek meg (legfrissebb felül). A sor, amelyiken `popup: true` ÉS nem járt le, elsőként ugrik fel a lebegő kapszulában.

---

## Elem sablon

```json
{
  "id": "egyedi-azonosito",
  "date": "2026-10-01",
  "validUntil": "2027-01-01T00:00:00Z",
  "popup": true,
  "badge": {
    "hu": "Új szint",
    "en": "New floor"
  },
  "title": {
    "hu": "Magyar cím",
    "en": "English title"
  },
  "description": {
    "hu": "Magyar leírás.",
    "en": "English description."
  },
  "action": {
    "type": "map",
    "building": "K",
    "level": 3
  }
}
```

---

## Mezők

| Mező | Típus | Kötelező | Leírás |
|------|-------|----------|--------|
| `id` | string | ✅ | Egyedi azonosító. Ha korábban már bezárta a user, soha többet nem ugrik fel popup-ként. |
| `date` | string (`YYYY-MM-DD`) | ✅ | Megjelenési dátum. Csak a rendezéshez használatos. |
| `validUntil` | ISO 8601 string | – | Ha megadva, a lejárt dátum után a bejelentés eltűnik mindenhonnan automatikusan. Elhagyva: mindig aktív. |
| `popup` | boolean | ✅ | `true`: felugró kapszulaként is megjelenik (legfeljebb 1×, amíg el nem zárvja a user). `false`: csak az Újdonságok listában jelenik meg, a beállítások badge-je viszont aktív. |
| `badge` | object `{hu, en}` | – | Kis színes cimke a kapszulán és a listában (pl. `"Új szint"`, `"Esemény"`). Elhagyva: nem jelenik meg cimke. |
| `title` | object `{hu, en}` | ✅ | Rövid, egyértelmű cím. |
| `description` | object `{hu, en}` | – | 1-2 mondatos leírás, az Újdonságok listában jelenik meg. |
| `action` | object | – | Kattintáskor végrehajtott akció. Elhagyva: a kapszula/kártya nem kattintható. |

### `action` típusok

**`type: "map"` — Térkép navigáció**
```json
"action": {
  "type": "map",
  "building": "R",
  "level": 4
}
```
Kattintáskor átváltja az alkalmazást a megadott épületre és szintre.

- `building`: épület kulcsa (nagybetűs, pl. `"K"`, `"Q"`, `"I"`, `"R"`, `"E"`, `"A"`, `"J"`, `"KT"`)
- `level`: emeleti szám (integer, `0` = földszint, negatív = alagsor)

**`type: "link"` — Külső hivatkozás**
```json
"action": {
  "type": "link",
  "url": "https://example.com"
}
```
Kattintáskor megnyitja az URL-t új lapon. Csak `https://` hivatkozások engedélyezettek.

---

## Példák

### Új szint bejelentése (felugró)
```json
{
  "id": "2026-10-r4",
  "date": "2026-10-01",
  "validUntil": "2027-04-01T00:00:00Z",
  "popup": true,
  "badge": { "hu": "Új szint", "en": "New floor" },
  "title": { "hu": "R épület 4. emelet", "en": "Building R, 4th floor" },
  "description": {
    "hu": "Feltérképezve: labortermek és tanszéki folyosók.",
    "en": "Mapped: laboratories and department corridors."
  },
  "action": { "type": "map", "building": "R", "level": 4 }
}
```

### Esemény/mapping party (felugró, lejárati dátummal)
```json
{
  "id": "2026-11-mapping-party",
  "date": "2026-11-01",
  "validUntil": "2026-11-08T20:00:00Z",
  "popup": true,
  "badge": { "hu": "Esemény", "en": "Event" },
  "title": { "hu": "Mapping Party – nov. 8.", "en": "Mapping Party – Nov. 8" },
  "description": {
    "hu": "Gyertek segíteni feltérképezni a Q épületet!",
    "en": "Join us to map Building Q!"
  },
  "action": { "type": "link", "url": "https://forms.gle/pelda" }
}
```

### Csendes közlemény (csak az Újdonságok listában jelenik meg)
```json
{
  "id": "2026-10-feedback",
  "date": "2026-10-01",
  "popup": false,
  "badge": { "hu": "Köszönet", "en": "Thanks" },
  "title": { "hu": "10 000 látogató!", "en": "10,000 visitors!" },
  "description": {
    "hu": "Köszönjük a közösség támogatását.",
    "en": "Thank you for the community support."
  }
}
```

---

## Régi bejelentések kezelése

**Ki lehet venni az elemeket a listából? Igen, bármikor.**

Ha egy elem törlődik a JSON-ból:
- Többé nem jelenik meg az Újdonságok listában.
- A bezárási állapota (`localStorage`) megmarad a user böngészőjében, de ártalmatlan — ha azonos `id`-vel kerül vissza, a user nem látja újra popup-ként.

**Ajánlott workflow:**
- Lejárt eseményeket (`validUntil` múlt) benne hagyni vagy törölni, mindkettő helyes.
- Aktív, folyamatos közleményeket (pl. visszajelzés link) ne töröld; a `validUntil` elhagyásával örökre aktívak maradnak.
- Az `id` módosítása újra felugróvá tesz egy bejelentést az összes usernél, mert a böngészőkben tárolt bezárási állapot az `id`-hez kötött.
