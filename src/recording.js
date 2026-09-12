'use strict';

// Recording files: one JSON per run under
// scenarios/<scenario path>/recordings/<timestamp>/recording.json — INSIDE the
// scenario, so replays follow it through a rename or a move into a folder.
// (They used to live in a separate top-level recordings/ keyed by scenario
// name, which a rename silently orphaned; migrateLegacyRecordings below moves
// those across on first boot.) Re-renderable without re-running the sim.
//
// Crash safety: createRecorder() journals every frame to frames.ndjson as it
// is captured (append-only, nothing retained in memory), writes meta.json up
// front with endReason 'in-progress', and finalize() assembles the single-file
// recording.json by streaming the journal in fixed-size chunks. The whole
// pipeline is synchronous and bounded-memory so it is safe to run from a
// SIGTERM/SIGINT handler. loadRecording() salvages a journal whose process
// was hard-killed before finalize (no recording.json, frames.ndjson present).
const fs = require('fs');
const path = require('path');

const { RECORDINGS_DIR_NAME, resolveScenarioPath, listScenarioDirs, isDirEntry } = require('./scenarioTree');

// Where recordings lived before they moved inside their scenario. Still read
// for the one-time migration, and still the home of runs whose scenario no
// longer exists (nothing to move them to).
const LEGACY_RECORDINGS_ROOT = path.join(__dirname, '..', 'recordings');
const SCENARIOS_ROOT = path.join(__dirname, '..', 'scenarios');

// A scenario's replay directory. Created on demand by the recorder.
function recordingsDirFor(scenarioDir) {
	return path.join(scenarioDir, RECORDINGS_DIR_NAME);
}
const ASSEMBLY_CHUNK_BYTES = 8 * 1024 * 1024;

function timestampDirName(date) {
	const pad = function (value) { return String(value).padStart(2, '0'); };
	return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate())
		+ '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

function writeRecording(scenarioDir, recording) {
	const dir = path.join(recordingsDirFor(scenarioDir), timestampDirName(new Date()));
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, 'recording.json');
	fs.writeFileSync(file, JSON.stringify(recording));
	return file;
}

// Counts journal lines (frames) without loading the file: fixed-buffer
// readSync loop counting newline bytes. addFrame always terminates a line
// with '\n', so newlines === frames.
function countJournalFrames(journalFile) {
	const buffer = Buffer.alloc(ASSEMBLY_CHUNK_BYTES);
	const fd = fs.openSync(journalFile, 'r');
	let frames = 0;
	try {
		for (;;) {
			const read = fs.readSync(fd, buffer, 0, buffer.length, null);
			if (read === 0) break;
			for (let i = 0; i < read; i++) {
				if (buffer[i] === 0x0a) frames++;
			}
		}
	} finally {
		fs.closeSync(fd);
	}
	return frames;
}

// Appends the journal to recordingFile as a JSON array body. Works on raw
// bytes (0x0a never occurs inside a multi-byte UTF-8 sequence, so newline
// replacement is safe without decoding): each newline becomes a comma, except
// the file-final newline which would otherwise leave a trailing comma — a
// chunk-ending newline is held pending and only emitted as ',' when more data
// follows. Fully synchronous, memory bounded by one 8MB chunk.
function appendJournalAsArrayBody(journalFile, recordingFile) {
	const buffer = Buffer.alloc(ASSEMBLY_CHUNK_BYTES);
	const fd = fs.openSync(journalFile, 'r');
	try {
		let pendingNewline = false;
		for (;;) {
			const read = fs.readSync(fd, buffer, 0, buffer.length, null);
			if (read === 0) break;
			if (pendingNewline) {
				fs.appendFileSync(recordingFile, ',');
				pendingNewline = false;
			}
			let end = read;
			if (buffer[read - 1] === 0x0a) {
				end = read - 1;
				pendingNewline = true;
			}
			for (let i = 0; i < end; i++) {
				if (buffer[i] === 0x0a) buffer[i] = 0x2c; // '\n' -> ','
			}
			fs.appendFileSync(recordingFile, buffer.subarray(0, end));
		}
	} finally {
		fs.closeSync(fd);
	}
}

