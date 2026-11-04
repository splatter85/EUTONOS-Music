# EMF-S02 player review

**Campaign:** `campaign-emf-001`

**Slice:** `EMF-S02` — CLOUD

**Review date:** 2026-11-04

**Disposition:** KEEP the narrow S02 implementation. This source inspection found
no established release-blocking defect in the reviewed scheduling, cue mapping,
or cancellation paths. Native rendering and browser checks were **pending** at
this review checkpoint; the source review does not replace those gates.

## Source state and method

The independent reviewer inspected the S02 worktree based on verified S01 main
`43b7f449c0370f22c75463b278b3f50c09a0ee0d`, then checked the core player at published
S02 source commit `dddb3c587ba32824f28c054411d80a46747b49d9`, tree
`ea1b5b0992b44ac4551527711cb1cea406c9e82d`, on
`work/emf-s02-player-20261104`. That publication was a review branch, not main.
Final source pins and completed execution evidence belong in the
[S02 handoff](../handoffs/EMF-S02-HANDOFF.md).

The review read AGENTS, Current Tasks, Work Model, the EMF campaign, the S01
handoff/foundation, and the shared source contract. Focused inspection covered
`src/web-audio.ts`, `src/browser-pack.ts`, `src/player.ts`, `web/app.ts`, the
existing pack eligibility/cue validation, the S01 manifest, and the player tests
and audio test double. It checked clock identity, source lifecycle/generation,
sample-rate conversion, complementary gain scheduling, late preparation,
Stop/Pause/replacement, duplicate transition preparation, and clock-derived
Now/Next. It was not a comprehensive security, accessibility, or browser audit.

The reviewer edited only this review record. It did not execute the suite,
launch a browser, render audio independently, or listen to the recordings.
Findings below are **inspection findings**, except where another agent's
execution is explicitly attributed.

## Execution evidence and limits

| Check | Evidence available at this checkpoint |
| --- | --- |
| Local automated tests | Integrating/root agent reported 53 Node tests passing. This was not an independent reviewer execution. |
| Native offline rendering and live browser checks | Pending hosted CI at this checkpoint. The workspace Chromium launch was reported blocked by its required sandbox/Unix-socket environment; no sandbox override was used. |
| Failed no-voice Resume ownership cleanup | Root reported a UI fix; the separate `s02_ui` reviewer independently reproduced that issue as resolved. This reviewer does not claim that reproduction. |
| Physical browser/device output and listening | Unverified. Node doubles, native offline rendering, and successful live scheduling cannot alone establish physical output or perceived transition quality. |

The handoff must record actual completed CI runs and their source pins. This
record intentionally does not convert pending hosted checks into passing
evidence or extend S01's three-platform evidence to the new player.

## KEEP

- **One audio clock owns the transition.** The player injects one
  `WebAudioClock` backed by its single context. A and B use absolute times on
  that context; gain ramps and A's stop are scheduled there. UI refresh reads
  that timeline and does not trigger B with a timer callback.
- **Cue conversion preserves the source contract.** Native file cue frames
  include the first-downbeat offset and rounded quarter duration, are converted
  to output frames, and subtract the selected entry offset when scheduling the
  exit. For the validated 120 BPM S01 pair, B begins eight seconds after A,
  the overlap lasts four seconds, and A ends at twelve seconds. These values
  follow the supplied manifest; they do not assert arbitrary DJ compatibility.
- **Preparation and stale operations have bounded effects.** An operation epoch
  prevents late decode/preparation from starting a cancelled selection.
  Replacement and Stop release voices and invalidate their generation. Release
  stops and disconnects a previously scheduled source even after invalidation,
  including B before its scheduled entry. Pause mutes immediately and requests
  context suspension so an accepted timeline can resume from the same clock.
- **The transition is checked again at commitment.** A late cue is rejected
  before changing A. Two overlapping preparation requests cannot commit two B
  voices: the second observes the committed plan, releases its prepared source,
  and fails explicitly. The inspected failure path releases a scheduled incoming
  source if the outgoing transition cannot be committed.
- **The media boundary remains conservative.** Browser loading checks manifest,
  bytes/hash, PCM metadata, eligibility, and bounded input/decode sizes before
  scheduling. Fixture playback is explicitly opted into. This slice reuses the
  portable S01 recordings and does not introduce FL Studio or native platform
  dependencies into listener playback.

## CHANGE / follow-up

| Finding | Status and consequence |
| --- | --- |
| `SmallPlayer.resume(ownership)` resumes the context concurrently with the ownership promise. If ownership rejects after the context has resumed, its catch path marks the player paused and mutes output but does not explicitly suspend the context. | **Inspection-only API robustness concern.** With existing voices and a pending or rejected ownership promise, the retained audio timeline can advance silently while the public state becomes paused. The ordinary inspected UI retains its existing lease throughout Pause, so this review did not establish a reachable normal UI failure. Keep the context suspended on failed ownership acquisition, or make this API precondition explicit and test it before callers use reacquisition with retained voices. |
| Failed no-voice Resume could retain UI ownership after its error. | **Reported addressed by root and independently checked by `s02_ui`.** No additional correction is requested on that evidence. |

The first row is distinct from the resolved UI ownership leak. It does not
establish a native-browser reproduction. Any subsequent correction should be
recorded with its regression result and final source pin in the handoff.

## DEFER and remaining gates

Native offline rendering and live browser lifecycle checks remain S02 execution
gates, not a later-slice substitute. The test double models resume/decode delays
and clock advancement but cannot certify browser control-thread scheduling,
resampling, interruption behavior, or device output. Its suspension takes effect
immediately, so browser evidence is especially relevant to real suspend/resume
ordering.

Full DJ selection/control integration, procedural performance, cross-device or
distributed ownership, FL Studio/MCP production, and listening approval remain
outside this slice. The same-origin Web Lock is a local demo ownership guard;
it is not a distributed lease. S08's independent PC producer lane remains
unaffected.

Publication/readback, completed hosted checks, the campaign and Current Tasks
updates, and the final evidence-backed handoff remain the integrator's completion
steps.

## Addendum — rejected Resume ownership correction

On 2026-11-04 the reviewer inspected the subsequent, uncommitted two-line change
to `SmallPlayer.resume()` relative to the pinned source above. After marking the
operation paused and immediately gating output, the rejection path now requests
and awaits `context.suspend()` when the context is not closed, then rethrows the
original error. This addresses the identified failure path by inspection:
rejected ownership no longer intentionally leaves the retained timeline running
silently. Suspension failure remains best-effort cleanup, consistent with the
existing context-error handling.

**Correction disposition: KEEP.** The retained-voice ownership-rejection
regression was being added by the test agent and its execution result was
pending root/test-agent evidence at this addendum. This reviewer did not run it.
Native rendering/browser checks and physical listening retain the evidence
limits above. The original pinned review remains historical; the final handoff
must supply the correction's published source pin and completed test result.

## Integrator execution checkpoint

After the historical addendum above, the separate test agent added the retained-voice ownership-rejection regression. It reports **10/10 player tests PASS**, and the integrator ran **54/54 Node tests PASS**, with no skips. The regression checks rejection, immediate zero output gain, paused state, suspended context, unchanged position after attempted clock advancement, and no duplicate start. This is test-double evidence; hosted native browser verification remains pending at this checkpoint.
