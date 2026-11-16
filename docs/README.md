# Documentation map

Status: S01–S09 and S14/S15 DJ transitions are in main. The first S11 increment is integrated; [Studio](STUDIO_APP.md) uses its pattern save/restore, while the legacy DJ and sampler pages remain unwired. **EMS-S01 rated export + EMF-S16 intake are COMPLETE for engineering scope; all full gates passed, with local main integration/readback verified at `7b3b7ae602fab01cb06f8e2ea630e4d40fbe1aae`** ([contract](S16_RATED_TAKES.md)). EMS-S03 is complete; EMS-S07 is paused on owner A/B. S10 owner listening follows the rated-takes handoff, then S12 Mission Control. Recent engineering evidence is Windows-only; physical output, listening and MVP acceptance remain open. [Current Tasks](CURRENT_TASKS.md) routes current evidence.

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
| [Rated-takes handoff](S16_RATED_TAKES.md) | EMS-S01 export and EMF-S16 owner-local catalogue and explicit DJ audition contract; [export evidence](handoffs/EMS-S01-HANDOFF.md), [intake evidence](handoffs/EMF-S16-HANDOFF.md) |
| [S11 library](S11_LIBRARY.md) | Versioned local library, saved recipe replays, stopped restore, renderer history, three recipe studies and their limits |
| [DJ transitions](DJ_TRANSITIONS.md) | EMF-S14 analysed mix points, EQ/filter handovers, prepared tempo/pitch and the automatic `mix` handoff |
| [Phone listening](S17_PHONE_LISTENING.md) | EMF-S17 (in progress): streaming the live PC DJ to a phone through the loopback relay and Tailscale serve, phone remote commands, security split and limits; [evidence](handoffs/EMF-S17-HANDOFF.md) |
| [EUTONOS Studio](STUDIO_APP.md) | The three-tab page (Produce, DJ Booth, Library) over the existing engines, the optional Music Studio generator link and its browser check |
| [Audio analysis](AUDIO_ANALYSIS.md) | Offline WAV/pack measurement command: loudness, levels and spectral balance, with its limits; also the bar-grid command (`eutonos.bar-grid.v1`) used for snap-to-bars |
| [S10 listening scorecard](S10_LISTENING_SCORECARD.md) | Blank owner scorecard for the S10 listening session |
| [DJ transitions research](proposals/DJ_TRANSITIONS_RESEARCH.md) | Proposal: research synthesis and recommended order for EMF-S15; its delivered engineering scope is recorded in the S15 handoff, listening remains untested |
| [Music Studio arranger](proposals/STUDIO_ARRANGER.md) | Proposal: Song Plan, recipe modes, timeline, region edits, DJ as co-producer and quality passes, with the timeline spike (EMS-S07 to S12) |
| [Arranger research](proposals/STUDIO_ARRANGER_RESEARCH.md) | Research: product timeline concepts, song-editing tools, stronger local models and ACE-Step quality levers (nothing installed or heard) |
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
| [Runtime review](reviews/MUSIC_RUNTIME_REVIEW_20261114.md) | Bounded 2026-11-14 integrity, playback ownership and Studio request/cancellation findings; corrections and final verification status |
| [Research map](RESEARCH.md) | Existing source routes and provider evidence |

Read [AGENTS](../AGENTS.md) before changing files. Do not infer shipped capability from any proposal, upstream project, written guide or prepared stage.
