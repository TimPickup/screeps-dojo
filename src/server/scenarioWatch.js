'use strict';

// Pushes the scenario tree to the GUI when it changes, so nobody has to press
// a refresh button.
//
// Why a poll and not fs.watch: the server runs in a Linux container over a
// bind mount from the host, where inotify events for host-side edits are
// unreliable-to-absent — a watch that silently never fires is worse than no
// watch. So the tree is re-walked on a timer and the result is pushed only
// when it actually differs from the last one.
//
// What keeps that cheap:
//   - ONE poller for the whole process, however many browser tabs are open;
//   - it only runs while somebody is subscribed (the GUI closes the stream
//     when you open a scenario, and when the tab goes to the background), so
//     an idle dojo touches the disk never;
//   - the walk is one readdir per directory and reads no file contents.
const { walkScenarioTree } = require('../scenarioTree');
const { openSse } = require('./sse');

const POLL_MS = 3000;

function createScenarioWatch(scenariosRoot) {
	const subscribers = new Set();
	let timer = null;
	let lastJson = null;

	function snapshot() {
		const tree = walkScenarioTree(scenariosRoot);
		return {
			folders: tree.folders,
			scenarios: tree.scenarios.map(function (s) {
				return { name: s.name, path: s.path, hasMap: s.hasMap, files: s.files };
			})
		};
	}

	// Compares by serialised form: the walk is deterministic (sorted), so an
	// identical tree always produces an identical string, and the string is the
	// thing we would send anyway.
	function poll() {
		let json;
		try { json = JSON.stringify(snapshot()); }
		catch (e) { return; } // a transient fs error must not kill the timer
		if (json === lastJson) return;
		lastJson = json;
		for (const sink of subscribers) { try { sink(json); } catch (e) { /* dead sink */ } }
	}

	function start() {
		if (timer) return;
		timer = setInterval(poll, POLL_MS);
		// Timers must not hold the process open on shutdown.
		if (typeof timer.unref === 'function') timer.unref();
	}

	function stop() {
		if (!timer) return;
		clearInterval(timer);
		timer = null;
		// Forget the last snapshot: a tree that changed while nobody was
		// listening must still be sent to the next subscriber.
		lastJson = null;
	}

	// Called after the server itself mutates the tree (create/rename/move/
	// delete), so the GUI updates immediately rather than up to POLL_MS later.
	function touch() {
		if (subscribers.size) poll();
	}

	function subscribe(sink) {
		subscribers.add(sink);
		start();
		return function () {
			subscribers.delete(sink);
			if (subscribers.size === 0) stop();
		};
	}

	function handler(req, res) {
		const sse = openSse(res);
		let sentInitial = false;
		const unsubscribe = subscribe(function (json) { sse.send('tree', JSON.parse(json)); });
		// Send the current tree straight away so the client never renders an
		// empty list waiting for the first change.
		try {
			const json = JSON.stringify(snapshot());
			lastJson = json;
			sse.send('tree', JSON.parse(json));
			sentInitial = true;
		} catch (e) {
			sse.send('error', { error: String((e && e.message) || e) });
		}
		if (!sentInitial) lastJson = null;
		res.on('close', unsubscribe);
	}

	return { handler: handler, touch: touch, _poll: poll, _stop: stop, POLL_MS: POLL_MS };
}

module.exports = { createScenarioWatch: createScenarioWatch, POLL_MS: POLL_MS };
