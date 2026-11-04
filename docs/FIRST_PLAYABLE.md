# First playable: a Mission Control soundtrack

Document ID: `EM-D016`  
Status: proposed pilot contract, 2026-11-03. No runtime or musical acceptance yet.

## First product, open future

Build music people enjoy using with EUTONOS Mission Control. The core remains separately testable and accepts neutral state intent, but a second consumer, public platform or production suite is not a prerequisite. This contract selects a small implementation from the larger design; it does not replace the long-term requirements in [Product goal](PRODUCT_GOAL.md).

## Two early finish lines

### Audible proof — EMF04, reviewed at EMF05

Produce one roughly twenty-minute experiment containing two genuinely different recorded pieces, one compatible procedural identity, and recorded → procedural → different-recording handoffs. Include at least three meaningful variations of the procedural passage, a rise and release in drive, manual Hold, a known-safe fallback and a replayable event sequence. Start with authored cues, constant tempo and a supported meter. This deliberately small proof is not evidence of broad genre coverage or three-day variety.

Use a small coherent sound palette and an intentional musical plan, not placeholder beeps used as evidence of taste. Technical placeholder signals can test timing separately. Produce fixtures manually in FL Studio or via supported scripts; the full MCP bridge is not a dependency. Provide source projects/MIDI where permitted, export settings, asset hashes, context and listening notes.

The scaffold includes a minimal state selector and the smallest Mission Control explicit-state adapter available under the later implementation assignment. If only a simulated client can be exercised, label the experiment simulated and leave actual integration pending. Avoid work-activity inference in this first proof.

Review the music and scaffold before expanding: does the owner enjoy it, do the handoffs make sense, and is the architecture small enough? A negative result changes the recipe, sounds or transition plan before broad infrastructure work continues.

### Usable Mission Control pilot — after EMF06–EMF14 and targeted qualification

A listener can enable Music, press Play, choose a vibe and let it develop; mute/hold/pause always work. Include at least three distinct recipe families, multiple supported variations and an eligible recorded/stem set. Demonstrate different musical identities at one sustained state and development of one identity across states. The exact families are chosen by listening; warm progressive/deep house, darker rolling house/melodic techno and hypnotic/acid techno are starting candidates, not locked requirements.

Use a real Mission Control connection in the accepted pilot, with visible requested/pending/audible state, conservative optional automatic intent and a useful manual-only mode. Listen during ordinary work, not just a scripted demo. Test concurrent development load, reconnect, duplicate control, hold, device/page lifecycle and missing-source fallback. Acknowledge every unsupported behavior. This is a bounded pilot, not full EMF completion or release authorization.

The FL bridge (EMF15), production jobs (EMF16), full assembled review (EMF17), full qualification (EMF18) and owner campaign acceptance (EMF19) remain planned. Their original outcomes and stable IDs are retained; the pilot does not pretend they are complete.

## Small first implementation

One playback owner, one clock, one selected renderer, one local control/selection module and one prepared content pack. A module boundary does not imply a microservice. Do not implement both browser and native production backends.

Investigate Web Audio first for the audible proof because Mission Control already supplies a browser-facing experience. EMF03 selects the pilot renderer from actual evidence. A native worker is justified when a required lifecycle/resource/audio behavior cannot be met, or when independent playback after the browser closes is selected. An audition-only browser prototype must not claim native persistence. [Architecture](ARCHITECTURE.md) owns the decision criteria.

Ordinary playback has no LLM, GPU, running FL Studio, voice model or paid service dependency. Production runs ahead of playback. Do not download or install dependencies as a side effect of opening the listening panel.

## Content readiness without an annotation wall

The full metadata catalogue describes possible facts, not mandatory manual paperwork for every operation:

