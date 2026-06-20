'use strict';

const assert = require('assert');
const { parse, merge } = require('../../src/server/envFile');

describe('envFile parse/merge', function () {
	const sample = '# comment\nDOJO_BOT_PATH=/old/path\n\n# token below\nDOJO_SCREEPS_TOKEN=abc123\n';

	it('parses key/values', function () {
		const v = parse(sample);
		assert.strictEqual(v.DOJO_BOT_PATH, '/old/path');
		assert.strictEqual(v.DOJO_SCREEPS_TOKEN, 'abc123');
	});

	it('merge updates a key, preserving comments and order', function () {
		const out = merge(sample, { DOJO_BOT_PATH: '/new/path' });
		assert.ok(out.includes('# comment'), 'comment kept');
		assert.ok(out.includes('# token below'), 'second comment kept');
		assert.ok(out.includes('DOJO_BOT_PATH=/new/path'), 'value updated');
		assert.ok(out.includes('DOJO_SCREEPS_TOKEN=abc123'), 'other key untouched');
		assert.ok(out.indexOf('DOJO_BOT_PATH') < out.indexOf('DOJO_SCREEPS_TOKEN'), 'order preserved');
	});

	it('merge appends new keys at the end', function () {
		const out = merge(sample, { DOJO_UI_PORT: '9000' });
		assert.ok(out.includes('DOJO_UI_PORT=9000'));
		assert.ok(out.indexOf('DOJO_UI_PORT') > out.indexOf('DOJO_SCREEPS_TOKEN'));
	});
});
