# DJ transitions: research synthesis for EUTONOS-Music

Status: **proposal / research input for EMF-S15**. Nothing here is implemented, installed or heard. See the [EMF campaign](../campaigns/EMF_INITIAL_INFRASTRUCTURE.md) and the S14 [DJ transitions guide](../DJ_TRANSITIONS.md).

Date: 2026-11-12. Research only; the research agent changed no repository.

Method: three rounds of questions to regular ChatGPT, used signed out, in the built-in browser pane. Web search was on. The model and thinking setting could not be selected while signed out. Its answers were then checked against primary sources: GitHub license files and READMEs, Hugging Face model cards, arXiv, and publisher pages. The research journal stayed local.

Labels: **[V]** means verified by me against a primary source. **[P]** means partly verified: the source exists, but a detail is unconfirmed. **[U]** means unverified, a ChatGPT claim or my own engineering inference. Nothing below involved listening. Every threshold is an engineering starting point, not a perceptual result.

Baseline: EMF-S14 (branch `work/dj-transitions`, merged into main 2026-11-12) already has:
- offline tempo, constant-grid, key, energy and cue analysis;
- opt-in EQ, filter and bass-handover automation;
- WSOLA tempo processing (0.92 to 1.08) and resampled pitch shifts (plus or minus 2 semitones) in workers;
- a conservative ready-only planner with an authored-crossfade fallback.

Known gaps: a half-tempo error on a real FL track (61.86 instead of 120 BPM), and phrase confidence that is low on all real material, so both measured pack pairs fall back.

---

## 1. Summary

1. **The biggest gap is analysis reliability, not effects.** The planner already refuses correctly. The goal is fewer false refusals and no wrong mixes.
   - The fastest win is to carry multiple tempo hypotheses (x0.5, x1, x2) and choose between them by grid fit, low-band (kick) periodicity, accent consistency and the generation BPM as a prior.
   - The longer-term fix for phrase confidence is beat, downbeat and section labels from a neural model, run offline into a versioned JSON sidecar.
2. **Beat This! (MIT code and weights) [V]** is the best permissive beat and downbeat tracker found. A third-party MIT ONNX export for onnxruntime-web already exists **[V]**.
   - **All-In-One (MIT code) [V]** adds section labels (intro, verse, chorus and so on). It is heavier: it runs Demucs, NATTEN and madmom post-processing **[V]**.
   - Run both in an optional local Python step that writes a sidecar. Keep the in-browser DSP as the always-available fallback.
3. **Give the planner more transition recipes, especially ones that need little compatibility.**
   - An echo-out into B on B's own downbeat, or a short cut, works when tempo or key compatibility is unknown. This is a better graceful degradation than a plain crossfade.
   - All of it is schedulable with native nodes (DelayNode, a feedback GainNode, a low-pass filter in the loop) on the existing clock **[V: Web Audio primitives]**.
   - Loop extension and loop rolls should be **pre-rendered in the worker**, not done by toggling `loop` or `loopStart`/`loopEnd`. Those are plain attributes, not AudioParams, so they cannot be scheduled on the clock **[V]**.
4. **Add a rendered-transition evaluator.** It would render each candidate overlap offline and compute objective checks:
   - beat-phase error;
   - low-band energy build-up;
   - short-term loudness bump or dip (BS.1770);
   - true peak;
   - local chroma clash;
   - vocal-overlap estimate.

   It would then choose among candidates or fall back. This turns "we can't listen" into calibrated rejection rules, and it is fully testable with generated fixtures.
5. **Stem transitions are feasible offline** (Demucs, MIT code **[V]**, roughly 10 to 30 s per 3-4 minute track on a 4090-class GPU **[U]**, likely less on a 5090 **[U]**). They are **not first priority**:
   - Checkpoint licensing is unresolved: the weights were trained on MUSDB-type data.
   - Bleed (kick in bass, vocal consonants in drums) can make stem swaps worse than an EQ swap.
   - Four stereo float32 stems of a 3-minute 48 kHz track take about 264 MiB in memory **[V: arithmetic]**.

   Do them after the sidecar and evaluator exist, starting with the vocal-out-before-vocal-in and drums-first recipes.
6. **Swap time-stretch engines only after an evaluator exists.**
   - Signalsmith Stretch (MIT) **[V]** is the best permissive candidate. Its official web build is AudioWorklet-only **[V]**, so it needs a small custom Emscripten buffer-in/buffer-out wrapper for worker and Node use **[U, feasible]**.
   - Rubber Band is GPL or commercial **[V]**. Use it only as an offline A/B reference, never in the repo.
