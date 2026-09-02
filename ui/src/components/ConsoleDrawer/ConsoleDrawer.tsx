import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { isWarningLine } from '../../api/consoleLines';
import type { ConsoleIndex } from '../../api/consoleIndex';
import styles from './ConsoleDrawer.module.css';

// A long recording can carry tens of thousands of console lines. One <div> per
// line is fine for a few thousand and ruinous beyond that: every subsequent
// style recalculation (including the `user-select` flip that used to happen on
// every canvas drag) has to walk them all. So we only ever mount the tail of
// the log — the part anyone actually reads — and say so in the title bar.
const MAX_VISIBLE_LINES = 2000;

// Lines are mounted in fixed blocks aligned to absolute line indices. As the
// window slides (playback, scrubbing) the interior blocks keep identical props
// and React skips them; only the two partial blocks at the edges re-render.
const CHUNK = 200;

export interface ConsoleDrawerProps {
  source: ConsoleIndex;
  // Lines available at the current point in time — the whole log for a live
  // run, everything up to the current tick for a replay.
  available: number;
  // Changes when `source` starts describing a different log, so stale chunks
  // are remounted rather than memoised away.
  sourceKey?: string;
  title?: string;
  // Optional panel pinned to the right of the console (e.g. object inspector).
  rightPanel?: ReactNode;
  rightTitle?: string;
}

type GetLines = (from: number, to: number) => string[];

// Safe to memoise on the range alone: a console log is append-only, so the text
// at a given absolute index never changes. `get` is identity-stable (it reads
// the current source through a ref) and `sourceKey` is part of the React key,
// so a replaced log remounts instead of reusing these.
const ConsoleChunk = memo(function ConsoleChunk({ from, to, get }: { from: number; to: number; get: GetLines }) {
  const lines = get(from, to);
  return (
    <>
      {lines.map((l, i) => (
        // colour harness warnings and bot errors so they are not lost in
        // a wall of bot output
        <div key={from + i} className={isWarningLine(l) ? styles.warning : styles.line}>{l}</div>
      ))}
    </>
  );
});

// Locked-to-bottom drawer: minimised shows only its title bar; expanded shows
// the console (default ~1/3 of the parent height), draggable to resize. Shared
// by the live Run tab and the Replays tab.
export function ConsoleDrawer({ source, available, sourceKey = '', title = 'Console', rightPanel, rightTitle = 'Inspector' }: ConsoleDrawerProps) {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(220);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  // Follow new output only while the user is already parked at the bottom, so
  // scrolling back through history during playback is not yanked away.
  const stick = useRef(true);

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const get = useCallback<GetLines>((from, to) => sourceRef.current.slice(from, to), []);

  const end = Math.max(0, Math.min(available, source.total));
  const start = Math.max(0, end - MAX_VISIBLE_LINES);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (open && el && stick.current) el.scrollTop = el.scrollHeight;
  }, [open, start, end]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const next = window.innerHeight - e.clientY;
      setHeight(Math.max(80, Math.min(window.innerHeight - 160, next)));
    };
    const up = () => { dragging.current = false; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  const onScroll = () => {
    const el = bodyRef.current; if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const chunks: Array<{ block: number; from: number; to: number }> = [];
  if (open && end > start) {
    for (let b = Math.floor(start / CHUNK); b <= Math.floor((end - 1) / CHUNK); b++) {
      chunks.push({ block: b, from: Math.max(start, b * CHUNK), to: Math.min(end, (b + 1) * CHUNK) });
    }
  }

  return (
    <div className={styles.drawer}>
      {open && (
        // preventDefault kills the text-selection drag without touching
        // document-wide styles (which would invalidate the whole tree).
        <div className={styles.resizer} onMouseDown={(e) => { e.preventDefault(); dragging.current = true; }} />
      )}
      <div className={styles.titlebar} onClick={() => { stick.current = true; setOpen((o) => !o); }}>
        <span className={styles.caret}>{open ? '▾' : '▸'}</span>
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>{end.toLocaleString()} lines</span>
        {start > 0 && <span className={styles.count}>· showing last {(end - start).toLocaleString()}</span>}
        <span className={styles.hint}>{open ? 'minimise' : 'expand'}</span>
      </div>
      {open && (
        <div className={styles.body} style={{ height }}>
          <div className={styles.console} ref={bodyRef} onScroll={onScroll}>
            {end === 0 ? <div className={styles.empty}>— no console output —</div> : <>
              {start > 0 && <div className={styles.elided}>… {start.toLocaleString()} earlier lines not shown</div>}
              {chunks.map((c) => (
                <ConsoleChunk key={sourceKey + ':' + c.block} from={c.from} to={c.to} get={get} />
              ))}
            </>}
          </div>
          {rightPanel !== undefined && (
            <div className={styles.right}>
              <div className={styles.rightTitle}>{rightTitle}</div>
              <div className={styles.rightBody}>{rightPanel}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
