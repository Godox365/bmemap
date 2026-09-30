const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const appJsContent = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
const roomDataContent = fs.readFileSync(path.join(rootDir, 'room_data.js'), 'utf8');
const searchIndexContent = fs.readFileSync(path.join(rootDir, 'data/search_index.json'), 'utf8');

console.log('--- RUNNING THOROUGH TAG SEARCH VERIFICATION ---');

// Mock browser environment
const storage = {};
global.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
};

global.window = {
    location: { search: '', pathname: '/' },
    innerWidth: 1024,
    addEventListener: () => {},
    dispatchEvent: () => {}
};

class MockElement {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.classList = {
            _classes: new Set(),
            add(c) { c.split(/\s+/).forEach(x => x && this._classes.add(x)); },
            remove(c) { c.split(/\s+/).forEach(x => x && this._classes.delete(x)); },
            contains(c) { return this._classes.has(c); },
            get className() { return Array.from(this._classes).join(' '); }
        };
        this.children = [];
        this.style = {};
        this.innerHTML = '';
        this.value = '';
        this.id = '';
        this._onclick = null;
    }
    addEventListener(event, fn) {}
    removeEventListener(event, fn) {}
    setAttribute(name, value) {
        if (!this._attrs) this._attrs = {};
        this._attrs[name] = String(value);
    }
    getAttribute(name) {
        return (this._attrs && this._attrs[name]) || null;
    }
    set className(val) {
        this.classList._classes.clear();
        if (val) val.split(/\s+/).forEach(x => x && this.classList._classes.add(x));
    }
    get className() {
        return this.classList.className;
    }
    appendChild(child) {
        this.children.push(child);
    }
    querySelector(sel) {
        if (sel === '.room-meta') return global.mockRoomMeta;
        if (sel === '#search-input') return global.mockSearchInput;
        return null;
    }
    querySelectorAll() { return []; }
    focus() { this._focused = true; }
}

global.mockRoomMeta = new MockElement('div');
global.mockRoomMeta.className = 'room-meta';
global.mockSearchInput = new MockElement('input');
global.mockSearchInput.id = 'search-input';
global.mockSearchResults = new MockElement('div');
global.mockSearchResults.id = 'search-results';

global.document = {
    querySelector: (sel) => {
        if (sel === '.room-meta') return global.mockRoomMeta;
        if (sel === '#search-input') return global.mockSearchInput;
        if (sel === '#search-results') return global.mockSearchResults;
        return null;
    },
    querySelectorAll: () => [],
    getElementById: (id) => {
        if (id === 'search-input') return global.mockSearchInput;
        if (id === 'search-results') return global.mockSearchResults;
        if (id === 'bottom-sheet') return new MockElement('div');
        return new MockElement('div');
    },
    createElement: (tag) => new MockElement(tag),
    documentElement: { lang: 'hu' }
};

// Evaluate room_data.js
eval(roomDataContent.replace('const ROOM_DATABASE', 'global.ROOM_DATABASE'));

global.fetch = async () => ({ ok: false, json: async () => ({}) });

// Helper to extract functions from app.js safely
eval(appJsContent.slice(appJsContent.indexOf('function escapeHTML'), appJsContent.indexOf('// === A NAGY SZÍN-BIBLIA ===')));
eval(appJsContent.slice(appJsContent.indexOf('function matchesBuilding'), appJsContent.indexOf('function isDesktopSidePanel')));
eval(appJsContent.slice(appJsContent.indexOf('function getLevelsFromFeature'), appJsContent.indexOf('function alignMapToBuildingCenter')));

// Mocks for _executeSearch
global.updateRightButtonState = () => {};
global._getSelectableSearchResults = () => global.mockSearchResults.children;
global._updateSearchSelection = () => {};
global.getBuildingName = (k) => k;
global.POI_TYPES = {};
global._searchSelectedIndex = -1;
global._searchUserNavigated = false;
global.openSheet = () => {};
global.changeBuilding = () => {};

