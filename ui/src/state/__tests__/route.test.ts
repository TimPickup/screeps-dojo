import { describe, it, expect } from 'vitest';
import { parseHash, formatRoute } from '../route';

// The URL is the app's state now, so it has to survive a round trip and, more
// importantly, has to survive whatever someone typed or bookmarked.

describe('parseHash', () => {
  it('reads an empty or unknown hash as the scenario list', () => {
    expect(parseHash('')).toEqual({ view: 'list', folder: null });
    expect(parseHash('#/')).toEqual({ view: 'list', folder: null });
    expect(parseHash('#/nonsense/here')).toEqual({ view: 'list', folder: null });
  });

  it('reads a folder, nesting and all', () => {
    expect(parseHash('#/folder/Benches/Sieges')).toEqual({ view: 'list', folder: 'Benches/Sieges' });
  });

  it('reads a scenario and its tab', () => {
    expect(parseHash('#/scenario/Benches/rampart/edit'))
      .toEqual({ view: 'scenario', scenario: 'Benches/rampart', tab: 'Edit' });
  });

  // Someone will shorten the URL by hand, and dropping the tab should open the
  // scenario rather than dump them back on the list.
  it('defaults to Run when no tab is given', () => {
    expect(parseHash('#/scenario/Benches/rampart'))
      .toEqual({ view: 'scenario', scenario: 'Benches/rampart', tab: 'Run' });
    expect(parseHash('#/scenario/rampart'))
      .toEqual({ view: 'scenario', scenario: 'rampart', tab: 'Run' });
  });

  it('decodes names with characters that mean something in a URL', () => {
    expect(parseHash('#/scenario/My%20Benches/rampart%20%232/run'))
      .toEqual({ view: 'scenario', scenario: 'My Benches/rampart #2', tab: 'Run' });
  });
});

describe('formatRoute', () => {
  it('round-trips every shape', () => {
    const routes = [
      { view: 'list', folder: null },
      { view: 'list', folder: 'Benches/Sieges' },
      { view: 'scenario', scenario: 'rampart', tab: 'Run' },
      { view: 'scenario', scenario: 'My Benches/rampart #2', tab: 'Replays' }
    ] as const;
    for (const route of routes) expect(parseHash(formatRoute(route))).toEqual(route);
  });

  // A scenario genuinely called 'run' would be ambiguous if the tab were ever
  // left off, so the tab is always written.
  it('always writes the tab', () => {
    expect(formatRoute({ view: 'scenario', scenario: 'run', tab: 'Run' })).toBe('#/scenario/run/run');
    expect(parseHash('#/scenario/run/run')).toEqual({ view: 'scenario', scenario: 'run', tab: 'Run' });
  });
});
