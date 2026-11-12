# Documentation map

Status: S01–S09 are in main. **S09 real FL import is complete** ([guide](S09_FL_IMPORT.md), [handoff](handoffs/EMF-S09-HANDOFF.md)). Real FL Studio renders play in the DJ's hybrid handoff and the sampler through the unchanged pack contract; the pack is owner-local. Windows only: 166 Node tests, 24 native offline groups and 16 browser groups passed; macOS/Linux were not run. Physical output and listening are NOT TESTED. The first S11 increment (local library, recipe replay and three recipe studies; [guide](S11_LIBRARY.md), [handoff](handoffs/EMF-S11-HANDOFF.md)) is also in main, with 182 Node tests. Next is S10 owner listening; MVP acceptance remains open.

## Start with the next audible result

Read [Product goal](PRODUCT_GOAL.md) → [First playable](FIRST_PLAYABLE.md) → [Architecture](ARCHITECTURE.md). The [40-question review](reviews/MISSION_CONTROL_FIRST_REVIEW.md) explains earlier design scrutiny; the subsequent owner decision puts the standalone system before Mission Control integration. Windows, macOS and Linux are required targets, with Windows first for real FL authoring.

## Product and system owners

| Document | Owns |
| --- | --- |
| [Product goal](PRODUCT_GOAL.md) | Intended experience, preserved requirements and first-product boundaries |
| [First playable](FIRST_PLAYABLE.md) | Selected audible-proof and usable-pilot contract |
| [Features](FEATURES.md) | Components and delivery scope |
| [Capabilities](CAPABILITIES.md) | Person-facing outcomes and optional/required dependencies |
| [Architecture](ARCHITECTURE.md) | Playback/production ownership, shared clock and renderer choice |
| [S01 foundation](S01_FOUNDATION.md) | Executable v0 pack/source/control contracts, portable setup and declared limits |
| [S02 player](S02_PLAYER.md) | Small Web Audio player, setup, clock/cue mapping, browser checks and lifecycle limits |
| [S03 DJ](S03_DJ.md) | Deterministic request integration, manual FIFO, Hold, cancellation, effect reconciliation and current demo controls |
| [S04 sampler](S04_PROCEDURAL.md) | Finite original-palette phrase plans, sampler lifecycle, shared-player audition, resource bounds and passing Windows/macOS/Linux native/browser evidence |
| [S05 hybrid](S05_HYBRID.md) | The checked A → procedural bridge → B policy, role lead-in and tail, DJ handoff choice, bridge seed/state reporting and Windows native/browser evidence |
| [S06 import](S06_IMPORT.md) | The producer delivery format, the importer and its refusals and receipt, the performer palette contract and the mock FL producer (no FL Studio) |
| [S07 app](S07_APP.md) | Integrated demo, original/imported palette comparison, repeatable gates, review and Windows-only proof limits |
| [S09 FL import](S09_FL_IMPORT.md) | Real FL renders through the unchanged contract, owner-local rights, fade-cut shaping, per-route hybrid policies and handoff measurements |
| [S11 library](S11_LIBRARY.md) | Versioned local library, saved recipe replays, stopped restore, renderer history, three recipe studies and their limits |
| [EUTONOS Studio](STUDIO_APP.md) | The three-tab page (Produce, DJ Booth, Library) over the existing engines, the optional Music Studio generator link and its browser check |
| [Audio analysis](AUDIO_ANALYSIS.md) | Offline WAV/pack measurement command: loudness, levels and spectral balance, with its limits |
| [S10 listening scorecard](S10_LISTENING_SCORECARD.md) | Blank owner scorecard for the S10 listening session |
| [Local generators](proposals/LOCAL_GENERATORS.md) | Proposal: local music-generation candidates (nothing installed or heard by this repo) |
| [S08 FL authoring](S08_FL_AUTHORING.md) | Shared Claude Code/Codex MCP facade for FL Studio: tools, registration, host behavior and limits |
| [Library/transitions](LIBRARY_AND_TRANSITIONS.md) | Full asset, compatibility, curation, history and variety design |
| [State/API](STATE_AND_CONTROL_API.md) | Intent, actual playback, command/hold/retry semantics and proposed tools |
| [Test app](TEST_APP.md) | Simple MC-facing controls and advanced audition laboratory |
| [FL integration](FL_STUDIO_INTEGRATION.md) | Official capabilities, community MCP research and bounded bridge |
| [Vocals/models](VOCALS_AND_MODELS.md) | Production candidates, exact evidence and limits |
| [Validation](VALIDATION.md) | Musical proof, actual consumer, listening and operational qualification |
| [Examples](examples/README.md) | Illustrative data contracts, not implemented schemas |

[First playable](FIRST_PLAYABLE.md) is the current standalone three-layer MVP contract and supersedes prior MC-first delivery sequencing.

[Unified FL Studio agent control](FL_AGENT_CONTROL.md) is the current MCP-first authoring contract for Codex/Claude; the longer [FL integration](FL_STUDIO_INTEGRATION.md) remains supporting research. A visual controller is optional, not required for authoring.

## Learning and creation

The [guidebook](guides/README.md) retains detailed foundations, genre vocabulary, FL workflow, arrangement/mixing/taste, recipe authoring, agent workflow and vocal production. These are creator resources; listening does not require reading them. Technical possibilities in a guide do not automatically enter the pilot scope.

## Work and evidence

| Document | Owns |
| --- | --- |
| [Current Tasks](CURRENT_TASKS.md) | Priority and immediate pickup |
| [EMF campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) | Sole stage/status/acceptance owner and CLOUD/PC/BOTH slice order with handoffs |
| [EMD campaign](campaigns/EMD_DJ_APP.md) | Human-facing DJ app on the shared DJ interface, after EMF's Mission Control adapter |
| [EMS campaign](campaigns/EMS_MUSIC_STUDIO.md) | Owner-local Music Studio improvements and the rated-takes export to the DJ |
| [Delivery plan](DELIVERY_PLAN.md) | Proof, pilot, authoring, full qualification and earned later expansion |
| [Decisions](DECISIONS.md) | Stable design choices and reconsideration conditions |
| [Work model](WORK_MODEL.md) | Repo-local convention and **mandatory detailed + mini handoffs** at every slice |
| [Handoffs](handoffs/README.md) | Reusable closeout template, historical pickup briefs and actual slice handoffs |
| [Progress](PROGRESS.md) | Versioned historical checkpoints and validation limits |
| [Review](reviews/MISSION_CONTROL_FIRST_REVIEW.md) | Forty questions answered, ten strengths and primary-source checks |
| [Research map](RESEARCH.md) | Existing source routes and provider evidence |

Read [AGENTS](../AGENTS.md) before changing files. Do not infer shipped capability from any proposal, upstream project, written guide or prepared stage.
