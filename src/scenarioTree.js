'use strict';

// The scenarios/ workspace is a TREE, not a flat list: a directory holding a
// scenario.js is a scenario, and any other directory is a folder you can put
// scenarios (and more folders) into. This module is the single definition of
// that shape — the GUI listing, the recordings walk and the CLI suite all
// discover scenarios through it, so they can never disagree about what counts.
//
// Node built-ins only: src/server/index.js boots on an empty node_modules
// volume and reaches this through src/recording.js.
const fs = require('fs');
const path = require('path');

// A scenario's own replays live INSIDE it (scenarios/<path>/recordings/), so
// they follow it through a rename or a move. The name is reserved: the tree
// walk never descends into one and the GUI refuses to create one.
const RECORDINGS_DIR_NAME = 'recordings';

// Deep enough for any sane organisation, shallow enough that a symlink loop
// cannot walk forever. (isDirEntry follows symlinks on purpose — see below.)
const MAX_DEPTH = 8;

// A directory read reports a symlink as a link, whereas a statSync would follow
// it to its target. Keep following — a scenario symlinked in from another disk
// must still list — but make only symlinks pay for the extra stat.
function isDirEntry(entry, full) {
	if (entry.isDirectory()) return true;
	if (!entry.isSymbolicLink()) return false;
	try { return fs.statSync(full).isDirectory(); } catch (e) { return false; }
}

function isFileEntry(entry, full) {
	if (entry.isFile()) return true;
	if (!entry.isSymbolicLink()) return false;
	try { return fs.statSync(full).isFile(); } catch (e) { return false; }
}

function toPosix(p) { return p.split(path.sep).join('/'); }

// Top-level files of a scenario directory (scenario dirs are flat: scenario.js,
// map*.json, main.js, memory.json, ...). Dotfiles and nested dirs are skipped,
// which is also what hides recordings/ from the Edit tab's file list.
function listFiles(dir, entries) {
	const out = [];
	for (const entry of entries) {
		if (entry.name[0] === '.') continue;
		if (!isFileEntry(entry, path.join(dir, entry.name))) continue;
		out.push(entry.name);
	}
	return out.sort();
}

// Resolves a caller-supplied scenario/folder path (posix, relative to the
// scenarios root) to an absolute directory, rejecting anything that could
// escape the root.
//
// This names a directory that may ALREADY EXIST, so it has to accept whatever
// the listing is willing to show — names with spaces, dots or a leading
// underscore, at any depth. The check is therefore structural (containment)
// rather than a character allowlist; NAME_RE in routes/scenarios.js is the
// stricter rule for names the GUI will CREATE, which is a different question.
//
// Backslashes are rejected rather than treated as separators: on Linux (where
// the server runs) a backslash is an ordinary filename character, and letting
// one through would mean a path that resolves differently here and on a
// Windows host.
function resolveScenarioPath(root, rel, options) {
	options = options || {};
	const reject = function () {
		const err = new Error('invalid scenario path: ' + rel);
		err.statusCode = 400;
		throw err;
	};
	if (typeof rel !== 'string' || !rel) {
		// '' means the root itself, which is a legitimate target for "create a
		// folder at the top level" but never for "open this scenario".
		if (rel === '' && options.allowRoot) return path.resolve(root);
		reject();
	}
	if (rel.indexOf('\0') !== -1 || rel.indexOf('\\') !== -1) reject();
	if (path.isAbsolute(rel)) reject();
	const segments = rel.split('/');
	if (segments.length > MAX_DEPTH) reject();
	for (const segment of segments) {
		if (!segment || segment === '.' || segment === '..') reject();
		if (segment === RECORDINGS_DIR_NAME) reject();
	}
	const rootResolved = path.resolve(root);
	const resolved = path.resolve(rootResolved, rel);
	if (!resolved.startsWith(rootResolved + path.sep)) reject();
	return resolved;
}

// Walks the whole workspace once. Returns every scenario and every folder as
// posix paths relative to the root, each sorted by path.
//
// One readdir per directory and nothing else: the listing this replaced cost a
// statSync per scenario plus an existsSync for scenario.js, which on a Docker
// bind mount (where each syscall costs milliseconds) was seconds of latency
// before the list appeared.
//
// A directory holding scenario.js is a scenario and is NOT descended into — a
// scenario's own files are its business, and its recordings/ live there too.
function walkScenarioTree(root) {
	const folders = [];
	const scenarios = [];

	function descend(dir, relPath, depth) {
		let entries;
		// one unreadable directory must not blank the whole list
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
		catch (e) {
			// No scenarios directory at all is a legitimate empty state; a
			// permissions or I/O failure at the ROOT is not, and must not be shown
			// to the user as "No scenarios".
			if (depth === 0 && e && e.code !== 'ENOENT') throw e;
			return;
		}
		entries.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
		for (const entry of entries) {
			if (entry.name[0] === '.') continue;
			if (entry.name === RECORDINGS_DIR_NAME) continue;
			const child = path.join(dir, entry.name);
			if (!isDirEntry(entry, child)) continue;
			const childRel = relPath ? relPath + '/' + entry.name : entry.name;
			let childEntries;
			try { childEntries = fs.readdirSync(child, { withFileTypes: true }); } catch (e) { continue; }
			const files = listFiles(child, childEntries);
			if (files.includes('scenario.js')) {
				scenarios.push({
					path: childRel,
					name: entry.name,
					hasMap: files.some(function (f) { return /map.*\.json$/i.test(f); }),
					files: files
				});
				continue;
			}
			folders.push({ path: childRel, name: entry.name });
			if (depth + 1 < MAX_DEPTH) descend(child, childRel, depth + 1);
		}
	}

	descend(path.resolve(root), '', 0);
	return { folders: folders, scenarios: scenarios };
}

// Just the scenarios, as { path, dir } — what the recordings walk and the CLI
// suite need. Sorted by path, so run order is stable.
function listScenarioDirs(root) {
	const rootResolved = path.resolve(root);
	return walkScenarioTree(rootResolved).scenarios.map(function (s) {
		return { path: s.path, name: s.name, dir: path.join(rootResolved, s.path.split('/').join(path.sep)) };
	});
}

function isScenarioDir(dir) {
	try { return fs.statSync(path.join(dir, 'scenario.js')).isFile(); } catch (e) { return false; }
}

// Counts what a folder holds, for the "this folder is not empty" warning. Walks
// the subtree, so a folder of folders reports the scenarios at the bottom.
function countFolderContents(dir) {
	let folders = 0;
	let scenarios = 0;
	function descend(current, depth) {
		let entries;
		try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (e) { return; }
		for (const entry of entries) {
			if (entry.name[0] === '.' || entry.name === RECORDINGS_DIR_NAME) continue;
			const child = path.join(current, entry.name);
			if (!isDirEntry(entry, child)) continue;
			if (isScenarioDir(child)) { scenarios += 1; continue; }
			folders += 1;
			if (depth + 1 < MAX_DEPTH) descend(child, depth + 1);
		}
	}
	descend(dir, 0);
	return { folders: folders, scenarios: scenarios };
}

module.exports = {
	RECORDINGS_DIR_NAME: RECORDINGS_DIR_NAME,
	MAX_DEPTH: MAX_DEPTH,
	toPosix: toPosix,
	isDirEntry: isDirEntry,
	isFileEntry: isFileEntry,
	resolveScenarioPath: resolveScenarioPath,
	walkScenarioTree: walkScenarioTree,
	listScenarioDirs: listScenarioDirs,
	isScenarioDir: isScenarioDir,
	countFolderContents: countFolderContents
};
