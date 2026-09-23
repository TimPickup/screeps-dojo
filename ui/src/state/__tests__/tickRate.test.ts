import { describe, it, expect } from 'vitest';
import { addTickSample, tickRate, type TickSample } from '../tickRate';

function steady(ticksPerSecond: number, seconds: number): TickSample[] {
  const samples: TickSample[] = [];
  const step = 1000 / ticksPerSecond;
  for (let i = 0; i <= ticksPerSecond * seconds; i++) addTickSample(samples, i * step, i + 1);
  return samples;
}

describe('tickRate', () => {
  it('has nothing to say before two ticks', () => {
    expect(tickRate([], 0)).toBeNull();
    expect(tickRate(addTickSample([], 0, 1), 500)).toBeNull();
  });

  it('reads a steady rate over the last second', () => {
    const samples = steady(4, 5);
    expect(tickRate(samples, 5000)).toBeCloseTo(4, 5);
  });

  it('is not fooled by a rate slower than one tick per window', () => {
    const samples = steady(0.5, 10); // a tick every 2s
    expect(tickRate(samples, 10000)).toBeCloseTo(0.5, 5);
  });

  it('decays when the run stalls', () => {
    const samples = steady(4, 5);
    const later = tickRate(samples, 8000)!;
    expect(later).toBeLessThan(1);
    expect(later).toBeGreaterThan(0);
  });

  it('starts over when the tick goes backwards (a new run)', () => {
    const samples = steady(4, 2);
    addTickSample(samples, 3000, 1);
    expect(samples).toEqual([{ time: 3000, tick: 1 }]);
  });

  it('ignores a repeated tick', () => {
    const samples = addTickSample([], 0, 5);
    addTickSample(samples, 100, 5);
    expect(samples.length).toBe(1);
  });

  it('keeps memory bounded on a long run', () => {
    const samples = steady(20, 600);
    expect(samples.length).toBeLessThan(20 * 12);
  });
});
