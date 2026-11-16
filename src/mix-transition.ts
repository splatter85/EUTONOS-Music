import {analyzeMixPairInWorker, analyzeMixSongInWorker, monoAnalysisCopy, prepareTimePitch} from './mix-prepare.js';
import {MIX_ANALYSIS_VERSION, type MixAnalysis, type MixAnalysisOptions, type MixPcm} from './mix-analysis.js';
import {planAutomaticMix, type AutomaticMixPlan, type MixDecision, type MixPlannerOptions} from './mix-planner.js';
import {outputFrameAtSource, TIME_PITCH_LIMITS, type PreparedTimePitch, type TimePitchOptions} from './time-pitch.js';
import {cleanCutAutomation, validateMixAutomation, type MixAutomation, type MixAutomationPoint} from './mix-automation.js';
import type {AudioAsset} from './pack-types.js';
import type {DecodedRecording} from './web-audio.js';

export interface MixPreparationRuntime {
  analyze(from: MixPcm, to: MixPcm, signal?: AbortSignal): Promise<{from: MixAnalysis; to: MixAnalysis}>;
  render(audio: MixPcm, options: TimePitchOptions, signal?: AbortSignal): Promise<PreparedTimePitch>;
  /** S18 optional: one song (mono). Without it, set mode analyzes the mono copy through `analyze`. */
  analyzeOne?(audio: MixPcm, signal?: AbortSignal, options?: MixAnalysisOptions): Promise<MixAnalysis>;
}
export const browserMixPreparation: MixPreparationRuntime = {
  analyze: analyzeMixPairInWorker,
  render: prepareTimePitch,
  analyzeOne: analyzeMixSongInWorker,
};
export interface ReadyMixTransition {
  readonly kind: 'ready'; readonly plan: AutomaticMixPlan;
  readonly incoming: DecodedRecording; readonly entryFrame: number;
  readonly processed: PreparedTimePitch | {
    readonly processor: 'native-pcm@1'; readonly audio: MixPcm;
    readonly mapping: PreparedTimePitch['mapping']; readonly metrics: null;
  };
  readonly analysis: {readonly from: MixAnalysis; readonly to: MixAnalysis};
}

/** Choose a later A exit without changing the already rendered B entry or time map. */
export function replanPreparedMix(ready: ReadyMixTransition, minimumFromFrame: number): MixDecision {
  const {plan, analysis} = ready;
  return planAutomaticMix(analysis.from,
    {...analysis.to, mixIn: analysis.to.mixIn.filter(c => c.frame === plan.toEntryFrame)},
    {minimumFromFrame, recipe: plan.recipe, echoContentConfirmed: plan.echoContentConfirmed ?? false,
      overlapBeats: plan.overlapBeats, pitchSemitones: plan.pitchSemitones,
      returnToOriginalTempo: plan.returnToOriginalTempo});
}
export type PreparedMixDecision = ReadyMixTransition | {readonly kind: 'fallback'; readonly reason: string};

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Mix preparation cancelled.');
}
function pcm(recording: DecodedRecording): MixPcm {
  return {sampleRate: recording.buffer.sampleRate,
    channels: Array.from({length: recording.buffer.numberOfChannels}, (_, i) => recording.buffer.getChannelData(i))};
}

/**
 * Preparation only: the browser's heavy analysis and rendering run in disposable workers.
 * This function never starts a source or changes the owner clock. A ready result binds the
 * original asset identity to a separate processed buffer; no manifest cue is rewritten.
 */
export async function prepareMixTransition(context: BaseAudioContext, from: DecodedRecording,
  to: DecodedRecording, options: MixPlannerOptions = {}, signal?: AbortSignal,
  runtime: MixPreparationRuntime = browserMixPreparation): Promise<PreparedMixDecision> {
  // Own options before the first asynchronous boundary.
  options = {...options};
  checkAbort(signal);
  const a = pcm(from), b = pcm(to);
  const analysis = await runtime.analyze(a, b, signal);
  checkAbort(signal);
  if (analysis.from.frames !== from.buffer.length || analysis.to.frames !== to.buffer.length ||
    analysis.from.sampleRate !== context.sampleRate || analysis.to.sampleRate !== context.sampleRate) {
    throw new Error('Analysis does not match the prepared recording frames/sample rate.');
  }
  const plan = planAutomaticMix(analysis.from, analysis.to, options);
  if (plan.kind === 'fallback') return plan;
  return renderPlannedMix(context, from, to, plan, analysis, signal, runtime);
}

