/**
 * S15 increment 4: offline rendered-transition evaluator.
 *
 * Pure analysis shared by Node callers and the browser pre-check worker. It owns no playback
 * or audio clock. It renders a candidate transition in plain JavaScript, measures the rendered
 * PCM, and picks the best candidate that does not fail. Measurements are measurements: nothing
 * here hears audio, and passing says only that no configured defect check fired.
 */
import {analyzeAudio} from '../src/audio-analysis.js';
import {analyzeMixAudio, type MixAnalysis, type MixPcm} from '../src/mix-analysis.js';
import {composeRampInStart, nativeRateInputAt, nativeRateOutputAt, outgoingStretchPeakLimit, rampInOutputAt, renderFiniteLoop, renderTimePitch, validateNativeRate, TIME_PITCH_LIMITS} from '../src/time-pitch.js';
import {EQ_SPLIT, ThreeBandSplitter, type BandGap} from './eq-choreography.js';
import {MIX_FILTER_Q_DB, MIX_SHELF_HZ, validateMixAutomation, type MixAutomation,
  type MixAutomationPoint} from '../src/mix-automation.js';
import {automaticMixCandidates, type AutomaticMixPlan, type MixPlannerOptions,
  isSmoothRecipe, type LevelMatchPlan, type MixRecipe} from '../src/mix-planner.js';
import {checkLayeredLanes, leadBands, LAYERED_ENTRY_LIMITS, type EntryStyle, type LayeredEntryInfo} from './layered-entry.js';

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

/**
 * Part B recipe claims (recipe-claims@1). Each recipe is judged against the frozen thresholds@1 only on
 * what it promises; the limits themselves never change. Defects that are never intended (true peak,
 * clicks, unintended silence, low build-up and the separate transition-safety@1 set) are judged for
 * every recipe. A flag that thresholds@1 would raise on a property the recipe does not claim is logged
 * in `unclaimed` beside the verdict, never dropped silently.
 *
 * - `beatLocked: false` (cut, echo-out): B enters at its own tempo, so only B's entry beat is compared with
 *   A's grid. (Before this, a faster B's second beat fell inside the 1.01-beat window and failed any
 *   gap over about 11%, although the code comment already said only the entry beat is judged.)
 * - `loudness: 'dip'` (echo-out, which the route-free echo reset and dissolves are judged as): A is filtered
 *   or echoed away before B is up, so a dip below the straight A-to-B interpolation is the recipe itself.
 *   The upward deviation is judged against thresholds@1; the downward one is judged only against the
 *   recipe's declared dip bound (RECIPE_CLAIM_LIMITS.echoMaxDipLu) and its thresholds@1 flag is logged
 *   in `unclaimed`. A real dropout is still caught by the silence-gap rule.
 *
 * recipe-claims@2 (owner decisions 2026-11-16) adds one recipe and changes no existing judgement: `layered-entry`
 * (B native, brought in band by band, layered-entry@1) claims no beat lock (entry beat only), a loudness dip of
 * at most LAYERED_ENTRY_LIMITS.maxDipLu, and `layered: true`, which judges what it promises: per-band order
 * (B's lead band(s) measurably first), the low-band masking proxy (never both songs' bass near full) and its
 * own lane rules. thresholds@1 and transition-safety@1 are unchanged and still apply in full.
 */
export const RECIPE_CLAIMS_VERSION = 'recipe-claims@2' as const;
export interface RecipeClaims {
  readonly beatLocked: boolean; readonly loudness: 'crossfade' | 'dip';
  /** For a 'dip': the deepest drop below the interpolation the recipe declares; deeper still fails (a hole, not a dip). */
  readonly maxDipLu?: number;
  /** recipe-claims@2: a layered entry is judged on per-band order and the low-band masking proxy. */
  readonly layered?: true;
}
/** recipe-claims@1 declared dip bound for echo-type recipes (an engineering starting point, not calibrated). */
export const RECIPE_CLAIM_LIMITS = Object.freeze({echoMaxDipLu: 6});
export function recipeClaims(recipe: MixRecipe): RecipeClaims {
  if (recipe === 'echo-out') return {beatLocked: false, loudness: 'dip', maxDipLu: RECIPE_CLAIM_LIMITS.echoMaxDipLu};
  if (recipe === 'layered-entry') return {beatLocked: false, loudness: 'dip', maxDipLu: LAYERED_ENTRY_LIMITS.maxDipLu, layered: true};
  if (recipe === 'cut') return {beatLocked: false, loudness: 'crossfade'};
  return {beatLocked: true, loudness: 'crossfade'};
}

/**
 * S21 versioned safety set, judged beside (never inside) the frozen thresholds@1. Any flag is a
 * rejection: the set path tries its next candidate. NOT calibrated against listening.
 */