eval(appJsContent.slice(appJsContent.indexOf('function _executeSearch(e) {'), appJsContent.indexOf('// === KERESŐSÁV UI LOGIKA ===')));

global.globalSearchIndex = JSON.parse(searchIndexContent);
global.levelAliases = {};
global.currentBuildingKey = 'KT';

console.log('✅ Base test environment and app.js functions loaded cleanly.');

// --------------------------------------------------------------------------
// TEST 1: getMatchingTags - Hungarian labels, diacritics, prefix, and substring
// --------------------------------------------------------------------------
console.log('[Test 1] Testing getMatchingTags Hungarian matching...');
{
    const m1 = getMatchingTags('nyomtatas');
    assert.ok(m1.length > 0, 'Should match nyomtatas');
    assert.strictEqual(m1[0].key, 'print');
    assert.strictEqual(m1[0].label, 'Nyomtatás');
    assert.strictEqual(m1[0].icon, 'print');
    assert.strictEqual(m1[0].score, 920, 'Exact match score should be 920');

    const m2 = getMatchingTags('Nyomtatás');
    assert.strictEqual(m2[0].key, 'print');
    assert.strictEqual(m2[0].score, 920);

    const mPrefix = getMatchingTags('nyomt');
    assert.ok(mPrefix.length > 0);
    assert.strictEqual(mPrefix[0].key, 'print');
    assert.ok(mPrefix[0].score > 700 && mPrefix[0].score < 900, 'Prefix score range');

    const mSub = getMatchingTags('tanulás');
    assert.ok(mSub.some(m => m.key === 'quiet_study'), 'Substring tanulás should match quiet_study (Csendes tanulás)');

    const mTanul = getMatchingTags('tanul');
    assert.ok(mTanul.some(m => m.key === 'quiet_study'), 'tanul should match quiet_study (Csendes tanulás)');
    assert.ok(mTanul.some(m => m.key === 'study'), 'tanul should match study (Tanuló)');

    const mSocial = getMatchingTags('Közösségi tér');
    assert.strictEqual(mSocial[0].key, 'social');
    assert.strictEqual(mSocial[0].icon, 'groups_2');

    console.log('✅ getMatchingTags Hungarian matching verified.');
}

// --------------------------------------------------------------------------
// TEST 2: getMatchingTags - English labels
// --------------------------------------------------------------------------
console.log('[Test 2] Testing getMatchingTags English matching...');
{
    const mPrint = getMatchingTags('printing');
    assert.ok(mPrint.length > 0, 'Should match printing');
    assert.strictEqual(mPrint[0].key, 'print');
    assert.strictEqual(mPrint[0].score, 920, 'Exact match on English label should be 920');

    const mPrintPrefix = getMatchingTags('print');
    assert.ok(mPrintPrefix.length > 0, 'Should match print prefix');
    assert.strictEqual(mPrintPrefix[0].key, 'print');

    const mQuiet = getMatchingTags('quiet study');
    assert.strictEqual(mQuiet[0].key, 'quiet_study');
    assert.strictEqual(mQuiet[0].score, 920);

    const mCommunity = getMatchingTags('community space');
    assert.strictEqual(mCommunity[0].key, 'social');

    const mProjector = getMatchingTags('projector');
    assert.strictEqual(mProjector[0].key, 'projector');

    console.log('✅ getMatchingTags English matching verified.');
}

