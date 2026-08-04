import { describe, it, expect } from 'vitest';
import { formatRecordingTimestamp, statusLabel, recordingSubtitle } from '../recordingLabels';

describe('formatRecordingTimestamp', () => {
  it('turns a recording directory name into a readable date and time', () => {
    expect(formatRecordingTimestamp('20260803-143442')).toBe('2026-08-03 14:34:42');
    expect(formatRecordingTimestamp('20260619-000000')).toBe('2026-06-19 00:00:00');
    expect(formatRecordingTimestamp('20261231-235959')).toBe('2026-12-31 23:59:59');
  });

  // The directory name is the only timestamp we are guaranteed to have, so an
  // unexpected shape must degrade to showing it raw rather than to 'NaN-NaN-NaN'.
  it('passes through anything that is not a recording directory name', () => {
    expect(formatRecordingTimestamp('not-a-timestamp')).toBe('not-a-timestamp');
    expect(formatRecordingTimestamp('2026080-143442')).toBe('2026080-143442');
    expect(formatRecordingTimestamp('')).toBe('');
  });
});

describe('statusLabel', () => {
  it('marks a live run and an abandoned one distinctly', () => {
    expect(statusLabel('running')).toBe('running…');
    expect(statusLabel('interrupted')).toBe('interrupted');
  });

  it('shows the runner’s own end reason unchanged', () => {
    expect(statusLabel('until')).toBe('until');
    expect(statusLabel('botDied')).toBe('botDied');
    expect(statusLabel('maxTicks')).toBe('maxTicks');
  });

  it('falls back to unknown for a missing status', () => {
    expect(statusLabel(undefined)).toBe('unknown');
    expect(statusLabel('')).toBe('unknown');
  });
});

describe('recordingSubtitle', () => {
  it('shows the tick count for a finished run', () => {
    expect(recordingSubtitle({ timestamp: '20260803-143442', status: 'until', ticks: 242 }))
      .toBe('2026-08-03 14:34:42 · 242t · until');
  });

  // meta.ticks is 0 until finalize() rewrites it, so a run in flight must not
  // claim it has done zero ticks.
  it('omits the tick count while a run is still in flight', () => {
    expect(recordingSubtitle({ timestamp: '20260803-143442', status: 'running', ticks: null }))
      .toBe('2026-08-03 14:34:42 · running…');
  });

  it('omits the tick count for a run that never finished', () => {
    expect(recordingSubtitle({ timestamp: '20260803-143442', status: 'interrupted', ticks: null }))
      .toBe('2026-08-03 14:34:42 · interrupted');
  });

  it('handles a zero-tick run that genuinely finished', () => {
    expect(recordingSubtitle({ timestamp: '20260803-143442', status: 'error', ticks: 0 }))
      .toBe('2026-08-03 14:34:42 · 0t · error');
  });

  // When the badge above already shows the status, repeating it reads as
  // 'interrupted / interrupted' down the row.
  it('can leave the status out when the badge already carries it', () => {
    expect(recordingSubtitle({ timestamp: '20260803-143442', status: 'interrupted', ticks: null }, { includeStatus: false }))
      .toBe('2026-08-03 14:34:42');
    expect(recordingSubtitle({ timestamp: '20260803-143442', status: 'maxTicks', ticks: 2500 }, { includeStatus: false }))
      .toBe('2026-08-03 14:34:42 · 2500t');
  });
});
