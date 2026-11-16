# EMF-S19 — slice handoff

**Campaign:** EMF / `campaign-emf-001`

**Slice:** EMF-S19 DJ transitions III

**Disposition:** BUILT on `work/emf-s19-transitions`, pending coordinator review, merge and push. Engineering proof only; not accepted MVP.

**Environment:** Windows 11, Node v26.13.0, headless Chromium 151.0.7922.34. macOS/Linux not run. Physical output and listening are **NOT TESTED**.

**Base:** origin/main `3cd8d42ac74ab91b499064369ed51802d57c1572`.

**Final tested source:** `9719024767e5571b47d5d45322b0745182a4faeb`. The later containing documentation SHA is reported in the chat handback; it cannot name itself here.

**Delivery:** local worker commits/readback only, no push or merge. The coordinator owns integration, publication and native filing.

## Scope and result

The approved order was full-song smooth blends first, then new transition styles. Both parts are built. The [S19 guide](../S19_TRANSITIONS.md) owns the implementation contract and eligibility details; the [campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status. No fallback scope was cut.

Part A removes set mode's whole-song WSOLA requirement. Analysis selects a bounded minute, records its bounds, and rebinds real evidence into the original song coordinates. Late Next/Auto requests select a new outgoing analysis window and preserve song bar numbering. Tempo and original-channel loudness copies share the existing worker transfer ceiling.

B's processed entry/overlap/tempo-return window ends at a measured downbeat. The processed buffer's last 20 ms join native B's exact preceding samples. Both prepared and native nodes are scheduled ahead in one `RecordedSource`, using the existing clock and playback owner; callbacks never start playback. Native continuation, subsequent Next/Auto, cancellation and EOF use the appropriate source/clock mapping. Existing processor limits stay unchanged: 12,000,000 channel samples and 180 seconds per render. Set native decode limits remain S18's; pair rendering remains bounded by its existing contract.

Part B adds five explicit recipe choices to the planner, preparation, automation, evaluator and Studio set readout:

| Recipe | Delivered behavior and important limit |
| --- | --- |
| Filter sweep | Real outgoing low-pass sweep, complementary gain entrance/exit, existing static blend tempo/key/cue gates. |
| Loudness match | B gain matched to A's playing fixed gain using measured K-weighted windows, at most 4×, with conservative combined sample-peak headroom. Fixed gain persists through native continuation and the next transition. No abrupt gain change to A. |
| Tempo ramp | Native A and B rates share a changing beat grid for ratios 0.8–1.25 outside static comfort. Key eligibility accounts for relative rate-induced pitch; **pitch moves**. Uses an explicit integral/inverse native-rate map, not a fabricated WSOLA result. |
| Loop-extend | One measured, checked 4/8-bar interval repeats once, followed by A's native overlap tail. B enters after the finite extension. Preparation is bounded and must complete before effects; this is not indefinite waiting for B. |
| Brake | Large-gap A slowdown with pitch drop and short fade into B's measured native cue. A deliberately leaves the beat grid. |

Auto's default recipe order remains unchanged; new styles are opt-ins. Requested style and actual selected style/fallback remain distinct. Pair directed-route and direct/hybrid eligibility gates remain unchanged. The v0 pair format still requires compatible authored tempos; decoded-pair preparation tests do not fabricate incompatible routes.

## Changed source and checkpoints

- `acfd1ebe2106e261b9cbc67c76267e81665101cb`: full-song analysis/window rendering/native continuation.
- `f8499c30eb46d0d459dab66a76449e1f54720187`: loudness match/filter sweep and their browser paths.
- `cf1d8a5830aab00fdb6642f67baaf4122b905f85`: tempo ramp, finite loop extension and brake.
- `9719024767e5571b47d5d45322b0745182a4faeb`: final source after independent review's near-EOF rate-map fix.
- Documentation checkpoints preserve recovery history; the final docs reconcile S17/S18's in-main state and mark S19 pending coordinator integration.

Principal paths: `src/mix-analysis.ts`, `audio-analysis.ts`, `mix-prepare.ts`, `mix-worker.ts`, `mix-transition.ts`, `mix-planner.ts`, `mix-automation.ts`, `mix-evaluate.ts`, `time-pitch.ts`, `web-audio.ts`, `player.ts`, `dj.ts`; `web/studio.html`, `web/studio.ts`, `web/set-mode.ts`; existing affected tests and `tests/helpers/synthetic-set.ts`; additive checks in `scripts/set-browser-check.ts`.

No new dependency or downloaded audio. The protected `scripts/serve.ts`, board/RAM/NAV/acceptance files and owner material are unchanged by this worker. No FL operations were performed. Main checkout source was not edited.

## Final verification

All final gates ran on Windows at the exact tested source above, before the final documentation-only commit. Working-tree changes during these gates were documentation only, explaining the browser receipts' `dirty: true`; runtime/test paths match the committed source.

| Command/check | Result |
| --- | --- |
| `npm.cmd run check` | PASS: 489/489 Node tests, 0 failures/skips; deterministic fixture verification, all six WAV metadata/hash checks and S11 library demo pass. |
| `npm.cmd run check:browser` | PASS: 24 native offline checks, 16 browser checks, 4 S11 groups / 24 paired cases, 15 Studio checks, 21 mix results, 8 phone checks and 16 set checks; reports contain no errors. |
| `git diff --check` | PASS |
| Tracked Markdown relative file targets | 102 Markdown files / 859 relative file targets; 0 missing. |
| macOS / Linux / physical output / listening / real owner songs | NOT RUN / NOT TESTED |

### Full-song and browser measurements

- Actual importer, analysis/render workers and OfflineAudioContext: **exact 180 s A → 181 s B, stereo 48 kHz, 122 → 128 BPM**, a real blend rather than fallback. Filter-sweep and loudness-match also run on that same fixture.
- Prepared B: **729,600 channel samples**, compared with **17,376,000** native B samples. Mono tempo analysis uses **2,880,000 frames / 60 s** per selected window at 48 kHz.
- Native join: source frame **1,079,562**, scheduled clock frame **1,130,850** in the isolated offline render. Prepared predecessor and first 2,048 continuation samples have maximum error **0** for the unscaled blend/filter. Loudness-match continuation error is **6.10e-9**, gain **2.5234123**, residual **0 LU**, mixed sample peak **0.203994**.
- Late Auto64 uses newly measured evidence near song bar 65. Tests cover before/after-earliest-effect cancellation, Hold, Stop, Pause/Resume, all voice nodes, source-start failure cleanup and subsequent Next after a rate ramp.
- Actual Chromium native-rate output differs from the nominal analytic map: **−10.66 samples placement**, **8.04e-6 RMS error**, **+11 samples EOF** at 16 kHz. These fixture measurements are separate from the evaluator's analytic `native-rate-model`; the lifecycle allowance is 256 frames.
- Native-rate → loop browser splice: **106,663 added frames**, **159,995 prepared samples**, peak **0.186285**, boundary jump ratio **1.281207**, using a scheduled 20 ms complementary splice.

### Generated-fixture evaluator results

The numeric `mix-evaluation-thresholds@1` values are unchanged. WARN is admissible under the existing chooser; these are not warning-free qualification claims.

| Recipe | Verdict | True peak dBTP | Momentary up / down LU | Boundary flux excess dB |
| --- | --- | ---: | ---: | ---: |
| Loudness match | PASS | -26.000 | +0.084 / -0.043 | 3.586 |
| Filter sweep | WARN: loudness | -14.692 | -0.002 / -1.616 | 3.728 |
| Tempo ramp | WARN: loudness, low-band build-up | -14.644 | +1.247 / -0.641 | 3.000 |
| Loop-extend | WARN: loudness, low-band build-up | -14.485 | +2.670 / -1.098 | 5.724 |
| Brake | PASS, intentional cut-like boundary | -14.430 | 0 / -0.008 | 36.785, measured but unjudged |

Brake judges B's entry beat only; A intentionally leaves the grid, and its intentional boundary flux is not scored as smooth-blend flux. The report discloses that scope. Smooth styles retain through-overlap phase/flux evaluation. Runtime peak admission is a **sample-peak** bound, not a true-peak limiter; true peak above is the offline evaluator's measurement.

Loudness fixture: raw B−A difference **12.036820 LU**, before matching relative to A's fixed gain **18.057420 LU**, matched difference **0 LU** (`fromGain=.5`, `toGain=.125063040189`). Matching and targets describe bounded measured windows, not whole songs.

Provenance: generated 16 kHz stereo independent-seed noise for level/filter tests; generated 16 kHz, 20-bar kick/bass/triad set for motion (120 A minor → 144 C minor ramp, 90 → 128 A minor brake, 120 → 128 A minor four-bar loop). Loop evaluation uses the exact `renderSetBlend` playback PCM, including the native-join replacement. No owner audio or `local/` content was accessed. Repeatable fixture/evaluator assertions are in the committed tests; ignored local receipts/logs are under `artifacts/s19/` and the standard browser report folders.

## Review findings and fixes

A separate read-only Sol/high review found one reproducible P2, fixed before full gates. Earlier focused/self-review corrections are included below.

| Finding | Fix and verification |
| --- | --- |
| Whole-song render budget rejects stereo three-minute B | Process only B's bounded needed window; exact180/181 s browser regression and unchanged ceilings. |
| Late analysis/Auto can confuse local-window frames with song frames | Evidence rebinding and explicit window/cache policy; late-bar coverage and original bar origin tests. |
| Multi-node continuation can end/release the voice too early | Single voice ownership, native EOF owner, ahead-scheduled starts, all-node cancellation and injected-start cleanup. |
| Loudness gain can be lost at native join or normalization | Immutable live A gain binding, persistent fixed B gain and explicit processor normalization compensation; actual worker/native sample checks. |
| Mono/stereo level evidence and transfer budget mismatch | Measure original-channel level interval separately; contain it in bounded analysis evidence and enforce aggregate transfer ceiling. |
| Native rate clocks differ from native frame consumption | Integral/inverse maps, explicit pitch-moving model and independent browser measurements; refuse authored cue methods assuming identity timing. |
| Loop preparation can miss or replan its cue | Bind prepared loop to the actual exit or fall back before effects; tests for late prep, FIFO/Hold and first-effect S versus delayed B entry T. |
| Native-rate → loop phase is only nominal | Scheduled complementary 20 ms branch splice rather than a hard switch at an assumed sample phase; actual browser jump check. |
| **P2 near-EOF slowdown lifetime uses old unity duration** | Validate integrated native consumption, allow output duration beyond old unity EOF, and use inverse-rate output availability offline. Preserve old EOF for pre-S cancellation; near-EOF admission/exhaustion regressions. The two new regressions failed before the fix; the focused run passes 5/5. Obsolete unity EOF gain gates are cleared for the slowdown and restored on cancellation/rollback. |

No known unaddressed source finding remains from the bounded review. WARN metrics and unqualified inputs below remain explicit risks.

## Limits and delivery boundary

- Generated fixtures establish engineering behavior only. Real owner songs, musical artifacts, physical output, listening, real phone/lock-screen behavior, other browser versions and macOS/Linux remain unverified.
- Selected-minute evidence cannot establish whole-song tempo stability, local harmony, stems or vocal-free content. Loop periodicity/energy checks and supplied vocal exclusions are heuristics.
- WSOLA can smear/repeat transients. The native-rate map is nominal because browser playback-rate automation is block-rate; pitch movement is deliberate for ramp/brake.
- Filter, tempo and loop fixtures still WARN; thresholds were not relaxed. No blanket claim is made for arbitrary pairs, seeds or source rates.
- `workflow prepare closeout` returned its semantic prompts after retrying with metadata access. Native filing would write catalog/work/RAM records excluded by this assignment, so no filing ran and no receipt is claimed. The coordinator owns that step.
- No push or merge was attempted, as explicitly required. Local readback is not remote publication or target integration. Preserve this worker branch/worktree and useful ignored reports until coordinator review.

## One next slice

**EMF-S10 — PC + owner**, after coordinator review/integration of S19. First action: open the integrated Studio set page with eligible material and record actual Next/Auto and selected-style observations in the [listening scorecard](../S10_LISTENING_SCORECARD.md), using PC output for mix judgments. Accept or revise the standalone flow; S12 Mission Control follows listening acceptance. This handoff does not dispatch S10 automatically. Overall campaign effort percentage is **unknown**.
