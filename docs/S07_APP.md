# S07 — integrated engineering demo

Document ID: `EM-D025`  
Scope: `EMF-S07`, `campaign-emf-001`. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status and the [handoff](handoffs/EMF-S07-HANDOFF.md) records the exact tested source, review and delivery state.

S07 connects the existing recording DJ/hybrid and procedural sampler as two linked surfaces of one local demo. The sampler now plays either the original S01 palette or the S06 imported mock palette through the existing `SmallPlayer`. This is a playable engineering proof, not an accepted MVP.

## Run and compare

The declared runtime is Node 24.x. The S07 Windows verification used the available Node 26.12.1; no runtime, browser or package was installed for this slice. From a prepared checkout:

```sh
npm run check
npm run check:browser
npm run demo
```

On Windows PowerShell where `npm.ps1` is disabled, use `npm.cmd` with the same arguments. A fresh dependency setup uses only `npm ci --ignore-scripts`; the browser gate requires an already available Playwright Chromium. `check:browser` generates the mock pack and starts/closes its own isolated loopback server and browser. `demo` also generates the mock pack before serving at **http://127.0.0.1:4173/**. Stop it with Ctrl+C. No FL Studio is involved.

1. On **DJ & bridge**, press Play and then Next Song before A reaches its eight-second exit. Select **Procedural bridge** before Next Song to exercise S05. Requested state/genre, pending selection, manual queue and renderer-active Now remain separate.
2. Follow **Play the S06 imported mock palette** to **Sampler & palettes**, or open **http://127.0.0.1:4173/procedural.html?pack=mock-fl**. The palette and symbolic phrase plan prepare silently; an AudioContext is created only on Play variation.
3. Play seed **1**, Explore. Pause/Resume freezes/continues the audio clock; Mute/Volume act on output. Stop, choose **S01 original**, and replay the same seed and arrangement. Both produce 77 sample events for this selection, with the same rhythm plan and different sample audio. Try seed **2** or Drive after stopping.
4. The palette selector is disabled during loading, scheduled playback, playback and pause. Stop before switching; a switch closes the old context and clears the old plan. Refresh preserves the palette choice and stays silent. Missing, corrupt and unknown selections cannot fall back to unvalidated audio; the picker clears, so choosing any palette, including the same one, retries.
5. **Offline checks** runs the existing native render comparisons without establishing physical output. The demo pages share the existing same-origin Web Lock, so another tab cannot take playback even from a paused owner. Stop or navigate away before an explicit Play in the other surface.

## Why two surfaces

S02/S03 already own transport and DJ requests; S04 already owns finite sampler audition; S05 has one reviewed S01 route; S06 supplies the general performer palette contract and imported mock pack. Linking these surfaces and exposing palette comparison is the smallest result that puts S02–S06 in the normal demo path without inventing a second DJ or playback engine.

The sampler calls the existing `compilePhrase` with the selected pack's exact recipe reference and constructs `SmallPlayer` with that pack's route. The selection is limited to the two bundled fixtures; it is not a library manager, arbitrary URL importer or imported-recording DJ. The existing loader still checks hashes, eligibility, rights evidence and resource bounds. The only clock is the owning player's AudioContext. UI rendering reads state; it does not schedule musical events. Changing palette disposes the old player before preparing the new pack; restored pages revalidate without autoplay (by inspection only; the browser runner does not exercise a real back/forward-cache restore).

The DJ and S05 hybrid still use S01 recordings and recipe. [S09](S09_FL_IMPORT.md) has since generalized that policy by route and plays real FL imports. Transition lengths, persistent catalogue/history, continuous playback, background listening and broader genres remain their existing staged work.

## Verification and limits

`npm run check` retains the Node, fixture regeneration and media-validation gates. `npm run check:browser` retains all 23 native offline groups and the existing 12 browser report groups; S07 adds three UI groups covering main-page entry, imported playback, silent preparation, same-seed palette comparison, context disposal, pause/mute, ownership/navigation, failure/recovery, refresh and mobile fit. Reports and screenshots go to ignored `artifacts/s07-browser/`. These are local artifacts, not committed or hosted evidence.

The renderer, DJ, importer and original media are unchanged. The [S01 provenance](../fixtures/s01/PROVENANCE.md) and [S06 mock producer](S06_IMPORT.md#the-mock-fl-producer) describe the original engineering assets. No downloaded/proprietary audio, credentials, new dependencies, real FL operations or MCP authoring tool calls are part of S07. The mock generator exercises the in-process broker only. Generated mock audio remains under ignored `dist/`.

Verification is **Windows only**. macOS/Linux and the declared Node 24 runtime were not run for S07. Chromium headless scheduling and offline rendering do not establish real audio-device behavior, sleep/device recovery, other browsers, musical quality or owner acceptance. Physical output and listening are **NOT TESTED**. The independent review and its corrections are recorded in [the S07 review](reviews/EMF_S07_APP_REVIEW.md). Same-origin locks do not exclude other origins, browser profiles or applications. S09 joins eligible real FL outputs; S10 supplies owner listening acceptance before Mission Control integration.