// --------------------------------------------------------------------------
// TEST 3: getMatchingTags - Rejection of short terms and internal snake_case keys
// --------------------------------------------------------------------------
console.log('[Test 3] Testing getMatchingTags rejection of invalid terms...');
{
    assert.deepStrictEqual(getMatchingTags(''), [], 'Empty string returns []');
    assert.deepStrictEqual(getMatchingTags('a'), [], 'Single character returns []');
    assert.deepStrictEqual(getMatchingTags(null), [], 'Null returns []');
    assert.deepStrictEqual(getMatchingTags(undefined), [], 'Undefined returns []');
    assert.deepStrictEqual(getMatchingTags(123), [], 'Number returns [] without throwing');
    assert.deepStrictEqual(getMatchingTags({}), [], 'Object returns [] without throwing');

    // Internal snake_case keys MUST NOT match their respective tags
    assert.deepStrictEqual(getMatchingTags('quiet_study'), [], 'quiet_study must return []');
    // "ac" is the internal key for air conditioning ("Légkondicionált" / "Air conditioned").
    // Searching "ac" must NOT match the "ac" tag (Air conditioning)!
    assert.strictEqual(getMatchingTags('ac').some(m => m.key === 'ac'), false, '"ac" must not match the "ac" tag (air conditioning)');

    console.log('✅ getMatchingTags rejection verified.');
}

// --------------------------------------------------------------------------
// TEST 4: roomHasTag helper verification
// --------------------------------------------------------------------------
console.log('[Test 4] Testing roomHasTag helper...');
{
    const mockRoomWithTags = { tags: ['pc', 'scan', 'print'] };
    assert.strictEqual(roomHasTag(mockRoomWithTags, 'print'), true);
    assert.strictEqual(roomHasTag(mockRoomWithTags, 'scan'), true);
    assert.strictEqual(roomHasTag(mockRoomWithTags, 'quiet_study'), false);

    // English label strings in roomData.tags
    const mockEnglishRoom = { tags: ['Printing', 'Quiet study'] };
    assert.strictEqual(roomHasTag(mockEnglishRoom, 'print'), true, 'English label "Printing" in tags must match "print"');
    assert.strictEqual(roomHasTag(mockEnglishRoom, 'quiet_study'), true, 'English label "Quiet study" in tags must match "quiet_study"');

    // Object tags with name or label
    const mockObjTagRoom = { tags: [{ name: 'Printing' }, { label: 'Nyomtatás' }] };
    assert.strictEqual(roomHasTag(mockObjTagRoom, 'print'), true, 'Object tag with name/label must match');

    const mockOldRoomKey = { key: true, tags: [] };
    assert.strictEqual(roomHasTag(mockOldRoomKey, 'key'), true);

    const mockOldRoomProj = { projector: true };
    assert.strictEqual(roomHasTag(mockOldRoomProj, 'projector'), true);

    const mockWheelchairRoom = { properties: { wheelchair: 'yes' } };
    assert.strictEqual(roomHasTag(null, 'accessible', mockWheelchairRoom), true);

    console.log('✅ roomHasTag helper verified.');
}

// --------------------------------------------------------------------------
// TEST 5: smartFilter in local building (KT)
// --------------------------------------------------------------------------
console.log('[Test 5] Testing smartFilter in local building (KT)...');
{
    global.currentBuildingKey = 'KT';
    global.geoJsonData = {
        features: [
            {
                id: 'way/1528733119',
                properties: { ref: '1', name: 'Kisterem', level: '0' }
            },
            {
                id: 'way/1543973251',
                properties: { name: 'Központi kölcsönző', level: '0' }
            },
            {
                id: 'way/other',
                properties: { ref: '99', name: 'Random Iroda', level: '0' }
            }
        ]
    };

    // 1. Search "nyomtatas" (tag search)
    const hitsTag = smartFilter('nyomtatas');
    assert.ok(hitsTag.length >= 2, 'Should return at least Kisterem and Központi kölcsönző');
    const kisteremHit = hitsTag.find(h => h.properties.name === 'Kisterem');
    const kolcsonzoHit = hitsTag.find(h => h.properties.name === 'Központi kölcsönző');
    assert.ok(kisteremHit, 'Kisterem found');
    assert.ok(kolcsonzoHit, 'Központi kölcsönző found');
    assert.strictEqual(kisteremHit._matchedTag, 'Nyomtatás');
    assert.strictEqual(kisteremHit._matchedTagIcon, 'print');
    assert.strictEqual(kolcsonzoHit._matchedTag, 'Nyomtatás');
    assert.strictEqual(kolcsonzoHit._matchedTagIcon, 'print');

    // 2. Normal room search: "Kisterem"
    const hitsName = smartFilter('Kisterem');
    assert.ok(hitsName.length > 0);
    const kHit = hitsName[0];
    assert.strictEqual(kHit.properties.name, 'Kisterem');
    assert.strictEqual(kHit._matchedTag, undefined, '_matchedTag must NOT be present when searching by room name');
    assert.strictEqual(kHit._matchedTagIcon, undefined);

    // 3. Technical key search: "quiet_study" -> should not return anything by tag
    const hitsTech = smartFilter('quiet_study');
    assert.strictEqual(hitsTech.length, 0, 'Technical key quiet_study should yield 0 results');

    console.log('✅ smartFilter in local building verified.');
}

