#!/usr/bin/env node

/**
 * inject-version.js
 * Automatically determines application version and injects cache-busting version strings into:
 * 1. index.html: href="style.css?v=..."
 * 2. index.html: const APP_VERSION = '...'
 * 3. index.html: src="i18n.js?v=..."
 * 4. index.html: src="room_data.js?v=..."
 * 5. index.html: src="app.js?v=..."
 * 6. sw.js: const CACHE_NAME = 'bmemap-shell-v...'
 *
 * Strict integrity validation ensures all 6 replacements succeed atomically.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Normalize and validate a version string.
 * Strips leading 'v' or 'V' (e.g. 'v182' -> '182') and validates that
 * the version contains only safe characters (alphanumeric, dot, underscore, hyphen).
 *
 * @param {string|number} rawVersion
 * @returns {string}
 */
function normalizeVersion(rawVersion) {
    if (rawVersion === null || rawVersion === undefined) {
        throw new Error('Version cannot be null or undefined');
    }
    const str = String(rawVersion).trim();
    if (!str) {
        throw new Error('Version cannot be empty');
    }

    // Strip leading 'v' or 'V'
    const normalized = str.replace(/^v/i, '');
    if (!normalized) {
        throw new Error(`Invalid version format: "${rawVersion}"`);
    }

    // Safety check: only allow safe characters (alphanumeric, dot, underscore, hyphen)
    // Prevents accidental or malicious script injection into HTML/JS
    if (!/^[a-zA-Z0-9._-]+$/.test(normalized)) {
        throw new Error(
            `Invalid version format: "${rawVersion}". ` +
            `Version must contain only alphanumeric characters, dots, underscores, or hyphens.`
        );
    }

    return normalized;
}

/**
 * Determine version string based on:
 * 1. Explicit version argument if provided
 * 2. Git commit count (`git rev-list --count HEAD`), handling shallow clones if on CI
 * 3. Fallback numeric timestamp (Unix epoch in seconds)
 *
 * @param {string} [repoRoot]
 * @param {string|number} [explicitVersion]
 * @returns {string}
 */
function resolveVersion(repoRoot = path.resolve(__dirname, '..'), explicitVersion = null) {
    // 1. Explicit version argument
    if (explicitVersion !== null && explicitVersion !== undefined && String(explicitVersion).trim() !== '') {
        return normalizeVersion(explicitVersion);
    }

    // 2. Git commit count
    try {
        let isShallow = false;
        try {
            const shallowOutput = execSync('git rev-parse --is-shallow-repository', {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            }).trim();
            isShallow = (shallowOutput === 'true');
        } catch (shallowCheckErr) {
            // Not a git repository or git rev-parse failed
        }

        // If repo is shallow (common in CI environments like Cloudflare Pages), attempt to unshallow
        if (isShallow) {
            try {
                execSync('git fetch --unshallow --filter=blob:none', {
                    cwd: repoRoot,
                    stdio: ['pipe', 'pipe', 'ignore']
                });
            } catch (filterErr) {
                try {
                    execSync('git fetch --unshallow', {
                        cwd: repoRoot,
                        stdio: ['pipe', 'pipe', 'ignore']
                    });
                } catch (unshallowErr) {
                    // Fetch failed (network or auth issue)
                }
            }

            // Re-verify if still shallow after fetch attempts
            try {
                const shallowCheckAfter = execSync('git rev-parse --is-shallow-repository', {
                    cwd: repoRoot,
                    encoding: 'utf8',
                    stdio: ['pipe', 'pipe', 'ignore']
                }).trim();
                isShallow = (shallowCheckAfter === 'true');
            } catch (e) {
                isShallow = true;
            }

            if (isShallow) {
                console.warn('[inject-version] Warning: Repository remains shallow; git commit count would be incomplete.');
            }
        }

        // Only use git rev-list if we have the full history
        if (!isShallow) {
            const count = execSync('git rev-list --count HEAD', {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'ignore']
            }).trim();

            if (/^\d+$/.test(count) && parseInt(count, 10) > 0) {
                return count;
            }
        }
    } catch (gitErr) {
        // Git command failed or git not available
    }

    // 3. Fallback: numeric timestamp in seconds
    const fallback = String(Math.floor(Date.now() / 1000));
    console.log(`[inject-version] Using numeric timestamp fallback: ${fallback}`);
    return fallback;
}

/**
 * Apply replacement rules to file content with strict integrity validation.
 *
 * @param {string} filePath
 * @param {string} originalContent
 * @param {Array<{name: string, regex: RegExp}>} rules
 * @param {string} targetVersion
 * @returns {{updated: string, details: Array<{name: string, oldVersion: string, newVersion: string}>}}
 */
