# Music library, DJ selection and transitions

Document ID: `EM-D005`  
Status: proposed design, 2026-11-03.

## The library is more than a folder of tracks

The director needs to know what material can do: where it can enter, how long it can develop, which parts can overlap, what transformations remain acceptable, and how it can leave. File names and genre tags are insufficient.

Use immutable media files with versioned manifests and a rebuildable local index. Keep listening history separate from asset identity. A corrected beat grid or rights record creates a new metadata revision; a changed audio file creates a new content hash and invalidates reviews that depended on the old bytes.

### Source types

| Type | Examples | Musical control |
| --- | --- | --- |
| Track | Finished instrumental or song | Approved cues, gain/EQ, reviewed stretch/transpose ranges, selective overlap. |
| Stem bundle | Drums, bass, harmony, lead, vocals, effects | Shared start/length/timing; independent role handoffs and density. |
| Section set | Intro, main groove, development, breakdown, bridge, ending | Controlled resequencing with composed entry/exit rules. |
| Instrument palette | Original drum hits, multisamples, synth presets or packaged synthesis definitions | Procedural notes with defined ranges, articulation and resource limits. |
| Recipe | Rules, motifs, form and palette references | Many performances inside one musical identity. |
| Bridge | Percussion passage, harmonic pivot, texture transition, fill or ending | An explicit route between otherwise unsuitable neighboring sources. |
| Vocal phrase | Reviewed sung/spoken/rap phrase with timing and lyric boundaries | Limited compatible placement; meaning and delivery remain part of continuity. |

An item can reference multiple types, but a stem bundle is one coherent musical unit, not unrelated files that happen to share BPM.

## Required metadata categories

| Category | Fields to represent | Why it matters |
| --- | --- | --- |
| Identity | Stable ID, schema version, revision, content hashes, parent/source IDs | Reproduction, invalidation and provenance. |
| Technical | Codec, channels, sample rate, frames, duration, decoder requirements | Correct loading and bounded resource use. |
| Transport | Tempo map, meter map, beat grid, first downbeat, pickups, drift/uncertainty | Phrase-aligned scheduling and honest handling of imperfect analysis. |
| Harmony | Key/mode where applicable, tuning reference, chord regions, ambiguous/unpitched regions | Shared context for overlapping music and procedural accompaniment. |
| Structure | Sections, motif IDs, phrase lengths, vocal spans, silence and tails | Useful entries/exits and coherent development. |
| Role and energy | Instrument role, rhythmic density, tension, brightness, atmosphere, supported state ranges | Mix decisions and mood selection. |
| Mix | Integrated/short-term loudness measurements, peaks, low-end density, stereo/mono checks | Gain staging and collision avoidance; measurements are not a taste score. |
| Transformation | Reviewed tempo/transpose bounds, approved derived renders, latency and phase constraints | Avoid arbitrary processing beyond what has been heard. |
| Rights | Source, creator, applicable terms/permission, allowed uses, attribution, distribution scope, evidence/date | Separate private-use material from distributable packs. |
| Review | Technical checks, listening notes, reviewers, exact revisions and unresolved limitations | Explain what is actually eligible and why. |

Unknown facts remain unknown. For example, an analyzed key with low confidence must not become a hard truth. A cue can be approved by a creator even when a whole-track key estimate is ambiguous. Music outside tonal conventions may need texture- or rhythm-based transition rules instead of a key field.

## Import and assessment workflow

1. **Register a source.** Retain the original and its hash. Record where it came from and the intended personal/public scope.
2. **Inspect technical integrity.** Decode, check duration/channels/rate, identify clipping or missing material, and confirm stem alignment where applicable.
3. **Propose annotations.** Analyze tempo, downbeats, tonal regions, loudness, onsets and structural boundaries. Store the analyzer/version and confidence separately from reviewed annotations.
4. **Review musical facts.** Listen around candidate cues, correct half/double-tempo errors, account for pickups and vocals, and describe the source's actual behavior.
5. **Describe eligible transformations.** Render and compare selected stretch/transposition ranges. A negative test is useful evidence and should be retained.
6. **Create candidate transition edges.** Use shared context and cue compatibility to propose plans.
7. **Audition edges.** Evaluate the actual overlap, role transfers and tail behavior; promote only the reviewed scope.
8. **Publish an eligible manifest.** Make the new revision selectable only after required technical, musical and rights checks for its intended scope.