/**
 * Prepare B for an already selected plan: native B for cut/echo, a validated WSOLA render for
 * blend. Shared by the authored pair path and the S18 set path; it never schedules audio.
 * `from` supplies only A's length for the native tail check; in set mode it is A's native
 * length even when A plays from a processed buffer.
 */
export async function renderPlannedMix(context: BaseAudioContext,
  from: {readonly buffer: {readonly length: number}}, to: DecodedRecording, plan: AutomaticMixPlan,
  analysis: {readonly from: MixAnalysis; readonly to: MixAnalysis}, signal?: AbortSignal,
  runtime: MixPreparationRuntime = browserMixPreparation): Promise<ReadyMixTransition> {
  checkAbort(signal);
  const b = pcm(to);
  if (plan.recipe !== 'blend') {
    // Native B is already decoded: do not fabricate a WSOLA render/receipt.
    for (const channel of b.channels) for (const value of channel) {
      if (!Number.isFinite(value) || Math.abs(value) > 0.891251) {
        throw new Error('Native mix audio failed peak/finite validation.');
      }
    }
    if (plan.toEntryFrame + plan.overlapFrames > to.buffer.length ||
        plan.fromExitFrame + plan.overlapFrames > from.buffer.length) {
      throw new Error('Native mix lifetime does not cover the tail.');
    }
    const buffer = context.createBuffer(to.buffer.numberOfChannels, to.buffer.length, context.sampleRate);
    b.channels.forEach((channel, i) => buffer.copyToChannel(new Float32Array(channel), i));
    const nativeAudio = pcm({asset: to.asset, buffer});
    checkAbort(signal);
    return {kind: 'ready', plan, entryFrame: plan.toEntryFrame, analysis,
      incoming: {asset: to.asset, buffer},
      processed: {processor: 'native-pcm@1', audio: nativeAudio, metrics: null,
        mapping: {inputFrames: buffer.length, outputFrames: buffer.length,
          tempoRatio: 1, pitchSemitones: 0, returnToOriginal: null}}};
  }
  const returnToOriginal = plan.returnToOriginalTempo ? {
    afterFrames: Math.round(plan.toEntryFrame / plan.tempoRatio) + plan.overlapFrames,
    rampFrames: Math.round(4 * 60 * plan.sampleRate / plan.fromBpm),
  } : undefined;
  const renderOptions: TimePitchOptions = {tempoRatio: plan.tempoRatio, pitchSemitones: plan.pitchSemitones,
    ...(returnToOriginal ? {returnToOriginal} : {})};
  const processed = await runtime.render(b, renderOptions, signal);
  checkAbort(signal);
  if (processed.processor !== 'eutonos-wsola@1' || processed.audio.sampleRate !== context.sampleRate ||
    processed.audio.channels.length !== to.buffer.numberOfChannels ||
    processed.mapping.inputFrames !== to.buffer.length ||
    !Number.isSafeInteger(processed.mapping.outputFrames) || processed.mapping.outputFrames < 1 ||
    processed.audio.channels.some(c => !(c instanceof Float32Array) || c.length !== processed.mapping.outputFrames)) {
    throw new Error('Prepared mix audio does not match the source or processor contract.');
  }
  const actualReturn = processed.mapping.returnToOriginal;
  if (processed.mapping.tempoRatio !== renderOptions.tempoRatio ||
      processed.mapping.pitchSemitones !== renderOptions.pitchSemitones ||
      (returnToOriginal ? !actualReturn || actualReturn.afterFrames !== returnToOriginal.afterFrames ||
        actualReturn.rampFrames !== returnToOriginal.rampFrames : actualReturn !== null)) {
    throw new Error('Prepared mix transformation does not match the selected plan.');
  }
  const ratio = plan.tempoRatio;
  const expectedFrames = returnToOriginal
    ? Math.round(returnToOriginal.afterFrames + returnToOriginal.rampFrames +
      (to.buffer.length - ratio * returnToOriginal.afterFrames) - (ratio + 1) * returnToOriginal.rampFrames / 2)
    : Math.round(to.buffer.length / ratio);
  if (processed.mapping.outputFrames !== expectedFrames) {
    throw new Error('Prepared mix length does not match the selected time map.');
  }
  // Independent boundary validation before allocating native playback nodes.
  for (const channel of processed.audio.channels) for (const value of channel) {
    if (!Number.isFinite(value) || Math.abs(value) > 0.891251) throw new Error('Prepared mix audio failed peak/finite validation.');
  }
  const entryFrame = outputFrameAtSource(processed.mapping, plan.toEntryFrame);
  if (!Number.isSafeInteger(entryFrame) || entryFrame < 0 ||
      entryFrame + plan.overlapFrames > processed.mapping.outputFrames) {
    throw new Error('Processed entry/overlap exceeds the prepared audio.');
  }
  const buffer = context.createBuffer(processed.audio.channels.length, processed.mapping.outputFrames, context.sampleRate);
  processed.audio.channels.forEach((channel, i) => buffer.copyToChannel(new Float32Array(channel), i));
  checkAbort(signal);
  return {kind: 'ready', plan, entryFrame, processed, analysis,
    incoming: {asset: to.asset, buffer, processed: {sourceFrames: to.buffer.length,
      outputFrames: buffer.length, algorithm: processed.processor}}};
}

