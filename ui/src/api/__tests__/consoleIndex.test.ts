import { describe, expect, it } from 'vitest';
import type { Frame } from '../types';
import { arrayConsoleIndex, buildConsoleIndex } from '../consoleIndex';

function frame(gameTime: number, lines?: string[]): Frame {
  return { gameTime, objects: [], flags: [], ...(lines ? { console: lines } : {}) };
}

describe('buildConsoleIndex', () => {
  it('indexes appended frames, including after an initially empty console', () => {
    const growing: Frame[] = [];
    const index = buildConsoleIndex(growing);
    expect(index.total).toBe(0);
    growing.push(frame(1), frame(2, ['first']));
    expect(index.countUpTo(1)).toBe(1);
    growing.push(frame(3, ['second', 'third']));
    expect(index.total).toBe(3);
    expect(index.countUpTo(1)).toBe(1);
    expect(index.slice(0, 3)).toEqual(['[1] first', '[2] second', '[2] third']);
  });
  const frames = [
    frame(100, ['a', 'b']),
    frame(101),
    frame(102, ['c']),
    frame(103, []),
    frame(104, ['d', 'e', 'f']),
  ];
  const idx = buildConsoleIndex(frames);

  it('counts every line once', () => {
    expect(idx.total).toBe(6);
  });

  // A frame is stamped with the clock AFTER its tick ran, so the label is one
  // behind gameTime: the tick that actually printed the line.
  it('prefixes each line with the tick that printed it', () => {
    expect(idx.slice(0, 6)).toEqual(['[99] a', '[99] b', '[101] c', '[103] d', '[103] e', '[103] f']);
  });

  it('reports the line count at or before a tick', () => {
    expect(idx.countUpTo(0)).toBe(2);
    expect(idx.countUpTo(1)).toBe(2);
    expect(idx.countUpTo(2)).toBe(3);
    expect(idx.countUpTo(3)).toBe(3);
    expect(idx.countUpTo(4)).toBe(6);
  });

  it('clamps out-of-range ticks', () => {
    expect(idx.countUpTo(-5)).toBe(0);
    expect(idx.countUpTo(999)).toBe(6);
  });

  it('slices a window without touching the rest of the log', () => {
    expect(idx.slice(3, 5)).toEqual(['[103] d', '[103] e']);
    expect(idx.slice(-2, 1)).toEqual(['[99] a']);
    expect(idx.slice(4, 99)).toEqual(['[103] e', '[103] f']);
    expect(idx.slice(6, 10)).toEqual([]);
  });

  it('is stable regardless of the order ranges are asked for', () => {
    // Scrubbing backwards asks for earlier windows after later ones; the index
    // holds no cursor, so results must not depend on the access order.
    const forwards = [idx.slice(0, 2), idx.slice(2, 4), idx.slice(4, 6)];
    const backwards = [idx.slice(4, 6), idx.slice(2, 4), idx.slice(0, 2)].reverse();
    expect(forwards).toEqual(backwards);
  });

  it('falls back to the frame index when gameTime is missing', () => {
    const noTime = buildConsoleIndex([{ objects: [], flags: [], console: ['x'] } as unknown as Frame]);
    expect(noTime.slice(0, 1)).toEqual(['[0] x']);
  });

  it('handles recordings with no console output', () => {
    for (const empty of [buildConsoleIndex([]), buildConsoleIndex(undefined), buildConsoleIndex([frame(1), frame(2, [])])]) {
      expect(empty.total).toBe(0);
      expect(empty.countUpTo(5)).toBe(0);
      expect(empty.slice(0, 10)).toEqual([]);
    }
  });
});

describe('arrayConsoleIndex', () => {
  it('exposes a plain array through the same shape', () => {
    const idx = arrayConsoleIndex(['a', 'b', 'c']);
    expect(idx.total).toBe(3);
    expect(idx.countUpTo(0)).toBe(3);
    expect(idx.slice(1, 99)).toEqual(['b', 'c']);
    expect(idx.line(2)).toBe('c');
  });
});
