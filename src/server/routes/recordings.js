'use strict';

const path = require('path');
const { listRecordings, loadRecording, listOrphanedRecordings, clearOrphanedRecordings, saveRecordingCpuAvg } = require('../../recording');
const { RECORDINGS_DIR_NAME } = require('../../scenarioTree');
const { pathSafe } = require('../pathSafe');
const streamReplay = require('../streamReplay');

function toPosix(p) { return p.split(path.sep).join('/'); }

module.exports = function registerRecordingRoutes(router, ctx) {
	// Controls belong to a single open response, not a recording or another tab.
	const streams = new Map();
	router.post('/api/recordings/streams/:id/priority', function (req, res) {
		const stream = streams.get(req.params.id);
		if (!stream) { ctx.sendJson(res, 404, { error: 'stream closed' }); return; }
		if (typeof req.body?.urgent !== 'boolean') { ctx.sendJson(res, 400, { error: 'urgent must be a boolean' }); return; }
		stream.urgent = req.body.urgent;
		ctx.sendJson(res, 200, { ok: true });
	});
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

	// Caches the GUI's CPU averages for one recording in its meta.json (see
	// saveRecordingCpuAvg). Body: { path: <relPath of recording.json>, cpuAvg:
	// { warmupTicks, warmup, steady } }. Only that exact shape is written: this
	// is a cache, not a general way to edit a recording's metadata.
	router.post('/api/recordings/cpu-avg', function (req, res) {
		const body = req.body || {};
		const cpuAvg = body.cpuAvg || {};
		const numberOrNull = function (x) { return x === null || (typeof x === 'number' && isFinite(x)); };
		if (typeof cpuAvg.warmupTicks !== 'number' || !numberOrNull(cpuAvg.warmup) || !numberOrNull(cpuAvg.steady)) {
			ctx.sendJson(res, 400, { error: 'cpuAvg must be { warmupTicks, warmup, steady }' });
			return;
		}
		let abs;
		try { abs = pathSafe(ctx.recordingsRoot, body.path); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		const dir = path.dirname(abs);
		if (path.basename(abs) !== 'recording.json' || path.basename(path.dirname(dir)) !== RECORDINGS_DIR_NAME) {
			ctx.sendJson(res, 400, { error: 'not a recording: ' + body.path });
			return;
		}
		try {
			saveRecordingCpuAvg(dir, { warmupTicks: cpuAvg.warmupTicks, warmup: cpuAvg.warmup, steady: cpuAvg.steady });
			ctx.sendJson(res, 200, { ok: true });
		} catch (e) {
			ctx.sendJson(res, e.statusCode || (e.code === 'ENOENT' ? 404 : 500), { error: String((e && e.message) || e) });
		}
	});

	// Recordings left in the old top-level recordings/ with no scenario to
	// move them into — what Settings reports, and offers to clear. The size is
	// a directory walk, so this is only ever read on demand.
	router.get('/api/recordings/orphans', function (req, res) {
		try {
			ctx.sendJson(res, 200, listOrphanedRecordings(ctx.scenariosRoot, ctx.legacyRecordingsRoot));
		} catch (e) {
			ctx.sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) });
		}
	});

	// Deletes all of them. The GUI confirms first with the count and the size;
	// there is no undo, and these are the only copy of those runs.
	router.del('/api/recordings/orphans', function (req, res) {
		try {
			ctx.sendJson(res, 200, clearOrphanedRecordings(ctx.scenariosRoot, ctx.legacyRecordingsRoot));
		} catch (e) {
			ctx.sendJson(res, e.statusCode || 500, { error: String((e && e.message) || e) });
		}
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
			// Content-Length, not chunked. The client picks its JSON parser by the
			// declared size — the engine's own parser below the string limit, a
			// streaming one above it — and without this header every recording,
			// however small, takes the slow path. Stat after loadRecording(), which
			// is what writes the file in the salvage case.
			const size = fs.statSync(abs).size;
			const progressive = req.query.get('progressive') === '1';
			const id = progressive ? require('crypto').randomUUID() : null;
			const control = { urgent: false };
			if (id) {
				streams.set(id, control);
				res.once('close', () => streams.delete(id));
			}
			res.writeHead(200, {
				'Content-Type': 'application/json; charset=utf-8',
				'Content-Length': size,
				...(id ? { 'X-Replay-Stream': id } : {})
			});
			if (progressive) {
				streamReplay(abs, res, { isUrgent: () => control.urgent }).catch(() => res.destroy());
			} else {
				fs.createReadStream(abs).on('error', function () { res.destroy(); }).pipe(res);
			}
		} catch (e) {
			ctx.sendJson(res, (e && e.statusCode) || 404, { error: String((e && e.message) || e) });
		}
	});
};
