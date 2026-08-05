'use strict';

const path = require('path');
const { listRecordings, loadRecording } = require('../../recording');
const { pathSafe } = require('../pathSafe');

function toPosix(p) { return p.split(path.sep).join('/'); }

module.exports = function registerRecordingRoutes(router, ctx) {
	// ?scenario=<name> restricts the listing to one scenario. The GUI always
	// passes it; without it this walks every recording on disk, which on a Docker
	// bind mount costs seconds once a few hundred runs have accumulated.
	// The name is validated inside listRecordings (allowlist + containment) —
	// an invalid one throws with statusCode 400 rather than reaching the fs.
	router.get('/api/recordings', function (req, res) {
		const scenario = req.query.get('scenario');
		const options = scenario === null ? {} : { scenario: scenario };
		let list;
		try { list = listRecordings(ctx.recordingsRoot, options); }
		catch (e) { ctx.sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) }); return; }
		ctx.sendJson(res, 200, list.map(function (r) {
			return {
				scenario: r.scenario,
				timestamp: r.timestamp,
				relPath: toPosix(path.relative(ctx.recordingsRoot, r.recordingPath)),
				status: r.status,
				ticks: r.ticks,
				meta: r.meta
			};
		}));
	});

	// Returns the assembled recording JSON ({meta,terrain,frames}). path is the
	// recordings-root-relative path to recording.json; validated by pathSafe.
	router.get('/api/recordings/file', function (req, res) {
		const rel = req.query.get('path');
		if (!rel) { ctx.sendJson(res, 400, { error: 'path required' }); return; }
		let abs;
		try { abs = pathSafe(ctx.recordingsRoot, rel); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		const fs = require('fs');
		try {
			// stream the on-disk JSON directly (no parse+stringify round-trip).
			// loadRecording() only here to assemble a salvaged run if recording.json
			// is missing; if it exists we never parse it server-side.
			if (!fs.existsSync(abs)) loadRecording(abs);
			res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
			fs.createReadStream(abs).on('error', function () { try { res.end(); } catch (e) { /* */ } }).pipe(res);
		} catch (e) {
			ctx.sendJson(res, 404, { error: String((e && e.message) || e) });
		}
	});
};
