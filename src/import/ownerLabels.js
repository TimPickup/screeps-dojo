'use strict';

// Turns the raw `user` ids on live room-object docs into the owner LABELS a
// dojo map carries. My own objects and the NPCs keep their existing tags
// ('me' / 'invader' / 'sourceKeeper'); every other player gets a label derived
// from their in-game username, which is also the key you assign a bot codebase
// to in the scenario's settings.json (`bots: { "<label>": "<profile>" }`).
//
// Nothing here talks to the network: the username lookup is injected, so the
// whole labelling policy is testable without a server.

// A label doubles as a settings.json side key, whose grammar is the tighter of
// the two: /^[a-z0-9][a-z0-9_-]*$/ (src/scenarioSettings.js SIDE_RE).
const LABEL_RE = /^[a-z0-9][a-z0-9_-]*$/;

// Words that already mean something as a map `owner`, so a player whose name
// slugs to one of them is pushed aside instead of silently becoming the bot,
// an NPC, or an unclaimed controller. 'main' is settings.json's own side name
// for the scenario's bot.
const RESERVED = new Set(['main', 'me', 'invader', 'sourcekeeper', 'neutral', 'unclaimed']);

// How much of a user id goes into a fallback label. Six hex chars is enough to
// tell two owners in one room apart and still be typeable into settings.json.
const ID_LABEL_CHARS = 6;

function slugifyUsername(username) {
	if (!username || typeof username !== 'string') return '';
	const slug = username
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return LABEL_RE.test(slug) ? slug : '';
}

// [{ id, username }] -> { labels: { id: label }, users: { label: { id, username } } }
//
// Entries are processed in id order, so a collision resolves the same way on
// every import of the same block — a label that moved between runs would break
// whatever settings.json had assigned to it.
//
// `registry` is an existing { labels, users } to EXTEND: a multi-room import
// passes the same one through every room so a player keeps one label across the
// whole batch, and a collision is resolved against every label already handed
// out rather than only the ones in the current room.
function assignLabels(entries, registry) {
	const sorted = (entries || []).slice().sort(function (a, b) {
		return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
	});
	const labels = (registry && registry.labels) || {};
	const users = (registry && registry.users) || {};
	for (const entry of sorted) {
		const id = String(entry.id);
		if (labels[id] !== undefined) continue;   // already labelled earlier in this import
		const base = slugifyUsername(entry.username) || 'player-' + id.slice(0, ID_LABEL_CHARS);
		let label = base;
		let suffix = 1;
		while (RESERVED.has(label) || users[label] !== undefined) {
			suffix += 1;
			label = base + '-' + suffix;
		}
		labels[id] = label;
		users[label] = { id: id, username: entry.username === undefined ? null : entry.username };
	}
	return { labels: labels, users: users };
}

// One pass over a room's raw object docs:
//   classifyOwner — sync id -> 'me' | 'invader' | 'sourceKeeper' | label | null,
//                   which is what roomToMap consumes
//   users         — the label -> { id, username } table written into map.json
//   counts        — label -> { structures, creeps }, for the import summary
//
// `classifyTag` is screepsClient.ownerClassifier(): my tag, an NPC tag, or null
// for a real player. `lookupUsername` resolves a player id to their in-game
// name; a failure is never fatal — the player just gets an id-based label.
async function resolveOwners(objects, options) {
	const classifyTag = options.classifyTag;
	const lookupUsername = options.lookupUsername;
	// Shared across every room of one import; a fresh one per call otherwise.
	const registry = options.registry || { labels: {}, users: {} };

	const tags = {};
	const players = [];
	for (const object of objects || []) {
		if (!object.user) continue;
		const id = String(object.user);
		if (tags[id] !== undefined) continue;
		const tag = classifyTag(id);
		tags[id] = tag;
		// A player already labelled in an earlier room of this import keeps that
		// label, and is not looked up again.
		if (tag === null) {
			if (registry.labels[id] !== undefined) tags[id] = registry.labels[id];
			else players.push(id);
		}
	}

	const entries = [];
	for (const id of players) {
		let username = null;
		try { username = await lookupUsername(id); }
		catch (error) { username = null; }
		entries.push({ id: id, username: username });
	}
	const assigned = assignLabels(entries, registry);
	for (const id of players) tags[id] = assigned.labels[id];

	const counts = {};
	for (const label of Object.keys(assigned.users)) counts[label] = { structures: 0, creeps: 0 };
	for (const object of objects || []) {
		if (!object.user) continue;
		const label = tags[String(object.user)];
		if (!counts[label]) continue;
		if (object.type === 'creep') counts[label].creeps += 1;
		else counts[label].structures += 1;
	}

	return {
		classifyOwner: function (userId) {
			const tag = tags[String(userId)];
			return tag === undefined ? null : tag;
		},
		users: assigned.users,
		counts: counts
	};
}

module.exports = {
	slugifyUsername: slugifyUsername,
	assignLabels: assignLabels,
	resolveOwners: resolveOwners,
	RESERVED: RESERVED
};
