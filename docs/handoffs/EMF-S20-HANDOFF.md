# EMF-S20 — Studio set decks handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S20, first bounded slice: two-deck Studio set interface  
**Disposition:** COMPLETE for assigned branch-only engineering scope; main integration and listening remain unqualified  
**Environment:** PC, Windows only; Node v26.13.0, Chromium 151.0.7922.34  
**Inspected base/main:** `124b000ee2a0ed0a70dccede4c307b044cdce55e`  
**Branch:** `work/emf-s20-decks`  
**Final tested runtime/test source:** `201a4f5913d151affe6bcb4854bb15c6660b8bad`  
**Delivery:** local commits only. No merge, push or remote publication is authorized by this assignment. Main remains the separate owner checkout.

## Assignment and scope

Extend `/studio.html?pack=set` with two stable physical decks, live waveforms, Low/Mid/High EQ and a filter per deck, tempo/pitch information and a crossfader. The DJ automates every control initially; individual owner takeover persists until explicit handback. Preserve one audio clock, one playback owner, Next/Auto, reorder, Hold/Stop, phone control and the master stream tap.

This slice does not change transition/recipe choice or entry selection, add stems, change evaluator thresholds or complete the later analysis/cache and evaluator assignments. `src/mix-planner.ts`, `src/mix-transition.ts`, `src/dj.ts`, `web/set-mode.ts` and protected `scripts/serve.ts` were not changed. Owner audio and `local/` were not copied or committed. No installer or editor settings were changed.

## Delivered changes and source

- `web/deck-mixer.ts`: persistent A/B buses; three EQ bands and paired HP/LP filter; per-lane manual ownership and 20 ms slew; handback to the present automatic curve and its remaining tail; equal-power manual crossfader; separate audio-clock source lifetime; stale source/schedule protection; lazy observational waveform taps; atomic rollback if a native parameter call fails.
- `src/mix-automation.ts`: optional delegated lane owner. The existing non-set graph remains the original implementation, including echo send/return.
- `src/web-audio.ts`: existing source lifecycle supplies start/end/release to a deck lease. Manual gain cannot open a future source or keep filter tails after EOF/Stop. Source splices and native joins retain their own gates.
- `src/player.ts`: the existing `SmallPlayer` owns the buses, physical deck assignment and control APIs. Initial song uses A; subsequent songs alternate B/A without reassigning the surviving voice to A. Pause, Stop, cancellation and new voices retain manual state. The phone stream still taps the same master output.
- `web/deck-readout.ts`: display-only position/speed/pitch mapping for processed entries, native joins, native-rate ramps/brake and finite loops.
- `web/deck-controls.ts`, `web/studio.ts`, `web/studio.html`, `web/studio.css`: set-only controls with pointer/keyboard access, individual return buttons, visible ownership, responsive live scope and readouts. The existing authored-pair Studio path stays separate.
- `tests/deck-mixer.test.ts`: 19 focused tests. `tests/set-mode.test.ts`: retained-node topology and a real partial-automation fault replace assumptions about the old per-transition allocation graph.
- `scripts/deck-browser-check.ts`, `package.json`: add the generated-fixture deck browser gate to the existing full browser commands.
- `docs/S20_DECKS.md`, this handoff, campaign and Current Tasks: operation, architecture and bounded delivery evidence. Native board/RAM/acceptance records are generated only through their CLIs.

Implementation commit `7859ca4cd9623de6b7a824c5bc4f0a0fad90e6ac` added the decks. `201a4f5913d151affe6bcb4854bb15c6660b8bad` corrects transactional automation rollback and its regression. Documentation closeout is separate; its containing commit is supplied in chat to avoid a self-referential SHA.

## Verification actually performed

| Command/check | Actual result | Evidence and limit |
| --- | --- | --- |
| `npm.cmd run build` | PASS | Windows TypeScript build; no compiler configuration changes. |
| `node --test dist/tests/deck-mixer.test.js` | 19/19 PASS | Native parameter scheduling oracle, manual takeover/handback, physical deck lifecycle, cancellation, pause/resume, Stop/Play, mute and master tap. |
| Named set-mode ramp/brake/loop regression | 1/1 PASS | All six failure phases retained; partial native attenuation is cancelled and A remains neutral past the refused handover. |
| `npm.cmd run check` at `201a4f5` | 511/511 PASS; 0 failures, cancellations or skips; exit 0 | Full required Node/fixture/library checks on Windows. Node test duration 30088.7669 ms. |
| `npm.cmd run check:browser` at `201a4f5` | PASS; exit 0; 220.66 s | 24 native offline checks; 16 browser checks; 4 S11 groups / 24 native replay cases; 15 Studio checks; 21 mix results; 8 phone checks; 16 set checks; 7 deck checks. No report errors. |
| Deck browser gate, focused and final full run | 7/7 PASS; exit 0 | Native offline render comparisons, manual gain effectiveness, exact lifetime silence, Studio keyboard ownership, Next/physical B, pause/handback, Stop and 390 px layout. |
| Independent bounded source review | KEEP after corrections | No chooser/protected-file changes; no remaining actionable findings at review. The later rollback regression prompted the corrective source/test commit above. |
| Desktop/mobile screenshots | Visually inspected | Generated-fixture Studio UI; this led to correcting canvas backing dimensions for undistorted labels. No audio perception claim. |
| macOS/Linux, physical output, real phone/touch hardware, owner songs, human listening | NOT TESTED | No listening or real-device acceptance follows from engineering checks. |

