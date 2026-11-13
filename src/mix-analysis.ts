/**
 * Original deterministic, bounded music-analysis heuristics (no runtime dependency).
 * Constant tempo and 4/4 are hypotheses, not an inferred time-signature contract.
 * Confidence is engineering evidence strength, never a calibrated probability.
 */
export interface MixPcm {
  readonly sampleRate: number;
  readonly channels: readonly (Float32Array | Float64Array)[];
}
export const MIX_ANALYSIS_VERSION = 'mix-analysis-v3' as const;
export const MIX_ANALYSIS_LIMITS = Object.freeze({
  minSampleRate: 8000, maxSampleRate: 192000, maxSeconds: 180,
  maxChannelSamples: 16_777_216, minBpm: 60, maxBpm: 180,
});
export interface TempoCandidate {
  readonly bpm: number;
  /** Ranked evidence score, not a probability. */
  readonly strength: number;
  readonly correlation: number;
  readonly gridCoverage: number;
  readonly gridStrength: number;
  readonly subdivisionContrast: number;
  readonly lowPeriodicity: number;
  readonly backbeat: number;
  readonly driftSeconds: number;
  readonly hintSupport: number;
}
export interface TempoEstimate {
  readonly bpm: number | null;
  readonly confidence: number;
  /** Higher means the best tempo has a close, materially different rival. */
  readonly ambiguity: number;
  readonly candidates: readonly TempoCandidate[];
  /** Compatibility summary of the leading candidates. */
  readonly alternatives: readonly {bpm: number; strength: number}[];
  readonly status: 'estimated' | 'insufficient-rhythm';
}
export interface VocalSpan {
  /** Supplied source-buffer frame interval [startFrame, endFrame); never detected here. */
  readonly startFrame: number;
  readonly endFrame: number;
}
export interface CueBarFeatures {
  readonly frame: number;
  readonly endFrame: number;
  readonly lowOnsets: number;
  readonly midFlux: number;
  readonly highFlux: number;
  readonly rms: number;
  readonly harmonicEnergy: number;
  readonly chroma: readonly number[];
}
export interface CueEvidence {
  readonly kind: 'boundary' | 'low-interference' | 'track-start';
  readonly boundary: number;
  readonly period: number;
  readonly salience: number;
  readonly windowEndFrame: number;
  /** Relative energy only; does not mean instrumental or vocal-free. */
  readonly interference: number;
  readonly chroma: readonly number[];
}
export interface MixAnalysisOptions {
  /** Requested generation tempo: weak evidence only, never a fixed grid. */
  readonly generationBpm?: number;
  readonly vocalSpans?: readonly VocalSpan[];
}
export interface KeyCandidate {
  readonly tonic: number;
  readonly mode: 'major' | 'minor';
  readonly name: string;
  readonly score: number;
}
export interface KeyEstimate {
  readonly tonic: number | null;
  readonly mode: 'major' | 'minor' | null;
  readonly name: string | null;
  readonly confidence: number;
  readonly chroma: readonly number[];
  readonly alternatives: readonly KeyCandidate[];
  readonly status: 'estimated' | 'ambiguous';
}
export interface MixPointCandidate {
  readonly evidence?: CueEvidence;
  readonly frame: number;
  readonly seconds: number;
  readonly score: number;
  readonly confidence: number;
  readonly reasons: readonly string[];
}
export interface EnergyPoint {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly rms: number;
  readonly dbfs: number | null;
  readonly lowRms: number;
}
export interface MixAnalysis {
  readonly version: typeof MIX_ANALYSIS_VERSION;
  readonly sampleRate: number;
  readonly frames: number;
  readonly tempo: TempoEstimate;
  readonly beatGrid: {readonly frames: readonly number[]; readonly confidence: number; readonly maxFitErrorSeconds: number | null};
  readonly structure: {
    readonly meter: readonly [4, 4];
    readonly assumed: true;
    readonly downbeatFrames: readonly number[];
    readonly downbeatConfidence: number;
    readonly phraseFrames: readonly number[];
    readonly phraseConfidence: number;
    readonly phraseBars: 4;
  };
  readonly key: KeyEstimate;
  readonly energyCurve: readonly EnergyPoint[];
  /** Complete measured downbeat intervals; optional for legacy/controlled analyses. */
  readonly cueFeatures?: readonly CueBarFeatures[];
  readonly vocalSpans?: readonly VocalSpan[];
  readonly mixIn: readonly MixPointCandidate[];
  readonly mixOut: readonly MixPointCandidate[];
  readonly limitations: readonly string[];
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
/** Engineering starting points for the tempo octave rule, not calibrated values. */
const TEMPO_OCTAVE = Object.freeze({emptyHalfBeat: 0.2, topBackbeat: 0.15, doubledCoverage: 0.35, hintSupport: 0.5,
  hintedAmbiguity: 0.35, undecidedAmbiguity: 0.6});
const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

function validate(input: MixPcm): number {
  const {sampleRate, channels} = input;
  if (!Number.isInteger(sampleRate) || sampleRate < MIX_ANALYSIS_LIMITS.minSampleRate ||
      sampleRate > MIX_ANALYSIS_LIMITS.maxSampleRate || channels.length < 1 || channels.length > 2) {
    throw new Error('Mix analysis requires mono/stereo PCM at an integer 8–192 kHz sample rate.');
  }
  const frames = channels[0]!.length;
  if (!frames || frames / sampleRate > MIX_ANALYSIS_LIMITS.maxSeconds ||
      frames * channels.length > MIX_ANALYSIS_LIMITS.maxChannelSamples ||
      channels.some(c => !(c instanceof Float32Array || c instanceof Float64Array) || c.length !== frames)) {
    throw new Error('Mix analysis requires equal nonempty channels, at most 180 seconds and 16,777,216 channel samples.');
  }
  for (const channel of channels) for (const x of channel) {
    if (!Number.isFinite(x) || Math.abs(x) > 16) throw new Error('Mix analysis refuses non-finite PCM or sample magnitude above 16.');
  }
  return frames;
}

/** Per-channel energy prevents opposite-polarity stereo from disappearing in a downmix. */
function features(input: MixPcm, frames: number) {
  const rate = input.sampleRate, hop = Math.max(1, Math.round(rate / 200));
  const bins = Math.ceil(frames / hop), rms = new Float64Array(bins), low = new Float64Array(bins);
  const lowStates = new Float64Array(input.channels.length), alpha = 1 - Math.exp(-2 * Math.PI * 180 / rate);
  const energyCurve: EnergyPoint[] = [], energyWindow = Math.round(rate * 0.25);
  let sum = 0, lowSum = 0, energyStart = 0;
  for (let i = 0; i < frames; i++) {
    let power = 0, lowPower = 0;
    for (let ch = 0; ch < input.channels.length; ch++) {
      const x = input.channels[ch]![i]!;
      const filtered = lowStates[ch]! + alpha * (x - lowStates[ch]!);
      lowStates[ch] = filtered;
      power += x * x / input.channels.length;
      lowPower += filtered * filtered / input.channels.length;
    }
    const bin = Math.floor(i / hop);
    rms[bin] = rms[bin]! + power;
    low[bin] = low[bin]! + lowPower;
    sum += power; lowSum += lowPower;
    if (i + 1 - energyStart === energyWindow || i + 1 === frames) {
      const count = i + 1 - energyStart, mean = sum / count;
      energyCurve.push({startFrame: energyStart, endFrame: i + 1, rms: Math.sqrt(mean),
        dbfs: mean > 0 ? 10 * Math.log10(mean) : null, lowRms: Math.sqrt(lowSum / count)});
      sum = 0; lowSum = 0; energyStart = i + 1;
    }
  }
  for (let i = 0; i < bins; i++) {
    const count = Math.min(hop, frames - i * hop);
    rms[i] = Math.sqrt(rms[i]! / count);
    low[i] = Math.sqrt(low[i]! / count);
  }
  return {hop, rms, low, ...spectralNovelty(input, frames, hop), energyCurve};
}

/** Positive spectral change at 8 kHz with channel powers combined, not waveforms.
 * A box average bounds the analysis rate. This is not the playback resampler.
 * Centered 64 ms Hann windows / approximately 5 ms hop retain a small timing bias.
 */
function spectralNovelty(input: MixPcm, frames: number, inputHop: number) {
  const analysisRate = 8000, size = 512, bins = size / 2 + 1;
  const length = Math.ceil(frames * analysisRate / input.sampleRate);
  const reduced = input.channels.map(channel => {
    const out = new Float64Array(length);
    for (let i = 0; i < length; i++) {
      const first = Math.floor(i * input.sampleRate / analysisRate);
      const end = Math.min(frames, Math.max(first + 1, Math.floor((i + 1) * input.sampleRate / analysisRate)));
      let sum = 0;
      for (let j = first; j < end; j++) sum += channel[j]!;
      out[i] = sum / (end - first);
    }
    return out;
  });
  const novelty = new Float64Array(Math.ceil(frames / inputHop)), previous = new Float64Array(bins);
  const window = Float64Array.from({length: size}, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  const midFlux = new Float64Array(novelty.length), highFlux = new Float64Array(novelty.length);
  const chroma = new Float64Array(novelty.length * 12), harmonicEnergy = new Float64Array(novelty.length);
  let maximum = 0;
  for (let frame = 0; frame < novelty.length; frame++) {
    const start = Math.round(frame * inputHop * analysisRate / input.sampleRate) - size / 2;
    const power = new Float64Array(bins);
    for (const channel of reduced) {
      const re = new Float64Array(size), im = new Float64Array(size);
      for (let i = 0; i < size; i++) re[i] = (channel[start + i] ?? 0) * window[i]!;
      fft(re, im);
      for (let bin = 1; bin < bins; bin++) power[bin] = power[bin]! +
        (re[bin]! ** 2 + im[bin]! ** 2) / input.channels.length;
    }
    let value = 0;
    for (let bin = 1; bin < bins; bin++) {
      const energy = Math.log1p(50 * Math.sqrt(power[bin]!) / size);
      const flux = Math.max(0, energy - previous[bin]!);
      value += flux;
      const frequency = bin * analysisRate / size;
      if (frequency >= 180 && frequency < 2000) midFlux[frame] = midFlux[frame]! + flux;
      if (frequency >= 2000) highFlux[frame] = highFlux[frame]! + flux;
      if (frequency >= 100 && frequency <= 2000 && bin + 1 < bins &&
          power[bin]! > power[bin - 1]! && power[bin]! >= power[bin + 1]!) {
        const left = Math.log(Math.max(1e-30, power[bin - 1]!));
        const center = Math.log(Math.max(1e-30, power[bin]!));
        const right = Math.log(Math.max(1e-30, power[bin + 1]!));
        const curvature = left - 2 * center + right;
        const shift = curvature ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature))) : 0;
        const midi = Math.round(69 + 12 * Math.log2((bin + shift) * analysisRate / (size * 440)));
        const pc = ((midi % 12) + 12) % 12;
        const magnitude = Math.sqrt(power[bin]!) / size;
        chroma[frame * 12 + pc] = chroma[frame * 12 + pc]! + magnitude;
        harmonicEnergy[frame] = harmonicEnergy[frame]! + magnitude;
      }
      previous[bin] = energy;
    }
    novelty[frame] = value; maximum = Math.max(maximum, value);
  }
  if (maximum > 0) for (let i = 0; i < novelty.length; i++) novelty[i] = Math.sqrt(novelty[i]! / maximum);
  return {novelty, midFlux, highFlux, chroma, harmonicEnergy};
}

