// VENDORED from src/render/creepSprite.js — keep in sync (pure SVG-path
// generation, no deps). Used by the canvas renderer to rasterize creep sprites
// so they look byte-identical to the SVG/MP4 renderer.
const PART_COLORS: Record<string, string> = {
  heal: '#5cff6a', rangedAttack: '#5f8fdc', attack: '#ff3b4f', work: '#ffe25a',
  claim: '#b46cff', move: '#d7e0e5', tough: '#e8e8e8', ring: '#1c1c1c',
  inner: '#666666', energy: '#ffe25a', cargoOther: '#ffffff'
};
const MAX_BODY_PARTS = 50;
const PART_ANGLE = 360 / MAX_BODY_PARTS;
const TOP_PART_ORDER = [
  { key: 'heal', color: PART_COLORS.heal },
  { key: 'rangedAttack', color: PART_COLORS.rangedAttack },
  { key: 'attack', color: PART_COLORS.attack },
  { key: 'work', color: PART_COLORS.work },
  { key: 'claim', color: PART_COLORS.claim }
];

function pointOnCircle(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = angleDeg * Math.PI / 180;
  return { x: cx + Math.sin(rad) * radius, y: cy - Math.cos(rad) * radius };
}
function arcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = pointOnCircle(cx, cy, radius, startAngle);
  const end = pointOnCircle(cx, cy, radius, endAngle);
  const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return 'M ' + start.x.toFixed(3) + ' ' + start.y.toFixed(3)
    + ' A ' + radius.toFixed(3) + ' ' + radius.toFixed(3) + ' 0 ' + largeArcFlag + ' 1 '
    + end.x.toFixed(3) + ' ' + end.y.toFixed(3);
}
function arc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number, color: string, width: number) {
  if (Math.abs(endAngle - startAngle) <= 0.001) return '';
  return '<path d="' + arcPath(cx, cy, radius, startAngle, endAngle)
    + '" fill="none" stroke="' + color + '" stroke-width="' + width.toFixed(3) + '" stroke-linecap="butt"/>';
}

export function countBodyParts(body?: Array<{ type: string; hits?: number }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const part of body || []) {
    if (part.hits !== undefined && part.hits <= 0) continue;
    counts[part.type] = (counts[part.type] || 0) + 1;
  }
  return counts;
}

export function generateCreepSvg(cx: number, cy: number, size: number, bodyCounts: Record<string, number>, store: Record<string, number> | undefined, opacity: number | undefined, innerColor: string | undefined, storeCapacity?: number, rotationDegrees?: number): string {
  const unit = size / 100;
  const ringRadius = 28 * unit;
  const ringWidth = 12 * unit;
  const innerRadius = 18 * unit;
  const rotation = rotationDegrees ? ' transform="rotate(' + rotationDegrees.toFixed(1) + ' ' + cx + ' ' + cy + ')"' : '';
  let svg = '<g class="dojo-creep" opacity="' + (opacity !== undefined ? opacity : 1) + '"' + rotation + '>';
  svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ringRadius.toFixed(3) + '" fill="none" stroke="' + PART_COLORS.ring + '" stroke-width="' + ringWidth.toFixed(3) + '"/>';
  if (bodyCounts.tough > 0) {
    const toughSpan = bodyCounts.tough * PART_ANGLE;
    const toughRadius = ringRadius + ringWidth / 2 + 2 * unit;
    svg += arc(cx, cy, toughRadius, 225 - toughSpan / 2, 225 + toughSpan / 2, PART_COLORS.tough, 4 * unit);
  }
  if (bodyCounts.move > 0) {
    const moveSpan = bodyCounts.move * PART_ANGLE;
    svg += arc(cx, cy, ringRadius, 180 - moveSpan / 2, 180 + moveSpan / 2, PART_COLORS.move, ringWidth);
  }
  for (let i = 0; i < TOP_PART_ORDER.length; i++) {
    let cumulative = 0;
    for (let j = i; j < TOP_PART_ORDER.length; j++) cumulative += bodyCounts[TOP_PART_ORDER[j].key] || 0;
    if (cumulative <= 0) continue;
    const span = cumulative * PART_ANGLE;
    svg += arc(cx, cy, ringRadius, -span / 2, span / 2, TOP_PART_ORDER[i].color, ringWidth);
  }
  svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + innerRadius.toFixed(3) + '" fill="' + (innerColor || PART_COLORS.inner) + '"/>';
  const carried = Object.keys(store || {}).filter((r) => (store || {})[r] > 0);
  if (carried.length > 0) {
    const cargoColor = carried.length === 1 && carried[0] === 'energy' ? PART_COLORS.energy : PART_COLORS.cargoOther;
    let cargoRadius = 6 * unit;
    if (typeof storeCapacity === 'number' && storeCapacity > 0) {
      let used = 0;
      for (const r of carried) used += (store as Record<string, number>)[r];
      const fraction = Math.min(1, used / storeCapacity);
      cargoRadius = (4 + 12 * fraction) * unit;
    }
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + cargoRadius.toFixed(3) + '" fill="' + cargoColor + '"/>';
  }
  svg += '</g>';
  return svg;
}
