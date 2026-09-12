'use strict';

// The regression these guard: on Windows every host-agent action is spawned
// with shell:true, which hands cmd.exe ONE joined string instead of an argv. A
// user whose Node lived under "…\Local\Author Software\nvm\…" got
//
//   'C:\Users\x\AppData\Local\Author' is not recognized as an internal or
//   external command
//
// for restart, recreate and update alike — the path split at its space.
//
// These run in the Linux container, where the default platform quotes nothing,
// so they ask argv() for the Windows behaviour explicitly.
const assert = require('assert');
const winShell = require('../../src/winShell');

const WIN = true;

describe('winShell', function () {
	describe('argv, for the cmd.exe path', function () {
		it('quotes a command whose path contains a space', function () {
			const ready = winShell.argv('C:\\Users\\x\\Local\\Author Software\\node.exe', [], WIN);
			assert.strictEqual(ready[0], '"C:\\Users\\x\\Local\\Author Software\\node.exe"', 'the exact break users hit');
		});

		it('quotes arguments with spaces too — the script path is one', function () {
			const ready = winShell.argv('node.exe', ['E:\\my dojo\\scripts\\composeOverride.js'], WIN);
			assert.deepStrictEqual(ready[1], ['"E:\\my dojo\\scripts\\composeOverride.js"']);
		});

		it('leaves ordinary tokens alone, so commands stay readable in the log', function () {
			const ready = winShell.argv('docker', ['compose', 'up', '-d', 'ui'], WIN);
			assert.strictEqual(ready[0], 'docker');
			assert.deepStrictEqual(ready[1], ['compose', 'up', '-d', 'ui']);
		});

		it('keeps an empty argument as an empty pair — `start "" <url>` needs it', function () {
			const ready = winShell.argv('start', ['', 'http://localhost:8787/'], WIN);
			assert.deepStrictEqual(ready[1], ['""', 'http://localhost:8787/']);
		});

		it('does not re-quote what is already quoted', function () {
			assert.deepStrictEqual(winShell.argv('"C:\\a b\\node.exe"', [], WIN)[0], '"C:\\a b\\node.exe"');
		});

		it('quotes cmd.exe operators, which would otherwise end the command', function () {
			assert.strictEqual(winShell.quote('a&b'), '"a&b"');
			assert.strictEqual(winShell.quote('a|b'), '"a|b"');
			assert.strictEqual(winShell.quote('a>b'), '"a>b"');
		});

		it('leaves globs unexpanded-looking, so mocha still expands them itself', function () {
			assert.strictEqual(winShell.quote('test/unit/**/*.test.js'), 'test/unit/**/*.test.js');
		});
	});

	describe('off Windows', function () {
		it('hands both back untouched — spawn passes a real argv there', function () {
			const args = ['compose', 'run', '--rm', 'dojo'];
			const ready = winShell.argv('/usr/bin/my docker', args, false);
			assert.strictEqual(ready[0], '/usr/bin/my docker');
			assert.strictEqual(ready[1], args);
		});
	});
});
