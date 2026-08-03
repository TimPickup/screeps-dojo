# Screeps Dojo

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
`.env` (PowerShell: `Copy-Item .env.example .env`) and set `DOJO_BOT_PATH` to
your bot's script folder (flat `.js` modules, mounted read-only at `/bot`).

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
- **⚙ Settings** — toggle user visuals and edit/verify your `.env` (bot path,
  Screeps token); a popup walks you through token activation when needed.

The server runs in the background (detached), so stop it with `npm run ui:stop`
(or `npm run ui:down` to remove the containers); `npm run ui` brings it back up.
Set `DOJO_UI_PORT` in `.env` to change the port (default 8787). The server is
published only to your host loopback (127.0.0.1), never the network.

## CLI

The GUI just drives the same engine — everything is available headless, which is
what you want for CI:

    npm run build          # build the container image (first time)
    npm run install:dojo   # install the server toolchain in the container
    npm run smoke          # boots the server, runs a bot 5 ticks -> "SMOKE OK"
    npm test               # run every scenario in scenarios/
    npm test -- walk-to-flag   # run just one (filter matches scenario names)

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
  `main.js`.
- `setup(world)` — build the world: `world.loadScenarioMaps([map], botOptions)`,
  `world.addCreep(...)`, `world.addEnemyBot(...)`, `world.addFlag(...)`. To
  replay imported state, pass saved Memory/segments in the third (options)
  argument: `world.loadScenarioMaps([map], botOptions, { memory:
  require('./memory.json'), segments: require('./segments.json') })`.
- `maxTicks` — required safety cap.
- `until(state)` — optional early end condition, evaluated on a DB snapshot
  after every tick (`state.creeps`, `state.hostileCreeps`, `state.flags`,
  `state.objects`, `state.gameTime`).
- `expect(result, assert)` — pass/fail. `result` has `endReason`
  (`until` | `maxTicks` | `botDied` | `aborted` — total bot death wins over
  `until`), `ticks`, `damageTaken`, `survived`, `console`, `finalState`.

Maps are JSON (see `examples/walk-to-flag/map.json`): `terrain` is 50 strings of
50 chars (`.` plain, `~` swamp, `#` wall), plus `structures`, `sources`,
`controller`, `minerals`, `flags`. Multi-room maps validate shared edges
(`autoMirror` option available); the loader auto-seals any exit that leads to a
room the scenario didn't load, so single-room scenarios don't trip pathfinding.
Enemies can be scripted bots (deterministic, recommended for regressions) or
real engine-driven invaders (user `'2'` objects — the engine AI works here).

## Engines

Scenarios run on the vanilla engine (screeps-server-mockup) by default. The
runner reaches the world only through the driver contract documented at the top
of `src/dojoWorld.js` — lifecycle, world setup, bot control, observation — and
picks the implementation by name via `DOJO_ENGINE` in `.env` (default `mockup`,
currently the only engine). The seam exists so alternative engine backends can
plug in behind the same contract without scenarios changing.

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

Each game tick plays as 0.8 s of animation followed by a 0.2 s hold, so tick
boundaries stay readable. Options (bare keywords, PowerShell-safe): `fps 30`,
`pixels 600` (per room), `rooms W0N0,W1N0` (which rooms; multi-room runs stitch
rooms in their true relative positions), `out <file>`. Output lands next to the
recording.

## Standalone editor and viewer

The same visual map editor and replay viewer embedded in the GUI also work as a
single self-contained file: open `editor/dojo-editor.html` directly in a browser
— no install, no build step.

- **Map Editor** — paint terrain and place/select structures, sources, minerals,
  controllers, ramparts, roads and flags on a 50×50 grid using the renderer's own
  graphics. Edit object properties (owner, store, controller level), connect
  roads/walls, and round-trip JSON (`scenarios/*/map.json` format) via the
  Import/Download/Load JSON controls.
- **Replay Viewer** — load a `recording.json` via the file input (or drag-drop);
  a tick slider scrubs instantly and Play/Pause runs it with HP bars, say
  bubbles, and attack/heal effects.

If `dojo-editor.html` is missing or you changed `editor/template.html`, run
`npm run build:editor` to regenerate it (requires the container image).

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
- **SVG rasterization** — `@resvg/resvg-js` — MPL-2.0.
- The map editor's RoomVisual rendering is adapted from the community
  [screepers/RoomVisual](https://github.com/screepers/RoomVisual) library.
- **MP4 export uses [ffmpeg](https://ffmpeg.org/)** via `ffmpeg-static`
  (**GPL-3.0**). It is downloaded at install time and invoked as a separate
  binary — not modified or bundled into this project.
