/**
 * S15 increment 4: offline rendered-transition evaluator.
 *
 * Node/offline only: the browser page does not import this module (its static module allowlist
 * is unchanged). It renders a candidate transition in plain JavaScript, measures the rendered
 * PCM, and picks the best candidate that does not fail. Measurements are measurements: nothing
 * here hears audio, and passing says only that no configured defect check fired.
 */
import {analyzeAudio} from './audio-analysis.js';
import {analyzeMixAudio, type MixAnalysis, type MixPcm} from './mix-analysis.js';
import {MIX_FILTER_Q_DB, MIX_SHELF_HZ, validateMixAutomation, type MixAutomation,
  type MixAutomationPoint} from './mix-automation.js';
import {automaticMixCandidates, type AutomaticMixPlan, type MixPlannerOptions,
  type MixRecipe} from './mix-planner.js';

export const MIX_EVALUATOR_VERSION = 'transition-evaluator@1' as const;

/**
 * Versioned experimental thresholds. Starting points from the DJ transitions research brief,
 * section 5, adjusted only where noted. They are NOT calibrated against listening (S10).
 */
export const MIX_EVALUATION_THRESHOLDS = Object.freeze({
  version: 'mix-evaluation-thresholds@1',
  status: 'experimental: engineering starting points, not calibrated against listening',
  /** 4x oversampled true peak of the rendered window. */
  truePeakDbtp: Object.freeze({warn: -1, fail: 0}),
  /** Momentary (400 ms) and short-term (3 s) K-weighted loudness against the interpolated target. */
  loudnessLu: Object.freeze({warn: 1, fail: 3}),
  /** 10*log10(E_mix / max(E_A, E_B)) in 25-60, 60-120 and 120-250 Hz over 1 s windows (shorter
   * windows hold too few low-frequency cycles for a stable energy estimate). Two uncorrelated equal
   * signals sum to +3.01 dB and two coherent equal signals to +6.02 dB, so the brief's +3/+6
   * starting points are moved to 3.5/5.5 to separate those cases. */
  lowBuildUpDb: Object.freeze({warn: 3.5, fail: 5.5}),
  /** B beats against A's grid, as a fraction of A's beat period. */
  beatPhase: Object.freeze({warn: 0.05, fail: 0.10}),
  /** Largest positive 3-band log-energy flux per 20 ms frame inside the transition that the
   * unprocessed A and B do not already have at that frame (so a song's own section changes do
   * not count). Judged only for smooth (blend) recipes; a cut or echo is an intended change. */
  boundaryFluxDb: Object.freeze({warn: 6, fail: 12}),
  /** Largest sample step near S/T/E over the 99.9th percentile elsewhere. Judged for every
   * recipe: a click is never intended. */
  sampleJumpRatio: Object.freeze({warn: 4, fail: 8}),
  /** Longest run of 10 ms frames below -60 dBFS while the target is above -50 dBFS. */
  silenceGapMs: Object.freeze({warn: 50, fail: 250}),
  /** Pearson L/R correlation over the transition; strongly negative values are flagged. */
  stereoCorrelation: Object.freeze({warn: -0.5}),
  /** Unprocessed context rendered before S and after E. */
  contextSeconds: 3,
});

/** Everything the renderer needs; `planTransitionSpec` derives it from a planner proposal. */
export interface TransitionSpec {
  readonly recipe: MixRecipe;
  /** A buffer frame heard at S, the outgoing graph start. */
  readonly fromStartFrame: number;
  /** Frames from S to B's entry T (zero for blend and cut). */
  readonly preRollFrames: number;
  /** B frame heard at T. */
  readonly toEntryFrame: number;
  /** B input frames consumed per output frame (fromBpm / toBpm). 1 keeps B native. */
  readonly tempoRatio: number;
  readonly automation: {readonly outgoing: MixAutomation; readonly incoming: MixAutomation};
}

