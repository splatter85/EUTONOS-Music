# S09 — real FL material through the unchanged pack contract

Document ID: `EM-D026`  
Scope: `EMF-S09`, `campaign-emf-001`. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status; the [handoff](handoffs/EMF-S09-HANDOFF.md) records the exact tested source, measurements and delivery state.

S09 joins the two halves of the campaign. FL Studio renders real recordings and one-shot samples on the owner's PC through the [S08 facade](S08_FL_AUTHORING.md). The [S06 importer](S06_IMPORT.md) turns them into an ordinary pack, unchanged. The DJ then hands off recording A → procedural bridge → recording B on that pack, with the bridge played from the FL samples. Nothing in the pack schema, importer, renderer or performer changed.

This is Windows engineering evidence. **Physical output and listening are NOT TESTED**; S10 is the owner's listening gate.

## Run it (Windows PC with FL Studio)

```sh
npm run fl:produce
npm run check:fl
npm run demo
```

Use `npm.cmd` where PowerShell refuses `npm.ps1`. FL Studio must be **closed**: the producer refuses to start while it runs, because a running FL is a competing writer ([EM-DEC026](DECISIONS.md)).

1. `fl:produce` (about two minutes) creates disposable copies of the factory template `fl-factory/create-a-chord-progression`, writes notes through the broker, lets FL load, verify and render each one with its own command line, and imports the result. Everything goes to the git-ignored `local/s09-fl/` folder: `delivery/` (the producer's data-only hand-over), `pack/` (the imported pack) and `workspace/` (FL projects, backups and journal). Running it again rebuilds the folder.
2. `check:fl` measures the handoff offline on that pack and drives the live DJ and sampler pages in headless Chromium. It writes `artifacts/s09-fl/fl-check.json` and screenshots. It is owner-local and not part of the portable gates.
3. With `npm run demo`, open **http://127.0.0.1:4173/?pack=fl** for the DJ, or **/procedural.html?pack=fl** for the sampler. The DJ page's **Pack** selector also switches between S01, the S06 mock and S09 real FL; changing it reloads the page, and it is locked while music plays.

On a machine without FL Studio or without a produced pack, the `fl` choice reports "Pack unavailable — choose a pack." and the other packs work as before. `npm run check` and `npm run check:browser` need no FL Studio.

## What FL produces

| Asset | Made from | Role / length |
| --- | --- | --- |
| `s09-fl-recording-a` | Slow chords, bass and kit, 8 bars at 120 BPM, A minor | Recording A (Explore) |
| `s09-fl-recording-b` | Busy arpeggio, bass and four-on-the-floor kit, same tempo and key | Recording B (Drive) |
| `s09-fl-kick` | One kick hit | drum, cut to ½ quarter |
| `s09-fl-hat` | One hat hit | percussion, cut to ¼ quarter |
| `s09-fl-bass-a2` | A2 bass note | bass, natural length (fits 1 quarter) |
| `s09-fl-chord-am` | A minor chord (A3 C4 E4) | harmony, cut to 2 quarters |

The pack is `s09-fl@1`, with palette `s09-fl-palette`, recipe `s09-fl-recipe` and one route `s09-a-to-b` (exit cue at 16 quarters, eight quarters of overlap). Note times are whole FL ticks (PPQ 96).

**Shaping.** FL's sounds ring longer than the performer's role gaps allow (`s06-performer-palette@1`). The importer only trims a tail that is already at or below −60 dBFS, so the producer shapes over-long one-shots itself: it cuts each to its role limit with a raised-cosine fade over the last 30 % and writes a canonical WAV header. `delivery/shaping.json` records each render's hash, natural and kept length. A shaped sample therefore carries no producer `expected_sha256`; the importer measures it like any other file. The kick went from 23,340 to 11,024 frames, the hat from 13,099 to 5,512, the chord from 119,894 to 44,099; the bass was kept at 12,638.

**Rights.** The renders use FL Studio factory sounds. By the owner's 2026-11-07 decision ([EM-DEC033](DECISIONS.md)) they may be reused as samples **on this PC only**: `license: owner-local-only`, `allowed_uses: [playback, sample-reuse]`, eligibility `fixture-only`, with a `PROVENANCE.md` beside the pack. They are never committed, published or hosted. The demo server serves `local/s09-fl/pack/` on loopback only and refuses the delivery and workspace folders.

## One hybrid policy per route

S05's policy named the S01 route and recipe. S09 makes the route identity choose the policy ([EM-DEC033](DECISIONS.md)):

| Policy | Route | Recipe |
| --- | --- | --- |
| `s05-hybrid-handoff@1` | `s01-a-to-b@1` | `s01-recipe@1` |
| `s06-mock-hybrid-handoff@1` | `s06-a-to-b@1` | `s06-mock-recipe@1` |
| `s09-hybrid-handoff@1` | `s09-a-to-b@1` | `s09-fl-recipe@1` |

`hybridPolicyForRoute` finds a policy only by exact route id and revision; a revised route needs its own policy. All three share the S04 performer, the one-bar lead-in and the one-bar tail, so the timing and ownership rules of [S05](S05_HYBRID.md) are unchanged. The DJ compiles its bridge from the loaded pack's own policy recipe; planning refuses a bridge whose performer or recipe is not the policy's.

## Measurements

`web/handoff-measure.ts` renders four offline passes per case (A alone, bridge alone, B alone and the mix) and checks the plan against independently computed boundaries. It requires exactly zero signal from each source outside its window, no clipping and no silence (below −60 dBFS in 10 ms windows) longer than two seconds. On the real-FL pack, three cases passed: 48 kHz seed 1 Explore phrase exit, 44.1 kHz seed 1, and 48 kHz seed 2 Drive end-of-A exit. The [handoff](handoffs/EMF-S09-HANDOFF.md) has the numbers.

Level and boundary figures are engineering measurements. They show where sound starts and stops and that nothing clips; they say nothing about whether it sounds good.

## Limits

- Windows only. FL authoring is Windows-led; macOS and Linux did not run any S09 check.
- Headless Chromium plays to no device. Physical output, device loss and human listening are NOT TESTED.
- FL renders are not byte-reproducible, so each `fl:produce` run makes a new pack hash. Two producers' palettes still give the same performer events.
- The procedural bridge plays whole one-shots on the grid; it does not reproduce FL's own synth patches or mixing.
- No live FL control, mixer, plugins, render settings or continuous playlist.
