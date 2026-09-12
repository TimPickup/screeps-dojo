# Changelog

All notable changes to Screeps Dojo. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[semantic versioning](https://semver.org/) (pre-1.0: minor = features and
behaviour changes, patch = fixes).

## [Unreleased]

### Fixed

- The host agent's buttons (Restart, Apply new mounts, Update) failed on Windows
  whenever Node was installed under a path containing a space — the whole thing
  died at `'C:\Users\…\AppData\Local\Author' is not recognized as an internal or
  external command`. With `shell: true`, Windows hands cmd.exe one joined string
  rather than an argv, so the path split at its space. Tokens are now quoted
  before that join (`src/winShell.js`), in the agent and in `npm run ui` /
  `npm run update` alike.

## [0.13.0] — 2026-09-12

The scenario list becomes a workspace you can organise. Scenarios live in
folders now — nested as deep as you like, collapsed until you open them, moved
by dragging or from a dialog — and every one of them can be renamed or deleted
from the list itself, with a warning that names exactly what a non-empty folder
is about to take with it.

For that to be safe, a scenario's replays had to stop living somewhere else. A
recording now sits inside the scenario that produced it, so it follows a rename
or a move instead of being orphaned by one; the server migrates the old
top-level `recordings/` on first start, and Settings reports what it could not
move, with its size and a one-shot clear.

The list also keeps itself up to date — the server pushes the tree over SSE and
only touches the disk while the list is on screen — so the refresh button is
gone, and so is Test All.

Alongside it: New scenario asks where it goes and what to start from (the
two-room Basic, a heavily commented Blank, any of the bundled examples, or a
duplicate of one of your own); the examples themselves were brought onto the
current map-loading API; and the tree answers to a right-click and to the
keyboard as well as to the mouse.

### Added

- The scenario list is a **tree with folders**. Create folders from the
  sidebar, nest them as deep as you like, and drag a scenario or folder onto
  another folder to move it (or onto the sidebar to bring it back to the top
  level). Folders start collapsed and remember what you opened. Folders show a
  yellow folder mark, scenarios a green play mark.
- **Rename and delete** for every scenario and folder, from icons on the row.
  Both confirm first, and deleting a folder that still holds scenarios or other
  folders says exactly what it holds before it will go ahead.
- **New scenario** now asks where and what from. A folder picker (defaulting
  to the folder you last worked in, so opening a folder and pressing + New puts
  it there) and a **Start from** picker: **Basic** (the two-room starter),
  **Blank** (scenario.js alone, commented through — add a room before it runs),
  a copy of any scenario in `examples/`, or **Duplicate one of mine…**, which
  reveals a second picker of your own scenarios grouped by folder (files only —
  the duplicate starts with no replay history). The list comes from the server,
  so a new example directory appears in the picker with no UI change.
- **+ Folder** takes a folder too, so a folder can be made inside another one
  without dragging it there afterwards.
- **Breadcrumbs** in the header when a scenario is open: the folders holding
  it, then its name. Each folder crumb goes back to the list with that folder
  opened and scrolled to.
- **Right-click** any row (or the empty space below the tree) for Open, New
  scenario here, New folder here, Rename or move, Delete.
- **Keyboard navigation** in the tree: ↑/↓ move, →/← open and close a folder or
  step in and out, Home/End jump, Enter opens, **F2** renames, **Delete**
  deletes. One row is in the tab order, so Tab still steps past the list.
- **Rename and move are one dialog** — a name and a folder picker. Nothing has
  to be dragged.
- A row whose name is **not unique** in the tree shows its folder beside it, so
  two scenarios called `rampart` in different folders are told apart.
- **Settings reports orphaned recordings** — runs left in the old
  `recordings/` whose scenario no longer exists — with their size and the
  biggest offenders, and offers a one-shot clear. The section is absent when
  there is nothing there.
- The list **refreshes itself**. The server pushes the tree over SSE and only
  polls the disk while the list is actually on screen, so the refresh button is
  gone.

### Changed

- **Recordings now live inside their scenario**, at
  `scenarios/<scenario>/recordings/<timestamp>/`, instead of a top-level
  `recordings/<name>/` keyed by name. Replays therefore survive a rename or a
  move. The GUI server migrates existing recordings on first start; any whose
  scenario no longer exists stays in `recordings/` untouched. The Edit tab does
  not show the directory.
- A scenario is now identified by its **path** under `scenarios/`
  (`Benches/defence-bench`), not just its name, throughout the API and the GUI.
  `npm run test:scenarios -- <name>` still matches on the leaf name.
