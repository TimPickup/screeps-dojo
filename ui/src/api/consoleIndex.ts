import type { Frame } from './types';

// A replay's console output, indexed rather than materialised.
//
// The naive approach — rebuild `string[]` of every line up to the current tick
// on each tick — is O(total lines) per tick, so a long recording with a chatty
// bot allocates (and throws away) megabytes of strings every frame of playback
// and every pixel of a scrub drag. That is what makes a big replay unusable.
//
// Instead we walk the frames once and remember only *where* each line lives:
// two Int32Arrays, ~8 bytes per line instead of a formatted copy. Formatting
// happens lazily, for the handful of lines actually on screen.
export interface ConsoleIndex {
  // Total console lines in the whole recording.
  total: number;
  // How many lines exist at or before `tick` — the console's length at that
  // point in the replay. O(1), and monotonic, so scrubbing either way is cheap.
  countUpTo(tick: number): number;
  // Formatted line at absolute index `i` ("[gameTime] text").
  line(i: number): string;
  // Formatted lines for the half-open range [from, to).
  slice(from: number, to: number): string[];
}

const EMPTY: ConsoleIndex = {
  total: 0,
  countUpTo: () => 0,
  line: () => '',
  slice: () => [],
};

export function buildConsoleIndex(frames: readonly Frame[] | undefined): ConsoleIndex {
  if (!frames) return EMPTY;
  let count = 0;
  let total = 0;
  // frameOf[i] = index of the frame line i came from.
  // endByFrame[f] = number of lines at or before frame f (a running total).
  let frameOf: Int32Array = new Int32Array(0);
  let endByFrame: Int32Array = new Int32Array(0);
  const grow = (array: Int32Array, needed: number) => {
    if (array.length >= needed) return array;
    const next = new Int32Array(Math.max(needed, array.length * 2, 64));
    next.set(array);
    return next;
  };
  // Streamed recordings append to the same array. Index only new frames;
  // geometric capacity growth avoids copying the full index on every batch.
  const update = () => {
    endByFrame = grow(endByFrame, frames.length);
    for (; count < frames.length; count++) {
      const lines = frames[count]?.console?.length || 0;
      frameOf = grow(frameOf, total + lines);
      frameOf.fill(count, total, total + lines);
      total += lines;
      endByFrame[count] = total;
    }
  };

  const line = (i: number): string => {
    update();
    if (i < 0 || i >= total) return '';
    const f = frameOf[i];
    const frame = frames[f];
    const slot = i - (f > 0 ? endByFrame[f - 1] : 0);
    const text = frame.console ? frame.console[slot] : undefined;
    if (text === undefined) return '';
    // A frame's gameTime is the clock AFTER its tick ran, so a line printed at
    // Game.time 1 lands on the frame stamped 2. Label it with the tick that
    // printed it — which is also the tick number the scrubber shows.
    return '[' + (typeof frame.gameTime === 'number' ? frame.gameTime - 1 : f) + '] ' + text;
  };

  return {
    get total() { update(); return total; },
    countUpTo(tick: number) {
      update();
      if (tick < 0 || !count) return 0;
      return endByFrame[tick >= count ? count - 1 : tick];
    },
    line,
    slice(from: number, to: number) {
      update();
      const start = Math.max(0, from);
      const end = Math.min(total, to);
      const out: string[] = [];
      for (let i = start; i < end; i++) out.push(line(i));
      return out;
    },
  };
}

// The live Run tab already holds its console as a plain growing array; wrap it
// in the same shape so ConsoleDrawer has exactly one code path (and inherits
// the same window cap).
export function arrayConsoleIndex(lines: readonly string[]): ConsoleIndex {
  return {
    total: lines.length,
    countUpTo: () => lines.length,
    line: (i) => lines[i] ?? '',
    slice: (from, to) => lines.slice(Math.max(0, from), Math.min(lines.length, to)) as string[],
  };
}
