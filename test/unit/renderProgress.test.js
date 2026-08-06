'use strict';

const assert = require('assert');
const { formatProgress, parseProgress } = require('../../src/render/progressProtocol');

describe('render progress protocol', function () {
	it('round-trips structured progress without treating ordinary logs as progress', function () {
		const event = { phase: 'rendering', completedFrames: 125, totalFrames: 500, percent: 25 };
		assert.deepStrictEqual(parseProgress(formatProgress(event)), event);
		assert.strictEqual(parseProgress('rendering a recording'), null);
		assert.strictEqual(parseProgress('DOJO_RENDER_PROGRESS {bad json'), null);
	});
});
