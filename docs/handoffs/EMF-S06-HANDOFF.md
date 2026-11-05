# EMF-S06 — slice handoff

**Campaign:** EMF / `campaign-emf-001`  
**Slice:** EMF-S06 — portable import/manifest validation and mock FL-producer/MCP contract tests  
**Disposition:** **COMPLETE** for its bounded contract scope (confirmed in the [campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md#current-checkpoint))  
**Environment:** PC. The slice table labels S06 CLOUD; the owner asked for it to be built on the PC. Windows 11 Pro, Node 26.12.1 (the package declares Node 24.x; Node 24 was not installed and nothing was downloaded), npm with `--ignore-scripts`, Playwright 1.62.1 with headless Chromium 151.0.7922.34.  
**Inspected base SHA / branch:** main `c64df9a604733f00a87de3aa7021cc5525d15dd1`; work branch `work/emf-s06-import-20261105`.  
**Tested source:** `8708c7806bb1ffc1d68c3ed8c2f34d29af0d9f4d` (runtime, tests, page and check scripts). The later closeout commits change documentation and EUTONOS records only.  
**Publication:** merged into main with a plain push (no pull request, per EM-DEC030). The pushed main commit is given in the owner's mini handoff and can be read back with `git ls-remote origin refs/heads/main`.

## Assignment and scope

Portable import/manifest validation and mock FL-producer/MCP contract tests: show that sound enters the generator regardless of producer, with **no claim of actual FL control**. The owner's completion contract includes merging into main.

Excluded: real FL Studio runs or renders, real FL material (S09), a persistent library or catalogue, driving the S05 hybrid or DJ with imported content (S09), new recipes or performers, physical audio output, listening, macOS/Linux runs, Mission Control. Predecessors used unchanged: the S01 pack schema, fixtures and WAVs, the S04 performer's notes and sampler, the S05 policy and the S08 broker.

## Delivered changes

| Area | File | Effect |
| --- | --- | --- |
| Palette contract | `src/phrase-plan.ts` | `PERFORMER_PALETTE_CONTRACT` (`s06-performer-palette@1`), `ROLE_MAX_QUARTERS`, `maxRoleFrames(role, rate)` and `compilePhrase(pack, {recipe, seed, state})`. The recipe is found by exact ref and must be 120 BPM, 4/4, four-bar phrases, with a harmony and the requested state. The palette needs exactly one drum, percussion, bass and harmony sample; pitched roles need a root and pitch classes inside the recipe harmony (root included), unpitched roles neither; each sample fits its role's gap at its own rate; eligibility and playback/sample-reuse rights as before. Rates, channels, ids, keys, titles and hashes are labels. `compileS01Phrase()` is `compilePhrase()` over `s01-recipe@1`; S01 plans are unchanged. |
| Sampler check | `src/procedural-source.ts` | `checkProceduralPlan()` recompiles with the plan's own recipe instead of the S01 recipe. Scheduling is unchanged. |
| Importer | `src/importer.ts` (new, Node only) | `importDelivery(delivery, newPack)` reads `em.producer-delivery.v0` (strict fields, 1 MiB JSON, at most 64 assets, at most 256 MiB read in total), refuses `s01-` ids, checks optional producer hashes, measures each WAV, trims a `keep_frames` tail only at or below 0.001 peak, refuses silent or full-scale audio and listening-review claims, writes canonical 44-byte WAV headers around unchanged PCM, validates with the unchanged pack validator, copies nonempty rights evidence, writes a timestamp-free `IMPORT.json` (`em.import-receipt.v0`, including a `browser_player` check that runs the unchanged S02 browser loader over the finished bytes), runs `loadPack` on the result and only then renames it into place (never over an existing folder). |
| Mock producer | `scripts/mock-fl-producer.ts` (new) | `MockFlHost`, a `HostAdapter` whose render synthesizes the project's notes with exact arithmetic (44.1 kHz stereo PCM16 plus a half-second tail). It drives the real S08 broker through `McpSession` JSON-RPC (create, inspect, prepare and apply an edit under the writer lease, verify, render, verify the export, release) for two 8-bar recordings and four one-bar one-shots, writes a delivery with CC0, fixture-only rights and a MOCK provenance file, and imports it. `generateMockPack()` writes `dist/generated/s06-mock-fl/` and replaces only a folder it made. |
| CLI and scripts | `scripts/import-delivery.ts` (new), `package.json` | `npm run import -- <delivery> <new-pack>`, `npm run mock:fl`; `npm run demo` regenerates the mock pack before serving. |
| Checks | `tests/palette-contract.test.ts`, `tests/importer.test.ts`, `tests/mock-fl-producer.test.ts` (new), `tests/phrase-plan.test.ts`, `web/producer-checks.ts` (new), `web/checks.ts`, `scripts/browser-check.ts`, `scripts/serve.ts` | 18 new Node tests; four native offline groups; the loopback demo server serves only `/generated/s06-mock-fl/pack/` JSON, Markdown and WAV files from `dist/`. |
| Docs | [S06 guide](../S06_IMPORT.md) (`EM-D024`), [S06 review](../reviews/EMF_S06_IMPORT_REVIEW.md), EM-DEC032, status owners | Cross-references in the S01, S04, S08 and library documents. |

The pack schema, fixtures, WAVs, S04 performer notes, S05 policy, dependencies and the S08 broker are unchanged. No audio files were added to the repository; the mock pack is generated under `dist/` on demand.

## Verification and limits

| Test command or listening check | Actual result | Evidence/limit |
| --- | --- | --- |
| `npm run check` (Windows) | **PASS** — 161/161 Node tests (143 existing + 18 S06), seven byte-identical regenerated fixture files, six WAV validations | Node 26.12.1, not the declared 24 |
| `npm run check:browser` (Windows) | **PASS** — 23/23 native offline groups (19 existing + 4 S06), 12/12 browser report groups (unchanged) | Headless Chromium 151; reports under `artifacts/s04-browser/` (not tracked) |
| macOS / Linux checks | **NOT RUN** | No CI (EM-DEC030); no macOS or Linux machine was used. The mock pack hash is pinned so another OS would show any byte difference. |
| FL Studio | **NOT USED** | The producer is a mock; no claim of FL control |
| Physical output | **NOT TESTED** | Offline and headless rendering only |
| Listening | **NOT TESTED** | Nobody has heard the mock material or the imported palette |

The 18 Node tests cover:

- **Contract:** each refusal names its rule (recipe ref, role set, extra role, root outside pitch classes, pitch classes outside harmony, unpitched with harmony or root, too-long sample, phrase length); identity, label, rate and hash changes alone no longer refuse, and the plan snapshots what it bound; every same-role gap is at least the role limit over 515 seeds × 2 states, with onsets on the sixteenth grid; the `maxRoleFrames` rounding keeps every end before the next onset for 12 native × 12 output rates; another producer's palette (44.1 kHz stereo, 48 kHz mono, 8 kHz stereo) gives identical events and sections; maximum-length palettes schedule every event in the unchanged sampler at 5 native × 5 output rates.
- **Importer:** byte-identical repeat imports; canonical WAVs that drop a producer `LIST` chunk while keeping PCM; `keep_frames` trimming and `TAIL_NOT_SILENT`; every refusal code; unsafe and reserved paths; reserved `s01-` ids; evidence paths that clash by case or as folders, and non-UTF-8 evidence; the 256 MiB read cap (one 64 MiB WAV named four times); generator checks reporting `compatibility` and `eligibility` with details; the `browser_player` check (`loadable` for a whole delivery, `refused` for a palette-only or unreviewed one).
- **Mock producer:** the full path through the S08 broker to an imported pack with the pinned manifest hash `792961c013c131cf81b8b55a9b97d16decd3edb4fa4b31a0acbde26b5c688d91`, silent render tails, contract lengths, the same events as the S01 palette and scheduling at 44.1/48 kHz; a render changed after `fl_verify_export` refused as `HASH_MISMATCH`; `browser_player` `loadable`; the generator replacing only its own folder.

Native offline evidence (Chromium, OfflineAudioContext, stereo; S06 mock pack, seed 1 Explore for the palette):

| Measure | Palette 48 kHz | Palette 44.1 kHz | A → B route 48 kHz |
| --- | --- | --- | --- |
| Events (same as the S01 palette, ids mapped by role) | 77 | 77 | — |
| Start / end frames | 12000 / 780000 | 11025 / 716625 | 12000 / 1188000 (B enters 396000, A gone 588000) |
| Max error vs independent per-channel sum, L / R | 2.43e-8 / 3.73e-8 | 4.12e-8 / 4.87e-8 | 3.87e-7 / 3.62e-7 |
| What the sum reads | decoded buffers (resampled) | delivered PCM16 bytes (Chromium scaling matched) | decoded buffers (resampled) |
| Peak L / R | 0.298 / 0.317 | 0.298 / 0.317 | 0.435 / 0.419 |
| Frames where L ≠ R | 573245 | 518348 | — |

The first group also confirmed that the browser refuses the imported fixture-only pack without fixture opt-in and decodes all six files as stereo at 48 kHz with the expected lengths. The oracles sum sample data directly; they do not use the planner's frame helpers or the sources' envelopes. At 44.1 kHz nothing is resampled, so the sum reads the delivered PCM16 bytes with plain `onset + frames` lengths. That showed Chromium decodes PCM16 with negative values ÷ 32768 and positive ÷ 32767; a symmetric ÷ 32768 sum differs by 9.1e-6. The check accepts either scaling and reports which matched (Chromium's, on both channels).

**Rendered: yes (offline and headless). Played on physical output: no. Auditioned by a listener: no. FL Studio involved: no.**

## Review

A separate read-only agent reviewed `31c2517` and ran throwaway probes from its own temporary folder; the full record is the [S06 review](../reviews/EMF_S06_IMPORT_REVIEW.md). Disposition: **KEEP for the bounded contract scope after corrections.**

| Finding | Correction in `8708c78` |
| --- | --- |
| **Medium:** the receipt said `compatible` for packs the only current player refuses (palette-only, three recordings, an unreviewed recording, large evidence, over 16 MiB of audio, a manifest over 256 KiB) | `IMPORT.json` now has a `browser_player` check that runs the unchanged `loadBrowserPack` over the finished bytes; `limits` say sound reaches the generator in the current player only when it is `loadable` |
| **Low:** no total read limit (64 assets × 64 MiB, repeatable sources) | 256 MiB per delivery (`MAX_DELIVERY_BYTES`), refused as `INVALID_DELIVERY` |
| **Low:** evidence named `audio` hit a folder (`EISDIR`); non-UTF-8 evidence threw a raw error; case-only evidence clashes were not portable | `audio` reserved; case and folder clashes refused as `UNSAFE_PATH`; unreadable evidence refused as `MISSING_PROVENANCE` |
| **Low:** an import could claim `s01-` ids and be offered the S05 policy reviewed on S01 media | `s01-` ids refused at import as `RESERVED_ID` |
| **Low:** the browser oracle shared the sampler's end rule and decoded buffers | At 44.1 kHz the oracle now sums the delivered PCM bytes with plain lengths; this found Chromium's asymmetric PCM16 scaling, which the check now reports |

Not changed: a very-low stat/rename race in which POSIX `rename` could replace an empty folder created in that window (no data loss). The 48 kHz groups still compare decoded buffers. The reviewer did not re-review the corrected source; every check was re-run on it.

## Decisions, risks and recovery

- **EM-DEC032** replaces the S01 palette identity check with the written `s06-performer-palette@1` rule and fixes the data-only delivery and importer behavior.
- The length rule is exact only because every performer onset sits on the sixteenth-note grid; a finer performer needs a new contract revision. The bass root is documentary; the sampler does not transpose.
- S08's real FL renders are `playback`-only (FL factory sounds may not be redistributed as samples), so in S09 they can enter as recordings but not as palette samples until material with sample-reuse rights exists.
- The S05 policy and the DJ remain bound to the S01 route and recipe; S09 generalizes them for imported content. The player page plays S01 only.
- Producer identity and rights are recorded as delivered, not verified. Imports stay fixture-only or unreviewed.
- Node 24 is the declared runtime; these checks ran on Node 26.12.1. A run on Node 24 and on macOS/Linux would close the gap; the pinned mock hash would show any cross-OS byte drift.
- **Last verified state:** tested source `8708c7806bb1ffc1d68c3ed8c2f34d29af0d9f4d` with all checks above passing on Windows.

## Next handoff

**Exactly one next actionable slice:** **EMF-S07 — CLOUD** (integrated app/demo, repeatable test commands, offline/browser audio checks, scaffold review and the exact tested commit; reports cloud playable proof, not an accepted MVP). The owner may choose to build it on the PC instead.  
**Prerequisites:** current main; Node 24.x; `npm ci --ignore-scripts`.  
**First command/action:** read this handoff and the campaign checkpoint, then `npm run check` and `npm run check:browser`, reporting which OS ran them.  
**Owner action:** none for S06. The S08 one-time project MCP approval remains separate.  
**Still not done:** macOS/Linux verification of S05 and S06, physical output, listening, importing real FL material and driving the hybrid/DJ with it (S09), S07, S10 acceptance.

## Closeout

The campaign checkpoint, [Current Tasks](../CURRENT_TASKS.md), [Progress](../PROGRESS.md), the native board (through the boards CLI), NAV and RAM were updated in this closeout. The owner receives the mini handoff in chat.
