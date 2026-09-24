import type { Monaco } from '@monaco-editor/react';

// IntelliSense for the Edit tab's JavaScript. A scenario directory holds code
// for two different runtimes, and each gets only its own types:
//
//   bot      — main.js and other bot code, run inside the Screeps VM:
//              Game, Creep, FIND_* ... (typed-screeps)
//   scenario — scenario.js and its Node helpers, run by the harness:
//              require('screeps-dojo/...') and the scenario contract
//
// Monaco has one JavaScript service for every open model, so the libs are
// swapped whenever the selected file changes.

export type JsSide = 'bot' | 'scenario';

const NODE_SIDE_REQUIRE = /require\(\s*['"](screeps-dojo\/[^'"]*|fs|path|assert|os|child_process|node:[^'"]+)['"]\s*\)/;

export function jsSideFor(path: string, content: string): JsSide {
  const name = path.split('/').pop() || path;
  if (name === 'scenario.js') return 'scenario';
  return NODE_SIDE_REQUIRE.test(content) ? 'scenario' : 'bot';
}

// TypeScript only learns what `module.exports` is from a JSDoc @type directly
// on the assignment — a declared global type for `module` is ignored for it.
// So a scenario.js without the annotation gets it as an extra line, right
// above `module.exports =`, that exists only in the editor: hidden from view,
// and stripped from every edit before it reaches the file. A file that already
// carries the annotation is left alone.
export const SCENARIO_ANNOTATION = "/** @type {import('screeps-dojo/scenarioRunner').Scenario} */";
const HAS_SCENARIO_TYPE = /@type\s*\{\s*import\(\s*['"]screeps-dojo\/scenarioRunner['"]\s*\)\.Scenario\s*\}/;
const EXPORTS_LINE = /^\s*module\.exports\s*=/;

export function wantsScenarioAnnotation(path: string, content: string): boolean {
  const name = path.split('/').pop() || path;
  return name === 'scenario.js' && !HAS_SCENARIO_TYPE.test(content);
}

// The editor's text: the file with the annotation above its first
// `module.exports =` line, and the 1-based line it landed on (0: nowhere to put it).
export function withAnnotation(content: string): { value: string; line: number } {
  const lines = content.split('\n');
  const at = lines.findIndex((l) => EXPORTS_LINE.test(l));
  if (at === -1) return { value: content, line: 0 };
  const eol = content.includes('\r\n') ? '\r' : '';
  lines.splice(at, 0, SCENARIO_ANNOTATION + eol);
  return { value: lines.join('\n'), line: at + 1 };
}

// The file's text back from the editor's. Monaco normalizes line endings, so
// the annotation line may come back with a \r.
export function stripAnnotation(value: string): string {
  const lines = value.split('\n');
  const at = lines.findIndex((l) => l.replace(/\r$/, '') === SCENARIO_ANNOTATION);
  if (at === -1) return value;
  lines.splice(at, 1);
  return lines.join('\n');
}

interface EditorTypes { screeps: string; dojo: Record<string, string>; }
type ExtraLib = { content: string; filePath: string };

// The bot runtime's lodash global is 3.10; typed-screeps leaves `_` to
// @types/lodash (a v4 API). Declaring it loosely beats completing the wrong
// version's methods.
const BOT_GLOBALS = 'declare const _: any;\n';

let typesPromise: Promise<EditorTypes> | null = null;
let libsBySide: Record<JsSide, ExtraLib[]> | null = null;
let configured = false;
let wantedSide: JsSide | null = null;
let appliedSide: JsSide | null = null;

function languageDefaults(monaco: Monaco) {
  // 0.55 moved the TypeScript service to a top-level namespace.
  const m = monaco as any;
  return m.typescript || m.languages.typescript;
}

function buildLibs(types: EditorTypes): Record<JsSide, ExtraLib[]> {
  const scenario: ExtraLib[] = Object.keys(types.dojo).map((name) => ({
    content: types.dojo[name],
    // Node resolution finds require('screeps-dojo/dojoWorld') here, and the
    // declarations' own relative imports resolve beside it.
    filePath: 'file:///node_modules/screeps-dojo/' + name + '.d.ts'
  }));
  const bot: ExtraLib[] = [
    { content: types.screeps, filePath: 'file:///node_modules/@types/screeps/index.d.ts' },
    { content: BOT_GLOBALS, filePath: 'file:///dojo-bot-globals.d.ts' }
  ];
  return { bot, scenario };
}

function apply(monaco: Monaco) {
  if (!libsBySide || !wantedSide || appliedSide === wantedSide) return;
  languageDefaults(monaco).javascriptDefaults.setExtraLibs(libsBySide[wantedSide]);
  appliedSide = wantedSide;
}

// Call from the editor's beforeMount: once per page is enough, later calls
// are no-ops. The declarations (~300 KB) load as their own chunk.
export function configureJavaScript(monaco: Monaco) {
  if (configured) return;
  configured = true;
  const ts = languageDefaults(monaco);
  ts.javascriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    lib: ['es2020'],               // no DOM: neither runtime has window/document
    allowJs: true,
    allowNonTsExtensions: true,
    checkJs: false,                // completion and hovers, not type errors
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs
  });
  typesPromise = typesPromise || import('virtual:editor-types').then((m) => m.default);
  typesPromise.then((types) => { libsBySide = buildLibs(types); apply(monaco); }).catch(() => {});
}

export function selectJsTypes(monaco: Monaco, side: JsSide) {
  wantedSide = side;
  apply(monaco);
}
