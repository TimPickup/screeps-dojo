'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { runScenario } = require('../../src/scenarioRunner');
const { loadRecording, createRecorder } = require('../../src/recording');

describe('recording a scenario run', function () {
	this.timeout(600000);

	it('writes a loadable recording with frames when DOJO_RECORD=1', async function () {
		process.env.DOJO_RECORD = '1';
		let result;
		try {
			result = await runScenario(path.join(__dirname, '..', '..', 'examples', 'walk-to-flag'));
		} finally {
			delete process.env.DOJO_RECORD;
		}
		assert.ok(result.recordingPath, 'result.recordingPath set');
		assert.ok(fs.existsSync(result.recordingPath), 'recording file exists');
		const recording = loadRecording(result.recordingPath);
		assert.strictEqual(recording.meta.scenario, 'walk-to-flag');
		assert.strictEqual(recording.meta.endReason, 'until');
		assert.strictEqual(recording.frames.length, result.ticks + 1); // initial + per tick
		assert.ok(recording.terrain.W0N0);
		const lastFrame = recording.frames[recording.frames.length - 1];
		const creep = lastFrame.objects.find(function (object) {
			return object.type === 'creep' && object.name === 'T';
		});
		assert.ok(creep, 'creep T present in final frame');

		// frames stream to an ndjson journal during the run (bounded memory),
		// then finalize() assembles recording.json and DELETES the redundant
		// journal so we don't keep a second full-size copy on disk.
		const recordingDir = path.dirname(result.recordingPath);
		const journalPath = path.join(recordingDir, 'frames.ndjson');
		assert.ok(!fs.existsSync(journalPath), 'frames.ndjson removed after finalize (no duplicate on disk)');
		// the assembled recording carries one frame per line of the old journal
		assert.strictEqual(recording.frames.length, result.ticks + 1, 'recording has every captured frame');
	});

	it('saves a partial recording when the run aborts mid-way', async function () {
		// temp scenario whose until() blows up at tick 3 — the recording up to
		// that point must still be written and surfaced on the error
		const os = require('os');
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-abort-'));
		const mapSource = path.join(__dirname, '..', '..', 'examples', 'walk-to-flag', 'map.json');
		fs.copyFileSync(mapSource, path.join(tempDir, 'map.json'));
		fs.writeFileSync(path.join(tempDir, 'scenario.js'), [
			"'use strict';",
			"const fs = require('fs');",
			"const path = require('path');",
			'module.exports = {',
			"	modules: { main: 'module.exports.loop = function () {};' },",
			'	maxTicks: 50,',
			'	setup: async function (world) {',
			"		const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'map.json'), 'utf8'));",
			"		await world.loadScenarioMaps([map], { room: 'W0N0', x: 5, y: 2 });",
			'	},',
			'	until: function (state) {',
			"		if (state.gameTime >= 4) throw new Error('boom at tick 3');",
			'		return false;',
			'	},',
			'	expect: function () {}',
			'};'
		].join('\n'));

		process.env.DOJO_RECORD = '1';
		let thrown = null;
		try {
			await runScenario(tempDir);
		} catch (error) {
			thrown = error;
		} finally {
			delete process.env.DOJO_RECORD;
		}
		assert.ok(thrown, 'run should abort');
		assert.ok(/boom/.test(String(thrown)), 'original error preserved: ' + thrown);
		assert.ok(thrown.recordingPath, 'partial recording path surfaced on the error');
		const recording = loadRecording(thrown.recordingPath);
		assert.strictEqual(recording.meta.endReason, 'aborted');
		assert.ok(/boom/.test(recording.meta.error), 'error captured in meta');
		assert.ok(recording.frames.length >= 3, 'frames captured up to the abort, got ' + recording.frames.length);
		assert.ok(recording.terrain.W0N0, 'terrain captured');
	});
});

describe('crash-safe recording journal', function () {
	it('salvages an unfinalized journal when loading the recording dir', function () {
		// Simulates a hard kill (SIGKILL/OOM): the journal exists on disk but
		// finalize never ran. loadRecording must assemble recording.json from
		// the journal and load it.
		const recorder = createRecorder('dojo-test-salvage');
		recorder.writeMeta({ scenario: 'dojo-test-salvage', endReason: 'in-progress', ticks: 0 });
		recorder.setTerrain({ W0N0: '0'.repeat(2500) });
		for (let i = 0; i < 3; i++) {
			recorder.addFrame({ gameTime: i, objects: [{ type: 'creep', name: 'T', x: i, y: 0 }] });
		}
		// no finalize() — this is the crash
		const recording = loadRecording(recorder.dir);
		assert.strictEqual(recording.frames.length, 3, 'all journaled frames recovered');
		assert.ok(recording.meta, 'meta present');
		assert.strictEqual(recording.meta.scenario, 'dojo-test-salvage');
		assert.strictEqual(recording.frames[2].objects[0].x, 2, 'frame content intact');
		assert.ok(fs.existsSync(path.join(recorder.dir, 'recording.json')), 'salvage assembled recording.json');
		fs.rmSync(path.dirname(recorder.dir), { recursive: true, force: true });
	});

	it('finalize is idempotent: second call no-ops and returns the same path', function () {
		const recorder = createRecorder('dojo-test-idempotent');
		recorder.writeMeta({ scenario: 'dojo-test-idempotent', endReason: 'in-progress', ticks: 0 });
		recorder.setTerrain({ W0N0: '0'.repeat(2500) });
		recorder.addFrame({ gameTime: 0, objects: [] });
		recorder.addFrame({ gameTime: 1, objects: [] });
		const meta = { scenario: 'dojo-test-idempotent', endReason: 'until', ticks: 1 };
		const first = recorder.finalize(meta);
		const second = recorder.finalize(meta);
		assert.strictEqual(second, first, 'same path from both calls');
		const recording = JSON.parse(fs.readFileSync(first, 'utf8'));
		assert.strictEqual(recording.meta.endReason, 'until');
		assert.strictEqual(recording.frames.length, 2);
		assert.ok(recording.terrain.W0N0);
		fs.rmSync(path.dirname(recorder.dir), { recursive: true, force: true });
	});
});
