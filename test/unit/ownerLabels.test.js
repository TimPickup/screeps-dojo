'use strict';

const assert = require('assert');
const { slugifyUsername, assignLabels, resolveOwners } = require('../../src/import/ownerLabels');

describe('slugifyUsername', function () {
	it('lowercases a plain name', function () {
		assert.strictEqual(slugifyUsername('Almaravarion'), 'almaravarion');
	});

	it('replaces runs of unusable characters with a single dash', function () {
		assert.strictEqual(slugifyUsername('Foo. Bar!!Baz'), 'foo-bar-baz');
	});

	it('trims leading and trailing dashes', function () {
		assert.strictEqual(slugifyUsername('...Tigga...'), 'tigga');
	});

	it('prefixes a name that starts with a digit', function () {
		// settings.json side keys must match /^[a-z0-9][a-z0-9_-]*$/, so a leading
		// digit is legal — but a name that is ONLY digits reads like an id.
		assert.strictEqual(slugifyUsername('7Bit'), '7bit');
	});

	it('returns empty string when nothing usable survives', function () {
		assert.strictEqual(slugifyUsername('...'), '');
		assert.strictEqual(slugifyUsername(''), '');
		assert.strictEqual(slugifyUsername(null), '');
	});

	it('keeps underscores and dashes as-is', function () {
		assert.strictEqual(slugifyUsername('The_Real-Guy'), 'the_real-guy');
	});
});

describe('assignLabels', function () {
	it('labels one player by their slugified username', function () {
		const result = assignLabels([{ id: 'abc', username: 'Almaravarion' }]);
		assert.deepStrictEqual(result.labels, { abc: 'almaravarion' });
		assert.deepStrictEqual(result.users, {
			almaravarion: { id: 'abc', username: 'Almaravarion' }
		});
	});

	it('suffixes a second player whose name slugs the same', function () {
		const result = assignLabels([
			{ id: 'a1', username: 'Foo.Bar' },
			{ id: 'a2', username: 'Foo-Bar' }
		]);
		assert.deepStrictEqual(result.labels, { a1: 'foo-bar', a2: 'foo-bar-2' });
		assert.deepStrictEqual(Object.keys(result.users).sort(), ['foo-bar', 'foo-bar-2']);
	});

	it('suffixes a name that collides with a reserved owner word', function () {
		const result = assignLabels([{ id: 'a1', username: 'Invader' }]);
		assert.deepStrictEqual(result.labels, { a1: 'invader-2' });
	});

	it('falls back to a player-<id> label when the username is unknown', function () {
		const result = assignLabels([{ id: '54d0a5691234', username: null }]);
		assert.deepStrictEqual(result.labels, { '54d0a5691234': 'player-54d0a5' });
		assert.deepStrictEqual(result.users, {
			'player-54d0a5': { id: '54d0a5691234', username: null }
		});
	});

	it('assigns labels in id order so repeated imports are stable', function () {
		const forward = assignLabels([
			{ id: 'b', username: 'Same' }, { id: 'a', username: 'Same' }
		]);
		const backward = assignLabels([
			{ id: 'a', username: 'Same' }, { id: 'b', username: 'Same' }
		]);
		assert.deepStrictEqual(forward.labels, backward.labels);
		assert.deepStrictEqual(forward.labels, { a: 'same', b: 'same-2' });
	});
});