// ---------------------------------------------------------------------------------------------
// S18 set mode: per-song analysis cache, bar grids, boundaries and route-free fallbacks.
// Everything here is plan data; the player alone schedules audio on its single clock.
// ---------------------------------------------------------------------------------------------

export type SongAnalysisResult = {readonly ok: true; readonly analysis: MixAnalysis} |
  {readonly ok: false; readonly reason: string};

function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error('Mix preparation cancelled.'));
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error('Mix preparation cancelled.'));
    signal.addEventListener('abort', abort, {once: true});
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/**
 * Session-local, bounded analysis cache. The key binds the audited audio hash, the analysis
 * version, the output rate, the mono downmix and the requested-BPM hint, so a changed song,
 * analyser or rate never reuses an old result. A cancelled caller does not cancel a shared
 * analysis; failures are cached as explicit unavailable results.
 */
export class MixAnalysisCache {
  private readonly entries = new Map<string, Promise<SongAnalysisResult>>();
  constructor(readonly maxEntries = 64) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 2 || maxEntries > 256) throw new Error('Invalid analysis cache size.');
  }
  static key(asset: AudioAsset, sampleRate: number): string {
    return `${asset.file.sha256}:${MIX_ANALYSIS_VERSION}:${sampleRate}:mono:${asset.timing?.bpm ?? 'none'}`;
  }
  get size(): number { return this.entries.size; }
  has(asset: AudioAsset, sampleRate: number): boolean { return this.entries.has(MixAnalysisCache.key(asset, sampleRate)); }
  analyze(recording: DecodedRecording, runtime: MixPreparationRuntime, signal?: AbortSignal): Promise<SongAnalysisResult> {
    const {asset, buffer} = recording;
    if (recording.processed) return Promise.reject(new Error('Analyze the native recording, never a processed render.'));
    const key = MixAnalysisCache.key(asset, buffer.sampleRate);
    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key); this.entries.set(key, entry); // most recently used last
    } else {
      entry = (async (): Promise<SongAnalysisResult> => {
        try {
          const channels = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
          const options: MixAnalysisOptions = asset.timing ? {generationBpm: asset.timing.bpm} : {};
          let analysis: MixAnalysis;
          if (runtime.analyzeOne) analysis = await runtime.analyzeOne({sampleRate: buffer.sampleRate, channels}, undefined, options);
          else {
            const mono = monoAnalysisCopy({sampleRate: buffer.sampleRate, channels});
            analysis = (await runtime.analyze(mono, mono)).from;
          }
          if (analysis.version !== MIX_ANALYSIS_VERSION || analysis.frames !== buffer.length ||
            analysis.sampleRate !== buffer.sampleRate) throw new Error('Analysis does not match the decoded song.');
          return {ok: true, analysis};
        } catch (error) {
          return {ok: false, reason: error instanceof Error ? error.message : String(error)};
        }
      })();
      this.entries.set(key, entry);
      while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    }
    return raceAbort(entry, signal);
  }
}

