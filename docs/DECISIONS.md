# Design decisions and open questions

Document ID: `EM-D011`  
Status: current design decisions, including S01/S02/S03/S04/S05/S08 implementation. S03–S05 are in main; S05 was built on the PC. Revised 2026-11-05.

Owner direction: Mission Control music first, possible growth later, focus on making it work. Other engineering decisions below are this review's recommendations within that direction, not unrun qualification results. The initial versions of EM-DEC001–010 are preserved at baseline `ee7125e`; their stable identities remain.

| ID | Current decision | Reason and reconsideration trigger |
| --- | --- | --- |
| EM-DEC001 | MC is the first real consumer; neutral state interface remains separately testable | A reusable seam helps testing now. Add other consumers only for concrete need. |
| EM-DEC002 | Native Web Audio buffer sources and gain automation selected for the S02 cloud player | One context owns starts, fades and stops; native offline/live Chromium evidence is recorded in the S02 handoff. Reconsider only for a measured lifecycle/resource/output requirement; physical reference-host qualification remains open. |
| EM-DEC003 | One audio clock and one playback owner | Avoid competing sessions. A future multi-output design needs explicit qualification. |
| EM-DEC004 | Recorded/procedural sources share musical context and roles | Preserve constrained handoff first, then generalize with listening evidence. |
| EM-DEC005 | DAW/model work prepares future material outside audio deadlines | Ordinary listening remains useful when production is late, absent or offline. |
| EM-DEC006 | State, identity and variation are separate | A mood can stay while music changes; one identity can develop across states. Revise mappings from listening. |
| EM-DEC007 | Compatibility is directed and version/scenario-specific | Start with a few authored routes; generalize only within tested content classes. |
| EM-DEC008 | Three-day endurance and musical breadth are separate | Seed counts and graph reachability do not establish enjoyment. |
| EM-DEC009 | Intended-use provenance is required for distributed packs | Private authoring, compositions, stems, reusable sounds and weights are distinct decisions. |
| EM-DEC010 | Work follows the current bounded assignment: S04 CLOUD implementation/verification and publication on its separate work branch; main stayed unchanged during that delivery by explicit owner instruction, and the PC integrated it afterwards | S04 is verified on all three OSes and delivered on the checked work branch. The PC then integrated it into main, together with the EUTONOS registration. S05 is next only when separately assigned. Later slice ordering is not automatic dispatch; no runtime or listening stage closes without actual evidence. |
| EM-DEC011 | Audible proof precedes broad infrastructure | EMF04 demonstrates a controlled recorded/generated journey; EMF05 reviews it before breadth. |
| EM-DEC012 | FL MCP and production jobs stay in full EMF but do not block usable MC pilot | EMF15/16 are retained. Advance only a narrow helper when a measured bottleneck justifies it. |
| EM-DEC013 | Adaptation is optional and tested against fixed-state music | No productivity or attention inference from activity counts alone. |
| EM-DEC014 | Basic panel is small; laboratory holds advanced sliders | Expand visible controls only when listeners need them. |
| EM-DEC015 | Metadata readiness follows the requested operation | Ordinary playback, cue mixing and hybrid accompaniment need different knowledge. |
| EM-DEC016 | Procedural review qualifies a bounded recipe envelope, not every possible seed | Use held-out listening, runtime validity limits and fallback; no universal taste guarantee. |
| EM-DEC017 | Actual MC use is pilot acceptance; simulation is not | Integrate an explicit control early and verify the real consumer before claiming a usable MC pilot. |
| EM-DEC018 | Listener transport/hold and work isolation outrank automation | Music never overrides an explicit stop or disables MC work functions. |
| EM-DEC019 | Initial DJ uses inspectable deterministic rules | A model-based selector must demonstrate benefit, cost and failure isolation before replacing it. |
| EM-DEC020 | Broader product scope is earned by a real consumer/problem | Keep neutral interfaces; do not prebuild cloud/accounts/marketplaces or universal plugin systems. |
| EM-DEC030 | No automatic CI; slices may be built on the PC or in the cloud and merged directly | Owner decision, 2026-11-04. Run `npm run check` and `npm run check:browser` on each OS available and report which ran. Reconsider if macOS/Linux regressions go unnoticed. |

## Open, evidence-dependent choices

Actual palette/family preferences, default dwell/contrast/variation, renderer behavior, host/plugin capabilities, resource budgets and first distributable fixture pack need experiments. Project/code/content licenses and any selected voice/model route remain explicit decisions. None is silently resolved by calling a repo public or by this review naming a candidate.

[EM-REVIEW-001](reviews/MISSION_CONTROL_FIRST_REVIEW.md) answers the forty scrutiny questions and names checks that could change these decisions. [First playable](FIRST_PLAYABLE.md) and [Delivery plan](DELIVERY_PLAN.md) translate them into a smaller path to sound. The full [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) retains status and acceptance authority.

## Owner narrowing — standalone MVP, 2026-11-03

