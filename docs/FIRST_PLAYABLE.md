# First playable — standalone three-layer MVP

Document ID: `EM-D016`  
Status: **direction selected; S01 contracts/fixtures implemented, no playable MVP or listening qualification**. Supersedes the previous Mission-Control-first sequence, without deleting the wider requirements.

**Platforms:** Windows first for real FL/MCP integration, with Windows, macOS and Linux required for the shared music system. Each host-specific authoring adapter and browser/audio-device path needs its own verification; portable fixture/test execution alone does not establish it.

## 1. MCP-based AI music production (optional visual controller)

**Codex or Claude Code uses the unified EUTONOS Music MCP server** to accept a plain-language prompt such as “Make an 8-bar dark-house bass-and-drum loop, 124 BPM, in A minor.” It uses an available **Codex or Claude** integration to prepare editable MIDI or a supported FL Piano roll script, applies a bounded change in a disposable FL Studio project, and produces at least one verified exported audio loop/sound. Store source project, tempo, meter, length, key if established, file hash, genre and rights.

One *real* agent → MCP → editable FL project → export path is mandatory; not a mocked prompt box. The MCP facade routes to FL's MIDI/Piano roll script API, selectively tested Windows UI automation and the official saved-project render path as appropriate. A visual front end (including VB.NET) is optional and calls these same tools. Read [Unified FL agent control](FL_AGENT_CONTROL.md) for capability gaps, tool design and agent instructions. If the installed FL Studio interface needs a manual script-invoke/export click, make it visible and repeatable rather than pretending it is automated. Broader FL MCP/GUI automation can follow later. The AI controller is for creation, **not required during playback**.

## 2. Procedural generator

Use the produced sounds as a small instrument palette inside **one worthwhile recipe** (drums, bass and harmony/texture as appropriate). Vary phrasing, fills and sections while retaining musical identity, with versioned seeds and bounded note/voice choices. Start with **one compatible BPM, 4/4 meter and harmonic region**. A timing test using beeps does not satisfy the musical result. No real-time model calls.

## 3. DJ

Load **two distinct eligible recordings** plus the procedural recipe. Expose `setState`, `requestGenre`, `nextSong` and optional `queueTrack`, along with Hold and transition length. When the listener makes a request, choose a valid next selection, show what is queued, and transition at the next agreed musical boundary. Demonstrate a phrase-aligned mix and a percussion/breakdown/fade bridge. Prevent overlapping incompatible bass parts and cut-off tails. Show a clear “no eligible track” outcome rather than random selection.

## Implementation order and PC handoff

Develop the browser DJ, requests/playlist, procedural source and test app first in **ChatGPT/GitHub** with a reusable audio-pack contract and original/eligible fixtures. This produces a **cloud-playable proof**, not complete MVP acceptance. Once the pack contract is committed, the **PC FL Studio/MCP authoring slice can run in parallel**; it supplies actual exported sounds through the identical contract. After cloud integration tests, pull the checked build to Windows and verify the complete three-layer production→generator→DJ system and real listening. Only then integrate Mission Control. The [EMF execution slices](campaigns/EMF_INITIAL_INFRASTRUCTURE.md#execution-slices--authoritative-order-and-environment) own exact dependencies and handoff notices.

## Tiny standalone test app

A simple browser UI with **Play/Pause, Volume/Mute, State, Genre, Next Song, Hold, Transition (short/medium/long), Now Playing and Queued Next**. The app controls the DJ, not individual audio streams. One renderer, audio clock and output owner. Web Audio is a starting candidate; a native worker needs an observed reason. Advanced parameters, a full media library editor and Mission Control are excluded.

## Complete MVP acceptance sequence

1. Give Codex or Claude a musical request through the MCP facade. Inspect the actual FL edit and exported sound.
2. Import the sound into the generator. Hear several meaningful variations—not the same loop forever.
3. Play recording A. Request another genre/track or state through the small app. Watch the pending choice and hear the DJ perform **A → procedural → different recorded B** without a jarring cut.
4. Verify Hold, Pause, Mute, a mid-phrase request, an unavailable-genre fallback, and clean playback continuation.
5. Close FL Studio and the agent. The imported music still plays.
6. Record what was **heard**, source versions and any clipping/timing problems on the selected Windows machine.

**MVP is not complete until all three layers and the app really work together.** A successful source review or isolated generator demo does not count.

## Deliberately deferred

Mission Control integration (until standalone success), activity inference, a 72-hour unique library, all-genre recipes, AI singing, arbitrary tempo and key stretching, complex DJ graph/history, cloud/marketplace, full FL automation, and multiple audio backends.

[Current Tasks](CURRENT_TASKS.md) and [EMF campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) own the next work and stage status.
