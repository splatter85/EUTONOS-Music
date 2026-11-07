# Small standalone DJ test app

Document ID: `EM-D007`  
Status: S01–S09 are in main; [S09](S09_FL_IMPORT.md) is complete. The linked DJ/bridge and sampler form the engineering demo; both can play the S01 fixture, the S06 mock or the owner-local real-FL pack. Windows-only checks pass; physical output/listening and full three-layer MVP acceptance remain open.

## Implemented S03 subset

[S03 setup and policy](S03_DJ.md) provides Play/Pause/Stop, Volume/Mute, State, Genre, Next Song, manual FIFO queue/cancellation and Hold state & genre. The app sends revisioned commands to one DJ, which schedules the existing A→B route through S02's one-clock renderer. Requested targets, scheduled sources, Now and queued entries are displayed separately. The [S03 handoff](handoffs/EMF-S03-HANDOFF.md) records actual evidence and limits.

The recording fixtures support Explore/Drive and synthetic-test only. They do not supply every displayed target, a reverse B→A route, continuous playlist playback or adjustable transition lengths. The page retains the hidden-tab explicit-resume policy and same-origin playback lock. The [S07 sampler surface](S07_APP.md) plays the S01 or S06 imported mock palette with the same performer and player. The DJ page supplies the checked S05 S01 bridge; imported-content DJ/hybrid generalization remains S09. Physical output/listening are NOT TESTED; Mission Control integration waits for standalone acceptance.

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
