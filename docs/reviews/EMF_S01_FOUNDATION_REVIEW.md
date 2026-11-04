# EMF-S01 foundation review

**Campaign:** `campaign-emf-001`

**Slice:** `EMF-S01` — CLOUD

**Review date:** 2026-11-04

**Disposition:** KEEP the implemented foundation. No blocking defect remains from this focused review.

## Source state and method

An independent review agent inspected the uncommitted S01 worktree based on
`10987524f3ad7b4f6434c2df7c571346f08a08bc`. This is the intake/base commit,
not a claim that the new implementation existed at that commit. The final
implementation and publication pins belong in the
[S01 handoff](../handoffs/EMF-S01-HANDOFF.md).

The review read the repository instructions, Current Tasks, Work Model, campaign,
pickup handoff, and applicable architecture/library/control contracts. Code
inspection covered `src/pack-types.ts`, `src/pack.ts`, `src/audio.ts`, `src/node.ts`,
`src/control.ts`, `src/playable-source.ts`, the four test files, fixture generator,
manifest/provenance, package scripts, and the three-OS CI configuration. Follow-up
inspection checked the changes listed below. The reviewer changed only this
review document; it did not execute the suite, audition audio, or publish code.

## Execution evidence and its limits

The integrating/root agent reported these completed checks for the reviewed
worktree. The reviewer inspected the corresponding implementation and tests;
these are **root-executed results, not independent reviewer executions**.

| Check | Result reported by root |
| --- | --- |
| `npm run check` | PASS: 28 tests, 0 failures, 0 skips; compilation, deterministic check, and pack validation completed. |
| Deterministic fixture check | Seven generated files matched: six WAVs and `manifest.json`. |
| Pack/media validation | All six actual WAV files passed manifest, byte/hash, and PCM metadata validation. |
| Independent decoder check | ffprobe inspection and FFmpeg 7.1.5 full decoding passed for all six WAVs. Both recordings contained 384,000 frames / 16 seconds at 24,000 Hz, mono PCM16. |

The Windows, macOS, and Linux CI jobs were configured at review time; this review
does not certify completed hosted runs. The handoff must identify actual runs
and results. Successful parsing, decoding, and deterministic generation do not
establish physical output, browser behavior, or perceived musical quality.

## KEEP

- **Minimal portable boundary.** The strict TypeScript contracts and Node-only
  filesystem adapter remain separate from browser-safe validation. The project
  adds no runtime package, native audio, FL Studio, database, or server dependency.
  Portable paths, exact casing, reserved-name restrictions, symlink confinement,
  LF text, and binary WAV attributes address concrete cross-platform risks.
- **Conservative pack acceptance.** Unsupported versions/fields, duplicate IDs,
  invalid references/cues, mismatched bytes/hashes/frames, and incompatible declared
  routes fail explicitly. Fixture playback requires an explicit opt-in and
  playback permission; unreviewed assets do not become eligible through it.
- **Real, reproducible fixtures.** The fixed generator uses explicit rounding,
  seeded integer noise, fixed phase increments, and little-endian WAV output.
  It creates two distinct finite arrangements and four drum/percussion/bass/harmony
  inputs without external samples or installed instruments. Manifest and provenance
  agree on authored A/C/E harmony, 120 BPM, 4/4, four-bar phrases, and a directed
  eight-quarter A-to-B overlap. This is structural compatibility, not listening
  approval. Check mode compares bytes without repairing altered files; tests also
  cover output paths containing spaces and invocation from another directory.
- **One clock and distinct state views.** The source conformance double retains
  the caller's clock by identity and checks lifecycle/generation boundaries.
  Control acceptance updates intent, not audible reality. Canonical replay precedes
  stale-revision checks; conflicting IDs fail; manual queue entries retain FIFO
  precedence until the owner acknowledges the head.

## CHANGE — addressed during review

| Finding | Resolution inspected |
| --- | --- |
| Null harmony was described inconsistently as unknown versus unknown/unpitched. | Types and guide now define `null` as **no asserted harmony**. V0 deliberately does not distinguish unknown from unpitched, and neither can authorize the pitched-overlap route. |
| A 256-receipt cap could reject fresh manual Stop/Mute intent after ordinary use. | The cap was removed. Replay history lasts for the caller-owned session; the manual queue remains bounded. A regression covers 300 requests, fresh Stop/Mute, and replay of the original request. |
| Boolean Hold needed an explicit policy. | The contract states that manual and automated state/genre changes are blocked while queue/Next/transport and selection remain available. Only manual release is allowed; rejected targets are not resumed. Tests exercise these semantics. |
| Exit-frame units needed a precise relationship to file frames and selected entry cues. | `SourceExit.offsetFrames` is measured from the source timeline origin at the prepared caller clock's sample rate. S02 must convert file cues and subtract the selected entry offset to obtain an absolute clock frame. |

No further S01 code change is requested by this review. Publication, exact source
pinning, hosted-check reporting, and readback remain the integrator's completion
steps, recorded in the campaign and handoff.

## DEFER

Keep actual Web Audio rendering, resampling/device behavior, full DJ selection,
procedural performance, persistent control/reconnect/lease policy, and importer
hardening in their assigned later slices. The current typed local control harness
is not an arbitrary-JSON endpoint or a durable service. The local pack reader is
not a hardened concurrent upload service.

S02 remains the next cloud slice. After S01 publication and readback, S08 may begin
the independent Windows-first FL Studio/MCP producer lane. Portable exported packs
must serve Windows/macOS/Linux listeners; this review makes no Linux FL Studio
support claim. Physical listening and transition-quality approval remain separate
evidence, including the planned S10 listening work.
