# Product goal

Document ID: `EM-D001`  
Status: preliminary product definition, 2026-11-03. Runtime behavior is not implemented or verified.

## Purpose

Create a music system that develops with a listener's chosen or externally supplied state. It should have the continuity of a thoughtfully arranged performance, the selection judgment of a DJ, and the variation of an instrument that can keep composing within a recognizable style.

The system can play finished recordings, coordinate stems, perform procedural recipes, and move between those sources. The output should sound like music somebody intended to make. Sound design, arrangement, phrasing, mixing, and listening judgment are part of the product, not finishing work added after a note generator.

## Owner requirements captured

| ID | Requirement | Meaning for the design |
| --- | --- | --- |
| EM-R001 | Externally controlled musical state | A consumer sends a target state; playback does not depend on one specific dashboard or agent harness. |
| EM-R002 | State persistence | A short input spike does not instantly replace the music. Hold periods, musical boundaries, and gradual release are explicit. |
| EM-R003 | Fluid transitions | The engine plans entries, exits, overlap, harmony, rhythm, low-end ownership, and tails; it has a fallback when a direct mix is unsuitable. |
| EM-R004 | Real musical variety | Multiple recipes and recorded selections can fit the same state. Long listening sessions change musical identity as well as surface details. |
| EM-R005 | Recorded and procedural music cooperate | Both use a shared transport and musical plan, with a defined method for entering, accompanying, and leaving a recording. |
| EM-R006 | FL Studio production | A capable FL Studio installation can author music, sound palettes, and reviewed assets for the engine. Exact installed version and entitlements still require discovery. |
| EM-R007 | Agent-assisted creation | Codex and Claude can use a bounded MCP bridge to inspect supported FL state, propose edits, apply supported operations, and produce reviewable artifacts. |
| EM-R008 | Plain-language musical direction | A person can describe a desired feeling or change; the assistant translates it into an explicit production brief and auditionable revision. |
| EM-R009 | Local and agent-driven options | Local models and an existing agent session are separate optional production backends. The player remains useful without either. |
| EM-R010 | Good vocals | Support deliberate vocal-production routes, including singing generation, with score/timing/expression controls where a selected provider supports them. |
| EM-R011 | Browser controls with local execution | A browser can control a local player. Heavy generation can run on the computer ahead of playback. |
| EM-R012 | Three-day listening horizon | Develop enough curated musical variety and selection memory for an interesting 72-hour horizon. Prove stability and musical variety separately. |
| EM-R013 | Learnable production | Detailed guides teach foundations, genre vocabulary, software workflow, arrangement, taste, and repeatable listening review. |
| EM-R014 | Public, portable project | Keep public code/contracts separate from private projects, licenses, accounts, models, and nonredistributable assets. |

## Who it serves

- A listener who wants to select a vibe and let music develop.
- A creator who uses a DAW and wants help building an adaptive music library.
- A developer who wants to drive music from an application through a stable interface.
- An agent user who wants Codex or Claude to help compose, edit, render, and organize music without relying on undocumented all-purpose DAW control.

Mission Control provides the initial motivating scenario: browse, explore, drive, surge, and afterglow. These are musical labels, not psychological diagnoses. The core system should accept explicit state and continuous controls even when no work-activity observer is installed.

## What success sounds and feels like

A listener can remain in one state and still experience several distinct musical ideas. A change in state can preserve the current motif and develop it before a larger change. When music switches source, the phrase, beat, and emotional direction still make sense. After a strong passage, the system can keep useful motion without continually escalating.

The engine should expose useful controls in ordinary language: energy, atmosphere, variation, transition length, hold, and allowed tempo movement. Technical details remain available for creators and diagnostics.

The user can say “less busy, keep the bass, more space around the melody,” hear an appropriate revision, and keep a version that works. The assistant must distinguish what it actually changed or listened to from what it inferred from MIDI, screenshots, or analysis.

## Quality targets and evidence

| Target | Evidence needed | What would not establish it |
| --- | --- | --- |
| Musical transitions | Recorded examples across approved transition types, timing checks, and listening review | Two buffers overlap without throwing an exception |
| Variety | Recipe/family/section coverage, recency behavior, representative long-session listening, and owner judgment | A large theoretical number of seeds |
| Coherent procedural output | Multiple independently selected seeds and states auditioned for groove, harmony, phrasing, tone, and mix | Notes remain inside one scale |
| Continuous playback | Soak logs on named hardware/backend, bounded resource growth, and recovery checks | A short interactive demo |
| Useful state control | Predictable requests, visible pending/current state, interrupt/hold behavior, and repeatable event replay | A slider updates a numeric variable |
| Useful FL integration | Verified version-specific supported edits and exported results with recoverable checkpoints | An MCP tool returns “success” |
| Vocal quality | Actual rendered phrases reviewed for intelligibility, pitch, expression, artifacts, and transitions | A model name or published benchmark |

These targets are design requirements. No baseline measurement is claimed by this documentation set.

## Scope boundaries

The first implementation campaign builds the mechanism and a small reference corpus. It does not complete every genre, guarantee universally perfect transitions, automate every FL Studio function, ship a singing model, or establish professional mastering quality.

“Flawless” is an artistic ambition. Engineering acceptance should name detectable failures and the musical contexts reviewed. A system can choose a bridge, a spacious breakdown, or an explicit short fade when an overlap would sound worse. It must show when a requested transition has no approved route.

Genre guides provide a broad starting vocabulary and a method for extending it. They are not a complete account of every musical tradition, and their ranges are examples rather than laws.

## Principles

1. Musical identity comes from authored relationships among rhythm, harmony, sound, and form.
2. The audio clock owns audible timing; control messages express intent.
3. A producer can revise or reject a generated result before it becomes eligible library material.
4. Generation jobs may miss deadlines without interrupting already prepared playback.
5. Every library entry retains provenance, revision, rights information, and review status.
6. A local listener can play approved content without an account, LLM, or running DAW.
7. Implementation, publication, test results, and artistic acceptance remain separate facts.

## Open product decisions

- Which three initial musical families best fit the owner's listening taste?
- Which installed FL version and plugin combinations can form a reproducible first production workflow?
- Which native playback backend meets the first Windows target with the smallest maintainable implementation?
- What license should cover project code, documentation, example recipes, and original audio packs?
- What should the default novelty/hold behavior be after actual listening trials?
- Which vocal route is sufficiently controllable and eligible for the intended personal or public output?

The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) turns these into bounded investigations before dependencies are selected.