export const TRANSITION_SAFETY_THRESHOLDS = Object.freeze({
  version: 'transition-safety@1',
  status: 'experimental: engineering rejection limits, not calibrated against listening',
  /** Any rendered sample beyond full scale. */
  clipSample: 1,
  /** 4x oversampled true peak ceiling. */
  truePeakDbtp: -1,
  /** Low band (below the LR4 160 Hz split) of the mix over max(A native, B native from T). */
  lowRiseDb: 3,
  /** Low band of the mix below the interpolated A-to-B target, outside declared gaps (smooth recipes). */
  bassHoleDb: -15,
  /** Both low-band rules must persist this long: every 50 ms window across a 250 ms span must exceed the limit. */
  sustainMs: 250,
});
export type SafetyMetric = 'clipping' | 'truePeakCeiling' | 'lowRise' | 'bassHole';
export interface SafetyMeasurements {
  readonly samplePeak: number;
  readonly truePeakDbtp: number | null;
  /** Largest 250 ms low-band rise over the louder native source. */
  readonly lowRiseDb: number | null;
  /** Deepest 250 ms low-band shortfall against the target outside declared gaps (null = unjudged). */
  readonly bassHoleDb: number | null;
  readonly bassHoleJudged: boolean;
  readonly declaredGapFrames: number;
}
export interface SafetyVerdict {
  readonly version: typeof TRANSITION_SAFETY_THRESHOLDS.version;
  readonly verdict: 'pass' | 'fail';
  readonly flags: readonly {readonly metric: SafetyMetric; readonly value: number; readonly threshold: number}[];
}

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
  /** Captured persistent source gains, including when this plan is not a loudness-match recipe.
   * These override plan metadata and are applied once to rendered sources and references. */
  readonly fixedGains?: {readonly from: number; readonly to: number};
  /** Intentional fixed gains; references are scaled transparently with the rendered sources. */
  readonly levelMatch?: LevelMatchPlan;
  readonly entryDelayFrames?: number;
  readonly nativeRate?: AutomaticMixPlan['nativeRate'];
  readonly loopExtension?: AutomaticMixPlan['loopExtension'];
  /** Part B dual tempo ramp: A plays a pitch-kept WSOLA ramp from `fromStartFrame`. */
  readonly outgoingStretch?: AutomaticMixPlan['outgoingStretch'];
  /** recipe-claims@2: the layered entry's style and lead phase (what its per-band claim is judged on). */
  readonly layered?: LayeredEntryInfo;
}

export interface TransitionRender {
  readonly sampleRate: number;
  /** Array indices of S, T and E inside every rendered channel. */
  readonly S: number; readonly T: number; readonly E: number;
  readonly mix: readonly Float64Array[];
  readonly aOut: readonly Float64Array[]; readonly bOut: readonly Float64Array[];
  /** Intended source placement before gain/EQ (including rate/loop motion). B holds its audio before entry (zero at a
   * track start); loudness and silence targets use B only from T. */
  readonly aNative: readonly Float64Array[]; readonly bNative: readonly Float64Array[];
  /** How B was placed: native PCM, a supplied prepared buffer, or a pitch-changing resample. */
  readonly bSource: 'native' | 'prepared' | 'linear-resample' | 'native-rate-model';
}