// --------------------------------------------------------------------------
// TEST 6: searchOtherBuildings from another building (e.g. currentBuildingKey = 'I')
// --------------------------------------------------------------------------
console.log('[Test 6] Testing searchOtherBuildings from another building (I)...');
{
    global.currentBuildingKey = 'I';

    // Search for "nyomtatás" from building I
    const otherHits = searchOtherBuildings('nyomtatás');
    assert.ok(otherHits.length > 0, 'Should find rooms with nyomtatás in other buildings');

    const ktKisterem = otherHits.find(h => h.item.properties.name === 'Kisterem' && h.item._buildingKey === 'KT');
    assert.ok(ktKisterem, 'KT Kisterem should be returned');
    assert.strictEqual(ktKisterem.item._isLocal, false);
    assert.strictEqual(ktKisterem.item._matchedTag, 'Nyomtatás');
    assert.strictEqual(ktKisterem.item._matchedTagIcon, 'print');
    assert.strictEqual(ktKisterem.score, 920 - 150, 'Score in other buildings should be bestTag.score - 150 (770)');

    // Search for "csendes tanulas" from building I -> should find K building library rooms
    const studyHits = searchOtherBuildings('csendes tanulas');
    assert.ok(studyHits.length >= 2, 'Should find K building quiet study rooms');
    const gazdasag = studyHits.find(h => h.item.properties.name && h.item.properties.name.includes('Gazdaság'));
    const tankonyv = studyHits.find(h => h.item.properties.name && h.item.properties.name.includes('Tankönyv'));
    assert.ok(gazdasag, 'Gazdaság- és Társadalomtudományi Olvasó found');
    assert.ok(tankonyv, 'Tankönyvolvasó found');
    assert.strictEqual(gazdasag.item._matchedTag, 'Csendes tanulás');
    assert.strictEqual(gazdasag.item._matchedTagIcon, 'local_library');

    // Search in English: "quiet study"
    const enStudyHits = searchOtherBuildings('quiet study');
    assert.ok(enStudyHits.some(h => h.item.properties.name && h.item.properties.name.includes('Tankönyv')));

    console.log('✅ searchOtherBuildings verified.');
}

// --------------------------------------------------------------------------
// TEST 7: mergeSearchResults ranking (Local beats Other buildings)
// --------------------------------------------------------------------------
console.log('[Test 7] Testing mergeSearchResults ranking with tags...');
{
    global.currentBuildingKey = 'KT';
    // Local hits have score 920
    const localHit = {
        id: 'way/local_print',
        properties: { name: 'Kisterem' },
        _isLocal: true,
        _score: 920,
        _matchedTag: 'Nyomtatás',
        _matchedTagIcon: 'print'
    };
    // Other hit has score 770
    const otherHit = {
        item: {
            id: 'way/other_print',
            properties: { name: 'Other Print Room' },
            _isLocal: false,
            _score: 770,
            _matchedTag: 'Nyomtatás',
            _matchedTagIcon: 'print'
        },
        score: 770
    };

    const merged = mergeSearchResults([localHit], [otherHit], []);
    assert.strictEqual(merged.length, 2);
    assert.strictEqual(merged[0].id, 'way/local_print', 'Local hit should come first');
    assert.strictEqual(merged[1].id, 'way/other_print', 'Other building hit should come second');

    // Also test real end-to-end piping from searchOtherBuildings directly into mergeSearchResults
    global.currentBuildingKey = 'I';
    const liveOtherHits = searchOtherBuildings('nyomtatás');
    const liveMerged = mergeSearchResults([], liveOtherHits, []);
    assert.ok(liveMerged.length >= 2, 'Live searchOtherBuildings output must merge without error');
    assert.strictEqual(liveMerged[0]._isLocal, false);
    assert.strictEqual(liveMerged[0]._matchedTag, 'Nyomtatás');

    console.log('✅ mergeSearchResults ranking verified.');
}

