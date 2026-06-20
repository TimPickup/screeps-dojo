// Terrain → SVG string (rects + grid + exit chevrons). Pure string output so a
// room's terrain layer can be memoized and injected once. Visual language
// mirrors editor/template.html / src/render/frameRenderer.js.
export const TILE_COLORS: Record<string, string> = { '.': '#2b2b2b', '~': '#23311e', '#': '#111111' };
export const ROOM_BACKGROUND = '#2b2b2b';
const ROOM_TILES = 50;

export function terrainSvg(rows: string[]): string {
  const parts: string[] = [`<rect x="0" y="0" width="50" height="50" fill="${ROOM_BACKGROUND}"/>`];
  for (let y = 0; y < ROOM_TILES; y++) {
    const row = rows[y] || '';
    for (let x = 0; x < ROOM_TILES; x++) {
      const ch = row[x];
      if (ch === '.' || ch === undefined) continue;
      parts.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${TILE_COLORS[ch] || ROOM_BACKGROUND}"/>`);
    }
  }
  let gridPath = '';
  for (let i = 1; i < ROOM_TILES; i++) gridPath += `M ${i} 0 V 50 M 0 ${i} H 50 `;
  parts.push(`<path d="${gridPath.trim()}" stroke="#ffffff" stroke-width="0.02" opacity="0.07" fill="none"/>`);
  parts.push(exitArrows(rows));
  return parts.join('');
}

function exitArrows(rows: string[]): string {
  const chevrons: string[] = [];
  const chev = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    chevrons.push(`<path d="M ${x1} ${y1} L ${x2} ${y2} L ${x3} ${y3}"/>`);
  const last = ROOM_TILES - 1;
  for (let i = 0; i < ROOM_TILES; i++) {
    if (rows[i] && rows[i][0] !== '#') chev(0.4, i + 0.25, 0.1, i + 0.5, 0.4, i + 0.75);
    if (rows[i] && rows[i][last] !== '#') chev(last + 0.6, i + 0.25, last + 0.9, i + 0.5, last + 0.6, i + 0.75);
    if (rows[0] && rows[0][i] !== '#') chev(i + 0.25, 0.4, i + 0.5, 0.1, i + 0.75, 0.4);
    if (rows[last] && rows[last][i] !== '#') chev(i + 0.25, last + 0.6, i + 0.5, last + 0.9, i + 0.75, last + 0.6);
  }
  if (!chevrons.length) return '';
  return `<g stroke="#9bd49b" stroke-width="0.08" opacity="0.5" fill="none">${chevrons.join('')}</g>`;
}
