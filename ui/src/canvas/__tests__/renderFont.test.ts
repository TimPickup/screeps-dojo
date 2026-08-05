import { describe, expect, it } from 'vitest';
import { RENDER_FONT_FAMILY, canvasFont, parseRenderFont } from '../renderFont';

describe('render font', () => {
  it('uses one explicit family instead of a platform generic fallback', () => {
    expect(canvasFont(parseRenderFont(0.8))).toBe(`normal 400 0.8px "${RENDER_FONT_FAMILY}"`);
  });

  it('parses RoomVisual string fonts without confusing weight for size', () => {
    expect(parseRenderFont('bold 0.8 Arial')).toEqual({ size: 0.8, weight: 700, style: 'normal' });
    expect(parseRenderFont('italic 700 64px Inter')).toEqual({ size: 64, weight: 700, style: 'italic' });
  });
});