// Assembles recording.json from the on-disk parts (meta.json, terrain.json,
// frames.ndjson) without ever holding the frames in memory. Synthesizes meta
// when meta.json is missing (hard-killed before writeMeta) so a journal alone
// is still loadable. Returns the recording.json path.
function assembleRecording(dir) {
	const journalFile = path.join(dir, 'frames.ndjson');
	const metaFile = path.join(dir, 'meta.json');
	const terrainFile = path.join(dir, 'terrain.json');
	const recordingFile = path.join(dir, 'recording.json');
	let metaJson;
	if (fs.existsSync(metaFile)) {
		metaJson = fs.readFileSync(metaFile, 'utf8');
	} else {
		const frameCount = countJournalFrames(journalFile);
		metaJson = JSON.stringify({
			// dir is <scenario>/recordings/<timestamp>, so the scenario is two up
			scenario: path.basename(path.dirname(path.dirname(dir))),
			endReason: 'killed',
			ticks: frameCount - 1
		});
	}
	const terrainJson = fs.existsSync(terrainFile) ? fs.readFileSync(terrainFile, 'utf8') : 'null';
	fs.writeFileSync(recordingFile, '{"meta":' + metaJson + ',"terrain":' + terrainJson + ',"frames":[');
	appendJournalAsArrayBody(journalFile, recordingFile);
	fs.appendFileSync(recordingFile, ']}');
	return recordingFile;
}

// Streaming recorder: frames go straight to disk, so RAM stays flat no matter
// how long the run is. Everything here is synchronous on purpose — finalize()
// must be callable from a process signal handler.
function createRecorder(scenarioDir) {
	const dir = path.join(recordingsDirFor(scenarioDir), timestampDirName(new Date()));
	fs.mkdirSync(dir, { recursive: true });
	const journalFile = path.join(dir, 'frames.ndjson');
	let frames = 0;
	let finalizedPath = null;
	return {
		dir: dir,
		writeMeta: function (meta) {
			fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
		},
		setTerrain: function (terrain) {
			fs.writeFileSync(path.join(dir, 'terrain.json'), JSON.stringify(terrain));
		},
		addFrame: function (frame) {
			fs.appendFileSync(journalFile, JSON.stringify(frame) + '\n');
			frames++;
		},
		frameCount: function () {
			return frames;
		},
		finalize: function (meta) {
			if (finalizedPath !== null) return finalizedPath;
			fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
			finalizedPath = assembleRecording(dir);
			// The journal is only needed to salvage a run killed BEFORE finalize.
			// Once recording.json is assembled it's redundant — drop it so we don't
			// keep a second full-size copy of every recording on disk.
			try { fs.unlinkSync(journalFile); } catch (e) { /* already gone */ }
			return finalizedPath;
		}
	};
}

function loadRecording(recordingPath) {
	const isJsonTarget = recordingPath.endsWith('.json');
	const file = isJsonTarget ? recordingPath : path.join(recordingPath, 'recording.json');
	// Salvage: a run killed before finalize leaves frames.ndjson but no
	// recording.json — assemble it now so render/load just works.
	if (!fs.existsSync(file) && path.basename(file) === 'recording.json') {
		const dir = path.dirname(file);
		if (fs.existsSync(path.join(dir, 'frames.ndjson'))) assembleRecording(dir);
	}
	const recording = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!recording.meta || !recording.terrain || !Array.isArray(recording.frames)) {
		throw new Error('not a dojo recording: ' + file);
	}
	return recording;
}

// Reads a recording's metadata cheaply (meta.json is written up front and
// rewritten by finalize — it always exists for a finalized or in-progress
// run, so we never have to parse the potentially huge recording.json to list).
// Returns null when the dir has no readable meta.
function readRecordingMeta(dir) {
	const metaFile = path.join(dir, 'meta.json');
	try {
		if (fs.existsSync(metaFile)) return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
	} catch (e) { /* fall through */ }
	return null;
}

