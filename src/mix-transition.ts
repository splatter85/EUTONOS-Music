import {analyzeMixPairInWorker, analyzeMixSongInWorker, monoAnalysisCopy, prepareTimePitch,
  SONG_ANALYSIS_WINDOW, songLevelWindowFrames, validateSongAnalysis, prepareFiniteLoop, scanNativePeakInWorker} from './mix-prepare.js';
import {MIX_ANALYSIS_VERSION, MIX_LEVEL_VERSION, type NativeSamplePeak, type MixAnalysis, type MixAnalysisOptions, type MixPcm} from './mix-analysis.js';
import {planAutomaticMix, isBeatmatchedRecipe, withPreparedLevelGain, LEVEL_MATCH_LIMITS,
  type AutomaticMixPlan, type MixDecision, type MixPlannerOptions} from './mix-planner.js';
import {outputFrameAtSource, TIME_PITCH_LIMITS, type PreparedFiniteLoop, type PreparedTimePitch, type TimePitchOptions} from './time-pitch.js';
import {cleanCutAutomation, crossfadeAutomation, type MixAutomation} from './mix-automation.js';
import type {AudioAsset} from './pack-types.js';
import type {DecodedRecording} from './web-audio.js';

import {evidenceSpan as songEvidenceSpan, mergeSongWindows, songWindowStarts, SONG_MERGE_POLICY} from './mix-analysis.js';
import {echoOutAutomation as routeEchoAutomation} from './mix-automation.js';
import {harmonicCompatibility, MIX_PLANNER_VERSION} from './mix-planner.js';
import {chooseChoreography, ENTRY_POLICY as SET_ENTRY_POLICY, entrySkipCost as setEntrySkipCost, exploreChoice, makeTransitionPlanRecord,
  meetTempo, tempoGapPolicy, TRANSITION_POLICY_VERSION, type ExploreChoice, type PairFeatures, type SetRecipe, type TempoGapDecision,
  type TransitionPlanRecord, type TransitionStyle} from '../web/transition-policy.js';
import {CHOREOGRAPHY_LIMITS, CHOREOGRAPHY_VERSION, type ChoreographyParams} from '../web/eq-choreography.js';

export interface MixPreparationRuntime {
  analyze(from: MixPcm, to: MixPcm, signal?: AbortSignal): Promise<{from: MixAnalysis; to: MixAnalysis}>;
  render(audio: MixPcm, options: TimePitchOptions, signal?: AbortSignal): Promise<PreparedTimePitch>;
  /** S18 optional: one song (mono). Without it, set mode analyzes the mono copy through `analyze`. */
  analyzeOne?(audio: MixPcm, signal?: AbortSignal, options?: MixAnalysisOptions, levelAudio?: MixPcm): Promise<MixAnalysis>;
  renderLoop?(audio: MixPcm, loopFrames: number, tailFrames: number, bars: 4 | 8, levelGain: number, signal?: AbortSignal): Promise<PreparedFiniteLoop>;
  /** Full-song peak only; omission selects bounded browser worker chunks, never synchronous DSP.
   * Injected non-browser runtimes must provide this capability for native recipes/song analysis. */
  scanPeak?(audio: MixPcm, signal?: AbortSignal): Promise<NativeSamplePeak>;
}
export const browserMixPreparation: MixPreparationRuntime = {
  analyze: analyzeMixPairInWorker,
  render: prepareTimePitch,
  analyzeOne: analyzeMixSongInWorker,
  renderLoop: prepareFiniteLoop,
  scanPeak: scanNativePeakInWorker,
};
export interface ReadyMixTransition {
  readonly kind: 'ready'; readonly plan: AutomaticMixPlan;
  readonly incoming: DecodedRecording; readonly entryFrame: number;
  readonly processed: PreparedTimePitch | {
    readonly processor: 'native-pcm@1' | 'native-rate@1'; readonly audio: MixPcm;
    readonly mapping: PreparedTimePitch['mapping']; readonly metrics: null;
  };
  readonly analysis: {readonly from: MixAnalysis; readonly to: MixAnalysis};
}

/** Choose a later A exit without changing the already rendered B entry or time map. */
export function replanPreparedMix(ready: ReadyMixTransition, minimumFromFrame: number): MixDecision {
  const {plan, analysis} = ready;
  const later = planAutomaticMix(analysis.from,
    {...analysis.to, mixIn: analysis.to.mixIn.filter(c => c.frame === plan.toEntryFrame)},
    {minimumFromFrame, recipe: plan.recipe, echoContentConfirmed: plan.echoContentConfirmed ?? false,
      overlapBeats: plan.overlapBeats, pitchSemitones: plan.pitchSemitones,
      // S21: keep the recipe options a replan must reproduce (choreography, meeting tempo, tempo return, harmony mode).
      ...(plan.choreography ? {choreography: plan.choreography.params, harmonicMode: 'limited' as const} : {}),
      ...(plan.meet ? {meetBpm: plan.meet.bpm} : {}),
      ...(plan.tempoReturn ? {tempoReturn: {bars: Math.max(1, Math.round(plan.tempoReturn.rampFrames * (plan.meet?.bpm ?? plan.fromBpm) /
        (4 * 60 * plan.sampleRate))), curve: plan.tempoReturn.curve}} : {}),
      returnToOriginalTempo: plan.returnToOriginalTempo, ...(plan.levelMatch ? {fromLevelGain: plan.levelMatch.fromGain} : {})});
  return later.kind === 'mix' && plan.levelMatch ? {...later, levelMatch: plan.levelMatch} : later;
}
export type PreparedMixDecision = ReadyMixTransition | {readonly kind: 'fallback'; readonly reason: string};

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Mix preparation cancelled.');
}
function pcm(recording: DecodedRecording): MixPcm {
  return {sampleRate: recording.buffer.sampleRate,
    channels: Array.from({length: recording.buffer.numberOfChannels}, (_, i) => recording.buffer.getChannelData(i))};
}

