'use strict';

// finalize() vs the processes that read a run while it is being written: the
// GUI's list (meta.json) and the file route (recording.json, or salvage).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, fork } = require('child_process');
const {
	createRecorder,
	loadRecording,
	listRecordings,
	_clearRecordingCache
} = require('../../src/recording');

const FINALIZE_CHILD = path.join(__dirname, 'fixtures', 'finalizeChild.js');

function makeScenario(root, name) {
	const dir = path.join(root, name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'scenario.js'), '// scenario');
	return dir;
}

function startRecorder(scenarioDir, frames) {
	const recorder = createRecorder(scenarioDir);
	recorder.writeMeta({ scenario: path.basename(scenarioDir), endReason: 'in-progress', ticks: 0 });
	recorder.setTerrain({ W0N0: '0'.repeat(2500) });
	for (let i = 0; i < frames; i++) recorder.addFrame({ gameTime: i, objects: [] });
	return recorder;
}

// The pid of a process that has already exited.
function deadPid() {
	return spawnSync(process.execPath, ['-e', '']).pid;
}

function writeLock(dir, lock) {
	fs.writeFileSync(path.join(dir, 'recorder.lock'), JSON.stringify(lock));
}

describe('recording finalize and salvage', function () {
	let root;
	beforeEach(function () {
		_clearRecordingCache();
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-fin-'));
	});
	afterEach(function () { fs.rmSync(root, { recursive: true, force: true }); });

	it('writes the final meta.json only after recording.json is complete', function () {
		const scenario = makeScenario(root, 'alpha');
		const recorder = startRecorder(scenario, 3);
		const metaFile = path.join(recorder.dir, 'meta.json');
		const renameSync = fs.renameSync;
		let metaWhenRecordingLanded = null;
		fs.renameSync = function (from, to) {
			if (path.basename(to) === 'recording.json') {
				metaWhenRecordingLanded = JSON.parse(fs.readFileSync(metaFile, 'utf8')).endReason;
			}
			return renameSync.apply(this, arguments);
		};
		try { recorder.finalize({ scenario: 'alpha', endReason: 'until', ticks: 2 }); }
		finally { fs.renameSync = renameSync; }
		assert.strictEqual(metaWhenRecordingLanded, 'in-progress');
		const recording = loadRecording(recorder.dir);
		assert.strictEqual(recording.meta.endReason, 'until', 'final meta embedded');
		assert.strictEqual(recording.frames.length, 3);
		assert.strictEqual(JSON.parse(fs.readFileSync(metaFile, 'utf8')).endReason, 'until');
		assert.deepStrictEqual(fs.readdirSync(recorder.dir).filter((n) => /lock|tmp|ndjson/.test(n)), [],
			'no lock, temp file or journal left behind');
	});

	it('refuses to salvage while the recorder is alive, and finalize still completes', function () {
		const scenario = makeScenario(root, 'alpha');
		const recorder = startRecorder(scenario, 3); // this process is the live recorder
		assert.throws(() => loadRecording(recorder.dir), (e) => e.statusCode === 409 && /still recording/.test(e.message));
		assert.ok(!fs.existsSync(path.join(recorder.dir, 'recording.json')), 'no copy built');
		assert.strictEqual(listRecordings(root, { scenario: 'alpha' })[0].status, 'running');
		recorder.finalize({ scenario: 'alpha', endReason: 'until', ticks: 2 });
		assert.strictEqual(loadRecording(recorder.dir).frames.length, 3);
		assert.strictEqual(listRecordings(root, { scenario: 'alpha' })[0].status, 'until');
	});

	it('salvages once the recorder has died, clearing its half-built temp file', function () {
		const scenario = makeScenario(root, 'alpha');
		const recorder = startRecorder(scenario, 3);
		const pid = deadPid();
		writeLock(recorder.dir, { pid: pid, host: os.hostname() });
		fs.writeFileSync(path.join(recorder.dir, 'recording.json.' + pid + '.tmp'), '{"meta":');
		assert.strictEqual(listRecordings(root, { scenario: 'alpha' })[0].status, 'running',
			'a fresh journal still reads as running until it goes stale');
		const recording = loadRecording(recorder.dir);
		assert.strictEqual(recording.frames.length, 3);
		assert.deepStrictEqual(fs.readdirSync(recorder.dir).filter((n) => /tmp$/.test(n)), []);
	});

	it('treats a lock from another host as alive only while the run is still writing', function () {
		const scenario = makeScenario(root, 'alpha');
		const recorder = startRecorder(scenario, 3);
		writeLock(recorder.dir, { pid: 1, host: 'some-other-host' });
		assert.throws(() => loadRecording(recorder.dir), /still recording/);
		const old = (Date.now() - 10 * 60 * 1000) / 1000;
		for (const name of ['frames.ndjson', 'recorder.lock']) fs.utimesSync(path.join(recorder.dir, name), old, old);
		assert.strictEqual(loadRecording(recorder.dir).frames.length, 3);
	});

	it('an in-progress run with recording.json in place is running while its recorder lives', function () {
		const scenario = makeScenario(root, 'alpha');
		const recorder = startRecorder(scenario, 1);
		// the moment between finalize's rename and its meta.json write
		fs.writeFileSync(path.join(recorder.dir, 'recording.json'), '{}');
		assert.strictEqual(listRecordings(root, { scenario: 'alpha' })[0].status, 'running');
		writeLock(recorder.dir, { pid: deadPid(), host: os.hostname() });
		assert.strictEqual(listRecordings(root, { scenario: 'alpha' })[0].status, 'interrupted');
	});

	// The bug this guards: the list said "finished" while a separate process
	// was still appending recording.json, and a replay opened then streamed a
	// truncated file.
	it('never lists a run as finished before its recording.json is complete (separate process)', function (done) {
		this.timeout(60000);
		const scenario = makeScenario(root, 'alpha');
		const child = fork(FINALIZE_CHILD, [scenario], { execArgv: [] });
		let finished = false;
		let failure = null;
		let checks = 0;
		child.on('message', (m) => {
			if (m === 'finalizing') poll();
			if (m === 'done') finished = true;
		});
		child.on('error', done);
		function poll() {
			_clearRecordingCache();
			const entry = listRecordings(root, { scenario: 'alpha' })[0];
			if (entry && entry.status === 'until') {
				checks++;
				try {
					const frames = JSON.parse(fs.readFileSync(entry.recordingPath, 'utf8')).frames.length;
					if (frames !== 200) failure = new Error('listed finished with ' + frames + ' frames');
				} catch (e) {
					failure = new Error('listed finished with an unreadable recording.json: ' + e.message);
				}
			}
			if (failure) { child.kill(); done(failure); return; }
			if (!finished || checks === 0) { setImmediate(poll); return; }
			done();
		}
	});
});

