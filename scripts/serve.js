'use strict';

// In-container entry for the GUI server. Built-ins only (see src/server/index.js
// invariant). Binds 0.0.0.0 inside the container; docker-compose publishes the
// port to the HOST loopback (127.0.0.1) so it is not exposed on the network.
//
// First run: if the toolchain isn't installed in the volume yet, the server
// still boots immediately and serves a welcome screen that streams the install
// log; dep-needing routes are gated on readiness until install completes.
const { createServer } = require('../src/server');
const bootstrap = require('../src/server/bootstrap');

const port = Number(process.env.DOJO_UI_PORT) || 8787;
const { ready } = bootstrap.start();
const server = createServer({ ready: ready });

// flip readiness when a not-yet-installed toolchain finishes installing
if (!ready) {
	bootstrap.subscribe(function (evt) {
		if (evt.type === 'ready') server.dojo.ctx.setReady(true);
	});
}

server.listen(port, '0.0.0.0', function () {
	console.log('[dojo-ui] listening on ' + port + ' (host: http://localhost:' + port + ')'
		+ (ready ? '' : ' — installing toolchain, watch the welcome screen'));
});