interface Fit {period: number; phase: number; coverage: number; strength: number; maxError: number}
function gridResidual(values: Float64Array, phase: number, period: number, radius: number): number {
  let maxError = 0;
  for (let at = phase; at < values.length; at += period) {
    let index = Math.max(0, Math.min(values.length - 1, Math.round(at))), peak = values[index]!;
    for (let i = Math.max(0, Math.round(at) - radius); i <= Math.min(values.length - 1, Math.round(at) + radius); i++) {
      if (values[i]! > peak) {peak = values[i]!; index = i;}
    }
    if (peak >= 0.16) maxError = Math.max(maxError, Math.abs(index - at));
  }
  return maxError;
}
function fitGrid(values: Float64Array, initialPeriod: number): Fit {
  let period = initialPeriod, phase = 0, best = -Infinity;
  const radius = Math.min(6, Math.round(period * 0.08));
  // First establish phase on the full clip, then regress nearby onsets to remove
  // quantization drift. The grid stays strictly constant-tempo.
  for (let offset = 0; offset < period; offset++) {
    let score = 0, count = 0;
    for (let at = offset; at < values.length; at += period) {
      const i = Math.round(at);
      score += values[Math.min(i, values.length - 1)]!; count++;
    }
    score /= Math.max(1, count);
    if (score > best) { best = score; phase = offset; }
  }
  let coverage = 0, strength = 0, maxError = 0;
  for (let pass = 0; pass < 3; pass++) {
    const points: {x: number; y: number; w: number}[] = [];
    let expected = 0;
    for (let beat = 0, at = phase; at < values.length; beat++, at = phase + beat * period) {
      if (at < 0) continue;
      expected++;
      let index = Math.max(0, Math.min(values.length - 1, Math.round(at))), peak = values[index]!;
      for (let i = Math.max(0, Math.round(at) - radius); i <= Math.min(values.length - 1, Math.round(at) + radius); i++) {
        if (values[i]! > peak) { peak = values[i]!; index = i; }
      }
      if (peak >= 0.16) points.push({x: beat, y: index, w: peak});
    }
    coverage = points.length / Math.max(1, expected);
    strength = points.reduce((a, p) => a + p.w, 0) / Math.max(1, expected);
    if (points.length < 4) break;
    const total = points.reduce((a, p) => a + p.w, 0);
    const xMean = points.reduce((a, p) => a + p.w * p.x, 0) / total;
    const yMean = points.reduce((a, p) => a + p.w * p.y, 0) / total;
    let numerator = 0, denominator = 0;
    for (const p of points) {
      numerator += p.w * (p.x - xMean) * (p.y - yMean);
      denominator += p.w * (p.x - xMean) ** 2;
    }
    const next = numerator / denominator;
    if (!Number.isFinite(next) || Math.abs(next / initialPeriod - 1) > 0.04) break;
    period = next; phase = yMean - period * xMean;
    maxError = Math.max(...points.map(p => Math.abs(p.y - phase - p.x * period)));
  }
  while (phase < -0.5) phase += period;
  while (phase >= period) phase -= period;
  phase = Math.max(0, phase);
  // Measure residual on the final grid even when regression had too few points
  // or was rejected. A zero residual must not mean "unmeasured".
  maxError = gridResidual(values, phase, period, radius);
  return {period, phase, coverage, strength, maxError};
}

