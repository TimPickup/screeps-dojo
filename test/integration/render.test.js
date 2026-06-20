'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderRecording } = require('../../src/render/videoRenderer');

function makeTerrain() {
	const rows = [];
	for (let y = 0; y < 50; y++) {
		let row = '';
		for (let x = 0; x < 50; x++) row += (x === 0 || x === 49 || y === 0 || y === 49) ? '#' : '.';
		rows.push(row);
	}
	return rows;
}

describe('video renderer', function () {
	this.timeout(600000);

	it('renders a small synthetic recording to MP4', async function () {
		const frames = [];
		for (let i = 0; i < 4; i++) {
			frames.push({ gameTime: i + 1, flags: [], eventLog: {}, objects: [
				{ _id: 'c1', type: 'creep', name: 'T', room: 'W0N0', x: 10 + i, y: 10,
					hits: 100, hitsMax: 100, user: 'user1' },
				{ _id: 's1', type: 'spawn', room: 'W0N0', x: 20, y: 20, user: 'user1' }
			] });
		}
		const recording = {
			meta: { scenario: 'synthetic', botUserId: 'user1', ticks: 3 },
			terrain: { W0N0: makeTerrain() },
			frames: frames
		};
		const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-render-'));
		const outFile = path.join(outDir, 'out.mp4');
		// low fps keeps the test fast: 3 transitions x (8 animate + 2 hold) + final hold
		await renderRecording(recording, outFile, { pixelsPerRoom: 300, fps: 10 });
		assert.ok(fs.existsSync(outFile), 'mp4 exists');
		const size = fs.statSync(outFile).size;
		assert.ok(size > 1000, 'mp4 has content, got ' + size + ' bytes');
	});
});
