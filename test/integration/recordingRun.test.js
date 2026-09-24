'use strict';

// Mocha hosts this suite's mock servers sequentially in one dedicated
// process — the isolation the fast mock-engine's in-process mode asserts
// (src/serverBoot.js); declare it, like smoke.js and runScenarioChild.js do.
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runScenario } = require('../../src/scenarioRunner');
const { loadRecording, createRecorder } = require('../../src/recording');

describe('recording a scenario run', function () {
	this.timeout(600000);

	// Temp scenario directories made by the tests below. A scenario's
	// recordings live inside it now, so an uncleaned one is not an empty
	// directory — it is every frame of that run.
	const cleanup = [];
	after(function () {
		for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true });
		cleanup.length = 0;
	});

	it('writes a loadable recording with frames when DOJO_RECORD=1', async function () {
		process.env.DOJO_RECORD = '1';
		let result;
		try {
			result = await runScenario(path.join(__dirname, '..', '..', 'examples', 'walk-to-flag'));
		} finally {
			delete process.env.DOJO_RECORD;
		}
		assert.ok(result.recordingPath, 'result.recordingPath set');
		// The recording lands in examples/walk-to-flag/recordings/ — a committed
		// directory — so this run's own copy goes at the end of the file.
		cleanup.push(path.dirname(result.recordingPath));
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
		const endDir = path.join(path.dirname(result.recordingPath), 'end state');
		const endMap = JSON.parse(fs.readFileSync(path.join(endDir, 'map.W0N0.json'), 'utf8'));
		assert.deepStrictEqual(endMap.terrain, recording.terrain.W0N0);
		const endCreep = endMap.creeps.find(c => c.name === 'T');
		assert.strictEqual(endCreep.x, creep.x);
		assert.strictEqual(endCreep.y, creep.y);
		assert.strictEqual(endCreep.owner, 'me');
		assert.ok(JSON.parse(fs.readFileSync(path.join(endDir, 'memory.json'), 'utf8')));
		assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(endDir, 'segments.json'), 'utf8')), {});

		// frames stream to an ndjson journal during the run (bounded memory),
		// then finalize() assembles recording.json and DELETES the redundant
		// journal so we don't keep a second full-size copy on disk.
		const recordingDir = path.dirname(result.recordingPath);
		const journalPath = path.join(recordingDir, 'frames.ndjson');
		assert.ok(!fs.existsSync(journalPath), 'frames.ndjson removed after finalize (no duplicate on disk)');
		// the assembled recording carries one frame per line of the old journal
		assert.strictEqual(recording.frames.length, result.ticks + 1, 'recording has every captured frame');
	});

	it('exports every room and final memory plus active, inactive and empty segments', async function () {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-end-state-'));
		cleanup.push(dir);
		fs.copyFileSync(path.join(__dirname, '../../examples/walk-to-flag/map.json'), path.join(dir, 'map.json'));
		fs.writeFileSync(path.join(dir, 'map.W3N0.json'), JSON.stringify({
			room: 'W3N0', terrain: Array(50).fill('.'.repeat(50)), structures: [], creeps: []
		}));
		fs.writeFileSync(path.join(dir, 'scenario.js'), `module.exports = {
			maxTicks: 2,
			modules: { main: 'module.exports.loop = function () { Memory.tick = Game.time; RawMemory.segments[7] = String(Game.time); };' },
			setup: async function (world) {
				await world.loadAllMaps({ room: 'W0N0', x: 5, y: 2 });
				await world.seedMemory({ seeded: true });
				await world.seedSegments({ 99: 'inactive', 98: '' });
				await world.addCreep({ room: 'W0N0', x: 5, y: 3, name: 'Aged', body: ['move'], ticksToLive: 42 });
			},
			expect: function () {}
		};`);
		const result = await runScenario(dir, { record: true });
		const recording = loadRecording(result.recordingPath);
		const endDir = path.join(path.dirname(result.recordingPath), 'end state');
		const read = name => JSON.parse(fs.readFileSync(path.join(endDir, name), 'utf8'));
		const memory = read('memory.json');
		assert.strictEqual(memory.seeded, true);
		assert.strictEqual(memory.tick, recording.frames[recording.frames.length - 1].gameTime - 1);
		assert.deepStrictEqual(read('segments.json'), { 7: String(memory.tick), 98: '', 99: 'inactive' });
		for (const room of ['W0N0', 'W3N0']) {
			const map = read('map.' + room + '.json');
			assert.strictEqual(map.room, room);
			assert.deepStrictEqual(map.terrain, recording.terrain[room]);
			for (const structure of map.structures) {
				assert.ok(!Object.hasOwn(structure, '$loki'));
				assert.ok(!Object.hasOwn(structure, 'meta'));
			}
		}
		// Reload the actual export, then verify compatibility with exports made
		// before database bookkeeping was excluded.
		const DojoWorld = require('../../src/dojoWorld');
		const world = new DojoWorld({ scenarioDir: endDir });
		try {
			await world.reset();
			world.modules = { main: 'module.exports.loop = function () {};' };
			await world.loadAllMaps({}, { memory: memory, segments: read('segments.json') });
			const restored = await world.captureFrame();
			const original = recording.frames[recording.frames.length - 1];
			const exportedCreeps = read('map.W0N0.json').creeps;
			assert.ok(exportedCreeps.length > 0);
			for (const creep of exportedCreeps) {
				const before = original.objects.find(object => object._id === creep.id);
				const after = restored.objects.find(object => object._id === creep.id);
				assert.strictEqual(creep.ticksToLive, before.ageTime - original.gameTime);
				assert.strictEqual(after.ageTime - restored.gameTime, creep.ticksToLive);
			}
			await world.addObject('W3N0', 'container', 10, 10, {
				id: 'legacy-export-container', $loki: 77, meta: { revision: 3 }, store: { energy: 200 }
			});
			await world.start();
			await world.tick();
			const state = await world.readState();
			assert.ok(state.objects.some(object => object._id === 'legacy-export-container'));
		} finally {
			world.stop();
		}
	});

	it('saves a partial recording when the run aborts mid-way', async function () {
		// temp scenario whose until() blows up at tick 3 — the recording up to
		// that point must still be written and surfaced on the error
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-abort-'));
		// The recording now lands INSIDE tempDir, so clean it up rather than
		// leaving a dojo-abort-* directory (and its frames) behind on every run.
		cleanup.push(tempDir);
		const mapSource = path.join(__dirname, '..', '..', 'examples', 'walk-to-flag', 'map.json');
		fs.copyFileSync(mapSource, path.join(tempDir, 'map.json'));
		fs.writeFileSync(path.join(tempDir, 'scenario.js'), [
			"'use strict';",
			'module.exports = {',
			"	modules: { main: 'module.exports.loop = function () {};' },",
			'	maxTicks: 50,',
			'	setup: async function (world) {',
			"		await world.loadAllMaps({ room: 'W0N0', x: 5, y: 2 });",
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
		const endDir = path.join(path.dirname(thrown.recordingPath), 'end state');
		assert.ok(fs.existsSync(path.join(endDir, 'map.W0N0.json')));
		assert.ok(fs.existsSync(path.join(endDir, 'memory.json')));
		assert.ok(fs.existsSync(path.join(endDir, 'segments.json')));
	});
});