/** Positive envelope change emphasizes kick attacks without treating sustained bass as a beat. */
function onsetEnvelope(values: Float64Array): Float64Array {
  const out = new Float64Array(values.length);
  let maximum = 0, smoothed = 0, previous = 0;
  // A 20 ms envelope suppresses individual bass-wave cycles before differencing.
  for (let i = 0; i < values.length; i++) {
    smoothed += 0.25 * (values[i]! - smoothed);
    out[i] = Math.max(0, smoothed - previous);
    previous = smoothed;
    maximum = Math.max(maximum, out[i]!);
  }
  if (maximum > 0) for (let i = 0; i < out.length; i++) out[i] = out[i]! / maximum;
  return out;
}

function peakNear(values: Float64Array, at: number, radius: number): number {
  let peak = 0;
  for (let i = Math.max(0, Math.round(at) - radius); i <= Math.min(values.length - 1, Math.round(at) + radius); i++) {
    peak = Math.max(peak, values[i]!);
  }
  return peak;
}

function estimateTempo(values: Float64Array, low: Float64Array, rms: Float64Array,
    hop: number, rate: number, generationBpm?: number) {
  const empty = {tempo: {bpm: null, confidence: 0, ambiguity: 0, candidates: [],
    alternatives: [], status: 'insufficient-rhythm'} as TempoEstimate,
    frames: [] as number[], fitError: null as number | null};
  const seconds = values.length * hop / rate;
  if (seconds < 4) return empty;
  let strongPeaks = 0;
  for (let i = 1; i + 1 < values.length; i++) if (values[i]! >= 0.16 &&
    values[i]! > values[i - 1]! && values[i]! >= values[i + 1]!) strongPeaks++;
  if (strongPeaks < 7) return empty;
  const minLag = Math.floor(rate * 60 / (hop * MIX_ANALYSIS_LIMITS.maxBpm));
  const maxLag = Math.ceil(rate * 60 / (hop * MIX_ANALYSIS_LIMITS.minBpm));
  const correlations = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let numerator = 0, a = 0, b = 0;
    for (let i = lag; i < values.length; i++) {
      const x = values[i]!, y = values[i - lag]!;
      numerator += x * y; a += x * x; b += y * y;
    }
    correlations[lag] = a * b > 0 ? numerator / Math.sqrt(a * b) : 0;
  }
  const peaks: {lag: number; correlation: number}[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (correlations[lag]! < correlations[lag - 1]! || correlations[lag]! < correlations[lag + 1]!) continue;
    const a = correlations[lag - 1]!, b = correlations[lag]!, c = correlations[lag + 1]!;
    const curvature = a - 2 * b + c;
    const delta = curvature !== 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * curvature))) : 0;
    peaks.push({lag: lag + delta, correlation: b});
  }
  peaks.sort((a, b) => b.correlation - a.correlation || a.lag - b.lag);
  // Keep nearby autocorrelation peaks, and explicitly test both octave relatives.
  const hypotheses = peaks.slice(0, 16);
  for (const peak of peaks.slice(0, 5)) for (const octave of [0.5, 2]) {
    const lag = peak.lag * octave, bpm = 60 * rate / (hop * lag);
    if (bpm >= MIX_ANALYSIS_LIMITS.minBpm - 0.5 && bpm <= MIX_ANALYSIS_LIMITS.maxBpm + 0.5) {
      hypotheses.push({lag, correlation: correlations[Math.round(lag)] ?? 0});
    }
  }
  const lowOnsets = onsetEnvelope(low);
  const high = Float64Array.from(rms, (x, i) => Math.sqrt(Math.max(0, x * x - low[i]! * low[i]!)));
  const highOnsets = onsetEnvelope(high);
  const radius = Math.max(2, Math.round(0.035 * rate / hop));
  const candidates: {report: TempoCandidate; fit: Fit; halfBeatEmpty: boolean}[] = [];
  for (const hypothesis of hypotheses) {
    let fit = fitGrid(values, hypothesis.lag);
    const measured = 60 * rate / (hop * fit.period);
    if (measured < MIX_ANALYSIS_LIMITS.minBpm - 0.5 || measured > MIX_ANALYSIS_LIMITS.maxBpm + 0.5) continue;
    const bpm = Math.max(MIX_ANALYSIS_LIMITS.minBpm, Math.min(MIX_ANALYSIS_LIMITS.maxBpm, measured));
    if (bpm !== measured) {
      const boundedPeriod = 60 * rate / (hop * bpm);
      fit = {...fit, period: boundedPeriod,
        maxError: gridResidual(values, fit.phase, boundedPeriod,
          Math.min(6, Math.round(boundedPeriod * 0.08)))};
    }
    const on: number[] = [], off: number[] = [], snare: number[] = [], snareOff: number[] = [];
    const pulse: number[] = [], subdivision: number[] = [];
    for (let beat = 0, at = fit.phase; at < values.length; beat++, at = fit.phase + beat * fit.period) {
      on.push(peakNear(lowOnsets, at, radius));
      off.push(peakNear(lowOnsets, at + fit.period / 2, radius));
      snare.push(peakNear(highOnsets, at, radius));
      snareOff.push(peakNear(highOnsets, at + fit.period / 2, radius));
      pulse.push(peakNear(values, at, radius));
      subdivision.push(peakNear(values, at + fit.period / 2, radius));
    }
    const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    const onMean = mean(on), offMean = mean(off);
    const occupied = on.filter(x => x >= 0.25).length / Math.max(1, on.length);
    const lowPeriodicity = onMean > 0.01 ? clamp(onMean / (onMean + offMean + 1e-9) * occupied) : 0;
    const subdivisionContrast = mean(pulse) / (mean(pulse) + mean(subdivision) + 1e-9);
    const phases = Array.from({length: 4}, (_, phase) => mean(snare.filter((_, i) => i % 4 === phase)));
    const snareTotal = phases.reduce((a, b) => a + b, 0);
    let backbeat = 0;
    if (snareTotal > 0.01) for (let phase = 0; phase < 4; phase++) {
      backbeat = Math.max(backbeat, clamp((phases[(phase + 1) % 4]! + phases[(phase + 3) % 4]! -
        phases[phase]! - phases[(phase + 2) % 4]!) / snareTotal));
    }
    // Half-beat content in both bands. A pulse whose half-beats are empty in both bands has no
    // evidence that separates it from its double-tempo relative: one hit per beat at X BPM and
    // hits on alternate beats at 2X BPM are the same audio.
    const halfBeatEmpty = offMean < TEMPO_OCTAVE.emptyHalfBeat * onMean &&
      mean(snareOff) < TEMPO_OCTAVE.emptyHalfBeat * mean(snare);
    const driftSeconds = fit.maxError * hop / rate;
    const drift = clamp(1 - driftSeconds / Math.max(0.02, 0.08 * 60 / bpm));
    const hintSupport = generationBpm === undefined ? 0 :
      Math.exp(-0.5 * (Math.log2(bpm / generationBpm) / 0.06) ** 2);
    // Subdivision flux is informative only when low-band beats support that grid;
    // otherwise double hats can make a sparse half-time groove look falsely certain.
    const pulseEvidence = lowPeriodicity >= 0.4 ? clamp(2 * subdivisionContrast - 1) : 0;
    const strength = 0.15 * hypothesis.correlation + 0.10 * fit.coverage * fit.strength +
      0.40 * lowPeriodicity + 0.05 * backbeat + 0.10 * drift +
      0.20 * pulseEvidence + 0.04 * hintSupport;
    candidates.push({report: {bpm, strength, correlation: hypothesis.correlation,
      gridCoverage: fit.coverage, gridStrength: fit.strength, subdivisionContrast,
      lowPeriodicity, backbeat, driftSeconds, hintSupport}, fit, halfBeatEmpty});
  }
  candidates.sort((a, b) => b.report.strength - a.report.strength || a.report.bpm - b.report.bpm);
  const uniqueCandidates = candidates.filter((candidate, i) => !candidates.slice(0, i).some(
    earlier => Math.abs(Math.log2(earlier.report.bpm / candidate.report.bpm)) < 0.003));
  const top = uniqueCandidates[0];
  if (!top || top.report.correlation < 0.25 || top.fit.coverage < 0.5) return empty;
  // Octave rule: when the top reading's half-beats are empty in both bands and its double-tempo
  // relative also fits, the audio cannot tell the two apart (claps on 2 and 4 alone read as a
  // pulse at half speed). Report that as ambiguity instead of a confident octave. A generation
  // BPM hint that matches the double-tempo reading chooses it, with moderate ambiguity left.
  const doubled = uniqueCandidates.find(c => Math.abs(Math.log2(c.report.bpm / top.report.bpm) - 1) < 0.02);
  // The doubled grid's own autocorrelation is low by construction (its odd beats are empty), so
  // only its grid coverage is required: it must land on the hits the top reading found.
  // A backbeat on the top reading (accents alternating between its beats) is metrical evidence
  // for it, so only identical, unaccented hits count as undecided.
  const octaveUndecided = doubled !== undefined && top.halfBeatEmpty &&
    top.report.backbeat < TEMPO_OCTAVE.topBackbeat &&
    doubled.fit.coverage >= TEMPO_OCTAVE.doubledCoverage;
  const hintPicksDoubled = octaveUndecided && doubled.report.hintSupport >= TEMPO_OCTAVE.hintSupport &&
    doubled.report.hintSupport > top.report.hintSupport;
  const chosen = hintPicksDoubled ? doubled : top;
  const rival = octaveUndecided ? (hintPicksDoubled ? top : doubled) :
    uniqueCandidates.find(c => Math.abs(Math.log2(c.report.bpm / chosen.report.bpm)) >= 0.04);
  const margin = rival ? (chosen.report.strength - rival.report.strength) / Math.max(0.1, chosen.report.strength) : 1;
  // Ambiguity follows the reported score margin; the prior can shift that margin only weakly.
  const marginAmbiguity = rival ? clamp(1 - margin / 0.18) : 0;
  const ambiguity = !octaveUndecided ? marginAmbiguity :
    hintPicksDoubled ? TEMPO_OCTAVE.hintedAmbiguity : Math.max(marginAmbiguity, TEMPO_OCTAVE.undecidedAmbiguity);
  // A metrical tie must also lower the legacy scalars read by barGrid.
  // Quadratic attenuation preserves clear positives; a complete tie caps at 0.35.
  const confidence = clamp((0.5 * chosen.report.correlation + 0.5 * chosen.fit.coverage) *
    (0.7 + 0.3 * chosen.report.lowPeriodicity) * (1 - 0.65 * ambiguity ** 2) *
    Math.min(1, seconds / 8));
  const frames: number[] = [];
  for (let i = 0; ; i++) {
    const frame = Math.round((chosen.fit.phase + i * chosen.fit.period) * hop);
    if (frame >= values.length * hop) break;
    frames.push(frame);
  }
  const ranked = uniqueCandidates.map(c => c.report);
  return {tempo: {bpm: chosen.report.bpm, confidence, ambiguity, candidates: ranked,
    alternatives: ranked.slice(0, 5).map(c => ({bpm: c.bpm, strength: c.strength})),
    status: 'estimated'} as TempoEstimate, frames, fitError: chosen.report.driftSeconds};
}

