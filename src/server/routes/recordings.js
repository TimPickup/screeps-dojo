'use strict';

const path = require('path');
const { listRecordings, loadRecording } = require('../../recording');
const { pathSafe } = require('../pathSafe');

function toPosix(p) { return p.split(path.sep).join('/'); }

module.exports = function registerRecordingRoutes(router, ctx) {
	router.get('/api/recordings', function (req, res) {
		const list = listRecordings(ctx.recordingsRoot).map(function (r) {
			return {
				scenario: r.scenario,
				timestamp: r.timestamp,
				relPath: toPosix(path.relative(ctx.recordingsRoot, r.recordingPath)),
				meta: r.meta
			};
		});
		ctx.sendJson(res, 200, list);
	});

	// Renders every frame of a recording to a full-fidelity SVG (same renderer as
	// the MP4/GIF export) so the replay viewer has parity. renderFrameSvg pulls in
	// engine-side deps (@screeps/common) so it is lazy-required and readiness-gated
	// to keep the server bootable on an empty volume.
	router.get('/api/recordings/rendered', function (req, res) {
		if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up' }); return; }
		const rel = req.query.get('path');
		if (!rel) { ctx.sendJson(res, 400, { error: 'path required' }); return; }
		let abs;
		try { abs = pathSafe(ctx.recordingsRoot, rel); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		try {
			const { renderFrameSvg, renderUserVisualLayerSvg, computeLayout } = require('../../render/frameRenderer');
			const recording = loadRecording(abs);
			const rooms = Object.keys(recording.terrain || {});
			const layout = computeLayout(rooms);
			const PPR = 600;
			// base frames WITHOUT user visuals + a separate per-frame user-visual
			// overlay, so the client toggles visuals instantly (no re-fetch/re-render).
			const frames = [];
			const visualLayers = [];
			for (let i = 0; i < recording.frames.length; i++) {
				frames.push(renderFrameSvg(recording, i, 0, { pixelsPerRoom: PPR, rooms: rooms, staticActions: true, showUserVisuals: false }));
				visualLayers.push(renderUserVisualLayerSvg(recording, i, { pixelsPerRoom: PPR, rooms: rooms }));
			}
			ctx.sendJson(res, 200, {
				layout: { rooms: rooms, offsets: layout.offsets, pixelsPerRoom: PPR, width: layout.columns * PPR, height: layout.rows * PPR },
				frames: frames,
				visualLayers: visualLayers
			});
		} catch (e) {
			ctx.sendJson(res, 500, { error: String((e && e.message) || e) });
		}
	});

	// Canvas renderer: one static-scene SVG (terrain+structures+sources+
	// controllers+flags, no creeps/effects) for a given frame, used as a cached
	// per-epoch background. Lightweight vs /rendered (which does every frame).
	router.get('/api/recordings/scene', function (req, res) {
		if (!ctx.isReady()) { ctx.sendJson(res, 503, { error: 'starting up' }); return; }
		const rel = req.query.get('path');
		const frame = Number(req.query.get('frame') || 0);
		if (!rel) { ctx.sendJson(res, 400, { error: 'path required' }); return; }
		let abs;
		try { abs = pathSafe(ctx.recordingsRoot, rel); } catch (e) { ctx.sendJson(res, 400, { error: e.message }); return; }
		try {
			const { renderFrameSvg, computeLayout } = require('../../render/frameRenderer');
			const recording = loadRecording(abs);
			const rooms = Object.keys(recording.terrain || {});
			const layout = computeLayout(rooms);
			const PPR = 600;
			const idx = Math.max(0, Math.min(recording.frames.length - 1, frame));
			const svg = renderFrameSvg(recording, idx, 0, { pixelsPerRoom: PPR, rooms: rooms, staticSceneOnly: true });
			ctx.sendJson(res, 200, {
				svg: svg,
				layout: { rooms: rooms, offsets: layout.offsets, pixelsPerRoom: PPR, width: layout.columns * PPR, height: layout.rows * PPR }
			});
		} catch (e) {
			ctx.sendJson(res, 500, { error: String((e && e.message) || e) });
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
			res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
			fs.createReadStream(abs).on('error', function () { try { res.end(); } catch (e) { /* */ } }).pipe(res);
		} catch (e) {
			ctx.sendJson(res, 404, { error: String((e && e.message) || e) });
		}
	});
};
