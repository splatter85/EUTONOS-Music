# Product goal

Document ID: `EM-D001`  
Status: preliminary design, revised 2026-11-03 after the owner's Mission Control-first clarification. No runtime qualification is claimed.


> **Current scope override (2026-11-03):** [First playable](FIRST_PLAYABLE.md) defines the standalone three-layer MVP. Existing MC-first language in older background sections describes the future consumer, not the initial implementation order. Mission Control integration must wait until the standalone test app works.

## Purpose and first product

Build an enjoyable **standalone three-layer** music player/generator, then integrate it into **EUTONOS Mission Control**. It combines the quality of authored recordings, the development of a procedural performer and the selection/transition judgment of a DJ. The initial value is a soundtrack people choose to use while working in Mission Control, not a general streaming service or a standalone production platform.

The owner explicitly leaves room for something bigger if it is excellent. Preserve a neutral state interface, versioned assets/recipes and separable authoring because they already help this use case. Do not prebuild speculative accounts, cloud services, marketplaces, multiple DAWs or multiple production renderers. A concrete new consumer or recurring need can justify a later expansion.

A separate listening app is the laboratory and fallback control surface. It is not a substitute for testing the real Mission Control experience.

## Preserved owner requirements

IDs and long-term intent from the initial baseline remain intact; delivery order is not feature removal.

| ID | Requirement | Design meaning |
| --- | --- | --- |
| EM-R001 | Externally controlled musical state | Mission Control is first; the core accepts neutral intent and remains separately testable. |
| EM-R002 | State persistence | Dwell, phrase boundaries and gradual release prevent momentary input noise from replacing music. |
| EM-R003 | Fluid transitions | Plan rhythm, harmony, entry/exit, bass/vocal ownership and tails, with an honest fallback. |
| EM-R004 | Real musical variety | Multiple identities per state and meaningful variation inside each identity. |
| EM-R005 | Recorded and procedural cooperation | One musical timeline, context and role plan governs accompaniment and handoffs. |
| EM-R006 | FL Studio production | Author music and palettes with a verified installed toolchain; manual export is a valid first route. |
| EM-R007 | Agent-assisted creation | Retain a bounded, discoverable FL MCP bridge with supported edits and artifact readback. |
| EM-R008 | Plain-language musical direction | Translate an intended feeling/change into a reversible brief and auditionable revision. |
| EM-R009 | Local and agent-driven options | Optional production backends; none required for ordinary listening. |
| EM-R010 | Good vocals | Deliberate provider-specific singing/voice production, with listening and intended-use evidence. |
| EM-R011 | Browser controls with local execution | Select one renderer from evidence; browser proof first, native route if the required behavior warrants it. |
| EM-R012 | Three-day listening horizon | Retain the library/variety ambition; qualify endurance and musical breadth separately. |
| EM-R013 | Learnable production | Keep detailed foundations, genre, FL, recipe and production guides as an authoring reference. |
| EM-R014 | Public, portable project | Separate public contracts/code from private media, credentials, tools and restricted assets. |

## Early finish lines

[First playable](FIRST_PLAYABLE.md) owns the exact pilot contract. First prove a roughly twenty-minute musical journey with two distinct recordings, one credible procedural identity and multiple variations, deliberate handoffs, manual state control and hold. This is a proposed experiment format, not an established quality threshold.

Then deliver a usable Mission Control pilot: several musical families, a small approved library, simple controls, actual consumer integration, bounded history, safe recovery and real work-session listening. It can be useful before the full authoring bridge is complete. The whole EMF campaign still retains its authoring and final acceptance requirements.

## Musical behavior

Browse, Explore, Drive, Surge and Afterglow are editable musical profiles, not diagnoses. A state describes a target range for drive and texture; a recipe describes identity; a variation describes a performance. Staying in Explore can include new motifs and different pieces. Moving to Drive can develop the current piece instead of replacing it.

Preserve recognizable material long enough to establish an idea, then develop or change it intentionally. Permit local release inside a high-energy state. Keep novelty, tension, rhythmic density, tempo and volume distinct. Afterglow can retain motion without endless escalation. Silence, pause and a fixed-state session are valid listener choices.

The listener wins conflicts with automatic input. The product is not intended to maximize typing, time-on-task or engagement. Adaptation helping a particular listener is a hypothesis to compare against fixed-state music, not a promised productivity effect.

## Consumer and creator experience

The listener path is enable Music, press Play, choose a vibe. Default controls are transport, volume/mute, vibe, energy, variety and Hold. Advanced musical controls and diagnostics belong in the laboratory. No production tutorial, account, FL installation, model download or GPU should be needed to play an approved starter pack.

The creator path uses FL Studio and the guides to produce eligible material; agents can help prepare MIDI/scripts and bounded revisions. Full automation is built when it removes a concrete production bottleneck. An agent must distinguish note edits, artifact readback and measurements from actually hearing the music.

## Quality targets

| Target | Required evidence | Insufficient evidence |
| --- | --- | --- |
| Enjoyable Mission Control soundtrack | Actual work-session preference, distraction and voluntary-reuse observations | A feature count or a productivity claim based on typing |
| Musical handoffs | Heard recordings with context, timing and role/tail checks | Buffers overlap without an error |
| Coherent variation | Several preselected/held-out seeds and supported control ranges heard | Notes stay in a scale |
| State usefulness | Fixed/adaptive comparison and respected manual overrides | Slider values change |
| Reliability | Named-environment load, duplicate-tab, reconnect and recovery checks | One short successful run |
| Real variety | Recipe/motif/palette history and representative listening | Multiplying recipe and seed counts |
| FL authoring | Verified supported edit and resulting artifact in the intended project | A shortcut or MCP acknowledgment |
| Vocal quality | Actual pitch, diction, expression and transition review | A model name or demo from another project |

No result in this table has been measured for this repository yet.

## Boundaries and later growth

The first proof intentionally uses controlled tempo/meter/harmony and a small corpus. The pilot broadens identities without claiming every genre, arbitrary-song accompaniment, universal seamless transitions or three days of unique output. Unsafe overlaps may use a bridge or a deliberate fade. Missing harmonic knowledge prevents the unsupported operation, not ordinary permitted playback.

Retain full FL integration, local-model production and vocals in their staged work; do not delete them to simplify the first listener path. Broad production providers, catalogue publishing, remote streaming and a separate product expansion wait for concrete need and their own qualification. Project/code/content licensing stays open until deliberately selected.

## Principles

1. Good musical material and arrangement are part of the engineering problem from the start.
2. One audio clock owns timing; requests express intent, not audible completion.
3. Listener control outranks automatic input; music failure cannot break Mission Control work.
4. Production jobs run ahead; missed production deadlines cannot demand a new beat from a model.
5. Review scope follows versions, supported operations and intended use; history remains historical.
6. First prove the experience, then generalize only the parts that earn it.
7. Keep implementation, publication, runtime checks and listening acceptance separate.

## Remaining decisions

Actual musical families and taste settings need listening. Actual FL capabilities, renderer/lifecycle behavior and resource budgets need host evidence. A public starter pack needs appropriate assets and distribution permission. The initial singing route and project licenses remain separate choices. These do not block the design review; [EMF](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) schedules the relevant investigations.
