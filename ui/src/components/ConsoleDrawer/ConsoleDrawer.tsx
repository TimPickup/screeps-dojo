import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './ConsoleDrawer.module.css';

export interface ConsoleDrawerProps {
  lines: string[];
  title?: string;
  // Optional panel pinned to the right of the console (e.g. object inspector).
  rightPanel?: ReactNode;
  rightTitle?: string;
}

// Locked-to-bottom drawer: minimised shows only its title bar; expanded shows
// the console (default ~1/3 of the parent height), draggable to resize. Shared
// by the live Run tab and the Replays tab.
export function ConsoleDrawer({ lines, title = 'Console', rightPanel, rightTitle = 'Inspector' }: ConsoleDrawerProps) {
  const [open, setOpen] = useState(false);
  const [height, setHeight] = useState(220);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines, open]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const next = window.innerHeight - e.clientY;
      setHeight(Math.max(80, Math.min(window.innerHeight - 160, next)));
    };
    const up = () => { dragging.current = false; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  return (
    <div className={styles.drawer}>
      {open && (
        <div className={styles.resizer} onMouseDown={() => { dragging.current = true; document.body.style.userSelect = 'none'; }} />
      )}
      <div className={styles.titlebar} onClick={() => setOpen((o) => !o)}>
        <span className={styles.caret}>{open ? '▾' : '▸'}</span>
        <span className={styles.title}>{title}</span>
        <span className={styles.count}>{lines.length} lines</span>
        <span className={styles.hint}>{open ? 'minimise' : 'expand'}</span>
      </div>
      {open && (
        <div className={styles.body} style={{ height }}>
          <div className={styles.console} ref={bodyRef}>
            {lines.length === 0 ? <div className={styles.empty}>— no console output —</div> :
              lines.map((l, i) => <div key={i} className={styles.line}>{l}</div>)}
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
