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

// Lists every recording under root (default the repo recordings/), newest
// first by directory mtime. Each entry carries the parsed meta (endReason,
// ticks, and test pass/fail when present) so the GUI can render PASS/FAIL
// badges without loading frames.
function listRecordings(root) {
	const base = root || RECORDINGS_ROOT;
	if (!fs.existsSync(base)) return [];
	const out = [];
	for (const scenario of fs.readdirSync(base)) {
		const scenarioDir = path.join(base, scenario);
		let stat;
		try { stat = fs.statSync(scenarioDir); } catch (e) { continue; }
		if (!stat.isDirectory()) continue;
		for (const timestamp of fs.readdirSync(scenarioDir)) {
			const dir = path.join(scenarioDir, timestamp);
			let dstat;
			try { dstat = fs.statSync(dir); } catch (e) { continue; }
			if (!dstat.isDirectory()) continue;
			const hasRecording = fs.existsSync(path.join(dir, 'recording.json'))
				|| fs.existsSync(path.join(dir, 'frames.ndjson'));
			if (!hasRecording) continue;
			out.push({
				scenario: scenario,
				timestamp: timestamp,
				dir: dir,
				recordingPath: path.join(dir, 'recording.json'),
				mtime: dstat.mtimeMs,
				meta: readRecordingMeta(dir)
			});
		}
	}
	out.sort(function (a, b) { return b.mtime - a.mtime; });
	return out;
}

module.exports = {
	writeRecording: writeRecording,
	loadRecording: loadRecording,
	createRecorder: createRecorder,
	listRecordings: listRecordings,
	readRecordingMeta: readRecordingMeta,
	RECORDINGS_ROOT: RECORDINGS_ROOT
};
