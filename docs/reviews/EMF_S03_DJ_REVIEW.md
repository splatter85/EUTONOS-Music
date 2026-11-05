# EMF-S03 deterministic DJ review

**Campaign:** `campaign-emf-001`  
**Slice:** EMF-S03 — CLOUD  
**Date:** 2026-11-04, America/Chicago  
**Disposition:** KEEP the bounded two-recording request/DJ implementation after the corrections below. This is a source and deterministic execution review; native browser results and the final source pin are recorded in the [S03 handoff](../handoffs/EMF-S03-HANDOFF.md).

## Source and method

The independent reviewer read AGENTS, Work Model, Current Tasks, the S03 campaign assignment, S01/S02 contracts and the fixture manifest. Review covered `src/control.ts`, `src/dj.ts`, the S02 player/source integration, and the new DJ tests. The reviewed source was published as [`56da6caf3418a201bb1ce66b131d36292f7f580e`](https://github.com/splatter85/EUTONOS-Music/commit/56da6caf3418a201bb1ce66b131d36292f7f580e), tree `c47d2a7b5bc75d2f84f04dc667056461950540be`, on `work/emf-s03-dj-20261104`. Its tree matched the local tested source exactly. This initial pin still had the S02 UI; the subsequent S03 UI and final assembled checks are separately recorded in the handoff.

During the source review, the reviewer made no implementation edits. It added `tests/dj-review.test.ts`, using the real `SmallPlayer` with the existing deterministic Web Audio call recorder. The tests deliberately delay promise observation **after renderer scheduling calls have been recorded**. Context/source doubles establish call order and state; actual native rendering is separately checked in hosted browsers. The integrator applied the fixes and regression tests described below.

## KEEP

- One deterministic coordinator uses the existing control contract and renderer, preserving one playback owner and clock.
- Manual FIFO precedence cannot bypass eligibility or route checks. A blocked head is visible and cannot be silently skipped.
- Queue entries are consumed when renderer frames reach their entries, including during mute and delayed promise/UI observation.
- Identical canonical retries reconcile the original receipt and current execution result without repeating sound or queue effects.
- Requested targets, selected candidates, native schedules and renderer-active sources stay distinct. Unsupported targets do not relabel the soundtrack.
- Pre-boundary cancellation restores outgoing A as well as removing incoming B. An already-started handoff finishes; Stop remains an immediate transport operation.
- The slice remains finite: one checked A→B route, at most two voices, no invented reverse route, automatic loop or third source.

## CHANGE — corrected and rechecked

| Finding | Correction / regression |
| --- | --- |
| Removing a queued initial track during decode could still let it start. | Retain its reservation before awaiting preparation; removing that entry cancels the corresponding initial renderer work. |
| A compatible state request reused B but left its bound future state stale. | Rebind the supported future target while retaining the same native source and entry frame. |
| Rebinding could later mark an obsolete target completed. | Supersede incompatible older target operations; retain Next/queue operations that the same source still serves. |
| A stopped or blocked queue tail could report the head's track ID. | Keep the tail's own identity and report its FIFO wait explicitly. |
| A native schedule could start before the DJ observed its promise, leaving it untracked or falsely cancelled. | Retain attempts before awaits; adopt actual renderer schedules during reconciliation even after onset/end. |
| Delayed promise bookkeeping could overwrite a started receipt or make Cancel next stop an already-started A. | Clear preparation/start markers when native evidence is adopted; distinguish an unfinished attempt from delayed promise observation. |
| A start could cross during native queue cancellation after acceptance. | Reconcile the crossed entry, report the cancellation blocked and the original operation started, and retain the active mix. |

The focused follow-up also inspected `SmallPlayer.cancelPendingTransition()` and `RecordedSource.cancelTransition()`. It retained restoration of A's original end/envelope, refusal at or after the boundary, and the separate transition-preparation token.

## Executed independent evidence

`npm run build` and `node --test dist/tests/dj-review.test.js` passed. All **seven** independent cases passed:

1. A native transition's entry crosses before its promise is observed.
2. A committed future transition remains cancellable through Cancel next or removal of its queued entry before promise observation.
3. A new target arriving during an already-started handoff cannot mark that handoff superseded.
4. Stop consumes an initial native entry that started before its Play promise was observed.
5. Pause preserves a committed initial source despite delayed Play observation.
6. Cancel next does not stop an already-started A merely because its Play promise is delayed.
7. Concurrent exact retries during decode share one initial renderer effect.

The independent reviewer then ran the focused cancellation-boundary regression with `node --test --test-name-pattern='a cue crossed during native cancellation' dist/tests/dj.test.js`: **one test passed**. It reported no remaining material issue in that affected scope. The integrating agent's broader source checkpoint passed **99 tests**, deterministic regeneration and media validation; that count predates the final UI/player test additions.

## DEFER and evidence limits

Durable receipts, external APIs, expiry/leases, arbitrary catalogues, procedural sources, additional routes and full playlist behavior remain outside S03. No review promotes the fixtures or S08's private unreviewed render to listening-approved music.

The local Chromium process could not launch because this execution runtime refused its required socket. No permission restriction was bypassed. Native offline/audio/UI checks were delegated to the existing GitHub Actions platform matrix. This review checkpoint does **not** claim those pending results, physical device playback, human listening, complete accessibility or full MVP acceptance. The final handoff owns the actual hosted outcomes and exact final source applicability.

## Final source applicability and execution addendum — 2026-11-04

The core pin above remains historical. It subsequently passed its 99-test and native-browser gate on all three OSes at [run 41923101620](https://github.com/splatter85/EUTONOS-Music/actions/runs/41923101620); its UI was still the S02 version.

The assembled S03 UI/player test additions brought the suite to **101 passing tests**. Final tested source is [`71d954534087ff1637b8ff0e8fc51c393a89abfa`](https://github.com/splatter85/EUTONOS-Music/commit/71d954534087ff1637b8ff0e8fc51c393a89abfa), tree `2eba5fc6ccfb4b3f475ef92512a37436656f1623`. [Run 41925003036](https://github.com/splatter85/EUTONOS-Music/actions/runs/41925003036) passed on Windows, macOS and Linux: 101 Node tests, exact fixture regeneration/media validation, nine native offline checks and the complete S03 browser flow. Native cancellation restored full A with zero measured sample error at 48 kHz and 44.1 kHz on every platform.

After the independent core review, the same reviewing agent undertook a separate bounded implementation task to author the S03 browser harness. That harness is not represented as independently reviewed by its author. The integrator read it and examined actual hosted failures/reports. Its first assembled run exposed two visibility-dependent `innerText()` reads inside a collapsed diagnostic disclosure; the correction uses `textContent()` while retaining clock-freeze assertions. The UI implementation also received integrator feedback on ownership-epoch cleanup, stale asynchronous results, live text updates and ended/loading status.

The final closeout received a read-only factual check against code and reports. It corrected the lifecycle file path and clarified that independent context/source doubles establish call order/state, while hosted OfflineAudioContext checks establish native rendering. No remaining material mismatch was found in that bounded documentation review.

The [handoff](../handoffs/EMF-S03-HANDOFF.md) and [retained evidence](../evidence/emf-s03/README.md) own the complete execution record and limitations. Physical output, listening, full MVP acceptance, external/durable request semantics and S04 procedural work remain outside this KEEP disposition.
