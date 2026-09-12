# Optional mock-engine patches

These package-relative diffs are installed into the pinned Screeps mock-engine
dependencies by `tools/mockEnginePatches.cjs`. The patch code is always present,
but every behavior is runtime-gated. All optimizations default on; stock mode
remains available through the master switch.

## Public switches

- `DOJO_FAST_MOCK_ENGINE` enables every feature when unset or set to `1`, and
  selects stock behavior when set to `0`.
- `DOJO_FAST_MOCK_ENGINE_RPC_V8`
- `DOJO_FAST_MOCK_ENGINE_CODE_CACHE`
- `DOJO_FAST_MOCK_ENGINE_ROOM_GUARD`
- `DOJO_FAST_MOCK_ENGINE_IN_PROCESS`
- `DOJO_FAST_MOCK_ENGINE_RESET_ACTIVE_ROOMS`

An explicit individual `0` or `1` overrides the master. An unset or unrecognized
individual value inherits the master/default-on behavior.

## Installed changes

- Optional V8 structured-clone storage RPC frames.
- Race-safe per-user code caching with pubsub invalidation.
- A single-flight accessible-room cache and transient first-tick map guard.
- An RPC-compatible in-process storage adapter that clones all DB arguments and
  results rather than returning live LokiJS documents.
- Retryable multi-role driver initialization.
- Stable runner/processor exports and deterministic direct tick draining.
- Optional deletion of stale `ACTIVE_ROOMS` during `world.reset()`.
- An idempotent `configManager.load()`. Applying a mod is not repeatable — it
  pushes engine listeners and custom object prototypes and cannot be undone — so
  loading the same `mods.json` twice in one process silently doubles every
  per-tick effect. Stock, each process loads once; the dojo runs storage inside
  the driver's process, which puts both call sites in the same one.
- An externally supplied `modfile` server option, honoured by every engine role.
  Stock, the mockup copies an empty `mods.json` into the server directory on
  connect and pins main, storage, runner and processor to it, so a game mod
  could not be loaded at all. The dojo hands each run its own curated mod list
  (`src/mods.js`) and every role now reads that same file — a mod either applies
  everywhere or the run's post-connect probe fails it.

## Installation and verification

`manifest.json` pins exact package versions and pristine/patched SHA-256 values.
The installer locates package roots with `require.resolve`, rejects unknown
hashes before writing, checks all patches with exact Git context, backs up every
target, restores it on failure, applies in manifest order, and verifies all
post-install hashes.

When the driver runtime bundle changes, the installer regenerates
`runtime.snapshot.bin` and stamps it with the bundle hash. Check the current
installation with:

```bash
npm run verify:mock-engine-patches
```

The root `postinstall` applies the set idempotently. Docker copies this directory
and the installer before `npm ci`, so a fresh image cannot contain an unverified
partial patch set.

Every file here is applied or copied byte for byte, so `.gitattributes` marks the
whole directory `-text`: a checkout that rewrote line endings changes the hashes
and breaks the install, and `core.autocrlf=true` is the git for Windows default.
Attributes only apply at checkout, so for clones taken before that the installer
normalises CRLF back to LF in patch files and copy sources and reports what it
repaired. The pinned hashes are still verified afterwards, so a repair that was
not merely line endings still fails.

## Dependency upgrades

Extract or install the new pristine dependency versions, rebase each applicable
diff, calculate new pristine and patched hashes, and update `manifest.json`.
Installation deliberately fails until every unexpected version/hash has been
reviewed. After an upgrade, run patch verification, stock smoke, all-features
smoke, the feature override matrix, and the full scenario suite.
