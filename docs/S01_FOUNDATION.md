# S01 — portable foundation

Document ID: `EM-D018`
Implemented scope: `EMF-S01`, `campaign-emf-001`. [Campaign](campaigns/EMF_INITIAL_INFRASTRUCTURE.md) owns status; [slice handoff](handoffs/EMF-S01-HANDOFF.md) records executed evidence.

This is the small executable boundary for the next browser player and independent FL producer. It contains a validated audio-pack format, source lifecycle types, a local request/queue contract harness, and original synthetic audio fixtures. It does not render live playback, select songs, run procedural recipes or control FL Studio.

## Setup on Windows, macOS or Linux

Use Node.js **24.x** with npm. From the repository root, use the same commands in PowerShell, Command Prompt or a Unix shell:

```sh
npm ci --ignore-scripts
npm run check
```

There are no runtime npm dependencies. TypeScript 5.9.3 and Node type declarations are pinned in `package-lock.json` for development. The build emits JavaScript and declarations in ignored `dist/`. Commands are Node/npm scripts, with no shell-specific environment assignment, system audio library, Python or FL requirement. `.gitattributes` preserves LF text and binary WAV bytes across checkouts.

| Command | Actual scope |
| --- | --- |
| `npm run build` | Compile the contracts, validator, scripts and tests with strict TypeScript checks. |
| `npm test` | Compile and execute Node's test runner against the built test files. |
| `npm run fixtures:check` | Regenerate the fixed authored data in memory and compare it to the checked-in fixtures; do not rewrite files. |
| `npm run fixtures:generate` | Deliberately rebuild the original S01 fixture media and manifest. Review the diff before publishing changed fixtures. |
| `npm run validate` | Compile and validate `fixtures/s01`, including actual WAV bytes and rights-evidence files. |
| `node dist/scripts/validate-pack.js PATH_TO_PACK` | After building, validate another local pack directory; exits nonzero on failure. |

During S01–S04 a GitHub Actions workflow ran `npm ci --ignore-scripts` and `npm run check` on Ubuntu, Windows and macOS; the owner removed it on 2026-11-04 (EM-DEC030). A configured workflow is not a completed run: see the exact executed results in the handoff. Passing these checks does not establish physical output, background browser behavior or FL Studio compatibility.

## Files and boundaries

| File | Responsibility |
| --- | --- |
| `src/pack-types.ts` | Versioned pack, media, palette, recipe-reference and directed route types. |
| `src/pack.ts` | Parse unknown data, reject unsupported fields, check references/cues and explicit playback eligibility. |
| `src/audio.ts` | Browser-safe PCM16 RIFF parsing, Web Crypto SHA-256 and actual audio-byte validation. |
| `src/node.ts` | Separate Node filesystem adapter with registered-root, exact-case and symlink checks. |
| `src/playable-source.ts` | Shared recorded/procedural lifecycle contract using a caller-owned clock. |
| `src/control.ts` | Typed local control and queue contract; no DJ selection or audio execution. |
| `scripts/generate-fixtures.ts` | Offline fixture authoring and deterministic verification. |
| `fixtures/s01/` | Actual two-recording/four-sample pack and provenance. |

Browser code should import the core modules, not `src/node.ts` or the offline scripts. The next browser player supplies its own fetch/decode path and authoritative Web Audio clock. It must validate the received manifest and bytes before playback and must explicitly opt into fixture eligibility for this demonstration.

## Audio pack `em.audio-pack.v0`

`validatePackManifest(unknown)` returns a newly parsed `AudioPack` or throws a `PackError` containing a stable `code`, `location` and explanation. `validatePackFiles(pack, readBytes)` checks the actual bytes behind a validated manifest using an injected pack-relative reader. `loadPack(directory)` combines the manifest parser, confined Node reader, provenance-file presence and audio checks.

