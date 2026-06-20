'use strict';

const assert = require('assert');
const { FakeRoomVisual, installRoomVisualLibrary } = require('../../src/render/fakeRoomVisual');

describe('FakeRoomVisual', function () {
	it('collects the five primitives with styles', function () {
		const visual = new FakeRoomVisual('W0N0');
		visual.line(1, 1, 2, 2, { color: '#ff0000', width: 0.1 });
		visual.circle(3, 3, { radius: 0.5, fill: '#00ff00' });
		visual.rect(4, 4, 2, 1, { fill: '#0000ff' });
		visual.poly([[5, 5], [6, 6]], { stroke: '#ffffff' });
		visual.text('hi', 7, 7, { color: '#000000' });
		const kinds = visual.elements.map(function (element) { return element.kind; });
		assert.deepStrictEqual(kinds, ['line', 'circle', 'rect', 'poly', 'text']);
	});

	it('poly accepts both [x,y] arrays and {x,y} objects', function () {
		const visual = new FakeRoomVisual('W0N0');
		visual.poly([[1, 2], { x: 3, y: 4 }], {});
		assert.deepStrictEqual(visual.elements[0].points, [[1, 2], [3, 4]]);
	});

	it('clear empties the element list', function () {
		const visual = new FakeRoomVisual('W0N0');
		visual.circle(1, 1, {});
		visual.clear();
		assert.strictEqual(visual.elements.length, 0);
	});

	it('loads the dojo RoomVisual library on top (structure/speech/connectRoads)', function () {
		installRoomVisualLibrary();
		const visual = new FakeRoomVisual('W0N0');
		assert.strictEqual(typeof visual.structure, 'function');
		visual.structure(10, 10, 'spawn');
		assert.ok(visual.elements.length > 0, 'spawn drawing produced elements');
		visual.structure(11, 10, 'road');
		visual.structure(12, 10, 'road');
		visual.connectRoads();
		visual.speech('hi', 13, 10);
		assert.ok(visual.elements.some(function (element) { return element.kind === 'text'; }));
	});

	it('draws every structure type the lib supports without throwing', function () {
		installRoomVisualLibrary();
		const visual = new FakeRoomVisual('W0N0');
		const types = ['factory', 'extension', 'spawn', 'powerSpawn', 'link', 'terminal',
			'lab', 'tower', 'road', 'rampart', 'constructedWall', 'storage', 'observer',
			'nuker', 'container', 'unknownThing'];
		for (const type of types) visual.structure(20, 20, type);
		assert.ok(visual.elements.length > 0);
	});
});
