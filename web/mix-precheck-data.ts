/** Bounded PCM windows for the existing single-plan evaluator. No selection or audio scheduling. */
import type {DecodedRecording} from '../src/web-audio.js';
import {isSmoothRecipe, type AutomaticMixPlan} from '../src/mix-planner.js';
import type {RouteFreePlan} from '../src/mix-transition.js';
import type {MixAnalysis, MixPcm} from '../src/mix-analysis.js';
import {nativeRateInputAt, validateNativeRate} from '../src/time-pitch.js';
import {validateMixAutomation} from '../src/mix-automation.js';
import {MIX_EVALUATION_THRESHOLDS, MIX_EVALUATOR_VERSION, judgeSafety, judgeTransition, planTransitionSpec,
  type TransitionSpec, type TransitionEvaluation} from './mix-evaluator.js';

export const PRECHECK_PROTOCOL = 'live-mix-precheck@1';
export const PRECHECK_LIMITS = Object.freeze({renderSamples: 4_000_000, inputSamples: 12_000_000,
  chunkSamples: 1_048_576, timeoutMs: 8000});
export type PrecheckPlan = AutomaticMixPlan | RouteFreePlan;
export type PrecheckSource = 'from' | 'to' | 'prepared' | 'loop';
export interface PrecheckRequest {
  readonly plan: PrecheckPlan;
  readonly from: DecodedRecording; readonly to: DecodedRecording; readonly incoming: DecodedRecording;
  readonly entryFrame: number; readonly fromGain: number; readonly loopBuffer?: AudioBuffer;
  readonly analysis: {readonly from: MixAnalysis | null; readonly to: MixAnalysis | null};
  /** Existing voice position at S, in output frames since its start. Context only. */
  readonly fromPlayback?: {readonly recording: DecodedRecording; readonly entryFrame: number; readonly elapsedFrames: number};
}
export interface PrecheckCoverage {
  readonly sampleRate: number; readonly frames: number; readonly beforeFrames: number;
  readonly afterFrames: number; readonly nativeJoin: 'none' | 'inside-window' | 'after-window';
  readonly scope: 'DJ plan; manual controls and master output excluded';
}
export interface PrecheckReport {
  readonly version: typeof PRECHECK_PROTOCOL;
  readonly status: 'pass' | 'warn' | 'fail' | 'unavailable';
  readonly reason: string;
  readonly evaluation: TransitionEvaluation | null;
  readonly coverage: PrecheckCoverage | null;
}
export interface PrecheckStream {readonly name: PrecheckSource; readonly frames: number; readonly channels: number;}
export interface PrecheckJob {
  readonly spec: TransitionSpec; readonly rate: number; readonly streams: readonly PrecheckStream[];
  readonly preparedEntry?: number;
  readonly analysis?: {readonly from: MixAnalysis; readonly to: MixAnalysis};
  readonly coverage: PrecheckCoverage;
}
export interface PrecheckWindow {
  readonly job: PrecheckJob;
  /** Each call reacquires source views and copies only one bounded private chunk. */
  copy(name: PrecheckSource, start: number, frames: number): Float32Array[];
}
const check = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
const integer = (n: number): boolean => Number.isSafeInteger(n) && n >= 0;
const frames = (recording: DecodedRecording): number => recording.buffer.length +
  (recording.continuation ? recording.continuation.buffer.length - recording.continuation.sourceFrame : 0);
function checkBuffer(buffer: AudioBuffer, rate: number): void {
  check(buffer.sampleRate === rate && integer(buffer.length) && buffer.length > 0 &&
    [1, 2].includes(buffer.numberOfChannels), 'Pre-check needs matching mono/stereo native buffers.');
}
function sample(data: Float32Array, at: number): number {
  if (at < 0 || at > data.length - 1) return 0;
  const index = Math.floor(at), fraction = at - index;
  return fraction === 0 ? data[index]! : data[index]! * (1 - fraction) + (data[index + 1] ?? 0) * fraction;
}
function range(low: number, high: number, available: number): {start: number; end: number} {
  check(Number.isFinite(low) && Number.isFinite(high) && low <= high, 'Invalid pre-check source range.');
  const start = Math.max(0, Math.floor(low)), end = Math.min(available, Math.ceil(high) + 2);
  check(start < end, 'The selected transition has no source samples in its check window.');
  return {start, end};
}
function rebase(analysis: MixAnalysis, offset: number): MixAnalysis {
  check(analysis.beatGrid.frames.length <= 8192 && analysis.beatGrid.frames.every(integer),
    'Pre-check needs valid measured beat coordinates.');
  return {...analysis, beatGrid: {...analysis.beatGrid, frames: analysis.beatGrid.frames.map(f => f - offset)}};
}