/** Measured grids need the same tempo and downbeat confidence as the planner's cut recipe. */
export const SET_GRID_LIMITS = Object.freeze({tempoConfidence: 0.65, downbeatConfidence: 0.65});
export interface SetBarGrid {
  /** `requested` means the producer's requested BPM at its first downbeat: labelled, never measured. */
  readonly source: 'measured' | 'requested';
  readonly bpm: number;
  readonly barFrames: number;
  /** Known downbeats in native song frames; later bars extrapolate at `barFrames`. */
  readonly downbeats: readonly number[];
}
export function setBarGrid(asset: AudioAsset, analysis: MixAnalysis | null, sampleRate: number): SetBarGrid {
  const structure = analysis?.structure;
  if (analysis && structure && analysis.tempo.bpm !== null && analysis.tempo.confidence >= SET_GRID_LIMITS.tempoConfidence &&
    structure.downbeatConfidence >= SET_GRID_LIMITS.downbeatConfidence && structure.downbeatFrames.length >= 2) {
    return {source: 'measured', bpm: analysis.tempo.bpm, barFrames: 4 * 60 * sampleRate / analysis.tempo.bpm,
      downbeats: [...structure.downbeatFrames]};
  }
  const timing = asset.timing;
  if (!timing || !(timing.bpm > 0)) throw new Error(`Song ${asset.id} has neither a measured nor a requested grid.`);
  return {source: 'requested', bpm: timing.bpm, barFrames: 4 * 60 * sampleRate / timing.bpm,
    downbeats: [Math.round(timing.first_downbeat_frame * sampleRate / asset.file.sample_rate)]};
}
export function downbeatAt(grid: SetBarGrid, bar: number): number {
  const known = grid.downbeats.length;
  if (bar < known) return grid.downbeats[Math.max(0, bar)]!;
  return Math.round(grid.downbeats[known - 1]! + (bar - known + 1) * grid.barFrames);
}
/** Smallest bar index whose downbeat is at or after `frame`. */
export function barAtOrAfter(grid: SetBarGrid, frame: number): number {
  if (frame <= grid.downbeats[0]!) return 0;
  const known = grid.downbeats.findIndex(d => d >= frame);
  if (known >= 0) return known;
  const last = grid.downbeats.length - 1;
  let bar = last + Math.max(0, Math.ceil((frame - grid.downbeats[last]!) / grid.barFrames));
  while (downbeatAt(grid, bar) < frame) bar++;
  while (bar > 0 && downbeatAt(grid, bar - 1) >= frame) bar--;
  return bar;
}
/** The first bar `anchorBar + k * bars` (k >= 0) whose downbeat is at or after `earliestFrame`. */
export function nextBoundary(grid: SetBarGrid, anchorBar: number, bars: number,
  earliestFrame: number): {bar: number; frame: number} {
  if (!Number.isSafeInteger(anchorBar) || anchorBar < 0 || !Number.isSafeInteger(bars) || bars < 1) {
    throw new Error('Invalid set boundary.');
  }
  const first = Math.max(anchorBar, barAtOrAfter(grid, earliestFrame));
  let bar = anchorBar + Math.ceil((first - anchorBar) / bars) * bars;
  while (downbeatAt(grid, bar) < earliestFrame) bar += bars;
  return {bar, frame: downbeatAt(grid, bar)};
}

export const ROUTE_FREE_LIMITS = Object.freeze({
  /** Treated as the same tempo: four-bar crossfade. */
  equalTempo: 0.005,
  /** Above this tempo difference a crossfade would drift: clean cut instead. */
  crossfadeTempo: 0.08,
  equalTempoBars: 4, nearTempoBars: 1,
});
export type RouteFreeRecipe = 'fallback-crossfade' | 'fallback-cut';
export interface RouteFreePlan {
  readonly kind: 'route-free'; readonly recipe: RouteFreeRecipe;
  readonly fromExitFrame: number; readonly toEntryFrame: number;
  readonly overlapFrames: number; readonly preRollFrames: 0; readonly bars: number;
  readonly fromBpm: number; readonly toBpm: number;
  /** B always plays at its native tempo here; this is the tempo change heard at the handover. */
  readonly tempoChange: number;
  readonly fromGrid: SetBarGrid['source']; readonly toGrid: SetBarGrid['source'];
  readonly automation: {readonly outgoing: MixAutomation; readonly incoming: MixAutomation};
  readonly reason: string;
}

