# Changelog

All notable changes to Screeps Dojo. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[semantic versioning](https://semver.org/) (pre-1.0: minor = features and
behaviour changes, patch = fixes).

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

[0.4.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.4.0
[0.3.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.3.0