Analysis should reduce creator effort. It cannot automatically certify that a groove is compelling or a transition feels natural. Do not use an aggregate number to hide a failed required condition.

## Transition graph

Treat playable sections as nodes in a directed graph, with approved entry/exit cues inside each section. Edges include both valid within-source continuation and inter-source transition plans. A route therefore accounts for how music proceeds from an entry to a usable future exit. An edge from A to B does not prove B can return to A, and an edge between two particular revisions says nothing about newer media.

An edge records:

- Source/target IDs and versions, exit and entry cues.
- Required tempo/meter/harmonic conditions and allowed transformations.
- Transition type and duration range in musical units.
- Layer/role handoff and gain/filter envelopes.
- Preparation budget and required cached renders.
- Vocal overlap restrictions and phrase-boundary handling.
- Review evidence, confidence, fallback, and edge revision.

### Transition types

| Type | Use when | Main review questions |
| --- | --- | --- |
| Phrase mix | Related grooves have compatible tempo and harmonic regions | Do phrases line up, and does the combined rhythm remain clear? |
| Stem substitution | The sources expose complementary parts | Does each role hand off cleanly without losing the groove or doubling the sub? |
| Percussion bridge | Tonal material must change while pulse continues | Is the rhythm-only interval musically intentional and long enough? |
| Harmonic bridge | A composed/procedural pivot can connect the harmonic regions | Does the progression resolve convincingly and support the incoming melody? |
| Breakdown/rebuild | A larger tempo, density or genre change needs space | Does the pause in drive feel earned and does the new section enter convincingly? |
| Tail/texture bridge | Pads, ambience or an effect tail can carry continuity | Do tails clash, pump unexpectedly, or suggest an unrelated space? |
| Deliberate fade | No stronger compatible route exists | Is the fallback honest, pleasant and within the user's allowed interruption? |

Crossfade length is only one part of a transition. Two strong bass lines can conflict throughout a long fade. Matching BPM does not align phrases or make two harmonies compatible. A key relation can be a candidate-selection hint, but the actual notes and regions being overlapped still matter.

## Hybrid continuity contract

Recorded and procedural sources share a section plan. During a handoff, the plan assigns roles and constraints rather than asking each generator to improvise independently. Source-frame offsets and path latency/padding are resolved before scheduling; intentional pickups remain musical events. Aligned scheduling alone does not make unrelated waveforms phase-coherent.

Example design: a recorded warm progressive section reaches its exit cue. The procedural performer already has its tempo, chord timeline, palette and motif. It introduces a complementary percussion part, takes the bass role on a reviewed boundary, and continues a related harmonic passage while the recorded lead tail decays. Later it clears the lead/vocal space and moves into an approved entry region of another recording.

Three levels of continuity are useful:

1. **Shared performance:** the procedural layer accompanies the current recording under its existing harmony and rhythm.
2. **Related development:** the procedural passage develops a retained motif or groove while changing the texture.
3. **Identity change:** the director chooses a different recipe or recording and uses an explicit transition route.

The library should support all three. Remaining forever at level one would make a large combination count sound like a small set of loops.

## Sound palettes that carry quality

Each palette describes original/eligible sounds, tuning, root notes, playable ranges, velocity response, round-robin choices where available, envelopes, gain calibration and resource cost. A sample can be a finished texture, a short instrumental phrase, or a sampled instrument with enough expression to serve its role.

FL Studio can produce the source music and sounds, but the runtime does not automatically inherit FL plugins. Exported audio carries the rendered sound; a native synthesis implementation or licensed hosted instrument requires its own integration. The [FL workflow](guides/FL_STUDIO_WORKFLOW.md) describes production routes and the rights distinction between music releases and reusable sound libraries.

Use dry/wet alternatives deliberately. A completely wet sound may resist blending with a new space; a completely dry export may lose the intended character. Keep effects that define an instrument's identity where appropriate and document shared bus/sidechain dependencies. Do not assume all possible stem subsets preserve the original mix.

## Selection policy