/** Copy exactly the evaluator's S-context..E+context inputs, including the actual prepared B seam. */
export function makePrecheckWindow(request: PrecheckRequest): PrecheckWindow {
  const {plan, from, to, incoming} = request, rate = from.buffer.sampleRate;
  check(Number.isInteger(rate) && rate >= 8000 && rate <= 192000, 'Unsupported pre-check sample rate.');
  for (const recording of [from, to, incoming]) {
    checkBuffer(recording.buffer, rate);
    if (recording.continuation) {
      checkBuffer(recording.continuation.buffer, rate);
      check(integer(recording.continuation.sourceFrame) && recording.continuation.sourceFrame < recording.continuation.buffer.length,
        'Invalid native continuation in pre-check.');
    }
  }
  check(from.asset.file.sha256 !== to.asset.file.sha256 || from.asset.id !== to.asset.id,
    'A pre-check needs two selected songs.');
  check(incoming.asset.id === to.asset.id && incoming.asset.file.sha256 === to.asset.file.sha256,
    'Prepared B does not belong to the selected incoming song.');
  const toGain = 'levelMatch' in plan ? plan.levelMatch?.toGain ?? 1 : 1;
  check([request.fromGain, toGain].every(g => Number.isFinite(g) && g > 0 && g <= 4), 'Invalid captured fixed source gain.');
  const original: TransitionSpec = {...(plan.kind === 'mix' ? planTransitionSpec(plan) : {
    // S21: the route-free echo reset is judged as the echo-out recipe it is (native B, intended change).
    recipe: plan.recipe === 'fallback-cut' ? 'cut' : plan.recipe === 'fallback-echo-reset' ? 'echo-out' : 'blend',
    fromStartFrame: plan.fromExitFrame - plan.preRollFrames,
    preRollFrames: plan.preRollFrames, toEntryFrame: plan.toEntryFrame, tempoRatio: 1, automation: plan.automation
  } as TransitionSpec), fixedGains: {from: request.fromGain, to: toGain}};
  validateMixAutomation(original.automation.outgoing, rate); validateMixAutomation(original.automation.incoming, rate);
  check(integer(original.fromStartFrame) && original.fromStartFrame < from.buffer.length &&
    integer(original.toEntryFrame) && original.toEntryFrame < to.buffer.length &&
    integer(original.preRollFrames) && integer(original.entryDelayFrames ?? 0) &&
    Number.isFinite(original.tempoRatio) && original.tempoRatio > 0,
  'Invalid selected pre-check coordinates.');
  if (original.nativeRate) {
    validateNativeRate(original.nativeRate.outgoing, rate);
    if (original.nativeRate.incoming) validateNativeRate(original.nativeRate.incoming, rate);
  }
  const context = Math.round(MIX_EVALUATION_THRESHOLDS.contextSeconds * rate);
  const S = Math.min(context, original.fromStartFrame), T = S + original.preRollFrames + (original.entryDelayFrames ?? 0);
  const E = Math.max(S + original.automation.outgoing.durationFrames, T + original.automation.incoming.durationFrames);
  const length = E + context, channels = Math.max(from.buffer.numberOfChannels, to.buffer.numberOfChannels, incoming.buffer.numberOfChannels);
  check(integer(length) && length * channels <= PRECHECK_LIMITS.renderSamples,
    'The selected transition exceeds the bounded live pre-check window.');
  const loop = original.loopExtension, stretch = original.outgoingStretch;
  check(!!(loop || stretch) === !!request.loopBuffer, 'The selected finite loop or outgoing tempo ramp needs its actual prepared PCM.');
  if (stretch) {
    // Part B: the dual tempo ramp's outgoing WSOLA render replaces A at S, like a finite loop.
    check(!loop && integer(stretch.inputFrames) && stretch.inputFrames > 0 && stretch.sourceStartFrame === original.fromStartFrame &&
      stretch.sourceStartFrame + stretch.inputFrames <= from.buffer.length, 'Invalid selected outgoing tempo-ramp coordinates.');
    checkBuffer(request.loopBuffer!, rate);
    check(request.loopBuffer!.length === original.automation.outgoing.durationFrames &&
      request.loopBuffer!.numberOfChannels === from.buffer.numberOfChannels, 'Prepared outgoing tempo-ramp dimensions differ.');
  }
  if (loop) {
    check(integer(loop.startFrame) && loop.startFrame < loop.endFrame && loop.endFrame === original.fromStartFrame &&
      loop.endFrame - loop.startFrame === loop.frames && loop.frames === original.entryDelayFrames,
    'Invalid selected loop coordinates.');
    checkBuffer(request.loopBuffer!, rate);
    check(request.loopBuffer!.length === original.automation.outgoing.durationFrames &&
      request.loopBuffer!.numberOfChannels === from.buffer.numberOfChannels, 'Prepared loop dimensions differ.');
  }
  const aLast = original.fromStartFrame + (original.nativeRate
    ? nativeRateInputAt(original.nativeRate.outgoing, length - 1 - S) : length - 1 - S);
  const a = range(Math.min(original.fromStartFrame - S, loop?.startFrame ?? Infinity),
    Math.max(aLast, loop ? loop.endFrame + original.automation.incoming.durationFrames - 1 : 0,
      stretch ? stretch.sourceStartFrame + stretch.inputFrames - 1 : 0), from.buffer.length);
  const bInput = (k: number): number => original.toEntryFrame + (original.nativeRate?.incoming
    ? nativeRateInputAt(original.nativeRate.incoming, k) : k * original.tempoRatio);
  const b = range(bInput(-T), bInput(length - 1 - T), to.buffer.length);
  const usePrepared = !!incoming.processed;
  check(!(loop || stretch) || usePrepared, 'The selected loop or outgoing tempo ramp requires its prepared B entry.');
  check(!usePrepared || !original.nativeRate?.incoming, 'Prepared and native-rate B cannot both own the entry.');
  check(integer(request.entryFrame) && request.entryFrame < incoming.buffer.length, 'Invalid prepared B entry.');
  const prepared = usePrepared ? range(request.entryFrame - T, request.entryFrame + length - 1 - T, frames(incoming)) : null;
  const spec: TransitionSpec = {...original, fromStartFrame: original.fromStartFrame - a.start,
    toEntryFrame: original.toEntryFrame - b.start,
    ...(loop ? {loopExtension: {...loop, startFrame: loop.startFrame - a.start, endFrame: loop.endFrame - a.start}} : {}),
    ...(stretch ? {outgoingStretch: {...stretch, sourceStartFrame: stretch.sourceStartFrame - a.start}} : {})};
  const streams: PrecheckStream[] = [{name: 'from', frames: a.end - a.start, channels: from.buffer.numberOfChannels},
    {name: 'to', frames: b.end - b.start, channels: to.buffer.numberOfChannels}];
  if (prepared) streams.push({name: 'prepared', frames: prepared.end - prepared.start, channels: incoming.buffer.numberOfChannels});
  if (request.loopBuffer) streams.push({name: 'loop', frames: request.loopBuffer.length, channels: request.loopBuffer.numberOfChannels});
  check(streams.reduce((n, stream) => n + stream.frames * stream.channels, 0) <= PRECHECK_LIMITS.inputSamples,
    'The selected transition exceeds the bounded pre-check input budget.');
  const joinAt = incoming.continuation ? T + incoming.buffer.length - request.entryFrame : null;
  const coverage: PrecheckCoverage = {sampleRate: rate, frames: length, beforeFrames: S, afterFrames: context,
    nativeJoin: joinAt === null ? 'none' : joinAt < length ? 'inside-window' : 'after-window',
    scope: 'DJ plan; manual controls and master output excluded'};
  const job: PrecheckJob = {spec, rate, streams, coverage,
    ...(prepared ? {preparedEntry: request.entryFrame - prepared.start} : {}),
    ...(request.analysis.from && request.analysis.to ? {analysis: {
      from: rebase(request.analysis.from, a.start), to: rebase(request.analysis.to, b.start)}} : {})};
  const playback = request.fromPlayback;
  if (playback) {
    checkBuffer(playback.recording.buffer, rate);
    if (playback.recording.continuation) checkBuffer(playback.recording.continuation.buffer, rate);
    check(integer(playback.entryFrame) && integer(playback.elapsedFrames), 'Invalid outgoing voice position.');
    if (playback.recording.nativeRate) {
      validateNativeRate(playback.recording.nativeRate, rate);
      check(playback.elapsedFrames >= playback.recording.nativeRate.frames,
        'The previous native-rate entry must settle before another checked transition.');
    }
  }
  return {job, copy(name, start, count) {
    const stream = streams.find(s => s.name === name);
    check(stream && integer(start) && integer(count) && count > 0 && start + count <= stream.frames &&
      count * stream.channels <= PRECHECK_LIMITS.chunkSamples, 'Invalid bounded pre-check chunk.');
    const source = name === 'from' ? from.buffer : name === 'to' ? to.buffer : name === 'loop' ? request.loopBuffer! : incoming.buffer;
    const offset = name === 'from' ? a.start : name === 'to' ? b.start : name === 'prepared' ? prepared!.start : 0;
    return Array.from({length: stream!.channels}, (_, ch) => {
      // Views are reacquired for each chunk because the live owner may acquire its native buffer.
      const data = source.getChannelData(ch), out = new Float32Array(count), at = offset + start;
      const continuation = name === 'prepared' ? incoming.continuation : undefined;
      const nativeB = continuation?.buffer.getChannelData(ch);
      for (let i = 0; i < count; i++) {
        const f = at + i;
        out[i] = continuation && f >= source.length ? nativeB![continuation.sourceFrame + f - source.length] ?? 0 : data[f] ?? 0;
      }
      if (name === 'from' && playback && at < original.fromStartFrame && at + count > original.fromStartFrame - S) {
        const voice = playback.recording, main = voice.buffer.getChannelData(ch), next = voice.continuation?.buffer.getChannelData(ch);
        for (let i = Math.max(0, original.fromStartFrame - S - at); i < Math.min(count, original.fromStartFrame - at); i++) {
          const elapsed = playback.elapsedFrames + at + i - original.fromStartFrame;
          const f = playback.entryFrame + (voice.nativeRate ? nativeRateInputAt(voice.nativeRate, elapsed) : elapsed);
          out[i] = elapsed < 0 ? 0 : voice.continuation && f >= voice.buffer.length
            ? sample(next!, voice.continuation.sourceFrame + f - voice.buffer.length) : sample(main, f);
        }
      }
      return out;
    });
  }};
}

