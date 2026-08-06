'use strict';

// Runs ONE scenario in a dedicated child process and streams events to the
// parent over IPC. A fresh process per run is the only reliable way to get a
// clean engine: screeps-server-mockup / @screeps/driver keep module-level
// singleton state (storage connection, pubsub, Memory), so running multiple
// scenarios in one long-lived process leaks state between runs. The CLI avoids
// this by running once per process; the GUI server now does the same by forking.
//
//   fork: node scripts/runScenarioChild.js <scenarioDir> [record]
//   parent -> child:  { type: 'abort' }
//   child  -> parent: { ev: <runner event> } ... { done: true }
process.env.DOJO_MOCK_ENGINE_PROCESS_ISOLATED = '1';

const { runScenario } = require('../src/scenarioRunner');

const scenarioDir = process.argv[2];
const record = process.argv[3] === 'record' || process.argv[3] === '1';

if (!scenarioDir) { console.error('usage: runScenarioChild <scenarioDir> [record]'); process.exit(2); }

const signal = { aborted: false };
process.on('message', function (msg) { if (msg && msg.type === 'abort') signal.aborted = true; });

function send(obj) { if (process.send) process.send(obj); }

runScenario(scenarioDir, {
	signal: signal,
	runExpect: true,
	record: record,
	streamFrames: true,
	onEvent: function (ev) {
		try { send({ ev: ev }); } catch (e) { /* forwarding never breaks the run */ }
	}
}).then(function () {
	send({ done: true });
	process.exit(0);
}).catch(function (err) {
	send({ ev: { type: 'fatal', error: String((err && err.message) || err) } });
	send({ done: true });
	process.exit(1);
});
