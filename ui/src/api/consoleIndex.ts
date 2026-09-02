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
  const count = frames ? frames.length : 0;
  if (!frames || count === 0) return EMPTY;

  let total = 0;
  for (let i = 0; i < count; i++) {
    const c = frames[i] && frames[i].console;
    if (c) total += c.length;
  }
  if (total === 0) return EMPTY;

  // frameOf[i] = index of the frame line i came from.
  // endByFrame[f] = number of lines at or before frame f (a running total).
  const frameOf = new Int32Array(total);
  const endByFrame = new Int32Array(count);
  let n = 0;
  for (let f = 0; f < count; f++) {
    const c = frames[f] && frames[f].console;
    if (c) for (let j = 0; j < c.length; j++) frameOf[n++] = f;
    endByFrame[f] = n;
  }

  const line = (i: number): string => {
    if (i < 0 || i >= total) return '';
    const f = frameOf[i];
    const frame = frames[f];
    const slot = i - (f > 0 ? endByFrame[f - 1] : 0);
    const text = frame.console ? frame.console[slot] : undefined;
    if (text === undefined) return '';
    return '[' + (frame.gameTime ?? f) + '] ' + text;
  };

  return {
    total,
    countUpTo(tick: number) {
      if (tick < 0) return 0;
      return endByFrame[tick >= count ? count - 1 : tick];
    },
    line,
    slice(from: number, to: number) {
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
