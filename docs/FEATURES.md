# Preliminary features

Document ID: `EM-D002`  
Status: proposed feature catalogue, 2026-11-03.

A feature is a named component or interface a user can point to. Every runtime entry below is **planned**. The delivered artifacts today are documentation and examples only. [Capabilities](CAPABILITIES.md) describes what a person should be able to accomplish using these features.

| Stable ID | Feature | Initial behavior | Canonical design |
| --- | --- | --- | --- |
| EM-F001 | State controller | Named states, continuous musical controls, hold/release, requested versus audible state | [State/API](STATE_AND_CONTROL_API.md) |
| EM-F002 | Local audio engine | One playback clock, asset streaming, synchronized stems, scheduled fades and output-device handling | [Architecture](ARCHITECTURE.md) |
| EM-F003 | Browser listening app | Transport controls, state selector, transition and variation sliders, timeline, audition comparison | [Test app](TEST_APP.md) |
| EM-F004 | Music library | Versioned tracks, stems, instruments, cues, recipes, assessments and eligibility | [Library](LIBRARY_AND_TRANSITIONS.md) |
| EM-F005 | DJ selector | State-aware selection with recency, variety, coverage and preference constraints | [Library](LIBRARY_AND_TRANSITIONS.md) |
| EM-F006 | Transition planner | Directed compatible routes, phrase-aligned plans, bridges, fallback paths and preview | [Library](LIBRARY_AND_TRANSITIONS.md) |
| EM-F007 | Procedural performer | Recipe-based notes, sample playback/synthesis, coherent variations and musical development | [Recipe guide](guides/RECIPE_AUTHORING.md) |
| EM-F008 | Hybrid arrangement engine | Recorded/procedural accompaniment and source handoffs under one musical plan | [Architecture](ARCHITECTURE.md) |
| EM-F009 | External control API | Revisioned state intent, idempotent commands, observable execution and replay | [State/API](STATE_AND_CONTROL_API.md) |
| EM-F010 | Playback MCP adapter | Agent tools for state, queue, inspection, hold and bounded audition control | [State/API](STATE_AND_CONTROL_API.md) |
| EM-F011 | FL Studio MCP bridge | Capability discovery, supported MIDI/Piano roll/controller operations, render preparation and artifact readback | [FL integration](FL_STUDIO_INTEGRATION.md) |
| EM-F012 | Production job adapters | Optional local model or agent-authored production jobs that yield reviewable artifacts | [Architecture](ARCHITECTURE.md) |
| EM-F013 | Vocal production pipeline | Provider-specific singing/voice workflows, phrase preparation and review | [Vocal models](VOCALS_AND_MODELS.md) |
| EM-F014 | Production guidebook | Theory, genre recipes, sound production, arrangement, mixing and natural-language briefs | [Guide index](guides/README.md) |
| EM-F015 | Session memory and favorites | Persisted seed, selected assets, history, preferences and save-this-vibe snapshots | [Library](LIBRARY_AND_TRANSITIONS.md) |
| EM-F016 | Qualification and diagnostics | Timing/resource evidence, transition logs, listening sheets and long-run coverage reports | [Validation](VALIDATION.md) |

## Initial infrastructure versus expansion

The initial campaign admits a minimal vertical path through these interfaces, not every proposed production feature. It should prove local playback, a modest approved library, several recipes, hybrid transitions, external state control, a useful FL bridge slice, and the boundaries around optional model jobs.

Broader genre packs, more DAWs, commercial voice-provider integrations, advanced stretching, remote audio streaming, and a large public pack catalogue are expansions. See [Delivery plan](DELIVERY_PLAN.md).

## Feature status changes

A feature becomes implemented only when code and a reproducible demonstration exist. It becomes qualified only for the named backends, content classes and scenarios tested. A documentation update cannot promote a runtime feature to complete. Preserve stable IDs when moving or splitting work; record aliases or supersession when meaning changes.
