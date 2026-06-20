import type { FrameObject } from '../../api/types';

// Reads straight from the selected frame's raw object doc.
export function ObjectInspector({ obj }: { obj: FrameObject | null }) {
  if (!obj) return <div style={{ color: 'var(--muted)' }}>Click an object in the viewer.</div>;
  const row = (k: string, v: unknown) => (
    <div><span style={{ color: 'var(--muted)' }}>{k}</span> {String(v)}</div>
  );
  const store = obj.store && Object.keys(obj.store).length
    ? Object.entries(obj.store).map(([r, n]) => r + ':' + n).join(' ')
    : '—';
  const body = obj.body && obj.body.length
    ? obj.body.map((b) => b.type[0].toUpperCase()).join('')
    : null;
  return (
    <div style={{ lineHeight: 1.6 }}>
      {obj.name && row('name', obj.name)}
      {row('id', obj._id)}
      {row('type', obj.type)}
      {obj.user && row('owner', obj.user)}
      {row('pos', obj.room + ' ' + obj.x + ',' + obj.y)}
      {body && row('body', body)}
      {(obj.hits !== undefined) && row('hits', obj.hits + '/' + (obj.hitsMax ?? '?'))}
      {obj.store && row('store', store)}
      {obj.level !== undefined && obj.type === 'controller' && row('level', obj.level)}
    </div>
  );
}