| Part | Required data and meaning |
| --- | --- |
| Pack | `schema_version`, stable `id`, integer `revision`, assets, palettes, recipe references and directed routes. |
| Asset | Stable ID/revision, title, `recording` or `sample`, file record, rights, review eligibility, genre/state tags, key/harmony, timing and cues. |
| File | Lowercase relative `.wav` path, SHA-256, byte count, `pcm16-wav`, sample rate, channels and frame count. |
| Rights | Origin, creator, license/permission label, explicit allowed uses and a pack-relative evidence text file. Declared permission is not independently certified by the validator. |
| Eligibility | `fixture-only`, `unreviewed` or `listening-reviewed`. Validation is independent of listening approval. |
| Palette | Versioned sample references, each role and an authored MIDI root where bass/harmony is pitched. |
| Recipe reference | ID/revision, exact palette revision, constant tempo/meter/phrase, harmony and genre/state metadata. Descriptive only; no note generation or executable recipe text. |
| Route | Exact recording revisions, named exit/entry cues, overlap in quarter notes, and explicit `fixture-only` review status. |

Stable IDs are unique within the pack, including assets, palettes, recipe references and routes. File paths are unique. References must resolve to the exact ID **and revision**; changing media requires a new hash and appropriate revision. Cue IDs are local to their asset. Invalid/new schema versions and unsupported fields are rejected so later producers cannot silently assume broader behavior.

### Musical and file units

All cues use **zero-based quarter-note positions**. BPM is quarter notes per minute. v0 supports a constant tempo from 20–400 BPM and constant **4/4**; it rejects another meter or a tempo-map field. `bars` is the number of whole musical body bars and `phrase_bars` defines valid cue boundaries. Recordings contain whole phrases. Samples are one-shots with `timing: null` and no cues.

For a recording, the authored mapping is:

```text
frame = first_downbeat_frame + round(position_quarters * 60 * sample_rate / bpm)
```

An entry must precede the musical body end; an exit may equal the end, but cannot start an overlap that extends beyond it. The body must fit in the file (one-frame rounding tolerance). `first_downbeat_frame` preserves a possible pickup. Extra frames after the body remain a tail; v0 does not analyze them or approve a tail handoff.

WAV files must be little-endian RIFF PCM16, one or two channels, 8–192 kHz, at most 64 MiB each. The parser reads RIFF chunks and padding rather than presuming a fixed 44-byte header. It rejects missing/duplicate format/data chunks, corrupt sizes, inconsistent byte rates/block alignment, partial frames and unsupported formats. Actual file bytes, hash, sample rate, channels and frame count must agree with the manifest. Format bounds keep this initial in-memory validation finite; larger/streaming assets need a later format/runtime decision.

Portable paths use `/`, exact casing and ordinary filename characters. Absolute paths, drive letters, backslashes, traversal, URLs, Windows reserved filenames and trailing dots are rejected. The Node reader checks file casing even on case-insensitive filesystems and refuses a symlink escaping the selected pack root. This is a bounded local validator, not an archive installer or a hardened concurrent-upload service.

### What compatibility means here

The A→B fixture route requires equal tempo, phrase-aligned cues, a whole-bar overlap that fits both bodies, and equal **authored constant pitch-class sets**. A key label alone is insufficient. `harmony_pitch_classes: null` means **no asserted harmony**; v0 does not distinguish unknown harmony from an unpitched sound. Neither can establish this pitched-overlap route. `key: null` means no asserted key. These omissions do not prevent ordinary permitted playback.

This check does not infer key/BPM, establish perceptual consonance, remove competing bass parts or guarantee a good mix. The route is a deterministic engineering case for S02. Its gain, timing and actual sound still need rendering and listening in the later slices. A route from A to B does not imply B to A.

### Eligibility and rights

`eligibleForPlayback(asset)` requires playback permission and `listening-reviewed` eligibility. `eligibleForPlayback(asset, true)` additionally admits `fixture-only` material for the explicit fixture demo. `unreviewed` remains ineligible even in fixture mode. A future importer/selector must apply intended-use checks; parsing a manifest is never proof that its author owns the claimed rights.

The checked-in recordings and samples were synthesized specifically for this repository, without external recordings, samples or plugins. [Provenance](../fixtures/s01/PROVENANCE.md) documents the original source, deterministic recipe and scoped fixture permission. The fixture permission does not select a license for all repository code or grant rights to future FL factory/plugin samples. S08 must record the actual exported material's provenance and allowed uses.

## Source and request boundaries

S01 describes the original foundation below. [S03](S03_DJ.md) now integrates this local contract with the real renderer and adds cancellation, explicit genre clearing and generation-aware evidence; its guide owns those extensions.

