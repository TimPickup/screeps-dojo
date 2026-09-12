import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styles from './ScenarioList.module.css';

export interface MenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/**
 * Right-click menu for a tree row (and for the empty space below the tree).
 *
 * Positioned at the pointer, flipped back inside the viewport when it would
 * overflow, closed by Escape / a click anywhere else / scrolling. Arrow keys
 * walk it, because the tree itself is keyboard-navigable and a menu you can
 * only reach with a mouse would be a dead end.
 */
export function RowMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const [active, setActive] = useState(-1);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(menu.x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(menu.y, window.innerHeight - rect.height - 4))
    });
  }, [menu.x, menu.y]);

  // Focus the menu itself so the arrow keys reach it. autoFocus is only
  // honoured on form controls, and this is a div.
  useEffect(() => { ref.current?.focus(); }, []);

  useEffect(() => {
    const close = () => onClose();
    // Bubble phase, deliberately: the menu stops mousedown at its own root, so
    // a click ON an item does not close the menu before the click lands. A
    // capture listener would fire first and unmount it mid-click.
    window.addEventListener('mousedown', close);
    // Scroll has no bubble phase from inner elements, so that one is capture.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + menu.items.length) % menu.items.length);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && active >= 0) {
      e.preventDefault();
      const item = menu.items[active];
      onClose();
      item.onSelect();
    }
  };

  return (
    <div
      ref={ref}
      className={styles.menu}
      style={{ left: pos.left, top: pos.top }}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menu.items.map((item, i) => (
        <button
          key={item.label}
          role="menuitem"
          className={[item.danger ? styles.menuItemDanger : styles.menuItem, i === active ? styles.menuItemActive : ''].filter(Boolean).join(' ')}
          onMouseEnter={() => setActive(i)}
          onClick={() => { onClose(); item.onSelect(); }}
        >{item.label}</button>
      ))}
    </div>
  );
}