7. **The generation side is an underused lever.** ACE-Step exposes BPM, key and time-signature controls, but they are guidance, not guarantees **[P]**.
   - Ask for 8 to 16 bars of drums-only intro and outro.
   - Store the requested values as priors and verify them against the analysis.

---

## 2. Transition techniques: what skilled DJs do, and what can be automated

| Technique | What it is | Automatable here? | How (Web Audio plus offline prep) |
| --- | --- | --- | --- |
| Phrase alignment | B's structural entry (bass or drop) lands where A's section ends; cues on 8, 16 or 32-bar boundaries | High, once sections exist | Score cue *pairs* jointly (A's exit boundary with B's entry boundary), not each cue alone. Treat 16 and 32 bars as hypotheses: AI tracks often use odd lengths [U]. |
| Energy arc | Plan intensity across the session, avoid drop-on-drop and breakdown-after-breakdown | High as a recommender | Energy feature built from loudness, onset density, low-band level, brightness and vocal activity, normalized per track. For a work soundtrack, aim for a gentle, low-variance arc [U]. |
| Bass / EQ swap | Already built | Done | Keep. Upgrade from a 250 Hz shelf to separate sub (30-80 Hz) and bass (80-180 Hz) bands [U]. |
| Drum swap | Hand rhythmic ownership over by stages: B's hats and percussion, then A's kick out, then B's kick and bass | High for electronic music | Needs kick versus sustained-bass separation (band-limited onset envelopes) or stems [U]. |
| Loop extension | Repeat a clean bar-aligned drum section to lengthen a short intro or outro | High for percussive sections | **Pre-render** an extended buffer with crossfaded seams in the worker, then schedule one source. Native looping cannot be released at a scheduled time [V]. |
| Loop roll | 4, then 2, 1 and half-beat repeats before the drop | Medium (a stylistic effect) | Pre-render each loop length; schedule separate sources with short gain ramps. Low priority for a work soundtrack. |
| Echo-out / delay throw | A's last phrase leaves through tempo-synced feedback echoes while B enters dry | Very high | DelayNode (delayTime = 60/BPM × division) with feedback below 1 and an LPF/HPF in the loop. Keep the send separate from A's channel fader so the tail survives [U, standard practice]. delayTime is a-rate per the W3C spec [V]. Does not need tempo or key match, which makes it a good low-confidence fallback. |
| Reverb wash | Swell A into a reverb tail, high-pass the send | Very high | ConvolverNode with a generated (original) impulse response; HPF on the send. |
| Cut / slam | Instant switch on a strong downbeat, often after an echo | Very high | 5-20 ms complementary ramps to avoid clicks [U]. Needs only one confident downbeat per track. |
| Vocal / acapella overlay | A's vocal over B's instrumental, or call and response | Moderate to low | Requires a vocal-activity estimate at minimum, stems for real overlays. Default rule: never overlap two lead vocals. |
| Harmonic mixing | Camelot: same key, relative, adjacent | Done (global) | Move to **local** chroma over 2-8 s windows. Weight harmony only when both overlapped regions are tonal. Drum-only overlaps barely need key compatibility. Treat harmony as a soft penalty, not a gate [U]. |
| Crossfade law | Equal-power for uncorrelated material, linear for correlated | Easy | Add an equal-power curve option to the gain lanes. |

Typical overlap by genre. These are practice-based starting presets, not standards **[U]**:

| Genre | Overlap |
| --- | --- |
| House / tech house | 16-32 bars |
| Techno | 16-64 bars |
| Trance | 16-32 bars |
| DnB | 8-16 bars, with drop alignment |
| Hip-hop | 1-8 bars, often cuts |
| Pop / R&B | 4-8 bars, vocal-aware |

For 1-4 minute AI tracks with short intros, 4-8 bar overlaps plus echo-outs and cuts fit better than long club blends **[U]**.

Zehren et al.'s three DJ-interview rules (ChatGPT round 3, consistent with the arXiv abstract) **[P]**:
1. **Novelty**: the switch point coincides with a change in rhythm density, loudness, timbre or harmony, found by checkerboard novelty on self-similarity matrices at strong beats.
2. **Period**: the switch point falls on a downbeat at the start of a period that is a multiple of 4 bars.
3. **Salience**: the section after the cue can stand on its own (a new melody, bassline or drum pattern).

The M-DJCUE guidelines restrict cue-ins to the intro, before the core, and cue-outs to after the core starts [U].

Vande Veire and De Bie use three transition types:
- rolling;
- relaxed;
- double-drop, with cues 16 measures before each drop, a 16-bar fade-in and a 32-bar fade-out.

