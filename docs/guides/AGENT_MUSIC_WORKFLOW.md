# Working with Codex or Claude to create music

**Status: design/research; not implemented/tested.** The workflow, operation names, evidence records, and pack-commit behavior below are proposals. No EUTONOS-Music MCP tools, audio models, production session, or audition results are supplied by this document. References checked **2026-11-03, America/Chicago**.

## 1. The collaboration we want

The producer should be able to say what they want in musical language, hear a concrete result, and refine it without manually translating every idea into a DAW operation. An agent can help develop the arrangement, write editable notes, design a controlled generator, configure supported controls, document sound choices, and prepare exports. The producer remains the source of taste and acceptance.

The same workflow should support a single sound, a finished track, or material for adaptive playback. These differ in their deliverables and evaluation; they need not use different assistant personalities or depend on a single genre engine. A model can propose options, but a runnable recipe, an FL project, and a measured render are separate artifacts with separate evidence.

Use the [FL integration contract](../FL_STUDIO_INTEGRATION.md) for proposed tools and failure handling, and the [producer workflow](FL_STUDIO_WORKFLOW.md) for detailed capture/export decisions. Runtime state changes belong to the [state and control API](../STATE_AND_CONTROL_API.md); model reasoning is not scheduled on the audio clock.

## 2. Connect only to capabilities that actually exist