export interface TransitionRender {
  readonly sampleRate: number;
  /** Array indices of S, T and E inside every rendered channel. */
  readonly S: number; readonly T: number; readonly E: number;
  readonly mix: readonly Float64Array[];
  readonly aOut: readonly Float64Array[]; readonly bOut: readonly Float64Array[];
  /** Unprocessed A and B on the same timeline. B holds its own audio before its entry (zero at a
   * track start); loudness and silence targets use B only from T. */
  readonly aNative: readonly Float64Array[]; readonly bNative: readonly Float64Array[];
  /** How B was placed: native PCM, a supplied prepared buffer, or a pitch-changing resample. */
  readonly bSource: 'native' | 'prepared' | 'linear-resample';
}

export type EvaluationMetric = 'automation' | 'truePeak' | 'loudness' | 'lowBuildUp' | 'beatPhase' |
  'boundaryFlux' | 'sampleJump' | 'silenceGap' | 'stereoCorrelation';
export interface EvaluationFlag {
  readonly metric: EvaluationMetric; readonly level: 'warn' | 'fail';
  readonly value: number | null; readonly threshold: number | null; readonly note?: string;
}
export interface TransitionMeasurements {
  readonly truePeakDbtp: number | null;
  readonly loudness: {
    readonly momentaryMaxUpLu: number | null; readonly momentaryMaxDownLu: number | null;
    readonly shortTermMaxUpLu: number | null; readonly shortTermMaxDownLu: number | null;
  };
  readonly lowBuildUp: {readonly maxDb: number | null; readonly band: string | null};
  /** Null when no analyses were supplied or no B beat falls inside the compared window. */
  readonly beatPhase: {readonly maxError: number | null; readonly meanError: number | null; readonly beats: number};
  readonly boundaryFlux: {readonly excessDb: number | null; readonly atFrame: number | null; readonly judged: boolean};
  readonly sampleJumpRatio: number | null;
  readonly silenceGapMs: number;
  readonly stereoCorrelation: number | null;
}
export interface TransitionEvaluation {
  readonly version: typeof MIX_EVALUATOR_VERSION;
  readonly thresholds: typeof MIX_EVALUATION_THRESHOLDS.version;
  readonly recipe: MixRecipe;
  readonly verdict: 'pass' | 'warn' | 'fail';
  /** Lower is better. Deterministic ordering key, not a quality score. */
  readonly penalty: number;
  readonly flags: readonly EvaluationFlag[];
  readonly measurements: TransitionMeasurements | null;
  readonly bSource: TransitionRender['bSource'] | null;
}

type Coefficients = [number, number, number, number, number];
const IDENTITY: Coefficients = [1, 0, 0, 0, 0];

class Biquad {
  private s1 = 0;
  private s2 = 0;
  constructor(public c: Coefficients) {}
  next(x: number): number {
    const [b0, b1, b2, a1, a2] = this.c;
    const y = b0 * x + this.s1;
    this.s1 = b1 * x - a1 * y + this.s2;
    this.s2 = b2 * x - a2 * y;
    return y;
  }
}

