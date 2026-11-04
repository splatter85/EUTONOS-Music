# Preliminary features

Document ID: `EM-D002`  
Status: proposed catalogue, revised 2026-11-03. All runtime features remain planned.

The first delivery is the three-layer standalone system and little test app; Mission Control integration follows. Delivery labels below select when a feature is useful; they do not remove the larger scope or claim implementation. The guidebook is documentation already present.

| Stable ID | Feature | Delivery | Initial behavior | Canonical owner |
| --- | --- | --- | --- | --- |
| EM-F001 | State controller | Pilot | Profiles, hold and requested/planned/audible state | [Design](STATE_AND_CONTROL_API.md) |
| EM-F002 | Local audio engine | Pilot | One selected renderer, clock and playback owner | [Design](ARCHITECTURE.md) |
| EM-F003 | Browser listening app | MVP, then MC | Standalone state/genre/next-song test page first; MC integration later | [Design](TEST_APP.md) |
| EM-F004 | Music library | Pilot, then expand | Versioned sources with operation-specific readiness | [Design](LIBRARY_AND_TRANSITIONS.md) |
| EM-F005 | DJ selector | Pilot | Deterministic state/recency/preference selection | [Design](LIBRARY_AND_TRANSITIONS.md) |
| EM-F006 | Transition planner | Pilot | Authored routes first; directed bridges and diagnostic growth | [Design](LIBRARY_AND_TRANSITIONS.md) |
| EM-F007 | Procedural performer | Proof then pilot | One credible identity first, several families for pilot | [Design](guides/RECIPE_AUTHORING.md) |
| EM-F008 | Hybrid arrangement engine | Proof then pilot | Shared musical plan and explicit role handoff | [Design](ARCHITECTURE.md) |
| EM-F009 | External control API | MVP, then MC | Standalone test app requests state/genre/next first; MC adapter later, with revision/receipt semantics | [Design](STATE_AND_CONTROL_API.md) |
| EM-F010 | Playback MCP adapter | Pilot hardening | Bounded agent playback tools; not needed to start first sound | [Design](STATE_AND_CONTROL_API.md) |
| EM-F011 | Unified FL Studio MCP bridge | **MVP authoring**; extend later | One Codex/Claude interface, FL script + tested UI/export routes, verified editable changes and actual audio | [Design](FL_AGENT_CONTROL.md) |
| EM-F012 | Production job adapters | After usable pilot | Ahead-of-playback jobs and reviewed artifacts; EMF16 retained | [Design](ARCHITECTURE.md) |
| EM-F013 | Vocal production pipeline | Later selected route | Provider-specific controllable singing/voice workflow | [Design](VOCALS_AND_MODELS.md) |
| EM-F014 | Production guidebook | Documentation present | Detailed learning/reference; not a listening prerequisite | [Design](guides/README.md) |
| EM-F015 | Session memory and favorites | Pilot | Versions/seeds/history, scoped feedback and saved vibes | [Design](LIBRARY_AND_TRANSITIONS.md) |
| EM-F016 | Qualification and diagnostics | Proof onward | Engineering and actual listening evidence, separately | [Design](VALIDATION.md) |

## Scope

[First playable](FIRST_PLAYABLE.md) defines the thin proof and usable pilot. Manual FL steps are allowed where an API lacks capability, but the MVP must prove **one real agent-to-FL MCP editing/export operation**. A listener does not need the authoring bridge, FL, GPU, model or agent account after importing material. The broader automation and production-job interfaces remain later expansions.

Broad genre packs, more DAWs, more voice/model providers, independent stretching, remote audio streaming and public catalogue services are later opportunities. A new consumer must justify expansion; the neutral API alone does not require a platform.

## Status rule

Preserve feature IDs. A feature is implemented only with code and a reproducible demonstration; qualified only for tested environments/content. Documentation, seeds and upstream demos cannot promote a runtime feature to complete. [Capabilities](CAPABILITIES.md) keeps the person-facing outcomes separate from these components.