The common source lifecycle covers preparation, scheduling a start, exposing valid exits, stopping/transitioning out and releasing resources. The caller owns time and engine generation. A source must not create another audio context/clock, use a wall clock for musical scheduling or execute a stale-generation plan. The S01 lifecycle implementation used by tests is a **test double**, not a renderer, and its state is not evidence of sound on an output device.

`ClockStamp.frame` is an absolute frame on the caller's clock. `SourceExit.offsetFrames` is measured from source timeline frame zero at the caller clock's sample rate after preparation. A recording implementation converts file-native cue frames to that rate; the scheduled absolute exit accounts for the selected entry offset. This prevents file frames, output frames and wall-clock time from being silently mixed.

The typed request contract covers `setState`, `requestGenre`, `queueTrack`, `nextSong`, Hold and transport. Caller-known request IDs reconcile retries: an identical canonical request returns its original receipt before checking whether the expected revision is now stale. Different content under the same ID is an explicit conflict. Manual queue items retain FIFO precedence over an automatic candidate. Missing/unavailable media and genres are explicit errors, not random fallback selections.

Requested, prepared/planned and audible state are separate. The acceptance harness changes intent and queue state; it does not manufacture a prepared plan or an audible update. The real DJ and renderer supply those effects in S02–S05. Accepted transport has `urgency: 'immediate'` with `execution: 'pending'`; no request receipt claims audio has already stopped, started or changed. Only the playback owner calls `reportPrepared`/`reportAudible` with its evidence. Those methods check revisions/generations/frame ordering and do not authenticate an external caller.

**S01 Hold means hold state/genre targets.** It rejects new `setState` and `requestGenre` requests from both manual and automated callers while held. Manual queueing, Next, transport and source selection remain possible. Only a manual request releases Hold; release does not replay rejected targets, so subsequent changes need fresh requests. Recipe/moment holds are deferred.

`ControlContract` accepts a caller-validated catalogue of track/genre IDs with availability flags. The caller must validate media and eligibility before constructing it; this typed local seam is not an untrusted HTTP/JSON parser. It accepts automated state/genre requests; queue, Next, Hold and transport are manual-only. `peekNext` preserves the 32-entry manual FIFO ahead of a supplied eligible automatic candidate; it does not select that candidate itself. The owner acknowledges the queue head explicitly. Replay history remains complete for the caller-owned session, with no arbitrary request-count cutoff that could block Stop/Mute. It is discarded with the session; durable/bounded retry retention belongs to the actual runtime.

The full HTTP/MCP protocol, multi-client leases, durable receipts/reconnect, expiry/coalescing, catalogue mutation, DJ ranking, musical dwell, real pause/resume and output ownership are future runtime work. See [State/API](STATE_AND_CONTROL_API.md) and the exact exported types/tests for the present boundary. The S01 process-local harness is deliberately not a persistence layer. Every request still checks its expected revision after retry lookup; the real transport path must reconcile conflicts and prove immediate user control in S02/S03.

## Producer seam and next slices

S08 can author on Windows independently once this contract is published. Export original eligible PCM16 WAV, copy bytes into a portable pack, supply truthful format/hash/timing/rights metadata, and validate using the same command. No Windows path, FL project dependency or plugin code belongs in a listener pack. Exported FL audio enters the same asset/palette/reference types as the synthetic cloud fixture. [S06](S06_IMPORT.md) now supplies that importer for any producer's delivery, and S08 the MCP facade.

**Next cloud slice: S02.** Build one small Web Audio player with the existing A/B assets, explicit fixture eligibility, one clock and a checked scheduled A→B transition. Record browser/offline and lifecycle evidence separately from physical listening. Do not expand into the full DJ, procedural performer or Mission Control merely because those types now exist.

### Deliberate v0 omissions

Tempo/meter maps, arbitrary-song analysis, compression/float WAV, resampling/time stretching, detailed chord regions, stem mixing, loudness normalization, low-end/tail handoff, recipe execution, a real DJ and all DAW/MCP integrations are outside this slice. The earlier JSON in `docs/examples/` remains illustrative and incompatible by design; it is not silently treated as a real pack. Add only the next concrete requirement and version the format when compatibility changes.
