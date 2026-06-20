'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBotModules, allBotModules } = require('../../src/botModules');

describe('botModules', function () {
	let fakeBotDir;

	before(function () {
		fakeBotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dojo-bot-'));
		fs.writeFileSync(path.join(fakeBotDir, 'main.js'), 'module.exports.loop = function () {};\n');
		fs.writeFileSync(path.join(fakeBotDir, 'CombatMovement.js'), 'module.exports = {};\n');
		fs.writeFileSync(path.join(fakeBotDir, 'notes.txt'), 'not a module\n');
	});

	it('loadBotModules reads named modules as strings', function () {
		const modules = loadBotModules(['CombatMovement'], fakeBotDir);
		assert.deepStrictEqual(Object.keys(modules), ['CombatMovement']);
		assert.strictEqual(modules.CombatMovement, 'module.exports = {};\n');
	});

	it('loadBotModules throws a clear error for a missing module', function () {
		assert.throws(function () { loadBotModules(['NoSuchModule'], fakeBotDir); }, /NoSuchModule/);
	});

	it('allBotModules reads every .js file, flat names, ignores non-js', function () {
		const modules = allBotModules(null, fakeBotDir);
		assert.deepStrictEqual(Object.keys(modules).sort(), ['CombatMovement', 'main']);
	});

	it('allBotModules applies overrides on top', function () {
		const modules = allBotModules({ main: 'OVERRIDDEN', Extra: 'NEW' }, fakeBotDir);
		assert.strictEqual(modules.main, 'OVERRIDDEN');
		assert.strictEqual(modules.Extra, 'NEW');
	});

	it('allBotModules skips directories even if named .js', function () {
		fs.mkdirSync(path.join(fakeBotDir, 'nested.js'));
		const modules = allBotModules(null, fakeBotDir);
		assert.strictEqual(modules.nested, undefined);
		assert.deepStrictEqual(Object.keys(modules).sort(), ['CombatMovement', 'main']);
	});
});
