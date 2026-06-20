'use strict';

// Resolves a caller-supplied relative path under a fixed root and rejects any
// path that escapes it (`..`, absolute paths, symlink-style tricks via
// path.resolve normalisation). Every `?path=` / file route runs through this.
const path = require('path');

function pathSafe(root, rel) {
	const rootResolved = path.resolve(root);
	const resolved = path.resolve(rootResolved, rel || '.');
	if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
		const err = new Error('path escapes root: ' + rel);
		err.statusCode = 400;
		throw err;
	}
	return resolved;
}

module.exports = { pathSafe: pathSafe };
