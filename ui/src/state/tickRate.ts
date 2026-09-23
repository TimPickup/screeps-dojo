// Rolling ticks-per-second for a live run: the average over the last
// TICK_RATE_WINDOW_MS, measured against the newest sample at or before the
// window's start, so a run that stalls decays towards 0 instead of freezing on
// its last value. Pure so it can be tested without a DOM.
export const TICK_RATE_WINDOW_MS = 1000;
// Samples older than this are never the window's anchor, so they are dropped.
const MAX_SAMPLE_AGE_MS = 10000;

export interface TickSample {
	time: number; // ms, any monotonic clock
	tick: number;
}

// Appends a sample and trims the ones no rolling window can reach. Mutates and
// returns `samples`. A tick that went backwards means a new run: start over.
export function addTickSample(samples: TickSample[], time: number, tick: number): TickSample[] {
	const last = samples[samples.length - 1];
	if (last && tick < last.tick) samples.length = 0;
	if (last && tick === last.tick) return samples;
	samples.push({ time, tick });
	while (samples.length > 2 && time - samples[1].time > MAX_SAMPLE_AGE_MS) samples.shift();
	return samples;
}

// null until there are two samples to measure between.
export function tickRate(samples: TickSample[], now: number, windowMs = TICK_RATE_WINDOW_MS): number | null {
	if (samples.length < 2) return null;
	const windowStart = now - windowMs;
	// newest sample at or before the window start; else the oldest we have
	let anchor = samples[0];
	for (const sample of samples) {
		if (sample.time > windowStart) break;
		anchor = sample;
	}
	const latest = samples[samples.length - 1];
	// No tick inside the window (a slow or stalled run): measure the last
	// tick's interval stretched out to now, which decays smoothly rather than
	// snapping to 0 between ticks of a sim slower than 1 tick per window.
	if (anchor === latest) anchor = samples[samples.length - 2];
	const elapsed = now - anchor.time;
	if (elapsed <= 0) return null;
	return ((latest.tick - anchor.tick) * 1000) / elapsed;
}
