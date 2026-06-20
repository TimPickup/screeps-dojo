# Example scenarios

Templates to copy when authoring your own scenarios. The real `scenarios/`
directory is your private, git-ignored workspace — nothing committed here ends
up tracked in your repo.

## Try it

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
  `flags`. Paint these by hand or with `editor/dojo-editor.html`.
- **`main.js`** — the bot code uploaded into the game VM. Here it is a tiny
  inline bot; in a real scenario you pull your own modules with
  `loadBotModules([...])` / `allBotModules()` from `src/botModules`.
- **`scenario.js`** — wires it together:
  - `modules` — code to run in the VM.
  - `setup(world)` — `loadScenarioMaps([map], spawnOpts)`, then `addCreep`,
    `addEnemyBot`, `addFlag`, etc.
  - `maxTicks` — required safety cap.
  - `until(state)` — optional early-stop predicate, checked after each tick.
  - `expect(result, assert)` — pass/fail assertions on the finished run.

See the main `README.md` ("Writing a scenario") for the full field reference,
multi-room maps, recording, and importing rooms from a live server.