/** Copy only the measured loop and handover tail; validate the actual returned PCM independently. */
export async function prepareOutgoingLoop(context: BaseAudioContext, from: DecodedRecording, plan: AutomaticMixPlan,
  levelGain: number, signal?: AbortSignal, runtime: MixPreparationRuntime = browserMixPreparation): Promise<AudioBuffer | undefined> {
  const loop = plan.loopExtension;
  if (!loop) return undefined;
  if (!runtime.renderLoop || from.processed || loop.endFrame !== plan.fromExitFrame || loop.endFrame - loop.startFrame !== loop.frames ||
    loop.startFrame < 0 || loop.endFrame + plan.overlapFrames > from.buffer.length ||
    (loop.frames + plan.overlapFrames) * from.buffer.numberOfChannels > TIME_PITCH_LIMITS.maxSamples) throw new Error('Loop lacks a bounded native source/worker.');
  const audio = {sampleRate: context.sampleRate, channels: Array.from({length: from.buffer.numberOfChannels}, (_, c) =>
    from.buffer.getChannelData(c).subarray(loop.startFrame, loop.endFrame + plan.overlapFrames))};
  const ready = await runtime.renderLoop(audio, loop.frames, plan.overlapFrames, loop.bars, levelGain, signal);
  checkAbort(signal);
  if (ready.processor !== 'finite-loop@1' || ready.loopFrames !== loop.frames || ready.tailFrames !== plan.overlapFrames ||
    ready.audio.sampleRate !== context.sampleRate || ready.audio.channels.length !== audio.channels.length ||
    !Number.isFinite(ready.metrics.periodicity) || ready.metrics.periodicity < 0.35 ||
    !Number.isFinite(ready.metrics.energyRatio) || ready.metrics.energyRatio > 4 || !Number.isFinite(ready.metrics.seamError) || ready.metrics.seamError > 1e-7) throw new Error('Invalid finite loop evidence.');
  const buffer = context.createBuffer(audio.channels.length, loop.frames + plan.overlapFrames, context.sampleRate);
  ready.audio.channels.forEach((channel, c) => {
    if (!(channel instanceof Float32Array) || channel.length !== buffer.length || channel[0] !== audio.channels[c]![loop.frames] ||
      channel[loop.frames - 1] !== audio.channels[c]![loop.frames - 1] || channel[loop.frames] !== audio.channels[c]![loop.frames]) throw new Error('Finite loop changed a native seam anchor.');
    for (const value of channel) if (!Number.isFinite(value) || Math.abs(value) * levelGain > TIME_PITCH_LIMITS.peakCeiling + 1e-7) throw new Error('Invalid effective finite loop PCM.');
    buffer.copyToChannel(new Float32Array(channel), c);
  });
  return buffer;
}

