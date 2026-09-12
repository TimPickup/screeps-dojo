'use strict';

// Season 5: claim a reactor, feed it Thorium, watch the score climb.
//
// The mod is selected in settings.json ({ "mods": ["season5"] }) — that is the
// whole switch. Everything the mod's own world generation would have placed
// (the reactor, the Thorium) is placed here instead, because a scenario has to
// be reproducible and a cronjob rolling random positions is not.
const fs = require('fs');
const path = require('path');

module.exports = {
	modules: {
		main: fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
	},
	maxTicks: 120,
	setup: async function (world) {
		// No { room, x, y }: the map carries a spawn with owner 'me', and
		// loadAllMaps adopts it as the bot's home rather than making us restate
		// coordinates the map already has.
		await world.loadAllMaps();
		// One CLAIM creep to take the reactor, one hauler to keep it fed. Both
		// start next to the work so the run is short enough to watch.
		await world.addCreep({ room: 'W0N0', x: 21, y: 25, name: 'claimer', body: ['claim', 'move'] });
		await world.addCreep({ room: 'W0N0', x: 18, y: 25, name: 'hauler', body: ['carry', 'carry', 'move', 'move'] });
	},
	until: function (state) {
		// Score is a USER field: Season 5 pays the reactor's owner, not the room.
		// 30 is far enough past the first burn that the replay shows the hauler
		// making several round trips rather than ending on the opening move.
		return botScore(state) >= 30;
	},
	expect: function (result, assert) {
		const state = result.finalState;
		const reactor = state.objects.find(function (o) { return o.type === 'reactor'; });
		assert.ok(reactor, 'the reactor should still be there');
		assert.strictEqual(reactor.user, botUserId(state), 'the claimer should own the reactor');
		assert.ok(reactor.launchTime > 0, 'a fed reactor should be running (launchTime set)');
		assert.ok(botScore(state) >= 30, 'the reactor should have scored, got ' + botScore(state));
		assert.strictEqual(result.endReason, 'until',
			'should reach the score target within ' + result.ticks + ' ticks, ended on ' + result.endReason);
	}
};

// The scenario's own bot, by the username DojoWorld gives it.
function botUserId(state) {
	for (const id of Object.keys(state.users || {})) {
		if (state.users[id].username === 'dojo') return id;
	}
	return null;
}

function botScore(state) {
	const id = botUserId(state);
	return id && state.users[id] ? state.users[id].score : 0;
}
