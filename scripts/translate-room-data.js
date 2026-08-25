const fs = require('fs');
const path = require('path');

const roomDataPath = path.join(__dirname, '..', 'room_data.js');
let content = fs.readFileSync(roomDataPath, 'utf8');

// Load database
content = content.replace('const ROOM_DATABASE =', 'global.ROOM_DATABASE =');
eval(content);
const db = global.ROOM_DATABASE;

const translations = {
    "VE kari - kulcsos! Projektoros, LégkondicionáltVegyész Dékáni Hivatal (Régen CH205)": {
        hu: "VE kari - kulcsos! Projektoros, légkondicionált (Vegyész Dékáni Hivatal, régen CH205)",
        en: "Faculty of Chem. Tech. - Key required! Projector, Air-conditioned (Dean's Office, formerly CH205)"
    },
    "VE-kari kulcsos VE DH Légkondicionált, projektoros": {
        hu: "VE-kari kulcsos (VE DH), légkondicionált, projektoros",
        en: "Faculty of Chem. Tech. - Key required (Dean's Office), Air-conditioned, Projector"
    },
    "VE-kari kulcsos VE DH Projektoros, Légkondicionált": {
        hu: "VE-kari kulcsos (VE DH), projektoros, légkondicionált",
        en: "Faculty of Chem. Tech. - Key required (Dean's Office), Projector, Air-conditioned"
    },
    "VE kari kulcsos, Légkondicionált": {
        hu: "VE kari kulcsos, légkondicionált",
        en: "Faculty of Chem. Tech. - Key required, Air-conditioned"
    },
    "VE-kari kulcsos, Légkondicionált": {
        hu: "VE-kari kulcsos, légkondicionált",
        en: "Faculty of Chem. Tech. - Key required, Air-conditioned"
    },
    "VE-kari kulcsos projektoros": {
        hu: "VE-kari kulcsos, projektoros",
        en: "Faculty of Chem. Tech. - Key required, Projector"
    },
    "VE-kari -kulcsos projektoros, Légkondicionált": {
        hu: "VE-kari kulcsos, projektoros, légkondicionált",
        en: "Faculty of Chem. Tech. - Key required, Projector, Air-conditioned"
    },
    "VE kari -kulcsos projektoros(Régen CHA20)": {
        hu: "VE kari kulcsos, projektoros (régen CHA20)",
        en: "Faculty of Chem. Tech. - Key required, Projector (formerly CHA20)"
    },
    "VE-kari kulcsos projektoros(Régen CHA21)": {
        hu: "VE-kari kulcsos, projektoros (régen CHA21)",
        en: "Faculty of Chem. Tech. - Key required, Projector (formerly CHA21)"
    },
    "VE kozp kulcsos-projektor-hangosítás VE DH": {
        hu: "VE központi kulcsos, projektor, hangosítás (VE DH)",
        en: "Central room (Chem. Tech.), Key required, Projector, Sound system (Dean's Office)"
    },
    "UZO kozp": {
        hu: "Üzemeltetési és Üzemviteli Osztály (UZO) központi terem",
        en: "Central Operations (UZO) managed room"
    },
    "GT kozp kulcsos GT DH": {
        hu: "GT központi kulcsos (GT DH)",
        en: "Central room (Econ. & Social Sci.), Key required (Dean's Office)"
    },
    "VI kozp kulcsos VI DH": {
        hu: "VI központi kulcsos (VI DH)",
        en: "Central room (VIK), Key required (Dean's Office)"
    },
    "VIK-foglalási prioritás  kulcsos  VIK-DH": {
        hu: "VIK foglalási prioritás, kulcsos (VIK DH)",
        en: "VIK booking priority, Key required (Dean's Office)"
    },
    "GTK": {
        hu: "GTK (Gazdaság- és Társadalomtudományi Kar)",
        en: "GTK (Faculty of Economic and Social Sciences)"
    },
    "GTK (VIK foglalási prioritás)": {
        hu: "GTK (VIK foglalási prioritás)",
        en: "GTK (VIK booking priority)"
    },
    "TE ,kozp kulcsos.A kulcsot a Bertalan Lajos u. 7. sz. tehergépjármű portán lehet felvenni.": {
        hu: "TE központi kulcsos. A kulcsot a Bertalan Lajos u. 7. sz. tehergépjármű portán lehet felvenni.",
        en: "Central room (Nat. Sci.), Key required. Key can be picked up at the gatehouse on Bertalan Lajos u. 7."
    },
    "Átkerült a KancelláriáhozKulcsot a Bertalan Lajos u. 7. sz. tehergépjármű portán lehet felvenni.": {
        hu: "Átkerült a Kancelláriához. Kulcsot a Bertalan Lajos u. 7. sz. tehergépjármű portán lehet felvenni.",
        en: "Transferred to the Chancellery. Key can be picked up at the gatehouse on Bertalan Lajos u. 7."
    },
    "TEX-TEV-S-KX-XXXX-FizikaTsz": {
        hu: "Fizika Tanszék",
        en: "Department of Physics"
    },
    "TEO-TEV-T-KX-XXXX-FizInt - Csak az Elméleti Fizika Tanszék engedélyével \n    foglalható! Kérjük, hogy foglalás előtt egyeztessenek a tanszéki titkárságon \n    (41 07).": {
        hu: "Fizikai Intézet - Csak az Elméleti Fizika Tanszék engedélyével foglalható! Kérjük, foglalás előtt egyeztessenek a tanszéki titkárságon (41 07).",
        en: "Institute of Physics - Bookable only with permission from Dept. of Theoretical Physics. Please contact the department secretariat (ext. 4107)."
    },
    "TE - Fizikai Intézet, Szemináriumi szoba, csak \n    intézeti engedéllyel foglalható": {
        hu: "Fizikai Intézet szemináriumi szoba, csak intézeti engedéllyel foglalható.",
        en: "Institute of Physics seminar room, bookable only with institute permission."
    },
    "TEO-TEV-T-KX-XXXX-AtomfizikaTsz": {
        hu: "Atomfizika Tanszék",
        en: "Department of Atomic Physics"
    },
    "TEO-TEV-S-KX-XXXX-MatIntSzgLabor": {
        hu: "Matematika Intézet Számítógépes Labor",
        en: "Institute of Mathematics Computer Laboratory"
    },
    "nincs benne a neptunban": {
        hu: "Nincs benne a Neptunban.",
        en: "Not registered in Neptun."
    },
    "TE-kari - nem adható ki - Tanszéki Mat. Int.": {
        hu: "TE kari - nem adható ki (Matematika Intézet).",
        en: "Faculty of Nat. Sci. - Not available for booking (Institute of Mathematics)."
    },
    "TE-kari - nem adható ki -Tanszéki Matematika Int.": {
        hu: "TE kari - nem adható ki (Matematika Intézet).",
        en: "Faculty of Nat. Sci. - Not available for booking (Institute of Mathematics)."
    },
    "VI kozp": {
        hu: "VI központi terem",
        en: "Central room (VIK)"
    },
    "VI-kari, csak VIK használhatja": {
        hu: "VI kari, csak a VIK használhatja.",
        en: "VIK faculty room, reserved exclusively for VIK."
    },
    "KO-kari": {
        hu: "Közlekedésmérnöki Kar (KJK)",
        en: "Faculty of Transportation Engineering (KJK)"
    },
    "KO-kari kulcsos KO DH": {
        hu: "KO kari kulcsos (KO DH)",
        en: "Faculty of Transportation Engineering, Key required (Dean's Office)"
    },
    "VE kozp régen: K121; projektoros, kulcsos": {
        hu: "VE központi (régen: K121), projektoros, kulcsos",
        en: "Central room (Chem. Tech., formerly K121), Projector, Key required"
    },
    "GE központi, projektoros. Kulcsos terem. Régen: K133": {
        hu: "GE központi, projektoros, kulcsos terem (régen: K133).",
        en: "Central room (Mech. Eng.), Projector, Key required (formerly K133)."
    },
    "GE központi, projektoros. Kulcsos terem. Régen: K140": {
        hu: "GE központi, projektoros, kulcsos terem (régen: K140).",
        en: "Central room (Mech. Eng.), Projector, Key required (formerly K140)."
    },
    "EO-kozp-kulcs régen K148 projektoros": {
        hu: "EO központi kulcsos, projektoros (régen: K148)",
        en: "Central room (Civil Eng.), Key required, Projector (formerly K148)"
    },
    "EP-kari rendezvényterem -- kulcsos -- régen K201. Foglalást a Dékáni \n    Hivatalban kell intézni. Tel: 35-21.Kulcsot a Dékániban lehet felvenni. (nincsenek asztalok)": {
        hu: "Építész Kari rendezvényterem (kulcsos, régen K201). Foglalás a Dékáni Hivatalban: 35-21. Kulcs a Dékániban. (Nincsenek asztalok)",
        en: "Faculty of Architecture event hall (Key required, formerly K201). Booking at Dean's Office: ext. 35-21. Key at Dean's Office. (No tables)"
    },
    "EP-kari terem (előadó) -- Kulcsos (EPDH)projektor, vetítővászon": {
        hu: "ÉP kari előadóterem, kulcsos (ÉP DH), projektor, vetítővászon",
        en: "Faculty of Architecture lecture hall, Key required (Dean's Office), Projector, Projection screen"
    },
    "EP-kari terem (nagy asztalok) felújított": {
        hu: "ÉP kari terem (nagy asztalok), felújított",
        en: "Faculty of Architecture room (large drafting tables), renovated"
    },
    "EO-kozp régen: K221": {
        hu: "EO központi terem (régen: K221)",
        en: "Central room (Civil Eng., formerly K221)"
    },
    "EP kozp régen: K232": {
        hu: "ÉP központi terem (régen: K232)",
        en: "Central room (Architecture, formerly K232)"
    },
    "EP kozp régen. K240 projektoros": {
        hu: "ÉP központi terem, projektoros (régen: K240)",
        en: "Central room (Architecture), Projector (formerly K240)"
    },
    "EP-kari (számítógép csatlakozás) régen K253": {
        hu: "ÉP kari terem (számítógép csatlakozás, régen K253)",
        en: "Faculty of Architecture room (PC connection, formerly K253)"
    },
    "EP-kari terem (előadó) régen: K264": {
        hu: "ÉP kari előadóterem (régen: K264)",
        en: "Faculty of Architecture lecture hall (formerly K264)"
    },
    "EP-kari terem (dupla asztalok) felújítottvetítőfelület": {
        hu: "ÉP kari terem (dupla asztalok), felújított, vetítőfelület",
        en: "Faculty of Architecture room (double tables), renovated, projection screen"
    },
    "EP-kari terem (nagy asztalok) új asztalokvetítőfelület, világos függöny": {
        hu: "ÉP kari terem (nagy asztalok), új asztalok, vetítőfelület, világos függöny",
        en: "Faculty of Architecture room (large drafting tables), new tables, projection screen, light curtains"
    },
    "EP-kari terem (nagy asztalok)vetítőfelület": {
        hu: "ÉP kari terem (nagy asztalok), vetítőfelület",
        en: "Faculty of Architecture room (large drafting tables), projection screen"
    },
    "EP-kari terem (előadó) nagy asztalok, székek, vetítőfelület": {
        hu: "ÉP kari előadóterem (nagy asztalok, székek, vetítőfelület)",
        en: "Faculty of Architecture lecture hall (large tables, chairs, projection screen)"
    },
    "EP-kari terem (nagy asztalok) felújítottvetítőfelület": {
        hu: "ÉP kari terem (nagy asztalok), felújított, vetítőfelület",
        en: "Faculty of Architecture room (large drafting tables), renovated, projection screen"
    },
    "EP-kari terem (nagy asztalok), kb. 40 székvetítőfelület, világos függöny": {
        hu: "ÉP kari terem (nagy asztalok, kb. 40 szék), vetítőfelület, világos függöny",
        en: "Faculty of Architecture room (large drafting tables, ~40 chairs), projection screen, light curtains"
    },
    "EP-kari terem (nagy asztalok), kb. 40 székvetítőfelület falon, világos függöny": {
        hu: "ÉP kari terem (nagy asztalok, kb. 40 szék), vetítőfelület a falon, világos függöny",
        en: "Faculty of Architecture room (large drafting tables, ~40 chairs), wall projection screen, light curtains"
    },
    "EP-kari terem (nagy asztalok) régen K326": {
        hu: "ÉP kari terem (nagy asztalok, régen K326)",
        en: "Faculty of Architecture room (large drafting tables, formerly K326)"
    },
    "EO-kari  EODH átbútorozva (25 fő volt (koz.p)) régen K332": {
        hu: "EO kari (ÉO DH), átbútorozva (régen 25 fős központi, K332)",
        en: "Faculty of Civil Engineering (Dean's Office), refurbished (formerly 25-capacity central room, K332)"
    },
    "EO-kari  EODH átbútorozva (25 fő volt (koz.p)) régen K333": {
        hu: "EO kari (ÉO DH), átbútorozva (régen 25 fős központi, K333)",
        en: "Faculty of Civil Engineering (Dean's Office), refurbished (formerly 25-capacity central room, K333)"
    },
    "EO-kari  EODH átbútorozva (25 fő volt (koz.p)) régen K334": {
        hu: "EO kari (ÉO DH), átbútorozva (régen 25 fős központi, K334)",
        en: "Faculty of Civil Engineering (Dean's Office), refurbished (formerly 25-capacity central room, K334)"
    },
    "EO-kari  EODH átbútorozva (25 fő volt (koz.p)) régen K335": {
        hu: "EO kari (ÉO DH), átbútorozva (régen 25 fős központi, K335)",
        en: "Faculty of Civil Engineering (Dean's Office), refurbished (formerly 25-capacity central room, K335)"
    },
    "EO-kari  EODH átbútorozva (25 fő volt (koz.p)) régen K336": {
        hu: "EO kari (ÉO DH), átbútorozva (régen 25 fős központi, K336)",
        en: "Faculty of Civil Engineering (Dean's Office), refurbished (formerly 25-capacity central room, K336)"
    },
    "EO-kari  EODH átbútorozva (25 fő volt (koz.p)) régen K337": {
        hu: "EO kari (ÉO DH), átbútorozva (régen 25 fős központi, K337)",
        en: "Faculty of Civil Engineering (Dean's Office), refurbished (formerly 25-capacity central room, K337)"
    },
    "EP-kari terem (nagy asztalok)vetítővászon": {
        hu: "ÉP kari terem (nagy asztalok), vetítővászon",
        en: "Faculty of Architecture room (large drafting tables), projection screen"
    },
    "GE központi, projektoros. Kulcsos terem. Kulcsfelvétel miatt a GPK Dékáni \n    Hivatalvezetőnek kell írni. régen KA26": {
        hu: "GE központi, projektoros, kulcsos terem (régen KA26). Kulcsfelvétel miatt a GPK Dékáni Hivatalvezetőnek kell írni.",
        en: "Central room (Mech. Eng.), Projector, Key required (formerly KA26). Key pickup requires contacting the Head of GPK Dean's Office."
    },
    "GE központi, projektoros. Kulcsos terem. Régen KAAUD. Az Aud. Max. hétköznapokon 18:00 – 20:00 között könyvtári olvasóhely, amelyet igény szerint, a látógatói számtól függően nyitunk meg tanulás céljából.": {
        hu: "GE központi, projektoros, kulcsos terem (régen KAAUD). Az Auditorium Maximum hétköznapokon 18:00–20:00 között könyvtári olvasóhelyként működik tanulás céljából.",
        en: "Central room (Mech. Eng.), Projector, Key required (formerly KAAUD). The Auditorium Maximum serves as a library study area on weekdays from 18:00 to 20:00."
    },
    "UZO kozp felülvilágítós régen KA51, kulcsos": {
        hu: "UZO központi terem, felülvilágítós, kulcsos (régen KA51)",
        en: "Central Operations (UZO) room with skylight, Key required (formerly KA51)"
    },
    "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA60)": {
        hu: "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA60)",
        en: "Faculty of Mech. Eng. managed classroom, Projector, Key required (formerly KA60)"
    },
    "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA61)": {
        hu: "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA61)",
        en: "Faculty of Mech. Eng. managed classroom, Projector, Key required (formerly KA61)"
    },
    "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA62)": {
        hu: "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA62)",
        en: "Faculty of Mech. Eng. managed classroom, Projector, Key required (formerly KA62)"
    },
    "GPK kari kezelésű tanterem, projektoros, kulcsos": {
        hu: "GPK kari kezelésű tanterem, projektoros, kulcsos",
        en: "Faculty of Mech. Eng. managed classroom, Projector, Key required"
    },
    "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA65)": {
        hu: "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA65)",
        en: "Faculty of Mech. Eng. managed classroom, Projector, Key required (formerly KA65)"
    },
    "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA66)": {
        hu: "GPK kari kezelésű tanterem, projektoros, kulcsos (régen KA66)",
        en: "Faculty of Mech. Eng. managed classroom, Projector, Key required (formerly KA66)"
    },
    "EO-kari   EODH régen KA67": {
        hu: "EO kari (ÉO DH, régen KA67)",
        en: "Faculty of Civil Engineering (Dean's Office, formerly KA67)"
    },
    "GE központi, projektoros. Kulcsos terem. Régen: KM21": {
        hu: "GE központi, projektoros, kulcsos terem (régen: KM21)",
        en: "Central room (Mech. Eng.), Projector, Key required (formerly KM21)"
    },
    "GPK kari, projektoros, kulcsos terem.": {
        hu: "GPK kari, projektoros, kulcsos terem.",
        en: "Faculty of Mech. Eng. classroom, Projector, Key required."
    },
    "GTK - VIK": {
        hu: "GTK - VIK",
        en: "GTK - VIK"
    },
    "GTK foglalási prioritás": {
        hu: "GTK foglalási prioritás",
        en: "GTK booking priority"
    },
    "GTK foglalási prioritása": {
        hu: "GTK foglalási prioritás",
        en: "GTK booking priority"
    },
    "VIK": {
        hu: "VIK (Villamosmérnöki és Informatikai Kar)",
        en: "VIK (Faculty of Electrical Engineering and Informatics)"
    },
    "GE központi": {
        hu: "GE központi terem",
        en: "Central room (Faculty of Mechanical Engineering)"
    },
    "VE kozp (VIK foglalási prioritás)": {
        hu: "VE központi terem (VIK foglalási prioritás)",
        en: "Central room (Chem. Tech. / VIK booking priority)"
    },
    "központi, prioritás nélküli tanterem": {
        hu: "Központi, prioritás nélküli tanterem",
        en: "Central classroom without faculty priority"
    },
    "KO-kari (filc toll)": {
        hu: "KO kari (filctollas tábla)",
        en: "Faculty of Transportation Engineering (whiteboard)"
    },
    "KO kozp kulcsos KO DH": {
        hu: "KO központi kulcsos (KO DH)",
        en: "Central room (Transportation Eng.), Key required (Dean's Office)"
    },
    "TTK kari": {
        hu: "TTK (Természettudományi Kar)",
        en: "TTK (Faculty of Natural Sciences)"
    },
    "TTK-kari": {
        hu: "TTK (Természettudományi Kar)",
        en: "TTK (Faculty of Natural Sciences)"
    },
    "Csendes tanulótér helyben használható dokumentumokkal. Vizsgaidőszakban hétfőtől csütörtökig 22:00-ig tart nyitva.": {
        hu: "Csendes tanulótér helyben használható dokumentumokkal. Vizsgaidőszakban hétfőtől csütörtökig 22:00-ig tart nyitva.",
        en: "Quiet study area with reference materials for on-site use. Open until 22:00 Monday to Thursday during exam periods."
    },
    "Természettudományokhoz, mérnöki tudományokhoz és építészethez kapcsolódó szakirodalom, valamint útikönyvek és szabadidős témájú könyvek egy része található itt. Itt érhetők el a Springer Nature-kiadványok is.": {
        hu: "Természettudományokhoz, mérnöki tudományokhoz és építészethez kapcsolódó szakirodalom, valamint útikönyvek és szabadidős témájú könyvek egy része található itt. Itt érhetők el a Springer Nature-kiadványok is.",
        en: "Academic literature on natural sciences, engineering, and architecture, as well as travel and leisure books. Springer Nature publications are also accessible here."
    },
    "Csendes tanulótér gazdasági, társadalomtudományi, kulturális, művészeti, történelmi, jogi és ismeretterjesztő szakirodalommal, valamint többnyelvű szépirodalommal. Az olvasó 19:30-kor zár.": {
        hu: "Csendes tanulótér gazdasági, társadalomtudományi, kulturális, művészeti, történelmi, jogi és ismeretterjesztő szakirodalommal, valamint többnyelvű szépirodalommal. Az olvasó 19:30-kor zár.",
        en: "Quiet study area with literature on economics, social sciences, arts, history, law, and multilingual fiction. Closes at 19:30."
    },
    "Beszélgetésre és étkezésre is alkalmas közösségi tér. A főbejáratnál snack- és italautomaták, valamint csomagmegőrző szekrények találhatók. A szekrények használatához kulcs a központi kölcsönzésben kérhető.": {
        hu: "Beszélgetésre és étkezésre is alkalmas közösségi tér. A főbejáratnál snack- és italautomaták, valamint csomagmegőrző szekrények találhatók. A szekrények használatához kulcs a központi kölcsönzésben kérhető.",
        en: "Community space suitable for conversation and dining. Vending machines and lockers are available at the main entrance. Locker keys can be requested at the central loan desk."
    },
    "Könyvtárunk fszt. 1-es szobája szabadon használható számítógépes kutatóterem. Szolgáltatások: 8 db számítógép használata (katalógus, LibreOffice), adatbázisok használata, e-folyóiratok és e-könyvek használata, nyomtatás, 1 db A/4-es, 1 db A/3-as szkenner használata.": {
        hu: "Könyvtárunk fszt. 1-es szobája szabadon használható számítógépes kutatóterem. Szolgáltatások: 8 db számítógép használata (katalógus, LibreOffice), adatbázisok használata, e-folyóiratok és e-könyvek használata, nyomtatás, 1 db A/4-es, 1 db A/3-as szkenner használata.",
        en: "Ground floor Room 1 is an open computer research room. Services: 8 workstations (catalogue, LibreOffice), database access, e-journals, e-books, printing, A4 and A3 scanners."
    },
    "Csendes tanulótér a BME képzéseihez kapcsolódó tankönyvekkel és szótárakkal. A dokumentumok szakcsoportok szerint rendezve érhetők el. A térben csomagmegőrző szekrények is találhatók.": {
        hu: "Csendes tanulótér a BME képzéseihez kapcsolódó tankönyvekkel és szótárakkal. A dokumentumok szakcsoportok szerint rendezve érhetők el. A térben csomagmegőrző szekrények is találhatók.",
        en: "Quiet study space with textbooks and dictionaries for BME curricula, organized by subject field. Lockers are also available."
    },
    "Megközelítése: a földszint 1-es Kutatótermen keresztül. Foglalható, kötetlenebb használatú tér csoportos munkához, beszélgetéshez és étkezéshez. https://appointments.omikk.bme.hu/": {
        hu: "Megközelítése: a földszint 1-es Kutatótermen keresztül. Foglalható, kötetlenebb használatú tér csoportos munkához, beszélgetéshez és étkezéshez. https://appointments.omikk.bme.hu/",
        en: "Access: via ground floor Room 1 Research Room. Bookable informal space for group work, discussion, and dining. https://appointments.omikk.bme.hu/"
    },
    "Tanulásra, halk beszélgetésre és étkezésre alkalmas tér. Megközelítése a könyvtár központi épületén keresztül lehetséges. Egyetemi és szakmai rendezvények helyszíneként is működik. https://appointments.omikk.bme.hu/": {
        hu: "Tanulásra, halk beszélgetésre és étkezésre alkalmas tér. Megközelítése a könyvtár központi épületén keresztül lehetséges. Egyetemi és szakmai rendezvények helyszíneként is működik. https://appointments.omikk.bme.hu/",
        en: "Space suitable for study, quiet discussion, and dining. Accessible through the central library building. Also hosts university and professional events. https://appointments.omikk.bme.hu/"
    },
    "Beszélgetésre és kikapcsolódásra is alkalmas közösségi tér.": {
        hu: "Beszélgetésre és kikapcsolódásra is alkalmas közösségi tér.",
        en: "Community space suitable for discussion and relaxation."
    }
};

let matchCount = 0;
let missingCount = 0;

for (const [k, room] of Object.entries(db)) {
    if (room.note) {
        if (typeof room.note === 'string') {
            const tr = translations[room.note];
            if (tr) {
                room.note = tr;
                matchCount++;
            } else {
                console.warn('Missing translation for:', room.note);
                missingCount++;
            }
        }
    }
}

console.log(`Translated ${matchCount} notes, missing: ${missingCount}`);

if (missingCount === 0) {
    const formatted = 'const ROOM_DATABASE = ' + JSON.stringify(db, null, 4) + ';\n';
    fs.writeFileSync(roomDataPath, formatted, 'utf8');
    console.log('Successfully written updated room_data.js!');
}
