'use strict';

// What the container image actually depends on, hashed.
//
// The image is node_modules and nothing else: `npm ci` against the lockfile,
// plus the mock-engine patches applied on top. But the Dockerfile copies
// package.json before that install, and package.json carries the VERSION — so
// every release busts the layer and reinstalls 682 packages, spending about
// seven minutes to change a string the image never reads.
//
// So the decision "does this need rebuilding?" is made on content that matters
// rather than on whether a file changed: the Dockerfile, the dependency graph,
// and the patch sources. A version bump leaves this fingerprint identical, and
// the build is skipped. Anything genuinely affecting node_modules changes it.
//
// Deliberately conservative: anything unreadable or unexpected falls through to
// "rebuild", because a stale image is a much worse failure than a slow launch.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const STORE = path.join(ROOT, '.tmp', 'image-build.json');

// package.json fields that can change what `npm ci` installs or runs. `version`
// is pointedly absent; so are description, author, and the rest of the metadata.
const MANIFEST_FIELDS = [
	'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
	'overrides', 'resolutions', 'engines', 'bundledDependencies'
];

// Install-time scripts run during `npm ci`, so their text is part of the image.
// Every other script runs later, outside it.
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];

function readFile(file) {
	try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
}

// Every file under a directory, in a stable order, so the hash does not depend
// on how the filesystem happens to enumerate them.
function hashTree(dir, hash) {
	let entries;
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
	for (const entry of entries.slice().sort(function (a, b) { return a.name < b.name ? -1 : 1; })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { hashTree(full, hash); continue; }
		hash.update(entry.name).update('\0').update(readFile(full) || '').update('\0');
	}
}

function manifestParts(text) {
	if (text === null) return 'missing';
	let parsed;
	try { parsed = JSON.parse(text); } catch (e) { return text; }   // unparseable: hash it whole
	const relevant = {};
	for (const field of MANIFEST_FIELDS) {
		if (parsed[field] !== undefined) relevant[field] = parsed[field];
	}
	const scripts = {};
	for (const name of INSTALL_SCRIPTS) {
		if (parsed.scripts && parsed.scripts[name] !== undefined) scripts[name] = parsed.scripts[name];
	}
	relevant.scripts = scripts;
	return JSON.stringify(relevant);
}

// The lockfile pins every resolved package, which is exactly what we care
// about — minus its own copy of the project version, which moves every release.
function lockParts(text) {
	if (text === null) return 'missing';
	let parsed;
	try { parsed = JSON.parse(text); } catch (e) { return text; }
	const packages = parsed.packages ? Object.assign({}, parsed.packages) : {};
	if (packages['']) {
		packages[''] = Object.assign({}, packages['']);
		delete packages[''].version;
	}
	return JSON.stringify({ lockfileVersion: parsed.lockfileVersion, packages: packages });
}

function fingerprint(root) {
	const base = root || ROOT;
	const hash = crypto.createHash('sha1');
	hash.update(readFile(path.join(base, 'Dockerfile')) || 'missing').update('\0');
	hash.update(manifestParts(readFile(path.join(base, 'package.json')))).update('\0');
	hash.update(lockParts(readFile(path.join(base, 'package-lock.json')))).update('\0');
	hash.update(readFile(path.join(base, 'tools', 'mockEnginePatches.cjs')) || 'missing').update('\0');
	hashTree(path.join(base, 'server-mock-patches'), hash);
	return hash.digest('hex');
}

// What was last built, or null when we have never recorded one — which counts
// as "unknown", and unknown means build.
function readStored() {
	try { return JSON.parse(fs.readFileSync(STORE, 'utf8')).fingerprint || null; }
	catch (e) { return null; }
}

function writeStored(value) {
	try {
		fs.mkdirSync(path.dirname(STORE), { recursive: true });
		fs.writeFileSync(STORE, JSON.stringify({ fingerprint: value, at: new Date().toISOString() }, null, '\t') + '\n', 'utf8');
	} catch (e) { /* only costs us a needless rebuild next time */ }
}

module.exports = {
	STORE: STORE,
	MANIFEST_FIELDS: MANIFEST_FIELDS,
	INSTALL_SCRIPTS: INSTALL_SCRIPTS,
	manifestParts: manifestParts,
	lockParts: lockParts,
	fingerprint: fingerprint,
	readStored: readStored,
	writeStored: writeStored
};
