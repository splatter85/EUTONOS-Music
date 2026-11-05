# EMF-S06 producer import review

**Campaign:** `campaign-emf-001`  
**Slice:** EMF-S06 — producer import, performer palette contract and mock FL producer (built on the owner's PC)  
**Date:** 2026-11-05, America/Chicago  
**Disposition:** **KEEP for the bounded contract scope after the corrections below.** The corrected source passes on Windows only. The [S06 handoff](../handoffs/EMF-S06-HANDOFF.md) owns the source pin, evidence and next step.

## Method and applicability

A separate, read-only reviewing agent inspected commit `31c2517` (`git diff main...31c2517`): `src/phrase-plan.ts`, `src/procedural-source.ts`, `src/importer.ts`, `scripts/mock-fl-producer.ts`, `scripts/import-delivery.ts`, `scripts/serve.ts`, `scripts/browser-check.ts`, `web/producer-checks.ts` and the new tests, against the campaign's S06 row, the [S04 guide](../S04_PROCEDURAL.md), the [S08 guide](../S08_FL_AUTHORING.md) and the pack validator and loader. It worked through the rhythm tables and the rounding by hand. It also ran throwaway probes against the built code from its own temporary folder, and it edited no repository file. The integrating agent applied the corrections, added regressions and re-ran every check. The reviewer did not re-review the corrected source.

This is a scope-specific engineering review. It does not cover physical output, listening, macOS/Linux, other browsers or real FL Studio output.

## KEEP — checked with no finding

- **Palette contract.** The smallest same-role gaps in the rhythm tables are drum ½, percussion ¼, bass 1 and harmony 2 quarters, both to the phrase end and to the S05 exit at quarter 16. The half-frame margin in `maxRoleFrames` holds for any integer rate, because a native onset rounds up by at most half a frame and the output rounding never moves the wrong way. Mono and stereo are handled. At 192 kHz stereo the worst-case decoded palette is about 720,000 values, under the 1,048,576 limit.
- **Paths.** Portable paths refuse `..`, drive letters, leading dots and device names. The pack reader re-resolves each segment, refuses symlink escapes, enforces exact case and reads only bounded regular files. Writes go only to a scratch folder, which is removed on failure, and an existing output is refused.
- **WAV handling.** PCM is kept byte for byte behind a 44-byte header. Odd-chunk padding is handled, the RIFF size must match the file and extensible format is refused. Kept and dropped regions are sliced correctly. Silence, both full-scale extremes and the −60 dBFS tail limit are enforced as documented.
- **Wording.** Every producer and host field and the provenance file say MOCK, `verified: false` and no FL Studio. The broker workspace is temporary, and the receipt contains no host paths.
- **Determinism.** The synthesizer and receipt use only basic arithmetic, rounding and integer operations; the platform name never reaches the delivery bytes. This was checked on Windows only.
- **Server route.** `/generated/` serves only `pack/*.{json,md,wav}` and `pack/audio/*`; the scratch and delivery folders are unreachable, and wrong-case or symlinked paths are refused.
- **Tests.** None of the S06 tests or browser checks asserts something that cannot fail.

## CHANGE — corrected and rechecked

| Finding | Correction and evidence |
| --- | --- |
| **Medium.** The importer admitted deliveries that the only current player path refuses, and the receipt still said `compatible`. Confirmed by probe for a palette-only delivery, three recordings, an unreviewed recording with a fixture palette and 70 KiB of rights evidence: each imported and passed `loadPack`, but `loadBrowserPack` refused it. Total audio over 16 MiB and a manifest over 256 KiB fail the same way. | `IMPORT.json` now has a `browser_player` check. It runs the unchanged `loadBrowserPack` in fixture mode over the finished bytes and records `loadable` or `refused` with the loader's own message. A refusal is reported, not raised, because these are valid packs that the small S02 demo loader does not take. The receipt's `limits` now say that sound reaches the generator in the current player only when `browser_player` is loadable. New tests: a palette-only delivery is `compatible` for the generator but `refused` by the player ("one or two recordings"); the all-unreviewed delivery is refused ("Recording is not eligible"); the mock pack is `loadable`. |
| **Low.** There was no total limit: up to 64 assets, each up to 64 MiB, could be read and held at once, and all of them could name the same source. | Reads are now capped at 256 MiB per delivery (`MAX_DELIVERY_BYTES`), counting repeated sources each time; the import is refused as `INVALID_DELIVERY` at the read that crosses the cap. New test: one 64 MiB WAV named by four assets is refused (0.65 s). |
| **Low.** Some rights-evidence paths failed with a raw error or would make a non-portable pack. On Windows, evidence named `audio` hit the folder (`EISDIR`, confirmed). Evidence that is not UTF-8 threw a raw `TypeError` (confirmed). From reading, on Linux, `Audio` or two names differing only in case would make a pack whose files collide on Windows or macOS. | `audio` itself is now reserved, case-insensitively, as `audio/` already was. Evidence paths that differ only in case, or where one is a folder of another, are refused as `UNSAFE_PATH` before reading. Unreadable evidence is refused as `MISSING_PROVENANCE`. New tests cover `audio`, `provenance.md` against `PROVENANCE.md`, `notes` against `notes/more.md` and Latin-1 evidence. |
| **Low.** After S06 the S01 recipe and route ids no longer pin the S01 media, and an import could claim `s01-recipe` or `s01-a-to-b` and so be offered the S05 policy reviewed on the S01 media. There was no runtime hazard, because tempo, key, harmony, cues and the contract are all rechecked. | The importer now refuses any pack, asset, palette, recipe or route id beginning `s01-` (`RESERVED_ID`). New tests cover a recipe and a pack id. Packs built by hand outside the importer are not covered; S09 decides how the S05 policy binds imported content. |
| **Low.** The browser phrase oracle was only partly independent. It copied the sampler's note-end rule and summed the same decoded buffers that the source plays, so it never compared output with the delivered PCM. | At the native rate (44.1 kHz for the mock pack), where nothing is resampled, the oracle now reads the delivered PCM16 bytes and uses the simple length `onset + frames`, independent of the sampler's rule. This exposed a real decoder detail: Chromium converts PCM16 with negative values ÷ 32768 and positive values ÷ 32767, so the symmetric ÷ 32768 sum differed by 9.1e-6 (about 0.3 of a least-significant step). The oracle accepts either documented scaling and reports which matched: Chromium's, at 4.1e-8 / 4.9e-8 (L / R). The 48 kHz group still uses the decoded buffers because the browser resamples there. |

## Remaining limits

- **Very low, not changed:** between the final existence check and the rename there is a narrow window. On POSIX, `rename` replaces an existing *empty* folder created in that window. No data can be lost; the import never replaces a non-empty folder.
- The `s01-` reservation guards the importer only. A pack written by hand can still use those ids; the contract and S05 checks still apply to it.
- The resampled (48 kHz) palette group compares against the decoded buffers, so a resampler fault common to the source and the oracle would not show there; the 44.1 kHz group covers the same events without resampling.
- Producer identity, rights claims and musical labels are recorded, not verified. Nobody has listened to the mock material.

## Executed checks after correction

Windows 11, Node 26.12.1 (the package declares 24), headless Chromium 151.0.7922.34, Playwright 1.62.1, at the corrected source given in the handoff:

- `npm run check`: **161/161 Node tests** (18 S06), unchanged fixture regeneration and six media validations.
- `npm run check:browser`: **23/23 native offline groups** and **12/12 browser report groups**.

macOS and Linux were not run. **No FL Studio ran. Physical output and human listening are NOT TESTED.**
