// Undo/redo for the map editor.
//
// A map is small (50 terrain rows plus a few hundred objects), so the stack
// holds whole snapshots rather than diffs — simpler to reason about, and
// impossible to get out of step with the model. Kept pure so the reducer is
// testable without React.

export interface History<T> {
	past: T[];
	present: T;
	future: T[];
}

// Deep enough for a long editing session, shallow enough that a 50x50 map
// never costs real memory (~60 KB a snapshot at the top end).
export const HISTORY_LIMIT = 200;

export function initHistory<T>(present: T): History<T> {
	return { past: [], present, future: [] };
}

// A new edit. `coalesceKey` merges consecutive edits that belong to one gesture
// — dragging a terrain brush across twenty tiles should undo as one stroke, not
// twenty — by replacing the present instead of pushing it. The key is the
// caller's idea of "same gesture" (e.g. 'terrain:#'); undefined never merges.
export function pushHistory<T>(
	history: History<T>,
	present: T,
	coalesceKey?: string,
	lastKey?: string,
): { history: History<T>; key: string | undefined } {
	if (coalesceKey !== undefined && coalesceKey === lastKey) {
		return { history: { past: history.past, present, future: [] }, key: coalesceKey };
	}
	const past = history.past.concat(history.present);
	return {
		history: {
			past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
			present,
			future: [],
		},
		key: coalesceKey,
	};
}

// Replaces the present WITHOUT touching the stack — for a load from outside
// (the JSON view, a file switch), which is not an edit the user can undo past.
export function resetHistory<T>(present: T): History<T> {
	return initHistory(present);
}

export function canUndo<T>(history: History<T>): boolean {
	return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
	return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
	if (!history.past.length) return history;
	const present = history.past[history.past.length - 1];
	return {
		past: history.past.slice(0, -1),
		present,
		future: [history.present].concat(history.future),
	};
}

export function redo<T>(history: History<T>): History<T> {
	if (!history.future.length) return history;
	return {
		past: history.past.concat(history.present),
		present: history.future[0],
		future: history.future.slice(1),
	};
}
