# EMF-S15 — pickup brief: DJ transitions II (increments 1–4)

**Status:** a starting brief for an owner-assigned worker. It is not evidence that S15 was done.  
**Campaign:** [EMF](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md), slice EMF-S15 (stages EMF09, EMF11, EMF13).  
**Base:** `main` at or after the commit that adds this brief. It already holds S14 DJ transitions I, Music Studio's bar-grid command (EMS-S03) and the Studio DJ Booth's Beatmatch button.  
**Worker:** owner-assigned (ChatGPT). **Coordinator:** Claude reviews the branch and merges it into `main` at the end.

## Goal

Make automatic transitions choose better moments and better techniques, so fewer of them fall back to the authored crossfade and fewer sound wrong. The order follows the [DJ transitions research](../proposals/DJ_TRANSITIONS_RESEARCH.md), section 6, increments 1–4, plus one reviewer finding carried over from S14:

| # | Increment | Research reference |
| --- | --- | --- |
| 0 | Late-preparation fallback in `scheduleMix` (small fix, first) | S14 review, below |
| 1 | Tempo candidates, ambiguity and beat/downbeat confidence | Increment 1 |
| 2 | Separate cue-in and cue-out planning, scored as pairs | Increment 2 |
| 3 | Echo-out and clean-cut recipes as evaluated alternatives | Increment 3 and the echo-out recipe |
| 4 | Offline rendered-transition evaluator that picks the best passing candidate | Increment 4 and section 5 |

**Deferred, do not start:** the analysis sidecar (increment 5), Signalsmith or any WSOLA replacement (6A) and stems (6B).

Each increment is its own commit (or small group of commits) and must pass the gates below on its own, so the coordinator can stop after any of them.

## Read first

1. [AGENTS.md](../../AGENTS.md), [README](../../README.md) and [the work model](../WORK_MODEL.md).
2. [DJ transitions research](../proposals/DJ_TRANSITIONS_RESEARCH.md), sections 2, 5 and 6 in full.
3. [DJ transitions guide](../DJ_TRANSITIONS.md) and the [S14 handoff](DJ-TRANSITIONS-HANDOFF.md), for the current analysis, planner, preparation limits and status strings.
4. [Audio analysis](../AUDIO_ANALYSIS.md), the "Bar grid (EMS-S03)" section, and [the EMS-S03 handoff](EMS-S03-HANDOFF.md). They explain the bar-grid contract you must keep.
5. Source: `src/mix-analysis.ts`, `src/mix-planner.ts`, `src/mix-transition.ts`, `src/mix-automation.ts`, `src/mix-prepare.ts`, `src/mix-worker.ts`, `src/player.ts` (`scheduleMix`), `src/bar-grid.ts`, and their tests.

## File boundary

**You own, on your branch:**
- `src/mix-analysis.ts`, `src/mix-planner.ts`, `src/mix-transition.ts`, `src/mix-automation.ts`, `src/mix-prepare.ts`, `src/mix-worker.ts`.
- New files named `src/mix-*.ts` (for example `src/mix-cues.ts`, `src/mix-evaluate.ts`) and `tests/mix-*.test.ts`.
- In `src/player.ts`: only `scheduleMix`, the mix status type and helpers used only by them.
- `web/mix-checks.ts` and `scripts/mix-browser-check.ts`; `scripts/analyze-audio.ts` if its output gains fields.
- Exports from `src/index.ts` for new mix modules.
- `docs/DJ_TRANSITIONS.md` and a new `docs/handoffs/EMF-S15-HANDOFF.md`.

**Do not change:**
- `src/bar-grid.ts`, `scripts/bar-grid.ts` or `tests/bar-grid.test.ts`.
- Music Studio files (`web/studio*`, `scripts/studio-check.ts`).
- Any other player paths (`direct`, `hybrid`, FIFO, Hold, cancellation), the clock, the pack contract or the importer.
- `docs/WORK_ITEMS.md` (board; coordinator only, through the EUTONOS boards CLI).
- [Current Tasks](../CURRENT_TASKS.md), the campaign, `NAV/`, `RAM/`, `eutonos.acceptance.json`, `.claude/`, `.codex/` and `.mcp.json`.