First apply hard eligibility conditions: available assets, intended-use rights, supported backend, preparation deadline, compatible current context, required reviews, and user exclusions. Then rank the remaining candidates on state fit, musical distance, recency, diversity, preferences and transition quality.

Weights are tunable product choices, not claims about human psychology. Keep the reasons inspectable. A simple deterministic selector is preferable to an opaque model until a model demonstrates a useful improvement.

History should distinguish:

- Exact audio replay.
- Repeated section or motif.
- Repeated variation seed.
- Same recipe with a different variation.
- Same palette used by different recipes.
- Same broad genre/family.

A cooldown on one level does not imply another. Replaying a favorite motif occasionally may be desirable; immediately replaying the same full arrangement may not be.

## The three-day goal

Treat 72 hours as two separately qualified properties:

**Operational endurance:** playback and the selection/control system remain stable, resource use stays bounded, and recoverable failures behave predictably.

**Musical breadth:** enough distinct, reviewed musical identities and developments appear that the session does not feel like a few loops in disguise.

There is no honest conversion from “N recipes × M seeds” to guaranteed hours of enjoyable novelty. Track coverage at the musical levels above and review representative listening segments spread across the run. Save the entire selection log so a listener can inspect what was repeated.

### Reachability and fairness

Within a selected listening policy, every eligible item should either be reachable from the current playable region through directed continuation/transition edges or have a visible reason it is excluded. Analyze connected regions and dead ends. A bridge may connect regions that otherwise remain isolated.

For a deliberately broad touring session, choose a seed and schedule with a coverage objective, so eligible families and recordings eventually receive turns. The policy can reserve occasional exploration slots while honoring recency and preparation constraints. Report eligible coverage and omissions.

This does not mean an ambient-only session must eventually play hard techno. “Every item can eventually play” applies to the catalogue allowed by the user's chosen policy, mode constraints and rights scope. Where a requested policy prevents full coverage, explain that rather than violating it.

### Avoiding repetition while preserving identity

Use a modest number of reviewed recipe families first, then expand with new harmonic vocabulary, sound design, groove and form. Preserve motifs long enough to create recognition. Give larger identity changes an appropriate dwell time. Tune novelty separately from energy so a long quiet session can remain varied.

Wreckage Systems provides a useful artist-led precedent: its creator describes sample-based live generation with distinct systems that retain their own character. Its V1 archive and V2 description show how a collection can expand while keeping each system coherent. This informs the library approach; it does not validate this project's quality or quantity targets. [L1], [L2]

## Cache and version policy

Derived renders are addressed by input hashes, recipe/model/DSP version, configuration and relevant musical context. An asset's cached transformed version is a separate derivative with its own review scope. Eviction must not remove audio reserved by an active mix plan.

Retain a small prepared horizon and a known fallback. A generation job can extend the horizon but cannot consume unbounded disk/GPU resources. Pack manifests record required assets; installation checks completeness before eligibility.

## Rights and distribution boundaries

Personal authoring, publishing a finished song, distributing reusable stems, and shipping an instrument/sample pack are different intended uses. Record actual permission for each relevant use. Owning a DAW or instrument does not establish permission for every extracted asset format. Third-party model code, weights, voice banks and generated outputs can have different terms.

The default public repository contains manifests, documentation and original illustrative data only. A future public audio fixture pack must use material with clear redistribution permission. A private local library can reference user-provided material under the user's applicable rights; it must not silently upload that material to the public repo or a remote model.

## Sources

- [L1 — Wreckage Systems FAQ](https://www.65daysofstatic.com/wreckage-systems-faq/)
- [L2 — Wreckage Systems V1 archive and V2 description](https://65labs.itch.io/wreckage-systems-v1-archive)
- [Recipe authoring guide](guides/RECIPE_AUTHORING.md)
- [FL Studio integration and asset terms](FL_STUDIO_INTEGRATION.md)
- [Vocal/model options and permissions](VOCALS_AND_MODELS.md)

Reviewed 2026-11-03. Transition rules, graphs and coverage policies above are this project's proposals, not results of an implemented experiment.

[L1]: https://www.65daysofstatic.com/wreckage-systems-faq/
[L2]: https://65labs.itch.io/wreckage-systems-v1-archive
