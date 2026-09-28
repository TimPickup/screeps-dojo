'use strict';

// Streams a run that is still recording, as the same {"meta","terrain",
// "frames"} JSON a finished recording.json holds, and keeps it open: frames
// are sent as the recorder journals them, and the array closes when the run
// finishes (or its recorder dies). The replay viewer already plays a
// progressive download while it arrives, so a live run just keeps loading.
//
// Read-only and never holds a file open between polls: the recorder must be
// free to delete its journal at finalize (a file held open across a Docker
// bind mount on Windows can refuse the delete). Nothing is written to the run
// directory, so a viewer can never race finalize.
const fs = require('fs');
const path = require('path');
const { setTimeout: delay } = require('timers/promises');

const READ_BYTES = 1024 * 1024;
const NEWLINE = 0x0a;
const COMMA = 0x2c;
const FRAMES_MARKER = Buffer.from(',"frames":[');

// A JSON file the recorder writes in place, so a read can land mid-write.
// null until it parses.
function readJsonText(file) {
	try {
		const text = fs.readFileSync(file, 'utf8');
		JSON.parse(text);
		return text;
	} catch (e) {
		return null;
	}
}

// Reads length bytes (or fewer, at EOF) at position. null if the file is gone.
function readAt(file, position, length) {
	let fd;
	try { fd = fs.openSync(file, 'r'); } catch (e) {
		if (e.code === 'ENOENT') return null;
		throw e;
	}
	try {
		const buffer = Buffer.alloc(length);
		const read = fs.readSync(fd, buffer, 0, length, position);
		return buffer.subarray(0, read);
	} finally {
		fs.closeSync(fd);
	}
}

// Where the frames array body starts in an assembled recording.json.
function framesBodyOffset(recordingFile) {
	let scanned = Buffer.alloc(0);
	for (let position = 0; ; position += READ_BYTES) {
		const chunk = readAt(recordingFile, position, READ_BYTES);
		if (!chunk || !chunk.length) return -1;
		scanned = Buffer.concat([scanned, chunk]);
		const at = scanned.indexOf(FRAMES_MARKER);
		if (at >= 0) return at + FRAMES_MARKER.length;
	}
}

// options: isAlive(dir) — is the recorder still running; signal — stops the
// tail (the response closed); pollMs — how often to look for new frames.
async function* tailRecording(dir, options) {
	const isAlive = options.isAlive;
	const signal = options.signal;
	const pollMs = options.pollMs ?? 250;
	const journalFile = path.join(dir, 'frames.ndjson');
	const recordingFile = path.join(dir, 'recording.json');
	const wait = () => delay(pollMs, undefined, { signal });

	// meta.json and terrain.json are written as the run starts. The viewer
	// needs both before any frame, so wait for them.
	let meta, terrain;
	for (;;) {
		meta = meta || readJsonText(path.join(dir, 'meta.json'));
		terrain = terrain || readJsonText(path.join(dir, 'terrain.json'));
		if (meta && terrain) break;
		if (!isAlive(dir)) { meta = meta || '{}'; terrain = terrain || 'null'; break; }
		await wait();
	}
	yield Buffer.from('{"meta":' + meta + ',"terrain":' + terrain + ',"frames":[');

	let offset = 0;           // journal bytes read
	let carry = Buffer.alloc(0); // read, but not yet a whole line
	let sent = 0;             // frames sent
	// Everything complete in the journal past offset, as array elements.
	// false when the journal is gone (finalize deleted it).
	function* drain() {
		for (;;) {
			const chunk = readAt(journalFile, offset, READ_BYTES);
			if (chunk === null) return false;
			if (!chunk.length) return true;
			offset += chunk.length;
			const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
			const end = data.lastIndexOf(NEWLINE);
			if (end < 0) { carry = data; continue; }
			carry = Buffer.from(data.subarray(end + 1));
			const lines = Buffer.from(data.subarray(0, end));
			let count = 1;
			for (let i = 0; i < lines.length; i++) {
				if (lines[i] === NEWLINE) { lines[i] = COMMA; count++; }
			}
			yield sent ? Buffer.concat([Buffer.from(','), lines]) : lines;
			sent += count;
		}
	}

	for (;;) {
		// Decide before the read: whatever the journal holds after this is all
		// there will ever be.
		const finishing = fs.existsSync(recordingFile) || !isAlive(dir);
		const present = yield* drain();
		if (!present && !fs.existsSync(recordingFile)) {
			// No journal yet: the recorder creates it with the first frame.
			if (finishing) { yield Buffer.from(']}'); return; }
			await wait();
			continue;
		}
		if (!present) {
			// Finalize assembled recording.json and deleted the journal between
			// two reads. Its frames body is the journal with each newline turned
			// into a comma, so continue from the matching byte: the comma before
			// the next frame, or the closing ']}'.
			const body = framesBodyOffset(recordingFile);
			if (body < 0) { yield Buffer.from(']}'); return; }
			const consumed = offset - carry.length;
			let position = body + (sent ? consumed - 1 : 0);
			for (;;) {
				const chunk = readAt(recordingFile, position, READ_BYTES);
				if (!chunk || !chunk.length) return;
				position += chunk.length;
				yield chunk;
			}
		}
		if (finishing) { yield Buffer.from(']}'); return; }
		await wait();
	}
}

module.exports = { tailRecording };