/** A worker reply must still match this evaluator, plan and unchanged judgment function. */
export function validatePrecheckEvaluation(value: unknown, recipe: TransitionSpec['recipe'],
  expected?: {source: NonNullable<TransitionEvaluation['bSource']>; frames: number}): TransitionEvaluation {
  check(value && typeof value === 'object', 'Invalid pre-check reply.');
  const evaluation = value as TransitionEvaluation;
  check(evaluation.version === MIX_EVALUATOR_VERSION && evaluation.thresholds === MIX_EVALUATION_THRESHOLDS.version &&
    evaluation.recipe === recipe && ['pass', 'warn', 'fail'].includes(evaluation.verdict) && Array.isArray(evaluation.flags) &&
    evaluation.flags.length <= 32 && Number.isFinite(evaluation.penalty), 'Pre-check reply identity differs.');
  const validateNumbers = (data: unknown, depth = 0): void => {
    check(depth <= 10, 'Pre-check reply is too deep.');
    if (typeof data === 'number') check(Number.isFinite(data), 'Non-finite pre-check measurement.');
    else if (Array.isArray(data)) { check(data.length <= 64, 'Oversized pre-check reply.'); data.forEach(v => validateNumbers(v, depth + 1)); }
    else if (data && typeof data === 'object') { const values = Object.values(data); check(values.length <= 64, 'Oversized pre-check object.'); values.forEach(v => validateNumbers(v, depth + 1)); }
    else if (typeof data === 'string') check(data.length <= 4096, 'Oversized pre-check text.');
  };
  validateNumbers(evaluation);
  if (evaluation.measurements === null) {
    check(evaluation.verdict === 'fail' && evaluation.bSource === null && evaluation.flags.some(f => f.metric === 'automation' && f.level === 'fail'),
      'An unmeasured pre-check cannot pass.');
  } else {
    const m = evaluation.measurements;
    const nullable = (n: unknown): boolean => n === null || typeof n === 'number' && Number.isFinite(n);
    check(nullable(m.truePeakDbtp) && m.loudness && ['momentaryMaxUpLu', 'momentaryMaxDownLu', 'shortTermMaxUpLu', 'shortTermMaxDownLu']
      .every(key => nullable(m.loudness[key as keyof typeof m.loudness])) && m.lowBuildUp && nullable(m.lowBuildUp.maxDb) &&
      (m.lowBuildUp.band === null || typeof m.lowBuildUp.band === 'string') &&
      m.beatPhase && nullable(m.beatPhase.maxError) && nullable(m.beatPhase.meanError) &&
      m.boundaryFlux && nullable(m.boundaryFlux.excessDb) &&
      (m.boundaryFlux.atFrame === null || integer(m.boundaryFlux.atFrame)) &&
      nullable(m.sampleJumpRatio) && nullable(m.stereoCorrelation) && m.silenceGapMs >= 0,
    'Pre-check measurements are missing or invalid.');
    check(typeof m.beatPhase?.judged === 'boolean' && typeof m.boundaryFlux?.judged === 'boolean' &&
      integer(m.beatPhase.beats) && Number.isFinite(m.silenceGapMs) &&
      ['native', 'prepared', 'linear-resample', 'native-rate-model'].includes(evaluation.bSource!),
    'Pre-check measurements are incomplete.');
    check(m.boundaryFlux.judged === isSmoothRecipe(recipe) &&
      (m.boundaryFlux.excessDb === null || m.boundaryFlux.excessDb >= 0) &&
      (m.lowBuildUp.maxDb === null ? m.lowBuildUp.band === null : ['25-60 Hz', '60-120 Hz', '120-250 Hz'].includes(m.lowBuildUp.band!)) &&
      Number.isSafeInteger(m.silenceGapMs) &&
      (m.stereoCorrelation === null || Math.abs(m.stereoCorrelation) <= 1 + 1e-8),
    'Pre-check measurement semantics differ.');
    check(m.beatPhase.judged ? m.beatPhase.beats > 0 && m.beatPhase.maxError !== null &&
      m.beatPhase.meanError !== null && m.beatPhase.meanError >= 0 && m.beatPhase.maxError >= m.beatPhase.meanError - 1e-12
      : m.beatPhase.beats === 0 && m.beatPhase.maxError === null && m.beatPhase.meanError === null &&
        typeof m.beatPhase.reason === 'string' && m.beatPhase.reason.length > 0, 'Pre-check beat judgment is incomplete.');
    if (expected) check(evaluation.bSource === expected.source &&
      (m.boundaryFlux.atFrame === null || m.boundaryFlux.atFrame < expected.frames), 'Pre-check source or coverage differs.');
    const judged = judgeTransition(recipe, m);
    check(evaluation.verdict === judged.verdict && evaluation.penalty === judged.penalty &&
      JSON.stringify(evaluation.flags) === JSON.stringify(judged.flags), 'Pre-check judgment differs from the fixed thresholds.');
    // S21: the safety verdict is re-judged from its own recorded measurements.
    check(!!m.safety === !!evaluation.safety, 'Pre-check safety evidence is incomplete.');
    if (m.safety) {
      const s = m.safety, nullable = (n: unknown): boolean => n === null || typeof n === 'number' && Number.isFinite(n);
      check(Number.isFinite(s.samplePeak) && s.samplePeak >= 0 && nullable(s.truePeakDbtp) && nullable(s.lowRiseDb) &&
        nullable(s.bassHoleDb) && s.bassHoleJudged === isSmoothRecipe(recipe) && (s.bassHoleJudged || s.bassHoleDb === null) &&
        Number.isSafeInteger(s.declaredGapFrames) && s.declaredGapFrames >= 0, 'Pre-check safety measurements are invalid.');
      check(JSON.stringify(evaluation.safety) === JSON.stringify(judgeSafety(s)), 'Pre-check safety judgment differs from transition-safety@1.');
    }
  }
  return evaluation;
}
export type PrecheckRuntime = (request: PrecheckRequest, signal?: AbortSignal) => Promise<PrecheckReport>;
export const precheckLabel = (report: PrecheckReport): string => 'DJ plan check ' + report.status.toUpperCase() +
  (report.reason ? ': ' + report.reason : '') + (report.coverage?.nativeJoin === 'after-window' ? '; later native join is outside this check' : '');
