'use strict';

const fs = require('fs');
const { pipeline } = require('stream/promises');
const { setTimeout: delay } = require('timers/promises');

// A short startup burst, then small paced reads. Backpressure and cancellation
// reach the file stream, so leaving a replay also stops its disk activity.
module.exports = async function streamReplay(file, res, options = {}) {
	const burst = options.burst ?? 2 * 1024 * 1024;
	const bytesPerSecond = options.bytesPerSecond ?? 8 * 1024 * 1024;
	const controller = new AbortController();
	const signal = controller.signal;
	const cancel = () => { if (!res.writableFinished) controller.abort(); };
	res.once('close', cancel);
	let bytes = 0;
	try {
		await pipeline(
			fs.createReadStream(file, { highWaterMark: 64 * 1024 }),
			async function* (source) {
				for await (const chunk of source) {
					const paced = Math.max(0, bytes + chunk.length - Math.max(bytes, burst));
					if (paced && !options.isUrgent?.()) await delay(Math.ceil(paced / bytesPerSecond * 1000), undefined, { signal });
					bytes += chunk.length;
					yield chunk;
				}
			},
			res,
			{ signal }
		);
	} finally {
		res.off('close', cancel);
	}
};
