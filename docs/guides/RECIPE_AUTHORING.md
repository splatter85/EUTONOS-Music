# Recipe authoring: turn musical judgment into reusable rules

**Status:** Proposed educational workflow. The data examples are illustrative design sketches, not an implemented schema, working API, or runnable EUTONOS-Music configuration.

**Edition:** 2026-11-03, America/Chicago.

A good recipe gives a musical idea enough freedom to develop while protecting the relationships that make it work. It should be understandable to a producer, inspectable by an AI collaborator, and precise enough for a future implementation.

Start with [Music foundations](MUSIC_FOUNDATIONS.md) and a study from [Genre recipes](GENRE_RECIPES.md). Apply [Arrangement, mixing, and taste](ARRANGEMENT_MIXING_AND_TASTE.md) before marking a result musically accepted. For production with tools, use the [Agent music workflow](AGENT_MUSIC_WORKFLOW.md).

## 1. Define the objects before defining the rules

| Object | Responsibility | Example |
|---|---|---|
| Creative brief | Describe the intended experience | Warm progressive music with a small recurring motif |
| Recipe | Version the musical rules and palette | Permitted harmony, groove, articulation, variation, and form |
| Arrangement plan | Commit a particular development over time | A 64-bar statement, contrast, and return |
| Mix plan | Define balances and processing dependencies | Bass/kick relationship, shared effects, level targets |
| Asset | Identify a particular audio/MIDI/render artifact | A rendered bass part or a full reference mix |
| Stem bundle | Group coordinated rendered roles | Drums, bass, harmony, lead, and effects from one arrangement |
| Transition edge | Describe an allowed handoff | A specific exit from one arrangement into another |
| Playback session | Select and perform material over time | A listener-controlled route through accepted material |

A listening mode describes a desired experience or level of activity. A recipe describes music. Keep those dimensions separate so one mode can offer several musical choices and one recipe can support several intensities.

A house recipe and a jazz recipe may expose the same broad control, such as “more active,” while making different musical decisions. The house recipe might introduce percussion; the jazz recipe might allow a short response during a gap. Their implementation should preserve their own musical logic.

## 2. Author one convincing example first

Write or perform a short passage with the intended palette. Give it a beginning, a recognizable idea, and an ending or continuation point. Save the source project and a reference render.

Then ask:

1. Which choices establish its identity?
2. Which details can vary without changing that identity?
3. Which details work only because another part does something specific?
4. Where can the phrase repeat, develop, or finish?
5. Which versions would violate the intended listening context?

This authored passage is a reference for taste, not an assertion that one seed is statistically representative. Preserve its special choices explicitly. If the best version depends on a certain bass pickup or a particular chord inversion, a generic randomizer should not erase it.

## 3. Write a brief an agent can follow

Include a positive musical goal and concrete boundaries.

**Example brief:**

> Create an original eight-bar progressive-house study at a quarter-note tempo of 124 BPM in 4/4. Use a warm, compact palette. The bass and drums should carry the groove; the lead should have a two-bar question and answer with clear rests. Begin with Am, F, C, and G, two bars per chord. Produce a restrained and a fuller arrangement using the same main identity. Keep the harmony timeline unchanged for comparison. Document the changes and leave acceptance pending until the renders are auditioned.

This is an original teaching brief. It does not specify an existing artist's melody, lyrics, voice, or signature recording.

Also record practical requirements: source tools, intended export, whether vocals are present, allowed sound sources, and the listening context. If a source is permitted in a finished composition but not in a reusable public sample pack, that distinction affects the deliverable. See [FL Studio workflow](FL_STUDIO_WORKFLOW.md) for the rights and export checks.

## 4. Separate invariants, preferences, and exceptions

| Rule class | Meaning | Example |
|---|---|---|
| Hard constraint | A result must satisfy it to be eligible | No missing assets; correct phrase duration; permitted instrument range |
| Musical invariant | A protected part of this recipe's identity | Main bass rhythm persists through a phrase |
| Bounded variation | A parameter may change inside stated limits | One approved hat ending may change every eight bars |
| Preference | A choice to favor, with alternatives allowed | Prefer a smaller melodic leap in the answer |
| Authored exception | A deliberate departure at a named location | A chromatic approach resolves into the next chord |
| Review requirement | A property that needs listening or expertise | Strongest intensity remains comfortable in context |

Do not encode a preference as a universal musical law. A conservative beginner melody can favor chord tones on structural beats. Another recipe may deliberately sustain tensions or use a different harmonic language.

Name the reason for each rule. “Avoid overlap because this bass patch is monophonic and a longer gate changes its glide” is more useful than an unexplained prohibition.

## 5. Plan harmony before generating competing layers