// How quiet an unfinalised run has to go before we stop calling it "running".
// A live run appends a frame every tick and the per-tick watchdog fires at 60s
// (scenarioRunner DEFAULT_TICK_TIMEOUT_MS), so five silent minutes means the
// process is gone — killed, crashed, or its container restarted — and the run
// is never coming back to rewrite meta.json.
const IN_PROGRESS_STALE_MS = 5 * 60 * 1000;

// Finalised recordings are immutable: finalize() writes meta.json once and
// nothing ever rewrites it. That makes them safe to memoise, which is what
// keeps the listing cheap on a Docker bind mount where every syscall costs
// milliseconds. Keyed by absolute run directory. In-progress runs are never
// cached — they still have a state transition ahead of them.
const finalizedCache = new Map();

function _clearRecordingCache() { finalizedCache.clear(); }

// Classifies a run from what is on disk. meta.ticks is written as 0 before the
// first tick and only corrected by finalize(), so for an unfinalised run we
// report null rather than repeating a 0 that was never true.
function deriveStatus(dir, meta, hasRecording, hasJournal) {
	if (!meta || typeof meta.endReason !== 'string') return { status: 'unknown', ticks: null };
	if (meta.endReason !== 'in-progress') {
		return { status: meta.endReason, ticks: typeof meta.ticks === 'number' ? meta.ticks : null };
	}
	// finalize() assembles recording.json and rewrites meta.json; an in-progress
	// meta sitting next to a recording.json means it died between the two.
	if (hasRecording) return { status: 'interrupted', ticks: null };
	// Only unfinalised runs pay for this stat, and there is rarely more than one.
	const probe = path.join(dir, hasJournal ? 'frames.ndjson' : 'meta.json');
	let mtimeMs;
	try { mtimeMs = fs.statSync(probe).mtimeMs; } catch (e) { return { status: 'interrupted', ticks: null }; }
	return { status: (Date.now() - mtimeMs) < IN_PROGRESS_STALE_MS ? 'running' : 'interrupted', ticks: null };
}

// Reads one run directory. A single readdir answers "is this a recording?" and
// "does it have meta?" at once — the old shape cost a statSync plus three
// existsSync calls to learn the same thing.
function scanRunDir(scenario, timestamp, dir) {
	let entries;
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
	let hasRecording = false;
	let hasJournal = false;
	let hasMeta = false;
	for (const entry of entries) {
		if (entry.isDirectory()) continue;
		if (entry.name === 'recording.json') hasRecording = true;
		else if (entry.name === 'frames.ndjson') hasJournal = true;
		else if (entry.name === 'meta.json') hasMeta = true;
	}
	if (!hasRecording && !hasJournal) return null;
	let meta = null;
	if (hasMeta) {
		try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')); }
		catch (e) { meta = null; }
	}
	const derived = deriveStatus(dir, meta, hasRecording, hasJournal);
	return {
		scenario: scenario,
		timestamp: timestamp,
		dir: dir,
		recordingPath: path.join(dir, 'recording.json'),
		status: derived.status,
		ticks: derived.ticks,
		meta: meta
	};
}