- Scenario and folder names created from the GUI may contain spaces.
- `npm test -- <name>` accepts a scenario **path** in any spelling people
  actually type: `Benches/defence-bench`, the Windows `Benches\defence-bench`,
  or a tab-completed `scenarios\Benches\rampart\`. Other regex
  characters are still passed through to `--grep` untouched.
- The bundled examples use the current map-loading API: `world.loadAllMaps()`
  instead of reading `map.json` by hand, and `walk-to-flag` gained the header
  comment the GUI's template picker shows as its description.

### Fixed

- The recording tests clean up after themselves. Each aborted-run test used to
  leave a `dojo-abort-*` directory of frames behind; now that a recording lives
  inside its scenario, an uncleaned one is not an empty directory but a whole
  run's worth of data.

### Removed

- **Test All** on the landing screen.

## [0.12.0] — 2026-09-12

Imported rooms stop being a copy of your own base and start being a copy of
the room. Every other player in an import comes across under a label made
from their username, and a scenario's `settings.json` can hand any of those
labels a bot codebase — so a room copied off a live server can be run with
its real occupants behind real code, without a line of `scenario.js`.

Alongside it: power banks are supported end to end, from the map editor
through the inspector to an import that keeps a live bank's haul and the
remainder of its 5,000-tick clock; scenarios read their own maps with
`world.loadMap()` / `world.loadAllMaps()` instead of hand-rolled `fs`/`path`;
and the Windows clone fix of 0.11.0 is finished — it held the patch files
byte for byte but missed the one copied file beside them, so a default git
for Windows clone still could not build. The installer now repairs a CRLF
checkout itself, which is the half that reaches clones already taken.

### Added

- **Imported rooms keep every player, and a scenario can put a bot behind one.**
  An import used to drop other players' structures and creeps on the floor; they
  now come across under a label made from the player's username, which the
  import prints as it goes. Assign that label a bot profile in the scenario's
  `settings.json` — `{ "bots": { "almaravarion": "default" } }` — and the loader
  turns them into a real user at load time: their imported base, creeps and RCL,
  driven by that codebase, with nothing added to `scenario.js`. A label nobody
  assigns loads exactly as before, inert, so scenarios that bind their own
  imported owners are unaffected.
- Each imported map carries a `users` block (label → the player's live user id
  and username), so a rename on the server does not orphan what `settings.json`
  assigned.
- **A scenario reads its own maps.** `world.loadMap('W1N1')` parses this
  scenario's `map.W1N1.json`, and `world.loadAllMaps(botOptions)` loads every
  `map.*.json` in the directory in one call — ordered by file name so a run is
  reproducible, and rejecting two maps for the same room rather than building a
  subtly broken world out of an editor's `map.E27S23 (1).json`. Scenarios no
  longer repeat the `fs`/`path` boilerplate the template used to carry; use
  `world.loadMap(...)` when you want only some of the rooms.
- **Power banks.** The map editor places them, the inspector reads them, and an
  import brings a live one across. A bank's power IS its store — the engine's
  `.power` getter is literally `store.power` — so one placed without a store
  crashed any bot creep that looked at it, and one without hits died to the
  first point of damage rather than taking the 2,000,000 that are the point of
  a bank. A map-defined bank now defaults to a full vanilla one (5,000 power),
  and a map's own `store` still wins, so an imported season bank keeps its real
  haul.

### Fixed

- **A Windows clone builds again, however it was taken.** 0.11.0 held patch
  files byte for byte against `core.autocrlf=true` but missed
  `server-mock-patches/lib/dojo-features.js`, which the manifest also pins by
  hash — so a default git for Windows clone rewrote it to CRLF and the image
  build stopped on `Copy source hash mismatch:
  /dojo/server-mock-patches/lib/dojo-features.js`. Two changes, because the
  first alone would have left everyone who already cloned stuck:
  - `.gitattributes` now holds the whole `server-mock-patches/` directory
    byte-exact rather than just `*.patch`, so a file added there later is
    covered without anyone remembering, and a test asserts it for every source
    the manifest lists.
  - The installer repairs a CRLF checkout itself instead of refusing it. LF is
    what the manifest hashed and what the container needs, so it strips the CR
    back out of patch files and copy sources and carries on — the pinned hash,
    still checked afterwards, is what proves the repair right. Content that
    differs for any other reason is refused exactly as before. It says what it
    repaired rather than doing it in silence, since the clone is still worth
    replacing. Attributes only apply at checkout, and `git pull` does not
    re-check-out a file that did not otherwise change, so without this an
    existing clone stays broken.
- **A power bank was dropped on import.** It was not in the importer's known
  structure list, so it fell through to the unknown-type branch and the one
  room it stood in imported without it.
- **An imported power bank never decayed.** `decayTime` is an absolute tick on
  the SOURCE server (~264k on season, tens of millions on shard0); copied
  verbatim into a sim that starts near 0 it sits forever in the future, and a
  bank's 5,000-tick clock is its whole mechanic. The importer now emits the
  dojo's relative `ticksToDecay` and lets the loader turn it back into a
  deadline, floored at one tick so a bank already past its deadline upstream
  still arrives as something the bot can see rather than an object the loader
  deletes on sight. `constructedWall` is deliberately excluded: its `decayTime`
  marks a temporary newbie wall, not a decay clock, and rebasing it would make
  every wall in an imported base expire.
- Invader creeps are no longer dropped on import. The filter that removed other
  players' creeps took the NPC ones with it, so an imported room arrived without
  the invaders that were standing in it.

## [0.11.0] — 2026-09-09

Scenarios can run under real Screeps season rules. Add `"mods": ["season5"]` to
a scenario and the official Season 5 mod loads into the engine, so Thorium,
reactors and reactor scoring come from the mod itself rather than from a
reimplementation here that would drift out of date.

Shipping that turned up a run of infrastructure faults it had been sitting on
top of: a container left holding a previous version's packages after any update
that changed a dependency, a fresh clone that could not build on Windows at all,
and every API response being parsed by hand in JavaScript.

### Added

- **Game mods: a scenario can run under real Screeps season rules.** Add
  `"mods": ["season5"]` to a scenario's `settings.json` — or tick **Game mods**
  in its ⚙ — and the run loads the official
  [Season 5 mod](https://github.com/screeps/mod-season5) (pinned by commit) into
  the engine. Thorium, reactors, `Creep.claimReactor()`, reactor scoring, the
  Thorium decay penalty, the same-player terminal restriction and the Season 5
  stronghold reward tables all come from the mod itself, so the engine's own
  implementation stays the source of truth. Verified in both engine modes (fast
  in-process and stock multiprocess).

  The mod list is **curated**, not arbitrary: a scenario names an id from the
  catalog in `src/mods.js`, which is the only thing that turns an id into a
  module path. An unknown id fails the run before the engine boots. See
  **Game mods** in the README for what Season 5 does and does not bring — the
  parts of it that live in a backend service or a cron scheduler do nothing
  here, so scenarios place their own reactors and Thorium (and get sane
  defaults for them). Three worked examples: `season5-reactor` (the minimum),
  `season5-thorium-mine` (extractor mining, on its own) and
  `season5-thorium-chain` (mine, haul, feed the reactor, score).

- **Score changes are logged.** When a user's score moves, the run writes a
  console line — `score: dojo 12 (+2)` — which puts it in the live view, in
  `result.console` and in the recording. Vanilla scores never move, so vanilla
  runs are unaffected.

- **Reactors and Thorium render**, using the mod's own MIT-licensed artwork
  (vendored in `ui/src/assets/season5`): a green core, an edge that turns only
  while the reactor is owned and burning, the owner's colour ringed around it,
  and the Thorium icon on its mineral. Live view, replay, GIF and MP4 all share
  the same drawing code, and rotation is derived from game time, so an export at
  8x looks like the replay at 1x. Any *other* object a mod introduces now gets a
  labelled marker instead of being invisible. The map editor and the scenario
  preview draw them too: they render through `drawStaticScene`, which shares
  every drawing routine with the replay but not `drawFrame`'s per-tick pass — so
  a reactor showed as an empty tile there, and a Thorium mineral fell back to
  lettering while the replay used the icon. Both now go through the same code
  with the same artwork.

- **User scores are observable.** `state.users[userId] = { username, score }` in
  `readState()` and per frame in recordings, because Season 5 pays score to a
  reactor's owner rather than to a room — `until()` and `expect()` had no way to
  see it before. Older recordings simply lack the field.

### Changed

- **Every scenario now runs in its own process, from the CLI too.** The GUI
  already forked one process per run; `npm test` ran them sequentially in one
  mocha process. A mod cannot be unloaded — it mutates engine constants, event
  listeners and prototype registrations — so a process that has run a Season 5
  scenario can never run a vanilla one again. Both paths now go through
  `src/scenarioChild.js`. A failed `expect()` still fails the test, and still
  keeps its recording.

- **Recordings record which mods they were made under** (`meta.mods`), and the
  replay list shows them: a Season 5 recording holds objects and scores that
  make no sense read as vanilla.

- **The mock-engine patch set honours an external `MODFILE`.** The mockup pinned
  every engine role to the empty `mods.json` it copies into `server/` on connect;
  it now uses the run's own mod file and hands the same one to main, storage,
  runner and processor. A patch-hash mismatch (a `node_modules` left over from an
  older revision of the patch set) now says how to recover instead of printing a
  bare hash.

### Fixed

- **A long install looked like a hung one.** The setup screen streams npm's
  output, and npm prints nothing at all for minutes while it compiles the
  native modules — leaving one of its own deprecation warnings as the last
  line on screen, which reads as the thing it died on. The in-container
  installer now streams the compiles (`--foreground-scripts`, as the Dockerfile
  does), drops the deprecation noise (`--loglevel=error`, none of it
  actionable), and prints `…still working (3 min so far)` whenever the output
  goes quiet — the same heartbeat the host agent already used for a rebuild,
  now shared rather than copied.

  The screen's working indicator was also the weaker of the two in the app —
  three static bullets fading as one block, placed *below* a 280px log, so on a
  short viewport it sat off the bottom of the screen. The host overlay's
  travelling-wave dots are now a shared component, used by both, and on the
  setup screen they sit above the log where they can be seen.

- **An update that added a dependency left the container behind.**
  `/dojo/node_modules` is an anonymous volume, and Compose reuses an existing
  one when it recreates a container — only `--renew-anon-volumes` discards it.
  So a release that changed a dependency rebuilt the image correctly and then
  started a container still holding the previous packages, indefinitely. The
  symptom is a long way from the cause: the GUI reads its source over the bind
  mount, so the new code is visibly there while the module it needs is not —
  Season 5 appeared in the settings form and then failed to load in the engine.
  `npm run ui` and `npm run update` now renew the volume when, and only when,
  they rebuilt the image.

  That alone would only help from the *next* release, since the update carrying
  the fix is still performed by the old launcher. So the server now also checks
  that every dependency `package.json` declares actually resolves, and treats a
  populated-but-stale `node_modules` the same way it treats a missing one: the
  setup screen appears, reinstalls, and the GUI carries on by itself. That screen
  says which of the two it is doing — being told "first run" with a project
  already on disk reads as though it had been lost.

  A repair reinstalls with `npm ci` rather than `npm install`. The volume can
  also be stale in a way that leaves nothing missing at all: every package
  present, but the **engine patches** belonging to another revision, which is
  what a checkout across releases leaves behind. `npm install` cannot fix that —
  it has no reason to replace a package that is already there, so the old
  patched files survive and `postinstall` refuses them as an unexpected hash.
  Deleting `node_modules` and reinstalling from the lockfile is the only route
  back to files the current patch set can apply to.

- **Every API response was parsed by hand, in JavaScript.** Reading a
  recording past V8's maximum string length needed a streaming parser, and
  that parser was made the default for all 19 GET endpoints — including
  `/api/health`. It walks the document character by character where
  `res.json()` is the engine's own C++ parser: on a 169 MB recording, 8.2s
  against 1.9s, all of it on the main thread. The parser is now chosen by the
  response's declared size — native below 256 MB, streaming above it or when
  no size is declared, so an outsized recording still loads. `/api/recordings/file`
  sends `Content-Length` rather than piping chunked, without which every
  recording, however small, took the slow path.

- **Importing a room keeps its seasonal objects.** The room importer dropped
  every type it did not recognise, so a live Season 5 room arrived without its
  reactor (`skipped 1 reactor`); it now also keeps the types the scenario's
  selected mods add. It also records a mineral's **current `mineralAmount`**
  rather than re-seeding a full node — a half-mined mineral used to import as
  untouched, and for a finite resource like Thorium there is no "full" to rewind
  to. A reactor's live-server `launchTime` is dropped on the way in: it is an
  absolute tick on the source server, and here it would make the mod's score
  formula NaN.

- **A mod loaded twice, silently doubling every per-tick effect.** Applying a
  mod is not repeatable — it pushes engine listeners and custom object
  prototypes and cannot be undone — and the fast in-process engine ran
  `configManager.load()` twice in one process (the driver's own call, plus the
  dojo's in-process storage adapter mirroring what the real storage process
  does). Season 5 paid its reactor score **twice a tick** and applied the
  Thorium decay penalty twice, with nothing reporting a problem. `load()` is now
  idempotent per mod file, and the test suite asserts both the listener count
  and the exact score rate rather than merely that the score went up. The stock
  multiprocess engine was never affected.

- **Thorium carries no regeneration deadline.** Vanilla minerals come back once
  they are empty and the dojo seeds that clock; Season 5 deletes a depleted
  Thorium mineral instead, so a countdown on one was wrong and visible to both
  the bot and the inspector. A mod can now declare a resource finite.

- **A fresh clone on Windows could not build.** The repo carried no
  `.gitattributes`, and git for Windows installs `core.autocrlf=true` by
  default — so checking out `server-mock-patches/*.patch` rewrote every one of
  them with CRLF endings. `git apply` then has a trailing CR on each context
  line, matches nothing in the LF sources npm just wrote, and `npm ci` dies in
  `postinstall` with `patch failed: dist/src/screepsServer.js:47 … patch does
  not apply`. It reads like a stale patch set against a moved dependency, which
  is the wrong thing to go looking at. Patch files are now marked `-text` and
  are checked out byte for byte on every platform.

## [0.10.0] — 2026-09-02

Two things this release is for: importing a real room and getting back what is
actually there, and opening a long recording without the browser stalling.

### Added

- **The room importer takes options.** A room argument can now be a range —
  `W7N4:W6N2` expands to the inclusive rectangle between the two corners, up to
  100 rooms — so seeding a block no longer means listing every room by hand.
  Structures and creeps can each be turned off (`--no-structures`,
  `--no-creeps`), and `memory.json` and `segments.json` are now opt-in
  (`--memory`, `--segments`) rather than written whenever the account has them.
  `--overwrite` replaces an existing import instead of refusing. Every one of
  these is a checkbox in the GUI's Edit tab as well as a CLI flag.

### Fixed

- **Large recordings open again.** The UI read every API response with
  `res.json()`, which materialises the whole body as one JavaScript string; a
  recording past V8's maximum string length threw before it could be parsed, so
  the replay simply would not load. Responses are now parsed as they stream in
  and the full document is never held as a string. Thanks to @Robalian (#17).

- **Long, chatty replays no longer grind the browser to a halt.** The replay
  viewer rebuilt the entire console — every line from tick 0 to the playhead —
  on every single tick, so a recording with tens of thousands of log lines
  allocated and discarded megabytes of strings per frame of playback and per
  pixel of a scrub drag. The console is now indexed once when the recording
  loads (two `Int32Array`s, ~8 bytes a line); moving the playhead forward or
  back is an O(1) lookup of how many lines exist at that tick, and nothing is
  rebuilt in either direction.

- **The console drawer mounts only the tail of a long log.** Previously one
  `<div>` per line, unbounded. It now shows the last 2,000 lines up to the
  current tick, with a header saying how many earlier lines are hidden, and
  mounts them in fixed 200-line blocks aligned to absolute line indices so a
  moving playhead re-renders only the two blocks at the edges. Applies to the
  live Run tab's console too.

- **Panning the replay canvas no longer freezes on the first press.** Starting a
  drag set `user-select: none` on `<body>`, which invalidates styles for the
  whole document — with a console drawer full of lines, recalculating them took
  long enough to eat the first second of the pan. The drag now calls
  `preventDefault()` instead and touches no document-wide styles.

- **The console follows new output only when you are already at the bottom.**
  Scrolling back through history during playback is no longer yanked away.

- **Imported terrain no longer turns walls into floor.** The live server encodes
  terrain as a bitmask, so a tile that is both wall and swamp arrives as `3` — a
  value the decoder did not know and quietly wrote out as plain. Rooms imported
  with such tiles had walkable floor where the real room has wall. `3` now
  decodes as wall (impassable either way), and an unrecognised mask raises an
  error naming the value and the coordinate rather than guessing.

- **A creep that was still spawning no longer arrives twice.** It was exported
  as an active creep while also being represented by its spawn, so the scenario
  started with a duplicate that had skipped the spawn process entirely.
  Spawning creeps are now left to their spawn.

- **Imports from username/password servers work.** Both the CLI and the GUI's
  server check ran a no-rate-limit token preflight, which is a live-server
  concept with no meaning for password auth — the profile came back looking
  inactive or broken. Password profiles are now verified by connecting and
  calling `me()`, and the check reports which auth mode it used.

## [0.9.0] — 2026-08-07

Updates used to take about seven minutes and look broken for five of them.
Almost all of that was spent reinstalling 682 identical packages because the
version number in `package.json` had changed — a string the container image
never reads. A version-only release now takes about fifteen seconds.

### Changed

- **The image is rebuilt only when something in it actually changed.** Both
  launchers compare a fingerprint of what the image is made of — the Dockerfile,
  the dependency graph, the lockfile's resolved packages, the install-time
  scripts, and the mock-engine patches — against what was fingerprinted when it
  was last built. Version numbers are deliberately excluded. Anything unreadable
  or unrecorded counts as "rebuild": a needless build costs minutes, a stale
  image costs a confusing afternoon. Force one with `npm run ui -- --build`.

  This replaces a modification-time check that could not tell a version bump
  from a dependency change.

- **npm's warnings no longer fill the update output.** None of them are
  actionable, and being the last thing on screen for five minutes made them look
  like the problem. Script output still streams.

- **The update screen says what it is doing.** It shows the current phase —
  "rebuilding the container image — the slow part" — with the raw build output
  behind a *Show details* toggle, and the host agent logs a heartbeat when
  nothing has printed for 25 seconds.

### Fixed

- **The progress line no longer reports the previous action.** The agent log is
  append-only and shared, so a restart could display the closing line of the
  update before it. It now reads only what the running action has logged.

## [0.8.1] — 2026-08-07

Updating from the browser, fixed. The button worked only intermittently, opened
a blank console window over whatever you were doing, said nothing about how long
it would take, and left the page still claiming an update was due once it had
finished.

### Fixed

- **Update and restart requests were dropped at random.** A request is stamped
  in the container and judged on the host, and those are not the same clock —
  Docker Desktop's VM measured ~700ms ahead here. The staleness check required a
  non-negative age, so a perfectly fresh request arrived dated in the future and
  was thrown away as stale. Whether it survived was a race between the skew and
  the write-to-read latency, which is why pressing the button again worked. A
  request stamped slightly ahead is now accepted; only a genuine age, or an
  absurd future date, is refused.
- **A blank console window no longer opens over the screen.** Every step ran
  through `cmd.exe` without `windowsHide`, so the detached agent popped up a
  console — blank, because its output is piped back to the GUI, which read as a
  hung program rather than as progress.
- **The page refreshes when an action finishes.** It used to just hide the
  overlay, leaving the browser running the code it had before: the header still
  showed the old version and the update notice was still on screen, having just
  updated. It reloads now, which is also what clears every other stale read —
  env values, profiles, mount status.
- **Settings comes back after applying a mount change**, instead of dropping you
  on the welcome screen with no idea whether it worked.

### Changed

- **The update notice was rebuilt.** It was a red panel with a green button
  inside it, that button left-aligned against centred neighbours, and it offered
  the terminal command *above* the one-click path. The alert is now just the
  alert; what you can do about it sits below it — heading, button, what it
  costs, then the manual command demoted under a rule as the alternative.
- **How long it takes is stated up front**, in the notice and again directly
  under the wait screen's title. An image rebuild is minutes of apparently
  nothing, and without a number slow is indistinguishable from broken.

## [0.8.0] — 2026-08-06

Construction sites show up in replays. They were listed as part of the cached
background but never actually drawn, so a site under construction rendered as
nothing at all.

### Added

- **Construction sites render**, as an ownership-coloured ring filled by a
  progress wedge, pulsing so a pending site reads differently from a finished
  structure. The pulse is driven by replay time rather than the wall clock, so a
  scrubbed frame and an exported video frame look identical, and a paused replay
  sits at the peak instead of flickering.

### Fixed

- Construction sites are no longer part of the static layer's epoch key. They
  were in the key but not in the draw list — the worst of both: nothing appeared
  on screen, and the whole cached background rebuilt every time a site appeared,
  moved or completed. They are drawn per frame now, which is what their
  per-tick progress requires anyway (#11).

## [0.7.0] — 2026-08-06

Register each of your bot codebases once and let every scenario pick between
them by name. Screeps servers get the same treatment, with the shards set up
for you, and a small host agent performs the few things the container cannot
do for itself — so applying a new bot path or taking an update is a button
rather than a command to go and type.

### Added

- **Bot profiles.** `DOJO_BOT_PROFILE_<NAME>_PATH` registers a codebase; every
  one is mounted read-only at `/bots/<name>`, so switching which one runs is a
  name lookup rather than a mount change. `DOJO_DEFAULT_BOT_PROFILE` picks the
  default, and changing it is free. Adding or repointing a *path* is a mount
  change — a bind mount is fixed when the container is created — so Settings
  offers a button that has the host agent apply it.
- **Per-scenario `settings.json`** — `{ "bot": "speedrun", "bots": { "enemy":
  "default" }, "server": "season" }`. It resolves before `scenario.js` is
  required, so `allBotModules()` picks the right codebase with no code change,
  and `botDir('enemy')` gives another side its own — you can now pit two
  versions of your bot against each other. It opens in its own form editor (or
  raw JSON) from the ⚙ beside the Edit tab.
- **The Screeps shards are set up for you**, once, at first boot: `shard0`
  through `shard3`, `shardx` (a template for a private or custom shard) and
  `season`, each prefilled apart from the credentials. Seeding is flagged in
  `.env`, so deleting or renaming one of them sticks — it is a decision, not
  something to undo on the next start.

  There is no profile called `default` any more; a name meaning "the fallback"
  said nothing about which server it was. An existing one is renamed to
  `a_server`, keeping its settings, its token and its place as the default.
- **Screeps server profiles.** `DOJO_SCREEPS_PROFILE_<NAME>_<KEY>`. Each one
  **stands alone** — nothing is inherited from another profile, so a row shows
  what it will actually connect with. (They briefly overlaid the profile named
  `default`, which meant a row could display a hostname nobody typed and, worse,
  quietly carry another server's token.) `npm run import-room` reads the
  scenario's own `settings.json`, so the CLI and the GUI always import from the
  server that scenario is about.
- **Renaming a profile happens on the server**, which is the only side that can
  see a token — the browser receives a mask, so a browser-side rename had to
  leave secrets behind and ask for them to be retyped. The default pointer moves
  with the profile, including when the implicit default is the one renamed.
- **Per-profile status in Settings**, replacing the blanket "changing the bot
  path needs a container restart" warning: each row says whether it is mounted,
  how many `.js` modules it holds, or that it is still waiting to be mounted.
- `npm run bots:sync` regenerates `docker-compose.override.yml` from `.env`.
  `npm run ui` and `npm test` do it for you.
- **A host agent**, started by `npm run ui` and stopped by `npm run ui:stop`,
  performing the handful of things the container cannot do for itself: recreate
  itself so a new bot mount takes effect, restart, or take an update. Settings
  and the update banner are buttons now, not commands to copy, and a rebuild's
  output streams into the button's own log view. It does strictly less than the
  launcher that starts it, which already builds images and recreates containers.

  Nothing is installed — no service, no scheduled task, no autostart; one agent
  at a time, and `--no-agent` skips it, after which the GUI shows commands to
  type exactly as before.

  The container asks through a file — `.dojo-host/request.json` — naming an
  action from a fixed list (`restart`, `recreate`, `update`) and nothing else;
  each maps to a constant command chosen host-side, so nothing from the request
  ever reaches a command line, and there is no "run this command" action. It
  grants no new privilege: anything that can write that file can already write
  `scripts/ui.js`. Requests are consumed before they run, handled once per id,
  dropped when stale, rate-limited, and logged to `.dojo-host/agent.log`. The
  channel files are written to a temp name and renamed into place, so a reader
  polling on a timer never catches one half-written, and a single exclusive lock
  file — not a check-then-act — is what makes two agents impossible. The
  rejected alternative was mounting the Docker socket into the container, which
  would give the process running your bot code control of the host daemon.
- **Old `.env` keys are migrated automatically** at server boot, with the
  original copied to `.env.bak`. `DOJO_BOT_PATH` becomes
  `DOJO_BOT_PROFILE_DEFAULT_PATH`, each `DOJO_SCREEPS_*` becomes
  `DOJO_SCREEPS_PROFILE_DEFAULT_*`. This replaces the "Convert to profiles"
  buttons, which could never finish the job: the browser only ever sees secrets
  masked, so a token had to be left behind and retyped by hand.
- **A full-screen wait while the host acts.** Restarting or updating takes the
  server away, so the whole app says so — title, bouncing dots, and the agent's
  live output underneath. Losing the connection is treated as the expected
  middle of a restart, not a failure; past a per-action deadline it says what
  went wrong and which command finishes the job by hand.
- Replay speeds run from 0.25x to 128x, from one list shared by the replay
  control and the Settings default (which persists in local storage).

### Changed

- **Profile resolution reads `.env`, not just `process.env`.** Docker Compose
  reads that file on the *host* to build the compose file; it does not pass the
  variables into the container. So a run resolved "unknown bot profile (none
  registered)" for a profile the Settings screen was listing quite happily.
  `src/envConfig.js` moved out of `src/server/` because the runner needs the
  same merged view the routes use.
- The `/bot` mount is gone; the default profile lives at `/bots/default`. A
  checkout with no `.env` still runs the bundled examples unchanged.
- Recordings and the run's `start` event now carry which codebase produced them.
- A scenario naming an unknown or unmounted profile fails immediately, listing
  the profiles that *are* registered, instead of failing later as a missing
  module.
- `PUT /api/env` reports `restartRequired` only when a bot profile's host path
  actually changed, and can now delete keys outright (blanking one would leave a
  nameless profile behind).
- **`npm run ui` no longer rebuilds the image every launch.** It compares the
  image against what the Dockerfile actually reads (Dockerfile, `package.json`,
  `package-lock.json`, the mock-engine patches) and builds only when one of
  those is newer. The layer cache was never the protection it looked like: the
  Dockerfile copies `package.json` before `npm ci`, so editing a *script* in it
  re-ran the whole native toolchain build — and the build then woke Docker
  Scout, whose scan hammers the disk long after the build finished. `--build`
  forces it, `--no-build` never does.
- Brighter foreground throughout: `--muted` lifted, and both ⚙ buttons sit at
  full text colour rather than reading as disabled.
- Section headings in both settings surfaces are larger and weighted; the
  scenario form now says **My bot**, **Other bots** and **Import server
  profile**, shows the `allBotModules()` snippet each setting affects, and links
  straight to the matching part of the main Settings panel.
- The scenario settings file is labelled **(Scenario Overrides)** in the editor
  header, and Ctrl/Cmd-S saves the Settings panel as it already did the editor.

### Fixed

- CI caches the backend `node_modules` against the resolved Node version, so a
  Node bump can no longer restore a cache holding isolated-vm's binding compiled
  for the previous ABI (#12).

### Deprecated

- `DOJO_BOT_PATH` and the unsuffixed `DOJO_SCREEPS_*` keys. Both still resolve,
  and boot rewrites them for you.

## [0.6.0] — 2026-08-06

One renderer. Replays, scenario previews and the MP4/GIF exports all draw
through the same canvas code now, so an export shows exactly what the browser
showed — and the room itself reads far better: walls that join up, swamps that
move, rampart overlays, and an icon for every deposit type.

### Added

- **A single canvas rendering pipeline** in `ui/src/canvas/`, drawing one frame
  from one set of modules. The video renderer imports the very same
  `drawFrame.ts` the browser uses and runs it against `@napi-rs/canvas`, so
  there is no second implementation to drift: a fix to the replay view is a fix
  to the export.
- **Cached static layers.** Terrain, walls, structure shells and ramparts are
  baked once into their own canvases and reused until an epoch key says the
  layout actually changed. Per-frame work is now only what genuinely moves —
  creeps, energy fills, tower turrets, effects.
- **Terrain that looks like terrain.** Wall tiles merge into softened islands
  rather than reading as a grid of squares, constructed walls join the terrain
  they touch, and swamps carry a texture that drifts on two layers.
- **Rampart overlays** — cached, translucent, tinted by owner, with a marker on
  public ramparts.
- **Deposits** — biomass, metal, mist and silicon each render from their own
  artwork: a filled body, an outline, and the finer detail strokes on top.
- **Power banks** — a corner-clipped square with a power core.
- **A map editor inside the UI.** The standalone `editor/dojo-editor.html`
  build is gone; editing happens in the same canvas the rest of the app draws
  on.
- **A render progress protocol** shared by the CLI and the server, so the two
  cannot quietly disagree about how an export reports its progress.

### Changed

- **Sources are rounded squares with a black border** the shrinking energy core
  never covers, so a full source still reads as a distinct object against dark
  terrain. Tombstones became a translucent outline with a dark X.
- **Creep body parts, structure shells and tower turrets** are drawn from
  shared modules rather than per-view code, and towers and spawn transitions
  animate between ticks.
- Room visuals, fonts and draw order moved behind the canvas modules, which the
  UI suite now covers at 106 tests across 23 files — each asserting the exact
  sequence of draw calls against a recording mock context.

### Fixed

- The recording tests clean up after themselves. Each aborted-run test used to
  leave a `dojo-abort-*` directory of frames behind; now that a recording lives
  inside its scenario, an uncleaned one is not an empty directory but a whole
  run's worth of data.

### Removed

- **The SVG renderer.** `src/render/frameRenderer.js`, `svgPrimitives.js`,
  `creepSprite.js`, the `SvgStage` component and the standalone editor build
  (`scripts/buildEditor.js`) are all deleted — about 8,800 lines out against
  6,500 in.

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

[0.13.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.13.0
[0.12.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.12.0
[0.11.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.11.0
[0.10.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.10.0
[0.9.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.9.0
[0.8.1]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.8.1
[0.8.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.8.0
[0.7.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.7.0
[0.6.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.6.0
[0.5.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.5.0
[0.4.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.4.0
[0.3.0]: https://github.com/TimPickup/screeps-dojo/releases/tag/v0.3.0
