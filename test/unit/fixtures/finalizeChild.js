'use strict';

// Child side of recordingFinalize.test.js's separate-process test: records
// ~40MB of frames into the scenario dir in argv[2], then finalizes while the
// parent polls the listing.
const { createRecorder } = require('../../../src/recording');

const recorder = createRecorder(process.argv[2]);
recorder.writeMeta({ scenario: 'alpha', endReason: 'in-progress', ticks: 0 });
const frame = JSON.stringify({ gameTime: 0, objects: 'x'.repeat(200000), flags: [] });
for (let i = 0; i < 200; i++) recorder.addFrame(null, null, frame);
process.send('finalizing', () => {
	recorder.finalize({ scenario: 'alpha', endReason: 'until', ticks: 199 });
	process.send('done', () => process.exit(0));
});
