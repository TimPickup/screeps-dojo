import type { FrameObject } from '../../api/types';

// A single "nice stat" for a structure type: a label, the raw object fields it
// consumes (so the generic catch-all can exclude them and never double-show),
// and a function that turns the object into a display value (null → row hidden).
export interface StatDef {
  label: string;
  keys: string[];
  value: (o: FrameObject, gameTime?: number) => string | number | null | undefined;
}

export interface TypeSchema {
  stats: StatDef[];
  // structures whose store is meaningless (e.g. controller) opt out of StoreList
  showStore?: boolean;
}

// --- small derivation helpers ------------------------------------------------
const num = (o: FrameObject, k: string): number | undefined =>
  typeof o[k] === 'number' ? (o[k] as number) : undefined;

// A future game-time field (downgradeTime, nextSpawnTime, …) shown as a
// countdown "N ticks"; null when the field or the current tick is unavailable.
function ticksUntil(o: FrameObject, k: string, gameTime?: number): string | null {
  const t = num(o, k);
  if (t === undefined || typeof gameTime !== 'number') return null;
  return Math.max(0, t - gameTime) + ' ticks';
}

const cooldown: StatDef = {
  label: 'cooldown', keys: ['cooldown'],
  value: (o) => { const c = num(o, 'cooldown'); return c && c > 0 ? c + ' ticks' : null; },
};

// Per-type quirks only — store is rendered separately by StoreList, and any
// field not named here still appears (formatted) in the catch-all block, so the
// table stays small: it exists to surface the fields that matter per type.
export const TYPE_SCHEMA: Record<string, TypeSchema> = {
  spawn: {
    stats: [{
      label: 'spawning', keys: ['spawning'],
      value: (o, gt) => {
        const s = o.spawning as { name?: string; spawnTime?: number; needTime?: number } | null | undefined;
        if (!s) return null;
        const left = typeof s.spawnTime === 'number' && typeof gt === 'number' ? Math.max(0, s.spawnTime - gt) : undefined;
        return (s.name || 'creep') + (left !== undefined ? ' (' + left + ' ticks)' : '');
      },
    }],
  },
  lab: {
    stats: [
      { label: 'mineral', keys: ['mineralType'], value: (o) => (o.mineralType as string) || null },
      cooldown,
    ],
  },
  nuker: {
    stats: [{ label: 'ready in', keys: ['cooldown'], value: (o, gt) => ticksUntil(o, 'cooldown', gt) ?? (num(o, 'cooldown') ? num(o, 'cooldown') + ' ticks' : null) }],
  },
  factory: {
    stats: [
      { label: 'level', keys: ['level'], value: (o) => num(o, 'level') ?? null },
      cooldown,
    ],
  },
  link: { stats: [cooldown] },
  extractor: { stats: [cooldown] },
  controller: {
    showStore: false,
    stats: [
      { label: 'level', keys: ['level'], value: (o) => num(o, 'level') ?? 0 },
      { label: 'progress', keys: ['progress', 'progressTotal'], value: (o) => {
        const p = num(o, 'progress'); const t = num(o, 'progressTotal');
        if (p === undefined) return null;
        return t ? p + ' / ' + t : String(p);
      } },
      { label: 'downgrade in', keys: ['downgradeTime'], value: (o, gt) => ticksUntil(o, 'downgradeTime', gt) },
      { label: 'safe mode', keys: ['safeMode'], value: (o, gt) => ticksUntil(o, 'safeMode', gt) },
      { label: 'reserved by', keys: ['reservation'], value: (o) => {
        const r = o.reservation as { username?: string } | undefined; return r ? (r.username || 'reserved') : null;
      } },
    ],
  },
  keeperLair: {
    stats: [{ label: 'spawns in', keys: ['nextSpawnTime'], value: (o, gt) => ticksUntil(o, 'nextSpawnTime', gt) }],
  },
  invaderCore: {
    stats: [
      { label: 'level', keys: ['level'], value: (o) => num(o, 'level') ?? null },
      { label: 'deploys in', keys: ['ticksToDeploy'], value: (o) => { const t = num(o, 'ticksToDeploy'); return t ? t + ' ticks' : null; } },
    ],
  },
  source: {
    showStore: false,
    stats: [
      { label: 'energy', keys: ['energy', 'energyCapacity'], value: (o) => {
        const e = num(o, 'energy'); const c = num(o, 'energyCapacity');
        if (e === undefined) return null;
        return c ? e + ' / ' + c : String(e);
      } },
      { label: 'regen in', keys: ['ticksToRegeneration', 'nextRegenerationTime'], value: (o, gt) => {
        const t = num(o, 'ticksToRegeneration');
        if (typeof t === 'number') return t + ' ticks';
        return ticksUntil(o, 'nextRegenerationTime', gt);
      } },
    ],
  },
  mineral: {
    showStore: false,
    stats: [
      { label: 'mineral', keys: ['mineralType'], value: (o) => (o.mineralType as string) || null },
      { label: 'amount', keys: ['mineralAmount'], value: (o) => num(o, 'mineralAmount') ?? null },
      { label: 'density', keys: ['density'], value: (o) => num(o, 'density') ?? null },
    ],
  },
};
