# Opt-in DJ transitions

The experimental `mix` handoff analyzes two recordings, proposes compatible beat-aligned cues, renders a processed copy of B during preparation, and schedules an EQ/gain overlap on the existing audio clock. The existing `direct` and `hybrid` handoffs, policies, pack contract and page defaults are preserved.

**Physical output and listening NOT TESTED. Detection accuracy on real songs beyond the measured files is unknown.** These features have generated-signal and native browser engineering checks; they do not have listening acceptance. Exact executed commands, counts, versions and measurements are in [the handoff](handoffs/DJ-TRANSITIONS-HANDOFF.md).

## Run and use the page

From the repository worktree:

```sh
npm run build
node dist/scripts/serve.js
```

Use `npm.cmd` in Windows PowerShell. Open `http://127.0.0.1:4173/`. The server supports `--port <number>` when another local port is needed.

1. Keep or choose an available pack. The default remains S01, Explore, the existing genre and volume 0.65.
2. Choose **Automatic mix (experimental)** in **Handoff**. The initial selection remains **Crossfade A -> B**. Selecting the new mode affects the next selection.
3. Optionally enable **Allow a small key shift** or **Return B to its original tempo after the mix**. Both controls are initially unchecked and appear only for the new mode.
4. Play A, then request **Next Song** early enough to prepare B and reach a future cue. The page shows the preparation state before it offers a scheduled transition.
5. Read the mix detail for the reason, selected tempos, pitch amount and heuristic confidence. An unavailable worker, unsupported input, low confidence, incompatible key, out-of-range transformation or missed analyzed cue attempts the existing authored crossfade.
6. **Cancel next** cancels preparation or a transition whose boundary has not started. Once the transition is audible, the existing refusal rule applies. Pause/Stop and invalidating transport actions prevent late worker results from scheduling audio.

The current S01 and owner-local FL measurements do not meet the conservative mix thresholds. They therefore demonstrate the visible authored fallback, not a successful automatic mix. Generated, explicitly accented fixtures demonstrate successful processing and scheduling in the test harness. The owner-local pack is not copied into this worktree.

The existing v0 directed-route validator still requires compatible authored tempo/harmony. This feature does not expand the catalog, invent a new route, rewrite manifest cues or let the page load arbitrary recordings. The pure PCM planner and prepare API can analyze/process recordings with different detected tempos and keys; the existing DJ route eligibility still applies before that path is selected.

## Analyze audio

```sh
npm run build
node dist/scripts/analyze-audio.js fixtures/s01
node dist/scripts/analyze-audio.js /absolute/path/to/an/existing/pack
```

Pass a local pack's existing path. The CLI reads it in place and writes measurement JSON under ignored `artifacts/analysis/`; it does not copy source audio. Existing loudness, peak, section and energy measurements remain intact. Each recording gains `mix_analysis` and a console summary.

`analyzeMixAudio({sampleRate, channels})` in `src/mix-analysis.ts` accepts mono/stereo `Float32Array` or `Float64Array` PCM and returns:

| Output | Meaning and limits |
| --- | --- |
| Tempo and alternatives | Channel-power spectral novelty, autocorrelation and a constant-tempo grid fit. The explicit mild 120 BPM prior resolves some ambiguities and can be wrong. |
| Beat grid | Original-buffer frame offsets, confidence and fit residual. The residual is agreement with detected onsets, not measured ground-truth error. |
| Downbeats and phrases | Accent-based guesses assuming 4/4 and four-bar phrases. Phrase confidence is capped at 0.5 because accents alone do not establish phrase origin. |
| Global key | Major/minor estimate, competing keys and chroma. Original template weights; no copied published key-profile arrays. A single tone is insufficient. |
| Energy | Complete 250 ms RMS and low-frequency energy curve. |
| Mix points | Deterministically ranked mix-in and mix-out candidates with frame/second offsets, scores, confidence and reasons. |

The estimator does not use manifest BPM/key as ground truth. Confidence is an uncalibrated engineering heuristic, not a probability. Unsupported analysis is labeled separately in the CLI while its existing measurements are retained. Silence or inadequate rhythm/key evidence can produce unknown estimates.

### Analysis bounds

Integer sample rates 8-192 kHz; one or two channels; at most 180 seconds and 16,777,216 total channel samples; constant-tempo search 60-180 BPM. Non-finite samples and unsupported shapes refuse. The browser preparation route has the stricter 12,000,000-channel-sample budget described below.

Variable tempo, non-4/4 meter, tuning changes, local chord progression, vocal spans and true musical phrase structure are not detected. Generated 118/120/124 BPM cases in A minor/C major/D minor and held-out 100/150 BPM G major establish the test tolerances of +/-0.25 BPM and 25 ms for every interior beat and accented downbeat. They do not establish accuracy on arbitrary music.

## Automatic plan and harmonic scoring

`planAutomaticMix(fromAnalysis, toAnalysis, options)` is pure and deterministic. `planMixFromAudio(fromPcm, toPcm, options)` combines plain-function analysis with planning for Node or browser callers. A proposal contains original-buffer frame counts and cue offsets, overlap length, tempo ratio, pitch amount, confidence evidence and both automation lanes. Asset identities/hashes are bound separately by the integration. A fallback contains a reason; it does not itself schedule anything.

