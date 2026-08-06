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

- **Browse scenarios** on the left and drill into one.
- **+ New scenario** — scaffolds a working two-room starter (spawn, sources, a
  controller to grow to RCL 2, and a bundled example bot) and drops you into its
  editor. Run it immediately.
- **Run** live with a streamed preview + console (showing attacks, harvesting,
  upgrading, etc.), and **Abort** mid-run. Leave the tab and come back — it
  reconnects to the run in progress.
- **Test** headlessly for a pass/fail verdict; or **Test All** from the landing.
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

The older `DOJO_BOT_PATH` still works and means the profile named `default`.

### Applying a mount change without leaving the browser

The GUI runs inside the container, so it cannot recreate its own container or
rebuild its own image — those are host commands. `npm run ui` therefore starts a
small **host agent** behind it, and the GUI asks that.

So Settings has an **Apply mount changes** button and the update banner has an
**Update now** button, and neither needs you to open a terminal. A rebuild's
output streams into the button's own log view, so an update is not a spinner and
a promise.

    npm run ui                  # start the GUI, with the agent behind it
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
- It does strictly less than the `npm run ui` you already ran: that command
  builds images and recreates containers itself.

### Per-scenario overrides

Any scenario may carry an optional `settings.json`:

```json
{
  "bot": "speedrun",
  "bots": { "enemy": "default" },
  "server": "season"
}
```

- `bot` — the codebase this scenario's own bot runs (`allBotModules()` picks it
  up with no code change). It is shorthand for `bots.main`.
- `bots` — any other side, so you can pit two versions of your bot against each
  other: `world.addEnemyBot({ modules: allBotModules(null, botDir('enemy')) })`.
- `server` — which Screeps server profile **Import a room** talks to.

Values are profile *names*, never paths. Edit the file through the scenario's ⚙
(a form, or raw JSON — the same way `map*.json` opens in the map editor), or by
hand. A scenario with no `settings.json` inherits everything, which is the
normal case.

An unknown or unmounted profile fails the run immediately, naming the profiles
that are registered — never halfway through with a confusing missing-module
error.

## Screeps server profiles

The room importer takes the same treatment. Each profile overlays the one named
`default`, so it only states what differs:

    DOJO_SCREEPS_PROFILE_DEFAULT_TOKEN=...
    DOJO_SCREEPS_PROFILE_DEFAULT_SHARD=shard0
    DOJO_SCREEPS_PROFILE_SEASON_SHARD=season
    DOJO_DEFAULT_SCREEPS_PROFILE=default

`npm run import-room -- <scenario> <ROOM>` reads that scenario's
`settings.json`, so the CLI and the GUI always import from the same server the
scenario is about. The unsuffixed `DOJO_SCREEPS_*` keys still work and mean the
`default` profile.

## Writing a scenario

`scenarios/` is **your** workspace — it ships empty and is git-ignored, so your
scenarios never get committed to this shared harness. The fastest start is the
**+ New scenario** button in the GUI. To work from the worked example instead:

    cp -r examples/walk-to-flag scenarios/walk-to-flag   # PowerShell: Copy-Item -Recurse examples\walk-to-flag scenarios\walk-to-flag
    npm test -- walk-to-flag

See `examples/README.md` for a guided tour. A scenario is a directory
`scenarios/<name>/scenario.js` exporting:

- `modules` — code uploaded into the game VM: read scenario-local files, use
  `loadBotModules(['CombatMovement', ...])` from `src/botModules` to pull your
  real modules, or `allBotModules()` to run your ENTIRE codebase with its real
  `main.js`. Which codebase that is comes from the scenario's
  [bot profile](#bot-profiles); `botDir('enemy')` gives you another one.
- `setup(world)` — build the world: `world.loadScenarioMaps([map], botOptions)`,
  `world.addCreep(...)`, `world.addEnemyBot(...)`, `world.addFlag(...)`. To
  replay imported state, pass saved Memory/segments in the third (options)
  argument: `world.loadScenarioMaps([map], botOptions, { memory:
  require('./memory.json'), segments: require('./segments.json') })`.

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

## Recording and rendering replays

The GUI records and replays for you. From the CLI, add the `record` keyword to
any test run to capture per-tick snapshots:

    npm test -- walk-to-flag record

(Bare keyword, not `--record`: PowerShell strips the `--` separator and npm
then swallows `--flags`. Bare words survive every shell.) The recording path is
printed with the scenario result — including for FAILED scenarios, which are
exactly the runs worth replaying.

Recordings land in `recordings/<scenario>/<timestamp>/recording.json` (positions,
hits, stores, say text, attack/heal events — re-renderable without re-running).
A scenario can also set `record: true` in scenario.js.

Render a recording to video (the GUI's GIF/MP4 buttons do this too):

    npm run render -- recordings/walk-to-flag/<timestamp>          # MP4
    npm run render -- recordings/walk-to-flag/<timestamp> gif      # GIF

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
console pasting, works for any room you have vision of. The GUI's **Import room**
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

This writes `scenarios/<scenarioName>/map.<ROOM>.json` per room, plus
`memory.json` and `segments.json` if your account has them. It captures terrain,
your structures, neutral structures, sources, mineral, controller, and **your**
creeps. Other players' objects and unknown custom objects (e.g. Season `score`)
are dropped — skipped types are reported.

Token calls are rate-limited unless you activate the 2-hour unlimited window: the
tool (and the GUI popup) prints the activation URL if the window is inactive.
Open it in a logged-in browser, then re-run. (For just one or two rooms the
normal limit is fine.)

Owners are stored as the loader's tags (`me` / `invader` / `sourceKeeper`) so the
map loads on any dojo server. Memory and segments are seeded into the bot when
the scenario's `setup` passes them to `loadScenarioMaps`.

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
