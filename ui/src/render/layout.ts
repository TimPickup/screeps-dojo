// Multi-room layout — ported from editor/template.html (credit: src/render/frameRenderer.js).
export const ROOM_TILES = 50;

const ROOM_NAME_PATTERN = /^([WE])(\d+)([NS])(\d+)$/;

export function roomNameToXY(name: string): { x: number; y: number } {
  const m = ROOM_NAME_PATTERN.exec(name);
  if (!m) return { x: 0, y: 0 };
  const x = m[1] === 'W' ? -Number(m[2]) - 1 : Number(m[2]);
  const y = m[3] === 'N' ? -Number(m[4]) - 1 : Number(m[4]);
  return { x, y };
}

export interface Layout {
  offsets: Record<string, { col: number; row: number }>;
  columns: number;
  rows: number;
}

export function computeLayout(roomNames: string[]): Layout {
  const positions = roomNames.map((name) => ({ name, ...roomNameToXY(name) }));
  if (positions.length === 0) return { offsets: {}, columns: 1, rows: 1 };
  const minX = Math.min(...positions.map((p) => p.x));
  const minY = Math.min(...positions.map((p) => p.y));
  const offsets: Record<string, { col: number; row: number }> = {};
  let columns = 1;
  let rows = 1;
  for (const p of positions) {
    const col = p.x - minX;
    const row = p.y - minY;
    offsets[p.name] = { col, row };
    if (col + 1 > columns) columns = col + 1;
    if (row + 1 > rows) rows = row + 1;
  }
  return { offsets, columns, rows };
}