Version `automatic-mix@1` uses these engineering thresholds for both recordings:

| Evidence | Minimum |
| --- | ---: |
| Tempo confidence | 0.65 |
| Beat confidence | 0.60 |
| Global key confidence | 0.55 |
| Mix-cue confidence | 0.35 |
| Phrase confidence | 0.20 |

The aggregate confidence is the minimum of these evidence components, including phrase evidence. Eligible cue pairs must leave a complete overlap and B tail; optional tempo return reserves the actual source duration consumed by the return ramp. Ranking combines the two cue scores with a small energy-mismatch penalty. Stable frame-based tie-breaks make repeated inputs reproducible. The default overlap is eight A beats; the API also supports four or sixteen.

The harmonic scorer indexes the circle of fifths with Camelot labels: A minor is 8A and C major is 8B. Same key scores 1.00, relative major/minor 0.95, and an adjacent fifth in the same mode 0.85. More distant relationships score lower and refuse an automatic mix. These scores are a candidate-selection policy, not a model of every chord or a guarantee of consonance.

The planner preserves B's original key when the relationship is already supported. With `allowPitchShift: true`, it may try integer shifts from -2 to +2 semitones, penalizing larger changes. The API can request an explicit integer `pitchSemitones`, subject to the same range and harmonic checks. The low-level DSP accepts finite fractional shifts inside the bound, but the automatic planner does not select them. Pitch shifting changes neither the planned tempo nor its output duration.

For already-decoded PCM in Node:

```js
import {planMixFromAudio} from './dist/src/mix-planner.js';
import {renderTimePitch} from './dist/src/time-pitch.js';

// a and b are {sampleRate, channels}; no file decoding occurs in this example.
const plan = planMixFromAudio(a, b, {allowPitchShift: true});
if (plan.kind === 'mix') {
  const preparedB = renderTimePitch(b, {
    tempoRatio: plan.tempoRatio,
    pitchSemitones: plan.pitchSemitones,
  });
  // Retain plan and preparedB together. A proposal alone is not schedulable audio.
}
```

`prepareMixTransition` binds the original decoded identities to the selected transformation, validates the returned time map and PCM, and constructs a separate prepared AudioBuffer. `SmallPlayer.scheduleMix` owns the final clock check and scheduling. `DeterministicDj` selects it only for `handoff: 'mix'`; callers can use `setHandoff('mix')` and `setMixOptions(...)` for future selections.

## EQ, filters and gain curves

`src/mix-automation.ts` defines frame-relative gain, low-shelf, high-pass and low-pass lanes. Each lane has 2-64 strictly increasing control points with explicit endpoints and linear/exponential ramps. Native AudioParam events convert those frame offsets into times on the same AudioContext that owns both recordings. No JavaScript timer drives the audio moves.

The automatic planner selects `bassSwapAutomation(overlapFrames, sampleRate)`: complementary gain curves, a fixed 250 Hz low shelf and a high-pass handover. A's bass attenuation begins at 40% of the overlap and reaches its cut at 50%; B's bass stays attenuated through 50% and opens by 60%. The shelf cut is -24 dB and the high-pass moves through 500 Hz toward 1 kHz. This attenuates full-band recordings; it does not isolate bass stems.

`sweepAutomation(durationFrames, sampleRate, 'highpass' | 'lowpass', 'open' | 'close')` supplies a reusable sweep plan. `mixCurveValue` evaluates the same plan data for inspection/tests. The automatic planner currently chooses the bass-swap recipe; it does not optimize among different sweep styles, and the page has no separate sweep-style selector.

Bounds: one frame through 120 seconds, gain 0-1, low shelf -24 to 0 dB, and cutoff 0 through Nyquist. Web Audio BiquadFilter Q is supplied in its required dB representation. Recorded sources allocate the optional wet/dry filter graph only for mix scheduling. Pre-boundary cancellation restores A's original direct path and natural end; native-call failure rolls graph changes back.

OfflineAudioContext provides the native offline implementation used in browser checks. Node checks validate automation and graph scheduling with doubles; this change does not add a second software IIR renderer for Node. Moving filters can increase instantaneous peak even with attenuating controls: one measured 0.3-peak test input reached 0.342378 during an opening high-pass sweep. No general clipping-free overlap or true-peak guarantee is claimed.

## Tempo and pitch preparation

`renderTimePitch` in `src/time-pitch.ts` is an original plain DSP function. Browser calls use `prepareTimePitch` in a disposable module worker; analysis also uses a disposable worker. There is no time stretching or pitch processing in the audio callback, and no synchronous browser DSP fallback if workers are unavailable.

The processor uses stereo-linked WSOLA with 40 ms grains, 20 ms hops and a +/-10 ms source search, followed by compensated 24-sample-radius windowed-sinc resampling when shifting pitch. Compensation changes duration independently of pitch. Plain `AudioBufferSourceNode.playbackRate` resampling is not used as a pitch-preserving technique.

