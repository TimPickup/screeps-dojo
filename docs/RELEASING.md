# Releasing

One thing drives the update notice users see: the `version` field in
`package.json` on `main`. `src/updateCheck.js` fetches that file from
raw.githubusercontent.com and compares it to the running copy. Tags and GitHub
Releases are never read by the code — they exist for people.

That has a consequence worth planning around. **The notice starts firing as soon
as the bump lands on `main`, and it links to `/releases`.** Both the CLI notice
and `npm run update` send users there. Publish the release promptly, or whoever
updates in the gap arrives at a page with no notes for the version they just
took.

## Steps

1. **Check `main` is green.**

       gh run list --branch main --limit 1

   This is the real precondition. The bump does not ship the release commit —
   it makes whatever is already sitting on `main` live to every user. Cutting a
   release off a red `main` tells people to take it.

2. **Write the `CHANGELOG.md` entry.** This is the user-facing artefact — it is
   what the release notes quote. Open with a sentence or two on what the release
   is *for*, then `Added` / `Changed` / `Fixed`. Prefer the concrete: what it
   used to do, what it does now, and the number if there is one.

3. **Bump the version.**

       npm version <x.y.z> --no-git-tag-version

   This updates `package.json` **and both version fields in
   `package-lock.json`**. Editing `package.json` by hand leaves the lock stale —
   the diff should always show `package-lock.json | 4 ++--`.

4. **Commit** as `chore(release): vX.Y.Z`, with a prose body saying what the
   release is about. The commit touches three files and nothing else:
   `CHANGELOG.md`, `package.json`, `package-lock.json`.

5. **Push it straight to `main` — not through a pull request.** A review buys
   nothing here: the commit contains no code, and step 1 already established
   that the code being released is green. A PR would also cost two cold CI runs
   rather than none, because `package-lock.json` is in the cache key and the
   bump changes its hash. Keep the history linear, as 0.3.0 and 0.4.0 are — no
   merge commit for a release.

   (The next run on `main` is cold for the same reason. That is expected: the
   install genuinely differs. It goes warm again after.)

6. **Tag and push.** Tags are annotated:

       git tag -a vX.Y.Z -m "Screeps Dojo vX.Y.Z"
       git push origin vX.Y.Z

7. **Publish the GitHub release**, with the changelog section as the notes.
   Do this straight after step 5 — see the top of this file for why.

       gh release create vX.Y.Z --title vX.Y.Z --notes-file <section>

## Not part of a release

- **`ui/package.json`** keeps its own version and is left alone. It is a private
  sub-package that is never published.
- **No `npm publish`.** The root package is `"private": true`. Users take an
  update with `npm run update`, which is a `git pull` plus a rebuild of the UI
  bundle and the container image.

## After

Users see the notice within an hour — `updateCheck.js` caches its answer for
that long, per process for the GUI and in `.tmp/update-check.json` for CLI runs.
`DOJO_NO_UPDATE_CHECK=1` opts out entirely.
