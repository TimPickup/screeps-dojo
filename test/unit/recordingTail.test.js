'use strict';

// A run still recording, streamed while it grows: the viewer gets the same
// JSON the finished recording.json holds, however finalize lands between reads.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecorder } = require('../../src/recording');
const { tailRecording } = require('../../src/recordingTail');

function startRecorder(root, frames) {
	const scenario = path.join(root, 'alpha');
	fs.mkdirSync(scenario, { recursive: true });
	const recorder = createRecorder(scenario);
	recorder.writeMeta({ scenario: 'alpha', endReason: 'in-progress', ticks: 0 });
	recorder.setTerrain({ W0N0: '0'.repeat(2500) });
	for (let i = 0; i < frames; i++) recorder.addFrame(frame(i));
	return recorder;
}

function frame(i) {
	return { gameTime: i, objects: [{ _id: 'c' + i, note: 'x'.repeat(i * 97 % 3000) }] };
}

// Pulls the tail one chunk at a time, so a test can act between reads.
function open(dir, alive) {
	const controller = new AbortController();
	const it = tailRecording(dir, { isAlive: () => alive.value, signal: controller.signal, pollMs: 5 });
	const chunks = [];
	return {
		controller,
		async next() { const r = await it.next(); if (!r.done) chunks.push(r.value); return r; },
		async rest() { for (;;) { const r = await this.next(); if (r.done) break; } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
	};
}

describe('tailing a run that is still recording', function () {
	let root;
	beforeEach(function () { root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-tail-')); });
	afterEach(function () { fs.rmSync(root, { recursive: true, force: true }); });

	it('streams frames as they are journalled and closes once the run finalizes', async function () {
		const recorder = startRecorder(root, 3);
		const alive = { value: true };
		const tail = open(recorder.dir, alive);
		await tail.next(); // header
		await tail.next(); // frames 0-2
		for (let i = 3; i < 8; i++) recorder.addFrame(frame(i));
		await tail.next(); // frames 3-7, on the next poll
		recorder.addFrame(frame(8));
		const finalMeta = { scenario: 'alpha', endReason: 'complete', ticks: 9 };
		setTimeout(() => { recorder.finalize(finalMeta); alive.value = false; }, 20);
		const streamed = await tail.rest();
		assert.deepStrictEqual(streamed.frames, Array.from({ length: 9 }, (_, i) => frame(i)));
		assert.strictEqual(streamed.meta.endReason, 'in-progress');
		assert.deepStrictEqual(streamed.terrain, { W0N0: '0'.repeat(2500) });
	});

	it('picks up from recording.json when finalize deletes the journal between reads', async function () {
		const recorder = startRecorder(root, 2);
		const alive = { value: true };
		const tail = open(recorder.dir, alive);
		await tail.next();
		await tail.next(); // frames 0-1
		for (let i = 2; i < 6; i++) recorder.addFrame(frame(i));
		recorder.finalize({ scenario: 'alpha', endReason: 'complete', ticks: 6 });
		assert(!fs.existsSync(path.join(recorder.dir, 'frames.ndjson')));
		const streamed = await tail.rest();
		assert.deepStrictEqual(streamed.frames, Array.from({ length: 6 }, (_, i) => frame(i)));
	});

	it('picks up from recording.json when the run finalized before any frame was sent', async function () {
		const recorder = startRecorder(root, 4);
		const alive = { value: true };
		const tail = open(recorder.dir, alive);
		await tail.next(); // header only
		recorder.finalize({ scenario: 'alpha', endReason: 'complete', ticks: 4 });
		const streamed = await tail.rest();
		assert.deepStrictEqual(streamed.frames, Array.from({ length: 4 }, (_, i) => frame(i)));
	});

	it('waits for the first frame rather than ending an empty run', async function () {
		const recorder = startRecorder(root, 0);
		const alive = { value: true };
		const tail = open(recorder.dir, alive);
		await tail.next();
		setTimeout(() => recorder.addFrame(frame(0)), 30);
		setTimeout(() => { alive.value = false; }, 60);
		const streamed = await tail.rest();
		assert.deepStrictEqual(streamed.frames, [frame(0)]);
	});

	it('closes with the frames it has when the recorder dies, dropping a half-written line', async function () {
		const recorder = startRecorder(root, 2);
		fs.appendFileSync(path.join(recorder.dir, 'frames.ndjson'), '{"gameTime":2,"obj');
		const alive = { value: false };
		const streamed = await open(recorder.dir, alive).rest();
		assert.deepStrictEqual(streamed.frames, [frame(0), frame(1)]);
	});

	it('stops waiting when the viewer leaves', async function () {
		const recorder = startRecorder(root, 1);
		const tail = open(recorder.dir, { value: true });
		await tail.next();
		await tail.next();
		const pending = tail.next();
		tail.controller.abort();
		await assert.rejects(pending, /abort/i);
	});
});
