export const RENDER_FONT_FAMILY = 'Dojo Render Mono';

export interface RenderFontSpec {
  size: number;
  weight: 400 | 700;
  style: 'normal' | 'italic';
}

export function parseRenderFont(value: number | string | undefined, fallbackSize = 0.5): RenderFontSpec {
  if (typeof value === 'number') {
    return { size: Number.isFinite(value) && value > 0 ? value : fallbackSize, weight: 400, style: 'normal' };
  }
  if (typeof value !== 'string') return { size: fallbackSize, weight: 400, style: 'normal' };
  const source = value.trim();
  const weightMatch = /(?:^|\s)([1-9]00|bold|bolder)(?=\s|$)/i.exec(source);
  const sizeSource = weightMatch
    ? source.slice(0, weightMatch.index) + ' ' + source.slice(weightMatch.index + weightMatch[0].length)
    : source;
  const sizeMatch = /(?:^|\s)(\d*\.?\d+)(?:px)?(?=\s|$)/i.exec(sizeSource);
  const parsedSize = sizeMatch ? Number(sizeMatch[1]) : fallbackSize;
  const numericWeight = weightMatch && /^\d/.test(weightMatch[1]) ? Number(weightMatch[1]) : 400;
  return {
    size: Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : fallbackSize,
    weight: weightMatch && (weightMatch[1].toLowerCase() === 'bold' || weightMatch[1].toLowerCase() === 'bolder' || numericWeight >= 600) ? 700 : 400,
    style: /(?:^|\s)(italic|oblique)(?=\s|$)/i.test(source) ? 'italic' : 'normal',
  };
}

export function canvasFont(spec: RenderFontSpec): string {
  return `${spec.style} ${spec.weight} ${spec.size}px "${RENDER_FONT_FAMILY}"`;
}

// Skia (used by @napi-rs/canvas) rasterises sub-pixel font sizes before the
// current transform, while Chromium rasterises at the transformed size. Draw
// axis-aligned text directly in device pixels so both engines rasterise the
// exact same requested size and baseline. Every Dojo stage uses a uniform,
// axis-aligned world transform; unusual transforms retain normal Canvas rules.
export function fillRenderText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spec: RenderFontSpec,
  align: CanvasTextAlign = 'center',
): void {
  const transform = ctx.getTransform();
  const axisAligned = Math.abs(transform.b) < 1e-9
    && Math.abs(transform.c) < 1e-9
    && transform.a > 0
    && Math.abs(transform.a - transform.d) < 1e-9;
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (axisAligned) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = canvasFont({ ...spec, size: spec.size * transform.a });
    ctx.fillText(String(text), transform.a * x + transform.e, transform.d * y + transform.f);
  } else {
    ctx.font = canvasFont(spec);
    ctx.fillText(String(text), x, y);
  }
  ctx.restore();
}

let loadPromise: Promise<void> | null = null;

// Canvas does not repaint text when a web font arrives. Callers therefore wait
// for both exact server font faces before building cached layers or drawing.
export function ensureRenderFonts(): Promise<void> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return Promise.resolve();
  if (!loadPromise) {
    loadPromise = Promise.all([
      new FontFace(RENDER_FONT_FAMILY, 'url("/api/render/font?weight=400")', { weight: '400', style: 'normal' }).load(),
      new FontFace(RENDER_FONT_FAMILY, 'url("/api/render/font?weight=700")', { weight: '700', style: 'normal' }).load(),
    ]).then((faces) => {
      for (const face of faces) document.fonts.add(face);
      return document.fonts.load(`400 12px "${RENDER_FONT_FAMILY}"`);
    }).then(() => undefined);
  }
  return loadPromise;
}