If a change outside the boundary seems necessary, stop and describe it in the handoff instead of making it.

## Contracts to keep

- **Bar grid `eutonos.bar-grid.v1` stays unchanged.** `barGrid()` calls `analyzeMixAudio()` and reads `tempo.bpm`, `tempo.confidence`, `structure.downbeatFrames` and `structure.downbeatConfidence`, plus `MIX_ANALYSIS_LIMITS` and `MIX_ANALYSIS_VERSION`.
  - Keep those fields' names, types, units and meanings.
  - `tempo.bpm` stays the single best tempo.
  - `MIX_ANALYSIS_VERSION`'s value may change; bar grid reports it as `analysis_version`.
  - Add new information as new fields, for example `tempo.candidates` and `tempo.ambiguity`.
  - `tests/bar-grid.test.ts` must pass unedited. Better tempo and downbeats flowing into the bar grid are welcome, as long as the output shape does not change.
- **Playback defaults stay the same.**
  - The DJ handoff default stays `direct`; the automatic `mix` stays opt-in, and its EQ/filter and bass-handover options stay off by default.
  - The automatic mix stays ready-only: B is never scheduled late to hide a miss.
  - The authored crossfade remains the fallback whenever no candidate qualifies.
  - FIFO, Hold and cancellation semantics are unchanged.
  - One audio clock and one playback owner.
- **Music Studio's Beatmatch button keeps working.** Its Studio gate (10 checks) runs inside `check:browser`.
- **Determinism:** the same input and options give the same analysis, plan and render.

## Increment 0: late-preparation fallback (S14 reviewer finding, medium)

This finding comes from reading the code; it was not reproduced. In `src/player.ts` `scheduleMix`:
- The earliest mix frame is computed before preparation, as now + lead + 2 s.
- Analysis and render can each take up to 30 s (`src/mix-prepare.ts`).
- If preparation takes longer than the allowance, the check "Prepared mix missed its exact audio-clock deadline" throws and routes to `useAuthoredFallback` → `scheduleAB()`.
- If A's authored exit cue is also near or past, that throws too. The phase becomes `unavailable` and the error propagates to the DJ as a hard error.
- Failure scenario: a long pair on a slow machine, with the mix selected near the end of A. It is clock-safe, but it is not graceful.

**Required outcome:**
- When prepared audio misses its deadline, first try a later analysed cue on A that still meets the deadline, if one exists. Recompute "now" after preparation.
- Otherwise use the authored fallback.
- If that is also past, A keeps playing and the request ends in a defined, reported `unavailable` outcome, not an unhandled error.
- Never schedule B late.
- Add a regression test with a slow or mock preparation runtime covering all three branches, and check that FIFO and Hold behave as before.

## Increments 1–4

Follow the research brief's scope, checks and main risks for each one. These points are additional or clarified:

1. **Tempo candidates and confidence.**
   - Return ranked `tempo.candidates` (×0.5, ×1, ×2 and nearby peaks) with an `ambiguity` value.
   - The planner refuses tempo-dependent recipes when ambiguity is high.
   - A generation-BPM hint, when supplied, is evidence and not ground truth. Music Studio takes ask for one BPM but render at another, for example 124 asked and 125.0 measured.
   - Downbeats: improve phase choice and report honest confidence. Low confidence must still yield the authored fallback.
2. **Cue-in and cue-out.**
   - Use asymmetric `findOutgoingCues(A)` and `findIncomingCues(B)` on the downbeat grid, with confidence-weighted 4/8/16-bar scoring, an incoming-salience check and joint pair scoring.
   - Never invent a phrase boundary when there is no reliable structure.
3. **Echo-out and clean cut.**
   - Two new recipes beside blend and authored crossfade, each with its own preconditions. Use the echo graph, defaults and timing from the research brief; the wet return must not pass through A's channel gain.
   - Cut ramps are 5–20 ms complementary ramps.
   - Each recipe replaces the authored fallback only when its preconditions hold.
   - Use the decision table: good timing with poor key → echo-out or cut; poor timing → authored crossfade.
