# EMF-S05 hybrid handoff review

**Campaign:** `campaign-emf-001`  
**Slice:** EMF-S05 — recording → procedural → recording handoff (built on the owner's PC)  
**Date:** 2026-11-05, America/Chicago  
**Disposition:** **KEEP for the bounded engineering scope after the corrections below.** Corrected source passes on Windows only. The [S05 handoff](../handoffs/EMF-S05-HANDOFF.md) owns the source pin, evidence and next step.

## Method and applicability

A separate, read-only reviewing agent inspected `src/hybrid-handoff.ts`, the source, player and DJ changes, the page, `tests/hybrid-handoff.test.ts` and `web/hybrid-checks.ts` against the [S05 guide](../S05_HYBRID.md) and EM-DEC031. It traced frame arithmetic by hand and ran no audio. It did not edit files. The integrating agent applied the corrections, added the regressions and re-ran every check. The reviewer did not re-review the corrected source.

This is a scope-specific engineering review. It does not cover physical output, listening, macOS/Linux, other browsers or long sessions.

## KEEP — checked with no finding

- Boundary arithmetic at 44.1 and 48 kHz: lead-in, bridge exit, tail and `end` exit frames are integers on bar lines of the one clock.
- Non-percussion bridge attacks at or after the exit are cancelled with zero-length stops; the exit refusal happens before any effect.
- Commit order: bridge, bridge exit and B are scheduled before A changes, so a refusal leaves A playing unchanged and releases the prepared sources.
- Late commits are refused, not moved. Duplicate and racing requests do not schedule a second bridge.
- Cancel before the bridge restores A exactly; pause, stop and generation changes cover the bridge.
- At most two nonzero sources are summed at any frame.
- The snapshot reports clock-derived phases, not device output. The S03 crossfade default and S04 audition are unchanged.
- `bridgeSeed()` is a stable FNV-1a hash of the command ID.

## CHANGE — corrected and rechecked

| Finding | Correction and evidence |
| --- | --- |
| **Medium.** B was reported planned and `started` at A's exit cue, eight seconds before it actually entered, and the queue head was consumed when the bridge entered. A Stop during the bridge therefore lost the queued B, and removing B from the queue during the bridge was refused as a missing entry. A test locked this in. | The DJ now plans and reports B at its own entry (the bridge exit) and acknowledges the queue head there, as S03 does. While the bridge plays, the request is reported `scheduled` with the reason that the bridge has entered and can no longer be cancelled. Cancel next, Next and queue removal are refused; a refused removal still drops the listing, as S03's control model does. Stop stays immediate and keeps an unstarted queued B for the next Play. The page disables Cancel next once the bridge enters. Two updated tests and one new test cover this. |
| **Low.** Re-serving an already scheduled queue updated B's reported state but not the bridge's. A Surge → Explore change kept a bridge state of `null`, and Explore → Drive kept an Explore bridge while reporting that it served the request. | Re-serving now requires the scheduled bridge's state to match the bridge state for the current request; otherwise the bridge is rescheduled under the new command's seed. A re-served bridge reports its state only when it matches the request. The new test covers Surge → Explore (re-served, same seed) and Explore → Drive (rescheduled Drive bridge). |
| **Low.** The `end` exit render had no headroom check. | The native group now requires the `end` exit mix peak to be above 0.01 and below full scale and reports it: 0.456 at 48 kHz, 0.457 at 44.1 kHz. |

## Remaining limits

- The native offline groups build the handoff from the planner and sources directly. They do not call `SmallPlayer.scheduleHybrid()`; that path is covered by Node tests with the context double and by the live headless-browser stage.
- The timing and fade lengths are engineering choices that nobody has listened to.
- One route, one performer, no vocals; key, tempo or meter changes are refused.

## Executed checks after correction

Windows 11, Node 26.12.1 (the package declares 24), headless Chromium 151.0.7922.34, Playwright 1.62.1:

- `npm run check`: **143/143 Node tests** (13 S05), unchanged fixture regeneration and six media validations.
- `npm run check:browser`: **19/19 native offline groups** and **12/12 browser report groups**.

macOS and Linux were not run. **Physical output and human listening are NOT TESTED.**
