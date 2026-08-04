# Changelog

All notable changes to Screeps Dojo. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[semantic versioning](https://semver.org/) (pre-1.0: minor = features and
behaviour changes, patch = fixes).

## [0.5.0] — 2026-08-04

Speed, and a safety net. The two lists you look at most now open in
milliseconds rather than seconds, and every push runs the test suites, so a
regression surfaces before you pull it.

### Added

- **Continuous integration** — GitHub Actions runs the unit, import and
  integration suites plus the UI typecheck, tests and build on every push to
  `main` and every pull request. A warm run finishes in about 15 seconds; a cold
  one, where the native engine toolchain has to compile, takes under six
  minutes. The scenarios suite is deliberately excluded — it runs real bot
  scenarios and is far too slow for per-push feedback, so keep running it
  locally with `npm run test:scenarios`.
- **`npm run test:internal -- local`** — runs mocha directly instead of through
  `docker compose`, for environments with no Docker daemon. Both paths share one
  set of suite definitions, so they always run the same tests.
- **`?scenario=` on `/api/recordings`** — fetch one scenario's replays instead
  of every recording on disk.
- **A UI typecheck** — `npm run typecheck` in `ui/`, which the UI build now runs
  first. Every path that emits a bundle is gated on it, so type errors can no
  longer sit unnoticed: `build:ui` is `vite build`, and esbuild strips types
  without checking them.
- **`.mocharc.json`** with `exit: true`, so `npx mocha <file>` terminates. The
  mock engine leaves handles open, and until now only `scripts/test.js` passed
  `--exit`, which made running a single test file directly impractical.

### Changed

- **The Replays tab opens in ~17ms instead of 7.7s.** It fetched every recording
  on disk and discarded all but one scenario's worth in the browser; it now asks
  the server for the one it wants. Each run directory costs a single directory
  read rather than a stat plus three existence checks, ordering comes from the
  timestamp in the directory name instead of a stat per entry, and finalised
  recordings are memoised — they are immutable once written. In-progress runs
  are never cached.
- **The Scenarios list loads in ~95ms instead of 3.7s.** Listing files called
  `statSync` on all 756 files across 24 scenarios just to ask whether each was a
  file. One directory read per scenario answers that, plus whether it is a
  directory, whether `scenario.js` exists and whether it ships a map — about 830
  syscalls become 26, and the payload is byte-identical. On a Docker bind mount,
  where each syscall costs 1.5–3ms, that was the whole delay.
- Replay timestamps render as `2026-08-04 15:19:52` rather than
  `20260804-151952`.
- Both lists waited to be told there was nothing to show, then said so while
  still loading. That is a claim about the disk, so they now wait for the server
  to answer. The stale list is hidden while reloading rather than pushed down.
- A filesystem error is no longer reported as an empty list: `ENOENT` still
  means "none", anything else surfaces as a 500 carrying the message.
- The recordings scenario filter validates structurally — a single path segment
  resolving directly inside the root — rather than by character allowlist, so it
  accepts every name the scenario list will show (`my scenario`, `v1.2`,
  `_scratch`) while still rejecting traversal, absolute paths and null bytes.
  The stricter pattern still governs names the GUI creates.

### Fixed

- **Runs killed before they finalised showed `in-progress` and `0t` forever.**
  Status is now derived from disk: a journal silent for longer than five minutes
  reads as interrupted (the per-tick watchdog is 60s), and the tick count is
  omitted rather than repeating a `0` that was never true. This reclassified 11
  stuck recordings.
- **A burst of refresh clicks queued a request each.** `disabled` only applies on
  the next render, so 24 clicks in one tick got 12 requests through; a
  synchronous latch makes it 1.
- **Three type errors in the canvas replay renderer.** `Frame.visuals` was always
  real — `captureState` returns it and the SVG renderer reads it — but was never
  declared, so the canvas renderer could not typecheck against it. Type-level
  only: the emitted bundle is byte-identical.
- **The mock engine patches silently failed to apply when `node_modules` sits
  inside a git work tree.** `git apply` reads a git-style patch header as
  repository-relative when it finds a repository above it, skips the paths for
  falling outside the current directory, and still exits 0 — which read as
  success. Existing Docker installs were never affected: the compose volume is a
  separate mount and the image build has no `.git`, so this only ever bit an
  install made outside the container, such as CI.

