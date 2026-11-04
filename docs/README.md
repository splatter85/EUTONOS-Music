# Documentation map

Status: Mission Control-first design and production guidebook, revised 2026-11-03. Runtime work is still planned.

## Start with the next audible result

Read [Product goal](PRODUCT_GOAL.md) → [First playable](FIRST_PLAYABLE.md) → [Architecture](ARCHITECTURE.md). The [40-question review](reviews/MISSION_CONTROL_FIRST_REVIEW.md) explains what changed and which assumptions still need tests. Mission Control is first; future growth remains possible without making a broader platform a prerequisite.

## Product and system owners

| Document | Owns |
| --- | --- |
| [Product goal](PRODUCT_GOAL.md) | Intended experience, preserved requirements and first-product boundaries |
| [First playable](FIRST_PLAYABLE.md) | Selected audible-proof and usable-pilot contract |
| [Features](FEATURES.md) | Components and delivery scope |
| [Capabilities](CAPABILITIES.md) | Person-facing outcomes and optional/required dependencies |
| [Architecture](ARCHITECTURE.md) | Playback/production ownership, shared clock and renderer choice |
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
| [EMF campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) | Sole stage/status/acceptance owner, grouped delivery milestones |
| [Delivery plan](DELIVERY_PLAN.md) | Proof, pilot, authoring, full qualification and earned later expansion |
| [Decisions](DECISIONS.md) | Stable design choices and reconsideration conditions |
| [Work model](WORK_MODEL.md) | Readable repo-local EUTONOS-style convention |
| [Progress](PROGRESS.md) | Versioned historical checkpoints and validation limits |
| [Review](reviews/MISSION_CONTROL_FIRST_REVIEW.md) | Forty questions answered, ten strengths and primary-source checks |
| [Research map](RESEARCH.md) | Existing source routes and provider evidence |

Read [AGENTS](../AGENTS.md) before changing files. Do not infer shipped capability from any proposal, upstream project, written guide or prepared stage.
