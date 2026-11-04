# EMF-S01 — portable foundation handoff

| Field | Evidence |
| --- | --- |
| Campaign / slice | EMF / `campaign-emf-001` / **EMF-S01 — CLOUD** |
| Disposition | **COMPLETE — S01 engineering scope.** The playable MVP and full campaign remain incomplete. |
| Date | 2026-11-04, America/Chicago |
| Local environment | Linux x86_64; Node **24.22.1**, npm **11.9.0**, TypeScript **5.9.3** |
| Intake base | Clean `main` at `10987524f3ad7b4f6434c2df7c571346f08a08bc` |
| Published implementation | [`8aad03c882fdff0ae900edb7045cc28138aea0ae`](https://github.com/splatter85/EUTONOS-Music/commit/8aad03c882fdff0ae900edb7045cc28138aea0ae) |
| Verified code/data tree | `fde149879bbbbaed95dc9f9e7366700d2ad02c68`, identical between reviewed local files and the published Git tree |
| Implementation branch | `work/emf-s01-foundation-20261104`; remote ref and manifest read back after publication |
| Hosted CI | [Run 41891295002](https://github.com/splatter85/EUTONOS-Music/actions/runs/41891295002), on the implementation SHA above |

## Assignment and delivered scope

Create the minimal foundation for S02 browser playback, S03 DJ control, S04 procedural performance and the independent S08 FL producer. The owner additionally requires **Windows, macOS and Linux**, with Windows permitted to lead FL/MCP integration. That requirement is now in AGENTS, product requirement `EM-R015`, architecture, first-playable contract, decisions and campaign.

Delivered:

- **`em.audio-pack.v0`:** executable types/parser for exact IDs/revisions, audio paths/bytes/hashes, PCM metadata, authored tempo/meter/phrase/cues, rights/eligibility, state/genre metadata, palette/recipe references and a directed fixture route.
- **Actual media checks:** chunk-aware RIFF PCM16 parsing and Web Crypto SHA-256; a separate Node filesystem adapter enforces root confinement, exact casing and portable paths. Browser-facing modules have no Node/native imports.
- **Common source lifecycle:** prepare, scheduled start, valid exits, stop/transition-out and release with one injected clock/generation. Exit offsets use source timeline zero at the caller clock sample rate. The conformance implementation is an audio-free test double.
- **`em.control.v0`:** typed state/genre/queue/Next/Hold/transport requests and a local contract harness. Tests prove canonical retry before stale-revision checking, ID conflicts, manual FIFO priority, explicit unavailable errors, and requested/prepared/audible separation. The caller supplies a validated, eligible catalogue.
- **Original fixtures:** two distinct finite recordings, four sampler inputs, one palette, one metadata-only recipe reference and one route. Generator version **1**, seed **`0x454d4601`**; all WAV bytes and the manifest are committed and regenerate exactly.
- **Portable workflow:** Node 24, pinned development dependencies, strict TypeScript, 28 automated tests and a three-platform GitHub Actions matrix. There are no runtime npm dependencies.

The [foundation guide](../S01_FOUNDATION.md) owns setup, API details, units and v0 omissions. The older JSON under `docs/examples/` remains fictional. No browser player, DJ planner, live procedural performer, FL/MCP adapter, Mission Control integration, server, database, model or production service was added.

## Exact audio and provenance

All six files are **24,000 Hz mono PCM16**. The [manifest](../../fixtures/s01/manifest.json) records full hashes and byte counts; [provenance](../../fixtures/s01/PROVENANCE.md) records original construction and fixture-only CC0 permission. No external recordings, samples, plugins, model or FL content were used. Fixture permission does not select the repository-wide code license or authorize future proprietary sample exports.

| Asset | Frames | Duration | Measured peak |
| --- | ---: | ---: | ---: |
| Recording A | 384,000 | 16 s | 0.45697021484375 |
| Recording B | 384,000 | 16 s | 0.35504150390625 |
| Kick | 6,000 | 0.25 s | 0.27215576171875 |
| Percussion | 1,800 | 0.075 s | 0.065277099609375 |
| A2 bass | 9,000 | 0.375 s | 0.120819091796875 |
| A minor harmony | 24,000 | 1 s | 0.11083984375 |

Recording A SHA-256: `69274658d0cf0b13d31cadfdef5267399b4f96c5b8574358309273306bfdafdb`.

Recording B SHA-256: `4d0309c0e0bf2de2a74ea57a0e2915dd0ed951363c7f44a324433dc9990a3ee4`.

Both recordings use 120 BPM, 4/4, eight bars, four-bar phrases and authored constant A/C/E harmony. Cues are zero-based quarters 0, 16 and 32. The directed A→B route starts at A quarter 16 and B quarter 0, overlapping eight quarters. This is checked structural compatibility, **not an auditioned mix**. Pitched samples have MIDI 45 roots; the recipe reference does not generate notes.

## Executed verification

| Command/check | Actual result | Scope / evidence |
| --- | --- | --- |
| `npm install --ignore-scripts` | PASS | Three development packages; exact lockfile committed. |
| `npm run check` on local Linux | **28/28 PASS**, 0 failed, 0 skipped | 7 control, 6 source, 12 pack, 3 fixture tests; test runner took 4.79 seconds on this run, not a performance guarantee. |
| `npm run fixtures:check` within that run | PASS | Seven generated files matched: six WAVs plus manifest; no rewrites. |
| `npm run validate` within that run | PASS | Six actual files, two recordings/four samples, one route; byte/hash/PCM metadata and rights-evidence files checked. |
| `ffprobe` inspection of every WAV | PASS, 6/6 | Independent codec, sample-rate/channel and exact frame/duration measurements. |
| `ffmpeg -v error -i <WAV> -f null -` for every WAV | PASS, 6/6 | Full decode with FFmpeg **7.1.5**, without audio-device playback. |
| GitHub Ubuntu / Node 24 | PASS | Run 41891295002, job 126789084431: clean install and `npm run check`. |
| GitHub Windows / Node 24 | PASS | Same run, job 126789084310: clean install and `npm run check`. |
| GitHub macOS / Node 24 | PASS | Same run, job 126789083759: 28/28 tests, seven-file byte comparison and six-WAV validation. |
| Local Markdown links/anchors and stable work IDs | PASS | 264 local links/anchors across 41 documents at closeout; EMF00–19 and EMF-S01–13 preserved. Prior Progress history remains byte-identical as a prefix. |
| `git diff --cached --check` | PASS | Implementation commit has no whitespace errors. |
| Independent bounded review | KEEP; findings corrected | [Non-author review record](../reviews/EMF_S01_FOUNDATION_REVIEW.md), with inspection distinguished from root-executed tests. |

Tests reject missing/corrupt media, wrong hashes/sample metadata, duplicate identities, stale references, unsupported meter/harmony, invalid cues, insufficient overlap, executable/unknown recipe fields, traversal, case mismatch and symlink escape. Fixture tests cover independent regeneration, portable paths with spaces, another working directory, non-silence/headroom/endpoints and read-only mismatch detection. Control/source tests cover retry conflicts, missing/unavailable choices, FIFO, Hold/release, Stop/Mute after 300 requests, stale generations, late scheduling and scheduled-source cancellation.

**Rendered audio:** YES, offline synthetic WAV files. **FL-rendered audio:** NO. **Browser/Web Audio decoding or rendering:** NOT TESTED. **Physical output:** NOT TESTED. **Actual human/agent audition:** NOT TESTED. Passing code/decoder tests does not establish a smooth or enjoyable transition, useful procedural variety, real FL/MCP control or MVP acceptance.

## Decisions, limits and recovery

Four review findings were addressed:

1. `null` harmony means **no asserted harmony**. v0 deliberately does not distinguish unknown from unpitched; neither authorizes the pitched-overlap route.
2. Removed a receipt cap that could reject fresh Stop/Mute after ordinary usage. Replay history lasts for the caller-owned session; the manual queue remains bounded at 32. Durable retention/reconnect is deferred.
3. Hold freezes state/genre requests from manual and automated callers while queue/Next/transport and selection remain available. Release is manual and needs fresh target requests; rejected targets never resume automatically.
4. Source exit offsets now have an explicit clock-rate domain and source origin. S02 converts file frames and subtracts the selected entry offset before scheduling an absolute clock time.

There are no known unresolved blocking defects in the reviewed S01 implementation. The typed control harness is not an untrusted JSON/HTTP parser or persistent service. The loader is not an archive installer or hardened concurrent-upload service. A real renderer must enforce ownership, immediate transport, scheduling, cancellation and device lifecycle. PCM16, constant 4/4 tempo and authored fixed harmony are deliberate v0 constraints; advanced formats, analysis, stretching, low-end/tail handoffs and recipe execution remain future work.

The local checkout had no Git push credentials. The authorized GitHub connection published the files instead: all binary Git blob IDs matched local bytes, the full remote tree matched the reviewed tree, and the remote branch/manifest were read back. The failed CLI push was not treated as publication. Hosted run 41891295002 is **completed/success** on all three platforms. This closeout changes documentation only; the tested source, fixture bytes, package/lockfile and workflow remain identical to the implementation pin.

The containing handoff commit cannot self-reference its SHA; its default-branch publication/readback is recorded by the verified containing SHA in the owner's mini handoff. On pickup, inspect current main and the implementation pin, preserve unrelated work, and reproduce the commands below. Historical records remain as-of evidence; a later revision requires a fresh applicability judgment.

## Next handoff

**Exactly one primary next slice:** **EMF-S02 — CLOUD**.

**Prerequisites:** current main inspected, this handoff, AGENTS, Current Tasks, Work Model, campaign, foundation guide, Node 24.x and the committed `s01-foundation` revision 1 pack.

**First actions:** inspect working changes, fetch/verify current main, read the above documents, then run from the repository root:

```sh
npm ci --ignore-scripts
npm run check
```

Build one small Web Audio player with explicit fixture eligibility, Play/Pause A/B, Now/Next and a cue-checked scheduled A→B transition using one clock and the shared source seam. Test browser/offline behavior and document lifecycle limits. Do not automatically expand into S03/S04 or Mission Control.

**Owner PC opportunity:** the owner can pull the checked S01 closeout revision and begin **EMF-S08 — PC**, Windows-first host intake and one verified agent→single MCP broker→editable FL notes→WAV export path, **in parallel with cloud S02–S07**. S08 uses this same pack/producer seam. No PC installation or authoring operation was performed here.

For the first compatible FL export, use the fixture context: **120 BPM, 4/4 and A minor**, with PCM16 WAV and truthful frame/cue/hash/rights metadata. A different valid sample rate is allowed by v0; S02/S09 must account for its mapping to the playback clock. Recordings and reusable sampler sounds need the appropriate permissions for their actual use.

## Campaign position

S01 is complete; the standalone MVP and full EMF campaign remain incomplete. EMF01/02 have S01 cloud evidence; actual renderer, real FL material and listening work remain. Effort percentage is **unknown**; slice count is not an effort estimate. The cloud-first plan is retained with the explicit Windows/macOS/Linux requirement. Campaign and Current Tasks point to S02, with the parallel S08 opportunity. No next slice was started by this assignment.
