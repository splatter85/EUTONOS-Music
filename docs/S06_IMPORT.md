# S06 — producer import and the performer palette contract

Document ID: `EM-D024`  
Scope: one portable import path from any producer's delivery into an `em.audio-pack.v0` pack, the rule that lets the S04 performer play a palette from any producer, and a mock FL producer that exercises both. The [campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns delivery status; the [handoff](handoffs/EMF-S06-HANDOFF.md) records source-pinned evidence and limits.

**EMF-S06 is COMPLETE** for its bounded contract scope. It was built on the owner's Windows PC (the slice table labels S06 CLOUD) and integrated into main. Checks ran on **Windows only**; macOS and Linux were not run. **No FL Studio ran.** The FL producer here is a mock, and nothing in S06 shows FL Studio control. **Physical output and human listening are NOT TESTED.**

## Try it

Use Node 24.x on Windows, macOS or Linux:

```sh
npm ci --ignore-scripts
npm run check
npm run mock:fl
```

`npm run mock:fl` drives the S08 MCP broker against a mock FL host, writes a delivery and imports it. It prints the pack folder (`dist/generated/s06-mock-fl/pack/`), its manifest hash and the generator checks. Nothing it writes is committed. To import your own delivery into a new folder:

```sh
npm run import -- path/to/delivery path/to/new-pack
```

The import refuses if the new folder already exists. `npm run demo` also regenerates the mock pack, so the checks page (`/checks.html`) can run the four S06 groups. The DJ page still plays the S01 fixtures only. [S07](S07_APP.md) adds ordinary sampler playback of the imported mock palette.

## What a producer delivers

A delivery is a folder of data: `delivery.json`, the WAV files it names and the rights evidence files it names. The importer never runs anything from it.

`delivery.json` uses `em.producer-delivery.v0`:

| Field | Meaning |
| --- | --- |
| `producer` | `id`, `revision`, `kind`, `description`. Recorded as delivered and marked `verified: false`. |
| `pack` | The new pack's `id` and `revision`. |
| `assets[]` | The pack's asset fields **without** `file`, plus `source` (a portable relative path to a `.wav`), optional `expected_sha256` (the producer's own hash of that WAV, such as S08's `fl_verify_export`) and optional `keep_frames`. |
| `palettes`, `recipes`, `routes` | Exactly as in `em.audio-pack.v0`. |

A delivery cannot supply file facts (`file`), cannot claim `listening-reviewed` eligibility, cannot use ids beginning `s01-`, and cannot use the names the importer writes (`manifest.json`, `IMPORT.json`, `audio` and `audio/`). Unknown fields are refused, not ignored.

## What the importer does

`importDelivery(delivery, newPack)` in `src/importer.ts` (Node only):

1. Reads `delivery.json` (at most 1 MiB, strict UTF-8) and every named WAV through the existing pack reader, which refuses paths that leave the delivery folder. One delivery may make it read at most 256 MiB in total (`MAX_DELIVERY_BYTES`), counting a source named twice each time.
2. Checks each WAV against `expected_sha256` when given, then **measures it itself**: PCM16, rate, channels, frames.
3. With `keep_frames`, drops the tail after that frame only if the dropped audio peaks at or below 0.001 (−60 dBFS). This is how a render's silent release tail is trimmed.
4. Refuses kept audio that is digitally silent or reaches full scale.
5. Writes each WAV as `audio/<id>.wav` with a canonical 44-byte header around the **unchanged** PCM samples, so producer metadata chunks never enter a pack.
6. Builds the manifest, validates it with the unchanged pack validator, refuses ids beginning `s01-` (they name this repository's own fixtures, recipe and route), copies the rights evidence (nonempty UTF-8 text; paths that differ only in case, or where one is a folder of another, are refused), writes `IMPORT.json`, runs the unchanged `loadPack` on the result, and only then moves the finished folder into place.

Refusals name a code and a location, for example `HASH_MISMATCH at delivery.assets[1].source`. The S06 codes are `INVALID_DELIVERY`, `UNSUPPORTED_FIELD`, `UNSAFE_PATH`, `INVALID_HASH`, `HASH_MISMATCH`, `REVIEW_NOT_IMPORTABLE`, `TAIL_NOT_SILENT`, `SILENT_AUDIO`, `CLIPPED_AUDIO`, `MISSING_PROVENANCE`, `RESERVED_ID` and `OUTPUT_EXISTS`, alongside the existing pack and WAV codes.

`IMPORT.json` (`em.import-receipt.v0`, importer `eutonos-music-importer@1`) records the producer as delivered, each source hash and frame count, the producer hash it checked, what was trimmed and how loud the dropped tail was, the final hashes, one **generator check** per recipe and state, and a **`browser_player`** check. It has no timestamps, so the same delivery always gives the same bytes. Its `limits` say plainly what was not checked: producer identity, rights and musical labels are recorded, not verified, and listening is not tested.

**Generator check and browser check are different questions.** A generator check says the palette meets the contract. `browser_player` runs the unchanged S02 browser loader (`loadBrowserPack`, fixture mode) over the finished bytes and records `loadable`, or `refused` with the loader's message. That loader is the only player path today and is smaller than the pack format: it needs one or two eligible recordings, at most 16 MiB of audio, a manifest up to 256 KiB and evidence files up to 64 KiB. A palette-only pack can therefore be `compatible` for the generator and still `refused` by the player. Sound reaches the generator in the current player only when `browser_player` is `loadable`. The mock pack is.

## The performer palette contract

Before S06 the S04 performer would only play the S01 fixture palette, by exact identity. S06 replaces that identity check with a written rule, **`s06-performer-palette@1`** ([EM-DEC032](DECISIONS.md)). `compilePhrase(pack, {recipe, seed, state})` plays any recipe whose palette meets it:

- The recipe is found by exact id and revision. It is 120 BPM, 4/4, four-bar phrases, has a harmony, and lists the requested state.
- The palette has exactly one sample each for `drum`, `percussion`, `bass` and `harmony`.
- `bass` and `harmony` have a root, pitch classes inside the recipe's harmony, and the root among those pitch classes. `drum` and `percussion` have neither.
- Each sample lasts at most its role's gap: drum ½ quarter, percussion ¼, bass 1, harmony 2 (`maxRoleFrames(role, rate)` gives the frame limit at the sample's own rate).
- Every sample is eligible and allows playback and sample reuse, as before.