4. **Evaluator.**
   - Render each candidate offline and measure: true peak, momentary and short-term loudness against the interpolated target, 3-band low-end build-up, beat-phase error, boundary flux judged by recipe, silence gaps and stereo correlation.
   - Keep thresholds in versioned, labelled experimental configuration.
   - The planner picks the best passing candidate or falls back.
   - Include the known-good/known-bad fixture table from the research brief, with exact expected measurements.
   - Evaluation runs only during preparation, never inside the audio deadline. Note its cost against the preparation time limits.

## Gates (every increment)

- `npm run check` and `npm run check:browser`, on every OS you can reach. Report which OSes actually ran and the exact counts; a change stays unverified on an OS where it was not run. There is no CI.
- Fixtures are generated in code. Commercial, proprietary or downloaded audio and model weights do not go into the repository.
- Report measurements as measurements. **Nothing is heard.** Never claim a transition sounds good from metrics, waveforms or descriptions. Physical output and listening remain NOT TESTED until the owner's S10.
- The owner-local real-FL check (the FL A track moving from 61.86 to about 120 BPM) can only run on the owner's PC. Leave it to the coordinator and mark it NOT RUN.

## Delivery

- Work on the branch `work/dj-transitions-ii`, created from the base above. Commit per increment and push the branch. Never force-push; do not merge into `main` or open auto-merge.
- If `main` moves while you work, do not rebase or merge it. Say in the handoff which base you tested.
- End with `docs/handoffs/EMF-S15-HANDOFF.md` on the branch, following the [handoff policy](../WORK_MODEL.md#per-slice-handoff-policy). Include:
  - per increment: commits, what changed and the actual gates per OS;
  - new analysis fields and recipe preconditions;
  - evaluator thresholds and their status;
  - known risks and what was not done;
  - the late-preparation test results.
- Then send the owner a short copy-ready summary. The coordinator reviews, merges into `main` with the merged-tree gates, updates the board, campaign and Current Tasks, and runs the owner-local FL check.

## Amendment 1 (2026-11-13, coordinator)

The worker's independent review (its finding B3) showed that the research echo cannot be admitted live within the original boundary. The echo send opens at S, before B's entry at T. If the player publishes `transitionAt = S`, the DJ starts B's request early. If it publishes `transitionAt = T`, `cancelQueue` marks the entry cancelled and then native cancellation refuses, because only hybrid bridges have a guard for an already-entered prelude.

**Writer and branch:**
- One writer: the S15 worker on `work/dj-transitions-ii-reviewed`.
- `work/dj-transitions-ii` stays frozen at `403946d` with its uncommitted files preserved. The worker may carry that diff over only after reviewing it.
- The coordinator has no S15 writer.

**Scope changes:**
1. **Narrow DJ guard, allowed.** In `src/dj.ts`, `cancelQueue` and `cancelFuture` may treat "the transition's earliest committed effect has passed" the same way they treat an entered hybrid bridge: report `blocked` before marking anything cancelled.
   - The player may expose that frame (for example, a snapshot field for the earliest effect) from `scheduleMix` and the mix status.
   - B's request still starts at T (`transitionAt = T`). FIFO order, Hold, Stop and the `direct`/`hybrid` behaviour stay unchanged.
   - Put this change in its own commit, with tests for cancelling before S, during S..T and after T, plus FIFO and Hold at those same times. Make no other DJ, control, clock, cancel or `web-audio.ts` changes.
2. **Browser modules.** `scripts/serve.ts` stays protected. Put any helpers the browser needs in the already-allowed mix files instead of new `src/mix-*.ts` modules. Node-only modules (for example, the offline evaluator, if the browser never imports it) may be new files.
3. **Fallback if the guard is not done.** Echo stays offline-evaluated only, and live admission keeps blend, cut and the authored fallback. The handoff then marks echo as partial and B3 as open.