## [0.4.0] — 2026-08-04

Staying current. 0.3.0 could tell you an update existed; this release tells you
what to do about it, and does it for you.

### Added

- **`npm run update`** — one command to take a new version: pull, rebuild the
  web UI, rebuild the container image, and restart the GUI if it was running.
  Every step is skipped or cached when nothing needs it, so running it while
  already current costs a few seconds and changes nothing. It refuses to pull
  onto a dirty tree, because a half-merged update is worse than no update.
- **Update notice in the CLI** — every host launcher (`test`, `render`, `ui`,
  `clean`) prints a notice *after* the command finishes, so a pending update is
  the last thing on screen rather than something that scrolled past at the start.
  Headless users previously had no way to know at all.
- **The GUI banner now says how to update** — the command, with a copy button,
  next to a link to the release notes. It is red rather than the theme's green:
  it is the one banner that wants to read as "act on me".

### Changed

- The version check moved to `src/updateCheck.js`, shared by the GUI server and
  the CLI, so the banner and the terminal notice cannot disagree about what
  "newer" means. Short-lived CLI processes cache the answer to
  `.tmp/update-check.json` on the same one-hour TTL the server keeps in memory,
  so repeat runs cost nothing. Fail-soft throughout — offline, proxied,
  rate-limited or mangled all mean "say nothing" — and it never delays or fails
  the command it follows. `DOJO_NO_UPDATE_CHECK=1` switches it off;
  `DOJO_UPDATE_REPO=owner/name` points a fork at its own upstream.
- README gains an **Updating dojo** section: the one-liner, and the by-hand
  steps for when you want them.

### Fixed

- A `git pull` that touched `ui/src` left you running the **old GUI**: `ui/dist`
  is git-ignored and was only rebuilt when missing entirely. `npm run update`
  always refreshes it.

## [0.3.0] — 2026-08-04

The theme of this release is **fidelity**: objects a scenario places now look
like the ones the engine builds itself, and rooms are simulated the way a real
server simulates them. Plus a rebuilt replay renderer and inspector.

### World building

- **`world.addObject(room, type, x, y, attrs)`** — one path for placing anything.
  Fills in the engine-required fields for the type, resolves `owner` (`'me'`,
  `'invader'`, `'sourceKeeper'`, or a user id) to `user`, keeps a supplied `id`
  as the doc's `_id`, wakes the room, and returns the new object's id. Creeps
  dispatch to `addCreep`, so both spellings build an identical doc; flags are
  refused with a pointer to `addFlag`. Map loading goes through it too, so a
  painted map and a hand-built world agree.
- **`world.updateObject(query, changes)`** and **`world.removeObject(query)`** —
  the other half. Take a selector (`{ room, type }`, `{ _id }`, `{ name }`) and
  either plain fields (wrapped in `$set`) or an operator document, apply the same
  input conveniences, wake the rooms they touch, and report how many objects
  changed. Scenarios no longer need the database for ordinary world building.
- **Creep boosts** — `boosts: { tough: 'XGHO2', move: 'XZHO2' }` maps a part type
  to its compound, or a body entry can carry its own `{ type, boost }`. Carry
  boosts are reflected in `storeCapacity` using the engine's own multipliers, so
  a boosted hauler reports the capacity it actually has.
- **Creep lifetimes** — placed creeps are born with an `ageTime`: the engine's
  own lifetime for the body (600 ticks for a CLAIM body, 1500 otherwise), or
  `ticksToLive` / an absolute `ageTime` when you want a partially-aged creep.
  Previously `creep.ticksToLive` read `undefined` until the engine backfilled it.
- **Decay and regeneration clocks** — `ticksToDecay` and `ticksToRegeneration`
  become the absolute deadlines the engine reads, defaulting to its own
  lifetimes. This fixes a quiet distortion: decay fires on
  `!nextDecayTime || gameTime >= nextDecayTime - 1`, so a road, container or
  rampart loaded without a clock took a decay hit on the first tick its room was
  processed — an imported base lost a slice of its walls at tick 1.
