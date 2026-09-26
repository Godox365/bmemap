const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
const appJsContent = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');

console.log('--- RUNNING DEEP FUNCTIONAL ANNOUNCEMENT VERIFICATION ---');

// Setup mock browser environment
const storage = {};
global.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k]; }
};

global.window = {
    location: { search: '' },
    open: (url, target, features) => {
        global.window.lastOpened = { url, target, features };
    },
    dispatchEvent: () => {},
    addEventListener: () => {}
};
global.document = {
    elements: {},
    getElementById(id) {
        if (!this.elements[id]) {
            this.elements[id] = {
                id,
                classList: {
                    _classes: new Set(),
                    add(c) { this._classes.add(c); },
                    remove(c) { this._classes.delete(c); },
                    toggle(c, force) {
                        if (force === undefined) {
                            if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c);
                        } else if (force) {
                            this._classes.add(c);
                        } else {
                            this._classes.delete(c);
                        }
                    },
                    contains(c) { return this._classes.has(c); }
                },
                style: {},
                dataset: {},
                innerText: '',
                value: '',
                addEventListener: () => {},
                contains(target) {
                    return target === this || (this.children && this.children.includes(target));
                },
                appendChild(c) {
                    if (!this.children) this.children = [];
                    this.children.push(c);
                },
                innerHTML: ''
            };
        }
        return this.elements[id];
    },
    querySelectorAll(selector) {
        if (selector === '#seg-popups .seg-btn') {
            return [
                { dataset: { val: 'true' }, classList: { toggle: (c, v) => { this.activeTrue = v; } } },
                { dataset: { val: 'false' }, classList: { toggle: (c, v) => { this.activeFalse = v; } } }
            ];
        }
        return [];
    },
    addEventListener: (event, handler) => {
        global.document.handlers = global.document.handlers || {};
        global.document.handlers[event] = handler;
    },
    createElement(tag) {
        return {
            tagName: tag,
            classList: { add: () => {}, remove: () => {} },
            style: {},
            children: [],
            appendChild(c) { this.children.push(c); }
        };
    }
};

global.IS_EMBED_MODE = false;
global.BUILDINGS = {
    'I': { name: 'I épület', defaultLevel: '0' },
    'Q': { name: 'Q épület', defaultLevel: '0' },
    'K': { name: 'K épület', defaultLevel: '1' }
};
global.currentBuildingKey = 'Q';
global.availableLevels = ['0', '1', '2'];
global.currentLevel = '0';
global.pendingTargetLevel = null;
global.t = (k) => k;

// Mock map
global.map = {
    events: {},
    on(event, handler) { this.events[event] = handler; }
};

// Extract announcement block from app.js using vm
const vm = require('vm');
const context = vm.createContext({
    ...global,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Date: Date,
    JSON: JSON,
    Array: Array,
    Boolean: Boolean,
    String: String,
    Math: Math
});

// Run app.js announcement block in context
const startMarker = '// === ANNOUNCEMENT AND NEWS SYSTEM ===';
const endMarker = '/**\n * GPS alapú, automatikus épületválasztó';
const startIndex = appJsContent.indexOf(startMarker);
const endIndex = appJsContent.indexOf(endMarker);
assert(startIndex !== -1 && endIndex !== -1, 'Announcement block markers must exist');

const announcementCode = appJsContent.slice(startIndex, endIndex);

// Also define APP_SETTINGS in context
vm.runInContext(`
const APP_SETTINGS = {
    popupsEnabled: true,
    language: 'hu'
};
function switchLevel(lvl) {
    currentLevel = String(lvl);
}
function changeBuilding(key) {
    currentBuildingKey = key;
}
function toggleSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.toggle('visible');
}
function closeSheet() {
    global.sheetClosed = true;
}
function alignMapToBuildingCenter() {
    global.alignedBuilding = true;
}
`, context);

vm.runInContext(announcementCode, context);

console.log('✅ Context initialized and announcement code evaluated cleanly.');

// [TEST 1] Corrupted localStorage resilience
console.log('[Test 1] Testing corrupted localStorage resilience...');
storage['bmemap_read_announcements'] = '{"corrupted": true}';
storage['bmemap_dismissed_popups'] = '12345';
let readIds = vm.runInContext('getReadAnnouncementIds()', context);
let dismissedIds = vm.runInContext('getDismissedPopupIds()', context);
assert(Array.isArray(readIds) && readIds.length === 0, 'getReadAnnouncementIds must recover gracefully');
assert(Array.isArray(dismissedIds) && dismissedIds.length === 0, 'getDismissedPopupIds must recover gracefully');
delete storage['bmemap_read_announcements'];
delete storage['bmemap_dismissed_popups'];
console.log('✅ Corrupted localStorage resilience verified.');

