# Offline analysis prototype handoff

Date: 2026-11-08 (America/Chicago). Status: **COMPLETE for the requested local-branch prototype**. Independent work; no EMF slice or listening acceptance was advanced. Effort percentage is unknown.

## Scope and source

- Branch: `work/analysis-prototype`, in its own Windows worktree.
- Base: `504376b18449b89ff6801cf2332600f2692f5d7e`, the owner's exact selected main revision.
- Delivery: local commit only. No push, merge, main edit, DAW launch, production render, audio copy from the owner-local pack, or new committed audio. Main independently advanced to `65860f982e03c12db78ca59ec85b23e2603c40d2` during this task; that concurrent RAM commit was left alone.
- `web/`, `src/dj.ts` and `src/hybrid-handoff.ts` are unchanged against the selected base. Existing package files and the `/artifacts/` ignore rule are unchanged; no runtime or development dependency was added.
- The containing commit is the delivery revision; its SHA is supplied in the chat handoff, since a file cannot contain its own future commit hash.

The actual tested code is pinned by SHA-256 below. Only documentation changed after the final gates:

| File | SHA-256 |
| --- | --- |
| `src/audio-analysis.ts` | `3ae7cc0f0515658a22114f5c198c63430dca1c49d804c1f662b3c7c8ebad3f2e` |
| `scripts/analyze-audio.ts` | `12422ef0f8078a17771bb6abd023995eb8219cdb662c8112b5b6c13dbc22ba5c` |
| `tests/audio-analysis.test.ts` | `9bf106f3b78687a7cf9af58ecacefd40a26669fffa819cea141d83d71f93cabf` |
| `tests/analyze-audio-cli.test.ts` | `bb170097cfdc2e3aafd5d8100440487189ffba3cd5dd1dbf1aa9c436e278044b` |

## Implemented result

`scripts/analyze-audio.ts` accepts multiple WAV files or pack directories and optional comma/space-separated `--sections start:end` ranges. It writes atomic JSON reports under ignored `artifacts/analysis/` and prints a readable summary. `src/audio-analysis.ts` supplies the dependency-free WAV decoder and measurements. [The guide](../AUDIO_ANALYSIS.md) defines the field meanings and supported formats.

Each WAV gets integrated gated K-weighted LUFS, sample and estimated true peak, overall and one-second RMS, low/mid/high spectral energy, longest all-channel silence below -60 dBFS, and channel-sample/frame rail-hit counts. Packs retain existing validation and source hashes. Recordings get manifest phrase/cue/pickup/tail sections by default; explicit ranges replace those sections. Samples get their full-file report. Short or silent clips have explicit null/status semantics.

The source/test changes, guide, this handoff and branch-local Current Tasks checkpoint are the entire scope. There is no browser/DJ feature or gain normalization.

## Executed verification

Windows only: Node **26.12.1**, npm **11.20.0**, Playwright **1.62.1**, headless Chromium **151.0.7922.34**. Development setup used `npm.cmd ci --ignore-scripts --prefer-offline` and did not change the lockfile. Commands ran from the prototype worktree root. In the commands below `OWNER_PACK` denotes the existing original-checkout `local/s09-fl/pack` absolute path; it was read in place, never copied.

| Command | Result |
| --- | --- |
| `npm.cmd run build` | PASS |
| `node --test dist/tests/audio-analysis.test.js dist/tests/analyze-audio-cli.test.js` | **40 passed, 0 failed**: 30 DSP + 10 CLI cases |
| `npm.cmd run check` | **222 Node tests passed, 0 failed**, deterministic fixture check and six WAV validations passed; all three S11 recipe studies restored stopped |
| `npm.cmd run check:browser` | **24 native offline groups + 16 browser groups passed**; S11 added **4 groups with 24 paired native cases**, zero differing replay bits; exit 0 |
| `node dist/scripts/analyze-audio.js fixtures/s01` | PASS: 6 full assets, 4 recording sections |
| `node dist/scripts/analyze-audio.js OWNER_PACK` | PASS: 6 full assets, 6 recording sections including tails |
| `node dist/scripts/analyze-audio.js fixtures/s01 --sections 0:8,8:16` | PASS: 6 full assets, 4 explicit recording sections |
| `node dist/scripts/analyze-audio.js OWNER_PACK --sections 0:8,8:16` | PASS: 6 full assets, 4 explicit recording sections |
| `node dist/scripts/analyze-audio.js fixtures/s01/audio/s01-recording-a.wav fixtures/s01/audio/s01-recording-b.wav --sections 0:8 8:16` | PASS: two separate full-file reports and 4 explicit sections |
| `ffmpeg.exe -hide_banner -nostdin -nostats -i OWNER_PACK/audio/s09-fl-recording-a.wav -af ebur128=peak=true -f null NUL` | PASS: independent installed FFmpeg 8.1 reports **-20.6 LUFS**, peak **-3.8 dBFS** |
| Same FFmpeg command for `s09-fl-recording-b.wav` | PASS: **-16.4 LUFS**, peak **-0.7 dBFS** |

