# Offline audio analysis prototype

This command measures existing WAV bytes without playback, gain changes or a DAW. It is an independent prototype on `work/analysis-prototype`, based on `504376b18449b89ff6801cf2332600f2692f5d7e`; it does not complete a listening gate. [Historical handoff](handoffs/ANALYSIS-PROTOTYPE-HANDOFF.md).

## Run

From the worktree root, after the existing development dependencies are installed:

```sh
npm run build && node dist/scripts/analyze-audio.js fixtures/s01
node dist/scripts/analyze-audio.js path/to/recording-a.wav path/to/recording-b.wav
node dist/scripts/analyze-audio.js path/to/pack --sections 0:8,8:16
node dist/scripts/analyze-audio.js path/to/recording.wav --sections 0:8 8:16
```

In Windows PowerShell use `npm.cmd run build`, check its exit status, then run the Node command. Pass the original owner-local pack's absolute path when it lives in a different checkout. Do not copy that pack into this worktree or run `fl:produce` to use this analyzer.

The CLI accepts multiple files/directories, `--sections=start:end,...`, `--` before literal filenames, and `--help`. Each input produces a short console summary and one JSON report in `artifacts/analysis/` relative to the working directory. The existing `/artifacts/` ignore rule covers all reports. Stable filenames incorporate source identity, media hashes and requested ranges. A successful repeat replaces the same report atomically. An invalid input returns exit status 1 while other inputs can still succeed; usage errors return 2.

Pack input uses the existing manifest, path, provenance and byte/hash validation. Every WAV asset gets full-file measurements. Recordings also get a nonoverlapping partition at the manifest's phrase/cue boundaries, pickup, body end and file end; this includes A/B and their tails. Explicit sections replace that partition for recordings and apply to standalone WAVs. Pack one-shot samples keep full-file measurements only. Invalid or out-of-bounds ranges fail explicitly.

## Measurements and interpretation

| Field | Definition |
| --- | --- |
| `loudness.integrated_lufs` | Independent K-weighting per channel; channel energy sum, complete 400 ms blocks every 100 ms, absolute gate at -70 LUFS and relative gate 10 LU below the absolute-gated energy average. Block/hop lengths round to samples. |
| `sample_peak` | Maximum absolute stored sample over all channels; linear amplitude and dBFS. |
| `true_peak` | **Estimate** from the BS.1770-5 Annex 2 four-phase FIR, with startup zeros, full tail flush and a sample-peak lower bound. Linear amplitude and dBTP. |
| `rms_windows` | Nonoverlapping 1 s windows, averaging squared samples over frames and channels. Final partial window uses its actual length. Overall `rms_dbfs` is also included. |
| `energy` | Rectangular 1 s FFT blocks, zero-padded to a power of two. One-sided squared spectra partition the original mean-square energy across low `[0,250)`, mid `[250,4000)` and high `[4000,Nyquist]` Hz. Includes DC; fractions sum to one for nonzero energy. Finite-window leakage affects the split near cutoffs. |
| `silence` | Longest consecutive run of frames where every channel has absolute amplitude strictly below 0.001 (-60 dBFS). Includes leading/trailing silence; ties choose the earliest run. |
| `clipping` | Counts channel samples at either integer PCM rail, or float samples with absolute amplitude at least 1. Also counts affected frames. Rail hits cannot establish historical clipping/distortion. |

All section ranges are half-open `[start,end)`, rounded to the nearest sample. Each section is treated as a standalone clip: K-filter state resets and the peak filter sees zeros beyond its boundaries. Timestamps remain relative to the original file. A cut boundary can affect a section's reconstructed peak; section values are not a substitute for the full-file result.

No complete 400 ms block means LUFS is `null` with `status: "too_short"`. No blocks above the absolute gate means `null` with `status: "below_absolute_gate"`. Zero amplitude/power has `null` logarithmic values; zero spectral energy has null fractions. Reports never rely on accidental JSON conversion of infinities. The report carries method definitions, source SHA-256 values, pack identity/revision where applicable, and a measurement-only listening statement.

## Scope and verification

Standalone inputs support little-endian RIFF PCM16/24/32 and IEEE float32, mono/stereo, 8–192 kHz, at most 64 MiB per WAV. Pack files retain the existing PCM16 contract. RF64, WAVE_FORMAT_EXTENSIBLE, compressed audio, multichannel layouts and larger/streaming files are explicitly unsupported.

The fixed 4x peak estimator is a prototype, particularly below 48 kHz where its output rate is below 192 kHz. It is not a certified conformance meter. Synthetic calibration and an intersample test do not establish full ITU/EBU suite compliance, codec peaks, output-device behavior or listening quality. The command does not render DJ transitions or procedural bridges; this task did not feed such a rendered mix into the new analyzer.

Run `npm run check` and `npm run check:browser` for the repository gates. Focused tests are `node --test dist/tests/audio-analysis.test.js dist/tests/analyze-audio-cli.test.js` after building. Synthetic WAV bytes stay in memory or temporary test directories; no new audio is committed. See the handoff for actual platform, command and pass-count evidence.

## References

- [ITU-R BS.1770-5](https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf): loudness gates, K-weighting and Annex 2 peak interpolation.
- [EBU Tech 3341](https://tech.ebu.ch/docs/tech/tech3341.pdf): calibration and true-peak test tolerances.
- [libebur128 implementation](https://github.com/jiixyj/libebur128/blob/master/ebur128/ebur128.c): cross-check of the arbitrary-rate K-filter parameterization. No library code or runtime dependency is imported.

**Measurements are not listening.**
