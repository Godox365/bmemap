/**
 * BMEmap I18n Engine
 * Robusztus, fallback-biztos többnyelvűsítő motor Vanilla JavaScripthez.
 */
class I18nManager {
    constructor() {
        this.defaultLanguage = 'hu';
        this.currentLanguage = 'hu';
        this.supportedLanguages = ['hu', 'en'];
        this.translations = {};          // Aktuális nyelv szótára
        this.fallbackTranslations = {};  // Alapértelmezett (HU) szótár
        this.isLoaded = false;
        this._initPromise = null;
    }

    /**
     * Intelligens nyelvfelismerés prioritási lánc alapján:
     * 1. URL Path (/en, /hu, /en/, /hu/)
     * 2. URL Query (?lang=en, ?l=en)
     * 3. URL Hash (#/en, #/hu, #lang=en)
     * 4. Helyi mentett preferencia (localStorage)
     * 5. Böngésző nyelve (navigator.language)
     * 6. Alapértelmezett nyelv (hu)
     */
    detectLanguage() {
        if (typeof window !== 'undefined' && window.location) {
            // 1. URL Path: pl. /en vagy /hu
            const pathParts = window.location.pathname.split('/').filter(Boolean);
            if (pathParts.length > 0) {
                const first = pathParts[0].toLowerCase();
                if (this.supportedLanguages.includes(first)) {
                    return first;
                }
            }

            // 2. URL Query: ?lang=en vagy ?l=en
            const urlParams = new URLSearchParams(window.location.search);
            const urlLang = urlParams.get('lang') || urlParams.get('l');
            if (urlLang && this.supportedLanguages.includes(urlLang.toLowerCase())) {
                return urlLang.toLowerCase();
            }

            // 3. URL Hash: #/en, #/hu, #lang=en
            if (window.location.hash) {
                const hash = window.location.hash.toLowerCase();
                const hashMatch = hash.match(/#(?:lang=|\/)?([a-z]{2})/i);
                if (hashMatch && this.supportedLanguages.includes(hashMatch[1])) {
                    return hashMatch[1];
                }
            }
        }

        // 4. Mentett felhasználói beállítás
        try {
            const savedLang = localStorage.getItem('pref_language');
            if (savedLang && this.supportedLanguages.includes(savedLang.toLowerCase())) {
                return savedLang.toLowerCase();
            }
        } catch (e) { /* ignore */ }

        // 5. Böngésző nyelve
        if (typeof navigator !== 'undefined') {
            const browserLang = (navigator.language || navigator.userLanguage || '').slice(0, 2).toLowerCase();
            if (this.supportedLanguages.includes(browserLang)) {
                return browserLang;
            }
        }

        // 6. Alapértelmezett nyelv
        return this.defaultLanguage;
    }

    /**
     * Inicializálja a nyelvi modult: detektálja a nyelvet és betölti a szótárakat.
     */
    async init() {
        if (this._initPromise) return this._initPromise;

        this._initPromise = (async () => {
            const targetLang = this.detectLanguage();

            // 1. Alapértelmezett (HU) szótár betöltése fallback gyanánt
            this.fallbackTranslations = await this._fetchDictionary(this.defaultLanguage);

            // 2. Kívánt nyelv beállítása
            await this.setLanguage(targetLang, false, false);
            this.isLoaded = true;
        })();

        return this._initPromise;
    }

    async _fetchDictionary(lang) {
        try {
            const v = typeof APP_VERSION !== 'undefined' ? APP_VERSION : '1';
            const res = await fetch(`locales/${lang}.json?v=${v}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            console.error(`[i18n] Nem sikerült betölteni a(z) "${lang}" szótárat:`, err);
            return {};
        }
    }

    /**
     * Szinkronizálja a böngésző címsorát (URL) a választott nyelvvel (oldalújratöltés nélkül).
     */
    _updateUrl(lang) {
        if (typeof window === 'undefined' || !window.history || !window.history.replaceState) return;

        try {
            const url = new URL(window.location.href);
            const pathParts = url.pathname.split('/').filter(Boolean);

            if (pathParts.length > 0 && this.supportedLanguages.includes(pathParts[0].toLowerCase())) {
                // Ha eredetileg /en vagy /hu volt az útvonal
                if (lang === this.defaultLanguage && pathParts.length === 1) {
                    url.pathname = '/';
                } else {
                    pathParts[0] = lang;
                    url.pathname = '/' + pathParts.join('/') + (url.pathname.endsWith('/') ? '/' : '');
                }
            } else if (lang !== this.defaultLanguage) {
                // Ha nem az alapértelmezett nyelv, és a gyökéren voltunk
                url.pathname = '/' + lang + (url.pathname === '/' ? '/' : url.pathname);
            }

            // Ha volt ?lang= vagy ?l= a keresési paraméterekben, szinkronizáljuk
            if (url.searchParams.has('lang')) {
                url.searchParams.set('lang', lang);
            }
            if (url.searchParams.has('l')) {
                url.searchParams.set('l', lang);
            }

            // Ha volt hash routing (pl. #/en vagy #lang=en), szinkronizáljuk
            if (url.hash && (url.hash.startsWith('#/en') || url.hash.startsWith('#/hu') || url.hash.startsWith('#lang='))) {
                url.hash = `/${lang}`;
            }

            window.history.replaceState(null, '', url.pathname + url.search + url.hash);
        } catch (e) {
            console.warn('[i18n] URL frissítési hiba:', e);
        }
    }

    /**
     * Nyelv beállítása és felület azonnali lefordítása.
     * @param {string} lang - Pl. 'hu' vagy 'en'
     * @param {boolean} [updateStorage=true]
     * @param {boolean} [updateUrl=true]
     */
    async setLanguage(lang, updateStorage = true, updateUrl = true) {
        if (!this.supportedLanguages.includes(lang)) {
            lang = this.defaultLanguage;
        }

        if (lang === this.defaultLanguage && Object.keys(this.fallbackTranslations).length > 0) {
            this.translations = this.fallbackTranslations;
        } else {
            this.translations = await this._fetchDictionary(lang);
        }

        this.currentLanguage = lang;
        if (updateStorage) {
            localStorage.setItem('pref_language', lang);
        }

        if (updateUrl) {
            this._updateUrl(lang);
        }

        // HTML attribútumok és meta tagek frissítése
        document.documentElement.lang = lang;
        this._updateMetaTags();

        // Felület (DOM) fordítása
        this.translateDOM();

        // Értesítés a komponensek felé (pl. térkép rétegek, keresési eredmények frissítése)
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang } }));
    }

    /**
     * Szöveg lekérése fordítási kulcs és opcionális helyettesítő paraméterek alapján.
     * @param {string} keyPath - Pl. 'settings.title' vagy 'toasts.building_detected'
     * @param {Object} [params={}] - Pl. { building: 'Q' }
     * @returns {string}
     */
    t(keyPath, params = {}) {
        if (!keyPath || typeof keyPath !== 'string') return '';

        let value = this._getValue(this.translations, keyPath);

        // Fallback ellenőrzés
        if (value === undefined) {
            value = this._getValue(this.fallbackTranslations, keyPath);
            if (value === undefined) {
                // Ha semelyik szótárban nincs benne, visszaadjuk a kulcsot
                return keyPath;
            }
        }

        // Dinamikus paraméterek behelyettesítése: {paramName}
        if (typeof value === 'string' && params && typeof params === 'object' && Object.keys(params).length > 0) {
            return value.replace(/\{(\w+)\}/g, (match, paramName) => {
                return params[paramName] !== undefined ? params[paramName] : match;
            });
        }

        return value;
    }

    _getValue(obj, path) {
        if (!obj || typeof obj !== 'object') return undefined;
        return path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined) ? acc[part] : undefined, obj);
    }

    _updateMetaTags() {
        const titleText = this.t('meta.title');
        if (titleText && titleText !== 'meta.title') {
            document.title = titleText;
        }

        const descText = this.t('meta.description');
        const metaDesc = document.querySelector('meta[name="description"]');
        if (descText && metaDesc && descText !== 'meta.description') {
            metaDesc.setAttribute('content', descText);
        }
    }

    /**
     * A DOM-ban lévő elemek fordítása data-i18n* attribútumok alapján.
     * @param {HTMLElement|Document} [rootElement=document]
     */
    translateDOM(rootElement = document) {
        // 1. TextContent: data-i18n="settings.title"
        rootElement.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translated = this.t(key);
            if (translated && translated !== key) {
                el.textContent = translated;
            }
        });

        // 2. Placeholder: data-i18n-placeholder="search.placeholder"
        rootElement.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const translated = this.t(key);
            if (translated && translated !== key) {
                el.placeholder = translated;
            }
        });

        // 3. Title / Tooltip: data-i18n-title="common.close"
        rootElement.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const translated = this.t(key);
            if (translated && translated !== key) {
                el.title = translated;
            }
        });

        // 4. Aria label: data-i18n-aria="common.close"
        rootElement.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria');
            const translated = this.t(key);
            if (translated && translated !== key) {
                el.setAttribute('aria-label', translated);
            }
        });

        // 5. HTML tartalom: data-i18n-html="some.formatted_key"
        rootElement.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            const translated = this.t(key);
            if (translated && translated !== key) {
                el.innerHTML = translated;
            }
        });
    }
}

// Globális singleton példány és t() segédfüggvény
const i18n = new I18nManager();
const t = (key, params) => i18n.t(key, params);

if (typeof window !== 'undefined') {
    window.i18n = i18n;
    window.t = t;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => i18n.init());
    } else {
        i18n.init();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { I18nManager, i18n, t };
}