FFmpeg is an independent read-only comparison, **not an analyzer dependency**. Its displayed precision agrees with both prototype loudness and peak estimates. No complete conformance suite was run.

The independently authored tests cover analytical sine levels at 44.1/48/96 kHz and K-filter shape at 100 Hz/10 kHz, silence, clipped squares, both PCM rails, stereo anti-phase, absolute/relative gating, short clips, complete blocks, partial RMS windows, spectral bands, intersample peaks, all supported encodings, corrupt RIFF data, section boundaries, multiple inputs, errors, stable report naming and preserved S01 source hashes.

An independent DSP/source review reproduced one defect in the initial Hann-window energy split: an impulse exactly at a window boundary disappeared. The final implementation uses rectangular FFT blocks and Parseval normalization, preserving all original mean-square energy. The regression passes. The reviewer rechecked that correction and the complete CLI and found no further material defect in the bounded scope. Initial reports were regenerated with the corrected implementation.

## FL pack measurements

Source pack `s09-fl@1`, stereo PCM16, 44.1 kHz. These figures describe the already-existing owner-local files, including their tails.

| Metric | Recording A | Recording B |
| --- | --- | --- |
| Duration | 18.687505669 s | 19.750000000 s |
| Integrated loudness | **-20.588275114 LUFS** | **-16.426338531 LUFS** |
| Sample peak | -3.772453960 dBFS | -0.715765278 dBFS |
| True-peak estimate (4x) | -3.756555986 dBTP | -0.703818329 dBTP |
| Overall RMS | -21.755874175 dBFS | -18.295053068 dBFS |
| Longest silence below -60 dBFS | 1.898208617 s | 1.480748299 s |
| PCM rail hits | 0 | 0 |
| File SHA-256 | `14d702271b5f14d0373cf6e1062ecaff2a752934111c27346152207abf40a7d8` | `fd9f8bc46f45541606d5c30e4880c9d59d4880be470f63fff7dda583648d8904` |

B measures **4.161936583 LU** above A. Sections 0–8 s measure A -20.67 / B -16.33 LUFS; 8–16 s measure A -20.65 / B -16.32 LUFS. The separate tails measure A -57.96 / B -30.16 LUFS. S01 full recordings measure A -23.69 / B -23.85 LUFS. No listening judgment follows from these numbers.

Ignored local evidence:

- `artifacts/analysis/s01-foundation-ef1ec52505e5e0c0.json`: corrected default S01 report.
- `artifacts/analysis/s09-fl-4ddf2a37db9f47cd.json`: corrected default FL report.
- `artifacts/analysis/s01-foundation-807daa0bd4560465.json` and `s09-fl-e3002f30bae08bd0.json`: explicit 0:8,8:16 runs.
- `artifacts/analysis/check.log`, `check-browser.log`, `ffmpeg-a.log`, `ffmpeg-b.log`, `s01-summary.txt`, `s09-summary.txt`.
- Existing browser gate reports under `artifacts/s09-browser/` and `artifacts/s11-browser/`.

## Limits, records and next action

**Physical output and listening NOT TESTED.** No FL Studio process was launched or FL project edited. The new analyzer was not run on a rendered DJ transition or procedural bridge mix; the existing browser regression gate ran as recorded above. Codec behavior and the full ITU/EBU conformance suite were not tested. macOS, Linux and Node 24 were not exercised for this prototype. The fixed 4x true-peak estimator, especially below 48 kHz, remains explicitly an estimate; section cuts are analyzed as zero-extended standalone clips. Unsupported formats and size limits are in the guide. There is no known remaining blocker for the assigned prototype.

The managed EUTONOS settings command reported no available runtime launcher. The readable native Current Tasks/handoff fallback was used without installing a runtime or fabricating board, workflow, RAM or acceptance receipts. The EMF campaign and its listening status are unchanged by this work. Plan remains the requested bounded prototype; no new campaign was created.

**One next action — PC + owner/coordinator:** inspect this branch's guide and local reports, and decide whether to assign integration or further measurement qualification. Start with `npm.cmd run build` and `node dist/scripts/analyze-audio.js fixtures/s01`. No merge, push, gain change, FL operation or listening acceptance is authorized by this handoff.