// --------------------------------------------------------------------------
// TEST 8: Autocomplete badge rendering
// --------------------------------------------------------------------------
console.log('[Test 8] Testing autocomplete tag badge rendering...');
{
    // Simulate the rendering logic in _executeSearch
    function renderHitBadge(hit) {
        const rawLvl = hit.properties.level || '0';
        const lvl = rawLvl;
        let levelBadge = '';
        const tagBadge = hit._matchedTag 
            ? ` · <span class="material-symbols-outlined" style="font-size:13px; vertical-align:text-bottom; margin-right:2px; opacity:0.85;">${hit._matchedTagIcon}</span>${escapeHTML(hit._matchedTag)}`
            : "";
        if (hit._isBuilding) {
            levelBadge = `(Épület)`;
            return `<span style="opacity:0.6; font-size:12px; margin-left:5px;">${levelBadge}</span>`;
        } else if (hit._isLocal) {
            levelBadge = `(Szint: ${escapeHTML(lvl)})`;
            return `<span style="opacity:0.6; font-size:12px; margin-left:5px;">${levelBadge}${tagBadge}</span>`;
        } else {
            const bName = hit._buildingKey;
            levelBadge = `(${escapeHTML(bName)}, Szint: ${escapeHTML(lvl)})`;
            return `<span style="opacity:0.6; font-size:12px; margin-left:5px;">${levelBadge}${tagBadge}</span>`;
        }
    }

    // 1. Tag match hit
    const hitWithTag = {
        _isLocal: true,
        properties: { level: '0' },
        _matchedTag: 'Nyomtatás',
        _matchedTagIcon: 'print'
    };
    const renderedWithTag = renderHitBadge(hitWithTag);
    assert.ok(renderedWithTag.includes('· <span class="material-symbols-outlined" style="font-size:13px; vertical-align:text-bottom; margin-right:2px; opacity:0.85;">print</span>Nyomtatás'));
    assert.ok(renderedWithTag.includes('(Szint: 0)'));

    // 2. Normal room hit without tag match
    const hitNoTag = {
        _isLocal: true,
        properties: { level: '0' }
    };
    const renderedNoTag = renderHitBadge(hitNoTag);
    assert.strictEqual(renderedNoTag, '<span style="opacity:0.6; font-size:12px; margin-left:5px;">(Szint: 0)</span>');
    assert.ok(!renderedNoTag.includes('material-symbols-outlined'));
    assert.ok(!renderedNoTag.includes('·'));

    console.log('✅ Autocomplete tag badge rendering verified.');
}

