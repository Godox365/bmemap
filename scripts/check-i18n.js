/**
 * BMEmap i18n Validator Script
 * Összehasonlítja a locales/hu.json forrásszótárat a többi nyelvi fájllal.
 */
const fs = require('fs');
const path = require('path');

const localesDir = path.join(__dirname, '..', 'locales');
const huPath = path.join(localesDir, 'hu.json');

if (!fs.existsSync(huPath)) {
    console.error('❌ Hiba: A locales/hu.json nem található!');
    process.exit(1);
}

const huJson = JSON.parse(fs.readFileSync(huPath, 'utf8'));

function flattenKeys(obj, prefix = '') {
    let keys = {};
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            Object.assign(keys, flattenKeys(value, fullKey));
        } else {
            keys[fullKey] = value;
        }
    }
    return keys;
}

function extractParams(str) {
    if (typeof str !== 'string') return [];
    const matches = str.match(/\{(\w+)\}/g);
    return matches ? matches.map(m => m.replace(/[{}]/g, '')).sort() : [];
}

const huFlat = flattenKeys(huJson);
const huKeyList = Object.keys(huFlat);

console.log(`🔍 Összesen ${huKeyList.length} fordítási kulcs található a hu.json fájlban.\n`);

const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json') && f !== 'hu.json');
let hasError = false;

for (const file of files) {
    const filePath = path.join(localesDir, file);
    const targetJson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const targetFlat = flattenKeys(targetJson);
    const targetKeyList = Object.keys(targetFlat);

    console.log(`--- [ ${file.toUpperCase()} ELLENŐRZÉSE ] ---`);

    const missingInTarget = huKeyList.filter(k => !targetKeyList.includes(k));
    const extraInTarget = targetKeyList.filter(k => !huKeyList.includes(k));

    if (missingInTarget.length > 0) {
        hasError = true;
        console.error(`❌ Hiányzó kulcsok a ${file}-ban (${missingInTarget.length} db):`);
        missingInTarget.forEach(k => console.error(`   - ${k}`));
    }

    if (extraInTarget.length > 0) {
        console.warn(`⚠️ Felesleges / nem használt kulcsok a ${file}-ban (${extraInTarget.length} db):`);
        extraInTarget.forEach(k => console.warn(`   + ${k}`));
    }

    // Paraméterek ellenőrzése
    const paramMismatches = [];
    for (const key of huKeyList) {
        if (targetFlat[key]) {
            const huParams = extractParams(huFlat[key]);
            const targetParams = extractParams(targetFlat[key]);
            if (JSON.stringify(huParams) !== JSON.stringify(targetParams)) {
                paramMismatches.push({ key, huParams, targetParams });
            }
        }
    }

    if (paramMismatches.length > 0) {
        hasError = true;
        console.error(`❌ Eltérő paraméterek ({változók}) a ${file}-ban:`);
        paramMismatches.forEach(p => {
            console.error(`   - Kulcs: ${p.key}`);
            console.error(`     HU paraméterek: [${p.huParams.join(', ')}]`);
            console.error(`     ${file} paraméterek: [${p.targetParams.join(', ')}]`);
        });
    }

    if (missingInTarget.length === 0 && paramMismatches.length === 0) {
        console.log(`✅ ${file}: 100% egyezés, minden kulcs és paraméter rendben!`);
    }
    console.log('');
}

if (hasError) {
    console.error('❌ A fordítás-ellenőrzés hibát talált!');
    process.exit(1);
} else {
    console.log('🎉 Minden nyelvi szótár tökéletes állapotban van!');
    process.exit(0);
}
