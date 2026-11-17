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

- **Schema `em.transition-feedback.v1`** (`web/transition-feedback.ts`, vocabulary in `web/feedback-vocabulary.ts`): `version`, `planId`, `plan` (the unchanged `TransitionPlanRecord`; the id must match its content), `rating` (`love`, `like`, `ok`, `dislike`), `tags` (multi-select from 15: too-abrupt, too-long, too-short, clashing-beat, clashing-key, bass-clash, vocals-clash, boring, bad-entry-spot, wrong-energy, tempo-change-audible, volume-jump, and the positives great-bass-handover, great-blend, great-surprise), `note` (text, at most 200 characters, control characters removed), `device` (`pc` or `phone`), `at` (ISO UTC time) and `measured` (pre-check status, a short reason and the number of failed checks it fell back from, or null). It holds song ids and SHA-256 hashes only: no audio, no absolute paths, no personal data. Unknown fields are refused, on write and on read.
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
- No exit waits beyond the second requested boundary (owner decision 2).
- Thresholds `@2` were not needed: the recipe claims leave every `@1` value unchanged.
- Windows only. macOS and Linux were not run. The real phone and audio devices were not tested.
