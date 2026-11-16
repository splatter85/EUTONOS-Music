# EMF-S21 — slice handoff (Part A: transition planner; Part B: trusted grids and dual tempo ramp)

**Campaign:** EMF / `campaign-emf-001`
**Slice:** EMF-S21. Part A is merged into local `main` (campaign record `9010f27`). Part B is built on worker branch `worktree-agent-a129213a9af3c1cec` from `108cafd`; see [Part B](#part-b-trusted-tempo-grids-and-dual-tempo-ramp) at the end.
**Disposition:** Part B BUILT on its worker branch, pending coordinator review and merge. The slice stays IN PROGRESS until Part B is merged. The Part A text below is kept as it was written at Part A's handoff.
**Environment:** PC, Windows 11, Node 26, headless Chromium (Playwright).
**Base / branch:** `work/emf-s21-transitions` from `6b88d25`. Tested source: `4dca83ae786b5b2ebe39817ad27964aeefff3464` (clean tree).
**Publication:** a local commit on the worker branch only. No merge, no push, no native board change (coordinator-owned).

## Assignment and scope

Part A of the [campaign row](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md):

- clean cuts only as a last resort;
- no entry bias towards B's start (whole-song bounded windows, a skip cost, the earlier-cue tie rule);
- Auto recipes chosen by tempo-gap band, including meet in the middle;
- an LR4 EQ choreography library;
- a seeded explore mode with replayable plan records and attached ratings;
- render-then-evaluate safety rejection;
- a non-cut fallback for manual Next.

**Excluded:** self-similarity segmentation, vocal classifiers, and anything from S22 or S23. The guide is [S21_TRANSITION_PLANNER.md](../S21_TRANSITION_PLANNER.md).

## Delivered changes

| File | Change |
| --- | --- |
| `web/transition-policy.ts` (new) | `transition-policy@1` tempo-gap table; `entry-skip@1` rank, skip cost and tie rule; choreography choice from pair features and style; `explore-bounds@1` seeded explore (mulberry32); `em.transition-plan.v1` records with a content-hash id and replay overrides; `em.transition-ratings.v1` log. |
| `web/eq-choreography.ts` (new) | `lr4-three-band@1` coefficients, response and offline splitter. `eq-choreography@1` builds five choreographies with declared gaps. |
| `src/mix-automation.ts` | Band lanes, declared gaps, `createThreeBandSplit`; a 64 ms crossfade back to a direct path after band automation ends (`BAND_BYPASS_SECONDS`), because the LR4 sum is all-pass in phase. |
| `web/deck-mixer.ts` | One LR4 split per deck, in the path only while band lanes are scheduled (64 ms direct/split handover at start and after end); lazy echo; band snapshot. |
| `src/mix-analysis.ts` | v4: no early-position bonus, `songWindowStarts` / `mergeSongWindows` (`song-window-merge@1`), cue caps of 16 per window and 32 merged. |
| `src/mix-planner.ts` | `meet-in-middle`, choreography-driven blends, a limited-harmony mode, skip cost and tie rule, explicit entry rank, smoothstep tempo return, labelled heuristic echo. A brake for gaps of 16% or more. |
| `src/time-pitch.ts` | `ReturnToOriginal.curve: 'smoothstep'`, with the same frame total as the linear return. |
| `src/mix-transition.ts` | Whole-song `analyzeSong` cache; policy-ordered candidates with an `exclude` list. Route-free order is crossfade, then filtered echo reset, then cut (last). Plan records and the why/rejected lists. |
| `src/player.ts` | Up to 5 candidates: a pre-check FAIL excludes that recipe and tries the next one. An unavailable pre-check stops at once. B's analysis has a 6 s deadline. `setTransitionExplore(seed)`. Readout fields in `SetMixDetail`. |
| `web/mix-evaluator.ts`, `web/mix-precheck*.ts` | `transition-safety@1` measurement and pure judgement. It is re-judged by the validator, and a safety FAIL fails the pre-check. `mix-evaluation-thresholds@1` is unchanged. |
| `web/set-mode.ts`, `web/studio.ts`, `web/studio.html` | New recipe labels; `transitionReadout`; a "Why this handover" panel with explore and seed, Love/Like/Dislike ratings in localStorage (try/catch), and JSON export. |
| `tests/s21-transition.test.ts` (new) | 13 tests: tempo-gap table, entry beyond 60 s with no early bias, whole-song windows, LR4 flatness, tone-dissolve swap timing, bass-drop gap timing, feature-driven choice, route-free echo reset, smoothstep mapping, seeded reproducibility, plan record and ratings, safety judgement, sustained low-band and bass-hole measurement with declared gaps. |
| Existing tests and checks | Updated for intended behaviour changes: route-free 90→128 is now an echo reset; a FAIL tries further candidates (bounded); a later settled exit on a short fixture; a longer bounded entry render; graph-shape fader lookup; a delay node in the audio double. `scripts/set-browser-check.ts` adds the S21 readout, rating and explore checks. `scripts/mix-precheck-browser-check.ts` now accepts 1–5 checks per Studio Next (1 when unavailable), each a separate bounded worker, with only a FAIL moving on. |

`scripts/serve.ts` is unchanged. Because of that, the two new browser modules live in `web/`, whose `dist/web/*.js` files the server already serves.

No audio, owner songs, credentials or derived private data were added. The optional `local/s16-rated` aggregate measurement was **not run**.

## Verification and limits

| Command or check | Actual result | Evidence / limit |
| --- | --- | --- |
| `npm run check` (Windows) | PASS (exit 0): 592 tests, 592 pass, 0 fail, 0 cancelled, 0 skipped; fixtures, validation and S11 demo passed | build, Node tests, fixtures check, pack validation, S11 demo |
| `npm run check:browser` (Windows) | PASS (exit 0): all nine scripts in order (browser, s11, studio 15 checks, mix, phone, set 18 checks, deck, set-analysis, mix pre-check 7 checks), headless Chromium 151 | all nine browser scripts, including the new S21 set readout checks |
| macOS / Linux | NOT RUN | not reachable from this PC |

Audio was **rendered offline** in tests and checks only. It was **not played on physical output** and **not auditioned**. Listening is NOT TESTED. Passing safety limits does not mean a transition sounds good. `transition-safety@1` limits are engineering limits, not calibrated against listening.

## Decisions, risks and recovery

**Decisions**

- A clean cut is always the last candidate. The route-free safety net is a filtered echo reset. Echo recipes need A's audio for the whole outgoing automation (the existing deck rule), so near the end of a song a cut can still be chosen.
- A pre-check FAIL excludes that recipe and tries the next candidate, at most 5 attempts. When all are rejected, the message reports the last check. This changes S20's "one check per Next" contract to "at most one check per candidate".
- Safety is a separate versioned set. The low-band rise and bass-hole rules must hold in every 50 ms cell across 250 ms, so a short spike is not a rejection.
- Meet in the middle is set-only. It ramps A at native rate, so A's pitch moves; B is stretched and returns on a smoothstep over 4 or 8 bars.
- A bass-drop with a 4-bar gap lands B's bass on bar 8, so A's bass is heard before it is killed.
- EQ choreographies apply to blend and meet in the middle. Filter sweep, loop extend and loudness match keep their S19 lanes (layering bands on the sweep failed the Studio loudness pre-check).
- Explore records keep the seed on route-free plans too.

**Risks and gaps**

- B's whole-song analysis can take a while on long songs. After the 6 s deadline, Next uses the route-free path.
- `set-analysis-cache` display may show per-window analysis; this was not reviewed in depth.
- Not built:
  - the reverb bridge, loop-ramp bridge and breakdown reset;
  - safety in pair-mode `chooseEvaluatedMix`;
  - an A-side pitch-preserving stretch.
- Ratings are browser-local and small (500 entries max). There is no learner.
- The 64 ms direct-to-split crossfade at the start of a choreography briefly mixes the dry and all-pass-phased signal on that deck; it is not listened to and may be audible as a short tonal change.
- On the synthetic Studio pre-check set fixture (requested grids, −3.4% tempo), Auto's blend FAILs beat phase (0.137) and the echo reset FAILs loudness (3.3 LU), so the handover ends as the last-resort clean cut, which PASSes. The check accepts this; whether the pre-S21 build planned a passing blend there was not compared. Worth a look in review.
- No unit test drives band lanes through the deck mixer; the deck browser check proves no-band equivalence only.

## Next handoff

**Exactly one next actionable slice:** coordinator review and merge of `work/emf-s21-transitions` (PC). Then EMF-S21 Part B, or S10 owner listening of the S21 handovers, as the owner assigns.
**Prerequisites:** this branch at `4dca83a` or its docs-only successor; Windows PC.
**First action:** review the diff against `6b88d25`, re-run `npm run check` and `npm run check:browser`, then merge into `main` under the coordinator's rules.
**Owner action:** none required for review. Listening needs real songs and a real audio device (S10).
**Still not done:** Part B, listening, macOS and Linux.

## Review-fix pass (after coordinator review)

Seven review findings were fixed on this branch; tests are in `tests/s21-transition.test.ts`, `tests/s21-bassdrop.test.ts`, `tests/deck-mixer.test.ts` and `tests/mix-precheck-player.test.ts`. Detail is in [the planner doc](../S21_TRANSITION_PLANNER.md#review-fixes-after-the-first-part-a-review).

1. Retry exclusion by recipe + boundary + overlap + choreography; a clean cut reached after a failed pre-check carries `fallbackAfterFailedPrecheck` and is not a plain pass. 5-attempt bound kept.
2. Bass drop measured against thresholds@1 (thresholds unchanged): beat phase under 0.05, but the gap fails loudness, low build-up or flux on synthetic fixtures (120 to 120: loudness 3.5 and 4.5 LU for 8-bar gap 2 and 16-bar gap 4; 120 to 124: flux 24.9 and 20.9). A 12-bar overlap is refused by the planner. Auto now prefers mid-carve for weak harmony alone.
3. Explore emits only planner-accepted overlaps (4-bar gap rounds to 16 bars); a refused draw falls back to Auto's choreography.
4. Route-free tries up to two later bars before the clean cut.
5. Deck mixer rolls back echo parameter events with the lanes and clears them on release.
6. Replan keeps choreography, meeting tempo and tempo return.
7. Meet in the middle checks A's shifted key (nearest semitone, 0.4 semitone detune limit).

**Still not addressed:** the 64 ms direct-to-split crossfade is not modelled by the evaluator; the 6 s analysis deadline falls back to a start-of-song entry; `replayOverrides` has no consumer; Next availability after a blend is unmeasured.

**Review-fix gate results (Windows, this working tree before commit):** `npm run check` PASS, exit 0, 601 tests, 601 pass, 0 fail, 0 cancelled, 0 skipped. `npm run check:browser` PASS, exit 0, all nine scripts (studio 15 checks, set 18 checks, mix pre-check 7 checks), Chromium 151. macOS and Linux NOT RUN. Listening NOT TESTED.

## Part B: trusted tempo grids and dual tempo ramp

**Assignment:** the automatic DJ must find an intentional transition between any two songs, including songs at different tempos. It must not refuse, and must not fall to a clean cut, because a tempo was misread. The live bug: Turbo Storm (128) → Midnight Orbit (128) failed with "DJ plan check FAIL: beatPhase fail", because Turbo Storm was read as 85.33 BPM (3:2).
**Base / branch:** `worktree-agent-a129213a9af3c1cec` from `108cafd`. The tested source is the commit that adds this section; the coordinator report carries its SHA.
**Publication:** a local commit on the worker branch only. No merge, no push, and no change to the campaign, Current Tasks or the native board.
**Frozen and unchanged:** `scripts/serve.ts` and the values of `mix-evaluation-thresholds@1`. The safety pre-check was not weakened.

**Delivered.** Detail is in [the planner doc](../S21_TRANSITION_PLANNER.md#part-b-trusted-tempo-grids-and-the-dual-tempo-ramp).
1. **Analysis `mix-analysis-v5`:**
   - ratio repair (`tempo-relation@1`: 1:2, 2:1, 2:3, 3:2, 3:4 and 4:3), applied only when a reference tempo and strong beat support agree;
   - honest ambiguity when there is no reference;
   - requested-origin downbeats (`requested-downbeat@1`), applied only when they agree with the audio;
   - per-window tempo on the whole-song map.
2. **One trusted grid** (`gridAlignedAnalysis`) for both the set chooser and the pre-check evaluator. Beat phase against a requested-only grid is reported unjudged, and the pre-check reports `warn`, never `pass`.
3. **Dual tempo ramp** (`dual-ramp@1`, `transition-policy@2`):
   - A stretches with pitch kept, over 4 bars on a smoothstep, to the geometric-mean meeting tempo, staying within 0.92–1.08;
   - B enters 16 native A beats later at that tempo;
   - B then returns to its own tempo over 4 or 8 bars;
   - no pitch shift is left over;
   - the evaluator models both ramps;
   - it is reachable from Studio pair mode (Auto and the recipe list), the set page and phone Next.
4. **Candidate order:**
   - the dual ramp is a first-class Auto candidate;
   - a failed pre-check, or a failed render of A's ramp, tries the next candidate;
   - the cut is last and is reported as a fallback.

**Before/after tempo (owner songs, analysed read-only in place):**

| Song | Before | After |
| --- | --- | --- |
| Turbo Storm | 85.33 | 127.99–128.04 |
| Midnight Orbit | not recorded | 127.96–128.10 |
| Still Tide | 73.3 | 110.0 |
| Hazy Harbor | 66.67 | 100.0 |
| Thunder Storm | 90 | 90 (requested origin honestly rejected) |

**Tests added:**
- `tests/s21-partb.test.ts`, with 10 tests:
  - octave and 2:3 repair;
  - the 3:2 trap, end to end through the evaluator;
  - planner/evaluator grid agreement;
  - dual-ramp arithmetic;
  - the ramp-in map and deck readout;
  - the set chooser order;
  - the outgoing stretch buffer.
- One Part B set-mode case: Auto Next on a 4.9% gap schedules the dual ramp, and it can be cancelled.
- Three earlier expectations were updated to the new Auto order.

**Gate results (Windows, this working tree before commit):**

| Gate | Result |
| --- | --- |
| `npm run check` | PASS, exit 0: 615 tests, 615 pass, 0 fail |
| `npm run check:browser` | PASS, exit 0: all nine scripts (Studio 15 checks, set 18, mix pre-check 7), Chromium 151, no FAIL status |

macOS and Linux were NOT RUN. Listening is NOT TESTED. The real phone is NOT TESTED.

**Risks and limits:**
- Repair needs a requested tempo. Without one, a 3:2 misread is gated as ambiguous but not corrected.
- An `unavailable` pre-check, such as a window over 4M samples, still aborts the transition instead of trying the next candidate.
- Studio pair mode has no pre-check.
- The engineering values are not calibrated by listening.

**Next handoff:** coordinator review and merge of this branch into `main` (PC). Then S10 owner listening of Turbo Storm → Midnight Orbit and a 4–8% gap dual ramp, on real songs and a real device.