**EM-DEC011:** Standalone creation controller, procedural performer and DJ plus a tiny app precede Mission Control. This supersedes the previous MC-first *delivery order*, not the neutral interfaces.

**EM-DEC012:** “Visual Basic AI controller” is provisionally interpreted as a tiny VB.NET Windows UI using one real Codex/Claude → FL Studio editable creation/export route. If the owner meant a visually basic controller rather than the VB.NET language, substitute its shell without changing the audio/content contract.

**EM-DEC013:** Start with two compatible recordings, one original sound palette/recipe, and approved transitions. Defer broader automation, genre mixing, vocals and 72-hour variety. No runtime work has yet passed.

## Correction: agent control is MCP-first, 2026-11-03

**EM-DEC014:** The previous provisional VB.NET-first assumption in EM-DEC012 is superseded. One unified **MCP server for Codex and Claude Code** owns the FL Studio authoring interface; a visual/VB.NET controller is optional and uses the same server. Selectively adapt existing FL community bridges rather than concatenate/install all of them. The interface exposes supported FL Python APIs and tested UI/CLI export methods, with session locks, capability discovery, readback and safe recovery. The goal is maximal *verified* authoring control, not a universal automation claim. [Canonical design](FL_AGENT_CONTROL.md). No controller or runtime has been installed by this decision.

## S01 and platform direction — 2026-11-04

**EM-DEC021:** The owner requires **Windows, macOS and Linux** support. Windows may lead the FL Studio/MCP integration; shared pack/playback/control code remains portable and OS-specific authoring behavior stays behind explicit adapters. Checks run on each OS that can be reached, reported per OS (EM-DEC030). Browser lifecycle, audio output and FL compatibility require separate real-host evidence.

**EM-DEC022:** Implement a small versioned `em.audio-pack.v0` with PCM16 WAV, authored constant-tempo 4/4 cues, bounded data and exact media/reference validation. Use original, reproducible synthetic fixtures for contract/timing work, marked `fixture-only`. Descriptive recipe references do not constitute a generator. The common source and request harness do not constitute a DJ or audio renderer. [Executable boundary and omissions](S01_FOUNDATION.md).

## S02 renderer and transport — 2026-11-04

**EM-DEC023:** Use one `AudioContext` with native `AudioBufferSourceNode` and `GainNode` for the small recording player. Convert authored file-domain cues into output-clock frames, including pickups and selected entry offsets. Schedule incoming start, complementary linear fades and outgoing stop in advance on that one clock; UI animation only reads state. Native checks pass at 48 kHz and 44.1 kHz on the named Windows/macOS/Linux Chromium runners. A one-frame natural decoder EOF difference is recorded separately from exact cue boundaries. [Implementation and evidence](handoffs/EMF-S02-HANDOFF.md).

**EM-DEC024:** Pause gates output and suspends the same clock, retaining a pending handoff and the cooperating-tab ownership lease. Stop/replacement releases active/future sources and invalidates generation. Rejected Resume ownership suspends the retained timeline. A hidden page requires explicit Resume; reload starts stopped. Same-origin Web Locks prevent competing demo tabs but do not claim OS-wide or distributed ownership. Reconsider these bounded policies only against a concrete later lifecycle requirement and real-host evidence.

## S08 FL authoring route — 2026-11-04

**EM-DEC025:** The first real FL path is **offline project authoring plus FL's own command line**, not live GUI scripting. On the reference PC WinMM exposes no MIDI input, so controller scripts cannot receive commands without a further install; GUI automation is excluded. A clean-room FLP codec edits pattern notes, tempo and clip length in disposable workspace copies of an allowlisted factory template; FL itself proves the edit by loading the saved project and exporting MIDI, and renders WAV with `/R /Ewav`. Writes are limited to the verified FL 24.x layout. Reconsider when a live controller bridge (virtual MIDI port) is assigned or FL's layout changes. [Details](S08_FL_AUTHORING.md).

**EM-DEC026:** Claude Code and Codex each launch their own stdio server process; coordination lives in the shared workspace, not in a resident daemon: a writer lease (TTL), an exclusive-create critical-section lock, SHA-256 revisions with `expected_revision`, a backup before every mutation and an append-only journal keyed by caller operation IDs (duplicate lookup precedes lease/revision checks; started-without-outcome requires reconciliation). Any running FL GUI instance is treated as a competing writer (`HOST_BUSY`). Reconsider if a resident broker is needed for live GUI control.

## S03 deterministic selection and cancellation — 2026-11-04

**EM-DEC027:** The first DJ is a typed in-process coordinator over the existing two-recording renderer. An explicit FIFO head precedes state/genre preferences but never bypasses eligibility, availability or a checked directed route. Automatic selection filters by the requested state/genre, excludes the current identity and uses stable ID order. A blocked head, unavailable match, missed cue or absent route preserves current finite playback and reports the reason. Queue/target/Next requests while stopped cannot start sound; Play is explicit. Hold refuses manual and automated state/genre changes while retaining transport and explicit queue/Next controls. No automatic loop, FIFO skip, queue drain or third voice is introduced. Reconsider wider selection only with S04/S05 source/route evidence. [Executable policy](S03_DJ.md).

