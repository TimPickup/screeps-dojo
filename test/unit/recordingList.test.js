'use strict';

// Pure-fs test for listRecordings/readRecordingMeta — no engine needed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listRecordings, readRecordingMeta } = require('../../src/recording');

function makeRecording(root, scenario, ts, meta) {
	const dir = path.join(root, scenario, ts);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
	fs.writeFileSync(path.join(dir, 'recording.json'), JSON.stringify({ meta: meta, terrain: {}, frames: [] }));
	return dir;
}

describe('listRecordings / readRecordingMeta', function () {
	let root;
	before(function () {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-rec-'));
		makeRecording(root, 'walk-to-flag', '20260619-120000', { scenario: 'walk-to-flag', endReason: 'until', ticks: 12, test: { passed: true, message: null } });
		// ensure a newer mtime on the second by writing after a tick
		const d = makeRecording(root, 'combat', '20260619-130000', { scenario: 'combat', endReason: 'botDied', ticks: 40, test: { passed: false, message: 'creep died' } });
		const future = Date.now() / 1000 + 10;
		fs.utimesSync(d, future, future);
	});
	after(function () { fs.rmSync(root, { recursive: true, force: true }); });

	it('lists recordings newest-first with parsed meta', function () {
		const list = listRecordings(root);
		assert.strictEqual(list.length, 2);
		assert.strictEqual(list[0].scenario, 'combat', 'newest first');
		assert.strictEqual(list[0].meta.test.passed, false);
		assert.strictEqual(list[1].meta.test.passed, true);
		assert.ok(list[0].recordingPath.endsWith('recording.json'));
	});

	it('readRecordingMeta returns the meta object', function () {
		const list = listRecordings(root);
		const meta = readRecordingMeta(list[1].dir);
		assert.strictEqual(meta.endReason, 'until');
		assert.strictEqual(meta.ticks, 12);
	});

	it('returns [] for a missing root', function () {
		assert.deepStrictEqual(listRecordings(path.join(root, 'nope')), []);
	});
});
