import { describe, it, expect } from 'vitest';
import { decidePhase, describeProgress, DEADLINE_MS, PICKUP_GRACE_MS, ACTION_FALLBACK, ACTION_TITLE } from '../hostAction';

// This decides when to stop telling someone their update is still coming and
// start telling them it died. Getting it wrong in either direction is bad: cry
// failure during a normal restart, or spin forever on one that will never end.

// pending by default: the usual case is a request the agent has taken but
// not yet finished, and the dropped-request rule must not fire on it.
const base = { action: 'recreate', id: 'req-1', elapsedMs: 1000, unreachable: false, pending: true };

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

  it('keeps waiting on an action that is genuinely running', () => {
    const overdue = { ...base, elapsedMs: DEADLINE_MS.recreate + 1, lastResult: null };
    expect(decidePhase({ ...overdue, busy: true }))
      .toEqual({ phase: 'failed', detail: 'Still running after a long time.' });
  });

  it('still waits while the request sits in the queue, up to the deadline', () => {
    expect(decidePhase({ ...base, elapsedMs: PICKUP_GRACE_MS + 1, pending: true, busy: false }))
      .toEqual({ phase: 'working' });
    expect(decidePhase({ ...base, elapsedMs: DEADLINE_MS.recreate + 1, pending: true, busy: false }))
      .toEqual({ phase: 'failed', detail: 'The host agent never picked this up.' });
  });

  // What actually happened: the agent's heartbeat had not yet aged out, so the
  // server accepted the request for an agent that had already gone. Nothing
  // picked it up, and the overlay sat on "please wait" for the full two minutes.
  it('fails fast when the request is neither queued nor running', () => {
    expect(decidePhase({ ...base, elapsedMs: PICKUP_GRACE_MS - 1, pending: false, busy: false }))
      .toEqual({ phase: 'working' });
    const verdict = decidePhase({ ...base, elapsedMs: PICKUP_GRACE_MS + 1, pending: false, busy: false });
    expect(verdict.phase).toBe('failed');
    expect(verdict).toMatchObject({ detail: expect.stringContaining('did not pick this up') });
    expect(PICKUP_GRACE_MS).toBeLessThan(DEADLINE_MS.restart);
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

describe('describeProgress', () => {
  // The scripts already announce their phases; this reads the latest one rather
  // than inventing a second source of truth for what is happening.
  it('takes the most recent phase the update script announced', () => {
    const lines = [
      '[dojo-update] step 1 of 3: rebuilding the web UI…',
      '#12 7.6 npm warn deprecated jquery@2.2.4: This version is deprecated.',
      '[dojo-update] step 2 of 3: rebuilding the container image — the slow part, usually 5-10 minutes.'
    ];
    expect(describeProgress(lines, 'Working…')).toBe(
      'step 2 of 3: rebuilding the container image — the slow part, usually 5-10 minutes.');
  });

  it('ignores the indented asides under a phase', () => {
    const lines = [
      '[dojo-update] step 2 of 3: rebuilding the container image — the slow part.',
      '[dojo-update]   npm goes quiet while it downloads and compiles; that is normal, not a stall.'
    ];
    expect(describeProgress(lines, 'Working…')).toBe(
      'step 2 of 3: rebuilding the container image — the slow part.');
  });

  // The 293-second silence this exists for: npm has no terminal to draw a
  // progress bar on, so without the agent's heartbeat there is nothing at all.
  it('falls back to the agent heartbeat when only that is moving', () => {
    expect(describeProgress(['  …still working (3 min so far)'], 'Working…'))
      .toBe('Working… — still working (3 min so far)');
    expect(describeProgress([
      '2026-08-07T13:25:00.000Z  running: restart the GUI container',
      '  …still working (3 min so far)'
    ], 'Working…')).toBe('Restart the GUI container — still working (3 min so far)');
  });

  // agent.log is append-only and shared by every action, so its tail still holds
  // the last one's output. This showed up live: a fresh restart displayed
  // "what changed: …/releases" left over from the previous update.
  it('ignores output from a previous action', () => {
    const lines = [
      '2026-08-07T13:00:40.419Z  running: pull, rebuild and restart (npm run update)',
      '[dojo-update] step 1 of 3: rebuilding the web UI…',
      '[dojo-update] what changed: https://github.com/TimPickup/screeps-dojo/releases',
      '2026-08-07T13:20:00.000Z  done: update',
      '2026-08-07T13:25:00.000Z  running: re-create the GUI container so it picks up new bot mounts'
    ];
    expect(describeProgress(lines, 'Working…')).toBe(
      'Re-create the GUI container so it picks up new bot mounts');
  });

  // restart and recreate print no phases of their own, so the agent's summary
  // of what it is doing beats a generic "Working…".
  it('uses the agent summary when the action prints no phases', () => {
    const lines = ['2026-08-07T13:25:00.000Z  running: restart the GUI container'];
    expect(describeProgress(lines, 'Working…')).toBe('Restart the GUI container');
  });

  it('reads only the phases logged since the action started', () => {
    const lines = [
      '2026-08-07T13:00:00.000Z  running: pull, rebuild and restart (npm run update)',
      '[dojo-update] what changed: https://example.invalid/releases',
      '2026-08-07T13:25:00.000Z  running: pull, rebuild and restart (npm run update)',
      '[dojo-update] rebuilding the web UI…'
    ];
    expect(describeProgress(lines, 'Working…')).toBe('rebuilding the web UI…');
  });

  it('falls back to the caller default when the log says nothing useful', () => {
    expect(describeProgress([], 'Working…')).toBe('Working…');
    expect(describeProgress(['#12 DONE 440.4s', 'random build noise'], 'Working…')).toBe('Working…');
  });
});
