# Small standalone DJ test app

Document ID: `EM-D007`  
Status: S03 connects DJ requests to the small recording player; the separate S04 sampler audition is COMPLETE as a CLOUD slice. The full three-layer MVP remains staged work.

## Implemented S03 subset

[S03 setup and policy](S03_DJ.md) provides Play/Pause/Stop, Volume/Mute, State, Genre, Next Song, manual FIFO queue/cancellation and Hold state & genre. The app sends revisioned commands to one DJ, which schedules the existing A→B route through S02's one-clock renderer. Requested targets, scheduled sources, Now and queued entries are displayed separately. The [S03 handoff](handoffs/EMF-S03-HANDOFF.md) records actual evidence and limits.

The recording fixtures support Explore/Drive and synthetic-test only. They do not supply every displayed target, a reverse B→A route, continuous playlist playback or adjustable transition lengths. The page retains the hidden-tab explicit-resume policy and same-origin playback lock. The [S04 sampler page](S04_PROCEDURAL.md) auditions a finite seeded source through the same player, without adding it to DJ selection or routes. S04 is COMPLETE on `work/emf-s04-procedural-20261104` after Node, native and browser checks passed on Windows, macOS and Linux. Main remains intentionally unchanged. S04 requires no PC action; physical output and listening are NOT TESTED. S05 is next as a separately assigned CLOUD slice from the S04 branch. Mission Control integration remains later work.

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
