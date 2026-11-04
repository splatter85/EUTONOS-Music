# Design decisions and open questions

Document ID: `EM-D011`  
Status: proposed design decisions, revised 2026-11-03.

Owner direction: Mission Control music first, possible growth later, focus on making it work. Other engineering decisions below are this review's recommendations within that direction, not unrun qualification results. The initial versions of EM-DEC001–010 are preserved at baseline `ee7125e`; their stable identities remain.

| ID | Current decision | Reason and reconsideration trigger |
| --- | --- | --- |
| EM-DEC001 | MC is the first real consumer; neutral state interface remains separately testable | A reusable seam helps testing now. Add other consumers only for concrete need. |
| EM-DEC002 | Investigate Web Audio first; choose one pilot backend at EMF03 | Revises presumed native architecture. Choose native when required lifecycle/resource/audio behavior or independent persistence warrants it. |
| EM-DEC003 | One audio clock and one playback owner | Avoid competing sessions. A future multi-output design needs explicit qualification. |
| EM-DEC004 | Recorded/procedural sources share musical context and roles | Preserve constrained handoff first, then generalize with listening evidence. |
| EM-DEC005 | DAW/model work prepares future material outside audio deadlines | Ordinary listening remains useful when production is late, absent or offline. |
| EM-DEC006 | State, identity and variation are separate | A mood can stay while music changes; one identity can develop across states. Revise mappings from listening. |
| EM-DEC007 | Compatibility is directed and version/scenario-specific | Start with a few authored routes; generalize only within tested content classes. |
| EM-DEC008 | Three-day endurance and musical breadth are separate | Seed counts and graph reachability do not establish enjoyment. |
| EM-DEC009 | Intended-use provenance is required for distributed packs | Private authoring, compositions, stems, reusable sounds and weights are distinct decisions. |
| EM-DEC010 | Work follows the current bounded assignment; S01 implementation/publication is authorized | Supersedes the original documentation-only restriction for this assigned slice. No runtime or listening stage closes without its actual evidence. |
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

**EM-DEC021:** The owner requires **Windows, macOS and Linux** support. Windows may lead the FL Studio/MCP integration; shared pack/playback/control code remains portable and OS-specific authoring behavior stays behind explicit adapters. Automated checks run on all three OSes. Browser lifecycle, audio output and FL compatibility require separate real-host evidence.

**EM-DEC022:** Implement a small versioned `em.audio-pack.v0` with PCM16 WAV, authored constant-tempo 4/4 cues, bounded data and exact media/reference validation. Use original, reproducible synthetic fixtures for contract/timing work, marked `fixture-only`. Descriptive recipe references do not constitute a generator. The common source and request harness do not constitute a DJ or audio renderer. [Executable boundary and omissions](S01_FOUNDATION.md).
