// A creep body as the editor thinks about it: an ORDERED list of segments,
// each one a part type, a count of at least 1, and an optional boost.
//
// Order matters in Screeps — damage eats parts from the front, so `1 move,
// 10 work, 9 move` is a genuinely different creep from `11 move, 10 work` —
// and the engine keeps the body as a flat array. Segments are just a compact
// view of that array: they collapse runs, they never reorder it.

import { BODY_PART_HITS, MAX_CREEP_SIZE } from './gameData';

export interface BodySegment {
	part: string;
	count: number;
	boost?: string;
}

type RawPart = string | { type?: string; boost?: string };

function partType(part: RawPart): string | null {
	if (typeof part === 'string') return part;
	if (part && typeof part === 'object' && typeof part.type === 'string') return part.type;
	return null;
}

// Flat engine body (+ an optional per-type `boosts` map) -> ordered segments.
// A boost written on the part itself wins over the map, exactly as the loader
// resolves it (src/dojoWorld.js buildCreepBody).
export function bodyToSegments(body: unknown, boosts?: Record<string, string>): BodySegment[] {
	if (!Array.isArray(body)) return [];
	const segments: BodySegment[] = [];
	for (const raw of body as RawPart[]) {
		const part = partType(raw);
		if (!part) continue;
		const own = typeof raw === 'object' && raw ? raw.boost : undefined;
		const boost = own !== undefined ? own : boosts?.[part];
		const last = segments[segments.length - 1];
		if (last && last.part === part && last.boost === boost) last.count++;
		else segments.push(boost ? { part, count: 1, boost } : { part, count: 1 });
	}
	return segments;
}

export function segmentsPartCount(segments: readonly BodySegment[]): number {
	let total = 0;
	for (const segment of segments) total += Math.max(0, segment.count);
	return total;
}

export function segmentsHits(segments: readonly BodySegment[]): number {
	return segmentsPartCount(segments) * BODY_PART_HITS;
}

export function segmentsOverSize(segments: readonly BodySegment[]): boolean {
	return segmentsPartCount(segments) > MAX_CREEP_SIZE;
}

// Flat per-part list for the grid preview, in body order.
export function segmentsToParts(segments: readonly BodySegment[]): Array<{ part: string; boost?: string }> {
	const parts: Array<{ part: string; boost?: string }> = [];
	for (const segment of segments) {
		for (let i = 0; i < Math.max(0, segment.count); i++) {
			parts.push(segment.boost ? { part: segment.part, boost: segment.boost } : { part: segment.part });
		}
	}
	return parts;
}

// Segments -> what goes in the map file. Three shapes, picked for readability,
// all three of which the loader accepts:
//
//   no boosts anywhere        -> ["work","work","move"]
//   one boost per part type   -> ["work","move"] + boosts: { work: "XUH2O" }
//   same type, two boosts     -> [{type:"work",boost:"XUH2O"},{type:"work"}]
//
// The third case is rare but legal, and collapsing it into a `boosts` map would
// silently boost the unboosted parts — so it falls back to explicit entries.
export function segmentsToBody(segments: readonly BodySegment[]): {
	body: Array<string | { type: string; boost?: string }>;
	boosts?: Record<string, string>;
} {
	const seenBoost: Record<string, string | undefined> = {};
	let consistent = true;
	let anyBoost = false;
	for (const segment of segments) {
		if (segment.boost) anyBoost = true;
		if (Object.prototype.hasOwnProperty.call(seenBoost, segment.part)) {
			if (seenBoost[segment.part] !== segment.boost) consistent = false;
		} else {
			seenBoost[segment.part] = segment.boost;
		}
	}

	if (!anyBoost) {
		return { body: segmentsToParts(segments).map((part) => part.part) };
	}
	if (consistent) {
		const boosts: Record<string, string> = {};
		for (const part of Object.keys(seenBoost)) {
			const boost = seenBoost[part];
			if (boost) boosts[part] = boost;
		}
		return { body: segmentsToParts(segments).map((part) => part.part), boosts };
	}
	return {
		body: segmentsToParts(segments).map((part) => (part.boost ? { type: part.part, boost: part.boost } : { type: part.part })),
	};
}

// --- segment list editing ----------------------------------------------------
// Pure helpers so the panel is a thin shell over tested logic. Every one
// returns a NEW array; a segment never drops below count 1 (removing the last
// one is a delete, which is its own action).

export function setSegmentCount(segments: readonly BodySegment[], index: number, count: number): BodySegment[] {
	const next = segments.slice();
	if (!next[index]) return next;
	next[index] = { ...next[index], count: Math.max(1, Math.floor(count) || 1) };
	return next;
}

export function setSegmentPart(segments: readonly BodySegment[], index: number, part: string): BodySegment[] {
	const next = segments.slice();
	if (!next[index]) return next;
	// Changing the type invalidates the boost — a MOVE boost is not a WORK boost.
	const { boost, ...rest } = next[index];
	void boost;
	next[index] = { ...rest, part };
	return next;
}

export function setSegmentBoost(segments: readonly BodySegment[], index: number, boost: string): BodySegment[] {
	const next = segments.slice();
	if (!next[index]) return next;
	if (!boost) {
		const { boost: dropped, ...rest } = next[index];
		void dropped;
		next[index] = rest;
	} else {
		next[index] = { ...next[index], boost };
	}
	return next;
}

// A new segment deliberately differs from the one before it. The map file
// stores a FLAT body, so two adjacent segments of the same part and boost are
// the same creep and collapse back into one on the next read — appending
// another 'move' after a 'move' would look like the button did nothing.
export function addSegment(segments: readonly BodySegment[], part?: string): BodySegment[] {
	const last = segments[segments.length - 1];
	const chosen = part ?? (last && last.part === 'move' ? 'work' : 'move');
	return segments.concat({ part: chosen, count: 1 });
}

export function removeSegment(segments: readonly BodySegment[], index: number): BodySegment[] {
	return segments.filter((_, i) => i !== index);
}

export function moveSegment(segments: readonly BodySegment[], index: number, delta: number): BodySegment[] {
	const target = index + delta;
	if (index < 0 || index >= segments.length || target < 0 || target >= segments.length) return segments.slice();
	const next = segments.slice();
	const [moved] = next.splice(index, 1);
	next.splice(target, 0, moved);
	return next;
}