They vary types through a finite-state machine and select track and cue jointly [U for the specifics]. For a work soundtrack, port the decision structure (candidate cue pairs, then recipe choice, then expected-overlap check, plus memory of the last recipe to avoid repetition), not the DnB bar counts.

Other cue-point rules worth porting:
- place cues on structural boundaries (novelty peaks) quantized to the downbeat or phrase grid;
- prefer B entering in a low-density section (intro or breakdown), with A exiting in its outro or breakdown;
- align B's drop with the end of A's phrase;
- avoid vocal clashes;
- keep tempo and key changes small.

Kim et al. (ISMIR 2020) found from 20,765 real transitions that DJs respect structure and keep tempo and key changes small **[P]**.

---

## 3. Tools and licenses

| Tool | Purpose | Code license | Weights / data | Browser? | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Beat This!** (CPJKU, ISMIR 2024) | Beat and downbeat | MIT **[V]** | README: "code and the published model weights are released under the MIT license"; some training files are copyrighted or limited CC **[V]** | Third-party ONNX export `musetric/beat-this-onnx` (MIT) for onnxruntime-web WebGPU. The wasm backend reportedly runs about 12x slower, the host must reproduce the log-mel front end exactly, and WebGPU gives wrong output on some mobile Adreno GPUs **[V: model card]** | **Adopt in the offline sidecar first.** Browser use is a later experiment. final0 checkpoint about 78 MB, small0 about 8.1 MB **[V]**. |
| **All-In-One** (`allin1`, Kim and Nam, WASPAA 2023, arXiv 2307.16425) | Tempo, beats, downbeats, section boundaries and labels | MIT **[V]** | Weights downloaded from the hub; license not separately confirmed **[U]**. Depends on demucs, NATTEN and madmom **[V]**. Uses madmom's `DBNDownBeatTrackingProcessor`, an HMM decoder with no learned madmom weights **[V: source; the no-weights point is inference, high confidence]** | No (PyTorch, NATTEN) | **Offline sidecar, optional.** README timing: 10 songs (33 min) in 73 s on an RTX 4090 **[V]**. |
| madmom | Beats, downbeats, onsets | BSD **[V]** | Model and data files are **CC BY-NC-SA 4.0** **[V]** | No | Use the algorithms as reference only; never bundle the models. |
| librosa | Tempogram, PLP, beat_track, chroma, segmentation | ISC **[P: ChatGPT and widely known]** | n/a | No (Python) | Reference for porting PLP, tempograms and checkerboard novelty. |
| Essentia / Essentia.js | Large MIR toolbox (WASM available) | **AGPL-3.0** (proprietary on request) **[P: search results quoting the README and licensing page]** | Models CC BY-NC-ND or AGPL **[P]** | Yes (WASM) | **Avoid in the repo.** Fine for private benchmarking. |
| BeatNet | Online and offline beat and downbeat | License not checked | Unknown | No | Unresolved; lower priority than Beat This!. |
| **Signalsmith Stretch** | Time-stretch and pitch-shift | MIT **[V, also verified on the branch]** | n/a | Official web release is WASM/AudioWorklet. It schedules rate, semitones, formants, tonality limit and loopStart/loopEnd, and offers block-size presets "default" and "cheaper" **[V]** | **Best permissive upgrade over WSOLA.** Needs a custom Emscripten wrapper around the header-only C++ `process()` for worker and Node use **[U]**. ChatGPT claims a useful range of about 0.75-1.5x (our 0.92-1.08 fits) and default block/interval of 120/30 ms **[U]**. |
| Rubber Band (incl. `rubberband-wasm`) | Reference-quality stretch | **GPL-2.0+ or commercial** **[P: search snippets of the official license page and package metadata]** | n/a | WASM exists | Offline A/B reference only. Never in the repo. |
| SoundTouchJS (`@soundtouchjs/*`) | WSOLA, plus an optional phase-vocoder stage | Newer packages **MPL-2.0**, older ones LGPL-2.1 **[P]** | n/a | Yes (JS, worklet) | Possible, but MPL is file-level copyleft. Check the exact version. Signalsmith is preferred. |
| **Demucs** v4 (htdemucs, htdemucs_ft, htdemucs_6s) | 4- or 6-stem separation | MIT **[V]** | Weight licensing is unresolved: trained on MUSDB-class data **[U]**. Repo **archived 2025-01-01**, maintenance fork at `adefossez/demucs` **[V]**. htdemucs_ft is about 4x slower than htdemucs; 6s has weak piano **[V]** | No | Offline, optional, private outputs only. Do not commit the weights or stems. |
| Mel-Band / BS-RoFormer | Higher-quality vocal separation | MIT architecture code **[P]** | Per-checkpoint: some MIT (Kimberley Jensen vocal model, via mirrors), some CC BY-NC-SA or unlabeled **[P]** | Some ONNX exports exist **[P]** | Evaluate one explicitly MIT checkpoint for the vocals stem. |
| python-audio-separator | One CLI over Demucs, MDX and RoFormer | Reportedly MIT **[U]** | It downloads models with their own terms | No | Handy benchmark harness; audit every model separately. |
| ACE-Step 1.5 | Generator | MIT for 1.5, Apache-2.0 for v1 **[P]** | n/a | n/a | Has BPM, key and time-signature metadata controls, and can analyze audio for these values **[P]**. No published adherence benchmark was found **[V: absence in search]**. |