describe('crash-safe recording journal', function () {
	// createRecorder takes the SCENARIO directory and writes into its
	// recordings/ — so these use a throwaway scenario dir rather than a name.
	let scratch;
	beforeEach(function () { scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-rec-scratch-')); });
	afterEach(function () { fs.rmSync(scratch, { recursive: true, force: true }); });

	it('salvages an unfinalized journal when loading the recording dir', function () {
		// Simulates a hard kill (SIGKILL/OOM): the journal exists on disk but
		// finalize never ran. loadRecording must assemble recording.json from
		// the journal and load it.
		const recorder = createRecorder(path.join(scratch, 'dojo-test-salvage'));
		recorder.writeMeta({ scenario: 'dojo-test-salvage', endReason: 'in-progress', ticks: 0 });
		recorder.setTerrain({ W0N0: '0'.repeat(2500) });
		for (let i = 0; i < 3; i++) {
			recorder.addFrame({ gameTime: i, objects: [{ type: 'creep', name: 'T', x: i, y: 0 }] });
		}
		// no finalize() — this is the crash. The recorder is this process, so
		// point its lock at one that has exited, as a killed run's would.
		const deadPid = require('child_process').spawnSync(process.execPath, ['-e', '']).pid;
		fs.writeFileSync(path.join(recorder.dir, 'recorder.lock'), JSON.stringify({ pid: deadPid, host: os.hostname() }));
		const recording = loadRecording(recorder.dir);
		assert.strictEqual(recording.frames.length, 3, 'all journaled frames recovered');
		assert.ok(recording.meta, 'meta present');
		assert.strictEqual(recording.meta.scenario, 'dojo-test-salvage');
		assert.strictEqual(recording.frames[2].objects[0].x, 2, 'frame content intact');
		assert.ok(fs.existsSync(path.join(recorder.dir, 'recording.json')), 'salvage assembled recording.json');
	});

	it('finalize is idempotent: second call no-ops and returns the same path', function () {
		const recorder = createRecorder(path.join(scratch, 'dojo-test-idempotent'));
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
	});
});
