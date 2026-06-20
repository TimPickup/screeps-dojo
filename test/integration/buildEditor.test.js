'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUTPUT = path.join(ROOT, 'editor', 'dojo-editor.html');

describe('buildEditor', function () {
	before(function () {
		// Run the builder (require it; it writes the file as a side effect)
		// Clear require cache so re-runs are deterministic
		const builderPath = path.join(ROOT, 'scripts', 'buildEditor.js');
		delete require.cache[builderPath];
		require(builderPath);
	});

	it('generates editor/dojo-editor.html', function () {
		assert.ok(fs.existsSync(OUTPUT), 'dojo-editor.html must exist');
	});

	it('contains DOJO_CONSTANTS assignment', function () {
		const content = fs.readFileSync(OUTPUT, 'utf8');
		assert.ok(content.indexOf('DOJO_CONSTANTS') !== -1, 'must contain DOJO_CONSTANTS');
	});

	it('contains DojoSvgPrimitives (svgPrimitives inlined)', function () {
		const content = fs.readFileSync(OUTPUT, 'utf8');
		assert.ok(content.indexOf('DojoSvgPrimitives') !== -1, 'must contain DojoSvgPrimitives');
	});

	it('contains DojoCreepSprite (creepSprite inlined)', function () {
		const content = fs.readFileSync(OUTPUT, 'utf8');
		assert.ok(content.indexOf('DojoCreepSprite') !== -1, 'must contain DojoCreepSprite');
	});

	it('contains RoomVisual.prototype.structure (RoomVisual lib inlined)', function () {
		const content = fs.readFileSync(OUTPUT, 'utf8');
		assert.ok(content.indexOf('RoomVisual.prototype.structure') !== -1,
			'must contain RoomVisual.prototype.structure');
	});

	it('has no remaining /*__ markers', function () {
		const content = fs.readFileSync(OUTPUT, 'utf8');
		assert.ok(content.indexOf('/*__') === -1, 'all build markers must be replaced');
	});
});