Key-detection advice (ChatGPT, consistent with the literature) **[U]**:
- keep our own chroma;
- add local (sectional) key with uncertainty and key-change detection;
- separate the harmonic and percussive paths before chroma;
- refuse to label weak keys.

Krumhansl-Schmuckler and Temperley profiles are the classical references, re-derived not copied, as on the branch.

Half/double-tempo fix. Ellis DP beat tracking and Grosche and Müller PLP are the references **[P]**:
1. Expand the candidates to {x0.5, x1, x2} within 60-180 BPM.
2. Fit a phase-optimal grid per candidate and score its onset alignment.
3. Score low-band onset periodicity (kick), 2- and 4-beat accent consistency, residual drift across sections, and a weak prior from the generation BPM.
4. Keep the top two candidates when they are close, report `ambiguity: half_double`, and let the planner refuse or use a tempo-free recipe.
5. Add generated regression fixtures: half-time feel, offbeat hats, sparse kicks, 87/174 DnB, and 100 BPM hip-hop. Measure an "octave error rate" **[U]**.

---

## 4. Stem approach (offline only)

- **Pipeline.** Run separation in an optional local Python tool on the owner's GPU, write FLAC stems and a sidecar entry, and keep everything out of the public repo.
  - The sidecar records: model and checkpoint hash, sample rate, offsets, per-stem peak and RMS, stereo correlation, and the **sum-to-original residual** (dB of x − Σstems relative to x).
  - The browser only reads the sidecar and stems; a missing stem means no stem recipe.
- **Throughput** [U, third-party, inconsistent]: htdemucs takes about 10-30 s per 3-4 minute track on an RTX 4090, and htdemucs_ft about 2-4x longer. The README says ft is 4x slower **[V]**. One A100 benchmark gave 20.6/32.0/25.1 s for a 240 s track (htdemucs/ft/6s) [U]. A 5090 should be at least as fast [U]; measure warm and cold, FP16 versus FP32, and segment length. This is library preparation, never real time.
- **Memory.** 180 s × 48 kHz × 2 ch × 4 bytes × 4 stems is about 264 MiB, plus 66 MiB for the full mix **[V: arithmetic]**. Keep decoded stems only for the current and next track. The branch's 12M-channel-sample budget would need revisiting.
- **DJ-relevant artifacts**, scored per recipe rather than by SDR:
  - vocal consonants in drums;
  - kick in bass (doubled attacks during a bass swap);
  - bass in "other" (low-end build-up);
  - vocal reverb left in the instrumental;
  - softened transients.

  A low reconstruction residual does **not** mean the stems are clean.
- **Recipes, most to least robust** [U]:
  1. **Vocal-out before vocal-in**: fade A's vocal stem early, then blend the instrumentals.
  2. **Drums-first handover**: B's drums for 4-8 bars, then A's drums out, then the bass swap using the real bass stem, then A's remaining stems out.
  3. **Bass swap via the bass stem**: only after measuring kick leakage.
  4. **Acapella over B's instrumental**: only with clean isolation, compatible local key, grid-aligned phrasing and no competing lead.
- **Scheduling.** Per stem, one AudioBufferSourceNode and a GainNode, all started at the same clock time. These feed a per-track bus, which keeps the single-owner and single-clock rule. Native `start()` is sample-accurate, so the stems stay phase-coherent if they have identical lengths and offsets [U].
- **Product framing.** djay Pro's Automix exposes per-transition styles such as Echo, Filter and Neural Mix, plus duration and tempo-blend controls. Neural Mix does stem separation live [P]. That is a useful UI reference; their internal selection logic is undocumented [V: absence].

---

## 5. Scoring: objective metrics on a rendered overlap

