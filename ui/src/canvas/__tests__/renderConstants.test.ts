import { describe, expect, it } from 'vitest';
import { RENDER_COLORS, TERRAIN_COLORS } from '../renderConstants';

describe('canvas render colors', () => {
  it('uses one color for each shared visual meaning', () => {
    expect(RENDER_COLORS.creep.attack).toBe(RENDER_COLORS.actions.attack);
    expect(RENDER_COLORS.creep.rangedAttack).toBe(RENDER_COLORS.actions.rangedMassAttack);
    expect(RENDER_COLORS.creep.heal).toBe(RENDER_COLORS.health);
  });

  it('maps plain terrain to the room background color', () => {
    expect(TERRAIN_COLORS['.']).toBe(RENDER_COLORS.terrain.plain);
  });
});