The intended client is a locally configured Codex or Claude instance that can reach the reviewed authoring adapter on the DAW machine. Official [Codex MCP](https://developers.openai.com/codex/mcp) and [Claude Code MCP](https://code.claude.com/docs/en/mcp) documentation covers client configuration. Neither document establishes that an FL bridge is installed or working.

At session start, discover the actual tools, inspect the bridge, and read the relevant project state. Record the client, adapter revision, host session, and supported operations. A local launch command, MIDI connection, and working note-editing path must be verified separately. Keep machine-specific configuration and account information local.

The agent must distinguish:

| Evidence | What it supports | What it does not support |
| --- | --- | --- |
| A tool appears in discovery | The server advertises the operation | The operation works on this FL build |
| A request was queued | A pending action exists | Notes were applied to the correct score |
| A control was read back | That observed value changed | The audible result is good |
| A render decoded and was measured | The specific file exists with measured properties | It matches the producer's taste or has cleared rights |
| The producer auditioned a named render | A listening judgment about that render | Acceptance of every possible combination or later revision |

If the bridge is unavailable, continue useful work with an arrangement plan, editable MIDI, a reviewed Piano roll script, or precise manual settings. The [official MIDI import reference](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/automation_midiimport.htm) provides the interchange route. Report the remaining application or export step clearly; do not describe a prepared file as a completed DAW edit.

## 3. Brief → plan → audition → revise → commit

### Step 1: Turn the request into a musical brief

Capture enough detail to make a first attempt: deliverable, mood, style, duration, rhythm, tonal intent, instrumentation, variation, vocals, and constraints. Separate energy from tempo, brightness from loudness, and complexity from density. Translate vague language into hypotheses the producer can hear.

For example, “make this more creative while I think” could become a proposed change to harmony or texture while preserving tempo and pulse. That is a production interpretation to audition, not evidence that music detects the producer's mental state or improves productivity.

Ask only about missing choices that would materially change the work. When the brief is sufficient, make a concrete first version. Establish the session's allowed actions once: which project and region may change, which palette to use, and whether the current task includes local rendering or publication. Routine revisions within that scope can proceed without repeatedly requesting permission.

### Step 2: Inspect and make a bounded plan

Inspect the current project and actual instrument inventory. Do not assume a plugin exists because it is familiar or because the producer owns a high edition. Read the current pattern/channel/routing state before making changes.

Produce a short plan containing:

- Musical intent and the existing material to preserve.
- Exact region and roles to create or revise.
- Instruments, articulation, effects, and routing to use.
- The available application route: controller control, staged Piano roll operation, MIDI import, or producer action.
- A small set of audition candidates and the question each candidate answers.
- Source/revision identity and the export or listening evidence needed next.

Avoid large all-at-once changes. If the desired result needs an unavailable plugin or unsupported host operation, propose a concrete alternative from the available inventory or specify the missing producer step. Do not silently substitute a different musical goal.

### Step 3: Create editable material

Generate notes, automation proposals, synthesis settings, or recording instructions in an inspectable representation. Prefer named roles and bounded regions. Preserve the chosen seed and generator revision when procedural choices are involved; store deliberate human edits as revisions rather than regenerating over them.

An original motif should have phrasing and relationships, not simply pitches sampled from a scale. A groove should define accents, timing, and the interaction of parts. A sustained sound should have a useful envelope and modulation behavior. The agent's job is to make these decisions legible enough to improve.

Use the proposed `fl_change_prepare`/`fl_change_apply` route only once it exists and is verified. A note batch sent through `fl_notes_stage` remains pending until its application is observed. If the host requires a producer to run a Piano roll script, state the exact pending operation and target; the separate [Piano roll API](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll_scripting_api.htm) is the underlying authoring surface, not an assurance of automatic execution.

### Step 4: Audition an identifiable result

Prepare a short, useful listening passage before spending time on a complete track or large pack. For A/B comparison, change a limited dimension, use the same section, and keep intended playback gain comparable. A louder alternative should not win merely because it is louder.

An audition record should identify the render or live project revision, asset hash when available, start/end range, compared variants, playback conditions where relevant, and the producer's judgment. Useful questions include whether the groove holds attention, the motif distracts, the bass masks another role, the texture matches the mood, or the transition feels inevitable.

An agent must state its evidence accurately. If it can only read note data and meters, it can describe those observations and ask the producer to listen. If a tool actually analyzes audio, record which file and method were used. Never claim “I listened,” “this sounds polished,” or “the mix is clean” on the basis of a filename, generated MIDI, successful export, or a source README.

### Step 5: Revise from specific feedback

Translate feedback into controlled edits. “Too busy” may mean fewer foreground events, less syncopation, shorter reverb, or less harmonic movement; make the interpretation explicit. “More drive” might change bass articulation, percussion subdivision, or phrase momentum before changing tempo.

Keep an accepted baseline and revise a copy or a managed region. Compare against the baseline instead of accumulating changes without reference. After a timeout, restart, or manual project change, inspect the actual state before continuing. A stale command is not a reason to resend an append or overwrite automatically.

### Step 6: Commit an accepted pack or track revision

Commit only the material the evidence covers. A pack revision should reference immutable assets, a recipe revision where applicable, an arrangement plan, a mix plan, compatible transition edges, rights records, and audition decisions. A finished track should retain its source/dependency record and the accepted render.

Technical validation, musical acceptance, and distribution rights are independent. A valid WAV can contain weak music; a strong private production can contain sounds that cannot be republished as a reusable library. Follow the rights and export requirements in the [FL workflow](FL_STUDIO_WORKFLOW.md).

A catalog commit is not automatic public release or activation in a playback session. Preserve the producer's authorized scope. This repository's current publication contains planning documentation, not generated musical assets.

## 4. Three example briefs and execution plans

### A. Create an original instrument

**Brief:** “Design a warm, evolving pad that stays behind speech and typing. Give me a stable version and a more restless version.”

Inspect available synthesis tools; propose a register, envelope, modulation range, and two distinct movement behaviors. Author the patch from an appropriate source, audition held notes and a simple progression, and compare both at similar perceived level. Revise attack, motion, and bandwidth before expanding to multisamples. If public redistribution is intended, resolve the source/instrument rights before capturing the final reusable instrument. Store mapping and release behavior separately from the listening example.

### B. Build an adaptive electronic family

**Brief:** “Give this deep-house groove a darker, more driven version, but keep its identity and tempo. It needs a graceful coast when activity drops.”

Preserve the chord cycle and core motif. Propose distinct sparse, driven, and coast arrangements, with compatible bass/percussion choices and a composed transition. Render aligned role stems and transition material. Audition the full combinations and each allowed entry/exit, including a short high-energy burst followed by a coast. Commit compatible choices and constraints; do not mark every stem as freely interchangeable.

### C. Finish a piece outside the first genre experiments

**Brief:** “Make a three-minute cinematic piece with felt-like piano, bowed textures, and an uplifting final section.”

Develop an arrangement plan and editable harmonic/melodic material. Use available, properly licensed instruments or recorded performances; identify articulation and dynamic requirements. Audition a representative passage, then develop the complete form. Render and review the full piece, including its ending. If it later becomes adaptive material, plan that transformation explicitly rather than assuming the final master supplies all required loops and transitions.

## 5. Collaborating agents and a single DAW writer

Several agents can contribute different artifacts: arrangement options, sound-design notes, MIDI candidates, technical analysis, or provenance checks. Only one adapter lease holder should mutate the live project. Contributors pass proposed changes to that writer with target, intent, and evidence; they do not compete for FL focus or the current Piano roll.

Keep model outputs outside realtime playback. A native service should continue using accepted assets while new material is generated, evaluated, or rejected. Caching a completed musical plan is useful; repeatedly asking a model to decide the next beat is not part of this design.

## 6. Evidence and recovery rules

Keep a compact session record: brief, source revision, proposed changes, operation IDs, readbacks, render hashes, audition feedback, and accepted revision. Store sufficient information to reproduce decisions without publishing private workstation paths, project content, account details, or unrelated conversation history.

Use separate facts and judgments in the final session report. “The file contains the expected sixteen-bar body” is a measurable claim. “The producer preferred the sparser second version for thinking” is a listening judgment. “This should improve focus” is a hypothesis requiring its own evaluation.

If a plugin ignores a parameter, report the actual value. If a script remains queued, report it as queued. If a response disappears after dispatch, report an uncertain outcome and inspect before retrying. If audio cannot be rendered automatically, supply the export plan and register the file after the producer exports it. Never fill a missing observation with a plausible success story.

## 7. First end-to-end acceptance proposal

Use one saved test project, one known instrument, one short editable phrase, and two clearly differentiated variants. Demonstrate discovery, preparation, correct-target application, producer audition, one revision, export, file validation, and a local catalog commit. Include a deliberately stale target and a duplicate request to establish that the bridge protects the intended work.

Then repeat with a coordinated stem bundle and one transition. Confirm the producer can reopen the source, hear the accepted result, identify the chosen variant, and trace each committed asset to its origin. The first successful demonstration should state exact versions and manual steps. It should establish a trustworthy collaboration loop before broader genre coverage or unattended production is claimed.