/** Reconcile the processor's common attenuation before a fixed native-continuation gain. */
function preparedLevel(plan: AutomaticMixPlan, processed: PreparedTimePitch): {plan: AutomaticMixPlan; pcmScale: number} {
  const renderGain = processed.metrics.gainApplied;
  if (!Number.isFinite(renderGain) || renderGain <= 0 || renderGain > 1) throw new Error('Invalid processor normalization receipt.');
  let peak = 0;
  for (const channel of processed.audio.channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  if (!plan.levelMatch) {
    if (1 / renderGain > LEVEL_MATCH_LIMITS.maxGain + 1e-7 || peak / renderGain > TIME_PITCH_LIMITS.peakCeiling + 1e-7)
      throw new Error('Processor normalization cannot be compensated within the native-continuation sample-peak ceiling.');
    return {plan, pcmScale: 1 / renderGain};
  }
  const gain = Math.min(plan.levelMatch.toGain, peak ? plan.levelMatch.incomingPeakBudget * renderGain / peak : plan.levelMatch.toGain);
  if (gain / renderGain > LEVEL_MATCH_LIMITS.maxGain + 1e-7) throw new Error('Processor normalization compensation exceeds the bounded effective gain.');
  const resolved = withPreparedLevelGain(plan, gain);
  return {plan: {...resolved, levelMatch: {...resolved.levelMatch!, renderGainApplied: renderGain}}, pcmScale: 1 / renderGain};
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
  if (plan.recipe === 'tempo-ramp' || plan.recipe === 'brake') {
    const peak = await (runtime.scanPeak ?? scanNativePeakInWorker)(b, signal);
    checkAbort(signal);
    if (peak.version !== 'native-sample-peak@1' || peak.frames !== to.buffer.length || !Number.isFinite(peak.value) ||
      peak.value < 0 || peak.value > TIME_PITCH_LIMITS.peakCeiling + 1e-7) throw new Error('Native rate entry failed sample-peak/finite validation.');
    return {kind: 'ready', plan, analysis, entryFrame: plan.toEntryFrame,
      incoming: {...to, ...(plan.nativeRate?.incoming ? {nativeRate: plan.nativeRate.incoming} : {})},
      processed: {processor: 'native-rate@1', audio: b, metrics: null,
        mapping: {inputFrames: to.buffer.length, outputFrames: to.buffer.length, tempoRatio: 1, pitchSemitones: 0, returnToOriginal: null}}};
  }
  if (!isBeatmatchedRecipe(plan.recipe)) {
    // Native B is already decoded: do not fabricate a WSOLA render/receipt.
    const peak = await (runtime.scanPeak ?? scanNativePeakInWorker)(b, signal);
    checkAbort(signal);
    if (peak.version !== 'native-sample-peak@1' || peak.frames !== to.buffer.length || !Number.isFinite(peak.value) ||
      peak.value < 0 || peak.value > 0.891251) throw new Error('Native mix audio failed peak/finite validation.');
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
  const level = preparedLevel(plan, processed);
  processed.audio.channels.forEach((channel, i) => buffer.copyToChannel(Float32Array.from(channel, sample => sample * level.pcmScale), i));
  checkAbort(signal);
  return {kind: 'ready', plan: level.plan, entryFrame, processed, analysis,
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
 * analysis. A failure is returned as an explicit unavailable result to every caller that shared
 * it, then dropped, so the next request retries.
 */
export class MixAnalysisCache {
  private readonly entries = new Map<string, Promise<SongAnalysisResult>>();
  private readonly peaks = new WeakMap<AudioBuffer, Promise<NativeSamplePeak>>();
  constructor(readonly maxEntries = 64) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 2 || maxEntries > 256) throw new Error('Invalid analysis cache size.');
  }
  static key(asset: AudioAsset, sampleRate: number, startFrame = 0): string {
    return `${asset.file.sha256}:${MIX_ANALYSIS_VERSION}:${MIX_LEVEL_VERSION}:${sampleRate}:${SONG_ANALYSIS_WINDOW.policy}:${SONG_ANALYSIS_WINDOW.seconds}s:${startFrame}:${asset.timing?.bpm ?? 'none'}`;
  }
  private readonly songs = new Map<string, Promise<SongAnalysisResult>>();
  /**
   * S21 whole-song analysis: bounded 60 s windows every 48 s (each through `analyze`, so every
   * window keeps its own cache entry and the 180 s render cap is untouched), merged by
   * song-window-merge@1. A partial failure merges the windows that succeeded and says so.
   */
  analyzeSong(recording: DecodedRecording, runtime: MixPreparationRuntime, signal?: AbortSignal): Promise<SongAnalysisResult> {
    const {asset, buffer} = recording;
    if (recording.processed) return Promise.reject(new Error('Analyze the native recording, never a processed render.'));
    const key = `${MixAnalysisCache.key(asset, buffer.sampleRate)}:${SONG_MERGE_POLICY.policy}`;
    let task = this.songs.get(key);
    if (task) { this.songs.delete(key); this.songs.set(key, task); }
    else {
      task = (async (): Promise<SongAnalysisResult> => {
        const results: SongAnalysisResult[] = [];
        // Windows run in order: a shared worker is not flooded and the first window warms quickly.
        for (const start of songWindowStarts(buffer.length, buffer.sampleRate)) results.push(await this.analyze(recording, runtime, undefined, start));
        const ok = results.filter((r): r is Extract<SongAnalysisResult, {ok: true}> => r.ok);
        if (!ok.length) return results[0] ?? {ok: false, reason: 'No song window could be analyzed.'};
        try {
          const merged = mergeSongWindows(ok.map(r => r.analysis));
          return {ok: true, analysis: ok.length < results.length ? {...merged, limitations: [...merged.limitations,
            `${results.length - ok.length} of ${results.length} song windows failed analysis; their regions have no cue evidence.`]} : merged};
        } catch (error) { return {ok: false, reason: error instanceof Error ? error.message : String(error)}; }
      })();
      this.songs.set(key, task);
      const settled = task;
      void settled.then(result => { if (!result.ok && this.songs.get(key) === settled) this.songs.delete(key); });
      while (this.songs.size > 16) this.songs.delete(this.songs.keys().next().value!);
    }
    return raceAbort(task, signal);
  }
  hasSong(asset: AudioAsset, sampleRate: number): boolean { return this.songs.has(`${MixAnalysisCache.key(asset, sampleRate)}:${SONG_MERGE_POLICY.policy}`); }
  get size(): number { return this.entries.size; }
  has(asset: AudioAsset, sampleRate: number, startFrame = 0): boolean { return this.entries.has(MixAnalysisCache.key(asset, sampleRate, startFrame)); }
  analyze(recording: DecodedRecording, runtime: MixPreparationRuntime, signal?: AbortSignal, startFrame = 0): Promise<SongAnalysisResult> {
    const {asset, buffer} = recording;
    if (recording.processed) return Promise.reject(new Error('Analyze the native recording, never a processed render.'));
    if (!Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame >= buffer.length) return Promise.reject(new Error('Invalid song analysis window start.'));
    const key = MixAnalysisCache.key(asset, buffer.sampleRate, startFrame);
    let entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key); this.entries.set(key, entry); // most recently used last
    } else {
      entry = (async (): Promise<SongAnalysisResult> => {
        try {
          const channels = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i).subarray(startFrame));
          const options: MixAnalysisOptions = asset.timing ? {generationBpm: asset.timing.bpm} : {};
          const mono = monoAnalysisCopy({sampleRate: buffer.sampleRate, channels});
          let analysis: MixAnalysis;
          const levelFrames = songLevelWindowFrames(mono.channels[0].length, buffer.sampleRate, channels.length);
          if (runtime.analyzeOne) analysis = await runtime.analyzeOne(mono, undefined, options,
            {sampleRate: buffer.sampleRate, channels: channels.map(c => c.subarray(0, levelFrames))});
          else {
            analysis = (await runtime.analyze(mono, mono)).from;
          }
          validateSongAnalysis(analysis, mono.channels[0].length, buffer.sampleRate);
          let peakTask = this.peaks.get(buffer);
          if (!peakTask) {
            peakTask = (runtime.scanPeak ?? scanNativePeakInWorker)({sampleRate: buffer.sampleRate,
              channels: Array.from({length: buffer.numberOfChannels}, (_, c) => buffer.getChannelData(c))}).then(peak => {
              if (peak.version !== 'native-sample-peak@1' || peak.frames !== buffer.length || !Number.isFinite(peak.value) ||
                peak.value < 0 || peak.value > 16) throw new Error('Native peak evidence does not match the full recording.');
              return peak;
            });
            this.peaks.set(buffer, peakTask);
            const pending = peakTask;
            void pending.catch(() => { if (this.peaks.get(buffer) === pending) this.peaks.delete(buffer); });
          }
          const peak = await peakTask;
          // A legacy runtime that measured only the mono tempo copy cannot claim stereo levels.
          const {level: measuredLevel, ...rawAnalysis} = analysis;
          analysis = {...rawAnalysis, ...(measuredLevel?.channels === buffer.numberOfChannels ?
            {level: {...measuredLevel, startFrame: measuredLevel.startFrame + startFrame}} : {})};
          const cue = (c: MixAnalysis['mixIn'][number]): MixAnalysis['mixIn'][number] => ({...c,
            frame: c.frame + startFrame, seconds: (c.frame + startFrame) / buffer.sampleRate,
            ...(c.evidence ? {evidence: {...c.evidence, windowEndFrame: c.evidence.windowEndFrame + startFrame}} : {})});
          analysis = {...analysis, frames: buffer.length,
            nativePeak: peak,
            analyzedWindow: {policy: SONG_ANALYSIS_WINDOW.policy, startFrame, frames: mono.channels[0].length},
            beatGrid: {...analysis.beatGrid, frames: analysis.beatGrid.frames.map(f => f + startFrame)},
            structure: {...analysis.structure, downbeatFrames: analysis.structure.downbeatFrames.map(f => f + startFrame),
              phraseFrames: analysis.structure.phraseFrames.map(f => f + startFrame)},
            energyCurve: analysis.energyCurve.map(e => ({...e, startFrame: e.startFrame + startFrame, endFrame: e.endFrame + startFrame})),
            ...(analysis.cueFeatures ? {cueFeatures: analysis.cueFeatures.map(c => ({...c, frame: c.frame + startFrame, endFrame: c.endFrame + startFrame}))} : {}),
            ...(analysis.vocalSpans ? {vocalSpans: analysis.vocalSpans.map(s => ({startFrame: s.startFrame + startFrame, endFrame: s.endFrame + startFrame}))} : {}),
            mixIn: analysis.mixIn.filter(c => !startFrame || c.evidence?.kind !== 'track-start').map(cue),
            mixOut: analysis.mixOut.filter(c => !startFrame || c.evidence?.kind !== 'track-start').map(cue),
            limitations: [...analysis.limitations, `Only native frames ${startFrame}..${startFrame + mono.channels[0].length} were analyzed; other cue evidence is unavailable.`]};
          return {ok: true, analysis};
        } catch (error) {
          return {ok: false, reason: error instanceof Error ? error.message : String(error)};
        }
      })();
      this.entries.set(key, entry);
      const settled = entry;
      void settled.then(result => { if (!result.ok && this.entries.get(key) === settled) this.entries.delete(key); });
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
  /** Index of the first measured downbeat, counted from the song's original bar origin. */
  readonly firstBar?: number;
}
export function setBarGrid(asset: AudioAsset, analysis: MixAnalysis | null, sampleRate: number): SetBarGrid {
  const structure = analysis?.structure;
  if (analysis && structure && analysis.tempo.bpm !== null && analysis.tempo.confidence >= SET_GRID_LIMITS.tempoConfidence &&
    structure.downbeatConfidence >= SET_GRID_LIMITS.downbeatConfidence && structure.downbeatFrames.length >= 2) {
    const barFrames = 4 * 60 * sampleRate / analysis.tempo.bpm;
    const requestedOrigin = Math.round((asset.timing?.first_downbeat_frame ?? 0) * sampleRate / asset.file.sample_rate);
    return {source: 'measured', bpm: analysis.tempo.bpm, barFrames,
      firstBar: Math.max(0, Math.round((structure.downbeatFrames[0]! - requestedOrigin) / barFrames)),
      downbeats: [...structure.downbeatFrames]};
  }
  const timing = asset.timing;
  if (!timing || !(timing.bpm > 0)) throw new Error(`Song ${asset.id} has neither a measured nor a requested grid.`);
  return {source: 'requested', bpm: timing.bpm, barFrames: 4 * 60 * sampleRate / timing.bpm,
    downbeats: [Math.round(timing.first_downbeat_frame * sampleRate / asset.file.sample_rate)]};
}
export function downbeatAt(grid: SetBarGrid, bar: number): number {
  bar -= grid.firstBar ?? 0;
  const known = grid.downbeats.length;
  if (bar < 0) return Math.round(grid.downbeats[0]! + bar * grid.barFrames);
  if (bar < known) return grid.downbeats[bar]!;
  return Math.round(grid.downbeats[known - 1]! + (bar - known + 1) * grid.barFrames);
}
/** Smallest bar index whose downbeat is at or after `frame`. */
export function barAtOrAfter(grid: SetBarGrid, frame: number): number {
  const firstBar = grid.firstBar ?? 0;
  if (frame <= grid.downbeats[0]!) return Math.max(0, firstBar + Math.ceil((frame - grid.downbeats[0]!) / grid.barFrames));
  const known = grid.downbeats.findIndex(d => d >= frame);
  if (known >= 0) return known + firstBar;
  const last = grid.downbeats.length - 1;
  let bar = firstBar + last + Math.max(0, Math.ceil((frame - grid.downbeats[last]!) / grid.barFrames));
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

/** Later A bars tried (after the earlier feasible ones) before a clean cut is accepted. */
export const ROUTE_FREE_LATER_BARS = 2;
export const ROUTE_FREE_LIMITS = Object.freeze({
  /** Treated as the same tempo: four-bar crossfade. */
  equalTempo: 0.005,
  /** Above this tempo difference a crossfade would drift: clean cut instead. */
  crossfadeTempo: 0.08,
  equalTempoBars: 4, nearTempoBars: 1,
});
export type RouteFreeRecipe = 'fallback-crossfade' | 'fallback-echo-reset' | 'fallback-cut';
export interface RouteFreePlan {
  readonly kind: 'route-free'; readonly recipe: RouteFreeRecipe;
  /** B enters here; for the echo reset A's dry fade and echo send start `preRollFrames` earlier. */
  readonly fromExitFrame: number; readonly toEntryFrame: number;
  readonly overlapFrames: number; readonly preRollFrames: number; readonly bars: number;
  readonly fromBpm: number; readonly toBpm: number;
  /** B always plays at its native tempo here; this is the tempo change heard at the handover. */
  readonly tempoChange: number;
  readonly fromGrid: SetBarGrid['source']; readonly toGrid: SetBarGrid['source'];
  readonly automation: {readonly outgoing: MixAutomation; readonly incoming: MixAutomation};
  readonly reason: string;
}

/** Equal-power (sin/cos) gain lanes with neutral filters, as 17-point linear segments. */
export function equalPowerCrossfade(durationFrames: number, sampleRate: number): {outgoing: MixAutomation; incoming: MixAutomation} {
  return crossfadeAutomation(durationFrames, sampleRate);
}

/** S21 route-free echo reset: A's high-pass rises during the two-beat dry fade; the echo tail carries B in. */
export function echoResetAutomation(bpm: number, sampleRate: number): ReturnType<typeof routeEchoAutomation> {
  const echo = routeEchoAutomation(Math.min(180, Math.max(60, bpm)), sampleRate);
  const d = echo.outgoing.durationFrames;
  return {...echo, outgoing: {...echo.outgoing,
    highPassHz: [{frame: 0, value: 0}, {frame: echo.preRollFrames, value: 400}, {frame: d, value: 400}]}};
}

/**
 * Route-free set fallback at an exact A downbeat. In order: an equal-power crossfade when the
 * tempi are close (4 bars when equal, 1 bar within 8%); the S21 filtered echo reset (any tempo
 * gap, B on its measured phrase entry); a 10 ms clean cut only when `allowCut` and nothing else
 * fits. B is never time-stretched here and no authored route is consulted.
 */
export function planRouteFreeTransition(from: {readonly grid: SetBarGrid; readonly frames: number},
  to: {readonly grid: SetBarGrid; readonly frames: number}, exitFrame: number,
  sampleRate: number, options: {readonly entryFrame?: number; readonly exclude?: readonly string[]; readonly allowCut?: boolean;
    readonly earliestFrame?: number} = {}): RouteFreePlan | {readonly kind: 'unavailable'; readonly reason: string} {
  const tempoChange = to.grid.bpm / from.grid.bpm, gap = Math.abs(tempoChange - 1);
  const entry = options.entryFrame ?? to.grid.downbeats[0]!;
  const exclude = options.exclude ?? [];
  const pct = `${tempoChange >= 1 ? '+' : ''}${((tempoChange - 1) * 100).toFixed(1)}%`;
  const crossfades: number[] = exclude.includes('fallback-crossfade') ? [] : gap < ROUTE_FREE_LIMITS.equalTempo
    ? [ROUTE_FREE_LIMITS.equalTempoBars, ROUTE_FREE_LIMITS.nearTempoBars]
    : gap <= ROUTE_FREE_LIMITS.crossfadeTempo ? [ROUTE_FREE_LIMITS.nearTempoBars] : [];
  const base = {kind: 'route-free' as const, fromExitFrame: exitFrame, toEntryFrame: entry, fromBpm: from.grid.bpm, toBpm: to.grid.bpm,
    tempoChange, fromGrid: from.grid.source, toGrid: to.grid.source};
  for (const bars of crossfades) {
    const automation = equalPowerCrossfade(Math.round(bars * from.grid.barFrames), sampleRate);
    const overlapFrames = automation.incoming.durationFrames;
    if (exitFrame < 0 || exitFrame + overlapFrames > from.frames || entry + overlapFrames > to.frames) continue;
    return {...base, recipe: 'fallback-crossfade', overlapFrames, preRollFrames: 0, bars, automation,
      reason: `Route-free ${bars}-bar equal-power crossfade (tempo change ${pct}; B at its own tempo).`};
  }
  if (!exclude.includes('fallback-echo-reset') && !exclude.includes('echo-reset')) {
    const echo = echoResetAutomation(from.grid.bpm, sampleRate);
    const start = exitFrame - echo.preRollFrames;
    // The deck consumes A for the whole outgoing automation (the dry part is silent after the exit).
    if (start >= (options.earliestFrame ?? 0) && start >= 0 && start + echo.outgoing.durationFrames <= from.frames &&
      entry + echo.tailFrames <= to.frames) {
      return {...base, recipe: 'fallback-echo-reset', overlapFrames: echo.tailFrames, preRollFrames: echo.preRollFrames, bars: 0,
        automation: {outgoing: echo.outgoing, incoming: echo.incoming},
        reason: `Route-free filtered echo reset: A's echo tail carries B in on its own tempo (tempo change ${pct}). No beat match is attempted.`};
    }
  }
  if (options.allowCut !== false && !exclude.includes('cut') && !exclude.includes('fallback-cut')) {
    const automation = cleanCutAutomation(sampleRate), overlapFrames = automation.incoming.durationFrames;
    if (exitFrame >= 0 && exitFrame + overlapFrames <= from.frames && entry + overlapFrames <= to.frames) {
      return {...base, recipe: 'fallback-cut', overlapFrames, preRollFrames: 0, bars: 0, automation,
        reason: `Route-free clean cut on the downbeat (last resort: every other handover was unavailable; tempo change ${pct}).`};
    }
  }
  return {kind: 'unavailable', reason: 'Song A has too little audio left for a route-free handover at that bar.'};
}

/** Best measured B phrase entry under the S21 skip cost and earlier-entry tie rule (null = none). */
export function routeFreeEntry(to: MixAnalysis | null, frames: number, styleAllowsSkip = false): number | null {
  if (!to) return null;
  const phrases = new Set(to.structure.phraseFrames);
  const items = to.mixIn.filter(c => phrases.has(c.frame) || c.evidence?.kind === 'boundary');
  if (!items.length) return to.structure.phraseFrames[0] ?? null;
  const adjusted = (c: MixAnalysis['mixIn'][number]) => c.score - setEntrySkipCost(c.frame, frames, styleAllowsSkip);
  const best = Math.max(...items.map(adjusted));
  return items.filter(c => adjusted(c) >= best - SET_ENTRY_POLICY.tieWindow).sort((a, b) => a.frame - b.frame)[0]!.frame;
}

export interface SetTransitionInput {
  readonly from: {readonly asset: AudioAsset; readonly analysis: MixAnalysis | null; readonly frames: number};
  readonly to: {readonly asset: AudioAsset; readonly analysis: MixAnalysis | null; readonly frames: number;
    readonly channels: number};
  readonly sampleRate: number;
  /** Earliest native A frame for any audible effect, including the preparation allowance. */
  readonly earliestFrame: number;
  readonly boundary: {readonly bars: number; readonly anchorBar: number};
  readonly options?: MixPlannerOptions;
  /** S21: recipes already rejected (by render or pre-check) for this request; tried candidates skip them. */
  readonly exclude?: readonly string[];
  /** S21 seeded explore mode (bounded variation; null/absent = deterministic Auto). */
  readonly explore?: {readonly seed: number} | null;
  readonly style?: TransitionStyle;
  /** Longest choreography overlap the bounded render and pre-check allow (default 26 s). */
  readonly maxOverlapSeconds?: number;
}
interface SetChoiceBase {
  readonly exitBar: number; readonly boundaryBar: number;
  readonly fromGrid: SetBarGrid; readonly toGrid: SetBarGrid; readonly notes: readonly string[];
  /** S21: tempo-gap decision, candidates rejected before this one, and the explore draw. */
  readonly policy?: TempoGapDecision;
  readonly rejected?: readonly {readonly recipe: string; readonly reason: string}[];
  readonly explore?: ExploreChoice;
  readonly why?: readonly string[];
}
export type SetTransitionChoice =
  | (SetChoiceBase & {readonly kind: 'analyzed'; readonly plan: AutomaticMixPlan})
  | (SetChoiceBase & {readonly kind: 'route-free'; readonly plan: RouteFreePlan})
  | {readonly kind: 'unavailable'; readonly reason: string; readonly notes: readonly string[]};

/** True when B fits the bounded WSOLA render (frames x channels and seconds). */
export function fitsBlendRender(frames: number, channels: number, sampleRate: number): boolean {
  return frames * channels <= TIME_PITCH_LIMITS.maxSamples && frames / sampleRate <= TIME_PITCH_LIMITS.maxSeconds;
}

interface SetBlendWindow {
  readonly sourceStartFrame: number; readonly sourceEndFrame: number;
  readonly sourceJoinFrame: number; readonly outputJoinFrame: number;
  readonly entryFrame: number; readonly options: TimePitchOptions;
}
/** Bounded entry/overlap/return window; only a measured downbeat may rejoin native B. */
function setBlendWindow(plan: AutomaticMixPlan, analysis: MixAnalysis, frames: number): SetBlendWindow {
  if (!isBeatmatchedRecipe(plan.recipe) || !plan.returnToOriginalTempo || plan.pitchSemitones !== 0 ||
    analysis.structure.downbeatConfidence < SET_GRID_LIMITS.downbeatConfidence) {
    throw new Error('A native set join needs zero pitch shift, a tempo return and a measured B downbeat.');
  }
  const guard = Math.round(plan.sampleRate * 0.05);
  const sourceStartFrame = Math.max(0, plan.toEntryFrame - guard);
  const entryFrame = Math.round((plan.toEntryFrame - sourceStartFrame) / plan.tempoRatio);
  const afterFrames = entryFrame + plan.overlapFrames;
  // S21: the plan may carry a longer smoothstep return; both curves integrate to the linear mean.
  const rampFrames = plan.tempoReturn?.rampFrames ?? Math.round(4 * 60 * plan.sampleRate / plan.fromBpm);
  const curve = plan.tempoReturn?.curve ?? 'linear';
  const returnEndInput = plan.tempoRatio * afterFrames + (plan.tempoRatio + 1) * rampFrames / 2;
  const evidenceEnd = songEvidenceSpan(analysis).end;
  const sourceJoinFrame = analysis.structure.downbeatFrames.find(frame =>
    frame >= sourceStartFrame + returnEndInput + guard && frame + guard <= frames && frame < evidenceEnd);
  if (sourceJoinFrame === undefined) throw new Error('No measured B downbeat after the overlap and tempo return fits a native join.');
  const outputJoinFrame = Math.round(afterFrames + rampFrames + sourceJoinFrame - sourceStartFrame - returnEndInput);
  return {sourceStartFrame, sourceEndFrame: sourceJoinFrame + guard, sourceJoinFrame, outputJoinFrame, entryFrame,
    options: {tempoRatio: plan.tempoRatio, pitchSemitones: 0,
      returnToOriginal: {afterFrames, rampFrames, ...(curve === 'smoothstep' ? {curve} : {})}}};
}

export interface ReadySetBlend {
  readonly plan: AutomaticMixPlan;
  readonly incoming: DecodedRecording; readonly entryFrame: number; readonly mapping: PreparedTimePitch['mapping'];
  readonly sourceStartFrame: number; readonly processor: PreparedTimePitch['processor'];
  readonly nativeJoin: {readonly sourceFrame: number; readonly outputFrame: number};
}

/** Set-only render: never send the full song to WSOLA or allocate a full processed song. */
export async function renderSetBlend(context: BaseAudioContext, to: DecodedRecording, plan: AutomaticMixPlan,
  analysis: MixAnalysis, signal?: AbortSignal, runtime: MixPreparationRuntime = browserMixPreparation): Promise<ReadySetBlend> {
  checkAbort(signal);
  if (to.processed || to.buffer.sampleRate !== context.sampleRate || plan.sampleRate !== context.sampleRate ||
    analysis.sampleRate !== context.sampleRate || analysis.frames !== to.buffer.length || plan.toFrames !== to.buffer.length) {
    throw new Error('Set render plan and analysis must bind the native recording on the owner sample rate.');
  }
  const window = setBlendWindow(plan, analysis, to.buffer.length);
  const frames = window.sourceEndFrame - window.sourceStartFrame;
  if (!fitsBlendRender(frames, to.buffer.numberOfChannels, context.sampleRate)) throw new Error('Set entry window exceeds the bounded render budget.');
  const input: MixPcm = {sampleRate: context.sampleRate, channels: Array.from({length: to.buffer.numberOfChannels}, (_, c) =>
    to.buffer.getChannelData(c).subarray(window.sourceStartFrame, window.sourceEndFrame))};
  const processed = await runtime.render(input, window.options, signal);
  checkAbort(signal);
  const back = window.options.returnToOriginal!, ratio = plan.tempoRatio;
  const expectedFrames = Math.round(back.afterFrames + back.rampFrames + frames -
    ratio * back.afterFrames - (ratio + 1) * back.rampFrames / 2);
  if (processed.processor !== 'eutonos-wsola@1' || processed.audio.sampleRate !== context.sampleRate ||
    processed.mapping.inputFrames !== frames || processed.mapping.outputFrames !== expectedFrames ||
    processed.mapping.tempoRatio !== ratio || processed.mapping.pitchSemitones !== 0 ||
    processed.mapping.returnToOriginal?.afterFrames !== back.afterFrames ||
    processed.mapping.returnToOriginal.rampFrames !== back.rampFrames ||
    processed.audio.channels.length !== input.channels.length || processed.audio.channels.some(c =>
      !(c instanceof Float32Array) || c.length !== expectedFrames) ||
    window.outputJoinFrame <= back.afterFrames + back.rampFrames || window.outputJoinFrame >= expectedFrames ||
    window.entryFrame + plan.overlapFrames >= window.outputJoinFrame) {
    throw new Error('Prepared set window does not match its selected transform or native join.');
  }
  for (const channel of processed.audio.channels) for (const value of channel) {
    if (!Number.isFinite(value) || Math.abs(value) > TIME_PITCH_LIMITS.peakCeiling + 1e-7) {
      throw new Error('Prepared set audio failed peak/finite validation.');
    }
  }
  const level = preparedLevel(plan, processed), levelGain = level.plan.levelMatch?.toGain ?? 1;
  // WSOLA's local search need not finish at the nominal phase. Replace its final 20 ms with
  // a complementary PCM crossfade onto the exact native samples preceding the join.
  // The last prepared sample is native[join-1]; native[join] starts on the same clock next.
  const buffer = context.createBuffer(input.channels.length, window.outputJoinFrame, context.sampleRate);
  const crossfadeFrames = Math.min(Math.round(context.sampleRate * 0.02), window.outputJoinFrame - back.afterFrames - back.rampFrames);
  for (let c = 0; c < input.channels.length; c++) {
    const channel = Float32Array.from(processed.audio.channels[c]!.subarray(0, window.outputJoinFrame), sample => sample * level.pcmScale);
    const native = to.buffer.getChannelData(c);
    for (let i = 0; i < crossfadeFrames; i++) {
      const at = window.outputJoinFrame - crossfadeFrames + i;
      const t = i / (crossfadeFrames - 1), weight = 0.5 - 0.5 * Math.cos(Math.PI * t);
      const sample = native[window.sourceJoinFrame - crossfadeFrames + i]!;
      if (!Number.isFinite(sample) || Math.abs(sample) * levelGain > TIME_PITCH_LIMITS.peakCeiling + 1e-7) throw new Error('Native join failed effective sample-peak/finite validation.');
      channel[at] = channel[at]! * (1 - weight) + sample * weight;
    }
    buffer.copyToChannel(channel, c);
  }
  checkAbort(signal);
  return {plan: level.plan, incoming: {asset: to.asset, buffer, processed: {sourceFrames: to.buffer.length,
    outputFrames: buffer.length, algorithm: processed.processor},
    continuation: {buffer: to.buffer, sourceFrame: window.sourceJoinFrame}},
    entryFrame: window.entryFrame, mapping: processed.mapping, sourceStartFrame: window.sourceStartFrame,
    processor: processed.processor, nativeJoin: {sourceFrame: window.sourceJoinFrame, outputFrame: window.outputJoinFrame}};
}

/** S21 recipes that render B through the bounded WSOLA window with a native join. */
const SET_STRETCHED: readonly string[] = ['blend', 'loudness-match', 'filter-sweep', 'loop-extend', 'meet-in-middle'];

/**
 * S21: identity of one parameterisation for the retry exclusion list: recipe, requested-boundary exit bar,
 * overlap and choreography (name, gap). Route-free and cut plans keep their plain recipe names, which
 * `planRouteFreeTransition` already understands.
 */
export function transitionSignature(plan: AutomaticMixPlan | RouteFreePlan, exitBar: number): string {
  if (plan.recipe === 'cut' || !('overlapBeats' in plan)) return plan.recipe;
  const c = plan.choreography?.params;
  return [plan.recipe, `bar${exitBar}`, `ov${c?.overlapBars ?? plan.overlapBeats / 4}`, c ? `${c.name}${c.gapBars ? `-gap${c.gapBars}` : ''}` : 'plain'].join(':');
}

/** Pair features for choreography choice, measured from the scoped A cues and B entries. */
function pairFeatures(from: MixAnalysis, to: MixAnalysis, bpm: number, maxOverlapSeconds: number, style?: TransitionStyle): PairFeatures {
  const mean = (xs: number[]): number => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0.5;
  const densityA = mean(from.mixOut.map(c => c.evidence?.interference).filter((x): x is number => typeof x === 'number'));
  const densityB = mean(to.mixIn.slice(0, 4).map(c => c.evidence?.salience).filter((x): x is number => typeof x === 'number'));
  const keyed = from.key.tonic !== null && to.key.tonic !== null && Math.min(from.key.confidence, to.key.confidence) >= 0.55;
  const harmonic = keyed ? harmonicCompatibility({tonic: from.key.tonic!, mode: from.key.mode!}, {tonic: to.key.tonic!, mode: to.key.mode!}).score : null;
  return {densityA, densityB, harmonic, bpm, maxOverlapSeconds, ...(style ? {style} : {})};
}

/**
 * S21 set transition choice. Candidates come from the tempo-gap policy (transition-policy@1) in
 * band order; rhythm recipes need a confident beat grid, and a weak key only limits sustained
 * harmonic overlap (mid-carve or bass-drop choreography). Every analyzed recipe may only use A
 * exits on the requested boundary bars. The route-free echo reset needs only grids; a clean cut
 * is chosen only when every other candidate is rejected or when the owner selects it.
 */
export function chooseSetTransition(input: SetTransitionInput): SetTransitionChoice {
  const {from, to, sampleRate, earliestFrame, boundary} = input;
  const notes: string[] = [], rejected: {recipe: string; reason: string}[] = [];
  const exclude = new Set(input.exclude ?? []);
  const fromGrid = setBarGrid(from.asset, from.analysis, sampleRate);
  const toGrid = setBarGrid(to.asset, to.analysis, sampleRate);
  if (fromGrid.source === 'requested') notes.push('A uses its requested grid (not measured).');
  if (toGrid.source === 'requested') notes.push('B uses its requested grid (not measured).');
  const first = nextBoundary(fromGrid, boundary.anchorBar, boundary.bars, earliestFrame);
  const second = first.bar + boundary.bars;
  const boundaries = [first, {bar: second, frame: downbeatAt(fromGrid, second)}];
  const owner = input.options?.recipe && input.options.recipe !== 'auto' ? input.options.recipe : null;
  const beatConfident = !!from.analysis && !!to.analysis && [from.analysis, to.analysis].every(a =>
    a.beatGrid.confidence >= SET_GRID_LIMITS.tempoConfidence && a.structure.downbeatConfidence >= SET_GRID_LIMITS.downbeatConfidence);
  const policy = tempoGapPolicy(fromGrid.bpm, toGrid.bpm, {beatConfident});
  const order: string[] = owner ? [owner, ...(owner === 'cut' ? [] : ['echo-reset'])] : [...policy.recipes];
  const why = [...policy.reasons];
  if (owner) why.push(`Owner selected ${owner}.`);
  const maxOverlapSeconds = input.maxOverlapSeconds ?? 26;
  let explore: ExploreChoice | undefined;
  const base = (exitBar: number) => ({exitBar, boundaryBar: first.bar, fromGrid, toGrid, notes, policy, rejected, why,
    ...(explore ? {explore} : {})});
  if (from.analysis && to.analysis) {
    const tolerance = Math.round(fromGrid.barFrames / 8);
    const onBoundary = from.analysis.mixOut.filter(c => boundaries.some(b => Math.abs(c.frame - b.frame) <= tolerance));
    const scoped: MixAnalysis = {...from.analysis, mixOut: onBoundary};
    const barOf = (frame: number): number => boundaries.reduce((best, b) =>
      Math.abs(b.frame - frame) < Math.abs(best.frame - frame) ? b : best).bar;
    if (!onBoundary.length) notes.push('No analyzed A cue lies on the requested boundary.');
    else {
      const features = pairFeatures(scoped, to.analysis, fromGrid.bpm, maxOverlapSeconds, input.style);
      const auto = chooseChoreography(features);
      if (input.explore) explore = exploreChoice(input.explore.seed, features, Math.min(3, to.analysis.mixIn.length));
      const choreography: ChoreographyParams = input.options?.choreography ?? explore?.choreography ?? auto.params;
      const cuesAt = (bar: number): MixAnalysis['mixOut'] => onBoundary.filter(c => Math.abs(c.frame - downbeatAt(fromGrid, bar)) <= tolerance);
      const safeCarve: ChoreographyParams = {name: 'mid-carve', overlapBars: 8, swapMs: CHOREOGRAPHY_LIMITS.swapMs.default};
      for (const recipe of order) {
        if (recipe === 'echo-reset' || recipe === 'cut') break; // route-free and last-resort handled below
        const stretched = SET_STRETCHED.includes(recipe);
        const meet = recipe === 'meet-in-middle';
        const usesChoreo = ['blend', 'meet-in-middle'].includes(recipe);
        const planWith = (chosen: ChoreographyParams, scope: MixAnalysis): MixDecision => planAutomaticMix(scope, to.analysis!, {...input.options, recipe: recipe as NonNullable<MixPlannerOptions['recipe']>,
          minimumFromFrame: earliestFrame, returnToOriginalTempo: stretched, harmonicMode: 'limited',
          ...(usesChoreo ? {choreography: chosen} : {}),
          ...(explore ? {entryRank: explore.entryIndex} : {}),
          ...(meet ? {meetBpm: meetTempo(fromGrid.bpm, toGrid.bpm, explore?.meetFraction ?? 0.5),
            tempoReturn: {bars: policy.perDeckChange > 0.05 ? 8 : 4, curve: 'smoothstep' as const}} :
            stretched && policy.band === 'stretched' ? {tempoReturn: {bars: 4, curve: 'smoothstep' as const}} : {}),
          ...(recipe === 'echo-out' ? {echoHeuristic: true} : {})});
        // S21: one rejected parameterisation (overlap, boundary, choreography) never removes the recipe family:
        // the next variant of the same recipe is tried before the next recipe. A request-fixed choreography stays fixed.
        const fixed = !!input.options?.choreography;
        const variants: {choreo: ChoreographyParams; scope: MixAnalysis}[] = [{choreo: choreography, scope: scoped},
          ...boundaries.map(b => ({choreo: choreography, scope: {...scoped, mixOut: cuesAt(b.bar)}})).filter(v => v.scope.mixOut.length),
          ...(usesChoreo && !fixed ? [auto.params, safeCarve].map(choreo => ({choreo, scope: scoped})) : [])];
        const said = new Set<string>();
        const reject = (reason: string): void => { if (!said.has(reason)) { said.add(reason); rejected.push({recipe, reason}); } };
        for (const variant of variants) {
          let plan = planWith(variant.choreo, variant.scope), exploreRefused = false;
          // S21: an explore draw the planner refuses is never recorded; fall back to the Auto choreography.
          if (plan.kind !== 'mix' && usesChoreo && explore && !fixed && variant.choreo === explore.choreography) {
            const retry = planWith(auto.params, variant.scope);
            if (retry.kind === 'mix') {
              exploreRefused = true;
              notes.push(`Explore draw ${explore.choreography.name} (${explore.choreography.overlapBars} bars) was refused (${plan.reason}); using the Auto choreography.`);
              plan = retry;
            }
          }
          if (plan.kind !== 'mix') { reject(plan.reason); continue; }
          if (exclude.has(transitionSignature(plan, barOf(plan.fromExitFrame)))) { reject('The same parameters were rejected earlier for this request.'); continue; }
          if (['tempo-ramp', 'brake'].includes(plan.recipe) && to.channels > 2) { reject('Native-rate render needs a prepared B.'); continue; }
          if (stretched) {
            try {
              const window = setBlendWindow(plan, to.analysis, to.frames);
              if (!fitsBlendRender(window.sourceEndFrame - window.sourceStartFrame, to.channels, sampleRate)) {
                throw new Error('B entry exceeds the bounded time-stretch render budget.');
              }
            } catch (error) { reject(error instanceof Error ? error.message : String(error)); continue; }
          }
          if (plan.choreography) why.push(...(fixed ? ['Choreography fixed by the request.'] :
            explore && !exploreRefused && variant.choreo === explore.choreography ? [`Explore seed ${explore.seed} drew ${plan.choreography.params.name}.`] : auto.reasons));
          if (rejected.length) notes.push(...rejected.map(r => `${r.recipe} unavailable: ${r.reason}`));
          return {kind: 'analyzed', plan, ...base(barOf(plan.fromExitFrame))};
        }
      }
    }
  } else notes.push('Analysis unavailable for at least one song.');
  // Route-free: crossfade (close tempi) or the filtered echo reset; a clean cut only as the last resort
  // or when the owner chose it. The requested boundary first, then earlier feasible future bars.
  const entry = routeFreeEntry(to.analysis, to.frames) ?? undefined;
  const allowCut = owner === 'cut' || order.includes('cut');
  const tryRouteFree = (cut: boolean): SetTransitionChoice | null => {
    // Earlier feasible bars first (more audio left in A), then up to two later bars: the echo needs its
    // pre-roll before the exit, which can leave the requested bar itself short of the earliest effect frame.
    const bars: number[] = [];
    for (let bar = first.bar; bar >= 0 && downbeatAt(fromGrid, bar) >= earliestFrame; bar--) bars.push(bar);
    for (let bar = first.bar + 1; bar <= first.bar + ROUTE_FREE_LATER_BARS; bar++) bars.push(bar);
    for (const bar of bars) {
      const frame = downbeatAt(fromGrid, bar);
      const plan = planRouteFreeTransition({grid: fromGrid, frames: from.frames}, {grid: toGrid, frames: to.frames},
        frame, sampleRate, {...(entry !== undefined ? {entryFrame: entry} : {}), exclude: [...exclude], allowCut: cut, earliestFrame});
      if (plan.kind === 'route-free') {
        if (bar !== first.bar) notes.push(`Requested bar ${first.bar + 1} lacks ${bar > first.bar ? 'room for the effect pre-roll' : 'audio'}; using bar ${bar + 1}.`);
        if (rejected.length) notes.push(...rejected.map(r => `${r.recipe} unavailable: ${r.reason}`));
        return {kind: 'route-free', plan, ...base(bar)};
      }
    }
    return null;
  };
  // An owner-selected analyzed cut keeps the S18 analyzed cut before any route-free plan.
  if (owner === 'cut' && from.analysis && to.analysis) {
    const scoped = {...from.analysis, mixOut: from.analysis.mixOut.filter(c => boundaries.some(b => Math.abs(c.frame - b.frame) <= Math.round(fromGrid.barFrames / 8)))};
    const cut = planAutomaticMix(scoped, to.analysis, {recipe: 'cut', minimumFromFrame: earliestFrame});
    if (cut.kind === 'mix') return {kind: 'analyzed', plan: cut, ...base(boundaries.reduce((b, x) => Math.abs(x.frame - cut.fromExitFrame) < Math.abs(b.frame - cut.fromExitFrame) ? x : b).bar)};
  }
  const smooth = owner === 'cut' ? null : tryRouteFree(false);
  if (smooth) return smooth;
  if (allowCut && !exclude.has('cut')) {
    // Last resort: the analyzed cut (exact cue) before the route-free cut.
    if (from.analysis && to.analysis && owner !== 'cut') {
      const scoped = {...from.analysis, mixOut: from.analysis.mixOut.filter(c => boundaries.some(b => Math.abs(c.frame - b.frame) <= Math.round(fromGrid.barFrames / 8)))};
      const cut = planAutomaticMix(scoped, to.analysis, {recipe: 'cut', minimumFromFrame: earliestFrame});
      if (cut.kind === 'mix') {
        if (rejected.length) notes.push(...rejected.map(r => `${r.recipe} unavailable: ${r.reason}`));
        notes.push('Clean cut chosen only because every other candidate was rejected.');
        return {kind: 'analyzed', plan: cut, ...base(boundaries.reduce((b, x) => Math.abs(x.frame - cut.fromExitFrame) < Math.abs(b.frame - cut.fromExitFrame) ? x : b).bar)};
      }
    }
    const cut = tryRouteFree(true);
    if (cut) return cut;
  }
  return {kind: 'unavailable', reason: 'No future bar of A leaves room for a handover; A will finish naturally.', notes};
}

/** S21 versioned, replayable record of the exact plan scheduled (ratings attach to it). */
export function setTransitionRecord(choice: Exclude<SetTransitionChoice, {kind: 'unavailable'}>,
  from: {readonly id: string; readonly sha256: string}, to: {readonly id: string; readonly sha256: string; readonly frames: number},
  sampleRate: number, mode: 'auto' | 'explore' | 'manual', seed: number | null = null): TransitionPlanRecord {
  const plan = choice.plan;
  const choreography = choice.kind === 'analyzed' ? plan.kind === 'mix' && 'choreography' in plan ? plan.choreography?.params ?? null : null : null;
  const meet = choice.kind === 'analyzed' && 'meet' in plan ? plan.meet ?? null : null;
  const entryRank = choice.kind === 'analyzed' && 'entry' in plan ? plan.entry?.rank ?? null : null;
  const overlapBars = choreography ? choreography.overlapBars : choice.kind === 'analyzed' ? (plan as AutomaticMixPlan).overlapBeats / 4 : choice.plan.bars || null;
  return makeTransitionPlanRecord({mode, seed: choice.explore?.seed ?? seed,
    versions: {policy: TRANSITION_POLICY_VERSION, planner: MIX_PLANNER_VERSION, analysis: `${MIX_ANALYSIS_VERSION}+${SONG_MERGE_POLICY.policy}`,
      choreography: CHOREOGRAPHY_VERSION, safety: 'transition-safety@1'},
    from: {id: from.id, sha256: from.sha256, bpm: plan.fromBpm, exitFrame: plan.fromExitFrame, exitBar: choice.exitBar + 1},
    to: {id: to.id, sha256: to.sha256, bpm: plan.toBpm, entryFrame: plan.toEntryFrame, entrySeconds: plan.toEntryFrame / sampleRate,
      skippedFraction: plan.toEntryFrame / to.frames, entryRank},
    sampleRate, tempo: {gap: choice.policy?.gap ?? Math.abs(plan.toBpm / plan.fromBpm - 1), band: choice.policy?.band ?? 'normal', meetBpm: meet?.bpm ?? null},
    recipe: plan.recipe as SetRecipe | RouteFreeRecipe, choreography, overlapBars,
    why: [...(choice.why ?? [])], rejected: [...(choice.rejected ?? [])]});
}
