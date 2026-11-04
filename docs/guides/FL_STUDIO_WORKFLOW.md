# Producing sounds, adaptive material, and finished music in FL Studio

**Status: design/research; not implemented/tested.** This is a proposed production workflow. No project, sound pack, render, plugin entitlement, or listening result has been verified by this repository. Official references were checked **2026-11-03, America/Chicago**. Menu wording and available features must be checked against the installed FL Studio build.

## 1. Choose the musical deliverable

Start with what the producer wants to make. EUTONOS-Music should support complete authored music as well as an adaptive soundtrack. Electronic genres are useful early experiments; the authoring workflow can also accommodate recorded instruments, orchestral writing, jazz, ambient work, sound design, and hybrids. Instruments, articulation, rhythm, and arrangement determine the requirements—not a fixed list of genre names.

| Deliverable | What to preserve | Main audition question |
| --- | --- | --- |
| Finished track | Arrangement, mix, master, credits, editable source | Does the complete piece have a satisfying arc? |
| One-shot | Attack, decay, intended level, optional pitch identity | Does it work repeatedly in its intended role? |
| Multisampled instrument | Key/velocity zones, articulation, releases, variation | Does it remain convincing across the playable range? |
| Loop | Exact musical extent, start anchor, groove, loop behavior | Is repetition seamless and musically useful? |
| Stem bundle | Common origin, compatible parts, routing and effects decisions | Do the allowed combinations sound intentional? |
| Transition | Entry/exit conditions, duration, tails, destination compatibility | Does the change feel composed? |

A recipe is a versioned set of musical rules and a palette; a collection of WAV files alone is not a recipe. A stem bundle is a set of coordinated assets, not a guarantee that every possible combination works. Refer to [library and transitions](../LIBRARY_AND_TRANSITIONS.md) for the shared model.

## 2. Establish the instrument and rights inventory

Record the exact application build, activated edition, audio configuration, available instruments/effects, installed content, and the project template. A high FL Studio edition does not establish that every plugin, third-party library, FLEX pack, or subscription item is installed or permanently licensed. Maintain a local dependency list with plugin version, preset identifier, required content, and whether the project reopens correctly.

For each source sound, distinguish permission to make music from permission to distribute a reusable sound asset. Image-Line's [copyright guidance](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/app_copyright.htm) permits commercial musical use of most included content but excludes demo-project material and associated restricted content. Its [Terms of Use](https://www.image-line.com/image-line-software-eula/) impose separate restrictions on redistributing content and using it in sound packs or sample-based products. Processing a supplied sample does not automatically remove those conditions.