Use one shared harmony timeline when the recipe relies on coordinated chords. Let bass, pads, arpeggios, and lead read that timeline.

For each interval of harmony, record:

- Its start and duration in an unambiguous time unit.
- Chord root, quality, and permitted extensions.
- Tonal center or pitch collection, including tuning where relevant.
- Bass behavior and intended inversion if the bass is not the root.
- Structural melody targets and permitted tensions.
- How sustained notes may cross the next change.

Strudel provides chord voicing, root extraction, and scale operations. These are practical references for representing some of these relationships, but an application still needs to decide when and why to use them. [R1]

A melody validator that checks only scale membership will miss important failures. A note may belong to the key yet obscure a chosen chord or phrase ending. Conversely, a chromatic note may be intentional. Validate against the recipe's musical purpose and its declared exceptions.

## 6. Give every role a contract

| Role | Useful constraints | Relationship to preserve |
|---|---|---|
| Drums | Protected anchors, permitted fills, choke groups, timing template | A stable pulse with intentional variation |
| Bass | Range, polyphony, gate behavior, approach rules | Active harmony and kick interaction |
| Harmony | Voicing range, number of notes, attack placement, release | Space around bass and foreground |
| Lead | Motif grammar, range, phrase length, rests, targets | Recognizable identity and an answer |
| Texture | Density, attack ceiling, tuning, tail behavior | Atmosphere without accidental accumulation |
| Voice | Phrase and lyric boundaries, range, singer/palette continuity | Meaning, intelligibility, and musical form |

“Humanize everything” is too vague. Specify which roles share a timing template, which remain stable, and where expressiveness is allowed. A consistent laid-back snare and a stable kick can produce an intentional relationship; independent random movement of both can remove it.

For sampled instruments, include articulation and control mappings. Their behavior belongs to the palette version. A note generator should not assume that every sound reacts identically to velocity, note overlap, or release.

## 7. Use variation at the right time scale

| Decision | Suggested scope for an initial recipe |
|---|---|
| Palette, broad tonal plan, core motif | Stable across a piece or extended passage |
| Harmony block and section identity | Committed before the section begins |
| Motif answer, chord inversion, percussion family | Selected at phrase boundaries |
| Fill or small accompaniment change | Restricted to designated bars |
| Velocity or subtle articulation | Applied per event inside role-specific limits |
| Listener volume, mute, stop | Direct user control |

These scopes are proposals to test, not mandatory durations for all music.

Prefer a variation budget to independent random switches. If six parts each have a chance of changing, they may all change together. A budget such as “one foreground-affecting change per phrase” gives the system a way to preserve continuity.

Strudel documents weighted selection, probabilistic transformations, and conditional changes by cycle. Those mechanisms can implement an authored choice set; they do not determine whether the choice set is musically coherent. [R2]

### A practical novelty hierarchy

1. **Performance variation:** change accents or articulation while preserving notes.
2. **Phrase variation:** change a response or ending.
3. **Arrangement variation:** change how roles enter and leave.
4. **Compositional variation:** change motif or harmonic development.
5. **Recipe change:** move to a different musical vocabulary and palette.

Track these separately. A new random seed that changes only hi-hat velocity should not be counted as a new composition.

## 8. Seeds should preserve reproducibility and independence

For a proposed implementation, derive stable random streams from a recipe version, an explicit session seed, a phrase identity, and a role identity. Adding a new percussion role should not silently regenerate the established bassline.

Also keep the musical decisions independent of how frequently the scheduler asks for events. Tidal's documentation explains that its random patterns are deterministic functions of logical time. That is useful evidence for reproducible pattern generation, but it is not a universal seed-setting API for every engine. [R3]

Record what “reproducible” means:

| Level | Evidence needed |
|---|---|
| Same plan | Identical committed harmony, phrase, and role decisions |
| Same note/control events | Matching event sequence under the same engine/version |
| Same audio performance | Same instruments, presets, settings, and rendering behavior |
| Byte-identical file | A demonstrated deterministic audio/render pipeline |

Plugins, model generation, random oscillators, or changed sample libraries may prevent the stronger claims. Save the chosen events and reference audio when exact regeneration cannot be guaranteed.

When a seed fails, keep its identity and failure reason. Otherwise the recipe's weaknesses disappear from the review history and are likely to return.

## 9. An illustrative recipe sketch

The following YAML is **a teaching example only**. Its field names are not an implemented contract. The referenced palette and review results do not exist merely because they are named here.