// --------------------------------------------------------------------------
// TEST 9: renderRoomMeta and clickable tag chips
// --------------------------------------------------------------------------
console.log('[Test 9] Testing renderRoomMeta and clickable tag chips...');
{
    let closedSheetCalled = false;
    global.closeSheet = () => { closedSheetCalled = true; };
    let handleSearchCalledWith = null;
    global.handleSearch = (arg) => { handleSearchCalledWith = arg; };

    const mockRoomData = {
        name: 'Kisterem',
        capacity: '20',
        tags: ['pc', 'print']
    };

    renderRoomMeta(mockRoomData, false);

    assert.strictEqual(global.mockRoomMeta.children.length, 3, 'Capacity + 2 tags = 3 chips');

    // Chip 0: Capacity
    const capChip = global.mockRoomMeta.children[0];
    assert.strictEqual(capChip.id, 'meta-capacity');
    assert.ok(!capChip.classList.contains('clickable'), 'Capacity chip must NOT be clickable');

    // Chip 1: PC (Számítógép)
    const pcChip = global.mockRoomMeta.children[1];
    assert.ok(pcChip.classList.contains('clickable'), 'Tag chip 1 must have clickable class');
    assert.ok(pcChip.innerHTML.includes('Számítógép'));

    // Chip 2: Print (Nyomtatás)
    const printChip = global.mockRoomMeta.children[2];
    assert.ok(printChip.classList.contains('clickable'), 'Tag chip 2 must have clickable class');
    assert.ok(printChip.innerHTML.includes('Nyomtatás'));
    assert.strictEqual(printChip.tabIndex, 0, 'Clickable chip must have tabIndex = 0 for a11y');
    assert.strictEqual(printChip.getAttribute('role'), 'button', 'Clickable chip must have role="button"');

    // Simulate clicking the print tag chip
    printChip.onclick();
    assert.strictEqual(closedSheetCalled, true, 'closeSheet must be called');
    assert.strictEqual(global.mockSearchInput.value, 'Nyomtatás', 'Search input value must be updated to tag label');
    assert.strictEqual(global.mockSearchInput._focused, true, 'Search input must receive focus');
    assert.ok(handleSearchCalledWith && handleSearchCalledWith.target === global.mockSearchInput, 'handleSearch must be called with target input');

    // Simulate keyboard Enter on the print tag chip
    closedSheetCalled = false;
    let preventedDefault = false;
    printChip.onkeydown({ key: 'Enter', preventDefault: () => { preventedDefault = true; } });
    assert.strictEqual(closedSheetCalled, true, 'Keyboard Enter must activate the chip');
    assert.strictEqual(preventedDefault, true, 'Enter key event must have default prevented');

    console.log('✅ renderRoomMeta and clickable tag chips verified.');
}

// --------------------------------------------------------------------------
// TEST 10: End-to-End _executeSearch autocomplete with Mock DOM
// --------------------------------------------------------------------------
console.log('[Test 10] Testing live _executeSearch autocomplete execution...');
{
    global.currentBuildingKey = 'KT';
    global.geoJsonData = {
        features: [
            {
                id: 'way/1528733119',
                properties: { ref: '1', name: 'Kisterem', level: '0' }
            },
            {
                id: 'way/1543973251',
                properties: { name: 'Központi kölcsönző', level: '0' }
            }
        ]
    };

    // 1. Search for "nyomtatas"
    global.mockSearchInput.value = 'nyomtatas';
    global.mockSearchResults.children = [];
    global.mockSearchResults.style.display = 'none';

    _executeSearch({ target: global.mockSearchInput });

    assert.strictEqual(global.mockSearchResults.style.display, 'block', 'Results container should be visible');
    assert.ok(global.mockSearchResults.children.length >= 2, 'Should render suggestions for nyomtatas');

    const firstItem = global.mockSearchResults.children[0];
    assert.ok(firstItem.innerHTML.includes('material-symbols-outlined'), 'First suggestion should contain icon');
    assert.ok(firstItem.innerHTML.includes('print'), 'First suggestion should contain print icon');
    assert.ok(firstItem.innerHTML.includes('Nyomtatás'), 'First suggestion should contain Nyomtatás label');
    assert.ok(firstItem.innerHTML.includes('(Szint: 0)'), 'First suggestion should contain level badge');

    // 2. Search for room name "Kisterem"
    global.mockSearchInput.value = 'Kisterem';
    global.mockSearchResults.children = [];
    global.mockSearchResults.style.display = 'none';

    _executeSearch({ target: global.mockSearchInput });

    assert.strictEqual(global.mockSearchResults.style.display, 'block');
    assert.ok(global.mockSearchResults.children.length > 0);
    const kisteremOnly = global.mockSearchResults.children[0];
    assert.ok(!kisteremOnly.innerHTML.includes('print'), 'Room name search should NOT render print tag badge');
    assert.ok(!kisteremOnly.innerHTML.includes('Nyomtatás'), 'Room name search should NOT render Nyomtatás tag badge');
    assert.ok(kisteremOnly.innerHTML.includes('(Szint: 0)'), 'Room name search should render clean level badge');

    console.log('✅ live _executeSearch autocomplete execution verified.');
}

