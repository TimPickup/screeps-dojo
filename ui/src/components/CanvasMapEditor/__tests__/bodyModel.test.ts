import { describe, expect, it } from 'vitest';
import {
	addSegment, bodyToSegments, moveSegment, removeSegment, segmentsHits, segmentsPartCount,
	segmentsToBody, segmentsToParts, setSegmentBoost, setSegmentCount, setSegmentPart,
} from '../bodyModel';

describe('body <-> segments', () => {
	it('collapses runs but never reorders them', () => {
		// The case that makes segments necessary: the same part type twice,
		// either side of another, is a different creep from one merged run.
		expect(bodyToSegments(['move', 'work', 'work', 'move'])).toEqual([
			{ part: 'move', count: 1 },
			{ part: 'work', count: 2 },
			{ part: 'move', count: 1 },
		]);
	});

	it('reads a boost from the per-type map', () => {
		expect(bodyToSegments(['work', 'work', 'move'], { work: 'XUH2O' })).toEqual([
			{ part: 'work', count: 2, boost: 'XUH2O' },
			{ part: 'move', count: 1 },
		]);
	});

	it('lets a boost on the part itself win over the map, as the loader does', () => {
		expect(bodyToSegments([{ type: 'work', boost: 'LH' }, 'work'], { work: 'XUH2O' })).toEqual([
			{ part: 'work', count: 1, boost: 'LH' },
			{ part: 'work', count: 1, boost: 'XUH2O' },
		]);
	});

	it('writes a plain string body when nothing is boosted', () => {
		const segments = [{ part: 'work', count: 2 }, { part: 'move', count: 1 }];
		expect(segmentsToBody(segments)).toEqual({ body: ['work', 'work', 'move'] });
	});

	it('writes strings plus a boosts map when each part type has one boost', () => {
		const segments = [
			{ part: 'move', count: 1, boost: 'XZHO2' },
			{ part: 'work', count: 2, boost: 'XUH2O' },
			{ part: 'move', count: 1, boost: 'XZHO2' },
		];
		expect(segmentsToBody(segments)).toEqual({
			body: ['move', 'work', 'work', 'move'],
			boosts: { move: 'XZHO2', work: 'XUH2O' },
		});
	});

	it('falls back to per-part entries when one type carries two different boosts', () => {
		// A boosts map here would silently boost the unboosted half.
		const segments = [{ part: 'work', count: 1, boost: 'XUH2O' }, { part: 'work', count: 1 }];
		expect(segmentsToBody(segments)).toEqual({
			body: [{ type: 'work', boost: 'XUH2O' }, { type: 'work' }],
		});
	});

	it('round-trips through the engine shapes', () => {
		const original = ['move', 'work', 'work', 'move'];
		const { body, boosts } = segmentsToBody(bodyToSegments(original, { work: 'LH' }));
		expect(bodyToSegments(body, boosts)).toEqual(bodyToSegments(original, { work: 'LH' }));
	});
});

describe('segment counts', () => {
	it('totals parts and hits', () => {
		const segments = [{ part: 'work', count: 10 }, { part: 'move', count: 5 }];
		expect(segmentsPartCount(segments)).toBe(15);
		expect(segmentsHits(segments)).toBe(1500);
		expect(segmentsToParts(segments)).toHaveLength(15);
	});
});

describe('segment editing', () => {
	const base = [{ part: 'work', count: 2 }, { part: 'move', count: 3 }];

	it('never lets a count fall below 1', () => {
		expect(setSegmentCount(base, 0, 0)[0].count).toBe(1);
		expect(setSegmentCount(base, 0, -5)[0].count).toBe(1);
		expect(setSegmentCount(base, 0, 7)[0].count).toBe(7);
	});

	it('drops the boost when the part type changes', () => {
		const boosted = [{ part: 'work', count: 1, boost: 'XUH2O' }];
		expect(setSegmentPart(boosted, 0, 'move')).toEqual([{ part: 'move', count: 1 }]);
	});

	it('clears a boost when set to empty', () => {
		const boosted = [{ part: 'work', count: 1, boost: 'XUH2O' }];
		expect(setSegmentBoost(boosted, 0, '')).toEqual([{ part: 'work', count: 1 }]);
		expect(setSegmentBoost(base, 0, 'LH')[0].boost).toBe('LH');
	});

	it('adds a segment that differs from the last, so the new row is visible', () => {
		// Adjacent identical segments collapse on the next read (the map stores a
		// flat body), so appending another 'move' after a 'move' would look like
		// the button did nothing.
		expect(addSegment([{ part: 'move', count: 3 }])).toEqual([
			{ part: 'move', count: 3 }, { part: 'work', count: 1 },
		]);
		expect(addSegment([{ part: 'work', count: 3 }])).toEqual([
			{ part: 'work', count: 3 }, { part: 'move', count: 1 },
		]);
		expect(addSegment([])).toEqual([{ part: 'move', count: 1 }]);
		expect(addSegment([{ part: 'move', count: 1 }], 'heal')).toEqual([
			{ part: 'move', count: 1 }, { part: 'heal', count: 1 },
		]);
	});

	it('adds, removes and reorders', () => {
		expect(addSegment(base)).toHaveLength(3);
		expect(removeSegment(base, 0)).toEqual([{ part: 'move', count: 3 }]);
		expect(moveSegment(base, 1, -1)).toEqual([{ part: 'move', count: 3 }, { part: 'work', count: 2 }]);
		// out of range is a no-op, not a crash
		expect(moveSegment(base, 0, -1)).toEqual(base);
		expect(moveSegment(base, 1, 1)).toEqual(base);
	});
});
