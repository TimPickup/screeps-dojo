'use strict';

const fs = require('fs');
const path = require('path');

// The new-scenario template is a committed snapshot of a working two-room
// economy + combat demo (spawn + RCL-1 controller + sources in W1N1, an
// unclaimed controller in the connected W0N1, an invader to fight; the bot
// harvests/upgrades to RCL 2 and sends an attacker). Editing the files in
// templates/new-scenario/ changes what every new scenario starts from.
const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'templates', 'new-scenario');

// Copies the template into targetDir, substituting the scenario name into
// scenario.js's header comment.
function createFromTemplate(targetDir, name) {
	fs.mkdirSync(targetDir, { recursive: true });
	for (const file of fs.readdirSync(TEMPLATE_DIR)) {
		const src = path.join(TEMPLATE_DIR, file);
		if (!fs.statSync(src).isFile()) continue;
		if (file === 'scenario.js') {
			const text = fs.readFileSync(src, 'utf8').replace(/__SCENARIO_NAME__/g, name);
			fs.writeFileSync(path.join(targetDir, file), text, 'utf8');
		} else {
			fs.copyFileSync(src, path.join(targetDir, file));
		}
	}
}

module.exports = { createFromTemplate: createFromTemplate, TEMPLATE_DIR: TEMPLATE_DIR };
