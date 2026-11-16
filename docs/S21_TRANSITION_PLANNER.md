# S21 transition planner (Part A)

Slice: [EMF-S21](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) · Handoff: [EMF-S21-HANDOFF](handoffs/EMF-S21-HANDOFF.md)

**Source:** `web/transition-policy.ts` (policy, entry rule, explore, plan record, ratings), `web/eq-choreography.ts` (LR4 split, choreographies), `src/mix-planner.ts`, `src/mix-transition.ts`, `src/player.ts`, `web/mix-evaluator.ts` (`transition-safety@1`), `web/set-mode.ts` and `web/studio.ts` (readout). The two new modules live in `web/` because the unchanged loopback server only serves an allowlist of `dist/src` modules.

**Status:** Part A is built on branch `work/emf-s21-transitions` and passes the Windows engineering checks. It is not merged. Part B (structure analysis, pairwise scoring, re-ranking, clash estimates) is not started. **Listening NOT TESTED.** Everything below is plan data, unit tests and offline renders. None of it shows that a handover sounds good.

## What changed for the set DJ

| Before (S18–S20) | S21 Part A |
| --- | --- |
| B usually entered near its very start (an early-position bonus, and only the first 60 s were analysed). | B's whole song is analysed in bounded windows; phrase entries can be anywhere; there is no position bonus. |
| A large tempo gap often became a clean cut. | Auto picks recipes by tempo-gap band. A clean cut is the last candidate, used only when every other candidate is unavailable or rejected. |
| Blends used one crossfade-and-EQ shape. | Five EQ choreographies on an LR4 three-band split, chosen from pair features and style. |
| One plan per request. | Rejected candidates (render failure, deadline, pre-check FAIL) are excluded and the next candidate is tried, at most 5 attempts. |
| Pre-check judged `mix-evaluation-thresholds@1` only. | A separate versioned safety set `transition-safety@1` can also reject. `thresholds@1` is unchanged. |

## Tempo-gap table (`transition-policy@1`)

The gap is symmetric: `max(bpmA, bpmB) / min(bpmA, bpmB) − 1`. Band edges belong to the lower band.

| Gap | Band | Auto order (cut is always last) |
| --- | --- | --- |
| 0–4% | normal | blend, loudness match, filter sweep, loop extend, echo out, echo reset, cut |
| 4–8% | stretched | blend (smoothstep return to native over 4 bars), filter sweep, loop extend, echo out, echo reset, cut |
| 8–16% | meet | meet in the middle, echo out, tempo ramp, echo reset, cut |
| 16–25% | bridge | echo out, tempo ramp, brake, echo reset, cut |
| above 25% | reset | brake, echo out, echo reset, cut |

- **Meet in the middle.** Both decks move to a meeting tempo, the geometric mean by default (explore picks 35–65% of the log distance). Each deck stays within ±8% across the whole band. A ramps over 2 bars; its pitch moves, because it uses the native-rate path. B is stretched to the meeting tempo and then returns to native over 4 or 8 bars on a smoothstep. The smoothstep keeps the linear ramp's frame total, so only the mapping inside the ramp changes. This recipe is set-only.
- **Gating.** Rhythm recipes (blend, loudness match, filter sweep, loop extend, meet, tempo ramp, brake) are dropped only when the beat grid is not confident. A weak or distant key does not drop recipes. It only forbids sustained harmonic overlap: a blend then needs a mid-carve or bass-drop choreography.
- **Not built:** a reverb bridge, a loop-ramp bridge and a breakdown-based structural reset. The bridge and reset bands use echo, tempo ramp and brake instead.

## Entry choice (`entry-skip@1`)

- **Whole song.** The song is analysed in 60 s windows with a 48 s hop, at most 12 windows, with the last window aligned to the song end. The 180 s render cap is unchanged. The windows are merged under `song-window-merge@1`: the most confident tempo wins, cues are de-duplicated, at most 16 cues per window and 32 merged.
- **No early bias.** A candidate's score is its analysis score minus a skip cost. Position earns nothing.
- **Skip cost.** Skipping up to 25% of B is free. Beyond that, each unit of song fraction skipped costs 0.8 score units. A style that asks for skipping (DJ edit) waives the cost.
- **Tie rule.** Among candidates within 0.1 (about 10 points of 100) of the best adjusted score, the earliest wins.
- **Fallbacks.** The route-free fallback uses the same rule on the merged analysis, together with the measured BPM and grid.
- **Deadline.** B's whole-song analysis has a 6 s deadline (`SET_SONG_ANALYSIS_DEADLINE_MS`). If it misses, Next goes ahead without B's analysis and uses the bounded route-free path. Next never waits on new analysis beyond that.

## EQ choreography (`eq-choreography@1`)