- **`world.keepRoomActive(room)`** — pins a room permanently active. Placing a
  `keeperLair` or `invaderCore` does it automatically, so NPC rooms run every
  tick instead of stuttering on the force-update cadence. Nothing in the engine's
  own in-use predicate keeps them awake: a lair carries no user, and keepers are
  user `'3'`, which the predicate excludes by name.
- **Map spawn adoption** — a map containing a spawn owned by `me` is used as the
  bot's home automatically; no need to restate coordinates the map already
  carries.
- **Structure defaults** for `link`, `terminal`, `lab`, `factory`, `powerSpawn`
  and `nuker`, so an imported structure with an empty store no longer crashes any
  bot creep that inspects it.
- Game constants (lifetimes, capacities, decay times, boost multipliers) are read
  from the running server rather than copied into the harness, and a missing one
  raises instead of silently falling back to a stale number.

### Room simulation

- **Every loaded room is simulated**, not just rooms the bot submits intents in.
  The engine only processes rooms in its per-tick `ACTIVE_ROOMS` set; a real
  server refills that set from the processor's in-use predicate, from player
  intents, and from backend crons. The mockup has no crons, so dormant rooms
  froze forever — creeps never aged, sources never regenerated, controllers never
  downgraded. `activateSimRooms` plays the missing cron role on a deterministic
  100-tick cadence, and rooms are woken when something is placed into them.
  (Thanks [@misterwise](https://github.com/misterwise) — #3.)
- Rooms are created inactive, matching vanilla room documents, so a room that has
  nothing in use can actually go dormant.

### Guardrails

- **Warnings when a scenario reaches past the facade** — a raw `addRoomObject`,
  or a hand-written insert/update/remove on `rooms.objects`, warns once per call
  site, naming both the replacement and your line. Warnings reach the scenario
  console — so they show up in the GUI, the live stream and the recording, not
  just the container's stdout — and are highlighted in amber in every console
  view. The engine writes to those same collections itself, so checks stand down
  while a tick runs. `addRoomObjectUnchecked` is the explicit escape hatch.
- A unit test keeps the committed, copy-pasted surface (`examples/`,
  `templates/`, `test/`) free of raw server access, with a `raw-access-ok` marker
  for the deliberate cases.

### Replays and the GUI

- **Pure-canvas 3-layer replay renderer** — replaces the SVG renderer.
- **Rebuilt object inspector** — per-type stats, store and hits bars, owner tags,
  resource icons, and a picker for selecting between several objects on one tile.
- Live spawn energy fill, transfer/withdraw indicators, tower effects and
  construction sites in rendered frames.
- Per-tick CPU readout in the replay toolbar.

### Importing

- Username/password authentication for the room importer, for servers using
  `screepsmod-auth` (documented in the README).
- Controller ownership is preserved on import, so an owned base no longer arrives
  unclaimed at RCL 0 with every structure inactive.

### Performance

- **Configurable fast mock engine** — a set of runtime-selectable optimizations
  (V8 RPC encoding, code cache, room guard, in-process execution, active-room
  reset), on by default, each independently switchable, with stock multiprocess
  mode as a supported fallback. See the README.

### Fixed

- Spawn adoption no longer deletes a map spawn that is itself named `Spawn1`.
  (Thanks [@misterwise](https://github.com/misterwise) — #4.)
- Map editing of sources, minerals and controllers.
- "Upgrade blocked" is displayed correctly.
- First run works with no `.env` and no separate install step; the first build
  streams its compile output so it no longer looks hung.
- Storage and engine-runner child processes get the environment they need.

### Testing

- Test launcher with selectable suites (`unit`, `import`, `integration`,
  `scenarios`, `internal`, `all`) plus its own unit tests.
- Mock-engine process isolation is declared by the server-booting suites.
  (Thanks [@misterwise](https://github.com/misterwise) — #5.)
- Scenario runs no longer hit a wall-clock mocha timeout; a per-tick watchdog
  catches a genuinely stalled server instead.

## [0.2.0]

Initial tracked release.

[0.5.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.5.0
[0.4.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.4.0
[0.3.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.3.0