/** Equal-power (sin/cos) gain lanes with neutral filters, as 17-point linear segments. */
export function equalPowerCrossfade(durationFrames: number, sampleRate: number): {outgoing: MixAutomation; incoming: MixAutomation} {
  if (!Number.isSafeInteger(durationFrames) || durationFrames < 16) throw new Error('A crossfade needs at least 16 frames.');
  const steps = 16;
  const points = (fn: (t: number) => number): MixAutomationPoint[] => Array.from({length: steps + 1}, (_, i) => ({
    frame: i === steps ? durationFrames : Math.round(i * durationFrames / steps),
    value: Math.min(1, Math.max(0, fn(i / steps)))}));
  const neutral = {durationFrames,
    lowShelfDb: [{frame: 0, value: 0}, {frame: durationFrames, value: 0}],
    highPassHz: [{frame: 0, value: 0}, {frame: durationFrames, value: 0}],
    lowPassHz: [{frame: 0, value: sampleRate / 2}, {frame: durationFrames, value: sampleRate / 2}]};
  const outgoing: MixAutomation = {...neutral, gain: points(t => t >= 1 ? 0 : Math.cos(t * Math.PI / 2))};
  const incoming: MixAutomation = {...neutral, gain: points(t => t <= 0 ? 0 : t >= 1 ? 1 : Math.sin(t * Math.PI / 2))};
  validateMixAutomation(outgoing, sampleRate); validateMixAutomation(incoming, sampleRate);
  return {outgoing, incoming};
}

/**
 * Route-free set fallback at an exact A downbeat: an equal-power crossfade when the tempi are
 * close (4 bars when equal, 1 bar within 8%), otherwise a 10 ms clean cut onto B's first
 * downbeat. B is never time-stretched here and no authored route is consulted.
 */
export function planRouteFreeTransition(from: {readonly grid: SetBarGrid; readonly frames: number},
  to: {readonly grid: SetBarGrid; readonly frames: number}, exitFrame: number,
  sampleRate: number): RouteFreePlan | {readonly kind: 'unavailable'; readonly reason: string} {
  const tempoChange = to.grid.bpm / from.grid.bpm, gap = Math.abs(tempoChange - 1);
  const entry = to.grid.downbeats[0]!;
  const options: number[] = gap < ROUTE_FREE_LIMITS.equalTempo
    ? [ROUTE_FREE_LIMITS.equalTempoBars, ROUTE_FREE_LIMITS.nearTempoBars, 0]
    : gap <= ROUTE_FREE_LIMITS.crossfadeTempo ? [ROUTE_FREE_LIMITS.nearTempoBars, 0] : [0];
  for (const bars of options) {
    const automation = bars ? equalPowerCrossfade(Math.round(bars * from.grid.barFrames), sampleRate)
      : cleanCutAutomation(sampleRate);
    const overlapFrames = automation.incoming.durationFrames;
    if (exitFrame < 0 || exitFrame + overlapFrames > from.frames || entry + overlapFrames > to.frames) continue;
    const pct = `${tempoChange >= 1 ? '+' : ''}${((tempoChange - 1) * 100).toFixed(1)}%`;
    return {kind: 'route-free', recipe: bars ? 'fallback-crossfade' : 'fallback-cut', fromExitFrame: exitFrame,
      toEntryFrame: entry, overlapFrames, preRollFrames: 0, bars, fromBpm: from.grid.bpm, toBpm: to.grid.bpm,
      tempoChange, fromGrid: from.grid.source, toGrid: to.grid.source, automation,
      reason: bars ? `Route-free ${bars}-bar equal-power crossfade (tempo change ${pct}; B at its own tempo).`
        : `Route-free clean cut on the downbeat (tempo change ${pct} is too large to crossfade).`};
  }
  return {kind: 'unavailable', reason: 'Song A has too little audio left for a route-free handover at that bar.'};
}

export interface SetTransitionInput {
  readonly from: {readonly asset: AudioAsset; readonly analysis: MixAnalysis | null; readonly frames: number};
  readonly to: {readonly asset: AudioAsset; readonly analysis: MixAnalysis | null; readonly frames: number;
    readonly channels: number};
  readonly sampleRate: number;
  /** Earliest native A frame for any audible effect, including the preparation allowance. */
  readonly earliestFrame: number;
  readonly boundary: {readonly bars: number; readonly anchorBar: number};
}
interface SetChoiceBase {
  readonly exitBar: number; readonly boundaryBar: number;
  readonly fromGrid: SetBarGrid; readonly toGrid: SetBarGrid; readonly notes: readonly string[];
}
export type SetTransitionChoice =
  | (SetChoiceBase & {readonly kind: 'analyzed'; readonly plan: AutomaticMixPlan})
  | (SetChoiceBase & {readonly kind: 'route-free'; readonly plan: RouteFreePlan})
  | {readonly kind: 'unavailable'; readonly reason: string; readonly notes: readonly string[]};