Any sample rate and mono or stereo are allowed. Keys, titles, genres, ids and hashes are labels the plan records but does not judge. The performer's notes do not depend on the palette: two producers' palettes give the **same events** for the same seed and state, with only the sample ids changed. `compileS01Phrase()` is now `compilePhrase()` over `s01-recipe@1`, so every S01 plan is unchanged.

**Why the length rule matters.** The sampler allows one sounding note per role. The length limits keep each note ending before the next note of the same role, at every native and output rate, because every performer onset sits on a sixteenth-note grid. A performer with finer onsets would need a new contract revision. The bass `root_midi` is recorded only; the sampler does not transpose.

## The mock FL producer

`scripts/mock-fl-producer.ts` is a test producer, not an FL integration. It talks to the **real** S08 broker through the same MCP JSON-RPC calls an agent would use (create, inspect, prepare and apply an edit, verify, render, verify the export, release the writer). The host behind the broker is `MockFlHost`, which "renders" by synthesizing the project's notes with simple arithmetic. No FL Studio, plugins, presets or external samples are involved, and the starting project is a small synthetic file built in code, not an FL factory template.

It makes six original stereo 44.1 kHz renders: two 8-bar recordings (A and B, one A → B route with cues at 8 and 12 seconds) and four one-bar one-shots (kick, hat, A2 bass, A-minor chord) that the importer trims to the contract lengths with `keep_frames`. The material is CC0, `fixture-only` and labelled MOCK in its provenance file. Because the synthesizer uses only exact arithmetic and rounding, the pack bytes should be identical on every OS; the manifest hash is pinned in the tests.

## What S06 does not change

- The S05 hybrid policy and the DJ still name the S01 route and recipe. Driving them with imported content is **S09**.
- The DJ page plays S01 only. S06 exposed imported packs through the API, checks and CLI; [S07](S07_APP.md) adds the imported mock-palette sampler to the ordinary demo path.
- The pack schema, the S01 fixtures and WAVs, the S04 performer's notes and the S08 broker are unchanged. No audio file was added to the repository.

## Limits

- Real FL Studio output has not been imported. S09 imports real FL material through this same path. S08's FL renders are `playback`-only (FL factory sounds may not be redistributed as samples), so they can enter as recordings but not as palette samples until material with sample-reuse rights exists.
- Imported material stays `fixture-only` or `unreviewed`; an import never makes something listening-reviewed.
- The importer checks technical facts and the presence of rights evidence. It does not prove who made the audio, whether the rights claim is true, or whether it sounds good.
- Verified on Windows only, under Node 26.12.1 (the package declares Node 24). Native checks ran at 44.1 and 48 kHz in Chromium 151. macOS, Linux, other browsers and real audio devices are not verified.
- Chromium decodes PCM16 slightly asymmetrically (negative values ÷ 32768, positive ÷ 32767). The 44.1 kHz check accepts either scaling and reports which matched; other browsers may differ by up to about one least-significant step.

## Verification

All on the owner's Windows PC; see the [handoff](handoffs/EMF-S06-HANDOFF.md) for exact numbers.

- `npm run check`: 161 Node tests (18 new for S06), unchanged fixture and media checks. The new tests cover the contract rules and refusals, the length rule across 12 native × 12 output rates, identical events from another producer's palette, maximum-length palettes in the unchanged sampler, every import refusal (including reserved ids, clashing evidence paths and the 256 MiB cap), canonical WAV bytes, trimming, the receipt and its `browser_player` check, and the mock producer end to end through the broker, including a render changed after `fl_verify_export` being refused.
- `npm run check:browser`: 23 native offline groups (4 new S06 groups) and 12 browser report groups in headless Chromium. The S06 groups load the imported pack in the browser, decode it as stereo, play the mock palette through the unchanged sampler at 48 and 44.1 kHz and play the mock A → B route, comparing each output channel with an independent sample sum. At 44.1 kHz, where nothing is resampled, the sum reads the delivered PCM bytes; at 48 kHz it uses the decoded buffers.
- An independent read-only review and its corrections are recorded in [the S06 review](reviews/EMF_S06_IMPORT_REVIEW.md).

**Rendered: yes (offline). Played on physical output: no. Auditioned by a listener: no. FL Studio involved: no.**
