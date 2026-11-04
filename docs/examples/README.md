# Illustrative contracts

These files make the proposed design concrete enough to discuss. They are **fictional, unimplemented examples**, not validated runtime schemas, authored music, available media, approved transition edges or installation instructions.

For executable v0 contracts and actual audio, use [S01 foundation](../S01_FOUNDATION.md) and [fixtures/s01](../../fixtures/s01/README.md). These historical larger examples deliberately remain separate.

| File | Shows |
| --- | --- |
| [Asset manifest](asset-manifest.example.json) | A coordinated recorded stem bundle with musical position, sections, cues and explicitly missing media/review evidence. |
| [Recipe](recipe.example.json) | A procedural identity, shared harmony, role constraints, variation budget and a palette still to be authored. |
| [Transition](transition.example.json) | A proposed recorded-to-procedural handoff using the same harmony phase and explicit role transfers. |
| [State intent](state-intent.example.json) | A caller-known command identity and the difference between requesting a target and scheduling audio. |
| [Production brief](production-brief.example.json) | Plain-language direction translated into editable musical requirements and a bounded production handoff. |

## How the examples connect

The stem bundle `demo.warm-a` has a 16-bar main section followed by a 16-bar development section. At 124 quarter notes per minute in 4/4, each section contains 64 quarter notes. Its proposed main-section exit is at quarter 32, leaving eight bars of source material available for the illustrated overlap.

The recipe `demo.recipe.warm-progressive` uses an eight-bar harmonic cycle: Am, F, C and G, two bars each. The transition begins at quarter 32 of the source, which is the start of the same harmonic cycle. The procedural timeline starts at quarter zero. Both sides therefore use the same chord at each point of this specific example. Matching the key label alone would not establish that relationship.

The transition lasts eight bars, or 32 quarter notes. Its role schedule describes an intended mix to audition; the times are not a claim that any actual bass, pad or lead will blend at those boundaries. All media, source-frame mappings, measured path latencies, rights checks and listening evidence are missing. The edge remains ineligible.

The palette is declared inside the recipe with no sound files. That makes the unfulfilled dependency explicit. There is no audio to play by parsing these files, and no runtime should substitute a default oscillator and call the intended production quality delivered.

## Units and identities

- All position/duration fields ending in `_quarters` use quarter-note units and zero-based positions. Cue numbers are not sample frames.
- BPM means quarter notes per minute. Meter maps remain explicit so other meters can be represented later.
- Source-frame/latency fields are unknown until the actual files and rendering paths are measured. An authored pickup must not be discarded as latency.
- IDs beginning with `demo.` are fictional. `null`, empty arrays and `not_evaluated` are deliberate unknowns, not successful validation results.
- JSON syntax is checkable now; semantic schemas, audio behavior and acceptance belong to implementation.

The state-intent file wraps a proposed request in an `example_only` envelope. The envelope is explanatory file metadata, not an HTTP request shape. Use the inner `request` when discussing the draft [state contract](../STATE_AND_CONTROL_API.md).

These examples introduce no public audio or reusable-pack permissions. Any eventual fixture must be authored or sourced and reviewed for its actual intended use. See [Library and transitions](../LIBRARY_AND_TRANSITIONS.md), [Recipe authoring](../guides/RECIPE_AUTHORING.md) and [Validation](../VALIDATION.md).