/** Audio EQ Cookbook forms, with Web Audio's dB Q for low/high-pass and S = 1 for the shelf. */
function normalize(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coefficients {
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function lowShelf(rate: number, hz: number, db: number): Coefficients {
  if (db === 0) return IDENTITY;
  const A = 10 ** (db / 40), w = 2 * Math.PI * hz / rate, cos = Math.cos(w);
  const alpha = Math.sin(w) / 2 * Math.SQRT2, s = 2 * Math.sqrt(A) * alpha;
  return normalize(A * ((A + 1) - (A - 1) * cos + s), 2 * A * ((A - 1) - (A + 1) * cos),
    A * ((A + 1) - (A - 1) * cos - s), (A + 1) + (A - 1) * cos + s,
    -2 * ((A - 1) + (A + 1) * cos), (A + 1) + (A - 1) * cos - s);
}
const qLinear = (qDb: number) => 10 ** (qDb / 20);
function lowPass(rate: number, hz: number, qDb = MIX_FILTER_Q_DB): Coefficients {
  if (hz >= rate / 2) return IDENTITY;
  if (hz <= 0) return [0, 0, 0, 0, 0];
  const w = 2 * Math.PI * hz / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * qLinear(qDb));
  return normalize((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}
function highPass(rate: number, hz: number, qDb = MIX_FILTER_Q_DB): Coefficients {
  if (hz <= 0) return IDENTITY;
  if (hz >= rate / 2) return [0, 0, 0, 0, 0];
  const w = 2 * Math.PI * hz / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * qLinear(qDb));
  return normalize((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}
/** BS.1770 K-weighting, same parameterization as `src/audio-analysis.ts`. */
function kFilters(rate: number): readonly [Coefficients, Coefficients] {
  const k = Math.tan(Math.PI * 1681.974450955533 / rate), q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20), vb = vh ** 0.4996667741545416;
  const d = 1 + k / q + k * k;
  const shelf: Coefficients = [(vh + vb * k / q + k * k) / d, 2 * (k * k - vh) / d,
    (vh - vb * k / q + k * k) / d, 2 * (k * k - 1) / d, (1 - k / q + k * k) / d];
  const r = Math.tan(Math.PI * 38.13547087602444 / rate), rq = 0.5003270373238773;
  const rd = 1 + r / rq + r * r;
  return [shelf, [1, -2, 1, 2 * (r * r - 1) / rd, (1 - r / rq + r * r) / rd]];
}

/** Monotonic lane reader matching `mixCurveValue`, clamped to the last value after the lane. */
function laneReader(points: readonly MixAutomationPoint[]): (frame: number) => number {
  let index = 1;
  return frame => {
    if (frame <= 0) return points[0]!.value;
    while (index < points.length - 1 && frame > points[index]!.frame) index++;
    const left = points[index - 1]!, right = points[index]!;
    if (frame >= right.frame) return right.value;
    const t = (frame - left.frame) / (right.frame - left.frame);
    return right.curve === 'exponential' ? left.value * (right.value / left.value) ** t
      : left.value + (right.value - left.value) * t;
  };
}

const BLOCK = 128;
/**
 * One source through one automation graph, mirroring `createMixAutomationGraph`: before the graph
 * the source is dry; from frame 0 the output is gain x LP(HP(shelf(x))), coefficients refreshed
 * every 128 frames; the optional echo send is taken before the gain, delayed with a low-passed
 * feedback loop and returned through its own wet lane. `input(ch, k)` is the source frame k of the
 * graph timeline. `active` frames are produced (the source stops afterwards).
 */
function renderGraph(rate: number, channels: number, active: number, automation: MixAutomation,
  input: (channel: number, frame: number) => number): Float64Array[] {
  const out = Array.from({length: channels}, () => new Float64Array(active));
  const gain = laneReader(automation.gain), shelfDb = laneReader(automation.lowShelfDb);
  const hpHz = laneReader(automation.highPassHz), lpHz = laneReader(automation.lowPassHz);
  const chains = Array.from({length: channels}, () =>
    [new Biquad(IDENTITY), new Biquad(IDENTITY), new Biquad(IDENTITY)] as const);
  const echo = automation.echo;
  const send = echo ? laneReader(echo.send) : null, wet = echo ? laneReader(echo.wet) : null;
  const delays = echo ? Array.from({length: channels}, () => new Float64Array(echo.delayFrames)) : [];
  const loops = echo ? Array.from({length: channels}, () => new Biquad(lowPass(rate, echo.lowPassHz))) : [];
  let cursor = 0;
  for (let k = 0; k < active; k++) {
    if (k % BLOCK === 0) {
      const coefficients = [lowShelf(rate, MIX_SHELF_HZ, shelfDb(k)), highPass(rate, hpHz(k)), lowPass(rate, lpHz(k))];
      for (const chain of chains) chain.forEach((filter, i) => { filter.c = coefficients[i]!; });
    }
    const g = gain(k), s = send?.(k) ?? 0, w = wet?.(k) ?? 0;
    for (let ch = 0; ch < channels; ch++) {
      const x = input(ch, k), chain = chains[ch]!;
      let y = g * chain[2].next(chain[1].next(chain[0].next(x)));
      if (echo) {
        const line = delays[ch]!, delayed = line[cursor]!;
        line[cursor] = s * x + echo.feedback * loops[ch]!.next(delayed);
        y += w * delayed;
      }
      out[ch]![k] = y;
    }
    if (echo) cursor = (cursor + 1) % echo.delayFrames;
  }
  return out;
}

function sampleAt(pcm: MixPcm, channel: number, frame: number): number {
  const data = pcm.channels[Math.min(channel, pcm.channels.length - 1)]!;
  if (frame < 0 || frame > data.length - 1) return 0;
  const i = Math.floor(frame), t = frame - i;
  return t === 0 ? data[i]! : data[i]! * (1 - t) + (data[i + 1] ?? 0) * t;
}

/**
 * Plain-JavaScript offline render of the transition window [S - context, E + context]. It mirrors
 * the browser graph's lanes but is not a bit-exact copy of a browser's Web Audio implementation.
 * Without `prepared`, a blend with tempo ratio != 1 places B by linear resampling, which also
 * shifts pitch (WSOLA would not); the render reports that as `bSource: 'linear-resample'`.
 */
export function renderTransition(from: MixPcm, to: MixPcm, spec: TransitionSpec,
  prepared?: {readonly audio: MixPcm; readonly entryFrame: number}): TransitionRender {
  const rate = from.sampleRate;
  if (to.sampleRate !== rate || (prepared && prepared.audio.sampleRate !== rate)) {
    throw new Error('Transition evaluation needs one sample rate.');
  }
  validateMixAutomation(spec.automation.outgoing, rate);
  validateMixAutomation(spec.automation.incoming, rate);
  if (!Number.isSafeInteger(spec.fromStartFrame) || spec.fromStartFrame < 0 ||
      !Number.isSafeInteger(spec.preRollFrames) || spec.preRollFrames < 0 ||
      !Number.isFinite(spec.toEntryFrame) || spec.toEntryFrame < 0 ||
      !Number.isFinite(spec.tempoRatio) || spec.tempoRatio <= 0) {
    throw new Error('Transition evaluation spec is invalid.');
  }
  const context = Math.round(MIX_EVALUATION_THRESHOLDS.contextSeconds * rate);
  const pre = Math.min(context, spec.fromStartFrame);
  const outgoingFrames = spec.automation.outgoing.durationFrames;
  const S = pre, T = S + spec.preRollFrames;
  const E = Math.max(S + outgoingFrames, T + spec.automation.incoming.durationFrames);
  const length = E + context;
  const channels = Math.max(from.channels.length, to.channels.length, (prepared?.audio.channels.length ?? 1));
  const aFrame = (n: number) => spec.fromStartFrame - pre + n;
  const bSource: TransitionRender['bSource'] = prepared ? 'prepared' : spec.tempoRatio === 1 ? 'native' : 'linear-resample';
  const bAt = (ch: number, k: number): number => prepared
    ? sampleAt(prepared.audio, ch, prepared.entryFrame + k)
    : sampleAt(to, ch, spec.toEntryFrame + k * spec.tempoRatio);
  const make = () => Array.from({length: channels}, () => new Float64Array(length));
  const aOut = make(), bOut = make(), aNative = make(), bNative = make(), mix = make();
  const outgoing = renderGraph(rate, channels, Math.min(outgoingFrames, Math.max(0, from.channels[0]!.length - aFrame(S))),
    spec.automation.outgoing, (ch, k) => sampleAt(from, ch, aFrame(S + k)));
  const incoming = renderGraph(rate, channels, length - T, spec.automation.incoming, bAt);
  for (let ch = 0; ch < channels; ch++) {
    for (let n = 0; n < length; n++) {
      const a = sampleAt(from, ch, aFrame(n));
      aNative[ch]![n] = a;
      aOut[ch]![n] = n < S ? a : outgoing[ch]![n - S] ?? 0;
      bNative[ch]![n] = bAt(ch, n - T);
      if (n >= T) bOut[ch]![n] = incoming[ch]![n - T]!;
      mix[ch]![n] = aOut[ch]![n]! + bOut[ch]![n]!;
    }
  }
  return {sampleRate: rate, S, T, E, mix, aOut, bOut, aNative, bNative, bSource};
}

const finite = (n: number) => Number.isFinite(n) ? n : null;
const db = (ratio: number) => 10 * Math.log10(ratio);

function weightedEnergy(channels: readonly Float64Array[], rate: number): Float64Array {
  const coefficients = kFilters(rate), out = new Float64Array(channels[0]!.length);
  for (const channel of channels) {
    const [shelf, rlb] = [new Biquad(coefficients[0]), new Biquad(coefficients[1])];
    for (let n = 0; n < channel.length; n++) { const y = rlb.next(shelf.next(channel[n]!)); out[n] = out[n]! + y * y; }
  }
  return out;
}
function bandEnergy(channels: readonly Float64Array[], rate: number, low: number, high: number): Float64Array {
  const out = new Float64Array(channels[0]!.length);
  for (const channel of channels) {
    const hp = new Biquad(highPass(rate, low)), lp = new Biquad(lowPass(rate, high));
    for (let n = 0; n < channel.length; n++) { const y = lp.next(hp.next(channel[n]!)); out[n] = out[n]! + y * y; }
  }
  return out;
}
function prefix(values: Float64Array): Float64Array {
  const sum = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) sum[i + 1] = sum[i]! + values[i]!;
  return sum;
}
const windowMean = (sum: Float64Array, start: number, end: number) => (sum[end]! - sum[start]!) / Math.max(1, end - start);
function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
}

/** Windows of `size` frames every `hop` frames that intersect [from, to). */
function windows(length: number, size: number, hop: number, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  for (let start = 0; start + size <= length; start += hop) {
    if (start < Math.max(to, from + 1) && start + size > from) out.push([start, start + size]);
  }
  return out;
}

/** Wrapped B-beat distance to A's grid, as a fraction of A's beat period. */
function beatPhase(render: TransitionRender, spec: TransitionSpec,
  analysis: {readonly from: MixAnalysis; readonly to: MixAnalysis}): TransitionMeasurements['beatPhase'] {
  const fromBpm = analysis.from.tempo.bpm;
  if (fromBpm === null || !analysis.from.beatGrid.frames.length || !analysis.to.beatGrid.frames.length) {
    return {maxError: null, meanError: null, beats: 0};
  }
  const rate = render.sampleRate, period = 60 * rate / fromBpm;
  const aIndex = (f: number) => render.S + (f - spec.fromStartFrame);
  const grid = analysis.from.beatGrid.frames.map(aIndex).filter(n => n <= render.T + period);
  if (!grid.length) return {maxError: null, meanError: null, beats: 0};
  const end = spec.recipe === 'cut' ? render.T + period * 1.01 : Math.max(render.E, render.T + 4 * period);
  const anchor = grid[grid.length - 1]!;
  const errors = analysis.to.beatGrid.frames
    .map(g => render.T + (g - spec.toEntryFrame) / spec.tempoRatio)
    .filter(n => n >= render.T - 1 && n <= end)
    .map(n => { const x = (n - anchor) / period; return Math.abs(x - Math.round(x)); });
  if (!errors.length) return {maxError: null, meanError: null, beats: 0};
  return {maxError: Math.max(...errors), meanError: errors.reduce((a, b) => a + b, 0) / errors.length,
    beats: errors.length};
}

/** All measurements on one render. Pure and deterministic. */
export function measureTransition(render: TransitionRender, spec: TransitionSpec,
  analysis?: {readonly from: MixAnalysis; readonly to: MixAnalysis}): TransitionMeasurements {
  const rate = render.sampleRate, length = render.mix[0]!.length, {S, T, E} = render;
  const span = Math.max(1, E - S), x = (n: number) => Math.max(0, Math.min(1, (n - S) / span));

  // True peak (BS.1770 4x estimate from the shared WAV analysis).
  const peak = analyzeAudio({sample_rate: rate, channels: render.mix.length, frames: length, format: 'float32',
    samples: render.mix, positive_rail: 1, negative_rail: -1}).true_peak.dbtp;

  // Loudness against the interpolation of unprocessed A and B.
  const eMix = weightedEnergy(render.mix, rate), eA = weightedEnergy(render.aNative, rate);
  const eB = weightedEnergy(render.bNative, rate);
  const eTarget = Float64Array.from(eA, (a, n) => (1 - x(n)) * a + (n >= T ? x(n) * eB[n]! : 0));
  const mixSum = prefix(eMix), targetSum = prefix(eTarget);
  const loudness = (seconds: number) => {
    let up: number | null = null, down: number | null = null;
    for (const [a, b] of windows(length, Math.round(seconds * rate), Math.round(0.1 * rate), S, E)) {
      const target = windowMean(targetSum, a, b);
      if (-0.691 + db(target) < -70) continue;
      const deviation = Math.max(-60, db(Math.max(1e-30, windowMean(mixSum, a, b)) / target));
      up = up === null ? deviation : Math.max(up, deviation);
      down = down === null ? deviation : Math.min(down, deviation);
    }
    return {up, down};
  };
  const momentary = loudness(0.4), shortTerm = loudness(3);

  // Low-end build-up against the louder processed side.
  let lowMax: number | null = null, lowBand: string | null = null;
  for (const [lo, hi] of [[25, 60], [60, 120], [120, 250]] as const) {
    const m = prefix(bandEnergy(render.mix, rate, lo, hi)), a = prefix(bandEnergy(render.aOut, rate, lo, hi));
    const b = prefix(bandEnergy(render.bOut, rate, lo, hi));
    for (const [s, e] of windows(length, Math.round(rate), Math.round(0.25 * rate), S, E)) {
      const louder = Math.max(windowMean(a, s, e), windowMean(b, s, e));
      if (louder < 1e-9) continue;
      const value = db(Math.max(1e-30, windowMean(m, s, e)) / louder);
      if (lowMax === null || value > lowMax) { lowMax = value; lowBand = `${lo}-${hi} Hz`; }
    }
  }

  // Positive 3-band log-energy flux per 20 ms frame that the unprocessed tracks do not explain.
  const frame = Math.round(0.02 * rate), edges = [[0, 250], [250, 4000], [4000, rate / 2]] as const;
  const fluxOf = (channels: readonly Float64Array[], floors?: number[]) => {
    const sums = edges.map(([lo, hi]) => prefix(bandEnergy(channels, rate, lo, hi)));
    // A relative floor (-80 dB against the mix band's mean) keeps silence-to-sound finite.
    const floor = floors ?? sums.map(sum => Math.max(1e-20, 1e-8 * sum[sum.length - 1]! / Math.max(1, length)));
    const values: number[] = [];
    let previous: number[] | null = null;
    for (let at = 0; at + frame <= length; at += frame) {
      const levels = sums.map((sum, i) => db(windowMean(sum, at, at + frame) + floor[i]!));
      values.push(previous ? levels.reduce((total, level, i) => total + Math.max(0, level - previous![i]!), 0) : 0);
      previous = levels;
    }
    return {values, floor};
  };
  const mixFlux = fluxOf(render.mix), aFlux = fluxOf(render.aNative, mixFlux.floor);
  const bFlux = fluxOf(render.bNative, mixFlux.floor);
  let excess: number | null = null, excessAt: number | null = null;
  mixFlux.values.forEach((value, k) => {
    const at = k * frame;
    if (at + frame <= S || at >= Math.max(E, S + 1)) return;
    const added = Math.max(0, value - Math.max(aFlux.values[k]!, bFlux.values[k]!));
    if (excess === null || added > excess) { excess = added; excessAt = at; }
  });

  // Sample steps near S, T and E against the rest of the window.
  const radius = Math.max(1, Math.round(0.01 * rate)), boundary: number[] = [], rest: number[] = [];
  for (let n = 1; n < length; n++) {
    let step = 0;
    for (const channel of render.mix) step = Math.max(step, Math.abs(channel[n]! - channel[n - 1]!));
    ([S, T, E].some(b => Math.abs(n - b) <= radius) ? boundary : rest).push(step);
  }
  const jump = boundary.length ? Math.max(...boundary) / Math.max(1e-6, percentile(rest, 0.999)) : null;

  // Silence introduced by the transition.
  const tenMs = Math.max(1, Math.round(0.01 * rate));
  let gap = 0, run = 0;
  for (let start = S; start + tenMs <= Math.min(length, E + Math.round(0.5 * rate)); start += tenMs) {
    let mixPower = 0, targetPower = 0;
    for (let n = start; n < start + tenMs; n++) {
      for (let ch = 0; ch < render.mix.length; ch++) {
        mixPower += render.mix[ch]![n]! ** 2;
        targetPower += (1 - x(n)) * render.aNative[ch]![n]! ** 2 + (n >= T ? x(n) * render.bNative[ch]![n]! ** 2 : 0);
      }
    }
    const count = tenMs * render.mix.length;
    const silent = Math.sqrt(mixPower / count) < 1e-3 && Math.sqrt(targetPower / count) >= 10 ** (-50 / 20);
    run = silent ? run + 1 : 0;
    gap = Math.max(gap, run);
  }

  // Stereo correlation over the transition (at least 400 ms around T).
  let correlation: number | null = null;
  if (render.mix.length >= 2) {
    const half = Math.round(0.2 * rate);
    const from = E - S >= 2 * half ? S : Math.max(0, T - half), to = E - S >= 2 * half ? E : Math.min(length, T + half);
    const [l, r] = [render.mix[0]!, render.mix[1]!];
    let sl = 0, sr = 0, sll = 0, srr = 0, slr = 0;
    for (let n = from; n < to; n++) { sl += l[n]!; sr += r[n]!; sll += l[n]! ** 2; srr += r[n]! ** 2; slr += l[n]! * r[n]!; }
    const count = Math.max(1, to - from), vl = sll / count - (sl / count) ** 2, vr = srr / count - (sr / count) ** 2;
    if (vl > 1e-12 && vr > 1e-12) correlation = (slr / count - sl * sr / count ** 2) / Math.sqrt(vl * vr);
  }

  return {truePeakDbtp: peak === null ? null : finite(peak),
    loudness: {momentaryMaxUpLu: momentary.up, momentaryMaxDownLu: momentary.down,
      shortTermMaxUpLu: shortTerm.up, shortTermMaxDownLu: shortTerm.down},
    lowBuildUp: {maxDb: lowMax, band: lowBand},
    beatPhase: analysis ? beatPhase(render, spec, analysis) : {maxError: null, meanError: null, beats: 0},
    boundaryFlux: {excessDb: excess, atFrame: excessAt, judged: spec.recipe === 'blend'},
    sampleJumpRatio: jump, silenceGapMs: gap * 10, stereoCorrelation: correlation};
}

/** Flags, verdict and an ordering penalty from the versioned thresholds. */
export function judgeTransition(recipe: MixRecipe, m: TransitionMeasurements): Omit<TransitionEvaluation, 'version' | 'thresholds' | 'recipe' | 'bSource' | 'measurements'> {
  const t = MIX_EVALUATION_THRESHOLDS, flags: EvaluationFlag[] = [];
  const check = (metric: EvaluationMetric, value: number | null, limits: {warn: number; fail?: number}, note?: string) => {
    if (value === null) return;
    const fail = limits.fail !== undefined && value > limits.fail;
    if (fail || value > limits.warn) flags.push({metric, level: fail ? 'fail' : 'warn', value,
      threshold: fail ? limits.fail! : limits.warn, ...(note ? {note} : {})});
  };
  check('truePeak', m.truePeakDbtp, t.truePeakDbtp);
  const loud = [m.loudness.momentaryMaxUpLu, m.loudness.shortTermMaxUpLu,
    ...[m.loudness.momentaryMaxDownLu, m.loudness.shortTermMaxDownLu].map(v => v === null ? null : -v)]
    .filter((v): v is number => v !== null);
  check('loudness', loud.length ? Math.max(...loud) : null, t.loudnessLu, 'largest deviation from the A-to-B interpolation, either direction');
  check('lowBuildUp', m.lowBuildUp.maxDb, t.lowBuildUpDb, m.lowBuildUp.band ?? undefined);
  check('beatPhase', m.beatPhase.maxError, t.beatPhase);
  if (m.boundaryFlux.judged) check('boundaryFlux', m.boundaryFlux.excessDb, t.boundaryFluxDb);
  check('sampleJump', m.sampleJumpRatio, t.sampleJumpRatio);
  check('silenceGap', m.silenceGapMs, t.silenceGapMs);
  if (m.stereoCorrelation !== null && m.stereoCorrelation < t.stereoCorrelation.warn) {
    flags.push({metric: 'stereoCorrelation', level: 'warn', value: m.stereoCorrelation, threshold: t.stereoCorrelation.warn});
  }
  const fails = flags.filter(f => f.level === 'fail').length, warns = flags.length - fails;
  const penalty = 100 * fails + 10 * warns + (loud.length ? Math.max(...loud) / t.loudnessLu.fail : 0) +
    Math.max(0, m.lowBuildUp.maxDb ?? 0) / t.lowBuildUpDb.fail + (m.beatPhase.maxError ?? 0) / t.beatPhase.fail +
    Math.max(0, (m.truePeakDbtp ?? -100) - t.truePeakDbtp.warn);
  return {verdict: fails ? 'fail' : warns ? 'warn' : 'pass', penalty, flags};
}

/** Render, measure and judge one transition. An invalid automation is a failed evaluation, not a throw. */
export function evaluateTransition(from: MixPcm, to: MixPcm, spec: TransitionSpec,
  analysis?: {readonly from: MixAnalysis; readonly to: MixAnalysis},
  prepared?: {readonly audio: MixPcm; readonly entryFrame: number}): TransitionEvaluation {
  const base = {version: MIX_EVALUATOR_VERSION, thresholds: MIX_EVALUATION_THRESHOLDS.version, recipe: spec.recipe};
  try {
    validateMixAutomation(spec.automation.outgoing, from.sampleRate);
    validateMixAutomation(spec.automation.incoming, from.sampleRate);
  } catch (error) {
    return {...base, verdict: 'fail', penalty: Number.MAX_SAFE_INTEGER, measurements: null, bSource: null,
      flags: [{metric: 'automation', level: 'fail', value: null, threshold: null,
        note: error instanceof Error ? error.message : String(error)}]};
  }
  const render = renderTransition(from, to, spec, prepared);
  const measurements = measureTransition(render, spec, analysis);
  return {...base, ...judgeTransition(spec.recipe, measurements), measurements, bSource: render.bSource};
}

/** The renderer's view of a planner proposal. */
export function planTransitionSpec(plan: AutomaticMixPlan): TransitionSpec {
  return {recipe: plan.recipe, fromStartFrame: plan.fromExitFrame - plan.preRollFrames,
    preRollFrames: plan.preRollFrames, toEntryFrame: plan.toEntryFrame,
    tempoRatio: plan.tempoRatio, automation: plan.automation};
}

export type EvaluatedMixDecision =
  {readonly kind: 'mix'; readonly plan: AutomaticMixPlan; readonly evaluation: TransitionEvaluation;
    readonly evaluations: readonly TransitionEvaluation[]} |
  {readonly kind: 'fallback'; readonly reason: string; readonly evaluations: readonly TransitionEvaluation[]};

/**
 * Evaluate every proposal and keep the best that does not fail (fewest flags, then lowest
 * penalty, then planner order). With none left the caller uses the authored crossfade.
 */
export function chooseEvaluatedMix(from: MixPcm, to: MixPcm, candidates: readonly AutomaticMixPlan[],
  analysis?: {readonly from: MixAnalysis; readonly to: MixAnalysis}): EvaluatedMixDecision {
  const evaluations = candidates.map(plan => evaluateTransition(from, to, planTransitionSpec(plan), analysis));
  let best = -1;
  evaluations.forEach((evaluation, i) => {
    if (evaluation.verdict === 'fail') return;
    if (best < 0 || evaluation.penalty < evaluations[best]!.penalty) best = i;
  });
  if (best < 0) {
    return {kind: 'fallback', evaluations, reason: candidates.length
      ? 'Every rendered candidate failed the experimental evaluator; use the authored crossfade.'
      : 'No candidate qualified for evaluation; use the authored crossfade.'};
  }
  return {kind: 'mix', plan: candidates[best]!, evaluation: evaluations[best]!, evaluations};
}

/** Node/offline: analyze, list proposals, render and evaluate each, and choose. */
export function planEvaluatedMixFromAudio(from: MixPcm, to: MixPcm,
  options: MixPlannerOptions = {}): EvaluatedMixDecision {
  const analysis = {from: analyzeMixAudio(from), to: analyzeMixAudio(to)};
  return chooseEvaluatedMix(from, to, automaticMixCandidates(analysis.from, analysis.to, options), analysis);
}
