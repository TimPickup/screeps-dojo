'use strict';

const assert = require('assert');
const { FakeRoomVisual, elementToSvg, svgEscape } = require('../../src/render/svgPrimitives');

describe('svgPrimitives', function () {
	it('FakeRoomVisual collects a circle element', function () {
		const visual = new FakeRoomVisual('W0N0');
		visual.circle(5, 7, { radius: 0.4, fill: '#ff0000' });
		assert.strictEqual(visual.elements.length, 1);
		assert.strictEqual(visual.elements[0].kind, 'circle');
		assert.strictEqual(visual.elements[0].x, 5);
		assert.strictEqual(visual.elements[0].y, 7);
	});

	it('elementToSvg of a text element escapes < in the text', function () {
		const element = { kind: 'text', text: 'a<b', x: 0, y: 0, style: {} };
		const svg = elementToSvg(element);
		assert.ok(svg.indexOf('&lt;') !== -1, 'less-than must be escaped to &lt;');
		assert.ok(svg.indexOf('<b') === -1, 'raw < must not appear inside the text content');
	});

	it('elementToSvg of a circle with stroke: transparent emits stroke="none"', function () {
		const element = { kind: 'circle', x: 3, y: 4, style: { stroke: 'transparent' } };
		const svg = elementToSvg(element);
		assert.ok(svg.indexOf('stroke="none"') !== -1, 'transparent stroke must become none');
	});
});