// Lists recordings for the whole workspace, or for one scenario.
//
// `root` is the SCENARIOS root: each scenario keeps its runs in its own
// recordings/ subdirectory. options.scenario restricts the walk to one
// scenario (a posix path relative to the root, e.g. 'Benches/defence-bench') —
// the GUI's Replays tab only ever shows one, and filtering here instead of in
// the browser is the difference between touching one directory and all of them.
//
// Ordering comes from the timestamp directory name (YYYYMMDD-HHMMSS, fixed
// width, so lexicographic === chronological) rather than a stat per entry.
//
// Each entry carries the parsed meta plus a derived status/ticks so the GUI can
// render badges without loading frames.
function listRecordings(root, options) {
	const base = root || SCENARIOS_ROOT;
	options = options || {};
	const wantScenario = options.scenario !== undefined && options.scenario !== null;

	let scenarioDirs;
	if (wantScenario) {
		const scenarioPath = String(options.scenario);
		let dir;
		try { dir = resolveScenarioPath(base, scenarioPath); }
		catch (e) {
			// keep the wording the API (and its tests) have always used
			const err = new Error('invalid scenario name: ' + scenarioPath);
			err.statusCode = 400;
			throw err;
		}
		scenarioDirs = [{ name: scenarioPath, dir: dir }];
	} else {
		// A missing scenarios root is a legitimate empty state; a permissions or
		// I/O failure is not, and must not masquerade as "no recordings".
		try { fs.readdirSync(base); }
		catch (e) {
			if (e && e.code === 'ENOENT') return [];
			throw e;
		}
		scenarioDirs = listScenarioDirs(base).map(function (s) {
			return { name: s.path, dir: s.dir };
		});
	}

	const out = [];
	for (const scenarioDir of scenarioDirs) {
		let runs;
		try { runs = fs.readdirSync(recordingsDirFor(scenarioDir.dir), { withFileTypes: true }); }
		catch (e) { continue; }
		for (const run of runs) {
			const dir = path.join(recordingsDirFor(scenarioDir.dir), run.name);
			if (!isDirEntry(run, dir)) continue;
			const cached = finalizedCache.get(dir);
			if (cached) { out.push(Object.assign({}, cached)); continue; }
			const entry = scanRunDir(scenarioDir.name, run.name, dir);
			if (!entry) continue;
			// 'unknown' stays uncached too: a run mid-creation has no meta yet.
			if (entry.status !== 'running' && entry.status !== 'interrupted' && entry.status !== 'unknown') {
				finalizedCache.set(dir, entry);
			}
			out.push(entry);
		}
	}
	out.sort(function (a, b) {
		if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
		return a.scenario < b.scenario ? -1 : (a.scenario > b.scenario ? 1 : 0);
	});
	return out;
}

// One-time move of the old top-level recordings/<name>/ into
// scenarios/<name>/recordings/. Only runs for a legacy directory whose name
// still matches a TOP-LEVEL scenario; anything else (a scenario since deleted,
// or one already moved into a folder under a different path) is left exactly
// where it is rather than guessed at. Idempotent, and never overwrites: a
// timestamp that already exists on the scenario side is skipped.
//
// Returns { scenarios, runs, skipped } for the boot log.
function migrateLegacyRecordings(scenariosRoot, legacyRoot) {
	const scenariosBase = path.resolve(scenariosRoot || SCENARIOS_ROOT);
	const legacyBase = path.resolve(legacyRoot || LEGACY_RECORDINGS_ROOT);
	const result = { scenarios: 0, runs: 0, skipped: 0 };
	let legacyEntries;
	try { legacyEntries = fs.readdirSync(legacyBase, { withFileTypes: true }); }
	catch (e) { return result; }

	for (const entry of legacyEntries) {
		const from = path.join(legacyBase, entry.name);
		if (!isDirEntry(entry, from)) continue;
		const scenarioDir = path.join(scenariosBase, entry.name);
		// path.join would happily accept '..' as a directory name on disk
		if (path.dirname(scenarioDir) !== scenariosBase) continue;
		let hasScenario;
		try { hasScenario = fs.statSync(path.join(scenarioDir, 'scenario.js')).isFile(); }
		catch (e) { hasScenario = false; }
		if (!hasScenario) { result.skipped += 1; continue; }

		let runs;
		try { runs = fs.readdirSync(from, { withFileTypes: true }); } catch (e) { continue; }
		const target = recordingsDirFor(scenarioDir);
		let moved = 0;
		for (const run of runs) {
			const runFrom = path.join(from, run.name);
			if (!isDirEntry(run, runFrom)) continue;
			const runTo = path.join(target, run.name);
			if (fs.existsSync(runTo)) continue;
			try {
				fs.mkdirSync(target, { recursive: true });
				fs.renameSync(runFrom, runTo);
				moved += 1;
			} catch (e) {
				// EXDEV (different filesystems) or a locked file: copy instead, and
				// leave the original in place rather than risk losing a recording.
				try {
					fs.cpSync(runFrom, runTo, { recursive: true });
					fs.rmSync(runFrom, { recursive: true, force: true });
					moved += 1;
				} catch (e2) { /* leave it where it is */ }
			}
		}
		if (moved) { result.scenarios += 1; result.runs += moved; }
		// drop the now-empty legacy directory so the migration doesn't re-walk it
		try { if (fs.readdirSync(from).length === 0) fs.rmdirSync(from); } catch (e) { /* not empty */ }
	}
	return result;
}

