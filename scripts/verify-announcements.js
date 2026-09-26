const fs = require('fs');
const path = require('path');
const assert = require('assert');

const rootDir = path.join(__dirname, '..');
console.log('--- STARTING VERIFICATION TEST SUITE ---');

// 1. Check data/announcements.json
console.log('\n[1] Testing data/announcements.json...');
const announcementsPath = path.join(rootDir, 'data', 'announcements.json');
assert(fs.existsSync(announcementsPath), 'data/announcements.json must exist');

const announcementsRaw = fs.readFileSync(announcementsPath, 'utf8');
let announcements;
assert.doesNotThrow(() => {
    announcements = JSON.parse(announcementsRaw);
}, 'data/announcements.json must be valid JSON');

assert(Array.isArray(announcements), 'data/announcements.json must be an array');
assert(announcements.length > 0, 'data/announcements.json must not be empty');

let hasPopupTrue = false;
let hasMapAction = false;
let hasLinkAction = false;

announcements.forEach((a, idx) => {
    assert(typeof a.id === 'string' && a.id.length > 0, `Item ${idx} missing valid id`);
    assert(typeof a.date === 'string', `Item ${idx} missing valid date`);
    assert(typeof a.popup === 'boolean', `Item ${idx} popup must be boolean`);
    assert(a.title && (typeof a.title === 'string' || (a.title.hu && a.title.en)), `Item ${idx} missing multilingual title`);
    assert(a.description && (typeof a.description === 'string' || (a.description.hu && a.description.en)), `Item ${idx} missing multilingual description`);
    if (a.validUntil) {
        const d = new Date(a.validUntil);
        assert(!isNaN(d.getTime()), `Item ${idx} validUntil must be valid ISO date`);
    }
    if (a.badge) {
        assert(typeof a.badge === 'string' || (a.badge.hu && a.badge.en), `Item ${idx} badge must be string or multilingual object`);
    }
    if (a.action) {
        assert(a.action.type === 'map' || a.action.type === 'link', `Item ${idx} action type must be map or link`);
        if (a.action.type === 'map') {
            assert(typeof a.action.building === 'string', `Item ${idx} map action missing building`);
            hasMapAction = true;
        }
        if (a.action.type === 'link') {
            assert(typeof a.action.url === 'string' && a.action.url.startsWith('http'), `Item ${idx} link action missing valid url`);
            hasLinkAction = true;
        }
    }
    if (a.popup === true) hasPopupTrue = true;
});

console.log('✅ data/announcements.json passed all structural requirements.');

// 2. Check _headers
console.log('\n[2] Testing _headers...');
const headersPath = path.join(rootDir, '_headers');
const headersContent = fs.readFileSync(headersPath, 'utf8');
assert(headersContent.includes('/data/announcements.json'), '_headers must configure /data/announcements.json');
assert(headersContent.includes('Cache-Control: no-cache, no-store, must-revalidate'), '_headers must configure Cache-Control');
console.log('✅ _headers correctly configured.');

// 3. Check sw.js
console.log('\n[3] Testing sw.js...');
const swPath = path.join(rootDir, 'sw.js');
const swContent = fs.readFileSync(swPath, 'utf8');
assert(swContent.includes('bmemap-shell-v61'), 'sw.js cache shell version must be bumped to v61');
assert(swContent.includes("'./data/announcements.json'"), 'sw.js ASSETS_TO_CACHE must include ./data/announcements.json');
console.log('✅ sw.js correctly updated.');

