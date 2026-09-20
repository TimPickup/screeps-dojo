import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, HISTORY_LIMIT, initHistory, pushHistory, redo, resetHistory, undo } from '../history';

describe('editor history', () => {
	it('undoes and redoes in order', () => {
		let history = initHistory('a');
		history = pushHistory(history, 'b').history;
		history = pushHistory(history, 'c').history;
		expect(history.present).toBe('c');
		history = undo(history);
		expect(history.present).toBe('b');
		history = undo(history);
		expect(history.present).toBe('a');
		expect(canUndo(history)).toBe(false);
		history = redo(history);
		expect(history.present).toBe('b');
		expect(canRedo(history)).toBe(true);
	});

	it('drops the redo branch once a new edit lands', () => {
		let history = initHistory('a');
		history = pushHistory(history, 'b').history;
		history = undo(history);
		history = pushHistory(history, 'c').history;
		expect(canRedo(history)).toBe(false);
		expect(history.present).toBe('c');
		expect(undo(history).present).toBe('a');
	});

	it('merges one gesture into a single undo step', () => {
		// A brush dragged over three tiles should undo as one stroke.
		let history = initHistory('a');
		let key: string | undefined;
		for (const value of ['b', 'c', 'd']) {
			const pushed = pushHistory(history, value, 'stroke:1', key);
			history = pushed.history;
			key = pushed.key;
		}
		expect(history.present).toBe('d');
		expect(history.past).toEqual(['a']);
		expect(undo(history).present).toBe('a');
	});

	it('starts a new step when the gesture key changes', () => {
		let history = initHistory('a');
		let pushed = pushHistory(history, 'b', 'stroke:1', undefined);
		history = pushed.history;
		pushed = pushHistory(history, 'c', 'stroke:2', pushed.key);
		history = pushed.history;
		expect(history.past).toEqual(['a', 'b']);
	});

	it('caps the stack instead of growing forever', () => {
		let history = initHistory(0);
		for (let i = 1; i <= HISTORY_LIMIT + 50; i++) history = pushHistory(history, i).history;
		expect(history.past).toHaveLength(HISTORY_LIMIT);
		expect(history.past[0]).toBe(50);
	});

	it('resets to a clean stack on an outside load', () => {
		let history = initHistory('a');
		history = pushHistory(history, 'b').history;
		history = resetHistory('fresh');
		expect(history.present).toBe('fresh');
		expect(canUndo(history)).toBe(false);
		expect(canRedo(history)).toBe(false);
	});

	it('undo and redo at the ends are no-ops', () => {
		const history = initHistory('a');
		expect(undo(history)).toBe(history);
		expect(redo(history)).toBe(history);
	});
});
