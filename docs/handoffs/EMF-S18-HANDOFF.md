# EMF-S18 — slice handoff (increments 2 and 3)

**Campaign:** EMF / `campaign-emf-001`
**Slice:** EMF-S18 DJ set mode
**Disposition:** IN PROGRESS. Increments 2 and 3 are **pending coordinator merge**. Increment 1 is in main at `1f62ad4`.
**Environment:** PC. Windows 11 Pro, Node v26.13.0, headless Chromium 151.0.7922.34.
**Inspected base SHA / branch:** main `9700276` → branch `work/emf-s18-set-mode` (worktree `.claude/worktrees/emf-s18-set-mode`).
**Publication:** local branch commits only. Nothing was pushed or merged; the coordinator owns integration.

## Assignment and scope

The owner's goal: "the DJ is supposed to be able to look at songs and just make it work". In automatic-mix mode any set song can follow any other. The owner can:

- reorder the queue;
- press Next to change song at the next 4- or 8-bar boundary;
- turn Auto on to move every 16, 32 or 64 bars, driven by snapshots rather than timers. Auto stops at the end of the set unless loop is on.

The UI shows the chosen recipe, bar and tempo change. Phone streaming and commands work from the Studio set page. The DJ page keeps working.

Exclusions:

- `scripts/serve.ts` was not edited (protected).
- `src/mix-automation.ts` and `src/mix-planner.ts` were not edited.
- No boards, RAM, NAV or acceptance tools were used; no `WORK_ITEMS` edits.
- No owner media was used, and nothing under `local/` was committed.

## Delivered changes

Branch commits, in order:

- `9f868f2`: lazy set-pack loader and per-song decode budget.
- `3dc0e0d`: single-song analysis worker job, analysis cache, set bar grids, route-free fallback and the control request `reorderQueue`.
- `acc765c`: route-free set player and any-to-any set DJ (automatic mix only).
- `2041e82`: Node tests for the set engine and a synthetic set built through the real importer.
- `31dfc8d`: Studio set page, phone `auto` command and Studio set relay address.
- `3d14527`: synthetic-set browser gate.
- The docs commit carries this handoff.

Engine (increment 2):

- `src/browser-pack.ts`: `{set: true}` lazy loading and `SET_LIMITS`: 2–32 songs, 512 MiB packed, 128 MiB decoded per song. Adds `decodeRecording`.
- `src/mix-prepare.ts` and `src/mix-worker.ts`: the `analyze-one` mono job.
- `src/mix-transition.ts`:
  - `renderPlannedMix` is extracted (pair behaviour unchanged);
  - adds `MixAnalysisCache`, `setBarGrid`, `nextBoundary`, `planRouteFreeTransition` and `chooseSetTransition`.
- `src/web-audio.ts`: `settleMixEntry` and the EOF gate on cancel.
- `src/player.ts`: route-free constructor (`routeId: null`), plus `playAsset`, `scheduleMixTo`, `warmSetSong` and `SetMixDetail` in the mix summary.
- `src/dj.ts`: set mode (any-to-any choice, Next arming, `reorderQueue` re-targeting, refusal of direct and hybrid handoffs).
- `src/control.ts`: `reorderQueue` (manual-only) and `acknowledgeQueueEntry`.
- `src/rated-takes.ts`: the stale catalogue limit text no longer says sets cannot play.

UI (increment 3):

- `web/set-mode.ts` (new; served as `/dist/web/set-mode.js` and imports only a type from `src/player`): pure Auto decision, queue move bounds and handover description.
- `web/studio.ts`, `web/studio.html` and `web/studio.css`:
  - `pack=set` with a lazy load, a null route and automatic mix only;
  - a Set card with the queue (▲/▼/Remove/Add/"Queue the whole set"), Next 4/8 and Auto 16/32/64 with loop;
  - a recipe, bar and tempo readout;
  - the S17 "Stream to phone" toggle.
- `web/phone-protocol.ts`: `{command: 'auto', enabled?}` and the `auto`/`canAuto` status flags.
- `web/phone.ts` and `web/phone.html`: an Auto button, shown only when the PC page reports `canAuto`.
- `web/app.ts`: answers `auto` with "ignored" and reports `canAuto: false`.
- `scripts/phone-relay.ts`: `studioSetPageUrl`, which also prints the Studio set address.

Tests and gate:

- `tests/set-mode.test.ts` (11 tests), `tests/set-auto.test.ts` (4) and `tests/helpers/synthetic-set.ts`.
- Additions to `tests/phone-relay.test.ts` and `tests/mix-prepare.test.ts`.
- `scripts/set-browser-check.ts`, added to `npm run check:browser` and runnable alone as `npm run check:set`.

All set media in tests and the gate is generated kick/bass/triad tone, imported through `importRatedTakes --set` into a temp folder. No owner audio is involved.

## Verification and limits