```yaml
example_kind: educational_recipe_sketch
status: proposed_unimplemented
id: study.warm_progressive
version: 0.1.0

brief:
  goal: warm rhythmic continuity with a recognizable two-bar answer
  vocals: absent
  audition_status: not_auditioned

time:
  meter: [4, 4]
  bpm_unit: quarter_note
  reference_bpm: 124
  candidate_bpm_range: [122, 126]
  phrase_bars: 8
  event_offsets: zero_based_quarter_note_beats

harmony:
  tonal_center: A
  pitch_collection: natural_minor
  degree_numbering: one_based
  block_bars: 8
  progression:
    - {chord: Am, bars: 2}
    - {chord: F, bars: 2}
    - {chord: C, bars: 2}
    - {chord: G, bars: 2}
  structural_targets: current_chord_tones
  chromatic_exceptions: none_in_first_study

palette:
  requested_id: original_warm_palette
  state: must_be_authored_and_versioned
  asset_permissions: must_be_recorded_per_asset

roles:
  drums:
    protected_kick_offsets_per_bar: [0, 1, 2, 3]
    fill_locations: final_bar_of_phrase
  bass:
    maximum_simultaneous_notes: 1
    strategy: short_root_pattern_with_reviewed_turnaround
    cooperate_with: kick_envelope
  harmony:
    strategy: approved_close_voice_leading
    low_register_duplication: avoid_in_initial_study
  lead:
    strategy: fixed_opening_plus_approved_answers
    audible_rests: required
    maximum_foreground_lines: 1

variation:
  random_streams: separate_per_role_and_phrase
  foreground_change_budget_per_phrase: 1
  preserve:
    - harmony_timeline
    - lead_opening_rhythm
    - bass_register
  candidate_changes:
    - approved_hat_ending
    - approved_lead_answer
    - approved_chord_inversion

arrangement:
  candidate_sections: [introduce, hold, develop, release]
  transitions: require_explicit_reviewed_edges
  automatic_key_changes: disabled_in_first_study

mix:
  plan: must_be_authored_and_versioned
  sub_ownership: bass
  ducking: candidate_relationship_to_audition
  maximum_density: must_be_tested_with_actual_palette

review:
  technical_validation: pending
  musical_acceptance: pending
  accepted_transition_edges: []
  known_limitations:
    - no_audio_or_palette_has_been_produced_by_this_example
```

The useful feature of this sketch is the separation of musical intention, constrained choices, missing work, and acceptance. It deliberately leaves unmeasured properties pending.

## 10. Map a listening mode to coordinated choices

An initial mode mapping can be described without changing the identity of the recipe:

| Desired experience | Arrangement choice | Sound/performance choice |
|---|---|---|
| Quiet continuity | Bass, harmony, reduced drums; lead appears less often | Softer attacks and less prominent high-frequency detail |
| Moderate movement | Normal groove and complete motif | Reference articulation and balance |
| Stronger movement | Additional approved percussion and a developed answer | More assertive attack within tested limits |
| Easing back | Remove the last addition, then simplify the foreground | Gradual return toward the reference or quieter palette |

These are proposed controls to audition. Preserve manual preference: a listener may want strong rhythm at low activity, or a quiet texture during intense work.

Avoid making every raw input event a compositional decision. Let a future control system request an intended state; let the musical planner choose a compatible route. The [state and control API design](../STATE_AND_CONTROL_API.md) and [architecture](../ARCHITECTURE.md) define the product-level boundary. The preferred playback architecture is native-first, with browser control and an optional browser renderer.

## 11. Author transitions as explicit edges

Store the source arrangement, target arrangement, allowed exit/entry positions, overlap strategy, and limitations. Review actual harmonic and phrase positions, not only genre, BPM, and key labels.

| Pair | Initial assumption |
|---|---|
| Layers from one approved stem bundle | Use only the combinations approved by its mix and arrangement plans |
| Different seeds sharing a harmony timeline | Candidate compatibility; compare motifs, tails, and density |
| Same key with different progressions | Requires harmonic-phase review |
| Different tempos or meters | Requires a deliberate bridge or distinct ending/opening |
| Vocal sections | Preserve phrase meaning and approved boundaries |
| Free-time textures | Use time/tail landmarks appropriate to the material |

A transition can be musically excellent while being unsuitable for a particular work context. Keep that distinction in its metadata.

See [Library and transitions](../LIBRARY_AND_TRANSITIONS.md) for how accepted edges relate to selection. No set of broad tags proves universal seamlessness.

## 12. Validate technically, then listen

### Technical checks

Check the things that can be evaluated without taste: correct units, valid durations, available assets, declared tuning, range constraints, permitted polyphony, phrase length, expected event ordering, and missing dependencies.

Validate exceptions explicitly. For example, an intentional pickup may begin before the main phrase boundary; a sustained pad may cross it. A simplistic validator that rejects all boundary overlap would reject valid arrangements.

### Musical checks

