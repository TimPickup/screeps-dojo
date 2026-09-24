import { describe, expect, it } from 'vitest';
import { jsSideFor, SCENARIO_ANNOTATION, stripAnnotation, wantsScenarioAnnotation, withAnnotation } from '../editorTypes';

describe('scenario annotation', () => {
  it('is wanted only by a scenario.js that lacks it', () => {
    expect(wantsScenarioAnnotation('scenario.js', 'module.exports = {};')).toBe(true);
    expect(wantsScenarioAnnotation('scenario.js', SCENARIO_ANNOTATION + '\nmodule.exports = {};')).toBe(false);
    expect(wantsScenarioAnnotation('main.js', 'module.exports = {};')).toBe(false);
  });

  it('goes directly above module.exports, where TypeScript reads it', () => {
    const file = "'use strict';\n// hi\nmodule.exports = {\n};";
    expect(withAnnotation(file)).toEqual({
      value: "'use strict';\n// hi\n" + SCENARIO_ANNOTATION + '\nmodule.exports = {\n};',
      line: 3
    });
    expect(withAnnotation('const x = 1;')).toEqual({ value: 'const x = 1;', line: 0 });
  });

  it('round-trips to the exact file, whatever the line endings', () => {
    for (const file of ["'use strict';\nmodule.exports = {\n};", "'use strict';\r\nmodule.exports = {\r\n};"]) {
      expect(stripAnnotation(withAnnotation(file).value)).toBe(file);
    }
  });
});

describe('jsSideFor', () => {
  it('treats scenario.js as scenario code whatever it contains', () => {
    expect(jsSideFor('scenario.js', '')).toBe('scenario');
    expect(jsSideFor('sub/scenario.js', 'Game.creeps')).toBe('scenario');
  });

  it('treats a file that requires Node or dojo modules as scenario code', () => {
    expect(jsSideFor('helpers.js', "const fs = require('fs');")).toBe('scenario');
    expect(jsSideFor('helpers.js', 'const { allBotModules } = require("screeps-dojo/botModules");')).toBe('scenario');
    expect(jsSideFor('oracle.js', "const assert = require('node:assert');")).toBe('scenario');
  });

  it('treats everything else as bot code', () => {
    expect(jsSideFor('main.js', "const Role = require('Role.Harvester');")).toBe('bot');
    expect(jsSideFor('Role.Harvester.js', 'module.exports = {};')).toBe('bot');
  });
});