| Test command or listening check | Actual result | Evidence/limit |
| --- | --- | --- |
| `npm run check` (Windows) | PASS | 467/467 Node tests (452 before S18 inc 2/3, +11 set-mode, +4 set-auto), fixtures check, pack validation and S11 library demo. |
| `npm run check:browser` (Windows) | PASS | See the browser results below. |
| `node dist/scripts/set-browser-check.js` | PASS, 5 checks | Details below. |
| macOS / Linux | NOT RUN | Unverified on those OSes. |
| Owner set import / real owner songs | NOT RUN | The owner must import (steps below). Analysis of real songs is unverified. |
| Physical output, real phone, listening | NOT TESTED | No audio was heard by anyone. |

`npm run check:browser` covered: the browser check, the S11 gate, the Studio check (unchanged pages still pass), the mix check, the phone browser check and the new set check.

The set browser check found:

- **Lazy load.** The page fetched only the manifest before Play.
- **Any-to-any order.**
  - Reordering before Play started the third catalogue song (168 BPM).
  - Reordering while it played did not move the music.
  - Next went 168 → 174-b (not catalogue order) on bar 5, a 4-bar boundary. The plan read "Plain crossfade (not beatmatched) · tempo change +3.6% · grids: requested → requested".
- **One Auto step.** With N = 16, Auto moved 174-b → 174-a on bar 17, which is 16 bars after 174-b came in.
- **Stop and errors.** Auto toggled off, Stop returned to silence, and there were no page errors.

Audio was rendered by the Web Audio graph in headless Chromium. It was **not** played on physical output and **not** auditioned. Plan text and clock positions are engineering evidence only.

## Decisions, risks and recovery

Decisions:

- **Where the set lives.** `serve.ts` only serves `local/s16-rated/`, so `pack=set` reads the same folder as `pack=rated`. The owner swaps folders by renaming. One folder holds either a pair or a set.
- **Auto source.** The control contract allows Next only from a manual source, so Auto sends `nextSong` as the owner's armed repeat of Next (source `manual`). This is documented in the contract.
- **Auto pacing.** Auto runs from the page's snapshot tick (the existing `requestAnimationFrame` loop plus the 250 ms reconcile interval), not a music timer. It sends one Next per playing song, anchored to that song's entry. It never retries a failed step for the same song.
- **End of set.** By default the last song plays out and the set stops. With loop on, the page re-queues the set, skipping the playing song.
- **Queue edits.** They never move the music. Only Next or Auto does. A reorder while a Next is outstanding re-targets it before its effect.
- **Choice order.** Analyzed blend (only if B fits the time-stretch budget), then analyzed cut, then route-free crossfade (4 bars at equal tempo, 1 bar within 8%), then a clean cut on the bar. A cut or fallback plays native B audio, never a stretched copy.

Risks:

- **Blend budget.** The WSOLA limit is 12 M samples (frames × channels). A full-length 180 s stereo song cannot be blended, so real sets will mostly use the analyzed cut or the route-free fallback. Raising the limit (or streaming the stretch) is the main follow-up.
- **Real-song analysis.** Synthetic tones give low downbeat confidence, so the browser gate covered only route-free plans with requested grids. The analyzed blend and cut paths are covered by Node tests with controlled analysis only.
- **Settle approximation.** After a mix-in completes, the incoming song is reconnected directly at the end of its entry automation. This is covered by tests, not listening.
- **Memory.** The packed limit is 512 MiB and decoded audio is capped at 128 MiB per song. Only the playing voices and one prepared song stay decoded. Peak browser memory with real songs was not measured.
- **Rated pair page.** While `local/s16-rated/` holds a set, `pack=rated` fails to load (it expects a pair). Rename the folders back to restore it.

Last verified state: branch head after the docs commit, with both gates passing on Windows.

## Next handoff

**Exactly one next actionable slice:** EMF-S18 owner set import and first PC listening of the set (PC).
**Prerequisites:** the coordinator merges `work/emf-s18-set-mode` into main, and a fresh rated export exists.
**First command/action:**

1. Rename `local/s16-rated` to `local/s16-rated-pair-20261115`.
2. Run `npm.cmd run import:rated -- --source EXPORT_ROOT --out local/s16-rated --set loved-liked`.
3. Run `npm.cmd run demo`.
4. Open `http://127.0.0.1:4173/studio.html?pack=set`.
5. Optional: run `npm.cmd run phone` and open the printed Studio set address.

**Owner action:** listen to a few Next and Auto handovers and note which recipe the readout showed for each.
**Still not done:**

- blend for full-length songs (time-stretch budget);
- verified analysis on real songs;
- a persistent (IndexedDB) analysis cache;
- set waveforms;
- macOS/Linux runs;
- listening.

## Closeout

The campaign and Current Tasks rows say "pending coordinator merge". This file and the S18 contract are updated on the branch. The coordinator publishes, merges and sends the owner mini handoff.
