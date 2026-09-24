import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { Plugin } from 'vite';

// Serves `virtual:editor-types`: the declaration files the Edit tab's Monaco
// feeds its JavaScript language service.
//
//   screeps — typed-screeps, for bot code (main.js and friends)
//   dojo    — declarations GENERATED from ../src on every build, for
//             scenario.js, keyed by module name ('dojoWorld', 'scenarioRunner')
//
// Generated rather than hand-written so the editor never describes a harness
// that no longer exists: a renamed or added world method shows up at the next
// UI build. Types come from the JSDoc in src; everything unannotated is `any`.

const VIRTUAL_ID = 'virtual:editor-types';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(HERE, '../../src');
const SCREEPS_DTS = path.resolve(HERE, '../node_modules/@types/screeps/index.d.ts');

// A `//` block directly above a method, function or class becomes a JSDoc
// block before tsc reads the file, so the prose src already carries turns into
// hover documentation without src changing comment style. Only the copy tsc
// compiles is rewritten; the file on disk is untouched.
const CONTROL_WORDS = /^(if|for|while|switch|catch|return|await|typeof|function)$/;
const DECLARATION = /^\s*(\/\*\*|class\s|(async\s+)?function\b|(static\s+)?(async\s+)?(get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$)/;

//
// When the declaration already has a JSDoc block (the @param tags), the prose
// goes INTO it: TypeScript documents a declaration from its last doc block
// only, so a separate block would be dropped.
export function promoteLineComments(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let block: string[] = [];
  let pendingProse: string[] | null = null;
  const proseLines = (indent: string) => block.map((line) => {
    const text = line.replace(/^\s*\/\/ ?/, '').replace(/\*\//g, '*\\/');
    return indent + ' *' + (text ? ' ' + text : '');
  });
  const flush = (next: string | undefined) => {
    if (block.length === 0) return;
    const match = next === undefined ? null : DECLARATION.exec(next);
    const isDeclaration = match !== null && !(match[6] && CONTROL_WORDS.test(match[6]));
    const indent = /^\s*/.exec(block[0])![0];
    if (isDeclaration && /^\s*\/\*\*\s*$/.test(next!)) {
      pendingProse = proseLines(indent).concat(indent + ' *');
    } else if (isDeclaration) {
      out.push(indent + '/**', ...proseLines(indent), indent + ' */');
    } else {
      out.push(...block);
    }
    block = [];
  };
  for (const line of lines) {
    if (/^\s*\/\/(?!\/)/.test(line)) { block.push(line); continue; }
    flush(line);
    out.push(line);
    if (pendingProse) { out.push(...pendingProse); pendingProse = null; }
  }
  flush(undefined);
  return out.join('\n');
}

export function generateDojoDeclarations(srcDir = SRC_DIR): Record<string, string> {
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).map((f) => path.join(srcDir, f));
  const options: ts.CompilerOptions = {
    allowJs: true,
    declaration: true,
    emitDeclarationOnly: true,
    skipLibCheck: true,
    noEmitOnError: false,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    rootDir: srcDir,
    outDir: path.join(srcDir, '__editor_types__')
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => {
    const text = readFile(file);
    const inSrc = text !== undefined && path.resolve(file).startsWith(srcDir + path.sep) && file.endsWith('.js');
    return inSrc ? promoteLineComments(text) : text;
  };
  const out: Record<string, string> = {};
  const outDir = options.outDir!;
  host.writeFile = (file, text) => {
    const rel = path.relative(outDir, file).split(path.sep).join('/');
    // requires can reach outside src (server-mock-patches); those files are
    // not part of the screeps-dojo package and a scenario never imports them.
    if (rel.startsWith('..') || !rel.endsWith('.d.ts')) return;
    // `_name` members are src's internals; JS has no `private` to say so, so
    // keep them out of the completion list here.
    out[rel.slice(0, -'.d.ts'.length)] = text.replace(/^[ \t]+_[\w$]+\??(\(.*\))?: [^\n]*;\r?\n/gm, '');
  };
  // Type errors in plain JS are expected and do not block declaration emit.
  ts.createProgram(files, options, host).emit();
  return out;
}

export function editorTypesPlugin(): Plugin {
  return {
    name: 'dojo-editor-types',
    resolveId(id) { return id === VIRTUAL_ID ? RESOLVED_ID : null; },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      // Rebuild the dev server's copy when src changes.
      for (const f of fs.readdirSync(SRC_DIR)) if (f.endsWith('.js')) this.addWatchFile(path.join(SRC_DIR, f));
      const types = {
        screeps: fs.readFileSync(SCREEPS_DTS, 'utf8'),
        dojo: generateDojoDeclarations()
      };
      return 'export default ' + JSON.stringify(types) + ';';
    }
  };
}
