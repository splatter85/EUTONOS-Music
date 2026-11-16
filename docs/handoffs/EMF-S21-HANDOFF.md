# EMF-S21 — slice handoff (Part A: transition planner)

**Campaign:** EMF / `campaign-emf-001`
**Slice:** EMF-S21 Part A. Part B is not started.
**Disposition:** Part A BUILT on its worker branch, pending coordinator review and merge. The slice stays IN PROGRESS until Part A is merged and Part B is done or rescoped.
**Environment:** PC, Windows 11, Node 26, headless Chromium (Playwright).
**Base / branch:** `work/emf-s21-transitions` from `6b88d25`. Tested source: see [Verification](#verification-and-limits).
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
| `npm run check` (Windows) | RESULT_CHECK | build, Node tests, fixtures check, pack validation, S11 demo |
| `npm run check:browser` (Windows) | RESULT_BROWSER | all nine browser scripts, including the new S21 set readout checks |
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
**Prerequisites:** this branch at the tested SHA; Windows PC.
**First action:** review the diff against `6b88d25`, re-run `npm run check` and `npm run check:browser`, then merge into `main` under the coordinator's rules.
**Owner action:** none required for review. Listening needs real songs and a real audio device (S10).
**Still not done:** Part B, listening, macOS and Linux.