The split is `lr4-three-band@1`: Linkwitz–Riley 4th order at 160 Hz and 3.5 kHz. The low band is the all-pass-compensated low path, so the three bands sum flat. A unit test checks the sum is within ±0.01 dB from 20 Hz to 20 kHz, and checks the impulse energy of the time-domain splitter. Each deck has one split in the browser graph; the offline evaluator mirrors it. The sum is flat in magnitude but all-pass in phase, so the split is only in the path while band lanes run: the owner graph crossfades back to a direct path over 64 ms (`BAND_BYPASS_SECONDS`) after the band automation ends, and each set deck uses a direct path except while a choreography is scheduled (64 ms in at its start, 64 ms out after its end). The native join of B stays sample-exact, and recipes without bands match the pre-S21 output. Choreographies apply to blend and meet in the middle only: filter sweep, loop extend and loudness match keep their own S19 lanes.

| Choreography | What moves |
| --- | --- |
| tone-dissolve | B enters thin: lows at −18 dB, mids and highs at −12 dB. A's highs and mids recede. The bass ownership swap is equal-power on a smoothstep, 100–750 ms (default 380 ms), and ends 20 ms before the phrase downbeat. Overlap is 8, 16 or 32 bars. |
| bass-drop-handover | A's bass is killed on a bar line with a 12 ms ramp. A declared gap of 1, 2 or 4 bars follows with no bass. B's bass lands on the phrase downbeat (bar 4, or bar 8 for a 4-bar gap). With weak harmony the mids are thinned too. The highs carry the groove. |
| bass-swap-classic | B's bass is held near −24 dB, then swapped on a downbeat. |
| highs-first | B's hats first, then its mids; the bass swaps late (at ¾ of the overlap). |
| mid-carve | Only one song's mids are full at a time. Mids and bass swap together. |

**Selection** (`chooseChoreography`) uses the four-bar density at A's exit and B's entry, harmonic compatibility, BPM, the render budget and style:

- Weak harmony gives mid-carve, or a bass drop when the music is dense.
- Dense pairs or an energetic style give a bass drop.
- A sparse B gives tone-dissolve or highs-first.
- Same key at moderate density gives a classic swap.
- Otherwise, tone-dissolve.

Overlaps are shortened to fit the bounded render and check, and the reason is recorded.

## Seeded explore and plan records

- **Explore mode.** `player.setTransitionExplore(seed)` turns on bounded, reproducible variation (`explore-bounds@1`). It varies the choreography, overlap (8/16/32 bars), swap time (200–600 ms), gap (1/2/4 bars), entry (among the top 3) and meeting point. Harmony gating still applies. The seed advances after each scheduled handover.
- **Plan record.** Every set handover carries a versioned record, `em.transition-plan.v1`. It holds the mode, seed, policy/planner/analysis/choreography/safety versions, both song hashes, the exit and entry frames, the tempo band, recipe, choreography, why and the rejected candidates. Its id is an FNV-1a hash of the canonical content, so the same plan always has the same id. `replayOverrides` returns the fields needed to replay it.
- **Ratings.** The ratings log, `em.transition-ratings.v1`, stores love, like or dislike with a full copy of the exact plan. A rating whose plan id does not match its plan is refused. There is no learner (S23).

## Safety (`transition-safety@1`)

This is a separate verdict next to the frozen `mix-evaluation-thresholds@1`. It is applied to the rendered candidate in the set pre-check. Any flag rejects the candidate, and the next one is tried.

| Rule | Limit |
| --- | --- |
| Clipping | any rendered sample above full scale |
| True peak | above −1 dBTP (4× oversampled) |
| Low-band rise | low band (20–160 Hz) of the mix more than +3 dB over the louder native source, in every 50 ms cell across 250 ms |
| Bass hole | smooth recipes only: low band more than 15 dB under the interpolated A-to-B target across 250 ms, outside declared choreography gaps |

These limits are engineering rejection limits. They are not calibrated against listening.

## Manual Next and the safety net

Next uses the prepared plan, or a bounded fallback that is not a cut. The fallback is a **filtered echo reset**: A is high-passed (0 to 400 Hz) over the echo pre-roll, and its echo tail carries B in at B's own tempo. A crossfade is still used for close tempos. A clean cut happens only when no echo fits (for example, the pre-roll would start before the earliest audible frame) or when the owner chooses it.

There is one master output and one audio clock. The phone stream tap is unchanged.

## Studio readout

In set mode, Studio shows "Why this handover" under the planned mix:

- the recipe with its tempo gap and band;
- the EQ moves;
- where B enters (time, % into the song, candidate rank);
- the mode and plan id;
- the reasons, including the candidates that were rejected.

The same panel has an Explore checkbox with a seed, and Love/Like/Dislike buttons. Ratings are kept in this browser's storage (with try/catch) and can be exported as JSON.

## Known limits

- Listening, physical output, owner songs, real devices, macOS and Linux are NOT TESTED.
- `transition-safety@1` runs in the set pre-check only, not in the pair-mode `chooseEvaluatedMix`.
- Meet in the middle moves A's pitch, because it uses the native-rate path. A pitch-preserving A stretch is later work.
- Section/structure analysis, vocal and bass clash estimates and pairwise re-ranking belong to Part B.