// Bytes held by a directory tree. One stat per file — only ever called for the
// legacy recordings directory, on demand from Settings, so a walk is fine; it
// is never on the path of a run or a listing.
function directorySize(dir) {
	let total = 0;
	let entries;
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) { total += directorySize(full); continue; }
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		try { total += fs.statSync(full).size; } catch (e) { /* vanished mid-walk */ }
	}
	return total;
}

// What migrateLegacyRecordings could not move: a top-level recordings/<name>/
// with no scenario of that name to move it into. After a migration this is
// everything still in the directory — runs from scenarios long since deleted,
// plus the throwaway directories the abort test leaves behind.
//
// Reported rather than deleted: they are the only copy of those runs, so
// clearing them is an explicit choice made in Settings.
function listOrphanedRecordings(scenariosRoot, legacyRoot) {
	const scenariosBase = path.resolve(scenariosRoot || SCENARIOS_ROOT);
	const legacyBase = path.resolve(legacyRoot || LEGACY_RECORDINGS_ROOT);
	const out = { root: legacyBase, entries: [], runs: 0, bytes: 0 };
	let entries;
	try { entries = fs.readdirSync(legacyBase, { withFileTypes: true }); } catch (e) { return out; }

	for (const entry of entries) {
		const dir = path.join(legacyBase, entry.name);
		if (!isDirEntry(entry, dir)) continue;
		const scenarioDir = path.join(scenariosBase, entry.name);
		let hasScenario = false;
		if (path.dirname(scenarioDir) === scenariosBase) {
			try { hasScenario = fs.statSync(path.join(scenarioDir, 'scenario.js')).isFile(); }
			catch (e) { hasScenario = false; }
		}
		if (hasScenario) continue; // migrateLegacyRecordings owns this one
		let runs = 0;
		try {
			runs = fs.readdirSync(dir, { withFileTypes: true })
				.filter(function (run) { return isDirEntry(run, path.join(dir, run.name)); }).length;
		} catch (e) { runs = 0; }
		const bytes = directorySize(dir);
		out.entries.push({ name: entry.name, runs: runs, bytes: bytes });
		out.runs += runs;
		out.bytes += bytes;
	}
	out.entries.sort(function (a, b) { return b.bytes - a.bytes; });
	return out;
}

// Deletes every orphan listOrphanedRecordings would report, and the legacy
// directory itself once it is empty. Returns what went.
function clearOrphanedRecordings(scenariosRoot, legacyRoot) {
	const found = listOrphanedRecordings(scenariosRoot, legacyRoot);
	let removed = 0;
	let bytes = 0;
	for (const entry of found.entries) {
		try {
			fs.rmSync(path.join(found.root, entry.name), { recursive: true, force: true });
			removed += 1;
			bytes += entry.bytes;
		} catch (e) { /* leave what will not go */ }
	}
	try { if (fs.readdirSync(found.root).length === 0) fs.rmdirSync(found.root); } catch (e) { /* not empty */ }
	return { removed: removed, bytes: bytes };
}

module.exports = {
	writeRecording: writeRecording,
	loadRecording: loadRecording,
	createRecorder: createRecorder,
	listRecordings: listRecordings,
	readRecordingMeta: readRecordingMeta,
	_clearRecordingCache: _clearRecordingCache,
	IN_PROGRESS_STALE_MS: IN_PROGRESS_STALE_MS,
	recordingsDirFor: recordingsDirFor,
	migrateLegacyRecordings: migrateLegacyRecordings,
	listOrphanedRecordings: listOrphanedRecordings,
	clearOrphanedRecordings: clearOrphanedRecordings,
	LEGACY_RECORDINGS_ROOT: LEGACY_RECORDINGS_ROOT,
	SCENARIOS_ROOT: SCENARIOS_ROOT
};