// [TEST 2] loadAnnouncements date sorting, invalid date filtering and null item resilience
console.log('[Test 2] Testing loadAnnouncements date sorting, expiration, and null resilience...');
const testData = [
    null,
    123,
    { id: 'old', date: '2026-01-01', validUntil: '2026-02-01T00:00:00Z', title: 'Old' },
    { id: 'future1', date: '2026-09-01', validUntil: '2027-01-01T00:00:00Z', popup: true, title: 'Sep 1' },
    { id: 'future2', date: '2026-09-15', validUntil: '2027-01-01T00:00:00Z', popup: false, title: 'Sep 15' },
    { id: 'invalid_date', date: '2026-08-01', validUntil: 'not-a-date', popup: false, title: 'Invalid exp' }
];

global.fetch = async (url) => ({
    ok: true,
    json: async () => testData
});
context.fetch = global.fetch;

(async () => {
    await vm.runInContext('loadAnnouncements()', context);
    const announcements = vm.runInContext('_announcements', context);
    
    // Check that expired item 'old' is filtered out
    assert(!announcements.find(a => a.id === 'old'), 'Expired announcement must be filtered out');
    // Check that 'invalid_date' was kept (not prematurely expired)
    assert(announcements.find(a => a.id === 'invalid_date'), 'Invalid date announcement should be preserved');
    // Check that sorting is descending by date
    assert.strictEqual(announcements[0].id, 'future2', 'Newest announcement (Sep 15) must be first');
    assert.strictEqual(announcements[1].id, 'future1', 'Second newest announcement (Sep 1) must be second');
    console.log('✅ Date sorting, expiration filtering, and null resilience verified.');

    // [TEST 3] Pill display and hover/focus pause/resume
    console.log('[Test 3] Testing pill display and hover/focus pause/resume...');
    vm.runInContext('checkAndShowAnnouncementPill()', context);
    const pillEl = global.document.getElementById('announcement-pill');
    assert(pillEl.classList.contains('visible'), 'Pill should have visible class');

    // Simulate mouseenter
    const pill = vm.runInContext('document.getElementById("announcement-pill")', context);
    assert(typeof pill.onmouseenter === 'function', 'pill must have onmouseenter handler');
    assert(typeof pill.onmouseleave === 'function', 'pill must have onmouseleave handler');
    assert(typeof pill.onfocusin === 'function', 'pill must have onfocusin handler');
    assert(typeof pill.onfocusout === 'function', 'pill must have onfocusout handler');
    
    pill.onmouseenter();
    assert.strictEqual(vm.runInContext('_pillTimer', context), null, 'Timer should be paused on mouseenter');
    
    pill.onmouseleave();
    assert(vm.runInContext('_pillTimer', context) !== null, 'Timer should resume on mouseleave');

    pill.onfocusin();
    assert.strictEqual(vm.runInContext('_pillTimer', context), null, 'Timer should be paused on focusin');

    pill.onfocusout();
    assert(vm.runInContext('_pillTimer', context) !== null, 'Timer should resume on focusout');
    console.log('✅ Hover and keyboard focus pause/resume verified.');

    // [TEST 4] Immediate dismissal upon user interaction
    console.log('[Test 4] Testing immediate dismissal upon interaction...');
    // Pointerdown outside pill
    const outsideTarget = { id: 'other-element' };
    pill.contains = (t) => t === pill;
    global.document.handlers['pointerdown']({ target: outsideTarget });
    assert(!pillEl.classList.contains('visible'), 'Pill must be dismissed on outside pointerdown');
    assert.strictEqual(vm.runInContext('_currentPillAnnouncement', context), null, 'Pill state reset');
    
    // Check dismissed ID stored in localStorage
    const dismissedStored = JSON.parse(storage['bmemap_dismissed_popups']);
    assert(dismissedStored.includes('future1'), 'Dismissed popup ID must be saved in localStorage');
    console.log('✅ Immediate interaction dismissal verified.');

    // [TEST 5] News archive view open marks all as read and clears badge
    console.log('[Test 5] Testing news archive open...');
    vm.runInContext('openNewsArchive()', context);
    const readStored = JSON.parse(storage['bmemap_read_announcements']);
    assert(readStored.includes('future1') && readStored.includes('future2'), 'All announcements must be marked read');
    
    const settingsBtn = global.document.getElementById('btn-right-action');
    assert(!settingsBtn.classList.contains('has-unread'), 'Badge must be removed after archive opened');
    console.log('✅ News archive read tracking verified.');

    // [TEST 6] Action routing: Map action switches building and floor
    console.log('[Test 6] Testing action routing...');
    // Map action to building 'I', floor 1
    vm.runInContext('handleAnnouncementAction({ type: "map", building: "I", level: 1 })', context);
    assert.strictEqual(vm.runInContext('currentBuildingKey', context), 'I', 'Must change building to I');
    assert.strictEqual(vm.runInContext('pendingTargetLevel', context), '1', 'Must set pendingTargetLevel to 1');

    // Unknown building should be safely ignored
    vm.runInContext('handleAnnouncementAction({ type: "map", building: "NON_EXISTENT", level: 1 })', context);
    assert.strictEqual(vm.runInContext('currentBuildingKey', context), 'I', 'Invalid building key must be safely ignored');

    // Link action opens in new window
    vm.runInContext('handleAnnouncementAction({ type: "link", url: "https://example.com" })', context);
    assert.strictEqual(global.window.lastOpened.url, 'https://example.com', 'Link action must open URL');
    assert.strictEqual(global.window.lastOpened.target, '_blank', 'Link action must use _blank');

    // Disallowed protocol must be blocked
    global.window.lastOpened = null;
    vm.runInContext('handleAnnouncementAction({ type: "link", url: "javascript:alert(1)" })', context);
    assert.strictEqual(global.window.lastOpened, null, 'javascript: link action must be safely blocked');
    console.log('✅ Action routing verified.');

    // [TEST 7] Popup toggle settings persistence
    console.log('[Test 7] Testing popup toggle in settings...');
    vm.runInContext('setPopupsMode(false)', context);
    assert.strictEqual(storage['pref_popups_enabled'], 'false', 'pref_popups_enabled must be false');
    assert.strictEqual(vm.runInContext('APP_SETTINGS.popupsEnabled', context), false);

    vm.runInContext('setPopupsMode(true)', context);
    assert.strictEqual(storage['pref_popups_enabled'], 'true', 'pref_popups_enabled must be true');
    assert.strictEqual(vm.runInContext('APP_SETTINGS.popupsEnabled', context), true);
    console.log('✅ Popup toggle persistence verified.');

    // [TEST 8] Embed mode suppression
    console.log('[Test 8] Testing embed mode suppression...');
    global.IS_EMBED_MODE = true;
    context.IS_EMBED_MODE = true;
    vm.runInContext('updateAnnouncementsBadge()', context);
    assert(!settingsBtn.classList.contains('has-unread'), 'Badge must not be shown in embed mode');
    console.log('✅ Embed mode suppression verified.');

    // [TEST 9] Settings modal suppression of pill
    console.log('[Test 9] Testing settings modal suppression of pill...');
    global.IS_EMBED_MODE = false;
    context.IS_EMBED_MODE = false;
    const settingsModal = global.document.getElementById('settings-modal');
    settingsModal.classList.add('visible');
    pillEl.classList.remove('visible');
    vm.runInContext('checkAndShowAnnouncementPill()', context);
    assert(!pillEl.classList.contains('visible'), 'Pill must be suppressed when settings modal is open');
    settingsModal.classList.remove('visible');
    console.log('✅ Settings modal suppression verified.');

    // [TEST 10] HTML cache buster and accessibility checks
    console.log('[Test 10] Testing HTML cache busters and a11y attributes...');
    const htmlText = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
    assert(htmlText.includes('APP_VERSION = \'61\''), 'index.html APP_VERSION must be 61');
    assert(htmlText.includes('style.css?v=61'), 'index.html style.css must use v=61');
    assert(htmlText.includes('app.js?v=61'), 'index.html app.js must use v=61');
    assert(htmlText.includes('role="button"'), 'index.html news preview card must have role=button');
    assert(htmlText.includes('tabindex="0"'), 'index.html news preview card must have tabindex=0');
    console.log('✅ HTML cache busters and a11y verified.');

    // [TEST 11] Action button dismiss sequence & race condition immunity
    console.log('[Test 11] Testing action button click marks read and dismissed without race condition...');
    global.localStorage.clear();
    const testActionItem = {
        id: 'test-action-item',
        popup: true,
        title: { hu: 'Teszt bejelentés' },
        action: { type: 'map', building: 'I', level: 1 }
    };
    vm.runInContext(`showAnnouncementPill(${JSON.stringify(testActionItem)})`, context);
    const actionBtn = global.document.getElementById('announcement-pill-action-btn');
    assert(actionBtn.style.display !== 'none', 'Action button should be visible');
    // Trigger action click
    actionBtn.onclick({ stopPropagation: () => {} });
    assert(!pillEl.classList.contains('visible'), 'Pill must be hidden after action click');
    const readAfterAction = JSON.parse(global.localStorage.getItem('bmemap_read_announcements') || '[]');
    const dismissedAfterAction = JSON.parse(global.localStorage.getItem('bmemap_dismissed_popups') || '[]');
    assert(readAfterAction.includes('test-action-item'), 'Action button must mark announcement as read in localStorage');
    assert(dismissedAfterAction.includes('test-action-item'), 'Action button must mark announcement as dismissed in localStorage');
    console.log('✅ Action button click marks read and dismissed cleanly.');

    // [TEST 12] Programmatic movestart vs user interaction dismiss
    console.log('[Test 12] Testing programmatic movestart vs user interaction...');
    const testMoveItem = {
        id: 'test-move-item',
        popup: true,
        title: { hu: 'Move teszt' }
    };
    vm.runInContext(`showAnnouncementPill(${JSON.stringify(testMoveItem)})`, context);
    assert(pillEl.classList.contains('visible'), 'Pill should be visible');
    // Programmatic movestart has no originalEvent
    vm.runInContext('handlePillInteractionDismiss({ type: "movestart" })', context);
    assert(pillEl.classList.contains('visible'), 'Programmatic movestart without originalEvent must NOT dismiss pill');
    // User dragstart has originalEvent or is user interaction
    vm.runInContext('handlePillInteractionDismiss({ type: "dragstart", originalEvent: {} })', context);
    assert(!pillEl.classList.contains('visible'), 'User dragstart MUST dismiss pill');
    console.log('✅ Programmatic vs user interaction dismiss verified.');

    // [TEST 13] Extended dialog/modal/sheet suppression
    console.log('[Test 13] Testing suppression by impressum modal, bottom sheet, and search input focus...');
    global.localStorage.clear();
    const testSuppressionItem = [{
        id: 'test-suppression-item',
        popup: true,
        title: { hu: 'Suppression test' }
    }];
    context._announcements = testSuppressionItem;

    // Impressum modal open
    const impressumModal = global.document.getElementById('impressum-modal');
    impressumModal.classList.add('visible');
    pillEl.classList.remove('visible');
    vm.runInContext('checkAndShowAnnouncementPill()', context);
    assert(!pillEl.classList.contains('visible'), 'Pill must be suppressed when impressum modal is visible');
    impressumModal.classList.remove('visible');

    // Bottom sheet open
    const bottomSheet = global.document.getElementById('bottom-sheet');
    bottomSheet.classList.add('open');
    pillEl.classList.remove('visible');
    vm.runInContext('checkAndShowAnnouncementPill()', context);
    assert(!pillEl.classList.contains('visible'), 'Pill must be suppressed when bottom sheet is open');
    bottomSheet.classList.remove('open');

    // Search input focused
    const searchInput = global.document.getElementById('search-input');
    global.document.activeElement = searchInput;
    pillEl.classList.remove('visible');
    vm.runInContext('checkAndShowAnnouncementPill()', context);
    assert(!pillEl.classList.contains('visible'), 'Pill must be suppressed when search input is focused');
    global.document.activeElement = null;

    // When everything is closed, pill should show
    vm.runInContext('checkAndShowAnnouncementPill()', context);
    assert(pillEl.classList.contains('visible'), 'Pill should appear when all dialogs/sheets are closed');
    vm.runInContext('dismissAnnouncementPill()', context);
    console.log('✅ Extended modal/sheet/search suppression verified.');

    // [TEST 14] Hierarchical Escape key handler in app.js
    console.log('[Test 14] Testing hierarchical Escape key navigation in app.js...');
    const appJsRaw = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
    assert(appJsRaw.includes('if (viewNews && viewNews.style.display !== \'none\' && typeof closeNewsArchive === \'function\')'), 'Escape handler must close news archive if open');
    assert(appJsRaw.includes('pendingTargetLevel = null;'), 'loadOsmData must reset pendingTargetLevel in finally');
    console.log('✅ Hierarchical Escape key navigation and cleanup verified.');

    console.log('\n🎉 ALL DEEP FUNCTIONAL AND EDGE CASE TESTS PASSED!');
})();