**EM-DEC028:** Acceptance receipts and renderer effects are separate. Caller-known canonical retries recover the original receipt and current execution outcome without repeating native scheduling, including after Stop or a generation change. Retain reservations before awaits and consume a queue entry only after its native entry frame has been observed; delayed promise observation cannot put started music back in the queue. Before entry, Cancel next restores outgoing A's original envelope/end and removes B while retaining an unstarted queue entry. Cancellation after onset is refused; Stop/Mute remain immediate. Receipt durability, external adapters and expiry/lease rules remain later work. [Review and evidence](handoffs/EMF-S03-HANDOFF.md).


## S04 finite procedural source — 2026-11-04

**EM-DEC029:** Compile one immutable eight-bar S01-palette performance from an explicit uint32 seed and Explore/Drive arrangement, with a separately versioned executable performer and independent deterministic role streams. Schedule its complete bounded note set on the existing Web Audio clock; keep one pending/resolved verified palette decode per player, and recheck current permissions on every intent. Stop/replacement and stale-operation guards remain in the common player. Keep the first audition separate from the two-recording DJ: replacement playback, a whole-performance exit fade and recipe identity alone do not supply S05 hybrid overlap, role transfer or full replay identity. Symbolic replay, call/state tests, native PCM and the browser flow pass on Windows/macOS/Linux at the pinned source; physical output and listening remain untested. Reconsider broader recipes, imported plans and scheduling strategies only against a concrete supported-content or resource requirement. [Guide](S04_PROCEDURAL.md), [completed branch handoff](handoffs/EMF-S04-HANDOFF.md).

The native replay correction uses two fixed unity-gain buses (drum/percussion and bass/harmony) before the existing master. At most one active note per role bounds each sum to two active inputs. Both buses belong to the same gated scheduling/cleanup transaction. This preserves exact replay without widening the `0.000003` independent sample-oracle tolerance; failure cleanup and actual PCM replay passed at 44.1/48 kHz on all three OSes. Reconsider this grouping only with concrete additional-role/polyphony evidence, not as an unbounded general-purpose mixer. [Measured findings and independent review](reviews/EMF_S04_PROCEDURAL_REVIEW.md).

## S05 hybrid handoff — 2026-11-05

**EM-DEC031:** Hand off recording A → procedural bridge → recording B under one code-versioned policy, `s05-hybrid-handoff@1`, for the fixture's single route. Bass and harmony change owner only when the outgoing source is silent: the bridge's first bar plays percussion only while A fades, and at B's entry every non-percussion bridge attack is cancelled while only percussion fades over one bar. B enters at full gain on a phrase boundary. This avoids two simultaneous bass lines and keeps at most two nonzero sources summed, which preserves exact same-seed native replay. The timing and fades are engineering choices pending listening (S10); a new route, performer or timing needs a new policy revision.

## S06 producer import — 2026-11-05

**EM-DEC032:** The S04 performer plays any palette that meets one written rule, `s06-performer-palette@1`, instead of the S01 palette's exact identity: a 120 BPM, 4/4, four-bar recipe with a harmony and the requested state; exactly one drum, percussion, bass and harmony sample; pitched roles with a root and pitch classes inside the recipe harmony, unpitched roles with neither; and each sample no longer than its role's gap (drum ½, percussion ¼, bass 1, harmony 2 quarters, `maxRoleFrames` at the sample's own rate). Rate, channels, ids, keys, titles and hashes are labels, so two producers' palettes give the same events. The length rule holds at every native/output rate only because performer onsets sit on the sixteenth-note grid; a finer performer needs a new contract revision. Producers hand over data only (`em.producer-delivery.v0`); the importer measures every WAV itself, keeps PCM verbatim behind a canonical header, trims only a tail at or below −60 dBFS, never grants listening review and records the producer as unverified. The S05 policy and DJ stay bound to the S01 route and recipe until S09. Reconsider when a performer needs other tempos, meters, roles or finer onsets. [Guide](S06_IMPORT.md).

## S09 real FL import — 2026-11-07

**EM-DEC033:** Real FL Studio material joins through the unchanged S06 contract. The owner allows the FL factory-sound renders to be reused as samples on this PC only: the producer labels them `owner-local-only` with `playback` and `sample-reuse`, keeps them `fixture-only`, and writes them under the git-ignored `local/s09-fl/`; they are never committed, published or hosted, and the demo server exposes only the imported pack on loopback. One-shots that ring past their performer role gap are fade-cut by the producer (raised cosine over the last 30 %) and recorded in `shaping.json`; the importer's tail rule is not widened. The hybrid policy is chosen by exact route identity (`hybridPolicyForRoute`): one frozen policy per route revision, each naming its own recipe while sharing the S04 performer and S05 lead-in/tail. A revised route, recipe or performer needs a new policy. Reconsider the rights label if the owner obtains distributable sounds, and the per-route registry if packs must declare their own policies. [Guide](S09_FL_IMPORT.md).
