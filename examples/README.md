# Example scenarios

Templates to copy when authoring your own scenarios. The real `scenarios/`
directory is your private, git-ignored workspace — nothing committed here ends
up tracked in your repo.

## Try it

In the GUI, **+ New** and pick one of these under "Copy an example" — it copies
the example into a scenario of your own (in whichever folder you choose) and
opens it. From a shell:

    cp -r examples/walk-to-flag scenarios/walk-to-flag   # PowerShell: Copy-Item -Recurse examples\walk-to-flag scenarios\walk-to-flag
    npm test -- walk-to-flag

You should see the scenario pass: a single creep walks to the `goal` flag and
survives. Edit the copy under `scenarios/` freely — the original here stays as
a reference (it is also exercised by the test suite, so it always works).

## `walk-to-flag` — the minimal scenario

The smallest complete scenario: one room, one creep, one goal flag. It shows
every required piece of the `scenario.js` contract.

- **`map.json`** — the room: `terrain` (50 rows × 50 chars: `.` plain, `~`
  swamp, `#` wall), plus `structures`, `sources`, `controller`, `minerals`,
  `flags`. Paint these by hand or with the GUI's visual Edit tab.
- **`main.js`** — the bot code uploaded into the game VM. Here it is a tiny
  inline bot; in a real scenario you pull your own modules with
  `loadBotModules([...])` / `allBotModules()` from `src/botModules`. Which
  codebase those come from is the scenario's **bot profile** — add an optional
  `settings.json` (or use the ⚙ beside the Edit tab) to point one scenario at a
  different one:

      { "bot": "speedrun", "bots": { "enemy": "default" }, "server": "season" }
- **`scenario.js`** — wires it together:
  - `modules` — code to run in the VM.
  - `setup(world)` — `loadAllMaps(spawnOpts)` loads every `map.*.json` beside
    it (leave `spawnOpts` off and a map's own `owner: 'me'` spawn is adopted as
    the bot's home); then `addCreep`, `addEnemyBot`, `addFlag`, etc.
  - `maxTicks` — required safety cap.
  - `until(state)` — optional early-stop predicate, checked after each tick.
  - `expect(result, assert)` — pass/fail assertions on the finished run.

## `season5-reactor` — a scenario running under a game mod

The same contract, plus one line of `settings.json`:

    { "mods": ["season5"] }

That loads the official Season 5 mod into the engine, which is where Thorium,
`FIND_REACTORS` and `Creep.claimReactor()` come from — run this scenario without
the mod and `main.js` throws on its first line.

    cp -r examples/season5-reactor scenarios/season5-reactor
    npm test -- season5-reactor record

A CLAIM creep takes the reactor; a hauler carries Thorium into it from the
container beside it; the reactor burns the Thorium and pays **score to its
owner**, which is a user field, so `until()` reads `state.users[id].score`
rather than anything in the room.

The reactor and the Thorium are placed by the scenario, in `map.json`. Season 5
normally generates them with a backend cronjob, which the dojo does not run —
placing them yourself is what makes the run reproducible. Selecting the mod
fills in the fields those cronjobs would have set (a reactor's store, a Thorium
mineral's amount), so a bare `{ "type": "reactor", "x": 20, "y": 25 }` works.

Record it and the replay shows the reactor spin up as the first Thorium lands.
See **Game mods** in the main `README.md` for the full list of what Season 5
brings and what it deliberately does not.

## `season5-thorium-mine` — mining Thorium

The narrow one. An extractor on the deposit, one creep with WORK parts, no
reactor and no scoring, so a failure here can only be about mining.

    npm test -- season5-thorium-mine

Thorium is an ordinary mineral to the engine — extractor, WORK parts, `harvest`
— with one difference that the assertions pin down: it is **finite**. What comes
out of the deposit is gone from it, and it carries no regeneration deadline,
because Season 5 deletes a mined-out Thorium node instead of refilling it.

Note the map's controller is RCL 6. Below that the engine zeroes an extractor
and nothing can be mined at all.

## `season5-thorium-chain` — the whole pipeline

Mine it, carry it across the room, feed the reactor, score.

    npm test -- season5-thorium-chain record

Three creeps, three jobs: a **miner** on the deposit in one corner, a **hauler**
ferrying to the reactor in the other, and a **claimer** that takes the reactor —
which is the part that matters, because Season 5 pays score to a reactor's
*owner*, so an unclaimed reactor full of Thorium scores nothing.

The container by the deposit starts with a load in it so the hauler has work
from tick 1 and the replay shows all three jobs at once. Watch the console: the
run logs every score change, and you can see the rate step from `+1` to `+2` as
`continuousWork` passes 9 — that is Season 5's
`1 + floor(log10(1 + continuousWork))`.

See the main `README.md` ("Writing a scenario") for the full field reference,
multi-room maps, recording, and importing rooms from a live server.
