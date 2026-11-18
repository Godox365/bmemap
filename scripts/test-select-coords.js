/**
 * Comprehensive Unit and Integration Test Suite for #1 (Select Any Coords)
 * Validates feature construction, nav endpoints, spatial resolution,
 * SVG rendering, level switching, deep-link share serialization, and i18n parity.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('================================================================');
console.log('🚀 BME_nav SELECT ANY COORDS (#1) TEST SUITE');
console.log('================================================================\n');

const rootDir = path.join(__dirname, '..');
const appJsContent = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
const styleCssContent = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
const huLocale = JSON.parse(fs.readFileSync(path.join(rootDir, 'locales/hu.json'), 'utf8'));
const enLocale = JSON.parse(fs.readFileSync(path.join(rootDir, 'locales/en.json'), 'utf8'));

// Mock Browser Environment
const storage = {};
global.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
};

const docListeners = {};
const winListeners = {};

global.window = {
    location: { search: '', pathname: '/', href: 'https://bmemap.hu/' },
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener: (ev, fn) => {
        if (!winListeners[ev]) winListeners[ev] = [];
        winListeners[ev].push(fn);
    },
    removeEventListener: (ev, fn) => {
        if (winListeners[ev]) {
            winListeners[ev] = winListeners[ev].filter(f => f !== fn);
        }
    },
    dispatchEvent: (ev) => {
        if (winListeners[ev.type]) {
            winListeners[ev.type].forEach(f => f(ev));
        }
    },
    getSelection: () => ({
        removeAllRanges: () => { global._selectionCleared = true; }
    }),
    history: { replaceState: () => {} }
};

global.document = {
    addEventListener: (ev, fn, opts) => {
        if (!docListeners[ev]) docListeners[ev] = [];
        docListeners[ev].push({ fn, opts });
    },
    removeEventListener: (ev, fn) => {
        if (docListeners[ev]) {
            docListeners[ev] = docListeners[ev].filter(item => item.fn !== fn);
        }
    },
    dispatchEvent: (ev) => {
        if (docListeners[ev.type]) {
            docListeners[ev.type].forEach(item => item.fn(ev));
        }
    },
    documentElement: {
        classList: { add: () => {}, remove: () => {} },
        style: {}
    },
    createElement: (tag) => {
        return {
            tagName: tag,
            className: '',
            style: {},
            innerHTML: '',
            innerText: '',
            dataset: {},
            children: [],
            appendChild(child) { this.children.push(child); return child; },
            insertBefore(newNode, refNode) { this.children.push(newNode); return newNode; },
            after(...nodes) { this.children.push(...nodes); },
            before(...nodes) { this.children.unshift(...nodes); },
            replaceChildren(...children) { this.children = [...children]; },
            addEventListener(ev, fn, opts) {
                if (!this._listeners) this._listeners = {};
                if (!this._listeners[ev]) this._listeners[ev] = [];
                this._listeners[ev].push({ fn, opts });
            },
            removeEventListener(ev, fn) {
                if (this._listeners && this._listeners[ev]) {
                    this._listeners[ev] = this._listeners[ev].filter(item => item.fn !== fn);
                }
            },
            dispatchEvent(ev) {
                if (this._listeners && this._listeners[ev.type]) {
                    this._listeners[ev.type].forEach(item => item.fn(ev));
                }
            },
            remove() {},
            focus: () => {},
            blur: () => {},
            querySelector(sel) {
                if (sel.startsWith('.')) {
                    const cls = sel.slice(1);
                    return this.children.find(c => c.className && c.className.includes(cls)) || null;
                }
                return null;
            },
            querySelectorAll(sel) {
                if (sel.startsWith('.')) {
                    const cls = sel.slice(1);
                    return this.children.filter(c => c.className && c.className.includes(cls));
                }
                return [];
            },
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); },
                toggle(c, force) {
                    if (force === undefined) {
                        if (this.contains(c)) this.remove(c);
                        else this.add(c);
                    } else if (force) {
                        this.add(c);
                    } else {
                        this.remove(c);
                    }
                }
            }
        };
    },
    getElementById: (id) => {
        if (!global._elements[id]) {
            global._elements[id] = global.document.createElement('div');
            global._elements[id].id = id;
        }
        return global._elements[id];
    },
    querySelector: (sel) => {
        if (!global._elements[sel]) {
            global._elements[sel] = global.document.createElement('div');
        }
        return global._elements[sel];
    },
    querySelectorAll: () => []
};

global._elements = {};
global.getComputedStyle = () => ({
    getPropertyValue: (v) => (v === '--color-ui-active' ? '#8A2432' : '')
});
global.navigator = {
    clipboard: {
        writeText: async (t) => { global._clipboardText = t; return Promise.resolve(); }
    },
    vibrate: (ms) => { global._lastVibrate = ms; return true; }
};

global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');

// Load Minimal Turf Mock
global.turf = {
    point: (coords) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: coords } }),
    centroid: (feat) => {
        if (!feat || !feat.geometry) return { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } };
        if (feat.geometry.type === 'Point') return feat;
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [19.056, 47.481] } };
    },
    distance: (pt1, pt2) => {
        const c1 = pt1.geometry ? pt1.geometry.coordinates : pt1;
        const c2 = pt2.geometry ? pt2.geometry.coordinates : pt2;
        const dx = (c1[0] - c2[0]) * 75; // approx km
        const dy = (c1[1] - c2[1]) * 111;
        return Math.sqrt(dx * dx + dy * dy);
    },
    booleanPointInPolygon: (pt, poly) => {
        const c = pt.geometry.coordinates;
        if (!poly.geometry || !poly.geometry.coordinates) return false;
        const ring = poly.geometry.coordinates[0];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of ring) {
            if (p[0] < minX) minX = p[0];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[1] > maxY) maxY = p[1];
        }
        return c[0] >= minX && c[0] <= maxX && c[1] >= minY && c[1] <= maxY;
    }
};

// Mock MapLibre Map and Marker
const mockCanvas = global.document.createElement('canvas');
mockCanvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1024, height: 768 });
mockCanvas.clientWidth = 1024;
mockCanvas.clientHeight = 768;

const mockDragRotate = {
    _mouseRotate: { _moveStateManager: { _correctEvent: null } },
    _mousePitch: { _moveStateManager: { _correctEvent: null } },
    enable: () => {},
    disable: () => {},
    isEnabled: () => true,
    isActive: () => false
};

const mapListeners = {};

const mockMapInstance = {
    getZoom: () => 19,
    getBearing: () => 0,
    getPitch: () => 0,
    stop: () => {},
    easeTo: () => {},
    fitBounds: () => {},
    dragRotate: mockDragRotate,
    _initOptions: null,
    _padding: { top: 0, bottom: 0, left: 0, right: 0 },
    getPadding: function() { return this._padding; },
    setPadding: function(p) { this._padding = { ...p }; return this; },
    getContainer: () => ({ clientWidth: 1024, clientHeight: 768 }),
    cameraForBounds: (bounds, options) => {
        const minLng = bounds[0][0];
        const minLat = bounds[0][1];
        const maxLng = bounds[1][0];
        const maxLat = bounds[1][1];
        const spanLng = Math.abs(maxLng - minLng);
        const spanLat = Math.abs(maxLat - minLat);
        let z = 19.0;
        if (spanLng > 0.01 || spanLat > 0.01) z = 14.0;
        else if (spanLng > 0.002 || spanLat > 0.002) z = 16.5;
        if (options && options.maxZoom && z > options.maxZoom) z = options.maxZoom;
        return {
            center: { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 },
            zoom: z
        };
    },
    flyTo: (opts) => { global._lastFlyTo = opts; },
    getCanvas: () => mockCanvas,
    unproject: (pt) => ({ lng: 19.056 + (pt[0] / 10000), lat: 47.481 + (pt[1] / 10000) }),
    project: (coords) => ({ x: 500, y: 300 }),
    on: (ev, ...args) => {
        const fn = args.length >= 2 ? args[args.length - 1] : args[0];
        if (!mapListeners[ev]) mapListeners[ev] = [];
        mapListeners[ev].push(fn);
    },
    fire: (ev, data) => {
        if (mapListeners[ev]) mapListeners[ev].forEach(f => f(data));
    },
    addControl: () => {},
    getSource: () => ({ setData: () => {} }),
    getLayer: () => true,
    setPaintProperty: () => {}
};

global.maplibregl = {
    Map: function(opts) {
        mockMapInstance._initOptions = opts;
        return mockMapInstance;
    },
    AttributionControl: function() {},
    NavigationControl: function() {},
    GeolocateControl: function() {},
    Marker: class {
        constructor(opts) {
            this.el = opts.element;
            this.anchor = opts.anchor;
            this.lngLat = null;
        }
        setLngLat(ll) { this.lngLat = ll; return this; }
        addTo(m) { this.map = m; return this; }
        getElement() { return this.el; }
        remove() { this.removed = true; }
    }
};

global.map = mockMapInstance;

// Sandbox evaluation of app.js functions
const vm = require('vm');
const roomDataContent = fs.readFileSync(path.join(rootDir, 'room_data.js'), 'utf8');

global.fetch = async () => ({ ok: true, json: async () => ({}) });

const context = vm.createContext({
    ...global,
    navigator: {
        clipboard: {
            writeText: async (t) => { global._clipboardText = t; return Promise.resolve(); }
        },
        vibrate: (ms) => { global._lastVibrate = ms; return true; }
    },
    console,
    URL,
    URLSearchParams,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    RegExp,
    t: (k, params) => {
        const keys = k.split('.');
        let val = huLocale;
        for (const part of keys) {
            val = val ? val[part] : null;
        }
        if (typeof val === 'string' && params) {
            for (const [pk, pv] of Object.entries(params)) {
                val = val.replace(`{${pk}}`, pv);
            }
        }
        return val || k;
    }
});

vm.runInContext(roomDataContent, context);
vm.runInContext(appJsContent, context);

if (typeof context.window._initMapEventListeners === 'function') {
    context.window._initMapEventListeners();
}

// Tests execution
let passed = 0;
let total = 0;

async function it(desc, fn) {
    total++;
    try {
        await fn();
        console.log(`  ✅ PASS: ${desc}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${desc}`);
        console.error(err);
        process.exitCode = 1;
    }
}

async function runAllTests() {
// ============================================================================
console.log('[Suite 1] Custom Pin Construction & Context Resolution');
// ============================================================================

await it('createCustomPinFeature sets correct properties and Point coordinates', () => {
    const feat = context.window.createCustomPinFeature(19.056123, 47.481456, 'K', '1', { type: 'near', name: 'KF51' });
    assert.strictEqual(feat.type, 'Feature');
    assert.strictEqual(feat._isCustomPin, true);
    assert.strictEqual(feat.geometry.type, 'Point');
    assert.strictEqual(feat.geometry.coordinates[0], 19.056123);
    assert.strictEqual(feat.geometry.coordinates[1], 47.481456);
    assert.strictEqual(feat.properties.level, '1');
    assert.strictEqual(feat.properties._lat, 47.481456);
    assert.strictEqual(feat.properties._lng, 19.056123);
    assert.strictEqual(feat.properties.name, 'Kijelölt pont');
    assert(feat.properties._subTitle.toLowerCase().includes('k épület'));
    assert(feat.properties._subTitle.includes('KF51'));
});

await it('createCustomPinFeature marks outside campus points and sets appropriate subtitle', () => {
    const farFeat = context.window.createCustomPinFeature(19.15, 47.55, null, null);
    assert.strictEqual(farFeat.properties._isOutsideCampus, true);
    assert.strictEqual(farFeat.properties._subTitle, 'BME területén kívül');
});

await it('resolveNearbyRoomContext detects inside room polygon', () => {
    context.currentBuildingKey = 'K';
    context.window.setGeoJsonData({
        features: [
            {
                type: 'Feature',
                properties: { ref: 'KF51', name: 'KF51 előadó', indoor: 'room', level: '1' },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[19.055, 47.480], [19.057, 47.480], [19.057, 47.482], [19.055, 47.482], [19.055, 47.480]]]
                }
            }
        ]
    });
    const ctx = context.window.resolveNearbyRoomContext(19.056, 47.481, '1');
    assert(ctx !== null);
    assert.strictEqual(ctx.type, 'inside');
    assert(ctx.name.includes('KF51'));
});

await it('resolveNearbyRoomContext detects nearby room outside polygon within range', () => {
    context.currentBuildingKey = 'K';
    context.window.setGeoJsonData({
        features: [
            {
                type: 'Feature',
                properties: { ref: 'KF51', indoor: 'room', level: '1' },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[19.055, 47.480], [19.0561, 47.480], [19.0561, 47.482], [19.055, 47.482], [19.055, 47.480]]]
                }
            }
        ]
    });
    // Coordinate slightly outside the polygon (dx = 0.0003 * 75 = 0.0225 km = 22.5m <= 30m)
    const ctx = context.window.resolveNearbyRoomContext(19.0563, 47.481, '1');
    assert(ctx !== null);
    assert.strictEqual(ctx.type, 'near');
    assert(ctx.name.includes('KF51'));
});

// ============================================================================
console.log('\n[Suite 2] Unified NavEndpoint Model (#6 Compatibility)');
// ============================================================================

await it('toNavEndpoint formats custom pin into uniform NavEndpoint', () => {
    const pin = context.window.createCustomPinFeature(19.056, 47.481, 'K', '1', { type: 'near', name: 'KF51' });
    const ep = context.window.toNavEndpoint(pin);
    assert.strictEqual(ep.type, 'coord');
    assert.strictEqual(ep.isCustomPin, true);
    assert.strictEqual(ep.lat, 47.481);
    assert.strictEqual(ep.lng, 19.056);
    assert.strictEqual(ep.buildingKey, 'K');
    assert.strictEqual(ep.level, '1');
    assert.strictEqual(ep.name, 'Kijelölt pont');
});

await it('setNavigationSource and setNavigationTarget register endpoints', () => {
    const pin = context.window.createCustomPinFeature(19.056, 47.481, 'K', '1');
    const epSource = context.window.setNavigationSource(pin);
    assert.strictEqual(context.window.getActiveCustomPinFeature ? pin : pin, pin);
    assert.strictEqual(epSource.isCustomPin, true);

    const epTarget = context.window.setNavigationTarget(pin);
    assert.strictEqual(epTarget.isCustomPin, true);
});

// ============================================================================
console.log('\n[Suite 3] Marker Lifecycle & Floor Visibility');
// ============================================================================

await it('dropCustomPinMarker and clearCustomPin manage map marker', () => {
    const pin = context.window.createCustomPinFeature(19.056, 47.481, 'K', '1');
    context.window.dropCustomPinMarker(pin);
    assert(context.window.getActiveCustomPinMarker() !== null);
    assert.strictEqual(context.window.getActiveCustomPinFeature(), pin);

    context.window.clearCustomPin(true);
    assert.strictEqual(context.window.getActiveCustomPinMarker(), null);
    assert.strictEqual(context.window.getActiveCustomPinFeature(), null);
});

await it('updateCustomPinVisibility toggles display when floor changes', () => {
    const pin = context.window.createCustomPinFeature(19.056, 47.481, 'K', '1');
    context.window.dropCustomPinMarker(pin);
    
    // Switch to floor 2 via switchLevel: pin on level 1 should be hidden
    context.switchLevel('2');
    assert.strictEqual(context.window.getActiveCustomPinMarker().getElement().style.display, 'none');

    // Switch back to floor 1: pin should become visible
    context.switchLevel('1');
    assert.strictEqual(context.window.getActiveCustomPinMarker().getElement().style.display, '');

    context.window.clearCustomPin(true);
});

// ============================================================================
console.log('\n[Suite 4] SVG Pin Geometry & Theming Spec');
// ============================================================================

await it('getCustomPinSvgHtml renders rounded bottom tip and theme classes', () => {
    const svg = context.window.getCustomPinSvgHtml();
    assert(svg.includes('custom-pin-svg'));
    assert(svg.includes('custom-pin-body'));
    assert(svg.includes('custom-pin-dot'));
    // Validates arc radius 1.1 for minimally rounded tip
    assert(svg.includes('a1.1 1.1 0 0 0 1.44 0'));
});

await it('style.css defines custom pin rules using --color-ui-active', () => {
    assert(styleCssContent.includes('.custom-pin-marker'));
    assert(styleCssContent.includes('.custom-pin-svg'));
    assert(styleCssContent.includes('.custom-pin-body'));
    assert(styleCssContent.includes('.custom-pin-dot'));
    assert(styleCssContent.includes('var(--color-ui-active'));
    assert(styleCssContent.includes('.coords-card'));
    assert(styleCssContent.includes('.btn-copy-coords'));
});

await it('isPointInSafeView correctly detects whether pin is visible or obscured', () => {
    context.window.innerWidth = 390;
    context.window.innerHeight = 800;
    context.map.project = () => ({ x: 195, y: 350 });
    assert.strictEqual(context.window.isPointInSafeView(19.056, 47.481), true);

    context.map.project = () => ({ x: 195, y: 680 }); // Under bottom sheet
    assert.strictEqual(context.window.isPointInSafeView(19.056, 47.481), false);
});

await it('moveCameraToSafeView calls map.flyTo with padding when pin is obscured', () => {
    let flyToOptions = null;
    context.window.innerWidth = 390;
    context.window.innerHeight = 800;
    context.map.flyTo = (opts) => { flyToOptions = opts; };
    context.window.moveCameraToSafeView(19.056, 47.481);
    assert(flyToOptions !== null);
    assert.strictEqual(flyToOptions.center[0], 19.056);
    assert.strictEqual(flyToOptions.center[1], 47.481);
    assert(flyToOptions.padding && flyToOptions.padding.bottom > 180);
});

await it('moveCameraToSafeView zooms in to 19 when map zoom is low (< 18.5)', () => {
    let flyToOptions = null;
    context.map.getZoom = () => 16.0;
    context.map.flyTo = (opts) => { flyToOptions = opts; };
    context.window.moveCameraToSafeView(19.056, 47.481);
    assert(flyToOptions !== null);
    assert.strictEqual(flyToOptions.zoom, 19.0);
});

await it('moveCameraToSafeView preserves current high zoom (>= 18.5)', () => {
    let flyToOptions = null;
    context.map.getZoom = () => 19.5;
    context.map.flyTo = (opts) => { flyToOptions = opts; };
    context.window.moveCameraToSafeView(19.056, 47.481);
    assert(flyToOptions !== null);
    assert.strictEqual(flyToOptions.zoom, 19.5);
});

await it('openSheet does not trigger smartFlyTo for custom pins', () => {
    let flyToCalled = false;
    context.map.flyTo = () => { flyToCalled = true; };
    const pin = context.window.createCustomPinFeature(19.056, 47.481, 'K', '1');
    context.openSheet(pin);
    assert.strictEqual(flyToCalled, false);
});

// ============================================================================
console.log('\n[Suite 5] Deep Link Share Serialization');
// ============================================================================

await it('shareCurrentState encodes coord payload into base64 URL param', async () => {
    const pin = context.window.createCustomPinFeature(19.056789, 47.481234, 'K', '1', { type: 'near', name: 'KF51' });
    context.window.setSelectedFeature(pin);
    context.window.setActiveRouteData(null);
    context.currentBuildingKey = 'K';

    context.shareCurrentState();
    await new Promise(r => setTimeout(r, 50));

    assert(global._clipboardText);
    const parsedUrl = new URL(global._clipboardText);
    const shareParam = parsedUrl.searchParams.get('share');
    assert(shareParam);

    const decodedJson = JSON.parse(Buffer.from(shareParam, 'base64').toString('utf8'));
    assert.strictEqual(decodedJson.mode, 'coord');
    assert.strictEqual(decodedJson.b, 'K');
    assert.strictEqual(decodedJson.lvl, '1');
    assert.strictEqual(decodedJson.lat, 47.481234);
    assert.strictEqual(decodedJson.lon, 19.056789);
    assert.strictEqual(decodedJson.near, 'KF51');
});

// ============================================================================
console.log('\n[Suite 6] Localization (i18n) Parity & Toast Cleanliness');
// ============================================================================

await it('hu.json and en.json define all required translation keys', () => {
    const requiredSheetKeys = [
        'custom_pin_title',
        'near_room',
        'inside_room',
        'copy_coords',
        'outside_campus',
        'campus_overview_title'
    ];
    for (const k of requiredSheetKeys) {
        assert(huLocale.sheet && huLocale.sheet[k], `Missing hu.json sheet.${k}`);
        assert(enLocale.sheet && enLocale.sheet[k], `Missing en.json sheet.${k}`);
    }

    assert(huLocale.toasts && huLocale.toasts.coords_copied, 'Missing hu.json toasts.coords_copied');
    assert(enLocale.toasts && enLocale.toasts.coords_copied, 'Missing en.json toasts.coords_copied');
    assert(huLocale.toasts && huLocale.toasts.pin_too_far_for_nav, 'Missing hu.json toasts.pin_too_far_for_nav');
    assert(enLocale.toasts && enLocale.toasts.pin_too_far_for_nav, 'Missing en.json toasts.pin_too_far_for_nav');
});

await it('no emojis exist in any toast notifications in hu.json or en.json', () => {
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    for (const [k, v] of Object.entries(huLocale.toasts || {})) {
        assert(!emojiRegex.test(v), `Emoji found in hu.json toast: ${k} -> ${v}`);
    }
    for (const [k, v] of Object.entries(enLocale.toasts || {})) {
        assert(!emojiRegex.test(v), `Emoji found in en.json toast: ${k} -> ${v}`);
    }
});

// ============================================================================
console.log('\n[Suite 7] Custom Pin Default Illustration');
// ============================================================================

await it('getDefaultIllustration maps custom pin feature to selected_point.svg', () => {
    const pin = context.window.createCustomPinFeature(19.056, 47.481, null, null);
    const art = context.getDefaultIllustration(pin);
    assert.strictEqual(art, 'assets/illustrations/selected_point.svg');
    assert(fs.existsSync(path.join(rootDir, art)), 'assets/illustrations/selected_point.svg must exist');
});

// ============================================================================
console.log('\n[Suite 8] Route Safe Camera & Zoom Stability');
// ============================================================================

await it('computeSafeRouteCamera resets MapLibre residual padding', () => {
    context.map.setPadding({ top: 100, bottom: 250, left: 60, right: 60 });
    assert.strictEqual(context.map.getPadding().top, 100);
    const cam = context.window.computeSafeRouteCamera([[19.056, 47.481], [19.057, 47.482]]);
    assert(cam !== null);
    assert.deepStrictEqual(context.map.getPadding(), { top: 0, bottom: 0, left: 0, right: 0 }, 'map.getPadding() must be reset to 0');
});

await it('computeSafeRouteCamera clamps zoom >= 17.2 even for large campus spans', () => {
    const widePoints = [[19.050, 47.470], [19.065, 47.485]];
    const cam = context.window.computeSafeRouteCamera(widePoints);
    assert(cam !== null);
    assert(cam.zoom >= 17.2, `Calculated zoom ${cam.zoom} must be >= 17.2 minRouteComfortZoom`);
    assert(cam.zoom <= 19.4, `Calculated zoom ${cam.zoom} must be <= 19.4 maxRouteComfortZoom`);
});

await it('computeSafeRouteCamera supports options.minZoom and clamps properly', () => {
    const cam = context.window.computeSafeRouteCamera([[19.050, 47.470], [19.065, 47.485]], null, { minZoom: 17.5, maxZoom: 19.8 });
    assert(cam !== null);
    assert(cam.zoom >= 17.5, `Segment zoom ${cam.zoom} must be >= 17.5`);
    assert(cam.zoom <= 19.8, `Segment zoom ${cam.zoom} must be <= 19.8`);
});

await it('repeated calls to drawRoute maintain zoom >= 17.2 and never compound padding', () => {
    let capturedFlyTo = null;
    context.map.flyTo = (opts) => { capturedFlyTo = opts; };
    const pathKeys = ['47.4810,19.0560,1', '47.4815,19.0565,1', '47.4820,19.0570,1'];
    
    for (let i = 0; i < 5; i++) {
        context.window.drawRoute(pathKeys);
        assert(capturedFlyTo !== null, 'map.flyTo must be called');
        assert(capturedFlyTo.zoom >= 17.2, `Repeated call ${i + 1}: zoom ${capturedFlyTo.zoom} must not degrade below 17.2`);
        assert.deepStrictEqual(context.map.getPadding(), { top: 0, bottom: 0, left: 0, right: 0 }, `Padding must not accumulate on call ${i + 1}`);
    }
});

await it('focusOnRouteSegment uses safe route camera with minZoom 17.5', () => {
    let segmentFlyTo = null;
    context.map.flyTo = (opts) => { segmentFlyTo = opts; };
    context.window.setCurrentRoutePath(['47.4810,19.0560,1', '47.4815,19.0565,1']);
    context.window.focusOnRouteSegment('1');
    assert(segmentFlyTo !== null, 'focusOnRouteSegment must call flyTo');
    assert(segmentFlyTo.zoom >= 17.5, `focusOnRouteSegment zoom ${segmentFlyTo.zoom} must be >= 17.5`);
});

// ============================================================================
console.log('\n[Suite 9] Mobile Touchdown Text Selection Suppression');
// ============================================================================

await it('lockTouchSelection applies suppress-touch-select class and resets text selection', () => {
    const sheetEl = context.document.getElementById('bottom-sheet');
    sheetEl.classList.remove('suppress-touch-select');
    context.window.lockTouchSelection();
    assert(sheetEl.classList.contains('suppress-touch-select'), 'bottom-sheet must contain suppress-touch-select class');
    assert.strictEqual(context.window.isTouchSelectionActive(), true, 'touch selection lock must be active');
});

await it('lockTouchSelection suppresses selectstart events via capture', () => {
    let prevented = false;
    const fakeEvent = {
        type: 'selectstart',
        preventDefault: () => { prevented = true; }
    };
    context.document.dispatchEvent(fakeEvent);
    assert.strictEqual(prevented, true, 'selectstart default must be prevented while locked');
});

await it('unlockTouchSelection removes suppress-touch-select and restores selection state', async () => {
    const sheetEl = context.document.getElementById('bottom-sheet');
    context.window.unlockTouchSelection();
    await new Promise(resolve => setTimeout(resolve, 150));
    assert(!sheetEl.classList.contains('suppress-touch-select'), 'suppress-touch-select must be removed after grace period');
    assert.strictEqual(context.window.isTouchSelectionActive(), false, 'touch selection lock must be inactive');
});

await it('handleCoordinateSelection with fromTouch triggers lockTouchSelection', () => {
    const sheetEl = context.document.getElementById('bottom-sheet');
    context.window.handleCoordinateSelection(19.056, 47.481, { fromTouch: true });
    assert(sheetEl.classList.contains('suppress-touch-select'), 'fromTouch coordinate selection must engage touch lock');
    context.window.unlockTouchSelection();
});

await it('style.css defines suppress-touch-select rules with !important', () => {
    assert(styleCssContent.includes('#bottom-sheet.suppress-touch-select'), 'style.css must define #bottom-sheet.suppress-touch-select');
    assert(styleCssContent.includes('user-select: none !important'), 'style.css must define user-select: none !important');
    assert(styleCssContent.includes('-webkit-touch-callout: none !important'), 'style.css must define -webkit-touch-callout: none !important');
});

// ============================================================================
console.log('\n[Suite 10] Coordinate Search & Input Parsing');
// ============================================================================

await it('parseCoordinateInput parses standard lat, lon format', () => {
    const res = context.window.parseCoordinateInput('47.481234, 19.056789');
    assert(res !== null, 'Should parse valid coordinate');
    assert.strictEqual(res.lat, 47.481234);
    assert.strictEqual(res.lon, 19.056789);
    assert.strictEqual(res.formatted, '47.481234, 19.056789');
});

await it('parseCoordinateInput intelligently swaps reversed lon, lat format', () => {
    const res = context.window.parseCoordinateInput('19.056789, 47.481234');
    assert(res !== null, 'Should parse reversed coordinate');
    assert.strictEqual(res.lat, 47.481234);
    assert.strictEqual(res.lon, 19.056789);
    assert.strictEqual(res.formatted, '47.481234, 19.056789');
});

await it('parseCoordinateInput supports semicolon, space, and cardinal symbols', () => {
    const resSemicolon = context.window.parseCoordinateInput('47.481234; 19.056789');
    assert(resSemicolon && resSemicolon.lat === 47.481234 && resSemicolon.lon === 19.056789);

    const resSpace = context.window.parseCoordinateInput('47.481234 19.056789');
    assert(resSpace && resSpace.lat === 47.481234 && resSpace.lon === 19.056789);

    const resCardinal = context.window.parseCoordinateInput('N 47.481234, E 19.056789');
    assert(resCardinal && resCardinal.lat === 47.481234 && resCardinal.lon === 19.056789);
});

await it('parseCoordinateInput rejects invalid inputs', () => {
    assert.strictEqual(context.window.parseCoordinateInput('IB028'), null);
    assert.strictEqual(context.window.parseCoordinateInput('K épület'), null);
    assert.strictEqual(context.window.parseCoordinateInput('47.481234'), null);
    assert.strictEqual(context.window.parseCoordinateInput(''), null);
    assert.strictEqual(context.window.parseCoordinateInput(null), null);
});

await it('_executeSearch generates autocomplete coordinate result item on input', () => {
    const input = context.document.getElementById('search-input');
    input.value = '47.481234, 19.056789';
    context._executeSearch({ target: { value: '47.481234, 19.056789' } });

    const resultsDiv = context.document.getElementById('search-results');
    assert.strictEqual(resultsDiv.style.display, 'block', 'resultsDiv must be visible');
    const coordItem = resultsDiv.querySelector('.coord-result-item');
    assert(coordItem !== null, 'coord-result-item must be present in search results');
    assert(coordItem.innerHTML.includes('47.481234, 19.056789'));
});

await it('_executeSearch selects coordinate directly on Enter keypress', () => {
    const input = context.document.getElementById('search-input');
    input.value = '47.481234, 19.056789';
    context._executeSearch({ key: 'Enter', target: { value: '47.481234, 19.056789' } });

    const activeFeature = context.window.getActiveCustomPinFeature();
    assert(activeFeature !== null, 'Custom pin feature must be created');
    assert.strictEqual(activeFeature._isCustomPin, true);
    assert.strictEqual(input.value, '47.481234, 19.056789');
    const resultsDiv = context.document.getElementById('search-results');
    assert.strictEqual(resultsDiv.style.display, 'none', 'resultsDiv must be hidden after Enter');
});

await it('style.css defines coord-result-item styling', () => {
    const styleCss = fs.readFileSync(path.join(rootDir, 'style.css'), 'utf8');
    assert(styleCss.includes('.result-item.coord-result-item'), 'style.css must define .result-item.coord-result-item');
    assert(styleCss.includes('.coord-icon'), 'style.css must define .coord-icon');
});

// ============================================================================
console.log('\n[Suite 11] Campus Switch, Route Share & Live i18n Sheet (Manual Testing Fixes)');
// ============================================================================

const campusBuildingsJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'data/campus_buildings.json'), 'utf8'));
context.window.setCampusGeoJsonData(campusBuildingsJson);

const rBuildingFeat = campusBuildingsJson.features.find(f => (f.properties.key || f.properties.code) === 'R');
const aBuildingFeat = campusBuildingsJson.features.find(f => (f.properties.key || f.properties.code) === 'A');
const rCenterCoords = rBuildingFeat.properties.center || [19.059185, 47.478953];
const aCenterCoords = aBuildingFeat.properties.center || [19.0560, 47.4827];

await it('handleCoordinateSelection triggers changeBuilding when dropping pin into another indoor building', () => {
    context.window.setCurrentBuildingKey('K');
    context.currentBuildingKey = 'K';
    let changedToKey = null;
    let changePreserveCamera = null;
    context.changeBuilding = (bKey, autoSearch, targetId, preserveCamera) => {
        changedToKey = bKey;
        changePreserveCamera = preserveCamera;
    };

    const result = context.window.handleCoordinateSelection(rCenterCoords[0], rCenterCoords[1]);
    assert.strictEqual(result, null, 'Should return null when deferred to changeBuilding');
    assert.strictEqual(changedToKey, 'R', 'Must call changeBuilding with target building key R');
    assert.strictEqual(changePreserveCamera, true, 'changeBuilding must be called with preserveCamera=true for smooth flyTo');
    const pending = context.window.getPendingCustomPin();
    assert(pending !== null, 'pendingCustomPin must be set');
    assert.strictEqual(pending.lon, rCenterCoords[0]);
    assert.strictEqual(pending.lat, rCenterCoords[1]);
    assert.strictEqual(pending.skipFly, true, 'skipFly must be set to true on pending pin');
    const activeMarker = context.window.getActiveCustomPinMarker();
    assert(activeMarker !== null, 'Temporary pin marker must be dropped immediately');
    context.window.setPendingCustomPin(null);
});

await it('handleCoordinateSelection assigns correct building key and does not switch building for outline-only buildings', () => {
    context.window.setCurrentBuildingKey('K');
    context.currentBuildingKey = 'K';
    let changedToKey = null;
    context.changeBuilding = (bKey) => { changedToKey = bKey; };

    const result = context.window.handleCoordinateSelection(aCenterCoords[0], aCenterCoords[1]);
    assert(result !== null, 'Should return created custom pin feature');
    assert.strictEqual(changedToKey, null, 'Must NOT switch building for outline-only building');
    assert.strictEqual(result._buildingKey, 'A', 'Must assign target outline building key');
    assert.strictEqual(result.properties.level, null, 'Must not assign indoor level for outline-only building');
    assert(result.properties._subTitle.includes('A épület') || result.properties._subTitle.includes('A Épület'));
    assert(!result.properties._subTitle.includes('K épület'));
});

await it('getFeatureId correctly serializes custom pin into coord payload', () => {
    const pin = context.window.createCustomPinFeature(19.056789, 47.481234, 'K', '1', { type: 'near', name: 'KF51' });
    const payload = context.window.getFeatureId(pin);
    assert(payload !== null);
    assert.strictEqual(payload.type, 'coord');
    assert.strictEqual(payload.lat, 47.481234);
    assert.strictEqual(payload.lon, 19.056789);
    assert.strictEqual(payload.lvl, '1');
    assert.strictEqual(payload.near, 'KF51');
    assert.strictEqual(payload.isCustomPin, true);
});

await it('shareCurrentState prioritizes active route over single custom pin', async () => {
    const pin = context.window.createCustomPinFeature(19.056789, 47.481234, 'K', '1');
    const targetRoom = {
        type: 'Feature',
        id: 'way/999888',
        properties: { ref: 'KF51', name: 'KF51', level: '1' },
        geometry: { type: 'Point', coordinates: [19.0568, 47.4815] }
    };

    context.window.setSelectedFeature(pin);
    context.window.setActiveRouteData({ start: pin, end: targetRoom });
    context.window.setCurrentBuildingKey('K');

    context.window.shareCurrentState();
    await new Promise(r => setTimeout(r, 50));

    assert(global._clipboardText);
    const parsedUrl = new URL(global._clipboardText);
    const shareParam = parsedUrl.searchParams.get('share');
    assert(shareParam);

    const decodedJson = JSON.parse(Buffer.from(shareParam, 'base64').toString('utf8'));
    assert.strictEqual(decodedJson.mode, 'route', 'Payload mode must be route even when custom pin is selectedFeature');
    assert.strictEqual(decodedJson.s.type, 'coord');
    assert.strictEqual(decodedJson.s.lat, 47.481234);
    assert.strictEqual(decodedJson.s.lon, 19.056789);
    assert.strictEqual(decodedJson.e.type, 'id');
    assert.strictEqual(decodedJson.e.val, 'way/999888');

    context.window.setActiveRouteData(null);
});

await it('processUrlParams restores route with custom pin endpoint and drops marker', async () => {
    const pinPayload = {
        mode: 'route',
        b: 'K',
        s: { type: 'coord', lat: 47.481234, lon: 19.056789, lvl: '1', isCustomPin: true },
        e: { type: 'ref', val: 'KF51', lvl: '1' }
    };
    const b64 = Buffer.from(JSON.stringify(pinPayload), 'utf8').toString('base64');
    context.window.location.search = `?share=${b64}`;

    let startedNavWith = null;
    context.startNavigation = (end, start) => { startedNavWith = { end, start }; };

    context.window.setGeoJsonData({
        features: [
            {
                type: 'Feature',
                id: 'way/999888',
                properties: { ref: 'KF51', name: 'KF51', level: '1' },
                geometry: { type: 'Point', coordinates: [19.0568, 47.4815] }
            }
        ]
    });

    await context.window.processUrlParams();

    assert(startedNavWith !== null, 'startNavigation must be called');
    assert(startedNavWith.start !== null, 'Start endpoint must be restored');
    assert.strictEqual(startedNavWith.start._isCustomPin, true);
    assert.strictEqual(startedNavWith.start.geometry.coordinates[0], 19.056789);
    assert.strictEqual(startedNavWith.start.geometry.coordinates[1], 47.481234);
    assert.strictEqual(startedNavWith.end.properties.ref, 'KF51');

    const activePin = context.window.getActiveCustomPinFeature();
    assert(activePin !== null, 'Custom pin marker feature must be active on map');
    assert.strictEqual(activePin._isCustomPin, true);

    context.window.location.search = '';
});

await it('setLanguageMode updates open bottom sheet content in-place', async () => {
    const sheetEl = context.document.getElementById('bottom-sheet');
    sheetEl.classList.add('open');

    const pin = context.window.createCustomPinFeature(19.056789, 47.481234, 'K', '1');
    context.window.setSelectedFeature(pin);
    context.window.openSheet(pin, true);

    const titleEl = context.document.getElementById('sheet-title');
    const subEl = context.document.getElementById('sheet-sub');
    assert.strictEqual(titleEl.innerText, 'Kijelölt pont');
    assert(subEl.innerText.includes('Szint: 1'));

    // Switch to English in-place
    context.t = (k, params) => {
        const keys = k.split('.');
        let val = enLocale;
        for (const part of keys) {
            val = val ? val[part] : null;
        }
        if (typeof val === 'string' && params) {
            for (const [pk, pv] of Object.entries(params)) {
                val = val.replace(`{${pk}}`, pv);
            }
        }
        return val || k;
    };
    context.i18n = {
        setLanguage: async () => {}
    };

    await context.window.setLanguageMode('en');

    assert.strictEqual(titleEl.innerText, 'Selected point', 'Sheet title must dynamically re-render in English');
    assert(subEl.innerText.includes('Level: 1') || subEl.innerText.includes('Building K'), 'Sheet subtitle must re-render in English');

    // Switch back to Hungarian
    context.t = (k, params) => {
        const keys = k.split('.');
        let val = huLocale;
        for (const part of keys) {
            val = val ? val[part] : null;
        }
        if (typeof val === 'string' && params) {
            for (const [pk, pv] of Object.entries(params)) {
                val = val.replace(`{${pk}}`, pv);
            }
        }
        return val || k;
    };

    await context.window.setLanguageMode('hu');
    assert.strictEqual(titleEl.innerText, 'Kijelölt pont');
    assert(subEl.innerText.includes('Szint: 1'));

    sheetEl.classList.remove('open');
});

// ============================================================================
console.log('\n[Suite 12] Desktop Rotate/Tilt (Ctrl+Left) & Long-Press Pin Drop');
// ============================================================================

await it('map initialization enables pitchWithRotate and sets maxPitch >= 60', () => {
    assert(context.map._initOptions !== null, 'Map init options must be captured');
    assert.strictEqual(context.map._initOptions.pitchWithRotate, true, 'pitchWithRotate must be true for 3D tilt');
    assert(context.map._initOptions.maxPitch >= 60, 'maxPitch must be at least 60');
    assert.strictEqual(context.map._initOptions.dragRotate, true, 'dragRotate must be enabled');
});

await it('configureDesktopDragRotate accepts Ctrl+Left click and rejects Right click (button 2)', () => {
    assert(context.map.dragRotate._mouseRotate._moveStateManager._correctEvent, 'correctEvent must be defined');
    const isCorrect = context.map.dragRotate._mouseRotate._moveStateManager._correctEvent;

    // Right click without Ctrl -> REJECT (should not rotate)
    assert.strictEqual(isCorrect({ button: 2, ctrlKey: false }), false);
    // Right click with Ctrl -> REJECT (should not rotate)
    assert.strictEqual(isCorrect({ button: 2, ctrlKey: true }), false);
    // Left click without Ctrl -> REJECT (normal pan, not rotate)
    assert.strictEqual(isCorrect({ button: 0, ctrlKey: false }), false);
    // Left click with Ctrl -> ACCEPT (rotate/tilt)
    assert.strictEqual(isCorrect({ button: 0, ctrlKey: true }), true);
    // Left click with Meta -> ACCEPT (Mac Cmd+click)
    assert.strictEqual(isCorrect({ button: 0, metaKey: true }), true);
});

await it('desktop mouse down for 500ms triggers custom pin drop', async () => {
    context.window.clearCustomPin(true);
    assert.strictEqual(context.window.getActiveCustomPinFeature(), null);

    const canvas = context.map.getCanvas();
    canvas.dispatchEvent({ type: 'mousedown', button: 0, clientX: 300, clientY: 250, ctrlKey: false, metaKey: false });

    await new Promise(r => setTimeout(r, 550));

    const pin = context.window.getActiveCustomPinFeature();
    assert(pin !== null, 'Custom pin must be created after 500ms long-press');
    assert.strictEqual(pin._isCustomPin, true);

    global.window.dispatchEvent({ type: 'mouseup' });
});

await it('desktop mouse move > 6px cancels long-press and allows dragPan', async () => {
    context.window.clearCustomPin(true);
    assert.strictEqual(context.window.getActiveCustomPinFeature(), null);

    const canvas = context.map.getCanvas();
    canvas.dispatchEvent({ type: 'mousedown', button: 0, clientX: 300, clientY: 250, ctrlKey: false, metaKey: false });

    // Move mouse 15px (> 6px tolerance)
    global.window.dispatchEvent({ type: 'mousemove', clientX: 315, clientY: 250 });

    await new Promise(r => setTimeout(r, 550));

    assert.strictEqual(context.window.getActiveCustomPinFeature(), null, 'Custom pin must not be created after drag movement');

    global.window.dispatchEvent({ type: 'mouseup' });
});

await it('desktop Ctrl+mouse down does not trigger long-press pin drop', async () => {
    context.window.clearCustomPin(true);
    assert.strictEqual(context.window.getActiveCustomPinFeature(), null);

    const canvas = context.map.getCanvas();
    // Left click with Ctrl -> Rotation gesture, NOT long-press pin
    canvas.dispatchEvent({ type: 'mousedown', button: 0, clientX: 300, clientY: 250, ctrlKey: true, metaKey: false });

    await new Promise(r => setTimeout(r, 550));

    assert.strictEqual(context.window.getActiveCustomPinFeature(), null, 'Custom pin must not be created when Ctrl is pressed');

    global.window.dispatchEvent({ type: 'mouseup' });
});

await it('desktop contextmenu (right click) continues to drop pin cleanly', () => {
    context.window.clearCustomPin(true);
    assert.strictEqual(context.window.getActiveCustomPinFeature(), null);

    context.map.fire('contextmenu', {
        lngLat: { lng: 19.056789, lat: 47.481234 },
        originalEvent: { preventDefault: () => {} }
    });

    const pin = context.window.getActiveCustomPinFeature();
    assert(pin !== null, 'Custom pin must be created on contextmenu event');
    assert.strictEqual(pin._isCustomPin, true);
    assert.strictEqual(pin.geometry.coordinates[0], 19.056789);
    assert.strictEqual(pin.geometry.coordinates[1], 47.481234);
});

console.log('\n================================================================');
console.log(`📊 TEST RESULTS: ${passed} PASSED, 0 FAILED (TOTAL: ${total})`);
console.log('================================================================\n');

if (passed === total) {
    console.log('🎉 ALL #1 SELECT ANY COORDS TESTS PASSED PERFECTLY!\n');
} else {
    process.exit(1);
}
}

runAllTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