Native `OfflineAudioContext` rendered generated signals. Automatic crossfade, bass-swap and filter-sweep output compared with the original graph: maximum absolute sample error `2.0324555569366937e-18` in each focused case (limit `0.00002`). Manual takeover before preparation and during the fade retained late-window RMS `0.10198039023425733`, versus automatic `0.02198806597916885`; maximum sample after the source lifetime gate was exactly `0`. These establish signal/control behavior on these fixtures, not musical quality. Nothing was listened to.

Local ignored evidence includes `artifacts/s20-checks/check.log`, `browser.log` and the browser harness reports/screenshots under `artifacts/`. Browser fixtures are original generated synthetic songs imported through the real set contract. The owner's private nine-song set was not used.

## Failures, decisions and risks

The first full Node run at `7859ca4` failed an existing loop rollback assertion that assumed only two persistent gains. The revised test captures actual retained topology. Its obsolete filter-allocation fault was replaced with a native scheduling fault after a real fade event; this exposed and now verifies complete lane rollback. An initial focused browser assertion read the prior render frame after handback; the gate now waits for both ownership readouts. A temporary test use of `findLastIndex` was corrected to the repository's existing library target; configuration was not widened.

Manual ownership is session-scoped and attached to physical decks. It survives transport and song changes; disposal/pack reload creates a new default-DJ session. Explicit handback is required. Planned source boundaries still apply; moving the crossfader does not extend a source or select a song. Manual levels/EQ may intentionally create silence or boost output, and are not listening-qualified.

The live deck display is a signal scope, not a full-song overview. The next slice adds song waveforms and analyzed BPM/key in the list. Readouts distinguish requested/measured grids and preserved/independent/rate-linked pitch. The common deck graph processes both sides of the finite loop's first 20 ms splice, unlike the earlier loop-only effect graph; its perceptual effect remains untested. Echo remains on the unchanged authored-pair graph because the current set chooser does not offer it.

## Native filing and delivery

The existing EUTONOS runtime was used without installation. Settings status was read. Native batch filing registered `EMF-S20` and feature `EM-F-S20-DECKS`; result `write-batch-7d8134b7657d11cf4f81b21e` reported complete with verified board readback. No board/RAM/NAV/acceptance file was edited by hand. Final checkpoint batch `write-batch-ecb2c5fe34c48fac2af7149d` also completed with verified readback. `workflow prepare closeout` and `workflow run closeout` completed; the latter reports landed memory capture, separately from the board filing. `setup_cli finalize` was attempted after the owner updates and exited 2 with `stale: Managed adoption needs an upgrade plan from this runtime.` Acceptance was not refreshed. No upgrade, installer, permission reset or settings change was attempted. Recovery is a separately scoped compatible-runtime/adoption upgrade assessment, then rerun finalize; this does not invalidate the app's passing engineering gates.

Main merge, public push and integration are intentionally outside this branch-only delivery. A local branch commit is not public publication. No merge/push is implied by the native filing or passing checks. Overall campaign effort percentage is unknown.

## Exactly one next slice

**Next:** S20 follow-up — S18 display/cache gaps, PC/Windows, on a new dependent `work/emf-s20-set-analysis` branch after this slice's full gates and handoff commit. Already assigned by the owner in this session.  
**Prerequisites:** checked deck source above, unchanged analysis/choice contracts and browser build.  
**First action:** inspect the existing analysis result/cache API, then add display-only analyzed BPM/key, song waveform summaries and a validated IndexedDB adapter keyed by audio SHA256, analysis version, decoded rate and every existing effective analysis option/window dimension.  
**Owner action:** none needed for the next authorized branch slice. Main merge/push require separate owner instruction.  
**Still not done:** analysis persistence/display, live evaluator pre-check (third slice, thresholds unchanged), owner listening/real-device qualification, macOS/Linux checks and main integration.
