'use strict';

// Machine-readable child-process progress. Keeping the wire format here means
// the CLI and server cannot quietly disagree about the marker or payload.
const PREFIX = 'DOJO_RENDER_PROGRESS ';

function formatProgress(progress) {
	return PREFIX + JSON.stringify(progress);
}

function parseProgress(line) {
	if (!line.startsWith(PREFIX)) return null;
	try {
		const progress = JSON.parse(line.slice(PREFIX.length));
		return progress && typeof progress === 'object' ? progress : null;
	} catch (error) {
		return null;
	}
}

module.exports = { PREFIX: PREFIX, formatProgress: formatProgress, parseProgress: parseProgress };