| Readiness | Minimum useful evidence | Allowed operation |
| --- | --- | --- |
| Playable | Identity/hash, decodable audio, intended-use basis, level check | Explicit ordinary playback; no claim of seamless mixing |
| Cue-mixable | Playable plus checked cue/downbeat/phrase/tail facts and a permitted transition | Reviewed transitions and allowed transforms |
| Hybrid-ready | Cue-mixable plus reliable harmonic/role context, aligned assets and reviewed recipe envelope | The specified procedural accompaniment or handoff |

Do not invent chords when unknown or require them for a simple non-overlapping play operation. The first corpus is manually annotated. Automated analysis and a general importer come later within their existing stages.

For generated output, review the recipe/version/palette, supported control range and selected seeds; do not require human audition of every possible future note sequence or claim all seeds were heard. Enforce runtime validity/resource constraints, quarantine invalid candidates and retain a prepared fallback. Novel model-generated recordings are review candidates, not automatically trusted assets. These are scoped review policies, not a guarantee of universal good taste.

## Minimal Mission Control integration

MC's adapter translates its actual available controls or aggregate events into musical intent. The music engine does not inspect conversation text, scrape unrelated windows, register a global key logger, or infer mental state. Start with an explicit mode control. Add optional smoothing only after actual event availability and privacy scope are verified.

Keep these clocks/policies distinct: adapter signal freshness, pending-intent expiry, audible-state dwell and transition execution. On signal loss keep the active plan and use the listener's configured settle/hold behavior; never conclude that the listener is not thinking. Agent throughput alone cannot cause an energy escalation. A renderer failure must not block MC's work or messaging functions.

A small façade can provide get capabilities/state, set target, transport, hold/release and operation lookup. It must preserve the underlying command ID, revision, duplicate and audible-state semantics in [State/API](STATE_AND_CONTROL_API.md). It is not a parallel state store. General multiple-client leases, remote streaming and broad MCP tools are not prerequisites for the first single-listener experiment.

No changes to a separate Mission Control repository, automatic dispatch or installation are performed by this documentation review. Later integration work must inspect its current sources and actual supported route.

## Listener controls

Default: Play/Pause, volume/mute, Vibe, Energy, Variety and Hold. Keep current/next music and a short pending explanation visible. Advanced/Lab contains atmosphere, transition length, contrast, tempo bounds, source/vocal preference, density, tension and diagnostics. Unsupported controls are disabled with a reason. Preserve accessible names, keyboard operation and focus.

Hold defaults to retaining the target musical character, with permitted development. Skip affects the current passage; an optional reason is scoped to the actual selection. Favorites/exclusions are inspectable and reversible. Music begins only from explicit play; mute is never an engagement problem to counteract.

## Transition and variety guardrails

A selected state limits energy/texture; it does not lock genre, recipe or exact notes. Evolve at performance-detail, phrase, section and identity timescales. First use manually reviewed direct routes plus a bridge/fallback, not all-pairs graph discovery. Dwell begins at audible entry. Set an explicit pending-wait budget before trials; report when a bridge needs longer. Stop/mute is not held until the next phrase.

At first lock tempo or use authored variants. Buffer playback-speed changes are not a substitute for pitch-preserving stretching. Track bass/vocal role handoffs and tail handling explicitly. Normal playback prioritizes a good next choice; broad catalogue coverage is a separately selected touring policy, never permission to play excluded genres.

## Pilot evidence

[Validation](VALIDATION.md) owns the listening sheet and checks. Use labels READY / REVISE / BLOCKED / NOT VERIFIED per required outcome, not an aggregate taste score. A real owner's preference is evidence about that listening context, not a productivity improvement claim.

Capture exact content/code versions and actual run conditions. Match playback gain when comparing adaptive and fixed-state sessions; use repeated/counterbalanced sessions where practical to limit novelty/order effects. Measure unwanted changes, overrides, enjoyment, distraction and willingness to use it again. Resource/timing thresholds are set from the named reference environment before qualification, never fabricated in this design review.

The larger three-day horizon remains a genuine target. The first pack supports extension and repetition tracking; it is not marketed as three days of unique music.
