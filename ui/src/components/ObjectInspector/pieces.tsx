import { useState } from 'react';
import { resourceIconUrl, resourceColor } from './resourceIcons';

// --- resource icon chip ------------------------------------------------------
// Icon from the game CDN; on load failure (offline / unknown key) falls back to
// a coloured square carrying the resource key so the row is still legible.
export function ResourceIcon({ resource, size = 16 }: { resource: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span style={{
        display: 'inline-block', width: size, height: size, borderRadius: 3, verticalAlign: 'middle',
        background: resourceColor(resource), color: '#111', fontSize: size * 0.5, lineHeight: size + 'px',
        textAlign: 'center', fontWeight: 700, overflow: 'hidden',
      }} title={resource}>{resource.slice(0, 3)}</span>
    );
  }
  return (
    <img src={resourceIconUrl(resource)} width={size} height={size} alt={resource} title={resource}
      style={{ verticalAlign: 'middle', imageRendering: 'auto' }} onError={() => setBroken(true)} />
  );
}

function FillBar({ fraction, color = '#FFE87B' }: { fraction: number; color?: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div style={{ height: 3, background: 'rgba(255,255,255,0.12)', borderRadius: 2, marginTop: 2 }}>
      <div style={{ width: (f * 100) + '%', height: '100%', background: color, borderRadius: 2 }} />
    </div>
  );
}

// --- store list --------------------------------------------------------------
// Two shapes of capacity: a single shared total (storage/terminal/container/
// factory → storeCapacity) shown as a used/total header + bar; or per-resource
// caps (spawn/extension/tower/link/lab/nuker/powerSpawn → storeCapacityResource)
// shown as amount / cap with a per-row bar.
export function StoreList({ store, capResource, capTotal }: {
  store: Record<string, number>;
  capResource?: Record<string, number>;
  capTotal?: number;
}) {
  const entries = Object.entries(store).filter(([, n]) => n > 0);
  if (entries.length === 0 && !capTotal) return null;
  const used = Object.values(store).reduce((a, b) => a + (b > 0 ? b : 0), 0);

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ color: 'var(--muted)' }}>
        store{typeof capTotal === 'number' ? ' — ' + used + ' / ' + capTotal : ''}
      </div>
      {typeof capTotal === 'number' && capTotal > 0 && <FillBar fraction={used / capTotal} color="#8fd3ff" />}
      <div style={{ marginTop: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {entries.map(([res, n]) => {
          const cap = capResource ? capResource[res] : undefined;
          return (
            <div key={res}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ResourceIcon resource={res} />
                <span>{n}{typeof cap === 'number' ? ' / ' + cap : ''}</span>
              </div>
              {typeof cap === 'number' && cap > 0 && <FillBar fraction={n / cap} color={resourceColor(res)} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- owner tag ---------------------------------------------------------------
// Classifies the raw user id into a coloured label; the full id stays on hover
// (nothing hidden). NPC ids are fixed ('2' invader, '3' source keeper).
export function OwnerTag({ user, botUserId }: { user: string; botUserId?: string }) {
  let label = 'Hostile', color = '#f93842';
  if (botUserId && user === botUserId) { label = 'Me'; color = '#65fd62'; }
  else if (user === '2') { label = 'Invader'; color = '#f9a825'; }
  else if (user === '3') { label = 'Source Keeper'; color = '#b99cfb'; }
  return (
    <span title={user} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label}
    </span>
  );
}

// --- hits bar ----------------------------------------------------------------
export function HitsBar({ hits, hitsMax }: { hits: number; hitsMax?: number }) {
  const frac = hitsMax ? Math.max(0, Math.min(1, hits / hitsMax)) : 1;
  const color = frac > 0.5 ? '#65fd62' : frac > 0.25 ? '#f9a825' : '#f93842';
  return (
    <div style={{ minWidth: 120 }}>
      <span>{hits}{hitsMax ? ' / ' + hitsMax : ''}</span>
      {hitsMax ? <FillBar fraction={frac} color={color} /> : null}
    </div>
  );
}

export function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <span style={{ color: 'var(--muted)', minWidth: 84 }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}