Render each candidate offline (OfflineAudioContext on the main thread, or a worker DSP render) and compute the checks below. Use them to rank alternatives (8, 16 or 32-bar blend, drums-first, echo-out, cut) rather than to declare one "good". All thresholds are **[U] engineering starting points**, to be calibrated later against human labels.

| Metric | Computation | Start threshold | Basis |
| --- | --- | --- | --- |
| Beat-phase error | Wrapped difference of A and B beat times / beat period; plus 3-band onset-envelope cross-correlation in the overlap | <0.02 beat excellent, 0.05 OK, >0.10 reject (0.05 beat = 25 ms at 120 BPM) | Beat-tracking evaluation practice [U] |
| Low-band build-up | 10·log10(E_combined / max(E_A, E_B)) in bands 25-60, 60-120 and 120-250 Hz over short windows | >+3 dB adjust, >+6 dB reject (aligned kicks can legitimately add up) | DSP heuristic [U] |
| Loudness trajectory | BS.1770 momentary (400 ms) and short-term (3 s) loudness of the render versus the A-to-B interpolation | <1 LU OK, 1-3 warn, >3 LU strong warning | ITU-R BS.1770-5 (2023) and EBU Tech 3341 [P] |
| True peak | 4x oversampled peak | >−1 dBTP warn, >0 dBTP reject | BS.1770 [P]. Note the branch already observed a 0.3 → 0.342 peak from a moving filter [V: handoff]. |
| Local harmonic clash | Cosine or Jensen-Shannon distance of local chroma; optional Tonnetz distance; weighted by tonalness of both regions | Calibrate; no universal cutoff | Chroma and tonal-space research; Sethares and Vassilakis roughness as optional research [U] |
| Vocal overlap | ∫ V_A·V_B over the overlap, from a vocal-activity estimate | Flag more than 1-2 s of overlapping prominent lead vocals | Heuristic [U] |
| Spectral-flux discontinuity | Flux at the boundary versus each side's distribution | Penalize only for "smooth" recipes; allowed for cut and drop recipes | Foote novelty [U] |
| Stereo correlation | Correlation over the overlap | Flag strongly negative values | DSP [U] |

Research context for learned scoring, all later work:
- **Chen et al., ICASSP 2022**, "Automatic DJ Transitions with Differentiable Audio Effects and GANs" (arXiv 2110.06525) **[V]**: learns EQ and fader curves, a good match for our parameterized lanes.
- **Kim et al., ISMIR 2020**, "A Computational Analysis of Real-World DJ Mixes using Mix-To-Track Subsequence Alignment" (arXiv 2008.10267), with 1,557 mixes and 20,765 transitions **[V]**. The underlying audio is commercial and not redistributable.
- **Vande Veire and De Bie, 2018**, EURASIP JASMP 2018:13, DOI 10.1186/s13636-018-0134-8, a DnB auto-DJ **[V]**. On a 220-song hold-out set, 91% of songs were fully correctly annotated, and 18 DnB fans rated the mixes well **[V]**. Its repo `lenvdv/auto-dj` carries a restrictive dissertation COPYRIGHT notice **[V]**; ChatGPT's "AGPLv3" claim is **[U]**. Study it, do not reuse it.
- **Zehren, Alunno and Bientinesi**, "Automatic Detection of Cue Points for the Emulation of DJ Mixing", Computer Music Journal 46(3):67-82, DOI 10.1162/comj_a_00652. The DOI resolves to direct.mit.edu/comj/article/46/3/67 **[V]**; the page itself was behind bot verification and not opened. The arXiv preprint is 2007.08411. It reports 96% (preprint) and about 90% (unseen tracks) usable cues; code `MZehren/Automix`, dataset `M-DJCUE` **[V: arXiv and DBLP listing]**. ChatGPT first said it could not verify this paper, and was wrong.

---

## 6. Recommended roadmap

Smallest valuable increments first. Every increment keeps the authored-crossfade fallback and the existing direct/hybrid defaults, and is testable with generated fixtures only.

This merges ChatGPT's round-3 re-ranking with my own constraints review. The two agree on the order except that ChatGPT inserts a cue-candidate planner as step 2 and puts stems after Signalsmith. I adopt that. All checks are fixture-based and require no listening.

