'use strict';

const fs = require('fs');
const path = require('path');
const { roomToMap } = require('./import/roomToMap');
const { assignLabels } = require('./import/ownerLabels');
const modRegistry = require('./mods');

// Uses exactly the live import's supported map fields and clock rebasing.
// Called synchronously at finalization, including from signal handlers.
function writeEndState(dir, snapshot, terrain, meta) {
	const frame = snapshot.frame;
	const registry = { labels: {}, users: {} };
	for (const label of Object.keys(snapshot.playerUserIds || {})) {
		const id = String(snapshot.playerUserIds[label]);
		registry.labels[id] = label;
		registry.users[label] = { id: id, username: (frame.users[id] || {}).username || null };
	}
	const tags = { '2': 'invader', '3': 'sourceKeeper' };
	tags[meta.botUserId] = 'me';
	const ids = new Set(frame.objects.filter(object => object.user).map(object => String(object.user)));
	assignLabels(Array.from(ids).filter(id => !tags[id]).map(id => ({
		id: id, username: (frame.users[id] || {}).username
	})), registry);
	const out = path.join(dir, 'end state');
	fs.mkdirSync(out, { recursive: true });
	for (const room of Object.keys(terrain)) {
		const result = roomToMap({
			roomName: room, terrainRows: terrain[room],
			objects: frame.objects.filter(object => object.room === room),
			gameTime: frame.gameTime,
			classifyOwner: id => tags[id] || registry.labels[id] || null,
			users: registry.users,
			extraStructureTypes: modRegistry.importTypes(meta.mods || [])
		});
		fs.writeFileSync(path.join(out, 'map.' + room + '.json'), JSON.stringify(result.map, null, '\t'));
	}
	fs.writeFileSync(path.join(out, 'memory.json'), snapshot.memory == null ? '{}' : snapshot.memory);
	fs.writeFileSync(path.join(out, 'segments.json'), JSON.stringify(snapshot.segments || {}, null, '\t'));
}

module.exports = { writeEndState };
