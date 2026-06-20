# Security

## Reporting a vulnerability

If you find a security issue in the dojo's own code (the harness, importer, renderer,
or editor — anything under `src/`, `scripts/`, `lib/`, or `editor/`), please report it
privately rather than opening a public issue. Email the maintainer or use GitHub's
"Report a vulnerability" (Security advisories) on this repository.

Please don't report transitive `npm audit` findings from the bundled Screeps engine as
security issues — see below for why they're expected.

## About `npm audit` findings

`npm audit` reports a number of vulnerabilities in this project. Nearly all of them come
from the **bundled Screeps server engine**, not from the dojo's own code, and they are
left in place deliberately. Here's the reasoning, so you can make your own call.

### Where they come from

The dojo runs the *real* Screeps game engine headless, one tick at a time. To do that it
depends on the Screeps server packages — `screeps` and its `@screeps/*` dependencies
(`@screeps/engine`, `@screeps/driver`, `@screeps/common`, `@screeps/backend`,
`@screeps/storage`, `@screeps/launcher`) — wrapped by `screeps-server-mockup`. That
subtree pins old transitive packages, which is what the audit flags:

- **`lodash@3.10.1`** (the one `critical`) and a few `@screeps/*` packages depending on it.
- **`angular`, `jquery`, `jquery.terminal`, `webpack`** — these belong to the server's
  web dashboard, which a headless dojo never builds or serves.
- Various ReDoS / prototype-pollution findings in old build tooling (`braces`,
  `micromatch`, `qs`, `json5`, `cross-spawn`, and similar).

### Why they aren't "fixed"

- **The engine requires those exact versions.** The `@screeps/*` packages pin their
  dependencies tightly; forcing newer ones breaks the engine's build or runtime.
- **`lodash@3.10.1` is intentional and load-bearing.** Screeps exposes lodash 3.x to bot
  code as the global `_`. This is a *fidelity* test harness — its job is to behave like the
  live server. Swapping the engine's lodash for 4.x would change the simulation your bot
  runs against, so the tests would no longer reflect reality. Matching the server's
  (older) dependency versions is correct here, not a bug.
- **The vulnerable surfaces aren't reachable in normal use.** The dashboard libraries
  (`angular`/`jquery`) are never served. Everything runs inside a Docker container against
  local, trusted inputs (your own scenario files and bot code) — the dojo does not listen
  on a network or process untrusted input.

If you need a clean audit for your own policy reasons, the realistic options are to wait
for upstream Screeps releases that bump these dependencies, or to add `overrides` yourself
and re-run the full test suite (`npm test`) to confirm the engine still behaves — be aware
that bumping `lodash` in particular is very likely to break it.

### The one network-facing tool

The room importer (`npm run import-room`) is the only part that talks to a remote server.
It connects to the official Screeps server using **your own auth token** and only reads
data. A few notes on its security posture:

- It uses `screeps-api@2.x`, which depends on a patched `axios` (the old `0.28.x` line in
  `screeps-api@1.x` carried the SSRF / credential-leak advisories).
- Your token is read from `.env` (gitignored) and is **never printed to the console**. When
  the importer needs to surface the no-rate-limit activation link (which the Screeps page
  requires the token to be embedded in), it writes the full link to `.noratelimit.url`
  (gitignored) and prints only a masked token. Keep both files out of shared logs and
  screenshots, and rotate your token if it is ever exposed.
