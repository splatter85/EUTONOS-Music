# Validation and listening evidence

Document ID: `EM-D008`  
Status: proposed qualification plan, revised 2026-11-03. Documentation checks are not runtime or listening tests.

**S01 engineering checks:** run `npm run check` as documented in [S01 foundation](S01_FOUNDATION.md). GitHub Actions applies the same commands to Windows, macOS and Linux. This tests code/contracts and deterministic media integrity, not browser decoding, real playback, FL/MCP operation or listening. Actual results and unrun checks belong to the [S01 handoff](handoffs/EMF-S01-HANDOFF.md).

**S02 verification adds** a native offline Web Audio page and `npm run check:browser` for the small player, served and tested together in a fresh Chromium process. [Setup and exact checks](S02_PLAYER.md#verification-surfaces). The [S02 handoff](handoffs/EMF-S02-HANDOFF.md) records actual platform/browser outcomes, sample-error tolerances, review corrections and blocked/unrun checks. Headless rendering and UI behavior do not establish physical audio output, human listening, arbitrary browser compatibility or full MVP acceptance.

## Evidence categories

**S03 verification adds** deterministic DJ/request integration and boundary/race tests, plus native sample comparisons proving that cancelling a future A→B restores full A at 48 kHz and 44.1 kHz. The browser runner exercises the actual DJ controls and manual queue. [S03 policy and commands](S03_DJ.md) and [source-pinned results](handoffs/EMF-S03-HANDOFF.md) distinguish local doubles, hosted native browser evidence and untested physical/listening outcomes.

**S04 candidate:** 127 local Node tests and unchanged fixture/media checks pass. Added source/review tests cover deterministic phrase plans, bounds over 560 seed/state combinations, sample eligibility, stale work, shared decode residency and source lifecycle. Six new native groups and a sampler browser group are implemented, preserving the nine existing offline checks; they are **NOT RUN for S04** because local Chromium cannot launch and Git publication was blocked before CI. [Exact local source, approval block and recovery](handoffs/EMF-S04-HANDOFF.md). Prior S03 native evidence remains historical and is not proof for the S04 changes.

Separate documented upstream capability, inspection-based inference, measured implementation behavior and actual human listening judgment. Name the code/content/recipe versions, renderer, hardware/OS, sample rate/buffer, settings, event sequence and evidence location. A timing check does not establish taste; a listener preference does not establish a general productivity effect.

Use READY / REVISE / BLOCKED / NOT VERIFIED for required musical outcomes with a short observation and next action. Engineering checks can retain their test-specific pass/fail result. Do not average a required failure into a passing taste score. Never claim an agent listened based on MIDI, screenshots or signal statistics.

## First proof, then pilot fixtures

The small [audible proof](FIRST_PLAYABLE.md) needs two distinct recordings, one good procedural identity with multiple variations, deliberate handoffs, rise/release, hold and a repeatable state trace. Use aligned eligible assets and known tempo/meter/harmony. Roughly twenty minutes is a proposed experiment format, not an evidence-derived guarantee. Placeholder signals may verify timing but cannot satisfy musical acceptance.

The usable pilot adds at least three distinct families, several preselected/held-out seeds across supported intensities, a reviewed stem bundle, a non-direct bridge, a deliberately incompatible pair and a pickup/tail case. A non-4/4 or changing-tempo fixture must either work under a stated implementation or be explicitly rejected/fallbacked. It must not silently be interpreted as fixed 4/4. A vocal fixture is optional until an eligible source is selected.

Fixture readiness is operation-specific: playable, cue-mixable or hybrid-ready, as defined in First playable. Unknown harmony prevents unsupported pitched accompaniment but does not require rejecting ordinary permitted listening. Review generated recipe envelopes rather than claiming every possible seed was heard; novel model-rendered assets remain separate review candidates.

## Before broad infrastructure

First run two diagnostic comparisons: one musical pattern through different palettes, and different patterns through one palette, at matched gain. Then hear recorded → procedural → different recorded with context before and after each handoff. If the music is poor, identify composition, sound, arrangement, mixing or transition causes and change the smallest relevant piece. Do not respond by building a larger framework before another audition.

EMF05 reviews the actual scaffold and this evidence. This document-only update does not satisfy that gate, nor the host-aware EMF01 or assembled EMF17 review.

## Engineering checks

| Area | Exercise | Required outcome |
| --- | --- | --- |
| Audio clock | Repeat multi-source schedules against rendered positions | Predeclared environment-specific timing tolerance; no accumulating musical drift |
| Render path | Inspect/instrument under load | No model/network/file-write work or unbounded blocking/allocation on the audio deadline |
| Stems and latency | Repeat substitutions and pickups | Correct frame mapping, latency compensation and musical offsets |
| Gain and tails | Measure/hear complete transitions | No unintended clipping/discontinuity/chopped tails; acceptable balance |
| Low end and vocals | Deliberately conflicting layers | Explicit ownership and reviewed overlap or rejection |
| Requests | Duplicate, stale, reordered, expired and rapid intents | Original receipt recovery, explicit conflicts, no duplicate audible effect |
| Holds and wait | Automatic requests during hold; unachievable target | Manual control wins; fresh intent on release; bounded and visible wait |
| Source failure | Missing/corrupt/unprepared next asset | Valid continuation, alternate or intentional ending; no invented loopability |
| Production failure | Stall/kill a producer job | Prepared playback remains independent; unreviewed output never silently replaces assets |
| Lifecycle | Background, close/reopen page, duplicate tab, sleep/resume, device loss | Actual backend behavior disclosed; one owner, no surprise restart |
| Recovery | Restart during queued/active effects | New engine generation; stale plans refused; uncertain authoring reconciled |
| Data/versioning | Change a media/manifest/recipe revision | Current applicability rechecked; historical evidence preserved |
| Graph/coverage | Isolated source, one-way route, strict exclusions | Visible reachability and omission reasons without violating exclusions |
| Rights/trust | Private-only media, path escape, executable recipe instruction | Correct intended-use boundary, restricted roots and allowed operations |
| Reproduction | Replay versions, seed and trace | Same symbolic plan where promised; exact audio only where separately supported |
| MC isolation | Disconnect/crash music while work controls are used | Mission Control navigation, messaging and work remain usable |
| Adapter inference | Agent flood, reading pause, stale signals | No content collection or unsupported mental-state/engagement conclusions |

Choose measured resource/timing budgets on the named reference environment before qualification. Measure ordinary playback alongside representative development load and with optional generation both off and on. A GPU-equipped development workstation is not evidence of acceptable resource use elsewhere.

## Listener evidence

Review groove, harmonic/melodic relationship, sound, arrangement, transition, perceived state fit, useful variety and work-session distraction. Include sufficient musical context. Record who actually listened and to which version. Preserve adverse seeds and failures rather than only flattering excerpts.

Compare fixed-state and adaptive playback using the same relevant pack/settings and matched playback levels; counterbalance/repeat sessions where practical. A chosen ordinary mix can serve as a practical comparator. This is a small personal product experiment, not a controlled claim of improved cognition or productivity. Track enjoyment, unwanted switches, mute/hold/skip reasons, distraction and whether the listener voluntarily uses it again. Session duration and typing speed alone do not establish benefit.

## Real consumer and onboarding

A deterministic test client verifies the contract, not the actual Mission Control integration. A usable pilot requires the real MC path on an inspected current version, with pending/audible status, manual priority, disconnect/reconnect and failure isolation. Simulation remains NOT VERIFIED for that requirement. This documentation task did not inspect or modify separate MC source.

Test a fresh listening setup: an approved starter pack, explicit Play, no account/DAW/model requirement, simple defaults, accessible keyboard/focus behavior, clear missing-asset/unsupported-control errors and one playback owner. Production setup is not part of listening onboarding.

## Longer runs and variety

Use a short musical proof, real work sessions, longer technical soak and finally a later 72-hour qualification as the relevant risks justify them. A small repeating corpus can test endurance but cannot satisfy three-day breadth. A large reachable catalogue can still be boring; actual listening is required.

Capture bounded logs for identity/motif/recipe/palette repetitions, eligibility/coverage, rejected candidates, transitions/fallbacks, underruns, memory/cache/disk trends and production interference. Broad touring is opt-in and constrained by listener exclusions. Examine representative intervals across the run, not only its opening.

## Authoring and voice checks

EMF15 uses a disposable project copy and actual FL build/plugins. Verify discovered operations, intended-target editing, stale-project refusal, original-operation reconciliation, export workflow and the resulting audible artifact. An MCP response or created file is not proof of the desired musical result.

Selected model/voice routes pin code/checkpoint/dependencies and intended-use terms. Measure time/memory on the actual host and hear pronunciation, pitch/timing, expression, continuity, artifacts and repair effort. Test a revision, not only a first generation. These later checks do not block the first instrumental listening proof.

## Decisions from failed tests

Prefer the fixed mode when it wins the listening comparison; repair a weak recipe rather than call seed count success; choose native audio if a required browser behavior fails; automate a narrow FL task when it is the actual bottleneck. Each new experiment must identify the decision it can change. KEEP findings create no mandatory cleanup work; CHANGE addresses demonstrated problems; DEFER retains worthwhile ideas outside the current boundary.

A later source hash mismatch does not erase an earlier event. Preserve the original evidence and separately assess relevance to the current implementation. Campaign milestones, Git publication, target integration, runtime qualification and owner acceptance remain distinct.