FL Cloud has its own explicit distinction: downloaded sounds can be used in musical works, while sharing the samples—including in reusable packs—is restricted. Streaming a preview does not provide the same permission as downloading the sound through the licensed process. The [commercial-use explanation](https://support.image-line.com/action/knowledgebase?ans=719) and [sharing restrictions](https://support.image-line.com/action/knowledgebase?ans=720) also matter when sharing a zipped FL project that embeds samples.

Therefore, maintain a rights record for the actual deliverable:

- Creator/source and the original asset identifier.
- Applicable license or written permission, with a dated source reference.
- Whether finished musical use, modification, redistribution, and downstream reuse are covered.
- Attribution and other conditions that must accompany the asset.
- Intended scope: local production, a finished soundtrack, a public reusable pack, or another specified use.
- Review status and unresolved restrictions.

Original recordings and custom synthesis are useful candidates for public packs; still check any relevant instrument, preset, sample, or source-material terms. A rendered preset is not automatically redistribution-cleared. A stem may contain an authored composition, a recognizable licensed loop, or a reusable instrument extraction; do not assign one blanket rights answer to all stems. Use clearly permitted material for public fixtures, and obtain clarification before publishing uncertain content. A software license in this repository cannot grant rights that the sound creator does not hold.

## 3. Make a brief and a small working palette

Write a short musical brief before filling the project with instruments. Include purpose, duration, mood, rhythmic feel, tonal or atonal intent, register, density, acoustic/electronic character, vocal policy, and two or three things to avoid. Describe references in musical terms: a restrained low end, a syncopated bass line, long harmonic motion, dry close percussion, or broad reverb. The goal is an original result with explicit traits.

For adaptive work, add operating limits: allowed energy range, how much harmonic motion is acceptable, whether the material can be interrupted, and what should remain when layers disappear. “Thinking” need not mean fewer beats; it may mean less foreground melody, more harmonic space, and a stable pulse. “Surge” can add rhythmic urgency and texture without a large volume jump.

Build a small palette first. Assign meaningful channel, Playlist, and Mixer names. Separate the musical roles you might want to control later: pulse, percussion, bass, harmony, motif, texture, accent, and transition are useful examples, not mandatory categories for every genre. Record the routing and any shared processing in a mix plan. Save an initial project revision before generative edits begin.

## 4. Compose in an editable form

AI collaboration should produce inspectable musical decisions. Start with a chord/rhythm/structure proposal, a Piano roll generator, or a `.mid` file; assign actual instruments and audition early. Image-Line documents `.mid` import, track/channel selection, and options that can blend or overwrite existing information. Controller automation may require a separate import step, and removing leading silence can break alignment. Inspect these choices on a working copy before importing into a populated pattern. [MIDI import reference](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/automation_midiimport.htm).

For a phrase generator, specify key or pitch collection, register, phrase length, rhythmic vocabulary, articulation, seed, and variation limits. Keep the generated MIDI or note data with its parameters. A seed can reproduce symbolic choices; it does not guarantee bit-identical sound from a plugin with free-running oscillators, random modulation, or other state.

The separate [Piano roll scripting API](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll_scripting_api.htm) can manipulate score data. In a proposed MCP workflow, a prepared note operation may still need the producer to apply a script inside FL. The [integration document](../FL_STUDIO_INTEGRATION.md) defines how that should be reported. Keep a useful MIDI-import fallback rather than making composition dependent on automatic keystrokes.

Revise one musical dimension at a time: change the bass rhythm while keeping the patch, or change the chord voicing while retaining the groove. This makes taste decisions understandable. For expressive acoustic or culturally specific material, model articulation, phrasing, tuning, and ornament explicitly; a scale name alone does not reproduce a musical tradition.

To export MIDI from an existing project, note that Image-Line's [Prepare for MIDI export macro](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/menu_tools.htm) replaces channels with MIDI Out channels. Perform that preparation in a separate saved copy. Retain the production project with its instruments and mix.

## 5. Design and capture original sounds

### One-shots

Define the sound's job before programming it: kick weight and length, a pluck's attack and body, a noise accent's bandwidth, or a recorded hit's articulation. Build or record the source, then listen at the intended musical level. Keep a dry version when useful and make wet variants intentional; an expansive effect can be a feature for a transition and a problem for rapid repeated percussion.

Capture the entire onset and decay. Avoid trimming a transient just to produce a visually neat waveform. For tonal sounds, record root MIDI note and tuning; for untuned percussion, use a semantic drum identity rather than inventing a key. Preserve intended gain relationships across related hits. Test repeated playback, close successive triggers, and a representative arrangement before accepting a sound.

[Edison records at its position in the effects chain](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Edison_2.htm), and its recording level is before that Mixer track's fader. This makes placement important when comparing dry and processed captures. Use [Edison's save/export and region tools](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Edison_3.htm) where appropriate, then verify the exported file rather than assuming the editor's playback settings are embedded in it.

### Multisamples

A multisampled instrument needs a mapping plan, not just many recordings. Specify the useful note range, sample spacing, velocity layers, repeated-hit variations, note-hold duration, release behavior, and any sustain loops. Test sparse coverage before expanding it. More layers increase capture and storage cost and are useful only when they capture audible differences.

Image-Line's [DirectWave documentation](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/DirectWave.htm) describes key/velocity zones and a Channel Sampler that can sample native or VST instruments, with controls for note range, velocity, cycle layers, length, release, and effects. DirectWave Player and the full product have different capabilities, so confirm activation before relying on the sampler workflow.

Preserve raw captures alongside the mapping. Check every zone boundary, very soft and very hard notes, note-off behavior, overlapping notes, and transitions between articulations. A sustained pad may need a stable interior loop plus a separate release; a piano-like transient may need natural decay. Label dry/wet captures and root notes unambiguously. A DirectWave instrument is a production artifact; a future EUTONOS runtime may need independent audio and mapping metadata instead of that proprietary container.

## 6. Prepare adaptive loops and stem bundles

Choose a common musical origin and render extent for each bundle. Coordinate tempo, meter, phrase length, harmonic position, tuning, swing, and arrangement role. Two loops in the same key can still clash because their chord changes, accents, or bass notes disagree. Define permitted combinations through listening and explicit compatibility rules.

For the first bundle, keep tempo constant and vary orchestration, subdivision, density, timbre, harmonic tension, and articulation. If tempo adaptation is later needed, audition its supported range. FL's [Sampler time-stretching documentation](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/chansettings_sampler.htm) distinguishes realtime stretching from resampling and offline processing; FL's own feature does not supply a stretcher to the EUTONOS playback service.

Create several authored variants with distinct purposes: a sparse bed, a more animated groove, a foreground phrase, a restrained coast, a fill, and one or more transitions. These are examples. The number of variants should follow listening results rather than a target count. Avoid multiplying weak variations just to enlarge the catalog.

Use the [export dialog](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/fformats_save_export.htm) deliberately. Important documented details are that split Mixer exports use WAV, individual splits bypass Master effects, muted tracks are omitted, and PDC trimming changes rendered leading delay. Tail settings distinguish preserving decay, cutting at the selection, and wrapping decay into a loop. Image-Line recommends WAV for loops because MP3 can introduce initial silence. Record these settings with the render.

### Routing and effect decisions

