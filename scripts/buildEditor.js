'use strict';

// Inliner: reads editor/template.html and replaces build markers to produce
// editor/dojo-editor.html (committed, no build step for users).
//
// Marker contract:
//   /*__DOJO_CONSTANTS__*/   -> window.DOJO_CONSTANTS = {json};
//   /*__SVG_PRIMITIVES__*/   -> raw content of src/render/svgPrimitives.js
//   /*__CREEP_SPRITE__*/     -> raw content of src/render/creepSprite.js
//   /*__ROOM_VISUAL_LIB__*/  -> raw content of lib/RoomVisual.js
//   /*__INVADER_SVG__*/      -> window.DOJO_INVADER_SVG = {JSON-stringified};

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function buildEditor() {
	const template = fs.readFileSync(path.join(ROOT, 'editor', 'template.html'), 'utf8');

	// --- DOJO_CONSTANTS ---
	const rawConstants = require('@screeps/common/lib/constants');
	const constantsObj = {};
	Object.keys(rawConstants).forEach(function (k) {
		if (k.startsWith('STRUCTURE_') || k.startsWith('RESOURCE_') || k === 'OK' || k === 'ERR_INVALID_ARGS' || k === 'CONTROLLER_LEVELS') {
			constantsObj[k] = rawConstants[k];
		}
	});
	const constantsBlock = 'window.DOJO_CONSTANTS = ' + JSON.stringify(constantsObj) + ';';

	// --- SVG_PRIMITIVES ---
	const svgPrimitivesContent = fs.readFileSync(
		path.join(ROOT, 'src', 'render', 'svgPrimitives.js'), 'utf8');

	// --- CREEP_SPRITE ---
	const creepSpriteContent = fs.readFileSync(
		path.join(ROOT, 'src', 'render', 'creepSprite.js'), 'utf8');

	// --- ROOM_VISUAL_LIB ---
	const roomVisualContent = fs.readFileSync(
		path.join(ROOT, 'lib', 'RoomVisual.js'), 'utf8');

	// --- INVADER_SVG ---
	const invaderSvgContent = fs.readFileSync(
		path.join(ROOT, 'src', 'render', 'assets', 'invader.svg'), 'utf8');
	const invaderBlock = 'window.DOJO_INVADER_SVG = ' + JSON.stringify(invaderSvgContent) + ';';

	// function-form replacement: string-form interprets $-sequences ($&, $', $N)
	// in the inlined source and would silently corrupt the output
	function inline(haystack, marker, content) {
		return haystack.replace(marker, function () { return content; });
	}

	let output = template;
	output = inline(output, '/*__DOJO_CONSTANTS__*/', constantsBlock);
	output = inline(output, '/*__SVG_PRIMITIVES__*/', svgPrimitivesContent);
	output = inline(output, '/*__CREEP_SPRITE__*/', creepSpriteContent);
	output = inline(output, '/*__ROOM_VISUAL_LIB__*/', roomVisualContent);
	output = inline(output, '/*__INVADER_SVG__*/', invaderBlock);

	fs.writeFileSync(path.join(ROOT, 'editor', 'dojo-editor.html'), output, 'utf8');
	console.log('[buildEditor] wrote editor/dojo-editor.html');
}

buildEditor();
