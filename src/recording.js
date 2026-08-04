'use strict';

// Recording files (spec §7): one JSON per run under
// recordings/<scenario>/<timestamp>/recording.json. Re-renderable without
// re-running the sim.
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

const RECORDINGS_ROOT = path.join(__dirname, '..', 'recordings');
const ASSEMBLY_CHUNK_BYTES = 8 * 1024 * 1024;

function timestampDirName(date) {
	const pad = function (value) { return String(value).padStart(2, '0'); };
	return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate())
		+ '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

function writeRecording(scenarioName, recording) {
	const dir = path.join(RECORDINGS_ROOT, scenarioName, timestampDirName(new Date()));
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
			scenario: path.basename(path.dirname(dir)),
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
function createRecorder(scenarioName) {
	const dir = path.join(RECORDINGS_ROOT, scenarioName, timestampDirName(new Date()));
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

// A directory read reports a symlink as a link, whereas the statSync this
// replaced followed it. Recordings are bulky enough that pointing a scenario's
// folder at another disk is reasonable, so keep following — only symlinks pay.
function isDirEntry(entry, full) {
	if (entry.isDirectory()) return true;
	if (!entry.isSymbolicLink()) return false;
	try { return fs.statSync(full).isDirectory(); } catch (e) { return false; }
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

// Resolves the scenario filter to a directory.
//
// This names a directory that ALREADY EXISTS, so it has to accept whatever the
// scenario list is willing to show — which is any directory holding a
// scenario.js, including names with spaces, dots or a leading underscore. The
// check is therefore structural rather than a character allowlist: exactly one
// path segment, resolving directly inside the root. Containment is what stops
// traversal; a character filter was only ever a shortcut to it.
//
// (The stricter pattern in routes/scenarios.js governs names the GUI will
// CREATE, which is a different question and must not be applied here.)
function resolveScenarioDir(base, scenario) {
	const reject = function () {
		const err = new Error('invalid scenario name: ' + scenario);
		err.statusCode = 400;
		throw err;
	};
	if (!scenario || scenario.indexOf('\0') !== -1) reject();
	if (scenario === '.' || scenario === '..') reject();
	if (scenario.indexOf('/') !== -1 || scenario.indexOf('\\') !== -1) reject();
	if (path.isAbsolute(scenario)) reject();
	const baseResolved = path.resolve(base);
	const dir = path.resolve(baseResolved, scenario);
	// a single segment directly under the root — not merely somewhere beneath it
	if (path.dirname(dir) !== baseResolved) reject();
	return dir;
}

// Lists recordings under root (default the repo recordings/), newest first.
// options.scenario restricts the walk to one scenario directory — the GUI's
// Replays tab only ever shows one scenario, and filtering here instead of in
// the browser is the difference between touching one directory and all of them.
//
// Ordering comes from the timestamp directory name (YYYYMMDD-HHMMSS, fixed
// width, so lexicographic === chronological) rather than a stat per entry.
//
// Each entry carries the parsed meta plus a derived status/ticks so the GUI can
// render badges without loading frames.
function listRecordings(root, options) {
	const base = root || RECORDINGS_ROOT;
	options = options || {};
	const wantScenario = options.scenario !== undefined && options.scenario !== null;

	let scenarioDirs;
	if (wantScenario) {
		const scenario = String(options.scenario);
		const dir = resolveScenarioDir(base, scenario);
		scenarioDirs = [{ name: scenario, dir: dir }];
	} else {
		let top;
		try {
			top = fs.readdirSync(base, { withFileTypes: true });
		} catch (e) {
			// No recordings root yet is normal — nothing has been recorded. Any
			// other failure (permissions, I/O) is real and must not masquerade as
			// "no recordings"; the route turns it into a 500 carrying the message.
			if (e && e.code === 'ENOENT') return [];
			throw e;
		}
		scenarioDirs = [];
		for (const entry of top) {
			const dir = path.join(base, entry.name);
			if (!isDirEntry(entry, dir)) continue;
			scenarioDirs.push({ name: entry.name, dir: dir });
		}
	}

	const out = [];
	for (const scenarioDir of scenarioDirs) {
		let runs;
		try { runs = fs.readdirSync(scenarioDir.dir, { withFileTypes: true }); } catch (e) { continue; }
		for (const run of runs) {
			const dir = path.join(scenarioDir.dir, run.name);
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

module.exports = {
	writeRecording: writeRecording,
	loadRecording: loadRecording,
	createRecorder: createRecorder,
	listRecordings: listRecordings,
	readRecordingMeta: readRecordingMeta,
	_clearRecordingCache: _clearRecordingCache,
	IN_PROGRESS_STALE_MS: IN_PROGRESS_STALE_MS,
	RECORDINGS_ROOT: RECORDINGS_ROOT
};
