'use strict';

// Comment/order-preserving .env editing. parse() extracts KEY=value pairs;
// merge() updates only the given keys in-place (keeping comments, blank lines,
// ordering, and unknown keys), appending any new keys at the end.
const KEY_RE = /^(\s*)([A-Z0-9_]+)(\s*=\s*)(.*?)(\s*)$/;

function unquote(v) { return v.replace(/^['"]|['"]$/g, ''); }

function parse(text) {
	const values = {};
	for (const line of (text || '').split('\n')) {
		const m = KEY_RE.exec(line);
		if (m) values[m[2]] = unquote(m[4]);
	}
	return values;
}

function merge(text, patch) {
	const lines = (text || '').split('\n');
	const remaining = Object.assign({}, patch);
	for (let i = 0; i < lines.length; i++) {
		const m = KEY_RE.exec(lines[i]);
		if (m && Object.prototype.hasOwnProperty.call(remaining, m[2])) {
			lines[i] = m[2] + '=' + String(remaining[m[2]]);
			delete remaining[m[2]];
		}
	}
	const keysLeft = Object.keys(remaining);
	if (keysLeft.length) {
		// drop a trailing empty line before appending, then re-add one
		while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
		for (const k of keysLeft) lines.push(k + '=' + String(remaining[k]));
		lines.push('');
	}
	return lines.join('\n');
}

// Drops the given keys entirely. Deleting a profile has to remove its lines
// rather than blank them: a KEY= line still declares the profile, so blanking
// would leave a nameless entry in the Settings list forever.
function remove(text, keys) {
	const drop = new Set(keys || []);
	if (!drop.size) return text;
	const lines = (text || '').split('\n');
	const kept = [];
	for (const line of lines) {
		const m = KEY_RE.exec(line);
		if (m && drop.has(m[2])) continue;
		kept.push(line);
	}
	return kept.join('\n');
}

module.exports = { parse: parse, merge: merge, remove: remove };
