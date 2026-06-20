import { useCallback, useEffect, useRef, useState } from 'react';
import type { FrameObject, StageLayout } from '../../api/types';
import styles from './SvgStage.module.css';

interface Props {
  svg: string | null;
  layout: StageLayout | null;
  overlaySvg?: string | null;
  objects?: FrameObject[];
  selectedId?: string | null;
  onSelectObject?: (id: string | null) => void;
}

interface View { scale: number; tx: number; ty: number; }

// Renders a server-produced full-fidelity SVG string and adds zoom (wheel),
// pan (drag), double-click-to-reset, and an invisible click overlay so objects
// stay selectable. View state persists across re-renders and resizes — it only
// (re)fits when a NEW layout loads or on explicit double-click, so pressing
// play/pause/console never resets the zoom.
export function SvgStage({ svg, layout, overlaySvg, objects, selectedId, onSelectObject }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const fittedForRef = useRef<StageLayout | null>(null);

  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !layout || !layout.width) return;
    const cw = el.clientWidth || 1;
    const ch = el.clientHeight || 1;
    const scale = Math.min(cw / layout.width, ch / layout.height) * 0.96;
    setView({ scale, tx: (cw - layout.width * scale) / 2, ty: (ch - layout.height * scale) / 2 });
  }, [layout]);

  // fit only when a new layout arrives (not on every resize/re-render)
  useEffect(() => {
    if (layout && fittedForRef.current !== layout) {
      fittedForRef.current = layout;
      fit();
    }
  }, [layout, fit]);

  // wheel zoom — attached non-passively so preventDefault is allowed
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const scale = Math.max(0.05, Math.min(40, v.scale * factor));
        const tx = mx - (mx - v.tx) * (scale / v.scale);
        const ty = my - (my - v.ty) * (scale / v.scale);
        return { scale, tx, ty };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // panning (window-level move/up so a fast drag that leaves the element still tracks)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const tx = d.tx + (e.clientX - d.x);
      const ty = d.ty + (e.clientY - d.y);
      setView((v) => ({ ...v, tx, ty }));
    };
    const onUp = () => { drag.current = null; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    document.body.style.userSelect = 'none';
  };

  const tile = layout ? layout.pixelsPerRoom / 50 : 12;
  const screenOf = (o: FrameObject) => {
    const off = layout && layout.offsets[o.room];
    if (!off || !layout) return null;
    return { cx: off.col * layout.pixelsPerRoom + (o.x + 0.5) * tile, cy: off.row * layout.pixelsPerRoom + (o.y + 0.5) * tile };
  };

  return (
    <div
      ref={containerRef}
      className={styles.stage}
      onMouseDown={onMouseDown}
      onDoubleClick={fit}
      onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.bg) onSelectObject?.(null); }}
    >
      {!svg || !layout ? <div className={styles.empty}>—</div> : (
        <div className={styles.world} style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, width: layout.width, height: layout.height }}>
          <div className={styles.base} data-bg="1" dangerouslySetInnerHTML={{ __html: svg }} />
          {overlaySvg ? <div className={styles.base} style={{ pointerEvents: 'none' }} dangerouslySetInnerHTML={{ __html: overlaySvg }} /> : null}
          {onSelectObject && (
            <svg className={styles.overlay} width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`}>
              {(objects || []).map((o, i) => {
                const p = screenOf(o);
                if (!p) return null;
                return (
                  <g key={o._id || i}>
                    <circle cx={p.cx} cy={p.cy} r={tile * 0.5} fill="transparent" style={{ cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); onSelectObject(o._id); }} />
                    {selectedId === o._id && <circle cx={p.cx} cy={p.cy} r={tile * 0.6} fill="none" stroke="#65fd62" strokeWidth={tile * 0.08} />}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      )}
      <div className={styles.hint}>scroll = zoom · drag = pan · dbl-click = reset</div>
    </div>
  );
}