**Increment 1: multi-hypothesis tempo and beat confidence (fixes a known defect).**
- **Scope.** Analysis returns ranked `tempoCandidates` ({x0.5, x1, x2} plus nearby autocorrelation peaks). Each is scored by phase-optimal grid fit, low-band kick periodicity, snare/backbeat accent on 2 and 4, drift, and an optional generation-BPM prior, which counts as evidence and not as ground truth. When the top two are close, it reports `ambiguity`. The planner refuses tempo-dependent recipes when ambiguity is high.
- **Checks.** Generated fixtures at 60-160 BPM covering:
  - four-on-the-floor, kick on every other beat, missing kicks, half-time snare, double-time hats, a drumless intro, and 87/174 DnB.

  Pass conditions:
  - the true tempo is always among the candidates;
  - the octave-error rate on unambiguous fixtures is 0;
  - confidence drops on genuinely ambiguous ones;
  - the existing S01 and FL cases stay deterministic.

  The owner-local FL A track should move from 61.86 to about 120 BPM. That is an owner-local check that is never published.
- **Main risk.** Too many hypotheses make the planner indecisive, or it confidently picks the wrong octave on sparse AI material.
- **Unblocks.** Beat-synced effects, reliable phrase grids, and fewer false fallbacks.

**Increment 2: separate cue-in and cue-out candidate planning (Zehren-style rules).**
- **Scope.**
  - Multi-feature novelty, computed on the downbeat grid: low-band onsets, mid/high flux, RMS, chroma.
  - Checkerboard-kernel peaks.
  - A confidence-weighted 4/8/16-bar grid score instead of hard 16/32-bar gating.
  - An **incoming-salience** check (the four bars after a cue-in must be able to stand alone), normalized per track rather than using the paper's 0.4 × max harmonic-energy threshold.
  - Asymmetric `findIncomingCues(B)` and `findOutgoingCues(A)`.
  - An optional "low-interference" candidate class (energy or vocal valleys) for AI tracks with no formal sections. ChatGPT's own extension, not from the papers.
  - Score cue *pairs* jointly.
- **Checks.** Fixtures with an exact 8 or 16-bar intro, no intro, a drop, a breakdown, a vocal entry, and constant energy.
  - Cues are quantized to the known grid.
  - Strong boundaries outrank weak ones.
  - No cue falls inside a marked vocal phrase or past the end of the track.
  - Low-confidence tracks still yield the authored fallback.
- **Main risk.** Synthetic phrase structure overfits and does not transfer to generated music.
- **Unblocks.** Short, intentional transitions without needing club-style 32-bar phrasing.

**Increment 3: echo-out and cut recipes as additional low-compatibility options.** See the recipe below.
- **Scope.** Two new recipe types beside blend and authored crossfade, each with its own preconditions. They replace the authored fallback only when their conditions hold.
- **Checks.**
  - The wet tail survives after A's dry gain reaches 0.
  - Feedback stays below 1, and the tail falls below −60 dBFS within its budget.
  - B starts at the exact scheduled sample.
  - The cut ramp has no discontinuity above a threshold.
  - True peak stays at or below −1 dBTP.
  - The authored crossfade still runs when neither recipe qualifies.
  - The FIFO, Hold and cancellation semantics are unchanged.
- **Main risk.** Effects hide a bad cue instead of fixing it, and a wrong-octave tempo gives an awkward echo rate. This is why increment 1 comes first.
- **Unblocks.** Graceful handovers for key-incompatible pairs and tracks without intros.

**Increment 4: rendered-transition evaluator.**
- **Scope.** Render each candidate offline and compute these metrics (section 5):
  - true peak;
  - short-term and momentary loudness against the interpolated target;
  - 3-band low-end build-up;
  - beat-phase error;
  - boundary flux, judged by recipe type;
  - silence gaps;
  - stereo correlation.

  Tonal-clash and vocal-overlap metrics wait until trustworthy signals exist. Thresholds live in versioned, experimental configuration. The planner picks the best passing candidate or falls back.
- **Checks.** Known-good and known-bad fixtures with exact expected measurements:

  | Fixture | Expected result |
  | --- | --- |
  | Equal-power crossfade | pass |
  | Both tracks at full gain | loudness bump |
  | Both bass lines at full gain | low-band flag |
  | Both tracks at zero gain | dip |
  | Sample discontinuity | flux/peak warning |
  | Intentional cut or echo | pass for that recipe |
  | Feedback above 1 | fail |

- **Main risk.** Overfitting to synthetic fixtures. It catches defects but cannot prove a transition is pleasant.
- **Unblocks.** Safe parameter tuning, A/B comparison of stretch engines and analyzers, and calibration once S10 listening exists.

**Increment 5: optional analysis sidecar.**
- **Scope.**
  - A versioned JSON schema: content hash, analyzer and model checksum, beats, downbeats, segments with labels, and confidences.
  - Producers:
    - Beat This! via Python, or the ONNX export via onnxruntime-node or web;
    - optionally All-In-One, as an experiment only.
  - Run the neural pass only when the DSP tracker reports low confidence.
  - The browser treats a missing or invalid sidecar as "use DSP".
