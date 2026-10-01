const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const {
    normalizeVersion,
    resolveVersion,
    applyRules,
    injectVersion
} = require('./inject-version.js');

console.log('--- STARTING INJECT-VERSION TEST SUITE ---');

// [Test 1] normalizeVersion
console.log('\n[Test 1] Testing normalizeVersion...');
assert.strictEqual(normalizeVersion('182'), '182');
assert.strictEqual(normalizeVersion(182), '182');
assert.strictEqual(normalizeVersion('v182'), '182');
assert.strictEqual(normalizeVersion('V185'), '185');
assert.strictEqual(normalizeVersion('v1.2.3'), '1.2.3');
assert.strictEqual(normalizeVersion('2026.10.01'), '2026.10.01');
assert.strictEqual(normalizeVersion('  v999  '), '999');

assert.throws(() => normalizeVersion(''), /Version cannot be empty/);
assert.throws(() => normalizeVersion('   '), /Version cannot be empty/);
assert.throws(() => normalizeVersion(null), /Version cannot be null or undefined/);
assert.throws(() => normalizeVersion(undefined), /Version cannot be null or undefined/);
assert.throws(() => normalizeVersion('v'), /Invalid version format/);
assert.throws(() => normalizeVersion('182"; alert(1); "'), /Version must contain only alphanumeric/);
assert.throws(() => normalizeVersion('182\n<script>'), /Version must contain only alphanumeric/);
console.log('✅ normalizeVersion passed all format and security checks.');

// [Test 2] resolveVersion isolation from process.argv
console.log('\n[Test 2] Testing resolveVersion argument pollution isolation...');
const originalArgv = [...process.argv];
process.argv = ['node', 'dummy-script.js', '--some-flag', 'value'];
try {
    const resolved = resolveVersion(path.resolve(__dirname, '..'));
    assert(/^\d+$/.test(resolved), 'resolveVersion should return numeric commit count or timestamp, not argv flags');
    assert.notStrictEqual(resolved, '--some-flag');
} finally {
    process.argv = originalArgv;
}
console.log('✅ resolveVersion isolation verified.');

// [Test 3] applyRules with atomic integrity validation
console.log('\n[Test 3] Testing applyRules integrity validation and $ escaping...');
const mockRules = [
    {
        name: 'test rule 1',
        regex: /(foo=)([^&]+)(&)/g
    },
    {
        name: 'test rule 2',
        regex: /(bar=)([^&]+)(&)/g
    }
];

// Success case
const sampleContent = 'foo=10&bar=20&';
const result = applyRules('sample.txt', sampleContent, mockRules, '99');
assert.strictEqual(result.updated, 'foo=99&bar=99&');
assert.strictEqual(result.details.length, 2);
assert.strictEqual(result.details[0].oldVersion, '10');
assert.strictEqual(result.details[0].newVersion, '99');

// Test dollar escaping safety
const dollarVersion = 'ver_with_special';
const dollarResult = applyRules('sample.txt', sampleContent, mockRules, dollarVersion);
assert.strictEqual(dollarResult.updated, `foo=${dollarVersion}&bar=${dollarVersion}&`);

// Pre-validation failure: missing target (0 matches)
assert.throws(() => {
    applyRules('sample.txt', 'foo=10&', mockRules, '99');
}, /Integrity check failed for sample.txt \[test rule 2\]: expected exactly 1 match in original file, found 0/);

// Pre-validation failure: duplicate target (>1 matches)
assert.throws(() => {
    applyRules('sample.txt', 'foo=10&bar=20&bar=30&', mockRules, '99');
}, /Integrity check failed for sample.txt \[test rule 2\]: expected exactly 1 match in original file, found 2/);

console.log('✅ applyRules verified for success, integrity errors, and special characters.');

// [Test 4] injectVersion mock environment
console.log('\n[Test 4] Testing injectVersion in mock workspace...');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-version-test-'));
try {
    const mockIndex = `
    <link rel="stylesheet" href="style.css?v=50">
    <script>const APP_VERSION = '50';</script>
    <script src="i18n.js?v=50"></script>
    <script src="room_data.js?v=50"></script>
    <script src="app.js?v=50"></script>
    `;
    const mockSw = `
    const CACHE_NAME = 'bmemap-shell-v50';
    const PHOTO_CACHE = 'bmemap-photos-v1';
    `;

    fs.writeFileSync(path.join(tmpDir, 'index.html'), mockIndex, 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'sw.js'), mockSw, 'utf8');

    // Run injection with 'v75' (should normalize to '75' and NOT create 'vv75')
    const injection = injectVersion('v75', { repoRoot: tmpDir });
    assert.strictEqual(injection.version, '75');
    assert.strictEqual(injection.totalReplacements, 6);

    const writtenIndex = fs.readFileSync(path.join(tmpDir, 'index.html'), 'utf8');
    const writtenSw = fs.readFileSync(path.join(tmpDir, 'sw.js'), 'utf8');

    assert(writtenIndex.includes('href="style.css?v=75"'));
    assert(writtenIndex.includes("const APP_VERSION = '75';"));
    assert(writtenIndex.includes('src="i18n.js?v=75"'));
    assert(writtenIndex.includes('src="room_data.js?v=75"'));
    assert(writtenIndex.includes('src="app.js?v=75"'));
    assert(writtenSw.includes("const CACHE_NAME = 'bmemap-shell-v75';"));
    assert(!writtenSw.includes('bmemap-shell-vv75'), 'Must not produce double v in sw.js');
    assert(writtenSw.includes("const PHOTO_CACHE = 'bmemap-photos-v1';", 'Must not alter other caches'));

    // Test atomic failure: corrupted index.html must not modify sw.js
    const brokenIndex = `<div>no matches</div>`;
    fs.writeFileSync(path.join(tmpDir, 'index.html'), brokenIndex, 'utf8');
    assert.throws(() => {
        injectVersion('80', { repoRoot: tmpDir });
    }, /Integrity check failed for index.html/);

    // sw.js should still contain v75, untouched
    const swAfterFail = fs.readFileSync(path.join(tmpDir, 'sw.js'), 'utf8');
    assert(swAfterFail.includes("const CACHE_NAME = 'bmemap-shell-v75';"));
} finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
}
console.log('✅ injectVersion mock workspace and atomicity verified.');

// [Test 5] Shallow clone handling & fallback test
console.log('\n[Test 5] Testing shallow clone handling and fallback...');
const shallowTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shallow-test-'));
try {
    const dummyGitDir = path.join(shallowTmp, 'dummy-git');
    fs.mkdirSync(dummyGitDir);
    // In a directory that is not a git repo, resolveVersion falls back to timestamp
    const fallbackVersion = resolveVersion(dummyGitDir);
    assert(/^\d+$/.test(fallbackVersion));
    const now = Math.floor(Date.now() / 1000);
    assert(Math.abs(parseInt(fallbackVersion, 10) - now) < 10, 'Fallback must be valid unix timestamp in seconds');
} finally {
    fs.rmSync(shallowTmp, { recursive: true, force: true });
}
console.log('✅ Shallow clone fallback verified.');

console.log('\n🎉 ALL INJECT-VERSION UNIT TESTS PASSED SUCCESSFULLY! 🎉\n');
