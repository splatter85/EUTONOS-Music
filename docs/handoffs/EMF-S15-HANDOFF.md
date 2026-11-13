# EMF-S15 — DJ transitions II handoff

**Slice:** EMF-S15 (stages EMF09, EMF11, EMF13) in the [EMF campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md). **Brief:** [EMF-S15 pickup](EMF-S15-PICKUP.md), including Amendment 1.

**Writers:**
- The owner-assigned ChatGPT worker wrote increments 0 and 2 and the DJ guard.
- The Claude coordinator took over on 2026-11-13 (the owner said "You finish it"). It fixed increment 1's octave confidence, reviewed and committed increment 3, and built increment 4.

**Branch:** `work/dj-transitions-ii-reviewed`, from base `2bf931b`. It was merged into `main` as `17279e5` (see Status).

**Status:** increments 0–4 are delivered, with the limits below.
- Echo-out is admitted live only with an explicit caller confirmation.
- The evaluator is offline and Node-only. It is **not** wired into live preparation.
- Physical output and listening are **NOT TESTED**.

## Commits

| # | Commit | What changed |
| --- | --- | --- |
| 0 | `ac4af46` | `scheduleMix` recomputes "now" after preparation. If prepared audio misses its deadline, it tries a later analysed A cue, then the authored fallback. If both are past, A keeps playing and the request ends `unavailable` instead of throwing an unhandled error. B is never scheduled late. |
| 1 | `403946d` | Ranked `tempo.candidates` (×0.5, ×1, ×2 and nearby peaks) and `tempo.ambiguity`. An optional `generationBpm` hint counts as evidence, not ground truth. The planner refuses tempo-dependent recipes when ambiguity is above 0.5. |
| 2 | `1381605` | Separate outgoing and incoming cues on the downbeat grid, with 4/8/16-bar confidence weighting, incoming salience and joint pair scoring. No phrase boundary is invented without structure evidence. Includes the review fixes C1/C2 and `tests/mix-review-regressions.test.ts`. |
| guard | `99d816c` | Amendment 1 DJ guard. Once the transition's earliest committed effect (`mix.earliestEffect`, S) has passed, `cancelQueue`/`cancelFuture` report `blocked` before marking anything cancelled. B's request still starts at T. |
| 1 fix | `7e6a83e` | Octave ambiguity for tracks whose alternate beats are empty. Ambiguity is set to at least 0.6 when all three conditions hold: the top candidate's half-beats are empty, its backbeat is below 0.15, and a doubled candidate has coverage ≥ 0.35. A matching hint (support ≥ 0.5) selects the doubled tempo, with ambiguity 0.35. Constants are in `TEMPO_OCTAVE`. |
| 3 | `f1c276a` | Clean-cut and echo-out recipes beside blend and the authored fallback. They have S/T/E lifetimes and use native B (`native-pcm@1`), and the echo return bypasses A's channel gain. See [DJ transitions](../DJ_TRANSITIONS.md#clean-cut-and-echo-out-s15-increment-3). |
| 4 | `b7025dd` | `src/mix-evaluate.ts`: offline render, measurements, versioned experimental thresholds, and a chooser that keeps the best passing proposal or falls back. See [the evaluator section](../DJ_TRANSITIONS.md#offline-transition-evaluator-s15-increment-4). |

## New analysis fields and recipe preconditions

- **New fields:** `tempo.candidates` and `tempo.ambiguity` are added; nothing existing is removed.
- **Bar grid:** the `eutonos.bar-grid.v1` shape is unchanged, and `tests/bar-grid.test.ts` is unedited and passes. `MIX_ANALYSIS_VERSION` changed value, so bar grid reports the new `analysis_version`.
- **Blend:** the S14 preconditions, plus tempo ambiguity ≤ 0.5.
- **Cut and echo, timing:** supported 4/4 timing, ambiguity ≤ 0.5, and downbeat and cue confidence ≥ 0.65.
- **Cut and echo, cues:** cues lie on measured downbeats. A's boundary strength must be ≥ 0.6. B's salience must be ≥ 0.65, and B also needs boundary strength ≥ 0.6 or supported start evidence.
- **Echo, extra:** requires `echoContentConfirmed: true` and A cue-window interference ≤ 0.35.
- **Native B peak limit:** cut and echo refuse B if its peak exceeds 0.891251 (−1 dBFS), matching the blend policy. A refusal routes to the authored fallback.
- **Auto order:** blend, then echo, then cut. The shortlist holds at most 5 (hard cap 6).
- **Unchanged defaults:** the DJ handoff is `direct`; `mix` is opt-in and ready-only; EQ and bass-swap options are off. FIFO, Hold and Stop are unchanged.

## Evaluator thresholds and status

`MIX_EVALUATION_THRESHOLDS` is `mix-evaluation-thresholds@1`. Its status is **experimental**, and it is not calibrated by listening. The full thresholds and the fixture table are in [DJ transitions](../DJ_TRANSITIONS.md#offline-transition-evaluator-s15-increment-4).

Cost:
- About 0.41–0.44 s for one generated pair with one proposal, analysis included.
- 0.72 s for six analysis and plan runs on the real FL pair, which had no proposals to render.

## Actual checks (Windows 11 only)

Final branch tree (review fix on top of `b7025dd`):
- `npm run check`: **408/408 pass** (407 at `b7025dd`, plus the echo beat-phase regression).
- `npm run check:browser`: exit 0, 37 reported browser results PASS. The Studio browser check passed (10 checks, Chromium 151.0.7922.34).

The increment 1 fix (`7e6a83e`) passed 379/379. The other increments passed the gates before each commit; their counts are not repeated here. Merged `main` gates are under Status.

macOS and Linux were **not run**, so the slice is unverified there. There is no CI.

**Owner-local FL check.** It used the local pack (never published) with the `b7025dd` build:

| Input | FL A | FL B | Planner result |
| --- | --- | --- | --- |
| No hint | 60.00 BPM, confidence 0.62, ambiguity 0.60 | 120.00 BPM, 0.80, 0 | no candidate for auto, blend or cut → authored crossfade |
| `generationBpm` 120 | 119.99 BPM, confidence 0.36, ambiguity 0.35 | unchanged | no candidate → authored crossfade |

The brief expected FL A to move from 61.86 to about 120 BPM. What happened:
- **Without a hint**, FL A now reports 60 BPM *as ambiguous* instead of confident. FL A has one percussive hit per second (kick and clap on the same beats), so the audio alone cannot tell 60 from 120 BPM.
- **With the pack's 120 BPM as a hint**, it reports 120 at low confidence.
- **No caller passes `generationBpm` yet**, although the FL pack manifest carries `bpm: 120`.

`npm run check:fl` was **NOT RUN**.

## Known risks, findings and what was not done

- **The evaluator is not live.** `scripts/serve.ts` is protected, and its allowlist has no `mix-evaluate`. Live `mix` scheduling still uses the planner's first eligible proposal. Wiring the evaluator in needs a separately scoped change: either to the allowlist or a move into an allowed module, plus a worker.
- **S14 blend finding (measured, not heard).** On the generated 120 BPM pair, the S14 blend fails the evaluator twice:
  - a momentary loudness dip of −12.6 LU (short-term −3.8 LU);
  - a boundary-flux excess of +24.5 dB at S + 2.0 s.

  At that point the bass swap leaves both A and B shelved and high-passed for about 0.4 s. Log flux grows after a quiet frame, so part of the flux value restates the same gap. The S14 recipe is unchanged; this is a follow-up.
- **Echo is conservative.** It needs `echoContentConfirmed`, which nothing infers, so many recordings will get a cut or the authored fallback. The guard (`99d816c`) closes the B3 finding.
- **Stand-in render.** When the tempo ratio is not 1 and no prepared buffer is supplied, the evaluator measures a linear resample, not the WSOLA output.
- **Generated positives only.** Real-song cue detection, overlap headroom and listening quality are not established.
- **Deferred, not started:** the analysis sidecar (increment 5), the Signalsmith/WSOLA replacement (6A) and stems (6B).

## Independent review

The coordinator asked a separate read-only reviewer (Claude Sonnet) to review `main...b7025dd`. It reported **no high-severity findings**, and it confirmed:
- the bar grid, `scripts/serve.ts`, Studio, `web-audio.ts`, clock and control files are untouched;
- the guard behaves correctly before S, during S..T and after T;
- in `scheduleMix`, every failure branch ends in the authored fallback or a defined `unavailable`;
- the echo return bypasses A's channel gain;
- no low-confidence or ambiguous path admits a tempo-dependent recipe.

Its findings and what was done:

| Severity | Finding | Action |
| --- | --- | --- |
| Medium | The evaluator judged echo-out's beat phase over the whole tail, although B keeps its native tempo by design. A 120 → 126 BPM echo failed with an error of 0.38. | **Fixed.** Echo, like cut, is now judged on B's entry beat only. A regression test reproduces 0.38 without the fix and passes with it. |
| Medium | Live `mix` uses the planner's first eligible proposal without a rendered check. With `auto`, a pair that fails blend but has strong cue evidence can get a live clean cut instead of the authored crossfade. | **Accepted and documented.** The increment 3 decision table allows it, and `mix` stays opt-in. The evaluator is offline only (see above). |
| Low | Cut and echo refuse a B peak above −1 dBFS and fall back without trying another candidate. | Documented above. |
| Low | A hint that matches the doubled tempo sets ambiguity 0.35, which admits tempo-dependent recipes on hint evidence plus the gated audio conditions. | Policy risk; documented. Listening has not set the value. |
| Low | Beat phase uses the analysers' grids mapped through the spec, not beats detected in the rendered mix, so it cannot catch a render or warp error. | Documented in the code and in [DJ transitions](../DJ_TRANSITIONS.md). |

## Late-preparation and guard tests

- `tests/mix-player.test.ts` covers the three increment 0 branches with a slow mock preparation runtime: a later A cue, the authored fallback, and `unavailable` with A continuing. FIFO and Hold behave as before.
- `tests/mix-echo-guard.test.ts` covers cancelling before S, during S..T and after T, with lifecycle and Hold checks at each point.

## Status

**COMPLETE (engineering), 2026-11-13.**

- **Merge:** the coordinator merged branch head `15d5ffd` into `main` with `--no-ff`, as `17279e5`. There were no conflicts, because `main` had not moved since base `844471a`.
- **Gates on merged `main` (Windows 11):** after a clean rebuild, `npm run check` passed 408/408 and `npm run check:browser` exited 0, with 37 results PASS, 0 FAIL, and the Studio browser check passed (10 checks).
- **Not run:** macOS and Linux. Listening is NOT TESTED. Owner acceptance is S10.
- **Published:** `main` and the branch were pushed to origin.

## Next slice

**PC: EMF-S10**, owner listening and standalone MVP acceptance. Include an A/B listen to the S14 bass-swap gap that the evaluator flagged.

Optional small **BOTH** follow-up:
- pass the pack's `generationBpm` into analysis;
- wire the evaluator into worker preparation, under an assigned allowlist change.
