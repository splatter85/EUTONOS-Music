# First listening and control app

Document ID: `EM-D007`  
Status: proposed test surface, 2026-11-03. No app has been built yet.

## Purpose

Provide a small, understandable way to hear the engine and learn which controls matter. It is the first consumer of the external state contract. It should remain useful without Mission Control, FL Studio or an AI model running.

The first view answers four questions: what is playing, what state did I ask for, what will happen next, and how can I change or hold it?

## Main controls

| Control | Suggested presentation | What it changes |
| --- | --- | --- |
| Play / pause / stop | Ordinary transport buttons | Starts, pauses or ends the session. Initial load stays silent. |
| State | Browse / Explore / Drive / Surge / Afterglow selector | Requests a named musical profile. |
| Energy | Gentle to driving slider | Arrangement and rhythmic drive within the selected material's bounds. |
| Atmosphere | Dry/direct to spacious/textural slider | Supported texture/space controls; avoid simply adding unlimited reverb. |
| Variation | Familiar to exploratory slider | Rate and amount of approved development. |
| Transition length | Short / medium / long, with bars and time estimate | Desired transition duration; show when a safe route requires more time. |
| Musical contrast | Related / different / adventurous | How much the next selection may differ, within compatible routes. |
| Tempo movement | Locked / small / wider, with a BPM bound | Permitted tempo changes and corresponding processing constraints. |
| Minimum stay | Time or sections | How long a musical identity should remain before a larger change. |
| Sources | Recorded / procedural / mixed | Eligible source preference. |
| Vocals | Off / occasional / featured | Vocal-activity preference, with unavailable states visible. |
| Hold this vibe | Hold state or hold recipe | Prevents unwanted large changes while allowing documented development. |
| Volume / mute | Independent controls | Listening level, independent of musical energy. |

Detailed controls should be collapsible. A non-musician can begin with state, energy, variation and transition length. A diagnostic panel can expose brightness, tension, rhythmic density, harmony, exact cue positions and processing choices.

## Now and next

Show the current source/recipe, section, BPM, musical position, and current state. Show the requested target separately, with a concise explanation such as “Drive requested; entering a stronger section at the next phrase.”

The transition preview shows the next material, duration, method, and any limitation. Examples: “same tempo, bass handoff,” “percussion bridge to a new key,” or “no approved direct route; a longer bridge is available.” Avoid claiming a source is playing until the engine confirms its start.

The browser should reconnect to an existing session without starting duplicate audio. A visible output-device label makes clear where local native playback is heard.

## Audition tools

An audition uses the same output ownership as ordinary playback. The first implementation pauses/checkpoints the main session and explicitly transfers the selected device to the audition; it does not layer a second independent player over the music. On completion, keep the main session resumable and offer an explicit resume action. A later automatic-return option must be opt-in and visible.

### A/B comparison

Compare two versions with matched playback gain and the same relevant excerpt. Keep the recipe/seed and other variables fixed when evaluating one change. Randomize order optionally for a listening experiment; save the actual versions and comparison settings.

### Transition audition

Choose source and target, then hear enough context before and after the transition. The preview should include tails and pickup material, not just the overlap. Save notes for groove, harmonic fit, bass collision, vocal conflict, level change and overall musical intent.

### Recipe audition

Select a recipe, seed and state. Regenerate one musical role or change one control while preserving the rest. Mark a variation as favored, rejected or needing revision. A star on one variation does not approve every possible seed.

### Save this vibe

Save source/recipe versions, seed, state settings, relevant arrangement position and history context. Offer a separate render/export operation if an exact audio recording is desired. Name the difference plainly.

## Example listening exercises

1. **Stay and develop:** remain in Explore through several sections. Confirm that novelty can increase without an unnecessary tempo rise.
2. **Rise and release:** Browse → Drive → Surge → Afterglow. Assess whether the descent preserves useful momentum.
3. **Hybrid transfer:** hear a recording hand a role to a procedural passage, then enter another recording.
4. **Large change:** request a different recipe family with a strict tempo bound. Inspect and hear the planned route.
5. **Conflicting requests:** send several rapid targets, then hold the current recipe. Confirm predictable arbitration and no stack of obsolete transitions.
6. **Long mood:** leave energy moderate while the selector explores several musical identities. Inspect repetition history and state fit.
7. **Unavailable source:** remove or invalidate a queued candidate and confirm an intentional continuation/fallback.

## External control demonstration

A separate small client should issue the same state requests through [the API](STATE_AND_CONTROL_API.md). The UI is an observer/controller, not a private route around the contract. Show command ID, pending status and actual outcome in the diagnostic panel.

The first campaign should include a deterministic event script so the same state sequence can be repeated against different recipes or engine backends. The script is an experiment fixture, not an imitation of measured human behavior.

## What to measure

- Command acknowledgment time and intentional wait until the musical boundary, separately.
- Planned versus observed transition start and completion.
- Audio underruns, peaks, callback/render cost, resident memory and prepared-cache size.
- Recipe/source/section/motif repetitions and eligible coverage.
- Human notes on groove, distraction, continuity, variety and preference.

Acceptance targets should be fixed for named hardware and settings in the campaign before qualification. Early measurements establish those targets; this document does not invent a universal CPU or latency guarantee.

## Scope of the first app

Keep the interface focused on listening and control. DAW project editing, model management, pack publishing and a full music-library editor can initially use separate authoring tools. The test app needs enough inspection to explain behavior and enough controls to compare it, without becoming a second DAW.
