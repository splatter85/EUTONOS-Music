# EMF-S20 — Studio set decks, analysis and live pre-check handoff

The deck and analysis/cache checkpoints below are source-pinned historical evidence. The [live evaluator pre-check](#live-evaluator-pre-check--complete) records the latest completed branch. All three owner-assigned slices are complete for branch-only engineering scope; main integration and listening remain separate.

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

## Set analysis/cache follow-up — COMPLETE

**Recorded:** 2026-11-16, Windows only

**Branch:** `work/emf-s20-set-analysis`, based on deck handoff `aa40b9fad2c015da1ce86562ed36e2065d36067e`

**Tested runtime/test source:** `8ccad81663da8d10ef4f483ef9e3cab78b88663d`

**Disposition:** COMPLETE for the assigned branch-only engineering scope; no main merge or push. The earlier deck checkpoint and its next-step statement above are historical.

### Delivered behavior and files

- `web/set-song-list.ts`, `web/studio.ts/html/css`: set rows retain requested BPM and add measured BPM/key estimates, the analyzed interval and full-song waveform summaries. Ambiguous keys and insufficient rhythm remain uncertain. Analyze uses the existing preparation path while idle/paused/ended and never starts transport or changes the queue. The waveform playhead reads the deck clock. Rows remain readable at 390 px.
- `web/set-waveform.ts`, `web/set-waveform-worker.ts`: 512 exact absolute peak bins over every native frame and both channels. One browser worker receives sequential private chunks of at most 1,048,576 total samples; native buffers are never detached. At most one running and one queued song are retained. Bounded failure/cancellation cleanup leaves playback unaffected.
- `web/analysis-storage.ts`: separate disposable IndexedDB store, 64-record LRU limit, one MiB payload limit and conservative 16 MiB total budget. Transaction completion is awaited by the storage operation; playback does not await writes. Blocked/unavailable/quota failures fall back to session analysis.
- `web/set-analysis-cache.ts`: adapter around the unchanged `MixAnalysisCache`, preserving its complete SHA256/version/rate/window/BPM-hint key. Checksum plus schema/coordinate/dimension validation protects restored evidence. Only successful analysis persists. Shared work is deduplicated while cancellation remains per caller. Small records restore on reload without fetching WAV files; actual reuse checks exact decoded frames/channels. Native coordinates remain unchanged.
- `src/player.ts`: optional analysis-cache injection and a display-only decoded-song observer. The default canonical cache and single live player/context/clock remain intact.
- `tests/set-analysis-cache.test.ts` (18 tests), `tests/set-waveform.test.ts` (18 tests), `scripts/set-analysis-browser-check.ts` (7 browser groups), `package.json`: cache/worker regressions and actual browser persistence verification, included in the full gate.

`src/mix-transition.ts`, `src/mix-planner.ts`, `src/dj.ts`, `web/set-mode.ts` and protected `scripts/serve.ts` are unchanged from the preceding branch. No recipe or entry-point choice, evaluator threshold, stems, editor settings, installer or owner media was changed. All test songs were generated fixtures, including media served at intercepted owner-local routes.

### Executed verification

| Check | Actual Windows result |
| --- | --- |
| TypeScript build plus focused cache/waveform tests | 36/36 PASS; 0 failures/cancellations/skips; exit 0; 2029.6007 ms Node test duration |
| `npm.cmd run check` at `8ccad81` | **547/547 PASS**, 0 failures/cancellations/skips; exit 0; 30516.9303 ms Node duration; 41.47 s complete command |
| `npm.cmd run check:browser` at `8ccad81` | **PASS, exit 0**, 224.90 s |
| Full browser inventory | 24 native offline; 16 browser; 4 S11 groups / 24 native replay cases; 15 Studio; 21 mix; 8 phone; 16 set; 7 deck; **7 analysis/cache** checks. No report errors. |
| Independent bounded persistence review | KEEP after the four fixes below; review was source inspection, not a separate execution claim |
| Desktop and 390 px screenshots | Visually inspected; no horizontal overflow, measured labels and waveform rows readable |
| Owner songs, real phone, physical output, touch hardware, listening, macOS/Linux | **NOT TESTED** |

The actual IndexedDB reload produced identical measured labels and waveform pixels with **zero WAV requests**. A fresh cache reused full-coordinate analysis and the same planner result with **zero analysis and waveform computations**. Hash, rate, window and requested-BPM changes missed. A rechecksummed string-coordinate payload triggered the real canonical worker and was repaired. The browser waveform worker scanned 1,048,649 stereo frames in three chunks, one in flight, preserving raw peaks through the final frame and leaving 4,194,596 native bytes per channel intact. Actual storage retained 64 LRU rows; the byte-budget probe retained 13 large rows accounting for 15,626,624 bytes, below 16,777,216.

Ignored local evidence: `artifacts/s20-analysis-checks/check.log`, `browser.log`, native filing JSON, and `artifacts/set-analysis-browser/report.json` plus desktop/mobile screenshots. Runtime reports pin `8ccad81`; any dirty flag during the gates refers to the documentation closeout only.

### Review fixes, decisions and limits

The independent review found four defects before final verification: display restore needed the decoder's ±1 resampling tolerance; coordinate rebasing needed integer validation before subtraction; saved waveform validation needed to return its frozen copy; and stale conditional deletion needed key/identity comparisons as well as payload/digest. All four were fixed and covered by Node or actual browser regressions. Actual decoded analysis reuse remains exact, including native frame count.

Persistence is an optimization, with the canonical analyzer as the miss path. The display is honest about a bounded analysis window (up to 60 s); its separate overview covers the full song. Session front and canonical caches each retain at most 64 entries. Waveform/storage deadlines bound non-musical work only. IndexedDB belongs to the browser origin, so changing origin/port/profile or clearing browser data starts a new disposable cache. No saved audio, continuous background library scan or timing/selection policy was added.

No human listening occurred. Synthetic waveform/tempo/key/transport measurements do not establish musical quality, real-device behavior or broad browser qualification. Main remains separate; branch stacking is not integration.

### Native filing and next slice

Native batch `emf-s20-set-analysis-register-20261116` registered `EM-F-S20-SET-ANALYSIS` with complete/verified readback. Checkpoint batch `emf-s20-set-analysis-checkpoint-20261116` also completed with verified readback. `workflow prepare closeout` and `workflow run closeout` completed; native memory capture landed without required queued writes. A transient Desktop Commander connection failure was reconciled before retrying the same operation. Documentation checks verified 131 local Markdown file links, the new handoff anchor and exactly one Current Tasks RAM fence. The existing adoption-finalize block remains: the prior attempt returned `stale: Managed adoption needs an upgrade plan from this runtime.` No unchanged retry, installer, upgrade, permission reset or settings change was attempted. Acceptance therefore remains unrefreshed; the app gates above pass independently.

**Exactly one next slice:** live evaluator pre-check, PC/Windows, on dependent `work/emf-s20-live-precheck` after this handoff commit. Apply the existing offline evaluator to the already selected transition before live scheduling; keep `mix-evaluation-thresholds@1`, recipe choice and entry selection unchanged. It is already assigned; no owner action is needed to continue that branch-only work. Main merge/push, listening/device qualification and other OS checks remain separate.


## Live evaluator pre-check — COMPLETE

**Recorded:** 2026-11-16, Windows only

**Branch:** `work/emf-s20-live-precheck`, based on analysis/cache handoff `d257849f6489ddaf54e141e6d3c68f0b62045b3e`

**Tested runtime/test source:** `cc7422ac5dcf15c112631f1ad4eb2778e6059572`

**Disposition:** COMPLETE for the third assigned branch-only engineering slice. The two earlier sections and their next-step statements are historical. All three assigned slices are now built, checked and locally committed on dependent branches; main integration, push and listening remain separate.

**Working checkout:** `C:\Users\splat\source\repos\eutonos-music-s20-decks`. The owner checkout remains on main `124b000ee2a0ed0a70dccede4c307b044cdce55e`, with only the pre-existing untracked `.claude/` folder.

### Delivered behavior and files

- `web/mix-evaluator.ts` is the existing pure offline evaluator shared with the browser; `src/mix-evaluate.ts` re-exports it for existing Node callers. The threshold object, measurement/judgment functions and offline choice helpers retain their behavior. Optional captured fixed source gains account for a voice already carrying a prior loudness match. Optional actual outgoing-loop PCM prevents the check from silently rebuilding a different loop. Gains apply once. The live gate never calls the candidate chooser.
- `web/mix-precheck-data.ts` builds bounded source windows around the existing S/T/E timeline, rebases measured beat coordinates, includes interpolation endpoints and carries the actual prepared B entry/native continuation. A's pre-context follows the existing prepared/native voice when necessary. The actual prepared outgoing loop is a separate fourth stream. Source identity, coordinates, shapes, rate and budgets are checked before copying PCM.
- `web/mix-precheck-worker.ts` runs one evaluation without an AudioContext. `web/mix-precheck.ts` transfers private cropped Float32 chunks, one acknowledged chunk at a time, and releases the worker on completion, failure, cancellation or deadline. Native playback buffers are never transferred. Replies must have complete finite measurements, coherent beat/flux semantics, the expected source mode and coverage, and a judgment reproducible under the frozen thresholds.
- `src/player.ts` invokes the injected gate after the unchanged selection/preparation path, before constructing the incoming source or changing A's automation. PASS/WARN admit that exact plan. FAIL/unavailable refuse without a new selection attempt. Operation identity and the original audio-clock deadline are rechecked after the await. A late result cannot move the handover to another bar.
- `web/studio.ts` always supplies the browser gate for Studio set mode. `web/studio.html` explains its scope. Preparing, admitted and refused results are shown, including unjudged beat phase and a later native join outside coverage. No bypass switch was added. Queue reorder, Next, Auto, Hold, Stop, pause, manual deck ownership, phone controls and the master stream tap keep their existing owner.
- `tests/mix-evaluation-sharing.test.ts` (7), `tests/mix-precheck.test.ts` (12) and `tests/mix-precheck-player.test.ts` (11) cover sharing, exact threshold values, actual PCM/crop parity, malformed replies, failure/cancellation/deadlines, queue/transport lifecycle, fixed gains and loop ownership.
- `scripts/mix-precheck-browser-check.ts` adds seven actual browser groups to `package.json`'s full browser gate. `scripts/set-browser-check.ts` and `scripts/deck-browser-check.ts` use matched-tempo, distinct-key control fixtures so successful transport is tested separately from the new gate's real unequal-tempo refusal. The set harness now includes actual readout text in timeout diagnostics.

`src/mix-planner.ts`, `src/mix-transition.ts`, `src/dj.ts`, `web/set-mode.ts` and protected `scripts/serve.ts` are unchanged from main across these slices. No recipe/entry choice, threshold, stems, installer, editor settings or owner media changed. New served modules are under `web/`. No owner audio or `local/` material was copied or committed.

### Executed verification

| Check | Actual Windows result |
| --- | --- |
| Build plus focused shared-evaluator/adapter/player tests | **30/30 PASS**, 0 failures/cancellations/skips, exit 0; 3359.9869 ms Node duration |
| Focused updated set browser gate | **16/16 PASS**, exit 0; 77.86 s including build |
| Focused updated deck gate following the 30 tests | **7/7 PASS**, exit 0; 19.76 s combined build/Node/deck command |
| `npm.cmd run check` at `cc7422a` | **577/577 PASS**, 0 failures/cancellations/skips; exit 0; 30398.3502 ms Node duration; 41.10 s full command |
| `npm.cmd run check:browser` at `cc7422a` | **PASS, exit 0**, 242.22 s |
| Final full browser inventory | 24 native offline; 16 browser; 4 S11 groups / 24 native replay cases; 15 Studio; 21 mix; 8 phone; 16 set; 7 deck; 7 analysis/cache; **7 live pre-check** groups. No report errors. |
| Independent bounded source review | **KEEP** after complete-reply validation was strengthened; no remaining actionable finding |
| Desktop and 390 px pre-check screenshots | Visually inspected; actual refusal and ownership remain readable; no horizontal overflow |
| Owner songs, real phone, physical output, touch hardware, human listening, macOS/Linux | **NOT TESTED** |

The real Chromium worker exactly matched the full, uncropped canonical evaluation for its native fixture. Four stereo chunks crossed the 1,048,576-sample boundary with one in flight; native PCM stayed intact and one worker was created and terminated. Synthetic prepared/native continuation jobs passed both inside-window and explicitly after-window coverage cases. An introduced gap between active sources failed at 700 ms against the unchanged 250 ms failure threshold. Worker creation failure remained unavailable; cancellation after a real chunk produced AbortError and terminated exactly one worker.

The actual Studio unequal-tempo fixture produced a real beat-phase FAIL (0.10813077929328463 against 0.10). A strong/quiet fixture produced loudness FAIL (7.717690996855394 against 3 LU) plus phase failure. Both kept A, the queue and source count unchanged, retained manual ownership, used one live context and scheduled zero premature incoming sources. These are measured engineering results, not listening judgments.

Positive continuation is also executed: the full set gate completed Next at the four-bar boundary and Auto at the entry-anchored 16-bar boundary under WARN. Actual selected filter sweep, loudness match, tempo ramp, loop extension and brake were admitted with unchanged thresholds. Longer synthetic 180/181-second stereo sources retained their bounded prepared entry/native join tests. Brake disclosed unjudged beat phase. Existing phone/control, cache/reload and native deck signal checks remained in the full gate.

Ignored evidence is in `artifacts/s20-precheck-checks/check.log`, `browser.log`, their result JSON files, native filing JSON, and `artifacts/mix-precheck-browser/report.json` with desktop/mobile screenshots. The final browser reports pin the runtime commit above. No generated media was committed.

### Findings, decisions and limits

The first native-rate crop comparison differed only through floating-point coordinate rebasing. Its test compares numeric measurements within 1e-9 while requiring the same verdict, metric categories and exact thresholds. Inverse filter-display arithmetic similarly required a floating-point comparison. These are test tolerances; no evaluator acceptance threshold changed. Strict optional-property typing in the new missing-loop test was corrected without weakening the guard.

An initially all-silent browser fixture was rejected by the existing intake guard and would not test an introduced gap relative to active references. It was replaced with a real automation gap for the worker and a strong/quiet imported pair for Studio. The old set transport fixture then correctly failed the newly enabled beat-phase guard. Requesting the cut preset still followed the unchanged route-free fallback when no analyzed boundary cue existed. The control fixture now uses matching tempos; a distinct real unequal-tempo FAIL stays explicitly covered by the new browser gate. No production evidence, choice or threshold was overridden to obtain green checks.

The gate models the automatic DJ plan, including actual prepared PCM and persistent fixed source gains. Manual EQ/filter/crossfader, master volume and mute are outside that model and remain under their existing ownership. The check covers the evaluator's unchanged three seconds before S through three seconds after E, shortened at song start. A later native join is labelled outside coverage. Native-rate ramps use the existing nominal integration model; they are not captured Web Audio/device PCM.

Resource bounds are 4,000,000 rendered channel-samples, 12,000,000 input channel-samples, private chunks of at most 1,048,576 samples and an eight-second worker deadline. Resource failure or a missed audio-clock deadline refuses rather than choosing another recipe or bar. Another explicit Next requests a fresh plan; it does not bypass the check. The existing Auto once-per-voice retry policy was not changed.

This integration covers **Studio set mode**. Existing authored-pair, hybrid and legacy demo paths keep their prior behavior. The thresholds remain experimental and not listening-calibrated. Some transitions that previously played are now refused. Real-song choice improvements remain a separate assigned future slice; no stems work began.

### Native filing and delivery

The existing runtime registered `EM-F-S20-LIVE-PRECHECK` through native batch `emf-s20-live-precheck-register-20261116`, with complete/verified readback. Checkpoint batch `emf-s20-live-precheck-checkpoint-20261116` completed with verified readback. `workflow prepare closeout` returned prepared/ready-to-run with verified catalog/work assessments and no pending items; `workflow run closeout` returned completed with a landed receipt and no required queued write. Native RAM capture landed through that workflow. Documentation readback verified 141 local file links, three current/new anchors and exactly one Current Tasks RAM fence.

The previously observed adoption-finalize block remains: `stale: Managed adoption needs an upgrade plan from this runtime.` No unchanged retry, installer, upgrade, permission reset, settings change or hand-authored acceptance record was attempted. Acceptance remains unrefreshed; the app gates above pass independently.

Local branch commits are the authorized delivery. Main remains at the inspected owner SHA; there was no merge, push or remote publication. The documentation/native-record commit containing this section is supplied in chat to avoid a self-referential SHA.

### Exactly one next slice

**Next PC slice:** owner/coordinator review and explicitly authorized integration of the three dependent S20 branches. Review this source-pinned handoff and the unchanged protected/choice paths before any merge instruction. No further implementation is selected here. S10 owner listening and other-OS/device qualification remain separately assigned work; main merge and push require the owner's instruction.

## Post-merge review and local integration — COMPLETE

**Recorded:** 2026-11-16; Windows-only code, audio-scheduling-double and Chromium engineering evidence.

**Owner-authorized target integration:** Three dependent S20 slices fast-forwarded to local `main` from base `124b000ee2a0ed0a70dccede4c307b044cdce55e` at `9ad6aef28e64bc9be2399394323e4eb4762d05a9`. Original untracked `.claude/` was retained unchanged.

**Review:** [EMF S20 post-merge review](../reviews/EMF_S20_POSTMERGE_REVIEW_20261116.md) examined player/source lifetimes, per-deck EQ/filter/fader ownership, the queue/clock, saved BPM/key/waveform evidence, IndexedDB integrity and the bounded worker pre-check. Decision **CHANGE**, with two reproduced P2-level native failure-path defects; both corrected and retested. This review was performed directly from the checked sources and synthetic native-call doubles; no independent second model or listener was claimed.

**Source correction:** `57d0c996ab775998132e2f53350c5c8f3ed4f952` on `work/emf-s20-postmerge-review`. `web/deck-mixer.ts` makes the filter HP+LP and crossfader A+B manual updates transactional. A refusal on the second native AudioParam now attempts to restore both channels' prior automation/manual positions, keeps the original error visible, and does not falsely claim ownership. `tests/deck-mixer.test.ts` adds two deterministic second-lane fault-injection tests, including take and explicit handback. The code fix and review report fast-forwarded into local main at `ed616e119b296f7771e469a5febf404192a14d5c`.

**Red-to-green evidence:** The initial source with added fault tests had **19/21 PASS, 2 FAIL**, confirming both defects. After correction **21/21 focused deck-mixer PASS**.

**Required Windows full gates at tested code `57d0c99`:** `npm.cmd run check` **579/579 PASS**, zero failures/cancellations/skips, exit 0; completed committed-source run in 44.56 seconds. `npm.cmd run check:browser` **exit 0** in 245.46 seconds, covering the full previous browser inventory (including 16 set, 8 phone, 7 decks, 7 cache and 7 live pre-check checks). The full browser run is pinned to the committed source SHA, and the final local-main integration differs from the tested implementation only by documentation and native board records.

**Explicit unchanged boundaries:** `src/mix-planner.ts`, `src/mix-transition.ts`, `src/dj.ts`, `web/set-mode.ts`, protected `scripts/serve.ts` and `mix-evaluation-thresholds@1` were not modified. No stems work, alternative recipe/entry selection, second music clock or stream tap was introduced.

**Native board evidence:** `emf-s20-postmerge-review-20261116` updated existing `EMF-S20` and `EM-F-S20-DECKS` through the admitted EUTONOS boards CLI, with `complete` outcome and `verified` readback. The newer review/main checkout could not reuse that prior host admission (`wrong-scope`). Its failed attempt wrote nothing. The CLI was run in the original authorized S20 worktree; the resulting generated board was copied into local main only after verifying that main's prior board matched the generated file's base Git blob and that the resulting bytes matched the CLI output. No board/RAM/NAV/acceptance record was manually authored.

**Provenance and limitations:** All test audio was original generated fixture material. No owner's nine private songs, `local/` recordings, credentials or model weights were staged. Human listening, real phone/touch/lock-screen, audio-device output, macOS and Linux are **NOT TESTED**. The live pre-check is an experimental model of the automated plan; manually owned controls and the master output remain outside it. Its strict thresholds can refuse transitions that previously played. Neither GitHub push nor installation/deployment was performed. The existing managed-adoption acceptance-finalize incompatibility remains a separate environment issue, not an audio test failure.

**Exactly one next owner/PC slice:** EMF-S10 listening acceptance on local Windows with the owner song set and actual audio output. First action: follow [S10 listening scorecard](../S10_LISTENING_SCORECARD.md) and record which handovers work or fail musically. S10 is not automatically authorized by this completion. Public push, cross-platform checks, stems and later transition-selection changes remain separate.