- **Checks.**
  - The hash must match, and a changed audio file invalidates the sidecar.
  - Fixture beats and downbeats must be within tolerance.
  - A malformed sidecar falls back to DSP.
  - Playback never depends on the sidecar.
- **Main risk.** Neural models may not beat the DSP on AI-generated material. All-In-One adds Demucs, NATTEN and checkpoint-licence audit cost.
- **Unblocks.** Real section labels (chorus, verse, outro), raising phrase confidence above the 0.5 cap.

**Increment 6: Signalsmith WASM (6A), then optional stems (6B).**
- **6A scope.** An Emscripten buffer-in/buffer-out worker and Node wrapper. It replaces WSOLA only if the evaluator and objective measurements show a gain.
- **6A checks.**
  - Duration matches the ratio.
  - No NaN or Inf.
  - Node and Chromium agree within tolerance.
  - CPU time is recorded.
  - The main thread does not block.
- **6B scope.** Offline Demucs or a MIT RoFormer checkpoint run on owner-local packs only. Recipes: vocal-out before vocal-in, then drums-first.
- **6B checks.**
  - Four stems with identical length and rate.
  - The reconstruction residual is recorded.
  - Disabling stems leaves the crossfade unchanged.
- **Main risk.** Separation artifacts and memory (about 264 MiB per decoded 3-minute track) outweigh the benefit for short soundtrack tracks.
- **Unblocks.** Drums-first and vocal-aware handovers.

**Echo-out recipe for increment 3.** These are engineering starting points [U]. The timing pattern (activate echo on the last one or two beats, stop the source before the next downbeat, let the tail ring) is attributed by ChatGPT to a Yamaha DJ mixer manual [U].

Graph: A's source splits into two paths.
- The dry path goes through A's channel gain to the master bus.
- The send goes through sendGain, then DelayNode (delayTime = 60/BPM_A × division), then a lowpass filter, then feedbackGain, which loops back into the DelayNode. The delay output goes through wetGain to the master bus.
- The wet return must **not** pass through A's channel gain.
- `delayTime` is **a-rate** in the current W3C spec **[V]**. This corrects ChatGPT's earlier k-rate claim; in a feedback cycle it is clamped to at least one render quantum **[V]**.

| Parameter | Conservative (default) | Pronounced |
| --- | --- | --- |
| Send gain | 0.25 | 0.40 |
| Feedback | 0.30 | 0.45 |
| Feedback-loop low-pass filter | 5 kHz | 3.5 kHz |
| Delay division | 1/2 beat (250 ms at 120 BPM); 1 beat for a more spacious tail | 3/4 beat (375 ms), stylistic |
| Dry fade at handover | 100-200 ms | 100-200 ms |
| Tail budget | about 2 bars | about 4 bars |

Repeat amplitude follows g^n: at g = 0.4 the fifth repeat is about 1%.

Schedule, with T = A's phrase boundary (its next downbeat):
1. Open the send over the final 1-2 bars, or step it up on the last one or two beats.
2. Ramp A's dry gain to 0 over T − 0.15 s to T.
3. Close the send at T.
4. **Start B at its own downbeat at T** ("Variant A": simplest, recommended first).
5. Hold wetGain, then ramp it to 0 by T + tail.
6. Disconnect the delay network only after the tail has decayed.

A variant that starts B quietly 250-500 ms early suits only atmospheric or drum-only openings.

Decision policy, from ChatGPT round 3, which I endorse:

| Timing confidence | Key confidence | Recipe |
| --- | --- | --- |
| Good | Poor | Echo-out or cut |
| Poor | Any | Authored crossfade. A beat-synced echo at the wrong tempo octave sounds wrong; a fixed-seconds echo is a different, non-synced effect. |

Prefer a **cut** when:
- A ends on a clean transient;
- B has a strong standalone opening;
- the material is tonally incompatible.

Prefer an **echo** when A has a vocal or melodic tail and its last transient is clean. Avoid echo on:
- dense sustained chords;
- already-wet sources;
- a B that opens with a prominent vocal.

Cut ramps are 5-20 ms complementary ramps [U]. **Do not invent a phrase boundary when there is no reliable structure.**

---

## 7. Open questions

