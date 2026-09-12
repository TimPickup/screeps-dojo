'use strict';

// Quoting argv for a spawn that goes through cmd.exe.
//
// On Windows, `spawn(cmd, args, { shell: true })` does not pass an argv at all:
// Node joins cmd and args with single spaces and hands that ONE string to
// `cmd.exe /d /s /c`. So a token containing a space splits, and cmd tries to
// run its first word as a program. An ordinary Node install is enough to hit
// it — this came from a user whose node lived under a vendor directory with a
// space in the name, so every host-agent action died at once:
//
//   'C:\Users\x\AppData\Local\Author' is not recognized as an internal or
//   external command, operable program or batch file.
//   FAILED: recreate — C:\Users\x\AppData\Local\Author Software\nvm\installs\
//   v24.21.0\node.exe scripts/composeOverride.js exited 1
//
// Dropping shell:true is not the fix: we need it on Windows so `docker`, `npm`
// and `git` resolve through PATHEXT (npm is npm.cmd, and CreateProcess will
// not run a .cmd). So quote the tokens ourselves, before Node joins them.
//
// POSIX shells are not involved: there spawn passes a real argv and shell:true
// is off, so argv() hands both back untouched.
const isWin = process.platform === 'win32';

// Anything cmd.exe would treat as a separator or an operator rather than as
// part of the word. A path only ever trips the space, but a token is a token.
const NEEDS_QUOTES = /[\s&|<>^()]/;

function quote(token) {
	token = String(token);
	// Empty means an empty argument, not "no argument" — `start "" <url>` needs
	// the pair to survive, or the URL is read as the window title.
	if (token === '') return '""';
	// Idempotent: a caller that already quoted must not end up double-quoted.
	if (token.length > 1 && token.charAt(0) === '"' && token.charAt(token.length - 1) === '"') return token;
	if (!NEEDS_QUOTES.test(token)) return token;
	// A literal " inside a quoted run would close it early. Nothing we spawn
	// contains one (these are paths and fixed subcommands), and cmd.exe has no
	// escape that works in every position, so double it — the one form cmd
	// itself understands — rather than emit a string that ends where it should
	// not.
	return '"' + token.replace(/"/g, '""') + '"';
}

// Returns [cmd, args] ready to hand to spawn/spawnSync WITH shell:isWin.
//
// forWindows is here so the tests can exercise the Windows behaviour: they run
// in the Linux container, where the bug this fixes cannot reproduce and the
// default would quote nothing.
function argv(cmd, args, forWindows) {
	args = args || [];
	if (forWindows === undefined) forWindows = isWin;
	if (!forWindows) return [cmd, args];
	return [quote(cmd), args.map(quote)];
}

module.exports = { argv: argv, quote: quote, isWin: isWin };
