'use strict';

// Lists (and with "force", stops) leftover one-off dojo containers from
// interrupted runs (Ctrl+C kills the host docker CLI but not the container;
// --rm makes Docker auto-remove them once stopped).
//
// DRY-RUN BY DEFAULT: a running container might be a live test run — stopping
// it SIGTERMs the scenario mid-flight (a real run was once lost this way).
// Inspect the list, make sure nothing is yours, then: npm run clean -- force
const { execSync, spawnSync } = require('child_process');

const force = process.argv.indexOf('force') !== -1 || process.argv.indexOf('--force') !== -1;

const listing = execSync(
	'docker ps --filter name=screepsdojo-dojo-run --format "{{.ID}}\t{{.RunningFor}}\t{{.Command}}"',
	{ encoding: 'utf8' }
).trim();

if (!listing) {
	console.log('[dojo] no leftover containers');
	process.exit(0);
}

const rows = listing.split(/\r?\n/);
console.log('[dojo] ' + rows.length + ' running dojo container(s):');
for (const row of rows) console.log('  ' + row.replace(/\t/g, '   '));

if (!force) {
	console.log('[dojo] dry run — nothing stopped. If none of these are runs you care about:');
	console.log('       npm run clean -- force');
	process.exit(0);
}

const containerIds = rows.map(function (row) { return row.split('\t')[0]; });
console.log('[dojo] stopping ' + containerIds.length + ' container(s)');
spawnSync('docker', ['stop'].concat(containerIds), { stdio: 'inherit', shell: process.platform === 'win32' });