Render the actual palette and listen to representative variants. Begin with the authored reference, then test sparse and dense limits, important harmony changes, long tails, and the most exposed transitions.

A useful first curation exercise is twelve candidates: four ordinary variants, four boundary cases, and four deliberately challenging combinations selected to test known risks. This count is an example, not a statistical guarantee. Do not expand testing without a question to answer.

For each candidate, keep:

- Recipe and palette versions.
- Seed and committed plan.
- Exact assets and render settings.
- Reviewer, date, and listening conditions.
- Accepted, revise, or rejected decision.
- A concrete reason and the responsible musical rule.

An AI that has inspected MIDI but has not heard the render should report that limitation. A human audition, an audio-capable evaluation, and a file-integrity check are different kinds of evidence.

## 13. Curate for a long session

Variety involves more than avoiding identical file repeats. Track repeated motifs, chord plans, sound palettes, drum identities, and arrangement arcs. A listener may notice the same hook even when every underlying sample differs.

Use a hierarchy of selection:

1. Respect explicit listener preferences and controls.
2. Choose an eligible musical neighborhood.
3. Prefer accepted transitions from the current state.
4. Consider recent exposure and the need for continuity.
5. Select an arrangement or realization.
6. Preserve its important phrase decisions.

Some repetition is musically valuable. Constant novelty can prevent attachment or create distraction. The balance should be a listener preference informed by actual sessions.

The long-duration product goal requires both library breadth and good selection. It does not require every eligible item to appear regardless of mode, and the count of possible seeds does not prove a successful extended listening experience.

## 14. Collaborate with AI in small, reviewable changes

A useful request names the current version, the protected properties, one problem, and the desired evidence.

**Revision example:**

> Keep the tempo, harmony timeline, palette, and lead opening unchanged. The bass masks the kick at the start of bars three and seven. Propose two changes to note timing or duration. Render both against the same reference arrangement if the environment supports rendering. Explain the changes and mark listening acceptance pending.

Ask the agent to return a musical diff: which events, constraints, or sounds changed and why. Save the previous version so the comparison is meaningful.

Use AI for option generation, theory checks, metadata, constrained edits, arrangement alternatives, and implementation support. Maintain a producer's acceptance point for the musical result. Generated fluency about a track is not evidence that the track was heard.

## 15. Version and release a recipe deliberately

A recipe release should identify its exact musical rules, palette, accepted arrangements, known limits, and supporting evidence. Preserve older versions for reproducibility.

A useful review progression is:

**Draft → technically valid → rendered → auditioned → musically accepted → integration accepted**

These are proposed conceptual states; align their implementation with the repository's eventual schema. A candidate can move back to revision without losing its history.

A change to core harmony, motif grammar, palette behavior, or transition rules may invalidate earlier acceptance. A corrected description may not. State which evidence remains applicable after each change.

The release package should link the source project, reference render, asset inventory, rights records, recipe version, arrangement plans, mix plans, accepted transition edges, and unresolved issues. Publish only assets whose permissions cover the intended distribution.

## 16. Implementation references and limits

- **R1 — Strudel, Tonal Functions:** [Read source](https://strudel.cc/learn/tonal/)
- **R2 — Strudel, Random Modifiers and Conditional Modifiers:** [Read source](https://strudel.cc/learn/random-modifiers/) and [Additional reference](https://strudel.cc/learn/conditional-modifiers/)
- **R3 — Tidal Cycles, Tutorial, Introducing Randomness:** [Read source](https://tidalcycles.org/docs/getting-started/tutorial/)
- **R4 — Andrea-Cavallo, Cadenza:** [Read source](https://github.com/Andrea-Cavallo/cadenza)
- **R5 — Strudel, Using Strudel in Your Project:** [Read source](https://strudel.cc/technical-manual/project-start/)

Cadenza documents a concrete MIDI-generation approach using shared harmony, deterministic offline choices, style-dependent articulation, and validation. It is a beta project and a useful reference to examine, not a verified dependency selection or a guarantee of sound quality. [R4]

Strudel demonstrates browser integration and custom-interface options. Its integration guide identifies AGPL-3.0 and corresponding compatibility obligations; evaluate those before adopting it as an embedded dependency. The educational patterns in these guides are original, and no Strudel source code is incorporated here. [R5]

The architectural proposals above can be implemented with different engines. The enduring requirement is a clear connection between musical intention, permitted variation, the actual sound palette, and honest evidence of what has been tested.

[R1]: https://strudel.cc/learn/tonal/
[R2]: https://strudel.cc/learn/random-modifiers/
[R3]: https://tidalcycles.org/docs/getting-started/tutorial/
[R4]: https://github.com/Andrea-Cavallo/cadenza
[R5]: https://strudel.cc/technical-manual/project-start/
