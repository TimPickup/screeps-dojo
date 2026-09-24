import { describe, it, expect } from 'vitest';
import type { Frame } from '../../api/types';
import { cachedCpuSummary, cpuSummary, formatCpuSummary } from '../cpuSummary';

// frames[0] is the pre-tick frame; cpus[i] becomes frame i+1 (tick i+1).
function recording(cpus: Array<number | null>, frame0Cpu: number | null = 999): Frame[] {
  return [frame0Cpu, ...cpus].map((cpu, i) => ({ gameTime: i, objects: [], flags: [], cpu }));
}

describe('cpuSummary', () => {
  it('averages every tick of a short recording, ignoring the pre-tick frame', () => {
    const summary = cpuSummary(recording([10, 20, 30]));
    expect(summary).toEqual({ warmupTicks: 15, warmup: 20, steady: null });
    expect(formatCpuSummary(summary, 3)).toBe('CPU avg: 20.0ms');
  });

  it('treats exactly 15 ticks as short', () => {
    expect(cpuSummary(recording(Array(15).fill(4))).steady).toBeNull();
  });

  it('splits a longer recording into the first 15 ticks and the rest', () => {
    const cpus = [...Array(15).fill(75.2), ...Array(30).fill(15.8)];
    const summary = cpuSummary(recording(cpus));
    expect(summary.warmup).toBeCloseTo(75.2, 5);
    expect(summary.steady).toBeCloseTo(15.8, 5);
    expect(formatCpuSummary(summary, 45)).toBe('CPU avg: 75.2ms then 15.8ms');
  });

  it('skips ticks with no cpu figure', () => {
    expect(cpuSummary(recording([10, null, 30])).warmup).toBe(20);
  });

  it('has nothing to show when no tick has a cpu figure', () => {
    expect(formatCpuSummary(cpuSummary(recording([null, null])), 2)).toBeNull();
    expect(formatCpuSummary(cpuSummary(recording([])), 0)).toBeNull();
  });
});

describe('formatCpuSummary placeholder', () => {
  it('matches the shape the figures will have', () => {
    expect(formatCpuSummary(null, 15)).toBe('CPU avg: ..ms');
    expect(formatCpuSummary(null, 16)).toBe('CPU avg: ..ms then ..ms');
  });
});

describe('cachedCpuSummary', () => {
  it('accepts what cpuSummary produces', () => {
    const summary = cpuSummary(recording([...Array(20).fill(5)]));
    expect(cachedCpuSummary(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  });

  it('ignores a cache made with another split, or malformed', () => {
    expect(cachedCpuSummary({ warmupTicks: 10, warmup: 1, steady: 2 })).toBeNull();
    expect(cachedCpuSummary({ warmupTicks: 15, warmup: '1', steady: null })).toBeNull();
    expect(cachedCpuSummary(undefined)).toBeNull();
  });
});
