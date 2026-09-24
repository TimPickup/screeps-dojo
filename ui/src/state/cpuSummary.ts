import type { Frame } from '../api/types';

// The bot's first ticks (global reset, cache warm-up) cost far more CPU than
// its steady state, so a long recording reports the two separately.
export const CPU_WARMUP_TICKS = 15;

// Also the shape cached in a recording's meta.json (meta.cpuAvg), so a replay
// only ever has to be averaged once. warmupTicks records the split it was
// computed with: a cache made under a different split is ignored.
export interface CpuSummary {
  warmupTicks: number;
  warmup: number | null;   // mean over ticks 1..warmupTicks (every tick, for a short recording)
  steady: number | null;   // mean over the ticks after that; null for a short recording
}

function mean(frames: Frame[], from: number, to: number): number | null {
  let sum = 0, n = 0;
  for (let i = from; i < to; i++) {
    const cpu = frames[i]?.cpu;
    if (typeof cpu === 'number') { sum += cpu; n++; }
  }
  return n ? sum / n : null;
}

// Frame N is the state after tick N, so its cpu is what tick N used. Frame 0
// is captured before the first tick and says nothing about the run, so it is
// left out. Ticks the bot was skipped (no cpu figure) are left out too.
export function cpuSummary(frames: Frame[]): CpuSummary {
  const ticks = frames.length - 1;
  if (ticks <= CPU_WARMUP_TICKS) {
    return { warmupTicks: CPU_WARMUP_TICKS, warmup: mean(frames, 1, frames.length), steady: null };
  }
  return {
    warmupTicks: CPU_WARMUP_TICKS,
    warmup: mean(frames, 1, CPU_WARMUP_TICKS + 1),
    steady: mean(frames, CPU_WARMUP_TICKS + 1, frames.length),
  };
}

// A cached meta.cpuAvg, if it is one this version can trust.
export function cachedCpuSummary(value: unknown): CpuSummary | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const numberOrNull = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x));
  if (v.warmupTicks !== CPU_WARMUP_TICKS || !numberOrNull(v.warmup) || !numberOrNull(v.steady)) return null;
  return { warmupTicks: CPU_WARMUP_TICKS, warmup: v.warmup as number | null, steady: v.steady as number | null };
}

// "CPU avg: 75.2ms then 15.8ms". Without a summary yet, the same wording with
// "..ms" placeholders, shaped by the tick count so it doesn't jump when the
// figures land. null when there is nothing to say (a recording with no CPU).
export function formatCpuSummary(summary: CpuSummary | null, ticks: number): string | null {
  if (!summary) {
    return ticks > CPU_WARMUP_TICKS ? 'CPU avg: ..ms then ..ms' : 'CPU avg: ..ms';
  }
  const ms = (value: number | null) => (value === null ? '—' : value.toFixed(1) + 'ms');
  if (summary.warmup === null && summary.steady === null) return null;
  if (summary.steady === null) return 'CPU avg: ' + ms(summary.warmup);
  return 'CPU avg: ' + ms(summary.warmup) + ' then ' + ms(summary.steady);
}
