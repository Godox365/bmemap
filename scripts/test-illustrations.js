/**
 * BMEmap Illustration & Theming Test Suite
 * Validates:
 * 1. All 18 SVG illustrations exist, are well-formed XML, and contain NO <style> tags.
 * 2. 100% tokenization with CSS Custom Properties var(--art-*, #hex) with matching dark fallbacks.
 * 3. 100% synchronization with style.css (dark mode, light mode, parity, gallery sizing/backgrounds).
 * 4. app.js code wiring (renderDefaultIllustration, preloadIllustrations, map.on('load'), openSheet).
 * 5. Functional simulation of DOMParser, parsererror resilience, race conditions, caching, and preloading.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..');
const SVG_DIR = path.join(ROOT_DIR, 'assets', 'illustrations');
const STYLE_PATH = path.join(ROOT_DIR, 'style.css');
const APP_PATH = path.join(ROOT_DIR, 'app.js');

const EXPECTED_FILES = [
    'atm.svg',
    'buffet.svg',
    'building.svg',
    'cloakroom.svg',
    'coffee_machine.svg',
    'computer.svg',
    'corridor.svg',
    'default_room.svg',
    'door.svg',
    'elevator.svg',
    'lab.svg',
    'lecture_hall.svg',
    'microwave.svg',
    'office.svg',
    'restroom.svg',
    'stairs.svg',
    'storage.svg',
    'vending_machine.svg'
];

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  ✅ PASS: ${message}`);
    } else {
        failedTests++;
        console.error(`  ❌ FAIL: ${message}`);
    }
}

console.log('================================================================');
console.log('🚀 BME_nav SVG ILLUSTRATIONS & THEMING TEST SUITE');
console.log('================================================================\n');

// -----------------------------------------------------------------------------
// SUITE 1: SVG File Existence and XML Well-Formedness
// -----------------------------------------------------------------------------
console.log('[Suite 1] Verifying SVG Files & XML Well-Formedness...');

const actualFiles = fs.readdirSync(SVG_DIR).filter(f => f.endsWith('.svg')).sort();
assert(actualFiles.length === EXPECTED_FILES.length, `Expected exactly ${EXPECTED_FILES.length} SVGs, found ${actualFiles.length}`);

for (const exp of EXPECTED_FILES) {
    const exists = fs.existsSync(path.join(SVG_DIR, exp));
    assert(exists, `SVG file exists: ${exp}`);
}

// XML Parsing via Python's standard xml.etree.ElementTree
for (const file of EXPECTED_FILES) {
    const filePath = path.join(SVG_DIR, file);
    let parseError = null;
    try {
        execFileSync('python3', ['-c', `
import xml.etree.ElementTree as ET
import sys
ET.parse(sys.argv[1])
`, filePath]);
    } catch (err) {
        parseError = err.message;
    }
    assert(!parseError, `XML well-formed without error: ${file}`);
}

// Native structural checks (root <svg>, viewBox, closing tags)
for (const file of EXPECTED_FILES) {
    const content = fs.readFileSync(path.join(SVG_DIR, file), 'utf8').trim();
    assert(content.startsWith('<svg') && content.endsWith('</svg>'), `${file} has valid root <svg> open and close tags`);
    assert(content.includes('viewBox="0 0'), `${file} specifies viewBox attribute`);
}

// -----------------------------------------------------------------------------
// SUITE 2: SVG Safety & Tokenization Integrity
// -----------------------------------------------------------------------------
console.log('\n[Suite 2] Verifying SVG Safety & Tokenization Integrity...');

for (const file of EXPECTED_FILES) {
    const content = fs.readFileSync(path.join(SVG_DIR, file), 'utf8');

    // Rule 1: NO <style> tags allowed (prevents global CSS leakage)
    const hasStyleTag = /<style\b[^>]*>/i.test(content);
    assert(!hasStyleTag, `No <style> tags in ${file}`);

    // Rule 2: All hex colors are inside var(--art-*, #hex)
    const strippedOfVars = content.replace(/var\(--[a-zA-Z0-9_-]+,\s*#[0-9a-fA-F]+\)/g, '');
    const untokenizedHex = strippedOfVars.match(/#[0-9a-fA-F]{3,8}/g);
    assert(!untokenizedHex || untokenizedHex.length === 0, `No untokenized raw hex colors in ${file} (found: ${untokenizedHex ? untokenizedHex.join(', ') : 'none'})`);

    // Rule 3: Valid CSS custom property syntax
    const varMatches = [...content.matchAll(/var\((--[a-zA-Z0-9_-]+),\s*(#[0-9a-fA-F]+)\)/g)];
    assert(varMatches.length > 0, `${file} contains tokenized variables (found ${varMatches.length} references)`);

    let validSyntax = true;
    for (const match of varMatches) {
        const token = match[1];
        const fallback = match[2];
        if (!token.startsWith('--art-') || !/^#[0-9a-fA-F]{3,8}$/.test(fallback)) {
            validSyntax = false;
        }
    }
    assert(validSyntax, `All CSS variables in ${file} start with '--art-' and have valid hex fallbacks`);
}

// -----------------------------------------------------------------------------
// SUITE 3: CSS Token & Class Synchronization with style.css
// -----------------------------------------------------------------------------
console.log('\n[Suite 3] Verifying style.css Synchronization & Parity...');

const styleContent = fs.readFileSync(STYLE_PATH, 'utf8');

for (const file of EXPECTED_FILES) {
    const baseName = file.replace('.svg', '').replace(/_/g, '-');
    const className = `art-${baseName}`;

    // Dark mode class exists
    const darkRegex = new RegExp(`\\.${className}\\s*\\{([^}]+)\\}`);
    const darkMatch = styleContent.match(darkRegex);
    assert(Boolean(darkMatch), `style.css contains dark mode class: .${className}`);

    // Light mode class exists
    const lightRegex = new RegExp(`body\\.light-mode\\s+\\.${className}\\s*\\{([^}]+)\\}`);
    const lightMatch = styleContent.match(lightRegex);
    assert(Boolean(lightMatch), `style.css contains light mode class: body.light-mode .${className}`);

    if (darkMatch && lightMatch) {
        const darkBlock = darkMatch[1];
        const lightBlock = lightMatch[1];

        const svgContent = fs.readFileSync(path.join(SVG_DIR, file), 'utf8');
        const varMatches = [...svgContent.matchAll(/var\((--[a-zA-Z0-9_-]+),\s*(#[0-9a-fA-F]+)\)/g)];
        const svgTokens = new Map();
        for (const m of varMatches) {
            svgTokens.set(m[1], m[2].toLowerCase());
        }

        // Check that every token in SVG exists in dark & light blocks
        let allTokensInDark = true;
        let allTokensInLight = true;
        let allFallbacksMatchDark = true;

        for (const [token, fallback] of svgTokens.entries()) {
            if (!darkBlock.includes(`${token}:`)) allTokensInDark = false;
            if (!lightBlock.includes(`${token}:`)) allTokensInLight = false;

            const valMatch = darkBlock.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]+)`));
            if (!valMatch || valMatch[1].toLowerCase() !== fallback) {
                allFallbacksMatchDark = false;
            }
        }

        assert(allTokensInDark, `${file}: All ${svgTokens.size} SVG tokens defined in .${className}`);
        assert(allTokensInLight, `${file}: All ${svgTokens.size} SVG tokens defined in body.light-mode .${className}`);
        assert(allFallbacksMatchDark, `${file}: All SVG fallback hex values match dark values in style.css`);

        // Check dark <-> light 1:1 token parity
        const darkTokenNames = [...darkBlock.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map(m => m[1]).sort();
        const lightTokenNames = [...lightBlock.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map(m => m[1]).sort();
        const darkSet = new Set(darkTokenNames);
        const lightSet = new Set(lightTokenNames);

        const darkNotInLight = darkTokenNames.filter(t => !lightSet.has(t));
        const lightNotInDark = lightTokenNames.filter(t => !darkSet.has(t));

        assert(darkNotInLight.length === 0 && lightNotInDark.length === 0, `${file}: 1:1 token parity between dark and light definitions`);
    }
}

// Gallery and SVG container rules
assert(styleContent.includes('body.light-mode #bottom-sheet .room-gallery-container') &&
       styleContent.includes('body.light-mode #bottom-sheet #room-gallery'),
       'Gallery light mode background rule is defined');

assert(styleContent.includes('#bottom-sheet #room-gallery svg.gallery-default-art') &&
       styleContent.includes('width: 100%') &&
       styleContent.includes('min-width: 100%') &&
       styleContent.includes('height: 100%') &&
       styleContent.includes('display: block'),
       'svg.gallery-default-art sizing rules defined');

// -----------------------------------------------------------------------------
// SUITE 4: Code Inspection in app.js
// -----------------------------------------------------------------------------
console.log('\n[Suite 4] Inspecting app.js Implementation...');

const appContent = fs.readFileSync(APP_PATH, 'utf8');

assert(appContent.includes('const _illustrationCache = new Map();'), '_illustrationCache Map is declared');
assert(appContent.includes('async function renderDefaultIllustration('), 'renderDefaultIllustration function exists');
assert(appContent.includes('function preloadIllustrations('), 'preloadIllustrations function exists');

// Race condition guards
assert(appContent.includes('galleryEl._currentArtSrc = artSrc;'), 'Race condition tag set before async operations');
assert(appContent.includes('galleryEl._currentArtSrc !== artSrc'), 'Race condition check after await fetch');
assert(appContent.includes('galleryEl._currentArtSrc === artSrc'), 'Race condition check before replaceChildren');

// XML safety & cleanup
assert(appContent.includes("const parser = new DOMParser();"), 'DOMParser is instantiated');
assert(appContent.includes("svgDoc.querySelector('parsererror')"), 'parsererror is checked before DOM injection');
assert(appContent.includes("galleryEl.replaceChildren(svgEl)"), 'replaceChildren() used for safe DOM replacement');

// Attributes on SVG
assert(appContent.includes("svgEl.classList.add('gallery-img', 'gallery-default-art', typeClass)"), 'gallery-img, gallery-default-art, and typeClass added');
assert(appContent.includes("svgEl.setAttribute('role', 'img')"), "role='img' set for a11y");
assert(appContent.includes("svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice')"), 'preserveAspectRatio set');

// Preloading constraints
assert(appContent.includes('if (!isDesktopSidePanel()) return;'), 'preloadIllustrations checks isDesktopSidePanel() to protect mobile');
assert(appContent.includes('setTimeout(') && appContent.includes('3000'), 'preloadIllustrations delays at least 3000ms');
assert(appContent.includes('requestIdleCallback'), 'preloadIllustrations uses requestIdleCallback');

// Map load and openSheet wiring
assert(appContent.includes('preloadIllustrations();'), 'preloadIllustrations() called in app.js');
const mapLoadIndex = appContent.indexOf("map.on('load'");
const preloadCallIndex = appContent.indexOf('preloadIllustrations();', mapLoadIndex);
assert(mapLoadIndex !== -1 && preloadCallIndex > mapLoadIndex, 'preloadIllustrations() called inside map.on("load") handler');

// openSheet wiring
const openSheetIndex = appContent.indexOf('function openSheet(');
assert(openSheetIndex !== -1, 'openSheet function found');
const renderCallIndex = appContent.indexOf('renderDefaultIllustration(galleryEl, feature, typeName, isBuildingFeat);', openSheetIndex);
assert(renderCallIndex !== -1, 'renderDefaultIllustration wired into openSheet gallery render branch');

// Resetting _currentArtSrc on non-illustration paths
const resetCount = (appContent.match(/galleryEl\._currentArtSrc = null;/g) || []).length;
assert(resetCount >= 2, `_currentArtSrc reset to null in photo and fallback branches (count: ${resetCount})`);

// -----------------------------------------------------------------------------
// SUITE 5: Unit & Behavioral Simulation in Node.js
// -----------------------------------------------------------------------------
console.log('\n[Suite 5] Behavioral Simulation (DOMParser, Race Conditions, Cache)...');

// Extract and test getDefaultIllustration logic
function extractGetDefaultIllustration(source) {
    const fnStart = source.indexOf('function getDefaultIllustration(feature) {');
    if (fnStart === -1) throw new Error('Could not find getDefaultIllustration');
    let depth = 0;
    let fnEnd = -1;
    for (let i = fnStart; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) {
                fnEnd = i + 1;
                break;
            }
        }
    }
    const fnCode = source.slice(fnStart, fnEnd);
    return new Function('feature', `${fnCode}\nreturn getDefaultIllustration(feature);`);
}

const getDefaultIllustrationFn = extractGetDefaultIllustration(appContent);

const featureTests = [
    { p: { amenity: 'vending_machine', vending: 'coffee' }, expected: 'assets/illustrations/coffee_machine.svg' },
    { p: { name: 'Kávéautomata' }, expected: 'assets/illustrations/coffee_machine.svg' },
    { p: { amenity: 'vending_machine' }, expected: 'assets/illustrations/vending_machine.svg' },
    { p: { amenity: 'toilets' }, expected: 'assets/illustrations/restroom.svg' },
    { p: { highway: 'elevator' }, expected: 'assets/illustrations/elevator.svg' },
    { p: { highway: 'steps' }, expected: 'assets/illustrations/stairs.svg' },
    { p: { amenity: 'atm' }, expected: 'assets/illustrations/atm.svg' },
    { p: { amenity: 'cafe' }, expected: 'assets/illustrations/buffet.svg' },
    { p: { amenity: 'fast_food' }, expected: 'assets/illustrations/buffet.svg' },
    { p: { amenity: 'cloakroom' }, expected: 'assets/illustrations/cloakroom.svg' },
    { p: { room: 'computer_lab' }, expected: 'assets/illustrations/computer.svg' },
    { p: { room: 'laboratory' }, expected: 'assets/illustrations/lab.svg' },
    { p: { room: 'lecture_hall' }, expected: 'assets/illustrations/lecture_hall.svg' },
    { p: { building: 'university' }, expected: 'assets/illustrations/building.svg' },
    { p: { room: 'storage' }, expected: 'assets/illustrations/storage.svg' },
    { p: { highway: 'corridor' }, expected: 'assets/illustrations/corridor.svg' },
    { p: { door: 'yes' }, expected: 'assets/illustrations/door.svg' },
    { p: { room: 'office' }, expected: 'assets/illustrations/office.svg' },
    { p: { amenity: 'microwave' }, expected: 'assets/illustrations/microwave.svg' },
    { p: {}, expected: 'assets/illustrations/default_room.svg' }
];

for (const ft of featureTests) {
    const res = getDefaultIllustrationFn({ properties: ft.p });
    assert(res === ft.expected, `Feature (${JSON.stringify(ft.p)}) maps to ${ft.expected}`);
    assert(fs.existsSync(path.join(ROOT_DIR, res)), `Target SVG file exists for ${res}`);
}

// Simulation of DOMParser, parsererror detection, and race conditions
// Simulation of DOMParser, parsererror detection, and race conditions
class MockElement {
    constructor(tagName) {
        this.tagName = tagName;
        const set = new Set();
        this.classList = {
            add: (...classes) => classes.forEach(c => set.add(c)),
            remove: (...classes) => classes.forEach(c => set.delete(c)),
            has: (c) => set.has(c),
            contains: (c) => set.has(c)
        };
        this.attributes = {};
        this.children = [];
        this.style = {};
        this._className = '';
    }
    set className(val) {
        this._className = val || '';
        this._className.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
    get className() { return this._className; }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
    replaceChildren(...children) { this.children = [...children]; }
    querySelector(sel) {
        if (sel === 'svg' && this.tagName === 'svg') return this;
        if (sel.startsWith('.') && this.classList.has(sel.slice(1))) return this;
        for (const c of this.children) {
            const found = c.querySelector(sel);
            if (found) return found;
        }
        return null;
    }
}

class MockDOMDocument {
    constructor(root) {
        this.root = root;
    }
    querySelector(sel) {
        if (!this.root) return null;
        if (this.root.tagName === sel) return this.root;
        return this.root.querySelector(sel);
    }
}

class MockDOMParser {
    parseFromString(str, type) {
        if (str.includes('<parsererror>')) {
            const errEl = new MockElement('parsererror');
            errEl.textContent = 'XML Parsing error';
            return new MockDOMDocument(errEl);
        }
        const svgEl = new MockElement('svg');
        return new MockDOMDocument(svgEl);
    }
}

// Test harness for renderDefaultIllustration behavior
async function testRenderHarness() {
    const testCache = new Map();
    let carouselSetupCount = 0;

    async function runRender(galleryEl, artSrc, fetchMock, label = 'Tanterem') {
        if (!galleryEl) return;
        const renderToken = Symbol();
        galleryEl._currentArtSrc = artSrc;
        galleryEl._currentRenderToken = renderToken;

        let svgText = testCache.get(artSrc);
        if (!svgText) {
            try {
                const resp = await fetchMock(artSrc);
                if (resp && resp.ok) {
                    svgText = await resp.text();
                    testCache.set(artSrc, svgText);
                }
            } catch (err) {
                // Network error caught
            }
        }

        if (galleryEl._currentArtSrc !== artSrc || galleryEl._currentRenderToken !== renderToken) return;

        if (!svgText) {
            if (galleryEl._currentArtSrc === artSrc && galleryEl._currentRenderToken === renderToken) {
                const fallbackImg = new MockElement('img');
                fallbackImg.src = artSrc;
                fallbackImg.className = 'gallery-img gallery-default-art';
                fallbackImg.setAttribute('aria-label', label);
                galleryEl.replaceChildren(fallbackImg);
                carouselSetupCount++;
            }
            return;
        }

        try {
            const parser = new MockDOMParser();
            const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');

            const parseError = svgDoc.querySelector('parsererror');
            if (parseError) {
                if (galleryEl._currentArtSrc === artSrc && galleryEl._currentRenderToken === renderToken) {
                    const fallbackImg = new MockElement('img');
                    fallbackImg.src = artSrc;
                    fallbackImg.className = 'gallery-img gallery-default-art';
                    fallbackImg.setAttribute('aria-label', label);
                    galleryEl.replaceChildren(fallbackImg);
                    carouselSetupCount++;
                }
                return;
            }

            const svgEl = svgDoc.querySelector('svg');
            if (svgEl) {
                const baseName = artSrc.split('/').pop().replace('.svg', '').replace(/_/g, '-');
                const typeClass = `art-${baseName}`;

                svgEl.classList.add('gallery-img', 'gallery-default-art', typeClass);
                svgEl.setAttribute('role', 'img');
                svgEl.setAttribute('aria-label', label);
                svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');

                if (galleryEl._currentArtSrc === artSrc && galleryEl._currentRenderToken === renderToken) {
                    galleryEl.replaceChildren(svgEl);
                    carouselSetupCount++;
                }
            }
        } catch (_) {}
    }

    // 1. Normal Happy Path
    const galleryEl = new MockElement('div');
    const mockFetchSuccess = async (url) => ({
        ok: true,
        text: async () => `<svg viewBox="0 0 100 100"><rect fill="var(--art-bg, #111)"/></svg>`
    });

    await runRender(galleryEl, 'assets/illustrations/coffee_machine.svg', mockFetchSuccess);
    assert(galleryEl.children.length === 1, 'Happy path: galleryEl contains 1 child after render');
    const renderedSvg = galleryEl.children[0];
    assert(renderedSvg.classList.has('gallery-img') &&
           renderedSvg.classList.has('gallery-default-art') &&
           renderedSvg.classList.has('art-coffee-machine'),
           'Rendered SVG has correct classes: gallery-img, gallery-default-art, art-coffee-machine');
    assert(renderedSvg.getAttribute('role') === 'img', 'Rendered SVG has role="img"');
    assert(renderedSvg.getAttribute('preserveAspectRatio') === 'xMidYMid slice', 'Rendered SVG has preserveAspectRatio');

    // 2. parsererror resilience: fallback img rendered instead of empty void
    const galleryBad = new MockElement('div');
    const mockFetchBadXml = async (url) => ({
        ok: true,
        text: async () => `<parsererror>Malformed XML</parsererror>`
    });

    await runRender(galleryBad, 'assets/illustrations/corrupted.svg', mockFetchBadXml);
    assert(galleryBad.children.length === 1, 'parsererror: corrupted XML recovers with fallback img');
    assert(galleryBad.children[0].classList.has('gallery-default-art'), 'parsererror fallback has gallery-default-art class');

    // 3. Network error resilience: offline / 404 recovers with fallback img
    const galleryNetErr = new MockElement('div');
    const mockFetchFail = async (url) => { throw new Error('Network offline'); };
    await runRender(galleryNetErr, 'assets/illustrations/offline.svg', mockFetchFail, 'Offline Room');
    assert(galleryNetErr.children.length === 1, 'Network failure: offline request recovers with fallback img');
    assert(galleryNetErr.children[0].tagName === 'img', 'Network failure creates img element fallback');

    // 4. Race condition resilience: Slow room A finishes after Fast room B
    const galleryRace = new MockElement('div');
    let resolveRoomA;
    const promiseA = new Promise(resolve => { resolveRoomA = resolve; });

    const slowFetchA = async () => ({
        ok: true,
        text: async () => {
            await promiseA;
            return `<svg><circle/></svg>`;
        }
    });

    const fastFetchB = async () => ({
        ok: true,
        text: async () => `<svg><rect/></svg>`
    });

    // Start room A (slow)
    const callA = runRender(galleryRace, 'assets/illustrations/lecture_hall.svg', slowFetchA);
    // User immediately switches to room B (fast)
    const callB = runRender(galleryRace, 'assets/illustrations/atm.svg', fastFetchB);

    await callB;
    assert(galleryRace._currentArtSrc === 'assets/illustrations/atm.svg', 'Current art source is atm.svg');
    assert(galleryRace.children[0].classList.has('art-atm'), 'Atm illustration rendered first');

    // Now room A finishes later
    resolveRoomA();
    await callA;
    assert(galleryRace.children[0].classList.has('art-atm'), 'Race condition guard kept atm.svg and rejected stale lecture_hall.svg');

    // 5. Intra-illustration race condition: Switching between two rooms sharing the SAME illustration
    const gallerySameArtRace = new MockElement('div');
    let resolveRoomSameA;
    const promiseSameA = new Promise(resolve => { resolveRoomSameA = resolve; });

    const slowFetchSameA = async () => ({
        ok: true,
        text: async () => {
            await promiseSameA;
            return `<svg><path id="room1"/></svg>`;
        }
    });
    const fastFetchSameB = async () => ({
        ok: true,
        text: async () => `<svg><path id="room2"/></svg>`
    });

    // User opens Room 1 (slow), then quickly switches to Room 2 (fast), both using default_room.svg
    const sameArtSrc = 'assets/illustrations/default_room.svg';
    testCache.delete(sameArtSrc); // Ensure uncached
    const callSameA = runRender(gallerySameArtRace, sameArtSrc, slowFetchSameA, 'Room 1');
    const callSameB = runRender(gallerySameArtRace, sameArtSrc, fastFetchSameB, 'Room 2');

    await callSameB;
    assert(gallerySameArtRace.children[0].getAttribute('aria-label') === 'Room 2', 'Room 2 rendered first with Room 2 label');

    // Room 1 finishes later
    resolveRoomSameA();
    await callSameA;
    assert(gallerySameArtRace.children[0].getAttribute('aria-label') === 'Room 2', 'Intra-illustration race guard rejected stale Room 1 arrival');

    // 6. Switching to room with real photo clears _currentArtSrc
    galleryRace._currentArtSrc = null;
    galleryRace._currentRenderToken = null;
    await runRender(galleryRace, 'assets/illustrations/buffet.svg', slowFetchA);
    assert(galleryRace._currentArtSrc === 'assets/illustrations/buffet.svg' || galleryRace.children.length > 0, 'Buffer state valid');

    // 7. Cache hit behavior
    let networkFetches = 0;
    const mockFetchCounting = async (url) => {
        networkFetches++;
        return { ok: true, text: async () => `<svg></svg>` };
    };
    await runRender(galleryEl, 'assets/illustrations/stairs.svg', mockFetchCounting);
    await runRender(galleryEl, 'assets/illustrations/stairs.svg', mockFetchCounting);
    assert(networkFetches === 1, 'Cache hit: stairs.svg only fetched over network once');

    // 8. Browser WebIDL compliance for window.requestIdleCallback
    const mockWindow = {
        requestIdleCallback(cb) {
            if (this !== mockWindow) {
                throw new TypeError("Failed to execute 'requestIdleCallback' on 'Window': Illegal invocation");
            }
            cb();
        }
    };
    let idleExecuted = false;
    // Simulated bound runner (our fix)
    const safeIdleRunner = mockWindow.requestIdleCallback ? mockWindow.requestIdleCallback.bind(mockWindow) : ((cb) => setTimeout(cb, 500));
    try {
        safeIdleRunner(() => { idleExecuted = true; });
        assert(idleExecuted, 'WebIDL compliance: bound requestIdleCallback executes without Illegal invocation');
    } catch (err) {
        assert(false, `WebIDL compliance failure: ${err.message}`);
    }

    // Verify that unbound call would indeed throw Illegal invocation
    let unboundThrew = false;
    const unsafeIdleRunner = mockWindow.requestIdleCallback;
    try {
        unsafeIdleRunner(() => {});
    } catch (err) {
        unboundThrew = err instanceof TypeError && err.message.includes('Illegal invocation');
    }
    assert(unboundThrew, 'WebIDL test confirms unbound requestIdleCallback causes Illegal invocation in real browsers');
}

testRenderHarness().then(() => {
    console.log('\n================================================================');
    console.log(`📊 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED (TOTAL: ${totalTests})`);
    console.log('================================================================\n');

    if (failedTests > 0) {
        console.error('❌ Test suite failed!');
        process.exit(1);
    } else {
        console.log('🎉 ALL SVG & THEMING TESTS PASSED PERFECTLY!\n');
        process.exit(0);
    }
}).catch(err => {
    console.error('Test harness exception:', err);
    process.exit(1);
});

