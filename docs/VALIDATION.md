# Validation and listening evidence

Document ID: `EM-D008`  
Status: proposed qualification plan, 2026-11-03. Documentation checks are separate from these future runtime checks.

## Evidence categories

Keep four categories visible: documented upstream capability, inspection-based inference, measured implementation behavior, and human listening judgment. A test can establish timing without establishing taste. A listening preference can establish usefulness for a listener without establishing portability to every machine or genre.

Every qualification record names the commit, backend, OS/hardware, sample rate/buffer settings, asset and recipe versions, configuration, event sequence, and evidence location. Preserve unresolved defects and limits rather than averaging them into a passing score.

## Small meaningful fixtures

The first campaign should use rights-cleared material that exercises real boundaries:

- Two related recorded pieces and at least one synchronized stem bundle.
- Three musically distinct recipe families with a documented sound palette.
- Multiple reviewed seeds at low, medium and high supported intensity.
- A direct phrase mix, a role substitution, a rhythm/texture bridge, and an intentionally incompatible pair.
- A phrase with a pickup or effect tail; a vocal fixture only if its rights and source are clear.
- A tempo-changing or non-4/4 fixture to ensure the contract fails explicitly or handles it, rather than silently assuming a constant 4/4 grid.

The implementation may initially support only a subset. Unsupported cases must be rejected or routed to a documented fallback. Fixtures demonstrate scope; they do not stand in for the eventual broad library.

## Engineering checks

| Area | Meaningful check | Required outcome |
| --- | --- | --- |
| Audio clock | Repeat a scheduled multi-source transition and compare intended/rendered positions | Timing stays within the backend's predeclared tolerance with no accumulating musical drift. |
| Callback work | Inspect and instrument the render path under load | No model/network/file-write work or unbounded allocation/blocking in the real-time callback. |
| Stem alignment | Load an aligned bundle and repeat substitutions | Shared timeline preserved; no unintended offset, restart, or skipped pickup. |
| Gain/tails | Render transitions with full context and measure output | No unintended clipping, discontinuity or chopped tail; listening confirms balance. |
| Phase/low end | Exercise overlapping bass and processed stems | Plan transfers roles intentionally; reviewed stretch path preserves acceptable cohesion. |
| Requests | Duplicate, reorder, expire and retry intents | Idempotent receipts, explicit conflicts, no duplicate audible operation. |
| Holds | Change external requests while holding recipe/state | Hold scope is respected; release produces a fresh planned transition. |
| Source failure | Missing/corrupt/unavailable next asset | Existing valid continuation or explicit fallback; visible failure reason. |
| Model failure | Timeout/crash/late completion of producer job | Playback remains independent; only eligible reviewed output reaches the library. |
| Device/lifecycle | Disconnect device, suspend/resume, close/reopen browser | Defined stopped/resumable state; one playback owner and no unexpected duplicate output. |
| Recovery | Restart during queued and active operations | New engine generation; stale commands rejected; unknown authoring outcomes reconciled. |
| Catalogue | Modify media or metadata revision | Dependent transition/review scope is invalidated or rechecked; old evidence remains historical. |
| Graph | Add an isolated asset or one-way dead end | Visible reachability/coverage issue; no invented compatibility. |
| Eligibility | Mark an item private-only or unreviewed | Public pack/export/automatic-selection policies respect the intended scope. |
| Reproduction | Replay seed/versions/event sequence | Same symbolic plan where promised; exact audio only where separately supported. |

Fix the measured environment and tolerances before a qualification run. If a tolerance changes, record why and rerun the affected evidence. Do not repeatedly broaden tests after the concrete risk is resolved.

## Listening review

Use matched playback gain for comparisons and enough context to hear a phrase develop. Review the actual rendered output, not only MIDI or spectra. Mark each dimension **acceptable**, **needs revision**, **blocked**, or **not evaluated**, with a short observation and next action.

| Dimension | Listening questions |
| --- | --- |
| Groove | Does the rhythm feel intentional? Do accents and timing support the style? |
| Harmonic/melodic coherence | Do parts relate? Does a motif develop and return? Are tensions purposeful? |
| Sound quality | Do instruments have convincing tone and expression? Are artifacts distracting? |
| Arrangement | Does the piece move at a useful pace with enough repetition and contrast? |
| Transition | Does the next passage feel connected? Are phrase, bass, vocal and tail handoffs convincing? |
| State fit | Is the perceived energy/texture appropriate without relying on louder playback? |
| Variety | Are different seeds/families perceptibly different in useful ways? |
| Work-session usefulness | Does the soundtrack remain enjoyable without demanding unwanted attention? |

A suggested initial audition set is three recipes, three selected seeds per recipe, and three supported intensity levels. This is a proposed sampling plan, not a statistical quality guarantee. Include at least a few seeds chosen without listening first so the review does not only retain a flattering demonstration.

## Long runs

Use increasing duration only to resolve a remaining endurance or variety risk:

1. A short controlled run proves basic operations and transition types.
2. A real work-session run reveals interaction and repetition issues.
3. A longer unattended soak checks resource limits, queue behavior and catalogue traversal.
4. A 72-hour run is a later long-horizon qualification with explicit eligible-catalogue and variety goals.

A small fixture library can qualify endurance while repeating music; label that result accordingly. It cannot pass the three-day musical-variety goal. A large library can pass coverage without making every transition pleasant; listening evidence remains required.

Capture source/recipe/motif coverage, repeats by category, selection reasons, rejected candidates, transition failures/fallbacks, underruns, memory/cache/disk trends and producer-job interference. Logs must be bounded and retained outside real-time audio work.

## FL bridge qualification

Use a disposable copy of an original project. Record the actual FL version, scripting API capabilities, required user actions and plugins used. Demonstrate capability discovery, a bounded note edit, stale-project rejection, operation-status reconciliation, an explicit apply gate where needed, a render/export workflow, and the resulting audible asset.

Readback must inspect the affected scope or produced artifact. A keyboard shortcut firing is not proof the right project received the edit. A successful render file existing is not proof it contains the intended musical change. See [FL integration](FL_STUDIO_INTEGRATION.md).

## Model and voice qualification

Pin the code/checkpoint/dependency versions and exact intended-use eligibility. Measure time and memory on the selected machine. Compare pronunciation, note/timing adherence, phrasing, voice continuity, artifacts, stem bleed and repair effort. Test at least one revision request, not only first-pass generation. See [Vocal production](guides/VOCAL_PRODUCTION.md).

## Acceptance records

A record contains the outcome, evidence, current limits and the next action. For a failure, distinguish reproduced defect, inspection-based risk, and suggested improvement. A later file hash mismatch does not erase the historical observation; it means current applicability needs fresh judgment against the new revision.

Campaign reviews use **KEEP / CHANGE / DEFER**. They do not silently expand scope or treat a speculative enhancement as a blocking defect. The owner listening gate decides whether the supported musical experience is useful enough for the initial release.
