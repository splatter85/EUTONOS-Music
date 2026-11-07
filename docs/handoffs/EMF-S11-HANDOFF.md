# EMF-S11 — library, saved recipes and recipe studies (first increment) handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S11 (CLOUD-eligible; built and checked on the owner's Windows PC)  
**Disposition:** **FIRST INCREMENT INTEGRATED into main; the slice stays IN PROGRESS.** Page wiring, wider genres and transition coverage remain.  
**Worker commit:** `5a00551bb810b08e8b708a97c3393a6f2136f408` on local branch `work/emf-s11-persistence-recipes-20261107`, based on main `9c0d142`  
**Integration:** merge commit **`1880867b6b54412bd6119286c98a513239598df2`** onto main `a28e1b3` (after S09). This is the tested source; later commits are documentation and records.  
**Recorded:** 2026-11-07

## Assignment and roles

A separate worker built the increment and handed it back with its own checks and an independent review, as a local, unpushed, unmerged commit. The owner pasted that handback here; the coordinator (Claude) reviewed the diff, merged it onto the current main (which had moved on with S09), re-ran every gate on the combined tree, wrote these documents and filed the records. The [S11 guide](../S11_LIBRARY.md) is the runnable description; the [campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status.

## Delivered changes (10 files, all new except `phrase-plan.ts`)

| File | Result |
| --- | --- |
| `src/library-codec.ts` | 2 MiB bound, coded `LibraryError`s, exact-key plain-data validation, canonical JSON and SHA-256. |
| `src/library.ts` | `em.music-library.v1` snapshot: catalogue (16), saved vibes (64), volume/mute, renderer-observation history (256 newest, dropped count). Revision-checked writes through compare-and-swap; corrupt/future data preserved; stopped restore. |
| `src/library-file.ts` | Node adapter: temp file + rename under an exclusive lock that is never guessed stale; `reconcile` error after a committed write with failed cleanup. |
| `src/library-indexeddb.ts` | Browser adapter: one store, compare-and-swap inside one transaction, no localStorage fallback. |
| `src/recipe-library.ts` | `em.recipe-replay.v1` capture/validate/resolve; `createRecipeStudyPack` derives a new pack identity with the three studies. |
| `src/phrase-plan.ts` | `S11_RECIPE_FAMILIES` (open space, steady pulse, broken current) with their own rhythm tables and performer `s11-pattern-performer@1`; all other recipes unchanged. |
| `tests/s11-library.test.ts`, `tests/s11-recipes.test.ts` | 16 Node tests. |
| `scripts/s11-library-demo.ts`, `scripts/s11-browser-check.ts` | Command-line example and isolated browser gate, run with `node dist/scripts/...` after `npm run build`; not added to the npm scripts. |

No S09 file, dependency, fixture, media, server route or page changed. [EM-DEC034](../DECISIONS.md) records the design.

## Coordinator review

Read the full diff of all ten files. **KEEP.**

| Point | Finding |
| --- | --- |
| Overlap with S09 | None: the merge was clean. S09's hybrid policies require `s04-s01-performer@1`; the studies use their own performer, so they cannot be picked as bridges by accident. The S09 FL recipe, S06 mock and S01 recipes keep their performer and events (Node test plus the unchanged 24 S09 offline groups). |
| Data safety | Corrupt, future, oversized and digest-mismatched snapshots are refused and kept; stale revisions and concurrent writers get `conflict`; locks are never stolen. |
| Playback safety | Restore is stopped and needs explicit Play; the browser check replaces `AudioContext` with a thrower during restore. |
| Honesty of history | Only renderer observations are accepted; the guide states they are not listening. |
| Gaps (not defects) | Nothing in `web/` uses the library; the two S11 commands sit outside `npm run check` / `check:browser`. Both are recorded as remaining S11 work. |

## Exact verification on the combined tree

Runtime: **Windows 11, Node 26.12.1 (declared Node 24 not installed), Chromium 151.0.7922.34, Playwright 1.62.1.** macOS and Linux were not run. Source at `1880867`; the working tree had only these new documents uncommitted.

| Command | Result | Evidence |
| --- | --- | --- |
| `npm.cmd run check` | PASS | **182/182 Node tests** (S09's 166 + S11's 16); fixture regeneration unchanged; media validation passed. |
| `npm.cmd run check:browser` | PASS | **24/24 native offline groups, 16/16 browser groups** (the S09 gates, unchanged). |
| `node dist/scripts/s11-browser-check.js` | PASS | 4 groups: IndexedDB save → reload → stopped restore without live audio; two connections, exactly one CAS winner; malformed, future and present-undefined records preserved; **24 native cases** (3 studies × 44.1/48 kHz × Explore/Drive × seeds 0 and 104729) rendered twice with **0 differing sample bits**, peaks 0.195–0.253, resources released. `artifacts/s11-browser/report.json` (ignored). |
| `node dist/scripts/s11-library-demo.js --directory local/s11-library-check` | PASS | Library revision 4; each study restored stopped with `requires_explicit_play`, seed 42 Explore: open space 37 events, steady pulse 82, broken current 69. The scratch folder was deleted afterward. |
| Relative links / `git diff --check` | PASS at closeout | Counts in the RAM record. |

The worker separately reported Windows Node 24.20.0: 177 Node tests on its base, fixture/media validation, 23 native and 15 browser groups, and the same 24 paired native cases. That is the worker's evidence; the coordinator's run above is on Node 26.

**Audio rendered: yes, offline only. Played on physical output: NOT TESTED. Auditioned by a listener: NOT TESTED. FL Studio involved: no.**

## Git delivery and controls

- Merged `5a00551` into `work/emf-s11-integration-20261107` from main `a28e1b3` with a merge commit (main had moved, so no fast-forward), then fast-forwarded main and pushed it. The worker branch and worktree (`C:/Users/splat/source/repos/eutonos-music-emf-s11-20261107`) are left as they were; neither was pushed.
- Board, NAV, RAM and acceptance were filed through the EUTONOS CLIs. No change to `.claude/`, `.codex/`, `eutonos.installation.json` or external configuration. One Current Tasks `tokenslang-ram-links` fence.

## Remaining S11 work

1. Wire the library into the pages: save vibe, restore selection stopped, volume/mute, and history writes from actual renderer events.
2. Put the two S11 commands into the npm gates.
3. A hybrid policy (or explicit refusal) for the study recipes as bridges.
4. Wider genres and transition coverage (EMF12 recency, EMF13 graph).
5. macOS and Linux runs.

## One next slice

**EMF-S10 — PC + owner** stays the priority: the owner listens to the real-FL DJ handoff and sampler with FL and agents closed and accepts or revises the flow. S11's remaining work can run in parallel on a disjoint scope (it should not change the S09 DJ page while S10 is being judged). S12 waits for S10.