describe('resolveOwners', function () {
	// classifyTag mirrors screepsClient.ownerClassifier(): me/npc tags, or null
	// for a real player whose username we then look up.
	function classifyTag(userId) {
		if (userId === 'mine') return 'me';
		if (userId === '2') return 'invader';
		if (userId === '3') return 'sourceKeeper';
		return null;
	}
	const names = { p1: 'Almaravarion', p2: 'Tigga' };
	async function lookupUsername(id) { return names[id] || null; }

	it('classifies my own and npc objects with the existing tags', async function () {
		const objects = [
			{ type: 'tower', user: 'mine' },
			{ type: 'creep', user: '2' },
			{ type: 'keeperLair', user: '3' },
			{ type: 'container' }
		];
		const resolved = await resolveOwners(objects, { classifyTag, lookupUsername });
		assert.strictEqual(resolved.classifyOwner('mine'), 'me');
		assert.strictEqual(resolved.classifyOwner('2'), 'invader');
		assert.strictEqual(resolved.classifyOwner('3'), 'sourceKeeper');
		assert.deepStrictEqual(resolved.users, {});
	});

	it('gives every distinct player a label and a users entry', async function () {
		const objects = [
			{ type: 'tower', user: 'p1' },
			{ type: 'creep', user: 'p2' },
			{ type: 'extension', user: 'p1' }
		];
		const resolved = await resolveOwners(objects, { classifyTag, lookupUsername });
		assert.strictEqual(resolved.classifyOwner('p1'), 'almaravarion');
		assert.strictEqual(resolved.classifyOwner('p2'), 'tigga');
		assert.deepStrictEqual(resolved.users, {
			almaravarion: { id: 'p1', username: 'Almaravarion' },
			tigga: { id: 'p2', username: 'Tigga' }
		});
	});

	it('looks up each distinct player id exactly once', async function () {
		let calls = 0;
		const objects = [
			{ type: 'tower', user: 'p1' }, { type: 'extension', user: 'p1' },
			{ type: 'creep', user: 'p1' }, { type: 'creep', user: 'p2' }
		];
		await resolveOwners(objects, {
			classifyTag,
			lookupUsername: async function (id) { calls++; return names[id] || null; }
		});
		assert.strictEqual(calls, 2);
	});

	it('still labels a player when the username lookup throws', async function () {
		const objects = [{ type: 'tower', user: '54d0a5691234' }];
		const resolved = await resolveOwners(objects, {
			classifyTag,
			lookupUsername: async function () { throw new Error('404'); }
		});
		assert.strictEqual(resolved.classifyOwner('54d0a5691234'), 'player-54d0a5');
	});

	it('gives a player the same label in every room of one import', async function () {
		// A batch imports room by room. A label that drifted between rooms would
		// point half a block's objects at a side settings.json never assigned.
		const registry = { labels: {}, users: {} };
		const first = await resolveOwners([{ type: 'tower', user: 'p1' }],
			{ classifyTag, lookupUsername, registry: registry });
		const second = await resolveOwners([{ type: 'creep', user: 'p1' }, { type: 'tower', user: 'p2' }],
			{ classifyTag, lookupUsername, registry: registry });
		assert.strictEqual(first.classifyOwner('p1'), 'almaravarion');
		assert.strictEqual(second.classifyOwner('p1'), 'almaravarion');
		assert.deepStrictEqual(second.users, {
			almaravarion: { id: 'p1', username: 'Almaravarion' },
			tigga: { id: 'p2', username: 'Tigga' }
		});
	});

	it('looks a player up once per import, not once per room', async function () {
		let calls = 0;
		const registry = { labels: {}, users: {} };
		const lookupOnce = async function (id) { calls++; return names[id] || null; };
		await resolveOwners([{ type: 'tower', user: 'p1' }], { classifyTag, lookupUsername: lookupOnce, registry: registry });
		await resolveOwners([{ type: 'creep', user: 'p1' }], { classifyTag, lookupUsername: lookupOnce, registry: registry });
		assert.strictEqual(calls, 1);
	});

	it('resolves a cross-room label collision against the whole import', async function () {
		const registry = { labels: {}, users: {} };
		const twoNames = { p1: 'Same', p3: 'Same!' };
		const lookup = async function (id) { return twoNames[id] || null; };
		const first = await resolveOwners([{ type: 'tower', user: 'p1' }],
			{ classifyTag, lookupUsername: lookup, registry: registry });
		const second = await resolveOwners([{ type: 'tower', user: 'p3' }],
			{ classifyTag, lookupUsername: lookup, registry: registry });
		assert.strictEqual(first.classifyOwner('p1'), 'same');
		assert.strictEqual(second.classifyOwner('p3'), 'same-2');
		// Both survive in the shared users table, which every room's map draws on.
		assert.deepStrictEqual(second.users, {
			same: { id: 'p1', username: 'Same' },
			'same-2': { id: 'p3', username: 'Same!' }
		});
	});

	it('reports per-player counts for the import summary', async function () {
		const objects = [
			{ type: 'spawn', user: 'p1' }, { type: 'extension', user: 'p1' },
			{ type: 'creep', user: 'p1' }, { type: 'creep', user: 'p1' },
			{ type: 'creep', user: 'p2' }
		];
		const resolved = await resolveOwners(objects, { classifyTag, lookupUsername });
		assert.deepStrictEqual(resolved.counts, {
			almaravarion: { structures: 2, creeps: 2 },
			tigga: { structures: 0, creeps: 1 }
		});
	});
});
