# Small standalone DJ test app

Document ID: `EM-D007`  
Status: S02's small recording player is implemented; the full MVP controls below remain staged work.

## Implemented S02 subset

[S02 player setup](S02_PLAYER.md) provides Play A/B, Pause/Resume, Stop, Volume/Mute, Now/Next and one scheduled A→B route from the validated S01 pack. Native Web Audio owns all audio timing. The page pauses when hidden and uses a cooperating same-origin tab lock. The [S02 handoff](handoffs/EMF-S02-HANDOFF.md) records actual browser/offline evidence and its limits. No state/genre/queue/Hold DJ or live procedural source is implemented by S02.

## Later full MVP

The first app is **not Mission Control**. It exercises the DJ and procedural player directly.

| Control | Behavior |
| --- | --- |
| Play / Pause / Mute / Volume | Explicit transport and audible level |
| State | Browse, Explore, Drive, Surge, Afterglow as musical requests |
| Genre | Ask DJ to choose eligible next material within a selected genre |
| Next Song | Request another eligible recording; optionally queue a known track |
| Hold | Keep the current vibe until released |
| Transition | Short, medium or long according to valid musical boundaries |
| Now / Next | Show audible material, queued material and transition status |

The DJ owns selection, compatibility and timing. A request is not evidence that a song started. Test: play A, request a genre/track, hear procedural variation and a transition into B. Check bad/unavailable requests, Hold/Pause/Mute and that imported assets play with FL Studio and agent closed. A separate **FL Studio/MCP authoring lane** creates the sounds, with an optional graphical controller; do not embed a DAW in this playback page.

See [First playable](FIRST_PLAYABLE.md) for acceptance and [Validation](VALIDATION.md) for engineering/listening evidence.
