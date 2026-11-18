# S21 transition planner (Part A and Part B)

Slice: [EMF-S21](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) · Handoff: [EMF-S21-HANDOFF](handoffs/EMF-S21-HANDOFF.md)

**Source:** `web/transition-policy.ts` (policy, entry rule, explore, plan record, ratings), `web/eq-choreography.ts` (LR4 split, choreographies), `src/mix-planner.ts`, `src/mix-transition.ts`, `src/player.ts`, `web/mix-evaluator.ts` (`transition-safety@1`), `web/set-mode.ts` and `web/studio.ts` (readout). The two new modules live in `web/` because the unchanged loopback server only serves an allowlist of `dist/src` modules.

**Status:** Part A is merged into local `main` (recorded in the campaign at `9010f27`). Part B (trusted tempo grids and the dual tempo ramp) is built on a worker branch and is described in [Part B](#part-b-trusted-tempo-grids-and-the-dual-tempo-ramp); pairwise scoring, re-ranking and clash estimates are not started. **Listening NOT TESTED.** Everything below is plan data, unit tests and offline renders. None of it shows that a handover sounds good.

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

The same panel has an Explore checkbox with a seed, and Love/Like/OK/Dislike buttons with reason chips and a note, applied to the last completed handover (named in the panel). Ratings go to the PC file through the relay when it is running and are cached in this browser's storage (with try/catch); **Export** downloads JSON. See [Transition feedback and report](#transition-feedback-and-report).

## Known limits

- Listening, physical output, owner songs, real devices, macOS and Linux are NOT TESTED.
- `transition-safety@1` runs in the set pre-check only, not in the pair-mode `chooseEvaluatedMix`.
- Meet in the middle moves A's pitch, because it uses the native-rate path. A pitch-preserving A stretch is later work.
- Section/structure analysis, vocal and bass clash estimates and pairwise re-ranking belong to Part B.

## Review fixes (after the first Part A review)

- **Retry exclusion** is by parameterisation, not recipe family: recipe, exit bar, overlap bars and choreography (name and gap). One failing blend no longer removes every blend; the planner tries the other boundary and a safer choreography (Auto's, then an 8-bar mid-carve) before the next recipe. The bound stays 5 attempts per Next.
- A **clean cut reached only after a measured pre-check FAIL** is reported as a fallback (`fallbackAfterFailedPrecheck`, a line in the "why" list and the plan record's rejected list); its own PASS is not shown as a plain pass. The "Clean cut (last resort)" label is unchanged.
- **Bass-drop handover measurement** (thresholds@1 unchanged, synthetic fixtures, 120 to 120 and 120 to 124 BPM): beat phase error stays under 0.05 everywhere, so tempo drift is not the limit. The bass gap itself fails the loudness-interpolation, low build-up and boundary-flux limits (for example 3.5 to 4.5 LU loudness deviation at 120 to 120), while mid-carve warns. A 12-bar overlap is not a supported length (48 beats); the planner refuses it, and a 4-bar gap now rounds up to 16 bars (or a smaller gap if 16 bars exceeds the render budget). Auto now picks a bass drop only for dense (above 0.7) or energetic pairs, not for weak harmony alone; the pre-check still rejects a bass drop that fails.
- Explore never records a choice the planner refuses: an invalid draw falls back to Auto's choreography with a note.
- Route-free also tries up to two later bars (the echo pre-roll can leave the requested bar short) before a clean cut.
- A failed native parameter call in the deck mixer now also rolls back the echo parameter events, and releasing an echo plan clears them.
- Replanning a prepared mix keeps its choreography, meeting tempo and tempo return.
- Meet in the middle checks A's moved key (A's pitch rises or falls with its native rate; the nearest whole semitone is used). A residual detune above 0.4 semitone counts as a limited-harmony pair, which needs a mid-limited choreography.

## Transition feedback and report

Supersedes the older three-value log for new ratings (old browser ratings are migrated once and kept). Local only: nothing here is uploaded, committed or fed back to the planner.

- **Schema `em.transition-feedback.v1`** (`web/transition-feedback.ts`, vocabulary in `web/feedback-vocabulary.ts`): `version`, `planId`, `plan` (the unchanged `TransitionPlanRecord`; the id must match its content), `rating` (`love`, `like`, `ok`, `dislike`), `tags` (multi-select from 17: too-abrupt, too-long, too-short, clashing-beat, clashing-key, bass-clash, vocals-clash, boring, bad-entry-spot, wrong-energy, tempo-change-audible, volume-jump, layered-entry-too-thin, and the positives great-bass-handover, great-blend, great-surprise, great-layered-entry; the two layered tags were appended on 2026-11-16), `note` (text, at most 200 characters, control characters removed), `device` (`pc` or `phone`), `at` (ISO UTC time) and `measured` (pre-check status, a short reason and the number of failed checks it fell back from, or null). It holds song ids and SHA-256 hashes only: no audio, no absolute paths, no personal data. Unknown fields are refused, on write and on read.
- **Which transition.** A rating attaches to the **last completed** handover (`player.transition === 'complete'`), never the one being prepared. Studio and phone say which one. The phone sends the plan id it saw so a stale view is refused.
- **File.** `local/transition-ratings/ratings.jsonl`, written only by the phone relay (see [S17](S17_PHONE_LISTENING.md)); append-only, so a re-rating adds a line and readers use the latest line per plan. The `local/` folder is gitignored. Without the relay the Studio keeps the browser cache only and says so.
- **Report.** `npm run transitions:report` prints plain text and writes `local/transition-ratings/report.json`. It counts rated plans by rating, recipe, tempo-gap band, choreography, overlap bars, skipped-fraction bucket, fallback after a failed pre-check, explore vs auto, pre-check verdict and device; lists the most common complaint tags per recipe; and shows the best and worst plans with their parameters. Fewer than 20 rated plans in total, or 5 in a group, is labelled too small. No significance test is run and nothing is extrapolated. It is analysis only and does not change the planner (S23 is where learning would start, after listening).
- A phone rating is the owner's opinion of a lossy phone stream; judge mixing defects on the PC. Real phone use and listening are NOT TESTED.

## Not addressed (known gaps after review)

- The 64 ms direct-to-split crossfade at the start of a choreography is **not modelled by the evaluator**, so a short tonal change there is neither measured nor judged.
- The 6 s whole-song analysis deadline falls back to a start-of-song entry; no later phrase is considered in that case.
- `replayOverrides` has **no consumer** yet; recorded plans are not replayed anywhere.
- After a blend, Next may be unavailable for a long window (the outgoing deck is busy until the handover ends). This was **not measured**.

## Part B: trusted tempo grids and the dual tempo ramp

**Source:** `src/mix-analysis.ts` (`mix-analysis-v5`, `tempo-relation@1`, `requested-downbeat@1`, `gridAlignedAnalysis`), `src/time-pitch.ts` (ramp-in map, `composeRampInStart`, `outgoingStretchPeakLimit`), `web/transition-policy.ts` (`transition-policy@2`, `dual-ramp@1`), `src/mix-planner.ts`, `src/mix-transition.ts` (`prepareOutgoingStretch`), `src/player.ts`, `web/mix-evaluator.ts`, `web/mix-precheck*.ts` and `web/deck-readout.ts`. Tests: `tests/s21-partb.test.ts` and the Part B case in `tests/set-mode.test.ts`.

**Status:** built on a worker branch, not merged. **Listening NOT TESTED. Real phone NOT TESTED.** macOS and Linux NOT RUN. `mix-evaluation-thresholds@1` and `scripts/serve.ts` are unchanged.

### The bug it fixes

Turbo Storm (128 BPM) → Midnight Orbit (128 BPM) failed with `DJ plan check FAIL: beatPhase fail`. The analyser read Turbo Storm as 85.33 BPM. This is a 3:2 misread, caused by a strong dotted-quarter layer. The planner then built a grid from that misread, and the evaluator judged the blend against it.

### Analysis (`mix-analysis-v5`)

- **Ratio repair (`tempo-relation@1`).** Rival tempo readings at 1:2, 2:1, 2:3, 3:2, 3:4 and 4:3 (±1.5%) are compared. One reading replaces its rival only when all three of these hold:
  - it matches a reference tempo within 2%. The reference is the pack's requested generation tempo, when there is one;
  - it lands on at least 75% of grid beats;
  - it scores at least 75% of the top candidate.

  A resolved relation is recorded on `tempo.relation`, and the ambiguity becomes 0.35. Without a reference, or with weak support, nothing is forced. The ambiguity then stays above the 0.5 gate, so the rhythm recipes stay closed.
- **Requested-origin downbeat (`requested-downbeat@1`).** The requested bar origin is used only when all four of these hold:
  - the measured BPM is within 0.5% of the requested tempo;
  - the measured beats sit within a median of 0.2 beats of the requested grid;
  - their spread is at most 0.12 beats;
  - the audio downbeat is not already confident.

  The requested origin is then combined with the audio evidence (noisy-OR, weight 0.5). A half-beat origin is rejected.
- **Whole-song map.** The bounded windows (`song-window-merge@1`) each carry their own tempo, which gives a per-window before/after map.
- **One grid for both sides.** `gridAlignedAnalysis` rewrites an analysis onto the grid that the set chooser trusted, whether measured or requested. The pre-check evaluator judges against that same grid. If either grid is only *requested* (not measured), beat phase is reported **unjudged**, with the reason "requested grid (not measured)". The pre-check then reports `warn`, never `pass`.

### Before/after tempo on the owner songs

The songs were analysed in place and read only. Nothing was copied.

| Song | Before (v4) | After (v5) | Notes |
| --- | --- | --- | --- |
| Turbo Storm | 85.33 in most windows | 127.99–128.04 per window | tempo confidence 0.69–0.75, beat confidence 0.76–0.79, downbeat confidence 0.67–0.71 (requested origin) |
| Midnight Orbit | not recorded | 127.96–128.10 | downbeat confidence 0.57–0.75; tail windows borderline |
| Still Tide | 73.3 | 110.0 | 3:2 repaired |
| Hazy Harbor | 66.67 | 100.0 | 3:2 repaired; 99.27 and 99.40 in the 60 s and 72 s windows |
| Thunder Storm | 90 | 90 | requested origin rejected; the audio downbeat is honestly weak (confidence 0.08–0.44), so the rhythm recipes stay gated |

Results on the synthetic 3:2 trap (128 BPM with a dotted layer):

| Inputs | Result |
| --- | --- |
| No hint | 85.33 BPM with ambiguity 0.60, so it is not trusted |
| Requested tempo | 128 BPM, ambiguity 0.35, relation 3:2 |
| Requested tempo and origin | beat confidence 0.82–0.84, downbeat confidence 0.81–0.82 |

### Dual tempo ramp (`dual-ramp@1`, `transition-policy@2`)

- **Meeting tempo.** This is the geometric mean of the two tempos. It is clamped so that each deck stays within the WSOLA bounds of 0.92–1.08. There is no meeting tempo when the gap is below 0.5% (a blend already matches) or when no common tempo fits. Gaps up to about 17% are reachable.
- **Timing.**
  1. A starts a pitch-preserving stretch at the planned exit S.
  2. Over 4 of A's bars, A moves along a smoothstep to the meeting tempo.
  3. B enters at T = S + ramp frames, already at the meeting tempo. That is exactly 16 of A's native beats after S.
  4. After the overlap, B returns to its own tempo along a smoothstep. The return takes 4 bars, or 8 bars if B moved more than 5%.

  No pitch shift is left over, so the harmonic checks use the unshifted keys.
- **A's buffer.**
  - A's ramp is a bounded WSOLA render of A's own window, starting at S.
  - `composeRampInStart` replaces the processor's 5 ms edge fade with A's native samples, so the first sample equals native A.
  - The buffer is spliced at S with the existing 20 ms crossfade.
  - Its peak must stay within A's own sample peak × level gain × 1.12 (`outgoingStretchPeakLimit`). Otherwise the candidate is refused and the next one is tried.
- **Evaluator.** Beat phase maps A's beats through the ramp-in map and B's beats through B's stretch, then normalises by the shared beat period. On a 122 → 128 fixture, a dual-ramp plan is judged below the warn threshold over at least 8 beats.
- **Where it can be used:**
  - the Studio DJ Booth pair mode, through Auto and the recipe list entry "Dual tempo ramp (pitch kept)";
  - the set page, through Auto and Next;
  - phone Next, which uses the same set path.

### Candidate order

- **Pair Auto:** `dual-ramp, blend, echo-out, cut` when the gap is above 4%. Otherwise `blend, dual-ramp, echo-out, cut`.
- **Set chooser bands:**

  | Band | Order |
  | --- | --- |
  | normal | `blend, dual-ramp, …` |
  | stretched | `dual-ramp` first |
  | meet | `dual-ramp` first |
  | bridge | `dual-ramp` first when both decks fit within 8% |

- **Fallbacks between them.** An owner-chosen blend falls through to the dual ramp once the blend's variants are excluded. A dual ramp that does not fit falls back to a blend.
- **Rejected candidates.** A pre-check `fail`, or a failed render of A's tempo ramp, excludes that candidate and the next one is tried.
- **The clean cut** is last, and it is reported as a fallback.
- **An unjudged beat phase** is never a pass.

### Known limits (Part B)

- Ratio repair needs a reference tempo. With no requested tempo, a 3:2 misread is still detected as ambiguous and gated, but it is not corrected. A second analysis pass with a tempo prior was not built. The window consensus merge covered the owner songs that were measured.
- A pre-check that is `unavailable` (for example a window over 4M samples) aborted the transition. The song structure and cut avoidance section below changes this: an `unavailable` report now tries one more candidate per request (design review G11).
- Studio pair mode has no pre-check. Its dual ramp is planned and rendered, but not judged before it plays.
- The engineering values (`dual-ramp@1`, `tempo-relation@1`, `requested-downbeat@1`) are not calibrated by listening.
- Not tested: listening, the real phone, audio devices, macOS and Linux.

## Part B: song structure and cut avoidance (`mix-structure@1`)

This pass answers the live clean-cut report on `e54f3a2` and folds in findings G1–G5 and G11 of the transition engine design review (`docs/TRANSITION_ENGINE_DESIGN.md`, merged on main after this branch was cut). The thresholds `mix-evaluation-thresholds@1` and `transition-safety@1` keep their values; `MIX_EVALUATOR_VERSION` stays `transition-evaluator@1`.

### Whole-song structure (`web/mix-structure.ts`)

- `labelSongStructure` runs over the merged whole-song analysis (`song-window-merge@1`) in O(bars), with no audio pass. The result is cached on the merged analysis as `songStructure`.
- Sections start on four-bar phrases and last at least 8 bars (ends excepted). A boundary needs phrase novelty of at least 0.08. A song with less than 0.1 energy spread between sections gets no labels.
- Labels are `intro`, `build`, `drop` (meaning "drop or high-energy section"), `breakdown` and `outro`. They come from relative energy, position and the slope into the next section. A label under confidence 0.35 is withheld; the heuristic guess is kept for display only. The labels are **engineering heuristics, not musical judgement**.
- A's structure is read from the settled whole-song analysis when A was analysed as the previous B. Otherwise the bounded window around the exit gives a structure marked `partial`.
- **Deadline behaviour.** When B's whole-song analysis misses the 6 s deadline (`SET_SONG_ANALYSIS_DEADLINE_MS`), B has no structure. The route-free entry then falls back to the first downbeat of B's requested grid (the song start), as before.

How structure is used:

- **Pair scoring** (`structurePairTerm`): low-energy exits and section ends score higher, mid-build exits are penalised, entries at a section start get a bonus, and entering B in its outro is penalised (`entryOutro` 0.3). B's outro is never offered as an entry.
- **More exits (G5, partial).** The ends of A's outro and breakdown sections that lie strictly between the two requested boundaries are added as exit bars. The chooser does not wait past the second boundary; that is owner decision 2 in the design review.
- **Readouts.** The plan record carries a `structure` field (`HandoverStructure`). Studio's "Why this handover" and the phone handover card show one sentence, for example "leaves at the end of the breakdown (bar 33), enters B at its first drop (bar 17)". On the phone card it follows the existing "enters at m:ss" text.

### Tempo-agnostic styles before any cut

The route-free chain is now: crossfade (gaps up to 8%), echo reset, **filter dissolve**, **tone dissolve**, and only then the gated clean cut.

| Recipe | What it does | Judged as |
| --- | --- | --- |
| `fallback-filter-dissolve` | A high-passes 0 → 120 Hz by 40% → 400 Hz at the end while B enters with its low shelf at −9 dB until 40%, back to 0 dB by 80%. Needs no pre-roll. | `echo-out` |
| `fallback-tone-dissolve` | A crossfade where A's low-pass closes from open to 2 kHz at 50% and 300 Hz at the end, while B's high-pass opens from 300 Hz to 0 by 60%. | `echo-out` |
| `fallback-echo-reset` | Unchanged recipe. | `echo-out` |
| `fallback-cut` | Unchanged recipe. Allowed only when every other candidate failed. | `cut` |

- Each dissolve has two lengths. The first draft dipped 8–12 LU on synthetic songs; the softened curve above measured 3.9–5.1 LU.
- **The cut gate.** A cut is planned only after every other route-free candidate was planned and failed, or could not be planned. `rejected[]` names each candidate with its reason. `DjStatus`, "Why this handover" and the phone card name what was tried first (`triedFirst`).
- **Attempts.** `SET_CANDIDATE_ATTEMPTS` is now 10 (it was 5), so the longer chain can be exhausted.

### Recipe claims (`recipe-claims@1`, G1 and G2)

Each recipe is judged on what it promises. The evaluation records `claims: 'recipe-claims@1'`.

- **Beat lock.** `cut` and `echo-out` (and everything judged as them) make no beat-match claim. Beat phase judges only B's first beat after the entry, not B's second beat against A's grid. On 100 → 122.3 a cut was judged on 2 beats with error 0.182 (FAIL); it is now judged on 1 beat with error 0.000.
- **Loudness dip.** An `echo-out` deliberately dips under the straight A-to-B interpolation. The downward deviation is not judged by `@1`; it is logged in `unclaimed[]` with its value, so it stays visible. It is bounded by `RECIPE_CLAIM_LIMITS.echoMaxDipLu` = 6 LU: a deeper dip still fails. The upward deviation, silence gap, clicks, true peak, low build-up and the whole safety check are judged as before.
- No `@1` threshold value changed. Blends and the other beat-matched recipes are judged exactly as before.

### Per-parameter exclusion (`route-free-retry@1`, G3)

- A failed route-free candidate excludes `recipe:bBARS:atEXITFRAME`, not the whole recipe. The echo reset is retried at most once more, at a later bar (`ROUTE_FREE_RETRY.echoBars` = 2). A failed dissolve length is excluded at every bar. A bare recipe name still excludes the whole family; the cut stays bare.

### Soft recipes under a weak key (G4)

- Under a weak or distant key with no choreography, `filter-sweep`, `loudness-match`, `loop-extend` and `tempo-ramp` are now allowed when the overlap is at most 8 beats (`SHORT_STYLE_MAX_BEATS`). Longer overlaps still need a choreography.

### `unavailable` pre-checks (G11)

- An `unavailable` report (worker timeout, window too large) tries one more candidate per request, which may be shorter. A thrown gate error is not a candidate defect and still stops at once. Nothing unchecked is ever scheduled.

### Why the live +22.3% case cut (coordinator question d)

From code inspection and a synthetic 100 → 122.3 reproduction, before this pass:

1. **Filter sweep** was never a candidate: it is not in the bridge band's policy order, the ±8% stretch limit excludes it, and the G4 key gate also refused it.
2. **Analysed echo-out** was refused at planning. With A's analysis missing or weak the analysed path is skipped, or the rhythm-evidence gate in `alternatePlans` (G7) refuses it. On a requested grid the beat is not confident.
3. The one failed pre-check was the **route-free echo reset**: `@1` loudness FAIL on a 3.29 LU dip (limit 3 LU, G1). Beat phase was unjudged on the requested grid.
4. G3 then excluded the echo reset at every bar, so the cut came next.

After this pass, on the same reproduction, the echo reset passes its pre-check with the 3.29 LU dip logged in `unclaimed`; with it excluded, the filter dissolve and the tone dissolve plan and pass (dips 3.9–5.1 LU), and the cut is reached only after all of them are excluded.

### Owner songs: before and after

The nine songs of the local rated pack were analysed read-only in place, with nothing copied (tempos 128, 128, 90, 110, 100, 122, 122, 128, 128). A scratch script ran the set chooser and the pre-check evaluator (the same window and verdict logic as the browser pre-check) for all 72 ordered pairs, asking for a handover at bar 16 (bar 13 for the 27-bar song) with a 4-bar boundary. Beat-matched and stretched plans need a render and were not simulated; they are counted separately.

| Outcome (72 pairs) | Before (`e54f3a2`) | After |
| --- | --- | --- |
| Clean cut | 15 | **0** |
| Refused ("No future bar…") | 6 | **0** |
| Crossfade | 23 | 23 |
| Echo reset | 24 | 13 |
| Filter dissolve | — | 32 |
| Beat-matched or stretched (not simulated) | 4 | 4 |

- Before, every cut followed one failed echo reset (loudness, sometimes with a true-peak safety fail). All six refusals were into faster songs, where the cut itself failed beat phase (G2).
- After, the filter dissolve was the most common result. One song's pairs went through the whole chain (the crossfade and every dissolve length failing `@1` loudness) before the echo reset passed one bar later. No pair needed the cut.
- Structure found sections in all nine songs. Seven have a labelled drop by bar 26; three have outros and three have breakdowns. Some labels are doubtful: two songs show an `intro` label in a quiet section after an unlabelled one, and one labels its first 33 bars as three intros. These are heuristic artefacts, not verified song sections.
- Entries moved from requested-grid bars to section starts. For example, the 110 BPM song into the 128 BPM songs now enters at B's first drop (bar 25 or 26); before, those pairs were refused, cut, or entered at bar 10.
- Exits stayed at bars 17–18. None of these songs has an outro or breakdown end between bars 16 and 24, so the extra structural exits did not apply.

### Tests (this pass)

- New `tests/s21-structure.test.ts` (12 tests): labelling and determinism, flat and short songs, pair scoring, the quiet-exit bar, the full +22% chain down to the cut with `rejected[]`, per-parameter exclusion, the cut gate, recipe claims and the 100 → 122.3 beat phase, readout text, the dissolve pre-check window, the declared dip bound, and the +22.3% echo reset passing with its dip logged.
- Updated expectations:
  - `tests/mix-precheck-player.test.ts`: an `unavailable` report now makes 2 gate calls; the clean-cut test fails every non-cut recipe and checks that the dissolves were tried first.
  - `tests/s21-transition.test.ts` and `tests/set-mode.test.ts`: the filter dissolve comes after the echo reset (or first, when the echo reset has no room for its pre-roll), and the cut only once the dissolves are excluded. The recipe allow-lists include both dissolves.
  - `scripts/set-browser-check.ts`: the phone card's entry text may carry the structure sentence after "enters at m:ss".
  - `scripts/mix-precheck-browser-check.ts`: the Studio Next attempt bound is `SET_CANDIDATE_ATTEMPTS` (10) instead of a literal 5, and an injected unavailable worker is checked twice instead of once. In the injected level-mismatch case, 7 candidates fail before the cut passes.

### Known limits (this pass)

- The section labels are heuristics. They were not checked against a listener's markup, and some are doubtful.
- The 6 LU dip bound and the dissolve curves are engineering values, not calibrated by listening. Nothing here was heard.
- The brake and loop extend have no route-free form. G6 (first acceptable, not best), G7 (rhythm evidence on both songs), G8 (tempo ramp ranges), G9, G10, G12–G14 are unchanged.
- No exit waits beyond the second requested boundary (owner decision 2). Superseded on 2026-11-16 by decision D below: up to 8 bars for the end of a quiet A section.
- Thresholds `@2` were not needed: the recipe claims leave every `@1` value unchanged.
- Windows only. macOS and Linux were not run. The real phone and audio devices were not tested.

## Song dossier store (engine increment 2)

Songs are analysed before play and the results are kept. This is engineering only; nothing here is listening evidence.

- **Schema `em.song-dossier.v1`** (`web/song-dossier.ts`): a validated, capped record of numbers and hashes (tempo, beat/downbeat grid, key, sections, cues, loudness, quality flags, versions, analysis cost). No audio, path, title or personal text. Keyed by audio sha256 + analysis version (`song-dossier@1+mix-analysis-v5+mix-structure@1`) + requested-tempo/downbeat hint. Strict on write and on read.
- **PC store**: relay `GET /api/dj/dossiers`, `GET /api/dj/dossiers/<id>`, `POST /api/dj/dossier` (token, origin and loopback guarded) write atomically to git-ignored `local/song-dossiers/` (`scripts/song-dossier-file.ts`: no symlink following, no paths in errors, caps 96 KiB per dossier, 512 files, 32 MiB). It survives throwaway browser profiles such as `npm run phone:host`.
- **Browser** (`web/song-dossier-store.ts`, `web/studio-dossiers.ts`): memory, then IndexedDB, then relay. A scheduler analyses missing or stale songs one at a time (now playing, next, queue, rest), pauses during a handover or pending Next, backs off after failures, and re-analyses when the analysis version changes. The page shows "Analysed 7/9 · next ready" and the phone card carries it in `DjStatus.analysis`. `?dossiers=off` disables it (the older lazy-load browser checks use it).
- **Limits**: a dossier cannot rebuild the planner's full `MixAnalysis`; "next ready" means a current dossier exists and the planner's analysis cache is warm, and the planner's 6 s deadline fallback is unchanged. Importers do not write dossiers yet. No Node CLI. Real phone, macOS/Linux and listening are NOT TESTED.

## Owner decisions 2026-11-16: layered entries, no automatic cut, 15% stretch and the explore menu

The owner decided four things on 2026-11-16:
- (A) There are no automatic instantaneous cuts. Layered, band-wise entries are used instead.
- (B) The pitch-preserving stretch limit rises from 8% to 15%.
- (C) Thresholds `@2` only if they are genuinely needed. Safety is never weakened.
- (D) Next may wait up to 8 bars for a better exit.

A later clarification added two points. Plain crossfades, the echo reset, the dissolves, the bass handover and the dual ramp all stay valid. While the owner rates transitions, the DJ should produce a varied, seeded random mix of styles.

### Layered entries (`layered-entry@1`, `web/layered-entry.ts`)

- **Styles.** Four styles run on the LR4 3-band split (160 Hz / 3.5 kHz):
  - `bass-first`: B's bass first, under A.
  - `mid-first`: B's vocal and lead band first.
  - `high-first`: B's hats and air first.
  - `drums-first`: B's mids and highs together, then its bass.
- **Lengths.** An entry lasts 2, 4 or 8 of A's bars. Gaps up to 8% use 8 bars; larger gaps use 4. Two bars is the last rung only.
- **Band crossings.** B's lead bands cross first, on equal-power curves (smoothstep, 8 steps), and A's matching bands leave in the same windows. A also closes a low-pass over the last 40% of the entry, and its fader closes over the last 10%.
- **Echo tail.** `bass-first` and `mid-first` entries of 4 bars or more leave A on an echo tail: half-beat repeats, 0.2 send, 0.3 feedback, low-passed at 2.5 kHz. Those are the styles where A's highs leave last, so an echo of A's bass never sits on B's.
- **Tempo.** B plays native. Beats are not aligned, and no beat alignment is claimed.
- **Lane rules.** These are checked from the plan itself, before any audio:
  - Masking: the two songs' low bands are never both above −3 dB.
  - Continuity: the low-band power sum stays at or above −3.5 dB until B's bass has fully arrived.
  - Order: B's lead bands reach half level before any other B band passes 0.1.
- **Plan record.** `entryStyle` is an optional, first-class field: `{style, source, bars, echoTail, lastRung}`. EQ choreographies are also mapped to a style (source `eq-choreography@1`).
- **Where the style appears:**
  - the plan record;
  - the route-free signature (`fallback-layered-entry/<style>:b<bars>:at<frame>`), so `rejected[]` names the style;
  - `describeSetMix` and `DjStatus` (label and plain sentence);
  - "Why this handover";
  - the phone card wrapper in `web/studio.ts`. The phone relay itself is unchanged.
- **Style by section.**

  | Situation | Lead style |
  | --- | --- |
  | B enters at a drop | high-first |
  | A leaves a breakdown or outro | bass-first |
  | B enters at its intro | drums-first |
  | B enters at a build | mid-first |
  | A leaves a drop | high-first |
  | No rule applies | default order, highs first |

  A section-led entry is tried once per request, before the echo reset. The deterministic path therefore never spends its candidate budget on layered entries before the echo reset and dissolves have had a turn.

### No automatic cut (decision A)

- **Policy.** `transition-policy@3` drops `cut` from every band. Each list ends in the route-free chain.
- **Route-free ladder.** The order is:
  1. crossfade (gaps up to 8%; B native);
  2. one section-led layered entry;
  3. echo reset;
  4. filter dissolve and tone dissolve;
  5. layered entries in every style, one length each;
  6. the last rung: the 2-bar layered entry. It is still pre-checked, and only its exact signature excludes it.

  The chooser walks the exit bars in two passes. The first pass covers steps 1–4 at every bar, which keeps the echo reset's retry one bar later inside the attempt budget. The second pass covers steps 5–6.
- **The player.** The tenth attempt (`SET_CANDIDATE_ATTEMPTS`) plans only the last rung. If ordinary candidates run out sooner, the last rung is tried before giving up. A last rung reached after failed checks is flagged like the old cut fallback (`fallbackAfterFailedPrecheck`, "Shortest layered entry (last rung) reached after N failed pre-checks").
- **The cut gate is removed.** A 10 ms clean cut is planned only when the owner selected `cut` on a manual path that already offered it. That cut is then planned first.
- **Covered paths.** Set Auto, set Next, Studio pair Auto (`automaticMixCandidates` now ends in `layered-entry` instead of `cut`) and phone Next (it uses the set path).
- **The 8-bar wait (decision D).** The end of a quiet A section (breakdown or outro) is used if it falls within 8 bars after the requested exit. Before this change, the wait stopped at the second requested boundary.

### Recipe claims `recipe-claims@2`

- **What the claim says.** `layered-entry` claims no beat lock, a loudness dip bounded at 4 LU (tighter than the echo's 6 LU, because band hand-overs keep the power sum), and `layered: true`.
- **What is judged.**
  - Per-band behaviour. In the lead phase, B's lead bands must measure at least 6 dB above its other bands, relative to B native.
  - A low-band masking proxy. The highest 500 ms `min(A low, B low)`, each relative to its own native level, must stay at or below −1.5 dB.
  - The lane rules above.
  - Loudness continuity (the envelope of the two songs). Per 400 ms window (100 ms hop, K-weighted):
    - a rise of the mix over the LOUDER native song fails above the `thresholds@1` value (3 LU);
    - a drop of the mix below the QUIETER native song (only the audible song when the other is silent) fails beyond the declared 4 LU.
    - The rise and dip against the straight-line A-to-B energy interpolation are logged in `unclaimed[]` only.
    - Why: when the songs differ a lot in level, B's bands arriving early is what the recipe does. The interpolation rule failed every layered entry on such pairs: rises when A is quiet, dips of 8–20 LU when B is quiet.
    - On one owner-song pair the interpolation rule failed every smooth candidate, so the old ladder could pass only with the cut.
    - Being louder than both songs, or a hole below both, still fails. The rule is a claim of this recipe only: every other recipe keeps the interpolation rule.
    - This is a judgement call for review. No threshold value changed. A transition into a much quieter song now reaches B's level within the entry rather than along a straight line; nothing here was heard.
- **What is not judged.** Beat phase is not judged, because alignment is not claimed.
- **Missing evidence fails.** A layered spec without layered measurements never passes.
- **Unchanged.** Every `thresholds@1` value and `transition-safety@1` are unchanged, so thresholds `@2` were not needed (decision C). `routeFreeJudgedAs('fallback-layered-entry')` is `layered-entry`.

### 15% stretch (decision B, `transition-policy@3`)

- **Limits.** WSOLA (`eutonos-wsola@1`) and `MIX_LIMITS` now accept tempo ratios from 0.85 to 1.15. The dual ramp's reach grows to about 35.3% (1.15² − 1).
- **Bands.** Band edges belong to the lower band.

  | Gap | Band | Auto order |
  | --- | --- | --- |
  | 0–4% | normal | blend, dual ramp, loudness match, filter sweep, loop extend, echo out, echo reset |
  | 4–15% | stretched | dual ramp, blend, filter sweep, loop extend, echo out, echo reset |
  | 15–32.25% | meet (both decks within 15%) | dual ramp, meet in the middle, echo out, tempo ramp, echo reset |
  | 32.25–40% | bridge | dual ramp if it reaches, echo out, tempo ramp, brake, echo reset |
  | above 40% | reset | brake, echo out, echo reset |

  The route-free chain, ending in the last rung, follows every list. The plain crossfade keeps its own 8% limit, because B is not stretched there.
- **Artefact measurements.** Offline engineering measurements on synthetic signals at 44.1 kHz (sines at 110, 220 and 880 Hz, a four-note chord, a 120 BPM noise-click train):
  - Pitch held within 1 cent at every ratio.
  - Every click came through once: no doubled or lost onsets, and onset width unchanged at about 7 ms.
  - The sample-jump metric was unchanged (0.0125).
  - WSOLA's local offset peaked at its 10 ms search bound at every ratio.
  - The sine residual after a per-block sinusoid fit (a THD+N proxy) was between −34 and −65 dB at every ratio from 0.85 to 1.15. It was worst at 880 Hz (−34 to −43 dB), against −152 dB unstretched.
  - 10–15% showed no measurable step up from 8% on these proxies. The splice residual exists at any stretch, and at 880 Hz it is large enough that it may be audible.
  - Not measured: phasiness on dense polyphonic material, transient smearing on real drums, and listening. Listening is NOT TESTED.

### Explore menu (`explore-menu@1`), default for set Auto and Next

- **The draw.** In explore mode, every candidate that plans at this request goes on a menu: each beat-matched recipe the policy allows, crossfade, echo reset, both dissolves, and each layered style. One seeded, weighted draw picks among them.
  - Floor weights: every candidate keeps at least half of an even share. Base weights are equal, because there is no learned preference yet.
- **Rejection sampling.** A pick that fails its pre-check is excluded, and the next draw (the attempt number feeds the seed) picks among the rest. The style finally scheduled is therefore a weighted random pick among the candidates that pass.
- **Draw limit.** At most 5 draws per handover (`maxDraws`). After 5 failed draws, the deterministic ladder takes the remaining attempts: other exit bars, the echo reset's later retry, then the last rung. It uses the section style order, not the seeded one, and the section-led layered entry is still tried once unless that style already failed. Without the limit, two owner-song pairs that the deterministic path schedules were refused in explore runs, because the draws spent the whole attempt budget at one exit bar.
- **Late pass (changed rule, for review).** Explore draws often plan the earliest bar with a longer recipe, so their pre-check takes longer. On a short lead, the PASS can arrive after the plan's audio-clock deadline.
  - Before: the whole Next request was refused ("Request Next again").
  - Now: that exact parameterisation is excluded, recorded in `rejected[]`, and a later bar is chosen and pre-checked again. Nothing unchecked is ever scheduled, and the attempt budget still applies.
  - The Windows deck gate found this with seed `1763426704` (1 of 20 seeds tried on its 174 BPM, 20-bar fixture). The set gate hit it once with a fresh seed.
  - The deck gate now pins that seed, so it exercises the re-choose.
- **Determinism.** The result is deterministic per seed.
- **Plan record.** `menu` is optional: `{policy, seed, attempt, chosen, alternatives[{key, weight}]}`. `alternatives` are planned candidates, not pre-checked ones; failed draws are in `rejected[]`. "Why this handover" names the draw and the menu.
- **Where it is the default.** On Studio's set page, the Explore checkbox is now checked by default, and the seed field takes a fresh seed on each page load. Set Auto and Next therefore explore unless the owner unticks it. The seed is shown, so a given transition can be replayed. The player API and scripts still default to deterministic Auto, so the tests and the owner-song run stay reproducible.
- **What explore never does.** It never plans a cut, and the last rung still comes last.

### Record compatibility and feedback

- `entryStyle` and `menu` are optional. The record id is FNV-1a of the canonical body, and that body drops undefined fields, so records without these fields keep their ids. Existing ratings stay attached.
- The feedback vocabulary appends two tags, `layered-entry-too-thin` and the positive `great-layered-entry`, for 17 in total. Older feedback stays valid.
- `npm run transitions:report` groups by entry style and by explore menu.

### Owner songs: 72 pairs after these decisions

These results come from one offline harness. It ran on the owner's 9-song pack on Windows: 72 ordered pairs, a Next request at bar 16 (bar 13 for the shortest song), and the real set chooser, renders and pre-check with up to 10 attempts. It printed aggregates only. Both songs use their requested grids, so this harness plans no beat-matched recipe; the earlier tables in this document, which measured analysed grids, show 4. The baseline is `bffba00`, run through the same harness.

| Run | Crossfade | Filter dissolve | Tone dissolve | Echo reset | Layered entry | Cut | Refused |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Before (`bffba00`, deterministic) | 25 | 25 | 0 | 20 | — | 1 | 1 |
| After, deterministic | 25 | 20 | 0 | 13 | 13 | 0 | 1 |
| After, explore seed base 1 | 5 | 21 | 19 | 6 | 20 | 0 | 1 |
| After, explore seed base 2 | 8 | 19 | 14 | 12 | 18 | 0 | 1 |
| After, explore seed base 3 | 6 | 19 | 15 | 14 | 17 | 0 | 1 |

- **Zero cuts.** No run planned a cut, and no candidate tried was a cut. The baseline scheduled 1 cut, on a 122→128 pair; it now gets a drums-first 8-bar layered entry.
- **One refusal, the same pair as the baseline** (122→110). Every candidate failed the unchanged evaluator, and every layered entry failed the frozen `transition-safety@1` true-peak ceiling (−0.21 to +0.71 dBTP, with clipping on two). Safety was not weakened, so this pair is still refused. A headroom trim on layered entries is a possible later change; it was not made here.
- **Layered entries by style:**

  | Run | bass-first | mid-first | high-first | drums-first | Last rung (2 bars) |
  | --- | --- | --- | --- | --- | --- |
  | Deterministic | 0 | 0 | 8 | 5 | 0 |
  | Explore 1 | 6 | 5 | 5 | 4 | 3 |
  | Explore 2 | 6 | 6 | 4 | 2 | 3 |
  | Explore 3 | 2 | 2 | 6 | 7 | 2 |

  The deterministic path uses only the section-led styles. Explore spreads across all four styles and all three lengths.
- **The tone dissolve** is never the deterministic choice on these pairs, because the filter dissolve passes first. Explore schedules it on 14–22 pairs.
- **Attempts.** On the deterministic run, 35 pairs passed on the first attempt, and none needed more than 8.

### Tests (this pass)

- New `tests/layered-entry.test.ts` (8 tests):
  - lanes for every style and length, the masking break, and the echo-tail rule;
  - style by section and explore determinism;
  - `recipe-claims@2` pass and fail cases, including missing evidence and both sides of the continuity envelope;
  - explore-menu determinism, floor weights and coverage;
  - chooser explore (varied, with the menu recorded and the next draw after a FAIL);
  - record id compatibility;
  - the no-cut ladder and owner cut;
  - the 15% limits.
- Changed expectations (each test carries a comment):
  - `tempo-gap table` (s21-transition): no `cut`, new band edges, and 120→132 and 120→144 move to `stretched` and `meet` with the dual ramp first.
  - Safety-net tests (s21-transition, set-mode): a layered entry where the cut was; `unavailable` without layered entries; a cut only with `allowCut`.
  - `+22% chain` (s21-structure): it now ends at the 2-bar last rung after exactly 10 attempts: the section-led layered entry, the echo reset (twice, at two bars), 2 filter, 2 tone, then general layered entries.
  - `the cut gate` was replaced by `no automatic cut`: a layered entry at the end of a quiet A section 8 bars later, and a cut only for the owner.
  - The `+22.3%` echo-reset test excludes the section-led layered entry, so it still judges the echo reset.
  - `mix-precheck-player`: the fallback after failed pre-checks is the last rung, never a cut.
  - `mix-recipes`: Auto candidates end in `layered-entry`.
  - `s21-partb`: the dual ramp reaches about 35%.
  - `time-pitch`: the bounds are 0.85 and 1.15.
  - `transition-feedback`: 17 tags, plus the new report groups.
  - `set-browser-check`: explore is on by default.
  - `mix-precheck-player`: a PASS after its audio deadline now re-chooses a later bar and pre-checks it again. It used to refuse.
  - `deck-browser-check`: pins explore seed `1763426704`, which exercises the late-pass re-choose (see "Late pass").

### Known limits (this pass)

- Nothing here was heard. The band windows, the 6 dB lead margin, the −1.5 dB masking proxy and the 4 LU dip are engineering values, not calibrated by listening.
- Layered entries do not align beats. Over 8 bars, two native grids drift apart when the tempi differ, so gaps above 8% use 4 bars.
- The explore menu's alternatives are planned, not pre-checked, so a listed alternative may have failed had it been drawn.
- Windows only. macOS and Linux were not run. The real phone and audio devices were not tested.

## Pair search (engine increment 3)

This section covers increment 3 of the [transition engine design](TRANSITION_ENGINE_DESIGN.md#9-staged-implementation-plan), "Pair search". It is engineering only: nothing here was heard, and nothing here claims a handover sounds good. It was built and checked on Windows only.

**What it does.** While song A plays and song B is next in the queue, a background search does five things:
1. lists every plausible handover between A and B;
2. scores each one from the two song dossiers;
3. renders the best few of each exit slot offline;
4. runs the existing pre-check (`live-mix-precheck@1`) on each render;
5. keeps the prepared audio of the best one or two in the nearest slots.

When Next is pressed after the search, the handover is scheduled from that table. Nothing new is rendered or checked at that point.

The search is **off by default**, both in the player API and on the Studio set page. Turn it on with `?pairsearch=shadow|live` or with the "Pair search" select in "Why this handover". In shadow mode the existing path still schedules, and the search's would-be choice is logged beside it.

### Parts and versions

| Part | File | Version | Role |
| --- | --- | --- | --- |
| Candidate generator | `web/engine-candidates.ts` | `engine-candidates@1` | Every exit and entry, each recipe family, hard pruning; outputs `CandidateSpec` (design 2.4) |
| Stage-1 model | `web/engine-model.ts` | `engine-model@1` | Score from the two dossiers only; unsupported terms marked absent |
| Anytime search | `web/engine-search.ts` | `pair-search@1` | Top-K render-and-check per slot, nearest slot first; `PairPlanTable` |
| Ladder | `web/engine-ladder.ts` | `engine-ladder@1` | L0 and L1 picks; rung names |
| Record and journal | `web/engine-journal.ts` | `pair-search@1` | Optional `engine` field on `em.transition-plan.v1`; in-memory decision journal |
| Exact-candidate planning | `src/mix-transition.ts` | (chooser input `candidate`) | Builds exactly one candidate through the existing planners, or refuses |
| Inline pre-check | `web/mix-precheck-inline.ts` | `live-mix-precheck@1` | The Worker's window, evaluator, validation and status rules on one thread, for Node tests and timing only |

### Candidate generator (`engine-candidates@1`)

**Exits.** These are taken from the earliest feasible bar of A onwards, capped at 160:
- every phrase boundary (each 4th bar);
- every section end;
- every exit-cue bar.

**Entries.** These are B's first downbeat, its labelled section starts and its entry cues. They are ranked by cue score minus the skip cost (how much of B is skipped). The top 4 are kept, and the earliest entry is always one of them.

**Families per exit:**
- **Analyzed (beat-matched) policy recipes** (blend, bass swap, tempo ramp and the rest): only on cue or section-end exits. The analyzed planner chooses the entry.
- **Per entry:** the crossfade at its gap-rule lengths, the echo reset, the filter and tone dissolves, and the four layered-entry styles at 8 or 4 bars. Each layered style also gets its 2-bar last rung.
- **A cut:** only when the owner chose one.

**Pruning, before any audio:**
- stretch above 15%;
- beat-locked recipes without trusted grids on both songs;
- not enough audio for the overlap;
- no room for the echo pre-roll.

**Candidate keys** take the form `recipe|x<exitBar>|e<entryBar>|b<bars>[|last]`, and the id is an FNV hash of the key.

### Stage-1 model (`engine-model@1`)

The model reads the two dossiers only: tempo, grid confidence, global key, sections (energy, low share and vocal share per section) and cues. Its terms are:
- **structure:** whether the exit is a section end or cue, and the entry a section start;
- **energy, low-band clash and lead overlap:** section proxies;
- **harmonic:** the global key only;
- **tempo strain;**
- **grid trust;**
- **skip cost;**
- **variety** against the previous handover's family;
- **a small family base.**

These terms are **absent** and recorded as such in every score (`absent`):
- per-bar loudness;
- lowShare and kick onsets;
- lead presence;
- local chroma;
- the learned prior (always 0; there is no learner yet).

Section proxies stand in where the design wanted bar-level data. No value is invented. When a pair lacks sections or a confident key, that term is listed in `missing`.

### Anytime search (`pair-search@1`)

**Order of work:**
- Candidates are grouped into slots by exit bar and ranked by model score. Cuts always rank last.
- Slots are worked nearest first. Slots already behind the clock are skipped.
- In each slot the best unrendered candidate is checked: non-cut first, a cut only when no non-cut is left.

**Each check:**
- builds exactly that candidate through the existing planners (the chooser's new `candidate` input);
- renders it as Next would (incoming stretch, loop buffer);
- re-checks the deadline and the audio;
- runs the injected pre-check runtime: the real Worker in the browser, or `inlineMixPrecheck` or a fake in Node.

**Scoring.** A PASS or WARN sets the final score: the model score, minus 0.2 for a WARN, minus 0.05 per evaluator flag. Passing is a floor, not the ranking. A planner refusal makes no render and does not use up an attempt.

**Stopping.** A slot stops after K = 3 checked plans or 8 attempts. A candidate more than 0.6 below the slot's best checked final score is not rendered. The whole search stops at 180 s.

**Kept audio:**
- the best 2 of the nearest 4 future slots;
- at most 4 heavy (rendered) buffers in all;
- route-free plans on the native B are light and always kept.

**Cut rule.** `bestIn` never returns a cut while the budget remains and the slot still has an unrendered non-cut candidate. L1 never offers a cut.

**Cancellation:**
- **Pair change:** a new next song or a new playing voice cancels the search, drops its kept audio and starts again (`preparePair`, idempotent for the same pair). The Studio calls `preparePair` with the queue head on every render tick.
- **Next:** Next halts the search but keeps its table and kept audio for the decision.
- **Playback stopped or changed:** this cancels the search.

**Audio path.** Heavy work stays off the audio path. Renders use the existing time-stretch runtime, and checks use the pre-check Worker. The search yields between steps, and nothing is scheduled until Next.

### Ladder L0–L4 under the no-cut rule

| Rung | Meaning | Where |
| --- | --- | --- |
| L0 | Best checked plan from the table inside the window (first boundary .. +8 bars), whose kept audio still fits the clock | Live mode, at Next |
| L1 | Best modelled (unchecked, non-cut) candidate in the window, checked once now | Live mode, when L0 has nothing usable |
| L2 | The existing pre-checked policy ladder (safe dissolves and the other passing styles) | All modes |
| L3 | The ladder's last rung, the shortest layered entry | All modes |
| L4 | A clean cut, only when the owner selected `cut` | All modes |

There is no automatic plain-cut rung. With explore on, L0 makes a seeded draw (`explore-menu@1`) among the best checked plan of each family, with each layered style counted separately, and records it as `menu`. When the owner chose a recipe or choreography, the engine is skipped and the existing path runs.

The rung is recorded in three places:
- in the plan record, as `engine.rung` with the badge (`checked` for L0/L1, `fallback` otherwise), the table counts and timing, the chosen candidate's model terms, up to 3 alternatives, and `unsure` notes;
- in "Why this handover", as a line such as "Ladder (engine-ladder@1): L0 checked plan from the pair search";
- in the mix reason ("Pair search L0: …"), which feeds the `DjStatus` detail.

In shadow mode a further "Why" line says what the search would have chosen.

### Measured render-and-check time (this Windows PC)

How it was measured (2026-11-17, Windows 11):
- **Setup.** Node ran the real player with live pair search over three consecutive pairs of the owner's rated set (44.1 kHz stereo, about 180 s per song).
- **Path.** It used the real analysis, planner and render runtime, plus `inlineMixPrecheck`: the Worker's exact rules, run on one thread.
- **Output.** Only aggregate numbers were recorded. No title, id or audio leaves the PC, and nothing is committed. The script was a scratchpad file, not part of the repo.

| Pair | Generated | Slots | Rendered | Checked (PASS/WARN) | Search | Median per render+check | End state |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2153 | 35 | 50 | 44 (33/11) | 182 s | 2.6 s | budget |
| 2 | 498 | 37 | 93 | 66 (0/66) | 183 s | 1.8 s | budget |
| 3 | 812 | 16 | 59 | 48 (0/48) | 118 s | 1.7 s | complete |

**All 206 timed candidates together:**
- render+check: median 1.9 s, p90 4.3 s, max 6.9 s;
- render alone: median 0 ms, max 3 ms;
- the rest is the pre-check.

**Why the render time is near zero.** Every candidate rendered inside these windows was route-free on the native B: crossfades, dissolves, echo resets and layered entries. Analyzed, stretched candidates ranked lower and were not reached. Their render time on owner audio is therefore NOT MEASURED here.

**Synthetic browser figure.** For comparison, the Chromium gate's real Worker measured a median of 1.2 s per check on 16 kHz mono synthetic songs.

**K = 3 is confirmed, not changed.**
- At the median, a 60 s lead fits about 30 checks.
- With K = 3 that covers the nearest ~10 slots, more than the 8-bar Next window. K = 5 would cover about 6.
- Pairs 1 and 2 hit the 180 s budget with most slots still only modelled. Far slots stay at L1 or L2, which is the intended anytime behaviour.

These are engineering timings. They are not listening evidence, and the Worker in a busy browser tab may be slower.

### Record compatibility

`engine` is optional and validated by shape (`isEngineRecord`). Records without it keep their ids, because the canonical form drops undefined fields. The record stays under the feedback store's 12,000-character plan limit; a test checks this. The decision journal is in memory only (bounded to 50) and is not the relay journal file. The design's "journal v2" file format is not built.

### Tests (this pass)

New `tests/pair-search.test.ts` has 10 tests.

**Search units, with a fake check:**
- K per slot, nearest slot first, and one timing per render-and-check;
- the cut rule;
- budget stop with a best-so-far answer and the WARN penalty;
- cancel and halt, with refusals not counted as renders;
- the kept-buffer cap;
- the bounded journal and engine record validation.

**Player, with original synthetic 128 s songs, the real analysis, planner and render path, and an injected PASS pre-check:**
- Off is the default, and the record names the rung (L2 or L3).
- **Live with more than 60 s of lead:** the nearest slots hold checked plans, every phrase bar has a slot, absent model terms are recorded, and timing is recorded. Next then schedules at L0 with no new render and no new pre-check, and Why, the mix reason and the journal name L0.
- Changing the next song cancels and restarts; in shadow mode the would-be choice is recorded.
- Next before a table exists cancels the search and uses the policy ladder, saying why.

New browser gate `scripts/pair-search-browser-check.ts`, part of `check:browser`, runs on the real Studio page with the real pre-check Worker:
- Off is the default.
- `?pairsearch=live` finishes a search while A plays.
- Next shows L0 in "Why this handover".

One existing gate changed, with comments in the file: `mix-precheck-browser-check`, level-mismatch case. The first full `check:browser` run failed there, and it failed 2 of 3 times when rerun alone, with pair search off (that code path is unchanged). The cause is the fresh explore seed the Studio draws on each load: the first draw is sometimes a passing style, not the expected loudness FAIL. The case now turns explore off. On the deterministic ladder the case then runs 8 or more checks, and the S21 late-pass re-choose lets a late WARN move on. The "only a FAIL moves on" assertion now also accepts a late PASS/WARN after a FAIL. It passed 3 of 3 runs afterwards.

### Known limits (this pass)

- Nothing here was heard. The model weights, K, the far-below margin and the keep limits are engineering values, not calibrated by listening or ratings.
- The model is section-level. Bar-level loudness, low-band and lead terms wait for increment 4.
- Shadow and live use whole-song analyses for the table. The existing L2 path still uses its windowed analysis.
- Analyzed recipes are generated only on cue or section-end exits, with the planner choosing the entry, so not every exit × entry pair is tried for beat-matched recipes.
- Kept heavy renders cost memory; at most 4 are kept. Browser memory was not measured.
- Windows only. macOS and Linux were not run. The real phone and audio devices were not tested. Listening is NOT TESTED.
