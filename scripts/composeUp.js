'use strict';

// How to bring the GUI container up — specifically, whether to throw away its
// node_modules volume.
//
// docker-compose.yml mounts an ANONYMOUS volume at /dojo/node_modules, to keep
// the image's baked modules on top of the bind-mounted source. The comment there
// used to say it is "re-seeded from the image on every fresh container". It is
// not. Compose reuses an existing anonymous volume when it recreates a
// container; only --renew-anon-volumes (or `down -v`) discards one.
//
// So a release that changed a dependency rebuilt the image correctly and then
// started a container still holding the previous node_modules — indefinitely.
// The failure is a long way from the cause: the GUI reads its source over the
// bind mount, so new code is visibly there while the module it needs is not.
// Season 5 was the first release in a while to add a dependency, and it showed
// up as "the mod is in the UI but the engine cannot load it".
//
// Renewing is not free — it re-seeds ~680 packages from the image — so it is
// tied to the one thing that makes it necessary: having just rebuilt the image.
// An unchanged image means the volume already matches it.
function upArgs(opts) {
	const args = ['compose', 'up', '-d'];
	if (opts && opts.rebuilt) {
		// --force-recreate as well: without it a container whose config and image
		// id are unchanged is left running, and the renewal never happens.
		args.push('--force-recreate', '--renew-anon-volumes');
	} else if (opts && opts.forceRecreate) {
		args.push('--force-recreate');
	}
	args.push('ui');
	return args;
}

module.exports = { upArgs: upArgs };
