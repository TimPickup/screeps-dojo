import { describe, it, expect } from 'vitest';
import { decidePhase, DEADLINE_MS, ACTION_FALLBACK, ACTION_TITLE } from '../hostAction';

// This decides when to stop telling someone their update is still coming and
// start telling them it died. Getting it wrong in either direction is bad: cry
// failure during a normal restart, or spin forever on one that will never end.

const base = { action: 'recreate', id: 'req-1', elapsedMs: 1000, unreachable: false };

describe('decidePhase', () => {
  it('waits while the action has not reported back', () => {
    expect(decidePhase({ ...base, lastResult: null })).toEqual({ phase: 'working' });
  });

  // The whole point of the overlay: a recreate stops the server it is talking
  // to, so failing on the first dropped fetch would fail every single time.
  it('treats an unreachable server as the expected middle, not a failure', () => {
    expect(decidePhase({ ...base, unreachable: true })).toEqual({ phase: 'working' });
  });

  it('gives up once an unreachable server passes the deadline', () => {
    const verdict = decidePhase({ ...base, unreachable: true, elapsedMs: DEADLINE_MS.recreate + 1 });
    expect(verdict).toEqual({ phase: 'failed', detail: 'The server has not come back.' });
  });

  it('finishes on our own successful result', () => {
    expect(decidePhase({ ...base, lastResult: { id: 'req-1', ok: true, message: null } }))
      .toEqual({ phase: 'done' });
  });

  it('reports the agent\'s own failure message', () => {
    expect(decidePhase({ ...base, lastResult: { id: 'req-1', ok: false, message: 'docker exited 1' } }))
      .toEqual({ phase: 'failed', detail: 'docker exited 1' });
  });

  // The agent keeps the PREVIOUS action's result until it finishes this one, so
  // reading that would end the wait immediately and wrongly.
  it('ignores a result belonging to an earlier request', () => {
    expect(decidePhase({ ...base, lastResult: { id: 'older', ok: true, message: null } }))
      .toEqual({ phase: 'working' });
    expect(decidePhase({ ...base, lastResult: { id: 'older', ok: false, message: 'boom' } }))
      .toEqual({ phase: 'working' });
  });

  it('distinguishes a slow action from one that was never picked up', () => {
    const overdue = { ...base, elapsedMs: DEADLINE_MS.recreate + 1, lastResult: null };
    expect(decidePhase({ ...overdue, busy: true }).phase).toBe('failed');
    expect(decidePhase({ ...overdue, busy: true })).toEqual({ phase: 'failed', detail: 'Still running after a long time.' });
    expect(decidePhase({ ...overdue, busy: false })).toEqual({ phase: 'failed', detail: 'The host agent never picked this up.' });
  });

  // An update rebuilds the image; holding it to a restart's deadline would
  // declare a perfectly healthy build dead partway through.
  it('gives an update far longer than a restart', () => {
    expect(DEADLINE_MS.update).toBeGreaterThan(DEADLINE_MS.restart * 5);
    expect(decidePhase({ ...base, action: 'update', unreachable: true, elapsedMs: DEADLINE_MS.recreate + 1 }))
      .toEqual({ phase: 'working' });
  });

  it('falls back to a sane deadline for an action it does not know', () => {
    expect(decidePhase({ ...base, action: 'mystery', unreachable: true, elapsedMs: 10 })).toEqual({ phase: 'working' });
    expect(decidePhase({ ...base, action: 'mystery', unreachable: true, elapsedMs: 10 * 60 * 1000 }).phase).toBe('failed');
  });
});

describe('failure guidance', () => {
  // The advice has to be the command that action would have run, or it sends
  // people to do the wrong thing at the worst moment.
  it('names a command for every action the agent offers', () => {
    for (const action of ['restart', 'recreate', 'update']) {
      expect(ACTION_FALLBACK[action]).toBeTruthy();
      expect(ACTION_TITLE[action]).toBeTruthy();
    }
    expect(ACTION_FALLBACK.update).toBe('npm run update');
    expect(ACTION_FALLBACK.recreate).toBe('npm run ui');
  });
});
