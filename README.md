# Screeps Dojo

[![CI](https://github.com/TimPickup/screeps-dojo/actions/workflows/ci.yml/badge.svg)](https://github.com/TimPickup/screeps-dojo/actions/workflows/ci.yml)

Scenario test harness for Screeps bots: runs your REAL bot code inside a real
private-server engine, tick by tick, headless. Define scenarios (map + setup
script + end condition + assertions), run one or all of them, watch them live,
record replays, and get pass/fail + damage metrics per scenario — all from a
one-command browser UI or the CLI.

## Quickstart (one command)

Requirements: **Docker Desktop** (running) and **Node** (any recent version —
only used to invoke npm scripts).

    npm run ui

That's it — **no `.env` needed to start**. The first run builds the container
image (the engine toolchain is baked in, so there's no separate install step —
the build takes a few minutes; it's cached afterwards), then opens
`http://localhost:8787`.

To run your own bot instead of the bundled examples, copy `.env.example` to
`.env` (PowerShell: `Copy-Item .env.example .env`) and set
`DOJO_BOT_PROFILE_DEFAULT_PATH` to your bot's script folder (flat `.js`
modules). See **[Bot profiles](#bot-profiles)** to register more than one
codebase and let each scenario pick between them.

From the UI you can:

- **Browse scenarios** on the left and drill into one. The list is a tree and
  keeps itself up to date — no refresh button. Group scenarios into **folders**
  (nested as deep as you like, collapsed until you open them), drag a scenario
  or folder onto another folder to move it, and rename, move or delete anything
  from the ✎ / 🗑 icons, a right-click menu, or the keyboard (↑/↓ to move,
  →/← to open and close a folder, F2 to rename, Delete to remove). A scenario's replays live inside it, so they move
  with it; deleting a folder that still holds something warns you first.
- **+ New scenario** — asks where it goes (defaulting to the folder you last
  worked in) and what to start from: **Basic**, a working two-room starter
  (spawn, sources, a controller to grow to RCL 2, a bundled example bot) that
  runs immediately; **Blank**, just a heavily commented `scenario.js`; a copy of
  anything in `examples/`; or a duplicate of one of your own scenarios. Then it
  drops you into the editor.
- **Breadcrumbs** in the header show which folders the open scenario is in;
  click one to go back to the list with that folder opened.
- **Run** live with a streamed preview + console (showing attacks, harvesting,
  upgrading, etc.), and **Abort** mid-run. Leave the tab and come back — it
  reconnects to the run in progress.
- **Test** headlessly for a pass/fail verdict.
- **Replays** — every recording listed with a PASS/FAIL badge; scrub/play with
  speed control + smooth animation, click any creep/structure to inspect it, and
  export **GIF/MP4**.
- **Edit** files in an in-browser code editor (Monaco), and edit maps in a
  **visual map editor** — paint terrain, place/select structures, claim
  controllers, connect roads/walls, see store capacities — or flip to a
  syntax-highlighted JSON view. **Import a room** from a live server straight
  into the scenario.
- **⚙ Settings** — toggle user visuals, and register/verify the bot codebases
  and Screeps servers in your `.env`; a popup walks you through token activation
  when needed. Each scenario has its own ⚙ too, for overriding which of those it
  uses.

The server runs in the background (detached), so stop it with `npm run ui:stop`
(or `npm run ui:down` to remove the containers); `npm run ui` brings it back up.
Set `DOJO_UI_PORT` in `.env` to change the port (default 8787). The server is
published only to your host loopback (127.0.0.1), never the network.

## CLI

The GUI just drives the same engine — everything is available headless, which is
what you want for CI:

    npm run build             # build the container image (first time)
    npm run install:dojo      # install the server toolchain in the container
    npm run smoke             # boots the server, runs a bot 5 ticks -> "SMOKE OK"
    npm test                  # run internal tests and every scenario
    npm run test:internal     # unit + import + integration tests; no scenarios
    npm run test:unit         # fast unit tests only
    npm run test:integration  # integration tests only
    npm run test:scenarios    # every scenario in scenarios/
    npm run test:ui           # UI Vitest suite
    npm run update            # pull + rebuild + restart the GUI (see "Updating dojo")

Filter a run by its Mocha test or scenario name with a trailing bare word:

    npm run test:scenarios -- walk-to-flag
    npm run test:integration -- DojoWorld

(`npm run ui` does the build + install steps automatically; you only need these
if you prefer the command line or are wiring up CI.)

### Optional fast mock engine

Dojo installs a set of runtime-selectable optimizations for the bundled Screeps
mock engine. They are **on by default**; an unset master switch enables every
optimization. The explicit equivalent is:

    DOJO_FAST_MOCK_ENGINE=1

Each optimization can be selected independently:

    DOJO_FAST_MOCK_ENGINE_RPC_V8=1
    DOJO_FAST_MOCK_ENGINE_CODE_CACHE=1
    DOJO_FAST_MOCK_ENGINE_ROOM_GUARD=1
    DOJO_FAST_MOCK_ENGINE_IN_PROCESS=1
    DOJO_FAST_MOCK_ENGINE_RESET_ACTIVE_ROOMS=1

An explicit individual `0` or `1` overrides the master. For example, this uses
every optimization except in-process execution:

    DOJO_FAST_MOCK_ENGINE=1
    DOJO_FAST_MOCK_ENGINE_IN_PROCESS=0

Unset individual values inherit the master. Changes apply when the `dojo`/`ui`
container is recreated. Verify the installed dependency patches with
`npm run verify:mock-engine-patches` inside the container. Stock multiprocess
mode remains the supported fallback and can always be selected with:

    DOJO_FAST_MOCK_ENGINE=0

## Bot profiles

A bot codebase reaches the container through a bind mount, and a bind mount is
fixed when the container is created — so the container can only ever read paths
that were mounted at that moment. Dojo therefore registers each codebase once,
up front, and selects between them **by name**:

    DOJO_BOT_PROFILE_DEFAULT_PATH=M:/screeps/main
    DOJO_BOT_PROFILE_SPEEDRUN_PATH=M:/screeps/speedrun
    DOJO_DEFAULT_BOT_PROFILE=default

Every profile is mounted read-only at `/bots/<name>`, so switching which one a
scenario runs — or which one is the default — is instant. Only **adding or
changing a path** is a mount change, and Settings has a button for that (see
below). Each row shows its own mount status, so you always know which are live
and which are still waiting.

The older `DOJO_BOT_PATH` still works and means the bot profile named `default`;
the server rewrites it into the profile form on boot. (Server profiles have no
`default` — see below.)

### Applying a mount change without leaving the browser

The GUI runs inside the container, so it cannot recreate its own container or
rebuild its own image — those are host commands. `npm run ui` therefore starts a
small **host agent** behind it, and the GUI asks that.

So Settings has an **Apply mount changes** button and the update banner has an
**Update now** button, and neither needs you to open a terminal. A rebuild's
output streams into the button's own log view, so an update is not a spinner and
a promise.

    npm run ui                  # start the GUI, with the agent behind it
    npm run ui -- --build       # force an image rebuild
    npm run ui -- --no-build    # never rebuild, even if inputs changed
    npm run ui -- --agent       # ...but keep THIS terminal as the agent, to watch it
    npm run ui -- --no-agent    # ...and don't start it at all
    npm run host-agent          # start it on its own
    npm run ui:stop             # stop the GUI and the agent together

Nothing is installed: no service, no scheduled task, no autostart. It lives and
dies with `npm run ui` / `npm run ui:stop`, only one runs at a time, and with no
agent running the GUI just shows the command to type, exactly as before.

How it stays safe:

- The container writes `.dojo-host/request.json` naming **an action from a fixed
  list** — `restart`, `recreate`, `update` — and nothing else. No path, no
  argument, no flag. There is deliberately no "run this command" action.
- Each action maps to a constant command chosen in `scripts/hostAgent.js`.
  Nothing from the request file ever reaches a command line.
- This grants nothing new. Anything that can write `request.json` can already
  write `scripts/ui.js` — they are the same bind-mounted checkout. The
  alternative, mounting the Docker socket into the container, would hand the
  process running your bot code full control of the host daemon.
- Requests are consumed before they run (a crash cannot replay one), handled at
  most once per id, dropped if they were made while no agent was listening, and
  rate-limited so a wedged server cannot spin your machine.
- Every decision, including every refusal, is appended to `.dojo-host/agent.log`
  along with the output of whatever it ran — which is what the GUI tails.
- Both files are written to a temp name and renamed into place, so a reader
  polling on a timer never catches a half-written one. Only one agent runs at a
  time, held by an exclusive lock file rather than a check-then-act, so two
  cannot both consume the same request.
- It does strictly less than the `npm run ui` you already ran: that command
  builds images and recreates containers itself.

### Per-scenario overrides

Any scenario may carry an optional `settings.json`:

```json
{
  "bot": "speedrun",
  "bots": { "enemy": "default" },
  "server": "season",
  "mods": ["season5"]
}
```

- `bot` — the codebase this scenario's own bot runs (`allBotModules()` picks it
  up with no code change). It is shorthand for `bots.main`.
- `bots` — any other side, so you can pit two versions of your bot against each
  other: `world.addEnemyBot({ modules: allBotModules(null, botDir('enemy')) })`.
  A side named after an **imported player's label** needs no scenario code at
  all — the loader binds it (see
  [Other players in an imported room](#other-players-in-an-imported-room)).
- `server` — which Screeps server profile **Import a room** talks to.
- `mods` — which **game mods** this scenario runs under (see below). Absent or
  `[]` is vanilla Screeps.

Values are profile *names*, never paths. Edit the file through the scenario's ⚙
(a form, or raw JSON — the same way `map*.json` opens in the map editor), or by
hand. A scenario with no `settings.json` inherits everything, which is the
normal case.

An unknown or unmounted profile fails the run immediately, naming the profiles
that are registered — never halfway through with a confusing missing-module
error.

## Game mods

A scenario can run under a real Screeps **game mod** — the same code the
official servers load — so you can test a bot against a season's rules instead
of vanilla:

```json
{ "mods": ["season5"] }
```

Tick it in the scenario's ⚙ (**Game mods**), or write it by hand. No mod, or an
empty list, is vanilla Screeps.

### Available mods

| id | what it is |
| --- | --- |
| `season5` | Official [Season 5](https://github.com/screeps/mod-season5) rules: Thorium, reactors, scoring, terminal restrictions and Season 5 stronghold rewards. |

**Season 5 gives you**, all from the official mod, so the engine's own
implementation stays the source of truth:

- `RESOURCE_THORIUM` (`"T"`), included in `RESOURCES_ALL`
- `FIND_REACTORS`, `LOOK_REACTORS`, and the player-visible `Reactor` object
- `Creep.claimReactor()` and reactor ownership
- Thorium consumption, `continuousWork`, and score paid to the reactor's owner
- Thorium accelerating decay and creep ageing for anything sharing its tile
- Depleted Thorium minerals removed
- Terminal transfers restricted to terminals owned by the same player
- Season 5 stronghold reward tables
- A nuke landing in a stronghold room marking its core `depositType: "nuked"`

**What it does not give you.** The mod hangs part of itself off a backend
service and a cron scheduler, and the dojo runs the engine without either. So
these do nothing here, by design:

- automatic Thorium and reactor world generation
- scoreboard ranking cronjobs and the backend scoreboard route
- room decoration endpoints and the official renderer's metadata
- backend respawn hooks

That is the trade that makes a scenario reproducible: you place the seasonal
objects yourself, exactly where you want them, instead of a cronjob rolling
random positions.

```js
// in setup(), or as map.json entries — either works
await world.addObject('W0N0', 'reactor', 20, 25, {});
await world.addObject('W0N0', 'mineral', 10, 10, { mineralType: 'T' });
```

Selecting `season5` fills in what the missing cronjobs would have: a reactor
gets a store, a Thorium mineral gets an amount (or Season 5 deletes it on the
first tick), and an invader core gets `depositType: "normal"`. Anything you
write yourself always wins.

Score is a **user** field, because Season 5 pays the reactor's owner rather than
the room, so `until()` and `expect()` read it from `state.users`:

```js
until: (state) => state.users[myUserId].score >= 30
```

`examples/season5-reactor` is a complete worked example: claim a reactor, haul
Thorium into it, assert the score. Copy it into `scenarios/` and run it.

### Why the list is curated

A mod is arbitrary code the **engine** loads into its own process. It mutates
shared state — game constants, engine event listeners, custom object prototypes
— and Screeps offers no way to unload one. So the dojo will not take a path, a
git URL, or a drop-in folder: a scenario names an id from the catalog in
`src/mods.js`, and that file is the only thing that ever turns an id into a
module path. An id that is not in the catalog fails the run before the engine
boots, rather than quietly running vanilla and producing confidently wrong
results.

For the same reason **every scenario runs in its own process** — both from the
GUI and from `npm test`. A process that has loaded Season 5 can never go back to
vanilla, so it is never asked to.

Because @screeps/common catches and logs mod-load failures rather than raising
them, a run also **probes** its mods once the engine is up (is `RESOURCE_THORIUM`
there? did the driver register the `reactor` prototype?) and stops with a message
naming the failed check and the expected package if anything is missing.

### Adding another mod

1. Add the package to `package.json`, pinned to an exact commit, and rebuild the
   image (`npm run ui:down && npm run ui`, or `docker compose build`).
2. Add a catalog entry in `src/mods.js`: id, display name, description, module
   name, load order, what works and what does not, any world-object defaults
   standing in for cronjobs, and the post-load probes.
3. If it introduces objects worth seeing, give them artwork in
   `ui/src/canvas/modObjects.ts` and a palette entry in the map editor.
   Without artwork they still render — as a labelled marker — rather than
   vanishing.

The UI reads the catalog from `GET /api/mods`, so there is no second list to
keep in step.

## Screeps server profiles

The room importer takes the same treatment. **The shards are set up for you** on
first boot — `shard0` through `shard3`, `shardx` and `season` — prefilled except
for the credentials, which are the only part nobody can guess:

    DOJO_SCREEPS_PROFILE_SHARD0_HOSTNAME=screeps.com
    DOJO_SCREEPS_PROFILE_SHARD0_SHARD=shard0
    DOJO_SCREEPS_PROFILE_SHARD0_TOKEN=...        # you add this
    DOJO_SCREEPS_PROFILE_SEASON_PATH=/season/
    DOJO_SCREEPS_PROFILE_SEASON_SHARD=shardSeason
    DOJO_DEFAULT_SCREEPS_PROFILE=shard0

Seeding happens **once** and is recorded in `.env`, so deleting or renaming one
of them sticks. `shardx` is the spare — edit it for a private server, or a shard
that has no row of its own.

Each profile **stands alone**: it inherits nothing from another profile, so what
a row shows is what it will connect with. A key you leave out falls back to the
built-in default (`screeps.com`, `443`, `https`, `/`, `shard0`), never to
another profile's value.

Authentication is either/or: set a **token**, or set **username + password** for
a private server whose token is accepted over REST but rejected by the WebSocket
(e.g. screepsmod-auth). The address fields — hostname, port, protocol, path —
describe where the server is and apply to either.

Renaming a profile is done by the server, not the browser, so a token comes with
it — the browser is only ever sent a mask.

`npm run import-room -- <scenario> <ROOM>` reads that scenario's
`settings.json`, so the CLI and the GUI always import from the same server the
scenario is about. The unsuffixed `DOJO_SCREEPS_*` keys still work; the server
rewrites them into a profile on boot (named `a_server`) and keeps a `.env.bak`.

**Never commit `.env`.** It holds an API token, and a token in a commit is
compromised even after you delete it. `.gitignore` covers `.env` and every copy
of it — `.env copy`, `.env.local`, the `.env.bak*` backups — with `.env.example`
allow-listed back in.

## Writing a scenario

`scenarios/` is **your** workspace — it ships empty and is git-ignored, so your
scenarios never get committed to this shared harness. The fastest start is the
**+ New scenario** button in the GUI. To work from the worked example instead:

    cp -r examples/walk-to-flag scenarios/walk-to-flag   # PowerShell: Copy-Item -Recurse examples\walk-to-flag scenarios\walk-to-flag
    npm test -- walk-to-flag

See `examples/README.md` for a guided tour. A scenario is a directory
`scenarios/<name>/scenario.js` exporting:

- `modules` — code uploaded into the game VM: read scenario-local files, use
  `loadBotModules(['CombatMovement', ...])` from
  `require('screeps-dojo/botModules')` to pull your real modules, or
  `allBotModules()` to run your ENTIRE codebase with its real `main.js`. Load
  dojo's own code as `screeps-dojo/<file>` (any file in `src/`), never
  `../../src/<file>`, so a scenario still works after you move it into a
  sub-folder. Which codebase that is comes from the scenario's
  [bot profile](#bot-profiles); `botDir('enemy')` gives you another one.
- `setup(world)` — build the world: `world.loadScenarioMaps([map], botOptions)`,
  `world.addCreep(...)`, `world.addEnemyBot(...)`, `world.addFlag(...)`. To
  replay imported state, pass saved Memory/segments in the third (options)
  argument: `world.loadScenarioMaps([map], botOptions, { memory:
  require('./memory.json'), segments: require('./segments.json') })`.

  The maps themselves come from the scenario's own directory, so there is no
  need to hand-roll `fs`/`path` reading: `world.loadMap('W1N1')` parses this
  scenario's `map.W1N1.json`, and `world.loadAllMaps(botOptions, options)`
  loads EVERY `map.*.json` in the directory in one call — same arguments as
  `loadScenarioMaps`, minus the maps. Use `loadScenarioMaps` with
  `world.loadMap(...)` when you want only some of the rooms.

  Anything else goes in with `world.addObject(room, type, x, y, attributes)`,
  which fills in the engine-required fields for the type, resolves `owner`
  (`'me'`, `'invader'`, `'sourceKeeper'`, or a user id) to `user`, turns the
  relative clocks you think in (`ticksToDecay` on roads/containers/ramparts,
  `ticksToRegeneration` on sources/minerals) into the absolute deadlines the
  engine reads — seeding the engine's own default when you pass neither — wakes
  the room so the engine actually processes it, and returns the new object's id.
  `addCreep`/`addSpawn` are shortcuts for the types that need more than a
  defaults table — same code path, so `addObject(room, 'creep', x, y, {...})`
  builds an identical creep.

  To change or delete what is already there, `world.updateObject(query,
  changes)` and `world.removeObject(query)` take a selector (`{ room, type }`,
  `{ _id }`, `{ name }`) and return how many objects they touched. `changes` is
  plain fields (wrapped in `$set` for you) or an operator document (`{ $inc:
  ... }`); the same `owner` and relative-clock conveniences apply, except that
  an update never *defaults* a clock — bumping a rampart's hits won't reset its
  decay. Both wake the room, because a change the engine never processes is one
  the bot never sees.

  Reaching past all this to the raw `world.world.addRoomObject` prints a one-off
  warning naming your line; if you really want a hand-written doc,
  `world.world.addRoomObjectUnchecked(...)` says so out loud and stays quiet.
- `maxTicks` — required safety cap.
- `until(state)` — optional early end condition, evaluated on a DB snapshot
  after every tick (`state.creeps`, `state.hostileCreeps`, `state.flags`,
  `state.objects`, `state.gameTime`).
- `expect(result, assert)` — pass/fail. `result` has `endReason`
  (`until` | `maxTicks` | `botDied` | `aborted` — total bot death wins over
  `until`), `ticks`, `damageTaken`, `survived`, `console`, `finalState`.

Maps are JSON (see `examples/walk-to-flag/map.json`): `terrain` is 50 strings of
50 chars (`.` plain, `~` swamp, `#` wall), plus `structures`, `sources`,
`controller`, `minerals`, `flags`, `creeps`. A map creep is loaded through
`world.addCreep` and takes the same fields: `name`, `x`, `y`, `body` and
optionally `owner`, `store`, `hits`/`hitsMax`, `boosts` (part type → compound,
e.g. `{ tough: 'XGHO2', move: 'XZHO2' }`) and `ticksToLive` (or an absolute
`ageTime`; the default is the engine lifetime for the body — 600 ticks for a
CLAIM body, 1500 otherwise). Multi-room maps validate shared edges
(`autoMirror` option available); the loader auto-seals any exit that leads to a
room the scenario didn't load, so single-room scenarios don't trip pathfinding.
Enemies can be scripted bots (deterministic, recommended for regressions) or
real engine-driven invaders (user `'2'` objects — the engine AI works here).

## Releasing

    npm run release -- 0.14.0

Never bump the version by hand or with a find/replace: `package-lock.json`
carries a `"version"` for every dependency, and one of them will eventually
match the project's. The script bumps with `npm version`, then refuses the
result if the diff touched any line other than the project's own two `version`
fields. Full process in [docs/RELEASING.md](docs/RELEASING.md).

## Recording and rendering replays

The GUI records and replays for you. From the CLI, add the `record` keyword to
any test run to capture per-tick snapshots:

    npm test -- walk-to-flag record

(Bare keyword, not `--record`: PowerShell strips the `--` separator and npm
then swallows `--flags`. Bare words survive every shell.) The recording path is
printed with the scenario result — including for FAILED scenarios, which are
exactly the runs worth replaying.

Recordings land **inside the scenario that produced them**, at
`scenarios/<scenario>/recordings/<timestamp>/recording.json` (positions, hits,
stores, say text, attack/heal events — re-renderable without re-running). They
live there so they follow the scenario when you rename it or move it into a
folder. The GUI hides that directory from the Edit tab's file list. A scenario
can also set `record: true` in scenario.js.

Every recording also saves an `end state/` folder beside `recording.json`,
with `map.<ROOM>.json` for every simulated room, plus the main bot's
`memory.json` and `segments.json` (including inactive segments). Maps use
the same supported fields and format as live room imports. Stopped or failed
runs save the latest captured tick; SIGTERM/SIGINT do too. A hard kill
(SIGKILL) cannot write an end state.

Recordings made before v0.13 lived in a top-level `recordings/<scenario>/`; the
GUI server moves those into their scenario the first time it starts. Any whose
scenario no longer exists is left in `recordings/` untouched.

Render a recording to video (the GUI's GIF/MP4 buttons do this too):

    npm run render -- scenarios/walk-to-flag/recordings/<timestamp>          # MP4
    npm run render -- scenarios/walk-to-flag/recordings/<timestamp> gif      # GIF

Export speed uses the same multiplier as replay playback: at `1x` one recorded
tick takes one second, at `2x` it takes half a second, and high speeds skip ticks
when necessary instead of being limited by the output frame rate. The GIF/MP4
buttons use the replay's current speed selection. The GUI reports frame progress
while it renders and provides a cancel action that stops the encoder and removes
that job's partial output. MP4 defaults to 30 fps; GIF defaults to 10 fps to keep
long exports practical. Options (bare keywords, PowerShell-safe): `fps 30`,
`speed 2`,
`pixels 600` (per room), `rooms W0N0,W1N0` (which rooms; multi-room runs stitch
rooms in their true relative positions), `out <file>`. Output lands next to the
recording. Replay and video export share the same Canvas2D drawing modules;
server exports stream raw RGBA frames directly from `@napi-rs/canvas` into
FFmpeg without creating intermediate frame images. Encoded output streams to a
single atomic partial file beside the recording and is renamed only after a
successful render. GIF palette generation samples at most 64 frames into one
small container-local temporary image; cancellation removes both it and the
partial output.

## Importing a room from a live server

Pull a room (or several) straight from a Screeps server into a scenario — no
console pasting. Vision is not required: the snapshot comes off the same
spectator feed the official client uses, so an enemy base you have never scouted
imports in full. The GUI's **Import room**
button does this interactively; from the CLI:

1. Authenticate one of two ways in `.env`:
   - **Token** — get one from your account's **Auth Tokens** page and set
     `DOJO_SCREEPS_TOKEN=...`.
   - **Username/password** — set `DOJO_SCREEPS_USERNAME` (or `DOJO_SCREEPS_EMAIL`)
     and `DOJO_SCREEPS_PASSWORD`. Use this for a private server whose API token is
     accepted over REST but rejected by the WebSocket (e.g. `screepsmod-auth`);
     signing in yields a native session token the importer's socket accepts.
2. For a private/Season server also set `DOJO_SCREEPS_HOSTNAME`,
   `DOJO_SCREEPS_PATH`, `DOJO_SCREEPS_PORT`, `DOJO_SCREEPS_PROTOCOL`, and
   `DOJO_SCREEPS_SHARD` (defaults target `screeps.com` / `shard0`).
3. Run:

       npm run import-room -- <scenarioName> W1N1 W2N1
       npm run import-room -- <scenarioName> W7N4:W6N2   # inclusive rectangle
       npm run import-room -- <scenarioName> W1N1 --memory --segments
       npm run import-room -- <scenarioName> W1N1 --no-creeps --no-structures
       npm run import-room -- <scenarioName> W1N1 --overwrite

This writes `scenarios/<scenarioName>/map.<ROOM>.json` per room. Memory and
segments are opt-in in the GUI, or via `--memory` and `--segments` in the CLI;
when selected they write `memory.json` and `segments.json`. It captures terrain,
your structures and creeps by default; either can be unchecked in the GUI or
disabled with the CLI flags above. Spawning creeps are never exported. Neutral
structures, sources, mineral, and controller remain part of the room. Other
players' structures and creeps come across too, under a label of their own (see
below). Unknown custom objects (e.g. Season `score`) are dropped — skipped types
are reported.

Token calls are rate-limited unless you activate the 2-hour unlimited window: the
tool (and the GUI popup) prints the activation URL if the window is inactive.
Open it in a logged-in browser, then re-run. (For just one or two rooms the
normal limit is fine.)

Owners are stored as the loader's tags (`me` / `invader` / `sourceKeeper`) so the
map loads on any dojo server. Memory and segments are seeded into the bot when
the scenario's `setup` passes them to `loadScenarioMaps`.

### Other players in an imported room

Every other player in the rooms you import is kept, under a **label** made from
their in-game username (`Almaravarion` → `almaravarion`). The import names them
as it goes, and finishes by telling you what to do with them:

    wrote scenarios/season-block/map.W29N1.json — 41 structures, 12 creeps
      players: almaravarion (SPAWN, 34 structures, 9 creeps), tigga (0 structures, 3 creeps)
    players in this import: almaravarion, tigga
    to give one a bot codebase, add it to scenarios/season-block/settings.json:
      { "bots": { "almaravarion": "default" } }

Make that one edit — through the scenario's ⚙ or by hand — and the next run
turns that player into a real user: their imported spawn, structures, creeps and
controller RCL are theirs, and the profile you named runs as their code, every
tick, against yours. Nothing goes in `scenario.js`.

A label nobody assigns is left inert: its objects still load, still block
movement and can still be shot, but no code drives them. The loader lists those
labels at load time so you know what is assignable.

Labels are derived from usernames, which can change on the live server, so each
map also carries a `users` block mapping the label back to that player's real
user id and username at import time.

## Updating dojo

One command, from the project directory:

    npm run update

It pulls, rebuilds the web UI, rebuilds the container image, and restarts the
GUI if it was running — each step skipped or cached when nothing needs it, so
running it while already current costs a few seconds and changes nothing. It
refuses to pull onto a dirty tree; your `scenarios/` workspace is git-ignored,
so a clean tree is the normal case.

Dojo tells you when there is something to take: it checks once an hour whether a
newer version is published (the `version` in the repo's `package.json` on
`main`). The GUI shows a banner on the scenario list with the command and a copy
button, plus a dot beside the version in the header; the CLI prints a notice at
the end of a run, after whatever you came for.

Doing it by hand is three steps, because the pieces update differently — the
repo is bind-mounted, so `git pull` alone covers `src/`, `scripts/` and `test/`,
while `ui/dist` is git-ignored (and only auto-built when *missing*) and
`node_modules` is baked into the image:

    git pull
    npm run build:ui
    npm run build

Read what changed in [CHANGELOG.md](CHANGELOG.md) or on the
[releases page](https://github.com/TimPickup/screeps-dojo/releases).

Set `DOJO_NO_UPDATE_CHECK=1` to switch the check off, or
`DOJO_UPDATE_REPO=owner/name` to point a fork at its own upstream. It is
fail-soft: offline, proxied or rate-limited all mean "say nothing".

## Updating dependencies

Everything is pinned: `screeps` (feat-node24 beta), `@screeps/*` overrides,
`screeps-server-mockup` (git commit SHA), base image digest. To upgrade:

1. Bump ONE pin in `package.json` (or the Dockerfile digest).
2. Update the expected versions/hashes in `server-mock-patches/manifest.json`
   and regenerate any patch whose pristine source changed.
3. `npm run install:dojo`, `npm run verify:mock-engine-patches`, then
   `npm run smoke` — the canary.
4. If green, run both stock and fast smoke modes, then `npm test`.

## License

This project is **MIT** — see [LICENSE](LICENSE).

Third-party components it builds on:

- **Screeps** engine + server tooling (`screeps`, `@screeps/*`,
  `screeps-server-mockup`, `screeps-api`) — ISC / MIT.
- **UI** — React, `@monaco-editor/react`, dockview — MIT.
- **Server Canvas2D rendering** — `@napi-rs/canvas` — MIT.
- The map editor's RoomVisual rendering is adapted from the community
  [screepers/RoomVisual](https://github.com/screepers/RoomVisual) library.
- **MP4 export uses [ffmpeg](https://ffmpeg.org/)** via `ffmpeg-static`
  (**GPL-3.0**). It is downloaded at install time and invoked as a separate
  binary — not modified or bundled into this project.
