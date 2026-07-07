import type { FrameObject } from '../../api/types';
import { TYPE_SCHEMA } from './inspectorSchema';
import { StoreList, OwnerTag, HitsBar, StatRow } from './pieces';

// Body-part colours (engine `type` strings; ranged_attack has the underscore).
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

// Identity / rendered-elsewhere / engine-internal fields, excluded from the
// generic "other properties" catch-all. Per-type schema keys are added on top.
const BASE_HANDLED = new Set([
  '_id', 'type', 'x', 'y', 'room', 'user', 'name', 'body',
  'store', 'storeCapacity', 'storeCapacityResource',
  'hits', 'hitsMax', 'ageTime', '_ticksToLive', 'fatigue', 'spawning',
  'meta', '$loki', 'actionLog', '_actionLog', 'notifyWhenAttacked',
]);

// Up-to-10-per-row grid of coloured part squares (max body is 50 → 5 rows).
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

export function ObjectInspector({ obj, gameTime, botUserId }: {
  obj: FrameObject | null;
  gameTime?: number;
  botUserId?: string;
}) {
  if (!obj) return <div style={{ color: 'var(--muted)' }}>Click an object in the viewer.</div>;

  const schema = TYPE_SCHEMA[obj.type];
  const store = obj.store as Record<string, number> | undefined;
  const capResource = obj.storeCapacityResource as Record<string, number> | undefined;
  const capTotal = typeof obj.storeCapacity === 'number' ? obj.storeCapacity : undefined;
  const showStore = (!schema || schema.showStore !== false) && !!store && Object.keys(store).length > 0;

  // ticksToLive = death tick (ageTime) − now (creeps/power-creeps only).
  const ageTime = typeof obj.ageTime === 'number' ? obj.ageTime : undefined;
  const ticksToLive = ageTime !== undefined && typeof gameTime === 'number' ? ageTime - gameTime : undefined;

  const body = obj.body as Array<{ type: string; hits: number }> | undefined;

  // Fields already surfaced (identity + this type's schema) — everything else
  // still shows in the formatted catch-all, so nothing is hidden.
  const handled = new Set(BASE_HANDLED);
  if (schema) for (const stat of schema.stats) for (const k of stat.keys) handled.add(k);

  const others = Object.entries(obj as Record<string, unknown>)
    .filter(([k, v]) => !handled.has(k) && v !== null && v !== undefined && typeof v !== 'function')
    .map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)] as [string, string]);

  return (
    <div style={{ lineHeight: 1.6 }}>
      {/* header: identity, formatted */}
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{obj.name || obj.type}</div>
      {obj.name && <StatRow label="type">{obj.type}</StatRow>}
      {obj.user && <StatRow label="owner"><OwnerTag user={obj.user} botUserId={botUserId} /></StatRow>}
      <StatRow label="pos">{obj.room + ' ' + obj.x + ',' + obj.y}</StatRow>
      {obj.hits !== undefined && <StatRow label="hits"><HitsBar hits={obj.hits} hitsMax={obj.hitsMax} /></StatRow>}

      {/* creep vitals */}
      {ticksToLive !== undefined && <StatRow label="ticksToLive">{ticksToLive}</StatRow>}
      {typeof obj.fatigue === 'number' && obj.fatigue > 0 && <StatRow label="fatigue">{obj.fatigue}</StatRow>}

      {/* per-type stats */}
      {schema && schema.stats.map((stat) => {
        const v = stat.value(obj, gameTime);
        if (v === null || v === undefined || v === '') return null;
        return <StatRow key={stat.label} label={stat.label}>{v}</StatRow>;
      })}

      {/* store */}
      {showStore && <StoreList store={store!} capResource={capResource} capTotal={capTotal} />}

      {/* creep body */}
      {body && body.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ color: 'var(--muted)' }}>body ({body.length})</div>
          <BodyGrid body={body} />
        </div>
      )}

      {/* id + anything not explicitly handled, formatted (nothing hidden) */}
      <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: 'var(--muted)', minWidth: 84 }}>id</span>
          <span style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{obj._id}</span>
        </div>
        {others.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8 }}>
            <span style={{ color: 'var(--muted)', minWidth: 84 }}>{k}</span>
            <span style={{ wordBreak: 'break-all' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