1. Is the All-In-One checkpoint under the same MIT terms as its code? Its weights come from the hub, and the model card was not checked.
2. Do the Demucs and Mel-RoFormer checkpoints allow even private use with output kept locally? Separating stems for owner-local packs is probably fine, but publishing stems is not.
3. How well does ACE-Step actually hit the requested BPM, key and section lengths on this owner's real outputs? Measure with the branch analyzer and Beat This! on 20-50 generated tracks; no published numbers exist.
4. Should the browser ever run Beat This! (ONNX/WebGPU)? This only matters if arbitrary user-loaded files become a feature. The pack contract currently makes the offline sidecar sufficient.
5. Signalsmith via a custom Emscripten build: is bit-identity between Node and Chromium achievable, which the branch tests prefer, or should the tests use tolerances?
6. Which evaluator thresholds correlate with owner judgments? This needs the deferred S10 listening pass: a small labeled set of good, acceptable and bad transitions.
7. For a *work soundtrack*, should the planner prefer fewer, gentler transitions (echo-outs, short blends) over club-style long blends? This is a product decision for the owner.

---

## 8. Sources

Verified directly ([V]):
- Beat This! repo, LICENSE (MIT) and README (weights MIT, model sizes): https://github.com/CPJKU/beat_this, https://raw.githubusercontent.com/CPJKU/beat_this/main/LICENSE
- Beat This! ONNX for onnxruntime-web (third party, MIT): https://huggingface.co/musetric/beat-this-onnx
- All-In-One LICENSE (MIT), pyproject (demucs dependency), README (NATTEN, madmom, 4090 timing), madmom DBN use in `postprocessing/metrical.py`: https://github.com/mir-aidj/all-in-one
- madmom LICENSE (BSD code; CC BY-NC-SA 4.0 models): https://raw.githubusercontent.com/CPJKU/madmom/main/LICENSE
- Demucs LICENSE (MIT), archived 2025-01-01, model notes: https://github.com/facebookresearch/demucs
- Signalsmith Stretch web release README: https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/release/README.md
- Vande Veire and De Bie 2018, EURASIP JASMP: https://asmp-eurasipjournals.springeropen.com/articles/10.1186/s13636-018-0134-8 ; repo COPYRIGHT: https://github.com/lenvdv/auto-dj
- Kim et al., ISMIR 2020: https://arxiv.org/abs/2008.10267
- Chen et al., ICASSP 2022: https://arxiv.org/abs/2110.06525
- Zehren et al.: https://arxiv.org/abs/2007.08411

Partly verified via search results quoting primary pages ([P]):
- Essentia licensing (AGPL-3.0, models CC BY-NC-ND): https://essentia.upf.edu/licensing_information.html
- Rubber Band licensing (GPL or commercial): https://breakfastquay.com/rubberband/license.html ; rubberband-wasm (GPL-2.0): https://github.com/Daninet/rubberband-wasm
- SoundTouchJS relicensing to MPL-2.0 (newer packages): https://www.pkgstats.com/pkg:@soundtouchjs/core
- rekordbox phrase analysis labels (Intro, Up, Down, Chorus, Bridge, Verse, Outro): https://rekordbox.com/en/feature/djing/ and the user guide
- djay Automix and Neural Mix: https://help.algoriddim.com/user-manual/djay-pro-mac/mixing-basics/automix
- ACE-Step 1.5 (MIT; BPM, key and time-signature controls): https://arxiv.org/abs/2602.00744
- Mel-RoFormer MIT checkpoint mirror: https://huggingface.co/audiojs/mel-roformer
- MDN AudioBufferSourceNode loop attributes: https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/loopEnd
- Demucs throughput blogs (inconsistent): https://docs.clore.ai/guides/audio-and-voice/demucs-separation , https://stemsplit.io/blog/demucs-local-setup-guide

- W3C Web Audio API, DelayNode (delayTime is a-rate; clamped to at least one render quantum in cycles) **[V]**: https://www.w3.org/TR/webaudio/#DelayNode
- Zehren DOI redirect **[V]**: https://doi.org/10.1162/comj_a_00652

Unverified ([U]), ChatGPT claims only:
- The ONNX export is about 20.25M parameters and about 190.6 MB, with a static-graph rewrite that ChatGPT says fixes the Adreno failures.
- The `All-In-One-Infer` and `madmom-infer` reimplementations exist.
- The Yamaha DJX-II manual describes the echo-out timing.
- Zehren's 0.4 × max harmonic-energy salience threshold.
- Vande Veire's 16/32-measure double-drop timings.
- Signalsmith default block/interval values and useful range.
- The A100 Demucs timings.
- All genre transition-length tables.
- All metric thresholds.
- That ACE-Step docs quote "120 BPM may give 118-122".
- The python-audio-separator license.
- librosa ISC: widely known, not rechecked in this session.
