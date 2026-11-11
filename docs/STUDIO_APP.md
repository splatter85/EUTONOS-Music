# EUTONOS Studio

Document ID: `EM-D-STUDIO`. Status: built and browser-checked on Windows (2026-11-11). It is not a campaign slice and does not count as S10 or S11 acceptance. Physical output and listening are NOT TESTED.

EUTONOS Studio is one page with three tabs over the engines that already exist. It adds no new audio path.

- **DJ Booth** drives the S03/S05 `DeterministicDj`.
- **Produce** drives the S04 pattern sampler and the optional local AI generator.
- **Library** uses the S11 library, the pack catalogue and generated takes.

## Open it

```bash
npm run demo
```

Then open **http://127.0.0.1:4173/studio.html**. Pick the pack in the top bar: S01 original, S06 imported mock, or S09 real FL (owner-local, only if present). Switching packs reloads the page, so stop playback first. The older DJ page (`/`) and sampler page (`/procedural.html`) are unchanged, so S10 can still be judged on them.

## What each tab does

| Tab | Controls | Under the hood |
| --- | --- | --- |
| DJ Booth | Two decks with waveform, time and ON AIR light. Queue A/B. Play, pause and stop. **Mix to next**, Cancel mix, Hold. Crossfade/Bridge style and five energy pads. | The same control requests as the S09 page. The crossfader and playheads are drawn from the audio clock. They are not measured output. The pack decides the A → B route. |
| Produce | **Pattern sampler:** a step grid, seed with 🎲, Explore/Drive, play/stop and ♥ Save to Library. **AI generator:** a description, BPM, key, length and number of takes, then Generate, with recent takes to preview and star. | The sampler calls `compilePhrase` on the pack's first recipe and plays it with `SmallPlayer.playProcedural`. The generator calls the separate Music Studio service. |
| Library | **Saved patterns:** Open (restores into Produce, stopped) and Delete. **Generated takes:** preview, star, reject and Send to EUTONOS. **Tracks in this pack:** BPM, key, length and eligibility. | Uses `MusicLibrary` over IndexedDB, `captureRecipeReplay` and `resolveVibe`. A saved pattern only opens with the exact pack it was saved from. |

## One playback owner

The page holds the same Web Lock as the other pages (`eutonos-music-s02-playback`). Starting the DJ, the sampler or a take preview first stops whichever is playing. Hiding the tab pauses playback. The page uses `requestAnimationFrame` to redraw, with a 250 ms timer as a fallback for windows that stop animation frames.

## The AI generator (optional)

The Produce and Library tabs talk to the **Music Studio** service at `http://127.0.0.1:7870`. Music Studio is the owner's separate local app over ACE-Step, and it lives outside this repository. If it isn't running, the generator card says so and Generate stays disabled. Nothing else on the page depends on it.

The page uses these calls:

- `GET /api/health`
- `POST /api/engine/start`
- `POST /api/generate`
- `GET /api/jobs/:id`
- `GET /api/takes`
- `GET /api/takes/:id/audio`
- `PATCH /api/takes/:id`
- `POST /api/takes/:id/export`

Generated takes are unreviewed until the owner listens to them. **Send to EUTONOS** only asks Music Studio to write an export. Importing a take into a pack still goes through the S06 importer and its rights and eligibility checks.

## Checks

`npm run check:browser` now ends with `node dist/scripts/studio-check.js`. It runs headless Chromium on a random loopback port and checks the following:

1. The pack loads.
2. The DJ plays A, mixes to B and stops.
3. The Bridge toggle and the energy pad work.
4. The generator shows its offline state.
5. The sampler plays, stops, rolls a seed and saves.
6. Starting the DJ stops the sampler.
7. A saved pattern restores from the Library.
8. Against an **in-test fake** Music Studio: generate, the takes list and star all work.
9. All three tabs fit a 390 px phone width.
10. There are no page errors.

Screenshots and `report.json` go to `artifacts/studio-browser/`.

What the check does not show: the real Music Studio service, real generation, audio-device output, listening quality, and macOS or Linux (it ran on Windows only).