| Parameter | Engineering limit or behavior |
| --- | --- |
| Tempo ratio | A BPM / B BPM; inclusive 0.92-1.08. Out-of-range values refuse. |
| Pitch | Inclusive -2 to +2 semitones. This is not a listening-qualified range. |
| PCM | Mono/stereo, integer 8-192 kHz, at least 32 frames, up to 180 s and 12,000,000 total channel samples. Both time and sample-count limits apply. |
| Constant output length | `round(inputFrames / tempoRatio)`, independent of pitch amount. |
| Tempo return | Optional linear return from the matched ratio to 1, beginning after the mix. The planner chooses four A beats; the low-level API requires at least 20 ms and enough source audio to complete it. Pitch remains at the selected shift. |
| Output budget | At most `12,000,000 / 0.92` total channel samples. |
| Edges/headroom | Raised-cosine taper up to 5 ms per outer edge, capped at half the output length, and common-channel attenuation to a -1 dBFS sample-peak ceiling. |
| Worker deadline | 30 seconds per analysis or render job; timeout/abort/error terminates the worker. This is not an end-to-end 30-second guarantee. |

The returned monotonic map converts original B cue frames to processed B offsets. A linear tempo return integrates the changing rate; simply scaling every cue by a constant is not correct after the ramp begins. Mapping helpers use this integral and its inverse, with exact endpoints. The +/-10 ms WSOLA search radius does not bound every transient's displacement from the nominal map.

Workers transfer private copies and leave caller buffers attached. Prepared replies are checked for source shape, processor version, exact requested tempo/pitch/return parameters, output length, finite samples and peak limits before they can become a scheduled transition. The player reserves a two-second preparation allowance when selecting future A cues, then checks the exact clock again after processing. This allowance is scheduling policy, not a measured latency guarantee. If the analyzed cue is too late, the authored cue is tried; if it is also too late, A continues and the request reports unavailable.

## Verification and limits

```sh
npm run check
npm run check:browser
node --test dist/tests/mix-analysis.test.js dist/tests/audio-analysis.test.js dist/tests/analyze-audio-cli.test.js
node --test dist/tests/mix-automation-review.test.js dist/tests/mix-automation.test.js dist/tests/web-audio.test.js
node --test dist/tests/time-pitch.test.js dist/tests/mix-prepare.test.js
node --test dist/tests/mix-planner.test.js dist/tests/mix-player.test.js
```

`check:browser` runs both original browser scripts unchanged, then the additive `mix-browser-check` script. New native tests cover repeated offline samples, EQ response, exact restoration on cancellation, real workers, selected tempo/key processing cases, DJ preparation/cancellation/clock state and the actual page defaults/fallback. All test audio is generated in code. Reports are under ignored `artifacts/`.

Repeated rendering is bit-identical for the exercised inputs in the tested native runtime. Browser worker versus plain-function parity is checked within the same Chromium runtime. This does not establish Node-versus-browser, cross-OS, cross-CPU or cross-version bit identity. Full repository qualification in this task ran on Windows only; see the handoff for the separate Linux scratch DSP pilot.

WSOLA can repeat or smear transients, and pitch shifting does not preserve formants or timbre. Boundary and headroom tests do not prove there are no audible artifacts throughout an arbitrary recording. The global key estimate does not predict local chord/vocal clashes. Real songs beyond the four measured recordings, physical output and listening remain untested.

## Research and license record

There are **zero new runtime dependencies**, no downloaded test audio and no copied third-party DSP implementation. The analysis, WSOLA, resampler, planner and generated fixtures are original source. Native filtering uses the browser implementation. Existing dependency pins are unchanged.

Signalsmith Stretch's [MIT license](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/LICENSE.txt) and [official web distribution](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/release/README.md) were checked. It was not installed: its published browser integration uses WASM/AudioWorklet, while this assignment requires preparation in a worker and a plain Node function. No GPL/LGPL code was used, including Rubber Band, SoundTouch or the AudioLabs toolbox.

Primary research consulted before implementation:

- [Ellis, Beat Tracking with Dynamic Programming](https://www.ee.columbia.edu/~dpwe/pubs/Ellis06-beattrack.pdf) and [AudioLabs autocorrelation tempograms](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S2_TempogramAutocorrelation.html): rhythmic evidence and tempo ambiguity.
- [AudioLabs chroma/template analysis](https://www.audiolabs-erlangen.de/resources/MIR/FMP/C5/C5S2_ChordRec_Templates.html): tonal representation; research context only, no toolbox code/profile arrays copied.
- [Mixed In Key Camelot guide](https://mixedinkey.com/camelot-wheel/): labels and candidate harmonic relationships.
- [Roelands and Verhelst, WSOLA](https://www.isca-archive.org/eurospeech_1993/roelands93_eurospeech.html), [Driedger and Mueller's time-scale modification review](https://www.mdpi.com/2076-3417/6/2/57), and [DAFX time-segment processing](https://www.dafx.de/DAFX_Book_Page/chapter7.html): overlap/search and quality tradeoffs, not imported implementations.
- [Web Audio specification](https://www.w3.org/TR/webaudio/) and [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/): clock, source and filter behavior.
