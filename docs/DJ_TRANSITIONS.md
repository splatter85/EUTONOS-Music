# Opt-in DJ transitions

This work adds audio-derived mix analysis, prepared tempo/pitch processing and plan-driven mixing beside the existing direct and hybrid handoffs. The original handoffs, policies and page defaults stay authoritative for S10. This is engineering work; **physical output and listening NOT TESTED**. Detection accuracy on real songs beyond the measured files is unknown.

## Phase 1: analyze recordings

After installing the existing development dependencies, run from the worktree root:

```sh
npm run build
node dist/scripts/analyze-audio.js fixtures/s01
node dist/scripts/analyze-audio.js /absolute/path/to/an/existing/pack
node --test dist/tests/mix-analysis.test.js dist/tests/audio-analysis.test.js dist/tests/analyze-audio-cli.test.js
```

On Windows PowerShell use `npm.cmd`. Pass owner-local packs by their existing absolute path; the analyzer reads them in place. It writes measurement JSON under ignored `artifacts/analysis/`, not copies of source audio. Existing loudness, peak, section and energy measurements remain unchanged. Every file now also has `mix_analysis` and a console summary.

`analyzeMixAudio({sampleRate, channels})` accepts mono/stereo Float32/Float64 PCM. It returns:

- Tempo and alternatives from channel-power spectral novelty, autocorrelation and a constant-tempo grid fit. A mild explicit 120 BPM prior resolves some ties; it can be wrong.
- Beat frame offsets, confidence and a grid-to-observed-onsets residual. The residual is not ground-truth accuracy.
- Accent-based downbeat guesses, assuming 4/4, and four-bar phrase hypotheses. Phrase confidence is capped at 0.5 because phrase origin is not established from accents alone.
- A global equal-tempered major/minor key estimate, competing candidates and pitch-class energy. A single tone does not establish a key.
- A complete 250 ms RMS/low-frequency energy curve and deterministically ranked mix-in/mix-out candidates with scores, confidence and reasons.

No manifest BPM/key is used by the estimator. Confidence is an uncalibrated engineering heuristic, not a probability, review or listening result. Unsupported inputs fail explicitly; the CLI retains existing measurements and labels unsupported mix analysis separately.

### Bounds and measured tolerances

Analysis supports integer sample rates 8–192 kHz, one or two channels, up to 180 seconds and 16,777,216 total channel samples. Constant-tempo search is 60–180 BPM. Silence and insufficient rhythm return unknown tempo; weak tonal evidence returns unknown key. Variable tempo, other meters, tuning changes, chord regions, vocal spans and actual phrase structure are not detected.

Windows synthetic tests cover 118/120/124 BPM in A minor, C major and D minor; held-out 100/150 BPM in G major; pickups; 8/44.1/48 kHz; anti-phase stereo; silence; short and invalid audio; energy accounting and exact repeated reports. Tolerances are +/-0.25 BPM and at most 25 ms from every interior ground-truth beat and accented downbeat. These are engineering checks on generated signals, not evidence of general music accuracy.

## Implementation sequence

Phase 1 analysis is implemented and its 22 focused tests plus the unchanged 40 analyzer/CLI tests pass on Windows. Phase 2 native filter automation is implemented: 16 new/review Node tests plus 7 existing tests and 6 native offline groups pass. Phase 3 prepared DSP and Phase 4 automatic planning/integration are still pending at this checkpoint. The [handoff](handoffs/DJ-TRANSITIONS-HANDOFF.md) records exact commands, versions and phase status.

The planned tempo bound is +/-8% and pitch bound +/-2 semitones. These are engineering choices, not listening results. Processing will render a copy of B during PREPARE, using a browser worker or a plain Node function. A proposed transition becomes schedulable only after its processed audio is ready and the existing clock deadline is rechecked. Insufficient confidence or refused processing uses the existing authored crossfade if it is still schedulable.

## Research and licenses

No runtime dependency or third-party source code is added. Analysis code and synthetic test signals are original. Research references explain techniques and limitations; they are not copied implementations:

- [Ellis, Beat Tracking with Dynamic Programming (2006)](https://www.ee.columbia.edu/~dpwe/pubs/Ellis06-beattrack.pdf): onset/tempo/beat evidence and ambiguity.
- [AudioLabs FMP autocorrelation tempogram](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S2_TempogramAutocorrelation.html) and [chroma/template analysis](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C5/C5S2_ChordRec_Templates.html): research context only. No GPL toolbox code is reused.
- [Web Audio specification](https://www.w3.org/TR/webaudio/): native audio clock, scheduled sources and filter automation.
- [Signalsmith Stretch license](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/LICENSE.txt) and [project README](https://github.com/Signalsmith-Audio/signalsmith-stretch): MIT candidate verified, not installed. Its published JS wrapper uses WASM/AudioWorklet; this task requires preparation in a worker and plain Node.

No proprietary or downloaded audio is included. Tests generate their signals in code.
