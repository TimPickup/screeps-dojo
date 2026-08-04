'use strict';

// Pure-fs test for listRecordings/readRecordingMeta — no engine needed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
	listRecordings,
	readRecordingMeta,
	_clearRecordingCache,
	IN_PROGRESS_STALE_MS
} = require('../../src/recording');

function makeRecording(root, scenario, ts, meta) {
	const dir = path.join(root, scenario, ts);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
	fs.writeFileSync(path.join(dir, 'recording.json'), JSON.stringify({ meta: meta, terrain: {}, frames: [] }));
	return dir;
}

// An unfinalised run: meta.json says in-progress and only the journal exists
// (recording.json is written by finalize). ageMs backdates the journal so the
// staleness check can be exercised without waiting.
function makeInProgress(root, scenario, ts, ageMs) {
	const dir = path.join(root, scenario, ts);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ scenario: scenario, endReason: 'in-progress', ticks: 0 }));
	const journal = path.join(dir, 'frames.ndjson');
	fs.writeFileSync(journal, '{"gameTime":1}\n');
	if (ageMs) {
		const when = (Date.now() - ageMs) / 1000;
		fs.utimesSync(journal, when, when);
	}
	return dir;
}

describe('listRecordings / readRecordingMeta', function () {
	let root;
	beforeEach(function () {
		_clearRecordingCache();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-rec-'));
		makeRecording(root, 'walk-to-flag', '20260619-120000', { scenario: 'walk-to-flag', endReason: 'until', ticks: 12, test: { passed: true, message: null } });
		makeRecording(root, 'combat', '20260619-130000', { scenario: 'combat', endReason: 'botDied', ticks: 40, test: { passed: false, message: 'creep died' } });
	});
	afterEach(function () { fs.rmSync(root, { recursive: true, force: true }); });

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

	// An empty list means "nothing recorded". A filesystem that cannot be read
	// means something is wrong, and saying "no recordings" would send the user
	// looking in entirely the wrong place.
	it('surfaces a filesystem failure rather than reporting an empty list', function () {
		const real = fs.readdirSync;
		fs.readdirSync = function () { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; };
		try {
			assert.throws(function () { listRecordings(root); }, /EACCES/);
		} finally {
			fs.readdirSync = real;
		}
	});

	describe('scenario filter', function () {
		it('returns only the requested scenario', function () {
			const list = listRecordings(root, { scenario: 'combat' });
			assert.strictEqual(list.length, 1);
			assert.strictEqual(list[0].scenario, 'combat');
		});

		it('returns [] for a scenario with no recordings', function () {
			assert.deepStrictEqual(listRecordings(root, { scenario: 'never-run' }), []);
		});

		// The filter names a directory, so a traversal attempt must not be able to
		// walk out of the recordings root (defence in depth — the route validates too).
		it('refuses to escape the root via a traversal scenario name', function () {
			for (const evil of ['../../etc', '..', '.', 'a/b', 'a\\b', '/etc/passwd', '', '\0', 'a\0b']) {
				assert.throws(
					function () { listRecordings(root, { scenario: evil }); },
					/invalid scenario name/,
					'must reject ' + JSON.stringify(evil)
				);
			}
		});

		// The scenario list shows any directory holding a scenario.js, so the
		// filter has to accept those names too — otherwise a scenario stays
		// runnable while its Replays tab 400s.
		it('accepts any name the scenario list would show', function () {
			for (const odd of ['my scenario', 'v1.2', '_scratch', '-tmp', '.hidden', 'ünïcode']) {
				const dir = path.join(root, odd, '20260101-000000');
				fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ scenario: odd, endReason: 'until', ticks: 3 }));
				fs.writeFileSync(path.join(dir, 'recording.json'), '{}');
				const list = listRecordings(root, { scenario: odd });
				assert.strictEqual(list.length, 1, 'must list ' + JSON.stringify(odd));
				assert.strictEqual(list[0].scenario, odd);
				assert.strictEqual(list[0].ticks, 3);
			}
		});
	});

	describe('status', function () {
		it('reports the endReason for a finalised run and keeps its tick count', function () {
			const list = listRecordings(root, { scenario: 'combat' });
			assert.strictEqual(list[0].status, 'botDied');
			assert.strictEqual(list[0].ticks, 40);
		});

		it('reports a freshly-written in-progress run as running with unknown ticks', function () {
			makeInProgress(root, 'live', '20260620-100000', 0);
			const list = listRecordings(root, { scenario: 'live' });
			assert.strictEqual(list.length, 1);
			assert.strictEqual(list[0].status, 'running');
			// meta.ticks is written as 0 before the first tick and never updated,
			// so surfacing it would claim "0t" for a run that is mid-flight.
			assert.strictEqual(list[0].ticks, null);
		});

		it('reports an abandoned in-progress run as interrupted', function () {
			makeInProgress(root, 'stuck', '20260620-110000', IN_PROGRESS_STALE_MS * 2);
			const list = listRecordings(root, { scenario: 'stuck' });
			assert.strictEqual(list.length, 1);
			assert.strictEqual(list[0].status, 'interrupted');
			assert.strictEqual(list[0].ticks, null);
		});

		it('reports unknown when meta.json is absent', function () {
			const dir = path.join(root, 'nometa', '20260620-120000');
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, 'recording.json'), '{}');
			const list = listRecordings(root, { scenario: 'nometa' });
			assert.strictEqual(list[0].status, 'unknown');
			assert.strictEqual(list[0].ticks, null);
		});
	});

	describe('caching', function () {
		it('serves a finalised entry from cache without re-reading meta.json', function () {
			const first = listRecordings(root, { scenario: 'combat' });
			assert.strictEqual(first[0].meta.ticks, 40);
			// A finalised recording is immutable, so the cached copy stands even
			// though meta.json is now gone.
			fs.rmSync(path.join(root, 'combat', '20260619-130000', 'meta.json'));
			const second = listRecordings(root, { scenario: 'combat' });
			assert.strictEqual(second[0].meta.ticks, 40, 'served from cache');

			_clearRecordingCache();
			const third = listRecordings(root, { scenario: 'combat' });
			assert.strictEqual(third[0].meta, null, 'cache cleared, meta really is gone');
		});

		it('never caches an in-progress run, so it can transition to finalised', function () {
			const dir = makeInProgress(root, 'live', '20260620-100000', 0);
			assert.strictEqual(listRecordings(root, { scenario: 'live' })[0].status, 'running');

			fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ scenario: 'live', endReason: 'until', ticks: 7 }));
			fs.writeFileSync(path.join(dir, 'recording.json'), '{}');
			fs.rmSync(path.join(dir, 'frames.ndjson'));

			const after = listRecordings(root, { scenario: 'live' })[0];
			assert.strictEqual(after.status, 'until');
			assert.strictEqual(after.ticks, 7);
		});
	});
});
