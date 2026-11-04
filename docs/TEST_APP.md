# Small standalone DJ test app

Document ID: `EM-D007`  
Status: MVP design only; not implemented.

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

The DJ owns selection, compatibility and timing. A request is not evidence that a song started. Test: play A, request a genre/track, hear procedural variation and a transition into B. Check bad/unavailable requests, Hold/Pause/Mute and that imported assets play with FL Studio and agent closed. A separate **Visual Basic AI controller** creates the sounds; do not embed a DAW in this playback page.

See [First playable](FIRST_PLAYABLE.md) for acceptance and [Validation](VALIDATION.md) for engineering/listening evidence.
