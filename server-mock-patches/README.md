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

## Dependency upgrades

Extract or install the new pristine dependency versions, rebase each applicable
diff, calculate new pristine and patched hashes, and update `manifest.json`.
Installation deliberately fails until every unexpected version/hash has been
reviewed. After an upgrade, run patch verification, stock smoke, all-features
smoke, the feature override matrix, and the full scenario suite.
