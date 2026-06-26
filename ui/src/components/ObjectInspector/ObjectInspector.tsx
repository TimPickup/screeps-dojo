import type { ReactNode } from 'react';
import type { FrameObject } from '../../api/types';

// Body-part colours (engine `type` strings; ranged_attack has the underscore).
// The six the brief specified, plus carry/heal so full bodies render completely.
const PART_COLORS: Record<string, string> = {
  tough: '#ffffff',
  work: '#ffe56d',         // yellow
  carry: '#5c5f66',        // dark grey (distinct from the lighter grey move)
  attack: '#f93842',       // red
  ranged_attack: '#5d80b2', // blue
  heal: '#65fd62',         // green
  claim: '#b99cfb',        // purple
  move: '#a9b7c6',         // grey
};

// Fields rendered explicitly above, or engine-internal/noisy — excluded from the
// generic "other properties" catch-all so it shows only the extra useful stuff.
const HANDLED = new Set([
  '_id', 'type', 'x', 'y', 'room', 'user', 'name', 'body', 'store',
  'hits', 'hitsMax', 'level', 'progress', 'ageTime', 'fatigue', 'spawning',
  'cooldown', 'nextSpawnTime',
  'meta', '$loki', 'actionLog', '_actionLog', '_ticksToLive', 'notifyWhenAttacked',
]);

// Up-to-10-per-row grid of coloured part squares (max body is 50 → 5 rows).
// Damaged parts dim toward transparent; tooltip shows type + remaining hits.
function BodyGrid({ body }: { body: Array<{ type: string; hits: number }> }) {
  const cell = 15;
  const gap = 2;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap, width: 10 * cell + 9 * gap, marginTop: 3 }}>
      {body.map((part, i) => {
        const color = PART_COLORS[part.type] ?? '#888';
        const hp = typeof part.hits === 'number' ? part.hits : 100;
        return (
          <div
            key={i}
            title={part.type + ' (' + hp + ')'}
            style={{
              width: cell, height: cell, background: color, borderRadius: 3,
              border: part.type === 'tough' ? '1px solid #b0b0b0' : '1px solid rgba(0,0,0,0.4)',
              opacity: hp <= 0 ? 0.2 : 0.45 + 0.55 * Math.min(1, hp / 100),
              boxSizing: 'border-box',
            }}
          />
        );
      })}
    </div>
  );
}

export function ObjectInspector({ obj, gameTime }: { obj: FrameObject | null; gameTime?: number }) {
  if (!obj) return <div style={{ color: 'var(--muted)' }}>Click an object in the viewer.</div>;

  const row = (k: string, v: ReactNode) => (
    <div><span style={{ color: 'var(--muted)' }}>{k}</span> {v}</div>
  );

  const store = obj.store && Object.keys(obj.store).length
    ? Object.entries(obj.store).map(([r, n]) => r + ':' + n).join(' ')
    : null;

  // ticksToLive = death tick (ageTime) − now. Creeps/power-creeps carry ageTime;
  // NPCs without one (e.g. source keepers) live until killed → no TTL shown.
  const ageTime = typeof obj.ageTime === 'number' ? obj.ageTime : undefined;
  const ticksToLive = ageTime !== undefined && typeof gameTime === 'number' ? ageTime - gameTime : undefined;

  // keeper lair: ticks until the next source keeper spawns.
  const nextSpawnTime = typeof obj.nextSpawnTime === 'number' ? obj.nextSpawnTime : undefined;
  const spawnsIn = nextSpawnTime !== undefined && typeof gameTime === 'number' ? nextSpawnTime - gameTime : undefined;

  const body = obj.body as Array<{ type: string; hits: number }> | undefined;

  // Catch-all: every remaining primitive/serialisable field not shown above.
  const others = Object.entries(obj as Record<string, unknown>)
    .filter(([k, v]) => !HANDLED.has(k) && v !== null && v !== undefined && typeof v !== 'function')
    .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string]);

  return (
    <div style={{ lineHeight: 1.6 }}>
      {obj.name && row('name', obj.name)}
      {row('id', obj._id)}
      {row('type', obj.type)}
      {obj.user && row('owner', obj.user)}
      {row('pos', obj.room + ' ' + obj.x + ',' + obj.y)}
      {(obj.hits !== undefined) && row('hits', obj.hits + '/' + (obj.hitsMax ?? '?'))}
      {ticksToLive !== undefined && row('ticksToLive', ticksToLive)}
      {typeof obj.fatigue === 'number' && obj.fatigue > 0 && row('fatigue', obj.fatigue)}
      {obj.spawning && row('spawning', 'yes')}
      {typeof obj.cooldown === 'number' && obj.cooldown > 0 && row('cooldown', obj.cooldown)}
      {spawnsIn !== undefined && row('spawns in', spawnsIn + ' ticks')}
      {obj.type === 'controller' && obj.level !== undefined && row('level', obj.level)}
      {store && row('store', store)}
      {body && body.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ color: 'var(--muted)' }}>body ({body.length})</div>
          <BodyGrid body={body} />
        </div>
      )}
      {others.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {others.map(([k, v]) => (
            <div key={k}><span style={{ color: 'var(--muted)' }}>{k}</span> {v}</div>
          ))}
        </div>
      )}
    </div>
  );
}