/** Original radix-2 complex FFT used only outside playback. */
function fft(real: Float64Array, imag: Float64Array): void {
  const length = real.length;
  let j = 0;
  for (let i = 1; i < length; i++) {
    let bit = length / 2;
    while (j & bit) { j ^= bit; bit /= 2; }
    j ^= bit;
    if (j > i) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [imag[i], imag[j]] = [imag[j]!, imag[i]!];
    }
  }
  for (let span = 2; span <= length; span *= 2) {
    const half = span / 2, turn = -2 * Math.PI / span;
    const stepR = Math.cos(turn), stepI = Math.sin(turn);
    for (let base = 0; base < length; base += span) {
      let c = 1, s = 0;
      for (let k = 0; k < half; k++) {
        const a = base + k, b = a + half;
        const r = real[b]! * c - imag[b]! * s, m = real[b]! * s + imag[b]! * c;
        real[b] = real[a]! - r; imag[b] = imag[a]! - m;
        real[a] = real[a]! + r; imag[a] = imag[a]! + m;
        const next = c * stepR - s * stepI;
        s = c * stepI + s * stepR; c = next;
      }
    }
  }
}

function estimateKey(input: MixPcm, frames: number): KeyEstimate {
  const chroma = Array<number>(12).fill(0);
  let size = 1;
  while (size < input.sampleRate / 6) size *= 2;
  size = Math.min(32768, Math.max(2048, size));
  const count = Math.min(96, Math.max(1, Math.ceil(frames / (size / 2))));
  for (let segment = 0; segment < count; segment++) {
    const start = count > 1 ? Math.round(segment * Math.max(0, frames - size) / (count - 1)) : 0;
    for (const channel of input.channels) {
      const re = new Float64Array(size), im = new Float64Array(size);
      for (let i = 0; i < size && start + i < frames; i++) {
        re[i] = channel[start + i]! * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
      }
      fft(re, im);
      const power = new Float64Array(size / 2 + 1);
      let maximum = 0;
      for (let k = 1; k < power.length; k++) {
        power[k] = re[k]! ** 2 + im[k]! ** 2;
        maximum = Math.max(maximum, power[k]!);
      }
      for (let k = 2; k + 1 < power.length; k++) {
        const frequency = k * input.sampleRate / size;
        if (frequency < 65 || frequency > Math.min(4000, input.sampleRate * 0.45) ||
          power[k]! < maximum * 0.0001 || power[k]! <= power[k - 1]! || power[k]! < power[k + 1]!) continue;
        const l = Math.log(Math.max(1e-30, power[k - 1]!)), m = Math.log(Math.max(1e-30, power[k]!));
        const r = Math.log(Math.max(1e-30, power[k + 1]!));
        const shift = Math.max(-0.5, Math.min(0.5, (l - r) / (2 * (l - 2 * m + r))));
        const midi = 69 + 12 * Math.log2((k + shift) * input.sampleRate / (size * 440));
        const nearest = Math.round(midi), error = Math.abs(midi - nearest);
        if (error > 0.35) continue;
        const pc = ((nearest % 12) + 12) % 12;
        chroma[pc] = chroma[pc]! + Math.sqrt(power[k]!) * (1 - error / 0.5);
      }
    }
  }
  const total = chroma.reduce((a, b) => a + b, 0);
  if (total > 0) for (let i = 0; i < chroma.length; i++) chroma[i] = chroma[i]! / total;
  // Original tonic/third/fifth-weighted scale templates, not borrowed profile data/code.
  const templates = {
    major: [1, 0.02, 0.32, 0.02, 0.8, 0.35, 0.02, 0.75, 0.02, 0.32, 0.02, 0.24],
    minor: [1, 0.02, 0.32, 0.8, 0.02, 0.35, 0.02, 0.75, 0.32, 0.02, 0.24, 0.02],
  };
  const norm = Math.sqrt(chroma.reduce((a, x) => a + x * x, 0));
  const alternatives: KeyCandidate[] = [];
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of ['major', 'minor'] as const) {
    const profile = templates[mode], profileNorm = Math.sqrt(profile.reduce((a, x) => a + x * x, 0));
    let score = 0;
    for (let pc = 0; pc < 12; pc++) score += chroma[pc]! * profile[(pc - tonic + 12) % 12]!;
    alternatives.push({tonic, mode, name: NOTES[tonic]! + ' ' + mode, score: norm > 0 ? score / (norm * profileNorm) : 0});
  }
  alternatives.sort((a, b) => b.score - a.score || a.tonic - b.tonic || a.mode.localeCompare(b.mode));
  const first = alternatives[0]!, second = alternatives[1]!;
  const significant = chroma.filter(x => x >= 0.06).length;
  const confidence = total > 0 ? clamp((first.score - second.score) / 0.12) *
    clamp((first.score - 0.55) / 0.35) * clamp((significant - 1) / 2) *
    Math.min(1, frames / input.sampleRate / 4) : 0;
  const estimated = confidence >= 0.08 && significant >= 3;
  return {tonic: estimated ? first.tonic : null, mode: estimated ? first.mode : null,
    name: estimated ? first.name : null, confidence, chroma, alternatives: alternatives.slice(0, 5),
    status: estimated ? 'estimated' : 'ambiguous'};
}

