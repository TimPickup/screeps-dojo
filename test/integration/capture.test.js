'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const DojoWorld = require('../../src/dojoWorld');

describe('capture API', function () {
	this.timeout(600000);
	let world;

	before(async function () {
		world = new DojoWorld();
		await world.reset();
		const map = JSON.parse(fs.readFileSync(
			path.join(__dirname, '..', '..', 'examples', 'walk-to-flag', 'map.json'), 'utf8'));
		world.modules = { main: 'module.exports.loop = function () {};' };
		await world.loadScenarioMaps([map], { room: 'W0N0', x: 5, y: 2 });
		await world.addCreep({ room: 'W0N0', x: 25, y: 25, name: 'victim', body: ['move'] });
		// invader adjacent so an attack actionLog entry appears within a few ticks
		await world.addCreep({ room: 'W0N0', x: 26, y: 25, name: 'invader1', body: ['attack', 'move'], user: 'invader' });
		await world.start();
	});

	after(function () {
		if (world) world.stop();
	});

	it('captureTerrain returns 50 char rows per room', async function () {
		const terrain = await world.captureTerrain();
		assert.ok(terrain.W0N0, 'room W0N0 present');
		assert.strictEqual(terrain.W0N0.length, 50);
		assert.strictEqual(terrain.W0N0[0], '#'.repeat(50)); // border wall row
		assert.strictEqual(terrain.W0N0[25][10], '.');       // open floor
	});

	it('captureFrame returns objects, flags, and eventLog after combat ticks', async function () {
		let sawAction = false;
		for (let i = 0; i < 5 && !sawAction; i++) {
			await world.tick();
			const frame = await world.captureFrame();
			assert.ok(typeof frame.gameTime === 'number');
			assert.ok(Array.isArray(frame.objects));
			assert.ok(Array.isArray(frame.flags));
			assert.ok(frame.eventLog && typeof frame.eventLog === 'object');
			const withAction = frame.objects.filter(function (object) {
				return object.type === 'creep' && object.actionLog
					&& (object.actionLog.attack || object.actionLog.attacked);
			});
			const events = frame.eventLog.W0N0 || [];
			if (withAction.length > 0 || events.length > 0) sawAction = true;
		}
		assert.ok(sawAction, 'expected an attack to surface in actionLog or eventLog within 5 ticks');
	});
});