export type EvaluationMetric = 'automation' | 'truePeak' | 'loudness' | 'lowBuildUp' | 'beatPhase' |
  'boundaryFlux' | 'sampleJump' | 'silenceGap' | 'stereoCorrelation' | 'layeredLead' | 'lowMasking' | 'layeredLanes';
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
  /** Unjudged when no independent shared grid is available; never turn cue membership into a pass. */
  readonly beatPhase: {readonly maxError: number | null; readonly meanError: number | null; readonly beats: number;
    readonly judged: boolean; readonly reason?: string};
  readonly boundaryFlux: {readonly excessDb: number | null; readonly atFrame: number | null; readonly judged: boolean};
  readonly sampleJumpRatio: number | null;
  readonly silenceGapMs: number;
  readonly stereoCorrelation: number | null;
  readonly levelMatch?: {readonly rawDeltaLu: number; readonly beforeDeltaLu: number; readonly matchedDeltaLu: number;
    readonly fromGain: number; readonly toGain: number; readonly target: 'gain-adjusted measured windows'};
  /** S21 transition-safety@1 inputs (absent on evaluations made before S21). */
  readonly safety?: SafetyMeasurements;
  /** recipe-claims@2: layered-entry measurements (present only when the spec carries a layered entry). */
  readonly layered?: LayeredMeasurements;
}
export interface LayeredMeasurements {
  readonly style: EntryStyle;
  /** Lead phase: lowest lead band of B minus its loudest other band, each relative to B native (null = unjudged). */
  readonly leadDb: number | null;
  /** Highest 500 ms min(A low, B low), each relative to its own native low band (null = unjudged). */
  readonly maskingDb: number | null;
  /**
   * Largest momentary (400 ms) rise of the mix over the LOUDER of the two native songs in the same window
   * (null = unjudged). A layered entry claims loudness continuity between A and B, not the straight-line
   * A-to-B energy interpolation: B's bands arriving early is the recipe, exceeding both songs is not.
   */
  readonly riseOverLouderLu?: number | null;
  /**
   * Deepest momentary (400 ms) drop of the mix below the QUIETER of the two native songs in the same window
   * (only the audible song when the other is silent; null = unjudged). The other half of the continuity claim:
   * the mix stays inside the two songs' envelope; a drop below both is a hole.
   */
  readonly dipUnderQuieterLu?: number | null;
  /** Lane rules read from the plan itself (layered-entry@1). */
  readonly lowOverlapDb: number; readonly lowSumMinDb: number; readonly leadFirst: boolean; readonly lanesOk: boolean;
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
  /** S21: the separate safety verdict; a fail rejects the candidate. */
  readonly safety?: SafetyVerdict;
  /** Part B: recipe-claims@1 version and the thresholds@1 flags on properties this recipe does not claim (logged only). */
  readonly claims?: typeof RECIPE_CLAIMS_VERSION;
  readonly unclaimed?: readonly EvaluationFlag[];
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
  // S21 LR4 band lanes after the dry filters, mirroring createThreeBandSplit (flat at unity).
  const bands = automation.bands;
  const bandLow = bands ? laneReader(bands.low) : null, bandMid = bands ? laneReader(bands.mid) : null;
  const bandHigh = bands ? laneReader(bands.high) : null;
  const splitters = bands ? Array.from({length: channels}, () => new ThreeBandSplitter(rate)) : [];
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
    const gl = bandLow?.(k) ?? 1, gm = bandMid?.(k) ?? 1, gh = bandHigh?.(k) ?? 1;
    for (let ch = 0; ch < channels; ch++) {
      const x = input(ch, k), chain = chains[ch]!;
      const dry = chain[2].next(chain[1].next(chain[0].next(x)));
      let y: number;
      if (bands) { const [l, m, h] = splitters[ch]!.next(dry); y = g * (gl * l + gm * m + gh * h); }
      else y = g * dry;
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
  prepared?: {readonly audio: MixPcm; readonly entryFrame: number; readonly outgoingLoop?: MixPcm}): TransitionRender {
  const rate = from.sampleRate;
  const gainA = spec.fixedGains ? spec.fixedGains.from : spec.levelMatch?.fromGain ?? 1;
  const gainB = spec.fixedGains ? spec.fixedGains.to : spec.levelMatch?.toGain ?? 1;
  if (![gainA, gainB].every(g => Number.isFinite(g) && g > 0 && g <= 4)) throw new Error('Invalid fixed evaluation level gain.');
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
  const delay = spec.entryDelayFrames ?? 0;
  if (!Number.isSafeInteger(delay) || delay < 0 || delay > rate * 60) throw new Error('Invalid bounded entry delay.');
  if (spec.nativeRate) {
    if (spec.nativeRate.pitchMoves !== true) throw new Error('Native rate model must disclose pitch movement.');
    validateNativeRate(spec.nativeRate.outgoing, rate);
    if (spec.nativeRate.incoming) { validateNativeRate(spec.nativeRate.incoming, rate); if (spec.nativeRate.incoming.end !== 1) throw new Error('Native entry must settle to unity.'); }
  }
  if (spec.loopExtension) {
    const l = spec.loopExtension;
    if (![4, 8].includes(l.bars) || ![l.startFrame, l.endFrame, l.frames].every(Number.isSafeInteger) || l.startFrame < 0 ||
      l.endFrame !== spec.fromStartFrame || l.endFrame - l.startFrame !== l.frames || l.frames !== delay || l.frames < l.bars * 32 ||
      l.endFrame + spec.automation.incoming.durationFrames > from.channels[0]!.length) throw new Error('Invalid bounded loop coordinates.');
  }
  const context = Math.round(MIX_EVALUATION_THRESHOLDS.contextSeconds * rate);
  const pre = Math.min(context, spec.fromStartFrame);
  const outgoingFrames = spec.automation.outgoing.durationFrames;
  const S = pre, T = S + spec.preRollFrames + (spec.entryDelayFrames ?? 0);
  const E = Math.max(S + outgoingFrames, T + spec.automation.incoming.durationFrames);
  const length = E + context;
  const channels = Math.max(from.channels.length, to.channels.length, (prepared?.audio.channels.length ?? 1));
  if (!Number.isSafeInteger(length) || length * channels > TIME_PITCH_LIMITS.maxSamples) throw new Error('Transition evaluation exceeds its bounded PCM budget.');
  const aFrame = (n: number) => spec.fromStartFrame + (spec.nativeRate && n >= S ? nativeRateInputAt(spec.nativeRate.outgoing, n - S) : n - S);
  const loop = spec.loopExtension, stretch = spec.outgoingStretch, suppliedLoop = prepared?.outgoingLoop;
  if (suppliedLoop !== undefined && !loop && !stretch) throw new Error('Unexpected prepared outgoing loop.');
  if (stretch && (loop || spec.nativeRate || stretch.sourceStartFrame !== spec.fromStartFrame || !Number.isSafeInteger(stretch.inputFrames) ||
    stretch.inputFrames < 1 || stretch.sourceStartFrame + stretch.inputFrames > from.channels[0]!.length ||
    stretch.rampIn.rampFrames !== delay)) throw new Error('Invalid bounded outgoing tempo-ramp coordinates.');
  const stretchNative = stretch ? from.channels.map(c => c.subarray(stretch.sourceStartFrame, stretch.sourceStartFrame + stretch.inputFrames)) : null;
  // Part B: a supplied ramp is held to A's own peak (plus the WSOLA overlap margin); the true-peak metric still judges it.
  const suppliedLimit = stretchNative ? outgoingStretchPeakLimit(stretchNative, gainA) : TIME_PITCH_LIMITS.peakCeiling;
  if (suppliedLoop !== undefined) {
    if (!suppliedLoop || suppliedLoop.sampleRate !== rate || !Array.isArray(suppliedLoop.channels) ||
      ![1, 2].includes(suppliedLoop.channels.length) || suppliedLoop.channels.length !== from.channels.length ||
      suppliedLoop.channels.some(channel => !(channel instanceof Float32Array || channel instanceof Float64Array) ||
        channel.length !== outgoingFrames)) throw new Error('Prepared outgoing loop dimensions differ from its automation.');
    for (const channel of suppliedLoop.channels) for (const sample of channel) {
      if (!Number.isFinite(sample) || Math.abs(sample) * gainA > suppliedLimit + 1e-7)
        throw new Error('Prepared outgoing loop failed effective sample-peak/finite validation.');
    }
  }
  const loopAudio = loop ? suppliedLoop ?? renderFiniteLoop({sampleRate: rate, channels: from.channels.map(c =>
    c.subarray(loop.startFrame, loop.endFrame + spec.automation.incoming.durationFrames))}, loop.frames,
    spec.automation.incoming.durationFrames, loop.bars, gainA).audio : stretch ? suppliedLoop ?? {sampleRate: rate,
      channels: composeRampInStart(stretchNative!, renderTimePitch({sampleRate: rate, channels: stretchNative!},
        {tempoRatio: stretch.tempoRatio, pitchSemitones: 0, rampIn: stretch.rampIn}), outgoingFrames)} : null;
  const aAt = (ch: number, n: number): number => {
    if (!loopAudio || n < S) return sampleAt(from, ch, aFrame(n));
    const k = n - S, fade = Math.round(rate * 0.02), weight = Math.min(1, k / fade);
    return sampleAt(loopAudio, ch, k) * weight + sampleAt(from, ch, spec.fromStartFrame + k) * (1 - weight);
  };
  const bSource: TransitionRender['bSource'] = prepared ? 'prepared' : spec.nativeRate?.incoming ? 'native-rate-model' : spec.tempoRatio === 1 ? 'native' : 'linear-resample';
  const bAt = (ch: number, k: number): number => prepared
    ? sampleAt(prepared.audio, ch, prepared.entryFrame + k)
    : sampleAt(to, ch, spec.toEntryFrame + (spec.nativeRate?.incoming ? nativeRateInputAt(spec.nativeRate.incoming, k) : k * spec.tempoRatio));
  const make = () => Array.from({length: channels}, () => new Float64Array(length));
  const aOut = make(), bOut = make(), aNative = make(), bNative = make(), mix = make();
  const remainingNativeFrames = Math.max(0, from.channels[0]!.length - aFrame(S));
  const availableOutputFrames = spec.nativeRate
    ? Math.ceil(nativeRateOutputAt(spec.nativeRate.outgoing, remainingNativeFrames)) : remainingNativeFrames;
  const outgoing = renderGraph(rate, channels, loopAudio ? Math.min(outgoingFrames, loopAudio.channels[0]!.length) :
    Math.min(outgoingFrames, availableOutputFrames),
    spec.automation.outgoing, (ch, k) => aAt(ch, S + k));
  const incoming = renderGraph(rate, channels, length - T, spec.automation.incoming, bAt);
  for (let ch = 0; ch < channels; ch++) {
    for (let n = 0; n < length; n++) {
      const a = aAt(ch, n);
      aNative[ch]![n] = a * gainA;
      aOut[ch]![n] = (n < S ? a : outgoing[ch]![n - S] ?? 0) * gainA;
      bNative[ch]![n] = bAt(ch, n - T) * gainB;
      if (n >= T) bOut[ch]![n] = incoming[ch]![n - T]! * gainB;
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

/** Wrapped B-beat distance to A's grid, as a fraction of A's beat period. This uses the analysers'
 * beat grids mapped through the spec, not beats detected in the rendered mix. */
function beatPhase(render: TransitionRender, spec: TransitionSpec,
  analysis: {readonly from: MixAnalysis; readonly to: MixAnalysis}): TransitionMeasurements['beatPhase'] {
  const unjudged = (reason: string): TransitionMeasurements['beatPhase'] =>
    ({maxError: null, meanError: null, beats: 0, judged: false, reason});
  if (spec.recipe === 'brake') return unjudged('Brake deliberately leaves A\'s grid; B cue membership is not an independent phase comparison.');
  // Part B: the judge uses the same grid the planner used. A requested (unmeasured) grid is labelled,
  // never compared: neither the requested grid nor the raw low-confidence analysis is evidence of phase.
  const requested = [analysis.from, analysis.to].filter(a => a.beatGrid.source === 'requested').length;
  if (requested) return unjudged(`${requested === 2 ? 'Both songs use' : analysis.from.beatGrid.source === 'requested' ? 'A uses' : 'B uses'} the requested grid (not measured); phase is not judged against it.`);
  const fromBpm = analysis.from.tempo.bpm;
  if (fromBpm === null || !analysis.from.beatGrid.frames.length || !analysis.to.beatGrid.frames.length) {
    return unjudged('Both measured beat grids are required.');
  }
  const rate = render.sampleRate, period = 60 * rate / fromBpm;
  if (spec.outgoingStretch) {
    // Part B dual tempo ramp: A's beats follow the WSOLA ramp-in time map from S; B is stretched from T.
    // Both periods are 60 / shared BPM after the ramp, so B's beats are compared with A's mapped grid.
    const s = spec.outgoingStretch, sharedPeriod = period / s.tempoRatio;
    const grid = analysis.from.beatGrid.frames.filter(f => f >= s.sourceStartFrame && f <= s.sourceStartFrame + s.inputFrames)
      .map(f => render.S + rampInOutputAt(f - s.sourceStartFrame, s.tempoRatio, s.rampIn))
      .filter(n => n >= render.T - sharedPeriod && n <= render.E + sharedPeriod);
    if (!grid.length) return unjudged('No A beat falls inside the compared window.');
    const errors = analysis.to.beatGrid.frames.map(g => render.T + (g - spec.toEntryFrame) / spec.tempoRatio)
      .filter(n => n >= render.T - 1 && n <= Math.min(render.E, grid[grid.length - 1]! + sharedPeriod / 2))
      .map(n => Math.min(...grid.map(g => Math.abs(g - n))) / sharedPeriod);
    return errors.length ? {maxError: Math.max(...errors), meanError: errors.reduce((a, b) => a + b, 0) / errors.length,
      beats: errors.length, judged: true} : unjudged('No B beat falls inside the compared window.');
  }
  if (spec.nativeRate?.incoming) {
    const ramps = spec.nativeRate;
    const grid = analysis.from.beatGrid.frames.map(f => render.S + nativeRateOutputAt(ramps.outgoing, f - spec.fromStartFrame));
    const errors = analysis.to.beatGrid.frames.map(f => render.T + nativeRateOutputAt(ramps.incoming!, f - spec.toEntryFrame))
      .filter(n => n >= render.T - 1 && n <= render.E).map(n => {
        const distance = Math.min(...grid.map(g => Math.abs(g - n)));
        const k = Math.max(0, Math.min(ramps.outgoing.frames, n - render.S));
        const speed = ramps.outgoing.start + (ramps.outgoing.end - ramps.outgoing.start) * k / ramps.outgoing.frames;
        return distance / (period / speed);
      });
    return errors.length ? {maxError: Math.max(...errors), meanError: errors.reduce((a, b) => a + b, 0) / errors.length, beats: errors.length, judged: true} : unjudged('No B beat falls inside the compared window.');
  }
  if (spec.recipe === 'meet-in-middle' && spec.nativeRate && !spec.nativeRate.incoming) {
    // S21: A's grid follows its native-rate ramp; B is stretched to the meeting tempo from T.
    const ramp = spec.nativeRate.outgoing, meetPeriod = period / ramp.end;
    const grid = analysis.from.beatGrid.frames.map(f => render.S + nativeRateOutputAt(ramp, f - spec.fromStartFrame))
      .filter(n => n >= render.T - meetPeriod && n <= render.E + meetPeriod);
    if (!grid.length) return unjudged('No A beat falls inside the compared window.');
    const errors = analysis.to.beatGrid.frames.map(g => render.T + (g - spec.toEntryFrame) / spec.tempoRatio)
      .filter(n => n >= render.T - 1 && n <= render.E)
      .map(n => Math.min(...grid.map(g => Math.abs(g - n))) / meetPeriod);
    return errors.length ? {maxError: Math.max(...errors), meanError: errors.reduce((a, b) => a + b, 0) / errors.length,
      beats: errors.length, judged: true} : unjudged('No B beat falls inside the compared window.');
  }
  const aIndex = (f: number) => render.S + (f - spec.fromStartFrame) + (spec.entryDelayFrames ?? 0);
  const grid = analysis.from.beatGrid.frames.map(aIndex).filter(n => n <= render.T + period);
  if (!grid.length) return unjudged('No A beat falls inside the compared window.');
  // Cut and echo keep B at its native tempo by design, so only B's entry beat is judged (recipe-claims@1:
  // the first B beat at or after T; a faster B's second beat is not part of the claim).
  const native = !recipeClaims(spec.recipe).beatLocked;
  const end = native ? render.T + period * 1.01 : Math.max(render.E, render.T + 4 * period);
  const anchor = grid[grid.length - 1]!;
  const inWindow = analysis.to.beatGrid.frames
    .map(g => render.T + (g - spec.toEntryFrame) / spec.tempoRatio)
    .filter(n => n >= render.T - 1 && n <= end);
  const errors = (native ? inWindow.slice(0, 1) : inWindow)
    .map(n => { const x = (n - anchor) / period; return Math.abs(x - Math.round(x)); });
  if (!errors.length) return unjudged('No B beat falls inside the compared window.');
  return {maxError: Math.max(...errors), meanError: errors.reduce((a, b) => a + b, 0) / errors.length,
    beats: errors.length, judged: true};
}

/** All measurements on one render. Pure and deterministic. */
export function measureTransition(render: TransitionRender, spec: TransitionSpec,
  analysis?: {readonly from: MixAnalysis; readonly to: MixAnalysis}): TransitionMeasurements {
  const rate = render.sampleRate, length = render.mix[0]!.length, {S, T, E} = render;
  const targetStart = spec.entryDelayFrames ? T : S;
  const span = Math.max(1, E - targetStart), x = (n: number) => Math.max(0, Math.min(1, (n - targetStart) / span));

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

  const safety = measureSafety(render, spec, peak === null ? null : finite(peak));
  const layered = spec.layered ? measureLayered(render, spec, spec.layered) : undefined;
  return {truePeakDbtp: peak === null ? null : finite(peak), safety, ...(layered ? {layered} : {}),
    loudness: {momentaryMaxUpLu: momentary.up, momentaryMaxDownLu: momentary.down,
      shortTermMaxUpLu: shortTerm.up, shortTermMaxDownLu: shortTerm.down},
    lowBuildUp: {maxDb: lowMax, band: lowBand},
    beatPhase: analysis ? beatPhase(render, spec, analysis) : {maxError: null, meanError: null, beats: 0,
      judged: false, reason: 'No measured beat analyses were supplied.'},
    boundaryFlux: {excessDb: excess, atFrame: excessAt, judged: isSmoothRecipe(spec.recipe)},
    sampleJumpRatio: jump, silenceGapMs: gap * 10, stereoCorrelation: correlation,
    ...(spec.levelMatch ? {levelMatch: {rawDeltaLu: spec.levelMatch.rawDeltaLu, beforeDeltaLu: spec.levelMatch.beforeDeltaLu,
      matchedDeltaLu: spec.levelMatch.matchedDeltaLu, fromGain: spec.levelMatch.fromGain, toGain: spec.levelMatch.toGain,
      target: 'gain-adjusted measured windows' as const}} : {})};
}

/**
 * recipe-claims@2 layered-entry measurements. Band levels are relative to each song's own native signal in the
 * same measuring band, so the claim is about what the automation did to each song, not which song is louder.
 * A band whose native level is near silent is left unjudged (null), never turned into a pass of the lead rule.
 */
function measureLayered(render: TransitionRender, spec: TransitionSpec, info: LayeredEntryInfo): LayeredMeasurements {
  const rate = render.sampleRate, length = render.mix[0]!.length, {S, T, E} = render;
  const top = Math.min(rate / 2 - 1, 16000);
  const edges = {low: [20, EQ_SPLIT.lowMidHz], mid: [EQ_SPLIT.lowMidHz, EQ_SPLIT.midHighHz], high: [EQ_SPLIT.midHighHz, top]} as const;
  const bFromT = render.bNative.map(c => Float64Array.from(c, (v, n) => n >= T ? v : 0));
  const sums = (channels: readonly Float64Array[]) => ({
    low: prefix(bandEnergy(channels, rate, edges.low[0], edges.low[1])),
    mid: prefix(bandEnergy(channels, rate, edges.mid[0], edges.mid[1])),
    high: prefix(bandEnergy(channels, rate, edges.high[0], edges.high[1]))});
  const bOut = sums(render.bOut), bNat = sums(bFromT);
  // Lead phase: the second to fourth quarters of the lead window (the first quarter is the lead band still rising).
  const leadEnd = Math.min(length, T + info.leadEndFrame);
  const leadStart = Math.min(leadEnd - 1, T + Math.round(info.leadEndFrame / 4));
  const whole = (band: 'low' | 'mid' | 'high') => windowMean(bNat[band], T, Math.min(length, Math.max(E, T + 1)));
  const loudest = Math.max(1e-30, whole('low'), whole('mid'), whole('high'));
  const rel = (band: 'low' | 'mid' | 'high'): number | null => {
    const native = windowMean(bNat[band], leadStart, leadEnd), out = windowMean(bOut[band], leadStart, leadEnd);
    return native > 1e-4 * loudest ? db(Math.max(1e-12 * native, out) / native) : null;
  };
  const lead = leadBands(info.style), others = (['low', 'mid', 'high'] as const).filter(b => !lead.includes(b));
  const leadLevels = lead.map(rel), otherLevels = others.map(rel).filter((v): v is number => v !== null);
  const leadDb = leadLevels.every(v => v !== null) && otherLevels.length
    ? Math.min(...leadLevels as number[]) - Math.max(...otherLevels) : null;
  // Masking proxy: 500 ms windows (100 ms hop) where both natives carry real low end.
  const aOutLow = prefix(bandEnergy(render.aOut, rate, edges.low[0], edges.low[1]));
  const aNatLow = prefix(bandEnergy(render.aNative, rate, edges.low[0], edges.low[1]));
  const from = Math.max(S, T), to = Math.max(from + 1, E);
  const refA = Math.max(1e-30, windowMean(aNatLow, from, to)), refB = Math.max(1e-30, windowMean(bNat.low, from, to));
  let masking: number | null = null;
  for (const [s, e] of windows(length, Math.round(0.5 * rate), Math.round(0.1 * rate), from, to)) {
    if (s < from || e > to) continue;
    const an = windowMean(aNatLow, s, e), bn = windowMean(bNat.low, s, e);
    if (an < 0.05 * refA || bn < 0.05 * refB) continue;
    const value = Math.min(db(Math.max(1e-30, windowMean(aOutLow, s, e)) / an), db(Math.max(1e-30, windowMean(bOut.low, s, e)) / bn));
    if (masking === null || value > masking) masking = value;
  }
  // Loudness continuity: the mix against the louder native song, K-weighted, 400 ms windows (100 ms hop).
  const eMix = prefix(weightedEnergy(render.mix, rate)), eA = prefix(weightedEnergy(render.aNative, rate));
  const eB = prefix(weightedEnergy(bFromT, rate));
  let rise: number | null = null, under: number | null = null;
  const audible = (energy: number) => -0.691 + db(Math.max(1e-30, energy)) >= -70;
  for (const [s, e] of windows(length, Math.round(0.4 * rate), Math.round(0.1 * rate), S, E)) {
    const a = windowMean(eA, s, e), b = windowMean(eB, s, e), louder = Math.max(a, b);
    if (!audible(louder)) continue;
    const mix = Math.max(1e-30, windowMean(eMix, s, e));
    const value = db(mix / louder);
    if (rise === null || value > rise) rise = value;
    const quieter = audible(a) && audible(b) ? Math.min(a, b) : louder;
    const drop = Math.min(60, db(quieter / mix));
    if (under === null || drop > under) under = drop;
  }
  const lanes = checkLayeredLanes(spec.automation.outgoing, spec.automation.incoming, info);
  return {style: info.style, leadDb: leadDb === null ? null : finite(leadDb), maskingDb: masking === null ? null : finite(masking),
    riseOverLouderLu: rise === null ? null : finite(rise), dipUnderQuieterLu: under === null ? null : finite(under),
    lowOverlapDb: Number.isFinite(lanes.lowOverlapDb) ? Math.max(-120, lanes.lowOverlapDb) : -120, lowSumMinDb: Number.isFinite(lanes.lowSumMinDb) ? Math.max(-120, lanes.lowSumMinDb) : -120,
    leadFirst: lanes.leadFirst, lanesOk: lanes.ok};
}

/** Declared EQ gaps in render indices (incoming gaps start at T, outgoing gaps at S). */
function declaredGaps(render: TransitionRender, spec: TransitionSpec): [number, number][] {
  const map = (gaps: readonly BandGap[] | undefined, origin: number) =>
    (gaps ?? []).filter(g => g.band === 'low').map(g => [origin + g.startFrame, origin + g.endFrame] as [number, number]);
  return [...map(spec.automation.incoming.declaredGaps, render.T), ...map(spec.automation.outgoing.declaredGaps, render.S)];
}

/** transition-safety@1 measurements: sample peak, true peak and the sustained low-band rules. */
export function measureSafety(render: TransitionRender, spec: TransitionSpec, truePeakDbtp: number | null): SafetyMeasurements {
  const rate = render.sampleRate, length = render.mix[0]!.length, {S, T, E} = render;
  let samplePeak = 0;
  for (const channel of render.mix) for (let n = 0; n < length; n++) samplePeak = Math.max(samplePeak, Math.abs(channel[n]!));
  const low = (channels: readonly Float64Array[]) => prefix(bandEnergy(channels, rate, 20, EQ_SPLIT.lowMidHz));
  const bFromT = render.bNative.map(c => Float64Array.from(c, (v, n) => n >= T ? v : 0));
  const mix = low(render.mix), a = low(render.aNative), b = low(bFromT);
  // 50 ms cells; a rule fires only when every cell across a 250 ms span breaks it (sustained, not a spike).
  const cell = Math.round(0.05 * rate), run = Math.max(1, Math.round(TRANSITION_SAFETY_THRESHOLDS.sustainMs / 50));
  const span = Math.max(1, E - S), x = (n: number) => Math.max(0, Math.min(1, (n - S) / span));
  const gaps = declaredGaps(render, spec);
  const cells = windows(length, cell, cell, S, E).filter(([s, e]) => s >= S && e <= E);
  const peakTarget = Math.max(1e-30, ...cells.map(([s, e]) => Math.max(windowMean(a, s, e), windowMean(b, s, e))));
  const judgeHole = isSmoothRecipe(spec.recipe);
  // Per cell: rise over the louder native source (-inf when near-silent) and shortfall against the
  // interpolated A-to-B target (+inf when unjudged: near-silent target or inside a declared gap).
  const rises = cells.map(([s, e]) => {
    const louder = Math.max(windowMean(a, s, e), windowMean(b, s, e));
    return louder > 1e-6 * peakTarget ? db(Math.max(1e-30, windowMean(mix, s, e)) / louder) : -Infinity;
  });
  const shortfalls = cells.map(([s, e]) => {
    if (!judgeHole || gaps.some(([g0, g1]) => s < g1 && e > g0)) return Infinity;
    const mid = (s + e) / 2, target = (1 - x(mid)) * windowMean(a, s, e) + x(mid) * windowMean(b, s, e);
    return target > 1e-4 * peakTarget ? db(Math.max(1e-30, windowMean(mix, s, e)) / target) : Infinity;
  });
  let rise: number | null = null, hole: number | null = null;
  for (let k = 0; k + run <= cells.length; k++) {
    const r = Math.min(...rises.slice(k, k + run)), h = Math.max(...shortfalls.slice(k, k + run));
    if (Number.isFinite(r) && (rise === null || r > rise)) rise = r;
    if (Number.isFinite(h) && (hole === null || h < hole)) hole = h;
  }
  return {samplePeak, truePeakDbtp, lowRiseDb: rise, bassHoleDb: judgeHole ? hole : null, bassHoleJudged: judgeHole,
    declaredGapFrames: gaps.reduce((sum, [g0, g1]) => sum + g1 - g0, 0)};
}

/** Pure transition-safety@1 judgement of recorded measurements (re-runnable by validators). */
export function judgeSafety(m: SafetyMeasurements): SafetyVerdict {
  const t = TRANSITION_SAFETY_THRESHOLDS, flags: {metric: SafetyMetric; value: number; threshold: number}[] = [];
  if (m.samplePeak > t.clipSample) flags.push({metric: 'clipping', value: m.samplePeak, threshold: t.clipSample});
  if (m.truePeakDbtp !== null && m.truePeakDbtp > t.truePeakDbtp) flags.push({metric: 'truePeakCeiling', value: m.truePeakDbtp, threshold: t.truePeakDbtp});
  if (m.lowRiseDb !== null && m.lowRiseDb > t.lowRiseDb) flags.push({metric: 'lowRise', value: m.lowRiseDb, threshold: t.lowRiseDb});
  if (m.bassHoleJudged && m.bassHoleDb !== null && m.bassHoleDb < t.bassHoleDb) flags.push({metric: 'bassHole', value: m.bassHoleDb, threshold: t.bassHoleDb});
  return {version: t.version, verdict: flags.length ? 'fail' : 'pass', flags};
}

/** Flags, verdict and an ordering penalty from the versioned thresholds. */
export function judgeTransition(recipe: MixRecipe, m: TransitionMeasurements): Omit<TransitionEvaluation, 'version' | 'thresholds' | 'recipe' | 'bSource' | 'measurements'> {
  const t = MIX_EVALUATION_THRESHOLDS, flags: EvaluationFlag[] = [], unclaimed: EvaluationFlag[] = [];
  const check = (metric: EvaluationMetric, value: number | null, limits: {warn: number; fail?: number}, note?: string,
    into: EvaluationFlag[] = flags) => {
    if (value === null) return;
    const fail = limits.fail !== undefined && value > limits.fail;
    if (fail || value > limits.warn) into.push({metric, level: fail ? 'fail' : 'warn', value,
      threshold: fail ? limits.fail! : limits.warn, ...(note ? {note} : {})});
  };
  check('truePeak', m.truePeakDbtp, t.truePeakDbtp);
  const claims = recipeClaims(recipe);
  const ups = [m.loudness.momentaryMaxUpLu, m.loudness.shortTermMaxUpLu].filter((v): v is number => v !== null);
  const downs = [m.loudness.momentaryMaxDownLu, m.loudness.shortTermMaxDownLu].filter((v): v is number => v !== null).map(v => -v);
  // recipe-claims@2: a layered entry's rise is judged against the louder native song (its continuity claim);
  // the rise over the straight-line interpolation is logged in `unclaimed`. Same thresholds@1 values.
  const layeredRise = claims.layered && m.layered?.riseOverLouderLu !== undefined ? m.layered.riseOverLouderLu : undefined;
  const loud = layeredRise !== undefined ? (layeredRise === null ? [] : [layeredRise]) : claims.loudness === 'dip' ? ups : [...ups, ...downs];
  if (layeredRise !== undefined) check('loudness', ups.length ? Math.max(...ups) : null, t.loudnessLu,
    'rise over the A-to-B interpolation; logged only (a layered entry claims continuity against the louder song)', unclaimed);
  check('loudness', loud.length ? Math.max(...loud) : null, t.loudnessLu, layeredRise !== undefined
    ? 'largest rise over the louder native song (layered-entry continuity claim, recipe-claims@2)'
    : claims.loudness === 'dip'
    ? 'largest rise over the A-to-B interpolation (a dip is this recipe\'s claim)' : 'largest deviation from the A-to-B interpolation, either direction');
  if (claims.loudness === 'dip') {
    const interpolationDip = downs.length ? Math.max(...downs) : null;
    check('loudness', interpolationDip, t.loudnessLu, 'dip below the A-to-B interpolation; thresholds@1 flag logged only (the recipe declares a dip)', unclaimed);
    // recipe-claims@2: a layered entry's dip is measured below the quieter native song (continuity envelope).
    const layeredDip = claims.layered && m.layered?.dipUnderQuieterLu !== undefined ? m.layered.dipUnderQuieterLu : undefined;
    const dip = layeredDip !== undefined ? layeredDip : interpolationDip;
    if (dip !== null && claims.maxDipLu !== undefined && dip > claims.maxDipLu) flags.push({metric: 'loudness', level: 'fail', value: dip,
      threshold: claims.maxDipLu, note: layeredDip !== undefined
        ? `drop below the quieter native song deeper than the declared ${claims.maxDipLu} LU (recipe-claims@2)`
        : `dip deeper than the recipe's declared ${claims.maxDipLu} LU (recipe-claims@1)`});
  }
  check('lowBuildUp', m.lowBuildUp.maxDb, t.lowBuildUpDb, m.lowBuildUp.band ?? undefined);
  if (m.beatPhase.judged) check('beatPhase', m.beatPhase.maxError, t.beatPhase);
  if (m.boundaryFlux.judged) check('boundaryFlux', m.boundaryFlux.excessDb, t.boundaryFluxDb);
  check('sampleJump', m.sampleJumpRatio, t.sampleJumpRatio);
  check('silenceGap', m.silenceGapMs, t.silenceGapMs);
  if (claims.layered) {
    // recipe-claims@2: a layered entry is judged on what it claims; missing evidence fails, it never passes.
    const L = LAYERED_ENTRY_LIMITS, lm = m.layered;
    if (!lm) flags.push({metric: 'layeredLanes', level: 'fail', value: null, threshold: null, note: 'layered-entry measurements are missing'});
    else {
      if (!lm.lanesOk) flags.push({metric: 'layeredLanes', level: 'fail', value: lm.lowOverlapDb, threshold: L.lowOverlapMaxDb,
        note: 'the plan\'s band lanes break the layered-entry rules (low overlap, low continuity or lead order)'});
      if (lm.leadDb !== null && lm.leadDb < L.leadMarginDb) flags.push({metric: 'layeredLead', level: 'fail', value: lm.leadDb,
        threshold: L.leadMarginDb, note: `B's ${lm.style} lead band(s) are not measurably first`});
      if (lm.maskingDb !== null && lm.maskingDb > L.maskingMaxDb) flags.push({metric: 'lowMasking', level: 'fail', value: lm.maskingDb,
        threshold: L.maskingMaxDb, note: 'both songs\' low bands near full level at the same time'});
    }
  }
  if (m.stereoCorrelation !== null && m.stereoCorrelation < t.stereoCorrelation.warn) {
    flags.push({metric: 'stereoCorrelation', level: 'warn', value: m.stereoCorrelation, threshold: t.stereoCorrelation.warn});
  }
  const fails = flags.filter(f => f.level === 'fail').length, warns = flags.length - fails;
  const penalty = 100 * fails + 10 * warns + (loud.length ? Math.max(...loud) / t.loudnessLu.fail : 0) +
    Math.max(0, m.lowBuildUp.maxDb ?? 0) / t.lowBuildUpDb.fail + (m.beatPhase.maxError ?? 0) / t.beatPhase.fail +
    Math.max(0, (m.truePeakDbtp ?? -100) - t.truePeakDbtp.warn);
  return {verdict: fails ? 'fail' : warns ? 'warn' : 'pass', penalty, flags, claims: RECIPE_CLAIMS_VERSION,
    ...(unclaimed.length ? {unclaimed} : {})};
}

/** Render, measure and judge one transition. An invalid automation is a failed evaluation, not a throw. */
export function evaluateTransition(from: MixPcm, to: MixPcm, spec: TransitionSpec,
  analysis?: {readonly from: MixAnalysis; readonly to: MixAnalysis},
  prepared?: {readonly audio: MixPcm; readonly entryFrame: number; readonly outgoingLoop?: MixPcm}): TransitionEvaluation {
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
  return {...base, ...judgeTransition(spec.recipe, measurements), measurements, bSource: render.bSource,
    ...(measurements.safety ? {safety: judgeSafety(measurements.safety)} : {})};
}

/** The renderer's view of a planner proposal. */
export function planTransitionSpec(plan: AutomaticMixPlan): TransitionSpec {
  return {recipe: plan.recipe, fromStartFrame: plan.outgoingEffectSourceFrame ?? plan.fromExitFrame - plan.preRollFrames,
    preRollFrames: plan.preRollFrames, toEntryFrame: plan.toEntryFrame,
    tempoRatio: plan.tempoRatio, automation: plan.automation, ...(plan.levelMatch ? {levelMatch: plan.levelMatch} : {}),
    ...(plan.entryDelayFrames ? {entryDelayFrames: plan.entryDelayFrames} : {}),
    ...(plan.nativeRate ? {nativeRate: plan.nativeRate} : {}), ...(plan.loopExtension ? {loopExtension: plan.loopExtension} : {}),
    ...(plan.outgoingStretch ? {outgoingStretch: plan.outgoingStretch} : {}),
    ...(plan.layered ? {layered: plan.layered} : {})};
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