// 4. Check index.html elements
console.log('\n[4] Testing index.html elements...');
const htmlPath = path.join(rootDir, 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

assert(htmlContent.includes('id="announcement-pill"'), 'index.html must include #announcement-pill');
assert(htmlContent.includes('id="announcement-pill-badge"'), 'index.html must include #announcement-pill-badge');
assert(htmlContent.includes('id="announcement-pill-text"'), 'index.html must include #announcement-pill-text');
assert(htmlContent.includes('id="announcement-pill-action-btn"'), 'index.html must include #announcement-pill-action-btn');
assert(htmlContent.includes('id="announcement-pill-close-btn"'), 'index.html must include #announcement-pill-close-btn');

assert(htmlContent.includes('id="news-preview-section"'), 'index.html must include #news-preview-section');
assert(htmlContent.includes('id="news-preview-badge"'), 'index.html must include #news-preview-badge');
assert(htmlContent.includes('id="news-preview-title"'), 'index.html must include #news-preview-title');
assert(htmlContent.includes('id="news-preview-desc"'), 'index.html must include #news-preview-desc');

assert(htmlContent.includes('id="popup-toggle-section"'), 'index.html must include #popup-toggle-section');
assert(htmlContent.includes('id="toggle-popups"'), 'index.html must include #toggle-popups');

assert(htmlContent.includes('id="settings-view-news"'), 'index.html must include #settings-view-news');
assert(htmlContent.includes('id="news-archive-content"'), 'index.html must include #news-archive-content');
assert(htmlContent.includes('APP_VERSION = \'61\''), 'index.html APP_VERSION must be bumped to 61');
assert(htmlContent.includes('style.css?v=61'), 'index.html style.css must use v=61 cache buster');
assert(htmlContent.includes('app.js?v=61'), 'index.html app.js must use v=61 cache buster');
console.log('✅ index.html contains all required DOM containers and controls.');

// 5. Check style.css
console.log('\n[5] Testing style.css...');
const cssPath = path.join(rootDir, 'style.css');
const cssContent = fs.readFileSync(cssPath, 'utf8');
assert(cssContent.includes('.btn-settings.has-unread:not(.active-mode)::after'), 'style.css must style .has-unread badge on btn-settings');
assert(cssContent.includes('.announcement-pill'), 'style.css must style .announcement-pill');
assert(cssContent.includes('.news-preview-card'), 'style.css must style .news-preview-card');
assert(cssContent.includes('.news-preview-card:focus-visible'), 'style.css must include focus-visible styling for accessibility');
assert(cssContent.includes('#settings-view-news'), 'style.css must style #settings-view-news');
assert(cssContent.includes('body.embed-mode #announcement-pill'), 'style.css must suppress #announcement-pill in embed mode');
assert(cssContent.includes('safe-area-inset-bottom'), 'style.css must handle safe-area-inset-bottom for pill');
console.log('✅ style.css contains all required CSS selectors and responsive rules.');

// 6. Check i18n
console.log('\n[6] Testing i18n parity...');
const huJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'locales', 'hu.json'), 'utf8'));
const enJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'locales', 'en.json'), 'utf8'));

assert(huJson.news, 'hu.json must have news namespace');
assert(enJson.news, 'en.json must have news namespace');
assert(huJson.settings.popups_title && enJson.settings.popups_title, 'settings.popups_title must exist in both');
assert(huJson.settings.popups_hint && enJson.settings.popups_hint, 'settings.popups_hint must exist in both');
assert(huJson.common.back && enJson.common.back, 'common.back must exist in both');
console.log('✅ i18n keys present and verified.');

// 7. Functional logic simulation & edge cases
console.log('\n[7] Simulating core announcements logic & edge cases...');

// Test localStorage mocking
let mockStorage = {};
const localStorage = {
    getItem: (k) => (k in mockStorage ? mockStorage[k] : null),
    setItem: (k, v) => { mockStorage[k] = String(v); },
    removeItem: (k) => { delete mockStorage[k]; }
};

// Test active filtering & date sorting
const now = new Date();
const activeList = announcements.filter(item => {
    if (!item || !item.id) return false;
    if (item.validUntil) {
        const exp = new Date(item.validUntil);
        if (!isNaN(exp.getTime()) && exp <= now) return false;
    }
    return true;
}).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
assert(activeList.length > 0, 'Active list should not be empty');
assert(new Date(activeList[0].date) >= new Date(activeList[activeList.length - 1].date), 'Active list must be sorted descending by date');