/** True when B fits the bounded WSOLA render (frames x channels and seconds). */
export function fitsBlendRender(frames: number, channels: number, sampleRate: number): boolean {
  return frames * channels <= TIME_PITCH_LIMITS.maxSamples && frames / sampleRate <= TIME_PITCH_LIMITS.maxSeconds;
}

/**
 * S18 set transition choice, in order: analyzed blend (tempo-matched, returning to B's own
 * tempo), analyzed cut, then the route-free fallback. Analyzed recipes may only use A exits
 * on the requested boundary bars; echo is not offered in set mode.
 */
export function chooseSetTransition(input: SetTransitionInput): SetTransitionChoice {
  const {from, to, sampleRate, earliestFrame, boundary} = input;
  const notes: string[] = [];
  const fromGrid = setBarGrid(from.asset, from.analysis, sampleRate);
  const toGrid = setBarGrid(to.asset, to.analysis, sampleRate);
  if (fromGrid.source === 'requested') notes.push('A uses its requested grid (not measured).');
  if (toGrid.source === 'requested') notes.push('B uses its requested grid (not measured).');
  const first = nextBoundary(fromGrid, boundary.anchorBar, boundary.bars, earliestFrame);
  const second = first.bar + boundary.bars;
  const boundaries = [first, {bar: second, frame: downbeatAt(fromGrid, second)}];
  if (from.analysis && to.analysis) {
    const tolerance = Math.round(fromGrid.barFrames / 8);
    const onBoundary = from.analysis.mixOut.filter(c => boundaries.some(b => Math.abs(c.frame - b.frame) <= tolerance));
    const scoped: MixAnalysis = {...from.analysis, mixOut: onBoundary};
    const barOf = (frame: number): number => boundaries.reduce((best, b) =>
      Math.abs(b.frame - frame) < Math.abs(best.frame - frame) ? b : best).bar;
    if (!onBoundary.length) notes.push('No analyzed A cue lies on the requested boundary.');
    else {
      if (fitsBlendRender(to.frames, to.channels, sampleRate)) {
        const blend = planAutomaticMix(scoped, to.analysis, {recipe: 'blend', minimumFromFrame: earliestFrame,
          returnToOriginalTempo: true});
        if (blend.kind === 'mix') return {kind: 'analyzed', plan: blend, exitBar: barOf(blend.fromExitFrame),
          boundaryBar: first.bar, fromGrid, toGrid, notes};
        notes.push(`Blend unavailable: ${blend.reason}`);
      } else notes.push('Blend unavailable: B exceeds the bounded time-stretch render budget.');
      const cut = planAutomaticMix(scoped, to.analysis, {recipe: 'cut', minimumFromFrame: earliestFrame});
      if (cut.kind === 'mix') return {kind: 'analyzed', plan: cut, exitBar: barOf(cut.fromExitFrame),
        boundaryBar: first.bar, fromGrid, toGrid, notes};
      notes.push(`Analyzed cut unavailable: ${cut.reason}`);
    }
  } else notes.push('Analysis unavailable for at least one song.');
  // Route-free: the requested boundary first, then earlier feasible bars that are still in the future.
  for (let bar = first.bar; bar >= 0; bar--) {
    const frame = downbeatAt(fromGrid, bar);
    if (frame < earliestFrame) break;
    const plan = planRouteFreeTransition({grid: fromGrid, frames: from.frames}, {grid: toGrid, frames: to.frames},
      frame, sampleRate);
    if (plan.kind === 'route-free') {
      if (bar !== first.bar) notes.push(`Requested bar ${first.bar + 1} lacks audio; using bar ${bar + 1}.`);
      return {kind: 'route-free', plan, exitBar: bar, boundaryBar: first.bar, fromGrid, toGrid, notes};
    }
  }
  return {kind: 'unavailable', reason: 'No future bar of A leaves room for a handover; A will finish naturally.', notes};
}
