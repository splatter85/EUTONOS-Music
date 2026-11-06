# EMF-S07 integrated demo review

**Campaign:** `campaign-emf-001`  
**Slice:** EMF-S07 — integrated engineering demo: linked DJ/bridge and sampler surfaces, original/imported mock palette selection (built on the owner's PC)  
**Date:** 2026-11-06, America/Chicago  
**Disposition:** **KEEP for the bounded demo scope after the corrections below.** The corrected source passes on Windows only. The [S07 handoff](../handoffs/EMF-S07-HANDOFF.md) owns the source pin, evidence and next step.

## Method and applicability

The worker self-reviewed its own change (recorded in the handoff). A separate, read-only reviewing agent then inspected `git diff 7f86dbb..e4bfbfb` (source in `0cec058`): `web/procedural.ts`, `web/procedural.html`, `web/index.html`, `web/style.css`, `scripts/serve.ts` and `scripts/browser-check.ts`, against the [S07 guide](../S07_APP.md), the handoff, the campaign's S07 row, the [S04](../S04_PROCEDURAL.md) and [S06](../S06_IMPORT.md) guides, the pack loader and the phrase compiler. It ran one throwaway probe of the built phrase compiler against both bundled manifests from its own temporary folder and edited no repository file. The coordinator applied the corrections, added browser regressions and re-ran both gates. The reviewer did not re-review the corrected source.

This is a scope-specific engineering review. It does not cover physical output, listening, macOS/Linux, other browsers, real back/forward-cache restoration or real FL Studio output.

## KEEP — checked with no finding

- **Server routes.** `scripts/serve.ts` changed only its log text. The generated-pack route still serves only `pack/*.{json,md,wav}` and `pack/audio/*`, case-sensitively; the real-path check still refuses wrong-case files and symlinks, and traversal is still refused.
- **Contract checks.** The sampler still loads through `loadBrowserPack` (hashes, eligibility, rights evidence and size bounds) and compiles through `compilePhrase`, which applies the `s06-performer-palette@1` structural rules. Neither is bypassed.
- **Recipe and route binding.** Ids come from the selected pack (`recipes[0]`, `routes[0]`). Probe: S01 `s01-recipe@1` / `s01-a-to-b`; mock `s06-mock-recipe@1` / `s06-a-to-b`; both 120 BPM, pitch classes 0, 4, 9.
- **Event counts (probe).** Seed 1 Explore gives 77 events for both packs, Drive 92; seed 2 gives 73 / 80. The guide's figures are right.
- **Audio start.** Selection and restore create no AudioContext; one is made only from Play. Dispose stops, disconnects and closes the context; the shared Web Lock is released on palette switch and on `pagehide`.
- **Selection guards.** The picker is disabled while loading, scheduled, playing and paused; load epochs discard stale loads after a later selection or `pagehide`.
- **DJ/hybrid.** `web/app.ts` is unchanged, so the DJ and S05 bridge stay S01-only for S09.
- **Counts and wording.** 161 Node tests, 23 native offline groups and 15 browser report groups agree across the status documents. Listening, macOS/Linux, Node 24, FL Studio and MVP acceptance are marked NOT TESTED / NOT RUN.
- **Privacy and accessibility.** No secrets, private paths, media or dependencies were added. The demo navigation has `aria-label` and `aria-current`; the palette select is labelled and has a focus style.

## CHANGE — corrected and rechecked

| Finding | Correction and evidence |
| --- | --- |
| **Low–medium.** `selectPack` did not recheck its load epoch after waiting for the old player to close, so a stale call could still set the selected palette, the picker value and the `?pack=` URL after a newer call had started. Reachable only through a back/forward-cache restore during a pending close (read, not probed). | `selectPack` now returns when its epoch is stale immediately after the old player closes. |
| **Low.** After a failed load the picker still showed an option, and choosing that same option fired no change, so a missing palette could not be retried without switching away; `?pack=unknown` kept reloading the unknown value. | A failed load clears the picker (`selectedIndex = -1`), so any choice retries; an unknown value is removed from the URL. New browser assertions: the picker is empty after a missing and after an unknown palette, the URL loses `pack=`, and choosing the same palette again after a corrupt load recovers. |
| **Low (accessibility).** After a failure the `role=status` line still said "Loading palette…", the intro text was not a live region, and the ready status did not name the selected palette. | The status line reports "Palette unavailable" after a failure and "Ready — *palette* — press Play variation to start" when ready; the intro text is `aria-live="polite"`. New assertions check both palette-specific ready texts and the failure text. |
| **Low.** A new AudioContext was created before `SmallPlayer` checked the route, so a pack whose route failed that check would leak one context per Play. Not reachable with the two bundled packs. | The context is closed if the player constructor throws. |
| **Low (test strength).** The palette comparison matched only the event count, which does not depend on the palette. | The checks now also assert the selection detail and ready status name the selected palette, alongside the existing plan-detail palette ids. |
| **Low (wording).** The guide and progress entry stated restored-page revalidation as fact; the browser runner never exercises a real back/forward-cache restore. The demo link said "Play" although selection is deliberately silent, and the server still called itself the S02 demo. | The guide and progress entry now say restoration is handled by inspection only. The link reads "Open the S06 imported mock palette"; the server log says "the demo". The campaign progress estimate now includes S07. |

## Remaining limits

- Real back/forward-cache restoration, OS sleep and device loss are not exercised; the stale-epoch guards are checked by reading only.
- The selection detail still states "120 BPM · A minor" and the intro "four original samples" as fixed text. Both are true for the two bundled packs; a general library would read them from the pack.
- Same-origin Web Locks do not exclude other origins, browser profiles or applications.
- Nobody has listened to either palette through the demo.

## Executed checks after correction

Windows 11, Node 26.12.1 (the package declares 24), headless Chromium 151.0.7922.34, Playwright 1.62.1, at the corrected source given in the handoff:

- `npm.cmd run check`: **161/161 Node tests**, unchanged fixture regeneration and six media validations.
- `npm.cmd run check:browser`: **23/23 native offline groups** and **15/15 browser report groups**, no page script errors.

macOS and Linux were not run. **No FL Studio ran. Physical output and human listening are NOT TESTED.**