/** Analyze PCM only. An optional requested BPM remains weak evidence, never a reviewed cue. */
export function analyzeMixAudio(input: MixPcm, options: MixAnalysisOptions = {}): MixAnalysis {
  if (options.generationBpm !== undefined && (!Number.isFinite(options.generationBpm) ||
      options.generationBpm <= 0)) {
    throw new Error('Mix analysis requires a finite positive generation BPM hint.');
  }
  const frames = validate(input);
  const vocalSpans = options.vocalSpans ?? [];
  if (vocalSpans.some(span => !Number.isSafeInteger(span.startFrame) || !Number.isSafeInteger(span.endFrame) ||
      span.startFrame < 0 || span.endFrame <= span.startFrame || span.endFrame > frames)) {
    throw new Error('Mix analysis requires bounded source-frame vocal spans.');
  }
  const {hop, rms, low, novelty, midFlux, highFlux, chroma, harmonicEnergy, energyCurve} = features(input, frames);
  const estimate = estimateTempo(novelty, low, rms, hop, input.sampleRate, options.generationBpm);
  const beats = estimate.frames.filter(frame => frame < frames);
  const beatConfidence = estimate.tempo.confidence *
    clamp(1 - (estimate.fitError ?? 0) / 0.25);
  // Low-band attacks nominate beat 1; snare-like high accents on 2/4 support
  // bar parity but cannot distinguish beat 1 from beat 3 by themselves.
  const lowAttacks = onsetEnvelope(low);
  const highAttacks = onsetEnvelope(Float64Array.from(rms,
    (value, i) => Math.sqrt(Math.max(0, value * value - low[i]! * low[i]!))));
  const radius = Math.max(2, Math.round(0.035 * input.sampleRate / hop));
  const accents = beats.map(frame => {
    const at = frame / hop;
    return peakNear(lowAttacks, at, radius);
  });
  const snares = beats.map(frame => peakNear(highAttacks, frame / hop, radius));
  const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const phaseValues = Array.from({length: 4}, (_, phase) => mean(accents.filter((_, i) => i % 4 === phase)));
  const snareValues = Array.from({length: 4}, (_, phase) => mean(snares.filter((_, i) => i % 4 === phase)));
  const phases = Array.from({length: 4}, (_, phase) => ({
    phase, value: phaseValues[phase]! +
      0.12 * (snareValues[(phase + 1) % 4]! + snareValues[(phase + 3) % 4]!) / 2,
  })).sort((a, b) => b.value - a.value || a.phase - b.phase);
  let activeBars = 0, supportingBars = 0;
  for (let i = 0; i + 3 < accents.length; i += 4) {
    const bar = accents.slice(i, i + 4);
    if (Math.max(...bar) < 0.15) continue;
    activeBars++;
    if (bar[phases[0]!.phase]! >= Math.max(...bar) * 0.8) supportingBars++;
  }
  const barSupport = activeBars ? supportingBars / activeBars : 0;
  // A tonal low-band fluctuation can mimic a kick. Require the older low-energy
  // accent contrast to corroborate attack-based phase selection.
  const energyAccents = beats.map(frame => {
    const begin = Math.floor(frame / hop), end = Math.min(low.length, begin + Math.round(0.08 * input.sampleRate / hop));
    let value = 0;
    for (let i = begin; i < end; i++) value += low[i]! ** 2 + 0.25 * rms[i]! ** 2;
    return value / Math.max(1, end - begin);
  });
  const energyPhases = Array.from({length: 4}, (_, phase) =>
    mean(energyAccents.filter((_, i) => i % 4 === phase)));
  const selectedEnergy = energyPhases[phases[0]!.phase]!;
  const rivalEnergy = Math.max(...energyPhases.filter((_, phase) => phase !== phases[0]!.phase));
  const energyContrast = clamp(2 * (selectedEnergy - rivalEnergy) /
    Math.max(1e-20, selectedEnergy));
  const attackContrast = clamp(2 * (phases[0]!.value - phases[1]!.value) /
    Math.max(1e-20, phases[0]!.value));
  let downbeatConfidence = beats.length >= 12 ? beatConfidence *
    Math.min(attackContrast, energyContrast) * (0.75 + 0.25 * barSupport) : 0;
  let firstSupportedBeat = beats.length;
  for (let i = 0; i + 3 < accents.length; i += 4) {
    const bar = accents.slice(i, i + 4);
    // Relative local support retains quieter drums before a later energy rise.
    const supportThreshold = Math.max(0.08, Math.max(...bar) * 0.35);
    if (bar.filter(value => value >= supportThreshold).length >= 2) {
      // A partial first bar may contain attacks on beats 3/4 only. Do not
      // backfill its silent beat 1 using confidence from later bars.
      const selected = i + phases[0]!.phase;
      if (accents[selected]! >= supportThreshold) { firstSupportedBeat = selected; break; }
    }
  }
  if (firstSupportedBeat === beats.length) downbeatConfidence = 0;
  const downbeatFrames = beats.filter((_, i) => i >= firstSupportedBeat && i % 4 === phases[0]!.phase);
  const phraseFrames = downbeatFrames.filter((_, i) => i % 4 === 0);
  const phraseConfidence = 0.5 * downbeatConfidence;
  const maximumEnergy = Math.max(1e-20, ...energyCurve.map(e => e.rms));
  const points = downbeatFrames.map(frame => {
    const e = energyCurve.find(e => e.startFrame <= frame && e.endFrame > frame);
    const relative = frame / frames, quiet = 1 - (e?.rms ?? 0) / maximumEnergy;
    const phrase = phraseFrames.includes(frame);
    const confidence = beatConfidence * (0.25 + 0.75 * downbeatConfidence) * (phrase ? 0.9 : 0.7);
    return {frame, seconds: frame / input.sampleRate, confidence,
      reasons: [phrase ? 'four-bar phrase hypothesis' : '4/4 downbeat hypothesis',
        'constant-tempo audio estimate', 'relative local energy'],
      inScore: (phrase ? 0.35 : 0.1) + 0.4 * (1 - relative) + 0.25 * quiet,
      outScore: (phrase ? 0.35 : 0.1) + 0.4 * relative + 0.25 * quiet};
  });
  const rank = (kind: 'in' | 'out'): MixPointCandidate[] => points
    .filter(p => kind === 'in' ? p.frame < frames * 0.6 : p.frame >= frames * 0.25 && p.frame < frames * 0.9)
    .map(p => ({frame: p.frame, seconds: p.seconds, confidence: p.confidence,
      score: kind === 'in' ? p.inScore : p.outScore, reasons: p.reasons}))
    .sort((a, b) => b.score - a.score || a.frame - b.frame);
  const cueFeatures: CueBarFeatures[] = [];
  const barFrames = estimate.tempo.bpm ? 4 * 60 * input.sampleRate / estimate.tempo.bpm : 0;
  for (let bar = 0; bar < downbeatFrames.length; bar++) {
    const frame = downbeatFrames[bar]!;
    const endFrame = downbeatFrames[bar + 1] ?? Math.round(frame + barFrames);
    if (endFrame > frames || endFrame <= frame) continue;
    const begin = Math.ceil(frame / hop), end = Math.min(rms.length, Math.ceil(endFrame / hop));
    let power = 0, attacks = 0, mid = 0, high = 0, harmonic = 0;
    const localChroma = Array<number>(12).fill(0);
    for (let i = begin; i < end; i++) {
      power += rms[i]! ** 2; attacks += lowAttacks[i]!;
      mid += midFlux[i]!; high += highFlux[i]!; harmonic += harmonicEnergy[i]!;
      for (let pc = 0; pc < 12; pc++) localChroma[pc] = localChroma[pc]! + chroma[i * 12 + pc]!;
    }
    const count = Math.max(1, end - begin), total = localChroma.reduce((a, b) => a + b, 0);
    cueFeatures.push({frame, endFrame, lowOnsets: attacks / count, midFlux: mid / count,
      highFlux: high / count, rms: Math.sqrt(power / count), harmonicEnergy: harmonic / count,
      chroma: localChroma.map(x => total ? x / total : 0)});
  }
  const analysis: MixAnalysis = {version: MIX_ANALYSIS_VERSION, sampleRate: input.sampleRate, frames, tempo: estimate.tempo,
    beatGrid: {frames: beats, confidence: beatConfidence, maxFitErrorSeconds: estimate.fitError},
    structure: {meter: [4, 4], assumed: true, downbeatFrames, downbeatConfidence, phraseFrames,
      phraseConfidence, phraseBars: 4},
    key: estimateKey(input, frames), energyCurve, cueFeatures, vocalSpans: vocalSpans.map(span => ({...span})),
    mixIn: rank('in'), mixOut: rank('out'),
    limitations: [
      'Constant-tempo 60–180 BPM only; octave rivals remain hypotheses even when one ranks first.',
      'Meter is assumed 4/4; accents and four-bar phrases are guesses, not verified structure.',
      'Global equal-tempered major/minor estimate; no chord-region, modulation, vocal or tuning analysis.',
      'Confidence scores are uncalibrated engineering heuristics, not probabilities or listening results.',
      'Real-song detection accuracy outside measured files is unknown.',
    ]};
  return {...analysis, mixIn: findIncomingCues(analysis), mixOut: findOutgoingCues(analysis)};
}

