import { describe, expect, it } from 'vitest';
import { generateDojoDeclarations, promoteLineComments } from '../editorTypesPlugin';

describe('promoteLineComments', () => {
  it('turns a // block above a method into JSDoc', () => {
    const out = promoteLineComments('class A {\n\t// Adds a thing.\n\t// Returns its id.\n\tasync add(x) {\n\t}\n}');
    expect(out).toBe('class A {\n\t/**\n\t * Adds a thing.\n\t * Returns its id.\n\t */\n\tasync add(x) {\n\t}\n}');
  });

  it('merges into an existing JSDoc block so the prose is not dropped', () => {
    const out = promoteLineComments('// Adds a thing.\n/**\n * @param {string} x\n */\nfunction add(x) {}');
    expect(out).toBe('/**\n * Adds a thing.\n *\n * @param {string} x\n */\nfunction add(x) {}');
  });

  it('leaves comments above statements alone', () => {
    const src = 'function f() {\n\t// guard\n\tif (x) {\n\t}\n\t// note\n\tconst y = 1;\n}';
    expect(promoteLineComments(src)).toBe(src);
  });

  it('cannot end the generated block early', () => {
    expect(promoteLineComments('// a */ b\nfunction f() {}')).toContain('a *\\/ b');
  });
});

describe('generateDojoDeclarations', () => {
  const types = generateDojoDeclarations();

  it('covers the modules scenarios require', () => {
    expect(Object.keys(types)).toEqual(expect.arrayContaining(['dojoWorld', 'botModules', 'scenarioRunner']));
  });

  it('carries the JSDoc types and the promoted prose', () => {
    expect(types.dojoWorld).toMatch(/addCreep\(creepOptions: CreepOptions\): Promise<string>/);
    expect(types.dojoWorld).toMatch(/readState\(\): Promise<WorldState>/);
    expect(types.dojoWorld).toContain('Places a creep directly, no spawn involved.');
    expect(types.dojoWorld).not.toMatch(/^\s+_botErrors/m);
  });

  it('exports the scenario contract', () => {
    expect(types.scenarioRunner).toMatch(/export \{[^}]*\bScenarioResult, Scenario\b[^}]*\}/);
    expect(types.scenarioRunner).toMatch(/type Scenario = \{/);
  });
});