Choose how much of the sound should be fixed in the asset and how much should remain under runtime control. Printing essential sound-design processing is often useful. A long shared reverb, nonlinear master limiter, or bus compressor needs a more deliberate decision because its behavior depends on the combined signals.

Summing independently processed stems need not reproduce the full project. A compressor reacting to the entire drum bus behaves differently when each drum is processed alone. Either render that interaction as a combined stem, preserve suitable dry parts and recreate the processing later, or explicitly accept a different mix. Do not count a bus stem and its constituent stems twice in an allowed combination.

Playlist consolidation has a related trap: Image-Line explains that exporting Playlist tracks solos them sequentially. Audio-driven sidechains can therefore change unless the trigger and affected sound are handled together; the manual describes alternate routing/export approaches. See the [Playlist consolidation notes](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist.htm). Keep the sidechain trigger active during capture when its pumping behavior is intended, even if that trigger is excluded from the audible exported role. Verify the result against a reference mix.

### Loop boundaries and tails

Separate a loop's musical length from the duration of its decaying audio. An asset can have an exact eight-bar body and a longer tail. The playback plan must know when to loop the body, when to let the tail continue, and when a transition replaces it.

For a periodic bed, render multiple repetitions and inspect a stable middle cycle when startup effects cause a different first pass. Do not assume three passes are always sufficient: long feedback, evolving automation, or random processes may never become a simple repeating state. A directional riser or final chord release should usually retain its intentional ending instead of being forced into a seamless loop.

Keep frame-accurate start/end markers in metadata. Tempo metadata alone is insufficient for stitching. At constant tempo, derive the expected duration from meter, bars, tempo, and sample rate; compare the decoded frame count with the declared body and tail. A tempo map requires its own timing description. Audition the boundary at least in repetition and in a transition to another asset.

## 7. Produce finished music as its own output

A finished piece deserves an arrangement plan: introduction, development, contrast, release, and ending appropriate to its genre. The producer can select strong generated phrases, write connecting material, record performances, automate transitions, and mix the complete result in FL Studio. Keep alternate takes and decisions attached to source revisions.

Render a listening version and a lossless master suitable for the intended release. Retain editable source and required dependencies locally. Publicly releasing a finished composition is a different deliverable from publishing every isolated sound used to make it; apply the rights record to each output separately.

A finished track can inspire an adaptive family, but deriving that family takes additional work: identify stable sections, compose entry/exit material, prepare compatible roles, and test combinations. A collection of arbitrarily cut song segments does not automatically become an adaptive arrangement.

## 8. Validate, register, and commit a pack

Use a staging directory for candidate renders. The future catalog should register immutable assets by content identity and link them to the source project revision, brief, recipe, arrangement plan, and mix plan. Choose a consistent lossless interchange format for a fixture set; sample rate, bit depth, channel format, and any delivery conversion remain explicit decisions, not assumptions hidden in filenames.

The proposed registration record should include:

- Asset ID, hash, decoded format, sample rate, channels, and frame count.
- Role, note range or tonal identity where applicable, tempo/meter, body/tail boundaries, and cue points.
- Source project and instrument versions, render settings, seed or performance take, and effect/sidechain decisions.
- Compatible bundle/recipe revisions and transition constraints.
- Measured level information with analyzer version and method, plus intended playback gain.
- Rights provenance, audition evidence, and acceptance status.

Do not normalize every stem to the same maximum peak. That discards designed balance and does not ensure a safe or convincing sum. Measure allowed combinations and transitions, including overlapping tails. Distinguish sample peak from true peak; report only the measurement actually made. Silence, clipping, channel-count, duration, and discontinuity checks can identify defects, but they cannot prove that music has a groove or fits a mood.

Commit a pack revision only after the files, metadata, allowed combinations, and listening decisions are consistent. A pack commit makes an immutable catalog revision available; activation in a playback session and public publication are separate actions. Keep failed candidates out of the accepted pack while preserving enough information to explain useful revisions.

## 9. Proposed acceptance session

These checks describe future work and are not completed results.

| Check | Evidence to retain |
| --- | --- |
| Reopen source project | Correct instruments/content, no missing dependencies, expected arrangement and routing. |
| Editable interchange | Note pitches/timing/articulations survive the chosen MIDI or script route within documented limits. |
| Individual assets | Decoding succeeds; beginnings, endings, mapping, and unwanted silence are checked. |
| Bundle reconstruction | Common origin and expected mix are demonstrated; deliberate differences from the reference are recorded. |
| Allowed combinations | Representative sparse, dense, and overlapping-tail cases are heard and measured. |
| Transitions | Entry/exit rules work at the actual destination; no unexplained click, harmonic collision, or abrupt level jump. |
| Longer use | Repetition, fatigue, distraction, and variety are reviewed in a realistic work session. |
| Publication | Included content matches the deliverable's rights record and required notices. |

Record what the producer heard, which render was used, and what changed afterward. If an agent only inspected MIDI, screenshots, or meters, its report must say so. The [agent music workflow](AGENT_MUSIC_WORKFLOW.md) defines the corresponding brief, revision, and evidence loop.