const average = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const insideVocal = (a: MixAnalysis, frame: number) =>
  (a.vocalSpans ?? []).some(span => frame >= span.startFrame && frame < span.endFrame);

/** Downbeat-synchronous, track-normalized feature distances. The bounded
 * checkerboard computes cross-side dissimilarity minus within-side dissimilarity,
 * equivalent to a signed self-similarity kernel without storing a full matrix.
 * These are structural changes, never verse/chorus or vocal labels.
 */
function cueMeasurements(bars: readonly CueBarFeatures[]) {
  const maxima = (['lowOnsets', 'midFlux', 'highFlux', 'rms', 'harmonicEnergy'] as const).map(
    key => Math.max(1e-20, ...bars.map(b => b[key])));
  const vectors = bars.map(b => [b.lowOnsets / maxima[0]!, b.midFlux / maxima[1]!,
    b.highFlux / maxima[2]!, b.rms / maxima[3]!, ...b.chroma]);
  const distance = (a: number, b: number) => {
    const x = vectors[a]!, y = vectors[b]!;
    const scalar = average(x.slice(0, 4).map((value, i) => Math.abs(value - y[i]!)));
    const tonal = x.slice(4).reduce((sum, value, i) => sum + Math.abs(value - y[i + 4]!), 0) / 2;
    return 0.75 * scalar + 0.25 * tonal;
  };
  const boundary = bars.map((_, i) => {
    // No padding, fabricated prehistory or partial kernel at the edges.
    const radius = Math.min(4, i, bars.length - i);
    if (radius < 2) return 0;
    let cross = 0, within = 0, weights = 0;
    for (let l = 0; l < radius; l++) for (let r = 0; r < radius; r++) {
      const w = Math.exp(-(l * l + r * r) / (radius * radius));
      cross += w * distance(i - 1 - l, i + r);
      within += w * (distance(i - 1 - l, i - 1 - r) + distance(i + l, i + r)) / 2;
      weights += w;
    }
    return clamp((cross - within) / weights * 2);
  });
  const activity = bars.map(b => 0.5 * b.rms / maxima[3]! + 0.25 * b.harmonicEnergy / maxima[4]! +
    0.25 * b.lowOnsets / maxima[0]!);
  return {boundary, activity, maxima};
}