function applyRules(filePath, originalContent, rules, targetVersion) {
    const fileName = path.basename(filePath);

    // 1. Pre-validation pass (read-only): ensure each rule matches exactly once in original content
    const preMatches = [];
    for (const rule of rules) {
        const pattern = new RegExp(rule.regex.source, 'g');
        const matches = [...originalContent.matchAll(pattern)];

        if (matches.length !== 1) {
            throw new Error(
                `Integrity check failed for ${fileName} [${rule.name}]: ` +
                `expected exactly 1 match in original file, found ${matches.length}`
            );
        }

        preMatches.push({ rule, match: matches[0] });
    }

    // 2. Replacement pass: apply replacements using function callbacks to prevent '$' interpretation
    let currentContent = originalContent;
    const details = [];

    for (const { rule, match } of preMatches) {
        const oldVersion = match[2];
        const replaceRegex = new RegExp(rule.regex.source, 'g');

        currentContent = currentContent.replace(
            replaceRegex,
            (fullMatch, p1, p2, p3) => `${p1}${targetVersion}${p3}`
        );

        details.push({
            name: rule.name,
            oldVersion,
            newVersion: targetVersion
        });
    }

    // 3. Post-validation pass: ensure each rule matches exactly once in updated content and reflects targetVersion
    for (const rule of rules) {
        const verifyPattern = new RegExp(rule.regex.source, 'g');
        const matches = [...currentContent.matchAll(verifyPattern)];

        if (matches.length !== 1) {
            throw new Error(
                `Post-replacement validation failed for ${fileName} [${rule.name}]: ` +
                `expected exactly 1 match after replacement, found ${matches.length}`
            );
        }

        if (matches[0][2] !== targetVersion) {
            throw new Error(
                `Post-replacement validation failed for ${fileName} [${rule.name}]: ` +
                `expected version "${targetVersion}", but found "${matches[0][2]}"`
            );
        }
    }

    return { updated: currentContent, details };
}

/**
 * Execute version injection across index.html and sw.js.
 *
 * @param {string|number} [customVersion]
 * @param {object} [options]
 * @param {string} [options.repoRoot]
 * @param {boolean} [options.dryRun]
 * @returns {{version: string, totalReplacements: number, details: Array}}
 */
function injectVersion(customVersion, options = {}) {
    const repoRoot = options.repoRoot || path.resolve(__dirname, '..');
    const version = (customVersion !== undefined && customVersion !== null && String(customVersion).trim() !== '')
        ? normalizeVersion(customVersion)
        : resolveVersion(repoRoot);

    if (!version) {
        throw new Error('Target version could not be resolved or is empty');
    }

    const indexPath = path.join(repoRoot, 'index.html');
    const swPath = path.join(repoRoot, 'sw.js');

    if (!fs.existsSync(indexPath)) {
        throw new Error(`Target file does not exist: ${indexPath}`);
    }
    if (!fs.existsSync(swPath)) {
        throw new Error(`Target file does not exist: ${swPath}`);
    }

    const indexContent = fs.readFileSync(indexPath, 'utf8');
    const swContent = fs.readFileSync(swPath, 'utf8');

    const htmlRules = [
        {
            name: 'style.css cache buster',
            regex: /(href=["']style\.css\?v=)([^"'\s]+)(["'])/g
        },
        {
            name: 'APP_VERSION constant',
            regex: /(const\s+APP_VERSION\s*=\s*['"])([^'"]+)(['"];?)/g
        },
        {
            name: 'i18n.js cache buster',
            regex: /(src=["']i18n\.js\?v=)([^"'\s]+)(["'])/g
        },
        {
            name: 'room_data.js cache buster',
            regex: /(src=["']room_data\.js\?v=)([^"'\s]+)(["'])/g
        },
        {
            name: 'app.js cache buster',
            regex: /(src=["']app\.js\?v=)([^"'\s]+)(["'])/g
        }
    ];

    const swRules = [
        {
            name: 'CACHE_NAME constant',
            regex: /(const\s+CACHE_NAME\s*=\s*['"]bmemap-shell-v)([^'"]+)(['"];?)/g
        }
    ];

    const { updated: newIndexContent, details: indexDetails } = applyRules(indexPath, indexContent, htmlRules, version);
    const { updated: newSwContent, details: swDetails } = applyRules(swPath, swContent, swRules, version);

    const allDetails = [...indexDetails, ...swDetails];

    if (allDetails.length !== 6) {
        throw new Error(`Integrity check failed: Expected 6 replacements total, but got ${allDetails.length}`);
    }

    // Atomic write only after all validations for all files pass
    if (!options.dryRun) {
        fs.writeFileSync(indexPath, newIndexContent, 'utf8');
        fs.writeFileSync(swPath, newSwContent, 'utf8');
    }

    console.log(`[inject-version] Target version: ${version}`);
    console.log(`[inject-version] index.html updated (5 targets):`);
    for (const d of indexDetails) {
        console.log(`  - ${d.name}: ${d.oldVersion} -> ${d.newVersion}`);
    }
    console.log(`[inject-version] sw.js updated (1 target):`);
    for (const d of swDetails) {
        console.log(`  - ${d.name}: ${d.oldVersion} -> ${d.newVersion}`);
    }

    return {
        version,
        totalReplacements: allDetails.length,
        details: allDetails
    };
}

// CLI execution
if (require.main === module) {
    try {
        const cliArg = process.argv[2];
        const result = injectVersion(cliArg);
        console.log(`[inject-version] SUCCESS: All ${result.totalReplacements} cache-busting targets updated to v${result.version}.`);
    } catch (err) {
        console.error(`[inject-version] FATAL ERROR: ${err.message}`);
        process.exit(1);
    }
}

module.exports = {
    normalizeVersion,
    resolveVersion,
    applyRules,
    injectVersion
};
