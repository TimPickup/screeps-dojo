'use strict';

// Server-Sent Events helper. Anti-buffering headers (no gzip, no proxy buffer)
// so events flush immediately; a 15s heartbeat comment keeps the connection
// alive through idle proxies.
function openSse(res) {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		'Connection': 'keep-alive',
		'X-Accel-Buffering': 'no'
	});
	res.write(': connected\n\n');
	const heartbeat = setInterval(function () {
		try { res.write(': hb\n\n'); } catch (e) { /* connection gone */ }
	}, 15000);
	let closed = false;
	function close() {
		if (closed) return;
		closed = true;
		clearInterval(heartbeat);
		try { res.end(); } catch (e) { /* already ended */ }
	}
	res.on('close', close);
	return {
		send: function (type, data) {
			if (closed) return;
			try {
				res.write('event: ' + type + '\n');
				res.write('data: ' + JSON.stringify(data === undefined ? null : data) + '\n\n');
			} catch (e) { close(); }
		},
		comment: function (text) { if (!closed) { try { res.write(': ' + text + '\n\n'); } catch (e) { close(); } } },
		close: close,
		isClosed: function () { return closed; }
	};
}

module.exports = { openSse: openSse };