/** Evidence-weighted 4/8/16-bar hypotheses, not a hard modulo eligibility gate.
 * Repeated measured boundaries corroborate a period; origin alignment alone
 * earns only a small score and cannot create structural confidence.
 */
function periodScore(boundaries: readonly number[], i: number, confidence: number): number {
  return Math.max(...[4, 8, 16].map(period => {
    const repeats = [-2, -1, 1, 2].map(n => boundaries[i + n * period]).filter(
      (x): x is number => x !== undefined);
    const support = average(repeats) * Math.min(1, repeats.length / 2);
    return confidence * (0.85 * support + (i % period === 0 ? 0.15 : 0));
  }));
}

function findCues(a: MixAnalysis, incoming: boolean): MixPointCandidate[] {
  // The supplied lists remain authoritative allowlists, including a frozen B
  // entry used by replanPreparedMix. Never regenerate a filtered-out cue.
  const supplied = incoming ? a.mixIn : a.mixOut, bars = a.cueFeatures ?? [];
  const eligible = supplied.filter(c => !insideVocal(a, c.frame));
  // Short controlled fixtures retain the legacy grid hypotheses, with their
  // original confidence. Missing intervals in a long track never trigger this path.
  if (!a.cueFeatures || a.frames < 12 * 4 * 60 * a.sampleRate / (a.tempo.bpm ?? 120)) return eligible.slice(0, 12);
  const {boundary, activity, maxima} = cueMeasurements(bars);
  const candidates: MixPointCandidate[] = [];
  for (const base of eligible) {
    const i = bars.findIndex(b => b.frame === base.frame);
    if (i < 0) continue;
    const window = bars.slice(i, i + 4);
    if (window.length !== 4 || window.some((bar, n) => n > 0 && window[n - 1]!.endFrame !== bar.frame)) continue;
    const salience = average(activity.slice(i, i + 4));
    // A full four-bar source window is mandatory for the incoming check.
    if (incoming && salience < 0.18) continue;
    const interference = average(window.map(b => b.rms / maxima[3]!));
    const strength = boundary[i]!;
    const peak = strength >= 0.08 && strength >= (boundary[i - 1] ?? 0) &&
      strength >= (boundary[i + 1] ?? 0);
    const trackStart = incoming && i === 0;
    const valley = interference < 0.4 && (!incoming || salience >= 0.18);
    if (!peak && !valley && !trackStart) continue;
    const period = periodScore(boundary, i, a.structure.downbeatConfidence);
    const kind = peak ? 'boundary' : valley ? 'low-interference' : 'track-start';
    const localChroma = Array.from({length: 12}, (_, pc) => average(window.map(b => b.chroma[pc]!)));
    const evidence: CueEvidence = {kind, boundary: strength, period, salience,
      windowEndFrame: window.at(-1)!.endFrame, interference, chroma: localChroma};
    const score = clamp(0.45 * strength + 0.2 * period + 0.2 * (incoming ? salience : 1 - interference) +
      0.15 * (incoming ? 1 - base.frame / a.frames : base.frame / a.frames));
    // Grid and legacy evidence are upper bounds; novelty cannot rescue poor timing.
    const confidence = Math.min(base.confidence, a.beatGrid.confidence,
      a.structure.downbeatConfidence, trackStart || valley ? 1 : 0.5 + strength / 2);
    candidates.push({...base, score, confidence, evidence,
      reasons: [kind === 'boundary' ? 'measured multifeature checkerboard boundary' :
        kind === 'low-interference' ? 'relative energy valley; vocal activity unknown' : 'supported track entry',
      'confidence-weighted 4/8/16-bar hypotheses', 'complete four-bar source window',
      'track-normalized four-bar activity; no semantic section labels']});
  }
  return candidates.sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.frame - b.frame).slice(0, 12);
}

export function findIncomingCues(analysis: MixAnalysis): MixPointCandidate[] { return findCues(analysis, true); }
export function findOutgoingCues(analysis: MixAnalysis): MixPointCandidate[] { return findCues(analysis, false); }
