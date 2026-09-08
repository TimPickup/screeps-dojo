import { describe, it, expect } from 'vitest';
import { bootstrapCopy } from '../bootstrapCopy';

describe('bootstrapCopy', () => {
  it('calls a repair what it is, and never a first run', () => {
    const { title, sub } = bootstrapCopy('repair', false);
    expect(sub).not.toMatch(/first run/i);
    expect(title).toMatch(/update/i);
    // The two things someone mid-project needs to be told.
    expect(sub).toMatch(/untouched/i);
    expect(sub).toMatch(/carries on by itself/i);
  });

  it('uses first-run wording for a genuine first run', () => {
    expect(bootstrapCopy('install', false).sub).toMatch(/first run/i);
  });

  it('falls back to first-run wording when the reason is unknown', () => {
    // The status call is best effort; the screen still has to say something.
    expect(bootstrapCopy(null, false).sub).toMatch(/first run/i);
  });

  it('reports a failure over either reason', () => {
    for (const reason of ['install', 'repair', null] as const) {
      expect(bootstrapCopy(reason, true).sub).toMatch(/failed/i);
    }
  });
});