// --------------------------------------------------------------------------
// TEST 11: Consecutive searches and state cleanliness
// --------------------------------------------------------------------------
console.log('[Test 11] Testing consecutive searches state cleanliness on same feature objects...');
{
    global.currentBuildingKey = 'KT';
    const testFeature = {
        id: 'way/1528733119',
        properties: { ref: '1', name: 'Kisterem', level: '0' }
    };
    global.geoJsonData = { features: [testFeature] };

    // Pass 1: Tag search
    const r1 = smartFilter('nyomtatás');
    assert.strictEqual(r1[0]._matchedTag, 'Nyomtatás');
    assert.strictEqual(testFeature._matchedTag, 'Nyomtatás');

    // Pass 2: Room name search immediately after
    const r2 = smartFilter('Kisterem');
    assert.strictEqual(r2[0]._matchedTag, undefined, '_matchedTag must be cleaned up on subsequent non-tag search');
    assert.strictEqual(testFeature._matchedTag, undefined);

    // Pass 3: Different tag search
    const r3 = smartFilter('számítógép');
    assert.strictEqual(r3[0]._matchedTag, 'Számítógép');
    assert.strictEqual(r3[0]._matchedTagIcon, 'desktop_windows');
    assert.strictEqual(testFeature._matchedTag, 'Számítógép');

    console.log('✅ consecutive searches state cleanliness verified.');
}

// --------------------------------------------------------------------------
// TEST 12: i18n English Mode Integration
// --------------------------------------------------------------------------
console.log('[Test 12] Testing English i18n mode...');
{
    global.i18n = {
        currentLanguage: 'en',
        translations: {
            tags: {
                print: 'Printing',
                quiet_study: 'Quiet study',
                pc: 'Computer'
            }
        }
    };
    global.t = (key) => {
        if (key === 'tags.print') return 'Printing';
        if (key === 'tags.quiet_study') return 'Quiet study';
        if (key === 'tags.pc') return 'Computer';
        return key;
    };

    const enMatches = getMatchingTags('printing');
    assert.ok(enMatches.length > 0);
    assert.strictEqual(enMatches[0].key, 'print');
    assert.strictEqual(enMatches[0].label, 'Printing', 'In English mode, label should be "Printing"');

    // Test smartFilter with English tag in KT
    const hits = smartFilter('printing');
    assert.ok(hits.length >= 1);
    assert.strictEqual(hits[0]._matchedTag, 'Printing', 'Room hit in English mode should have English tag label');

    // Reset i18n
    delete global.i18n;
    delete global.t;

    console.log('✅ English i18n mode verified.');
}

// --------------------------------------------------------------------------
// TEST 13: CSS inspection for .meta-tag.clickable
// --------------------------------------------------------------------------
console.log('[Test 13] Testing style.css rules for .meta-tag.clickable...');
{
    const styleCss = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
    assert.ok(styleCss.includes('.meta-tag.clickable'), '.meta-tag.clickable must be in style.css');
    assert.ok(styleCss.includes('cursor: pointer'), 'cursor: pointer must be specified');
    assert.ok(styleCss.includes('user-select: none'), 'user-select: none must be specified');
    assert.ok(styleCss.includes('.meta-tag.clickable:hover'), 'hover state must be specified');
    assert.ok(styleCss.includes('.meta-tag.clickable:active'), 'active state must be specified');

    console.log('✅ style.css rules verified.');
}

console.log('\n🎉 ALL TAG SEARCH TESTS PASSED SUCCESSFULLY! 🎉');
