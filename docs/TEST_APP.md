# First listening and control app

Document ID: `EM-D007`  
Status: proposed surface, revised 2026-11-03. No app implemented.

## Mission Control panel and listening lab

The Mission Control panel is the first consumer UI. The separate lab is a test harness and fallback, not a second DAW or proof that MC integration works. Both use the same state/control contract. A fresh listener should enable Music, press Play and hear an approved pack without FL, a model, an agent account or music-theory setup.

[First playable](FIRST_PLAYABLE.md) owns the proof/pilot boundaries. Initial load is silent. Missing content or unsupported audio is visible, not disguised by a silent successful Play button.

## Default view

| Control | Meaning |
| --- | --- |
| Play / pause; stop available | Explicit transport; automatic activity never overrides a deliberate stop |
| Volume / mute | Listening level, independent of energy |
| Vibe | Browse, Explore, Drive, Surge, Afterglow or an edited profile |
| Energy | Arrangement/rhythmic drive within the available material's bounds |
| Variety | Familiar to exploratory development, separate from energy |
| Hold this vibe | Hold target character while allowing appropriate development |
| Skip / favorite | Scoped to the actual selection; optional reason and reversible preferences |

Show current music, requested state and a short next-action sentence such as “Drive requested; stronger section at the next phrase.” Do not show a request as already audible. Preserve keyboard operation, accessible names and focus. Do not rely on color or animation alone.

## Advanced and laboratory controls

Retain atmosphere, brightness, tension, density, transition length, musical contrast, tempo movement, minimum stay, recorded/procedural/mixed preference and vocal activity. Show bars and a time estimate where meaningful. Disable unsupported dimensions with an explanation instead of moving an inert slider.

Separate hold state, hold recipe and hold a bounded moment in the lab, stating what remains free to change. Minimum stay begins at audible entry; a bounded pending-wait policy prevents indefinite delay. A new target may need a bridge; explicit mute/stop does not wait for a phrase.

A native renderer identifies the output device and any chosen keep-playing-on-tab-close behavior. A browser renderer identifies its owner page and actual lifecycle limits. Reconnecting or opening another tab must not start another soundtrack. Do not silently switch renderers or output devices.

## Auditions and saved vibes

Auditions use the same playback ownership as the main session. Pause/checkpoint and explicitly transfer ownership; leave the main session resumable rather than mixing two independent soundtracks. Return/resume is explicit unless an opt-in automatic-return behavior is later qualified.

For A/B, match playback gain and compare the same relevant excerpt. Hold seed/palette/other variables fixed when changing one parameter; optionally counterbalance order. For transitions, hear enough context before and after the handoff, including pickups and tails. For recipe trials, include seeds chosen before listening, not only curated successes.

Save-this-vibe records content/recipe/DSP versions, seed, settings and relevant context. Label setup reproduction separately from exact recorded output, which needs a render/export. Record favorite/rejected/needs-revision against the actual revision and never imply one favored seed approves every possible variation.

## Experiments

Use a repeatable event sequence for controlled comparisons, clearly labeled synthetic. Then verify the real MC integration and real work sessions.

| Exercise | Decision it informs |
| --- | --- |
| Recorded A → procedural → different B | Is the defining hybrid experience musically credible? |
| One state, several identities | Does variety work without escalation? |
| One identity, rise and release | Can state adaptation develop rather than replace music? |
| Hold amid rapid requests | Does the listener remain in control? |
| Fixed versus adaptive, matched content/level | Is adaptation helpful to this listener? |
| Missing next asset or late job | Is fallback intentional and understandable? |
| Reconnect, duplicate tab and concurrent work | Is the actual deployment reliable? |
| Agent traffic without human input | Does the adapter avoid spurious Surge? |

## Observability without a cockpit

Keep timing/resource logs, command IDs, plan versions, route choices, signal freshness and unsupported-control details in diagnostics. Measure acceptance delay separately from deliberate musical wait. Capture dropouts, peaks, memory/cache trends and motif/recipe repeats. Set numerical thresholds for the actual environment before qualification.

The default panel should remain about listening. FL editing, model management, pack publication and detailed library authoring are separate tools. [Validation](VALIDATION.md) owns acceptance evidence; graphical activity alone proves neither sound nor usefulness.