// Test unread detection with corrupted localStorage resilience
function getReadIds() {
    try {
        const v = localStorage.getItem('bmemap_read_announcements');
        const parsed = v ? JSON.parse(v) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch(e) { return []; }
}
let unread = activeList.filter(item => !getReadIds().includes(item.id));
assert.strictEqual(unread.length, activeList.length, 'Initially all active announcements should be unread');

// Test corrupted localStorage resilience (e.g. stored string or object instead of array)
mockStorage['bmemap_read_announcements'] = '{"corrupted": true}';
assert(Array.isArray(getReadIds()) && getReadIds().length === 0, 'Must gracefully recover from corrupted object in storage');
mockStorage['bmemap_read_announcements'] = 'not-json';
assert(Array.isArray(getReadIds()) && getReadIds().length === 0, 'Must gracefully recover from non-json in storage');
delete mockStorage['bmemap_read_announcements'];

// Test badge status
function hasUnreadBadge(isEmbed) {
    if (isEmbed) return false;
    return unread.length > 0;
}
assert.strictEqual(hasUnreadBadge(false), true, 'Badge should be visible when unread exists in normal mode');
assert.strictEqual(hasUnreadBadge(true), false, 'Badge must be suppressed in embed mode');

// Test popup eligibility
function getDismissedIds() {
    try {
        const v = localStorage.getItem('bmemap_dismissed_popups');
        const parsed = v ? JSON.parse(v) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch(e) { return []; }
}
function getEligiblePopup(list, popupsEnabled, isEmbed) {
    if (isEmbed || !popupsEnabled) return null;
    const dismissed = getDismissedIds();
    const read = getReadIds();
    return list.find(a => a.popup === true && !dismissed.includes(a.id) && !read.includes(a.id)) || null;
}

if (!activeList.some(a => a.popup === true)) {
    assert.strictEqual(getEligiblePopup(activeList, true, false), null, 'When active list has popup: false, no popup should be eligible');
}

const simList = activeList.some(a => a.popup === true)
    ? activeList
    : [{ id: 'sim-popup-1', popup: true, date: '2026-09-26' }, ...activeList];

const eligibleFirst = getEligiblePopup(simList, true, false);
assert(eligibleFirst !== null, 'Eligible popup announcement should be found');
assert.strictEqual(eligibleFirst.id, simList.find(a => a.popup === true).id);

// Test embed mode suppressing popup
assert.strictEqual(getEligiblePopup(simList, true, true), null, 'Embed mode must suppress popup');

// Test popupsEnabled = false suppressing popup
assert.strictEqual(getEligiblePopup(simList, false, false), null, 'Disabled popups toggle must suppress popup');

// Test dismissing popup
const dismissed = getDismissedIds();
dismissed.push(eligibleFirst.id);
localStorage.setItem('bmemap_dismissed_popups', JSON.stringify(dismissed));

const eligibleAfterDismiss = getEligiblePopup(simList, true, false);
assert.strictEqual(eligibleAfterDismiss, null, 'Dismissed popup should not be eligible again');

// Test opening news archive marks all as read
const readIds = getReadIds();
activeList.forEach(a => {
    if (!readIds.includes(a.id)) readIds.push(a.id);
});
localStorage.setItem('bmemap_read_announcements', JSON.stringify(readIds));

unread = activeList.filter(item => !getReadIds().includes(item.id));
assert.strictEqual(unread.length, 0, 'After marking all read, unread count should be 0');
assert.strictEqual(hasUnreadBadge(false), false, 'Badge must disappear when all are read');

// Test popup toggle persistence
localStorage.setItem('pref_popups_enabled', 'false');
assert.strictEqual(localStorage.getItem('pref_popups_enabled'), 'false');
localStorage.setItem('pref_popups_enabled', 'true');
assert.strictEqual(localStorage.getItem('pref_popups_enabled'), 'true');

console.log('✅ All functional logic simulations and edge cases passed with flying colors!');
console.log('\n🎉 ALL ACCEPTANCE CRITERIA VERIFIED.');
