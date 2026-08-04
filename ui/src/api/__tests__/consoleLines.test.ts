import { describe, it, expect } from 'vitest';
import { isWarningLine } from '../consoleLines';

describe('isWarningLine', () => {
  it('spots a warning as the runner writes it', () => {
    expect(isWarningLine("⚠ DOJO WARNING: world.addRoomObject('energy') bypasses …")).toBe(true);
    expect(isWarningLine('⚠ bot error: Could not load terrain data')).toBe(true);
  });

  // The replay viewer prefixes every line with its tick, which is exactly how
  // the highlighting was lost the first time round.
  it('still spots one behind the replay viewer tick prefix', () => {
    expect(isWarningLine('[1] ⚠ DOJO WARNING: something')).toBe(true);
    expect(isWarningLine('[4271] ⚠ bot error: boom')).toBe(true);
  });

  it('leaves ordinary bot output alone', () => {
    expect(isWarningLine('[12] harvesting from source 5bbc…')).toBe(false);
    expect(isWarningLine('spawning worker A')).toBe(false);
    expect(isWarningLine('the creep said ⚠ mid-line')).toBe(false);
  });
});
