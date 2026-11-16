import {TIME_PITCH_LIMITS, TIME_PITCH_PROCESSOR,
  type PreparedTimePitch, type PreparedFiniteLoop, type TimePitchOptions, type TimePitchPcm} from './time-pitch.js';
import {MIX_ANALYSIS_LIMITS, MIX_ANALYSIS_VERSION, MIX_LEVEL_VERSION, SONG_ANALYSIS_WINDOW, mixLevelWindowFrames,
  type MixAnalysis, type MixAnalysisOptions, type NativeSamplePeak} from './mix-analysis.js';

/** A selected minute of real evidence. Grid extrapolation is not additional cue evidence. */
export {SONG_ANALYSIS_WINDOW} from './mix-analysis.js';
export function songAnalysisWindowFrames(frames: number, sampleRate: number): number {
  return Math.min(frames, Math.floor(sampleRate * SONG_ANALYSIS_WINDOW.seconds), MIX_ANALYSIS_LIMITS.maxChannelSamples);
}
/** One request's mono tempo copy plus original-channel level copy share the transfer budget. */
export function songLevelWindowFrames(frames: number, sampleRate: number, channels: number): number {
  const monoFrames = songAnalysisWindowFrames(frames, sampleRate);
  return Math.min(mixLevelWindowFrames(frames, sampleRate, channels), Math.floor((MIX_ANALYSIS_LIMITS.maxChannelSamples - monoFrames) / channels));
}

/** Validate worker-derived coordinates and evidence before rebinding to a full-song timeline. */
export function validateSongAnalysis(analysis: MixAnalysis, frames: number, sampleRate: number): void {
  const unit = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 1;
  const frame = (n: number, end = false): boolean => Number.isSafeInteger(n) && n >= 0 && (end ? n <= frames : n < frames);
  const ordered = (values: readonly number[]): boolean => Array.isArray(values) &&
    values.every((n, i) => frame(n) && (i === 0 || n > values[i - 1]!));
  const interval = (start: number, end: number): boolean => frame(start) && frame(end, true) && end > start;
  const chroma = (values: readonly number[]): boolean => Array.isArray(values) && values.length === 12 && values.every(unit);
  if (!analysis || analysis.version !== MIX_ANALYSIS_VERSION || analysis.frames !== frames || analysis.sampleRate !== sampleRate ||
    analysis.analyzedWindow !== undefined ||
    !(analysis.tempo?.bpm === null || Number.isFinite(analysis.tempo?.bpm) && analysis.tempo.bpm >= 60 && analysis.tempo.bpm <= 180) ||
    ![analysis.tempo.confidence, analysis.tempo.ambiguity, analysis.beatGrid?.confidence, analysis.key?.confidence,
      analysis.structure?.downbeatConfidence, analysis.structure?.phraseConfidence].every(unit) ||
    !ordered(analysis.beatGrid.frames) || !ordered(analysis.structure.downbeatFrames) || !ordered(analysis.structure.phraseFrames) ||
    analysis.structure.assumed !== true || analysis.structure.meter?.[0] !== 4 || analysis.structure.meter?.[1] !== 4 ||
    !chroma(analysis.key.chroma) || !Array.isArray(analysis.energyCurve) ||
    !analysis.energyCurve.every(e => interval(e.startFrame, e.endFrame) && Number.isFinite(e.rms) && e.rms >= 0 &&
      Number.isFinite(e.lowRms) && e.lowRms >= 0 && (e.dbfs === null || Number.isFinite(e.dbfs))) ||
    ![analysis.mixIn, analysis.mixOut].every(cues => Array.isArray(cues) && cues.every(c => frame(c.frame) &&
      Number.isFinite(c.seconds) && Math.abs(c.seconds - c.frame / sampleRate) <= 1 / sampleRate && unit(c.score) && unit(c.confidence) &&
      (!c.evidence || interval(c.frame, c.evidence.windowEndFrame) && chroma(c.evidence.chroma) &&
        ['boundary', 'low-interference', 'track-start'].includes(c.evidence.kind) &&
        [c.evidence.boundary, c.evidence.period, c.evidence.salience, c.evidence.interference].every(unit)))) ||
    !(analysis.vocalSpans ?? []).every(s => interval(s.startFrame, s.endFrame)) ||
    !(analysis.cueFeatures ?? []).every(c => interval(c.frame, c.endFrame) && chroma(c.chroma) &&
      [c.lowOnsets, c.midFlux, c.highFlux, c.rms, c.harmonicEnergy].every(n => Number.isFinite(n) && n >= 0))) {
    throw new Error('Mix worker returned invalid song analysis coordinates or evidence.');
  }
  const level = analysis.level;
  if (level && (level.version !== MIX_LEVEL_VERSION || level.sampleRate !== sampleRate || level.startFrame !== 0 ||
    !Number.isSafeInteger(level.frames) || level.frames < 1 || level.frames > frames ||
    ![1, 2].includes(level.channels) || level.frames * level.channels > MIX_ANALYSIS_LIMITS.maxChannelSamples ||
    level.frames > sampleRate * SONG_ANALYSIS_WINDOW.seconds ||
    !(level.lufs === null || Number.isFinite(level.lufs) && level.lufs >= -70 && level.lufs <= 60) ||
    !Number.isFinite(level.samplePeak) || level.samplePeak < 0 || level.samplePeak > 16)) {
    throw new Error('Mix worker returned invalid bounded level evidence.');
  }
}

export const PREPARE_WORKER_PROTOCOL = 'eutonos.mix-preparation.v1' as const;
export interface MixPairAnalysis {readonly from: MixAnalysis; readonly to: MixAnalysis;}
export type MixWorkerRequest = {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly kind: 'loop';
  readonly audio: TimePitchPcm; readonly loopFrames: number; readonly tailFrames: number; readonly bars: 4 | 8; readonly levelGain: number} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly kind: 'peak'; readonly audio: TimePitchPcm} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL;
  readonly kind: 'render'; readonly audio: TimePitchPcm; readonly options: TimePitchOptions} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly kind: 'analyze';
  readonly from: TimePitchPcm; readonly to: TimePitchPcm; readonly fromOptions?: MixAnalysisOptions; readonly toOptions?: MixAnalysisOptions} |
  /** S18: one song, already downmixed to mono so a full 180 s stereo take fits the analysis budget. */
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly kind: 'analyze-one';
  readonly audio: TimePitchPcm; readonly levelAudio?: TimePitchPcm; readonly options: MixAnalysisOptions};
export type MixWorkerResponse = {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly ok: true; readonly kind: 'loop'; readonly result: PreparedFiniteLoop} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly ok: true; readonly kind: 'peak'; readonly result: NativeSamplePeak} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL;
  readonly ok: true; readonly kind: 'render'; readonly result: PreparedTimePitch} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly ok: true; readonly kind: 'analyze';
  readonly result: MixPairAnalysis} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly ok: true; readonly kind: 'analyze-one';
  readonly result: MixAnalysis} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly ok: false; readonly error: string};

/** Bounded private copies: active/cached input buffers are never detached or modified. */
function privateCopy(audio: TimePitchPcm): {sampleRate: number; channels: (Float32Array<ArrayBuffer> | Float64Array<ArrayBuffer>)[]} {
  const frames = audio.channels[0]?.length ?? 0;
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 192000 ||
    ![1, 2].includes(audio.channels.length) || !frames || frames / audio.sampleRate > TIME_PITCH_LIMITS.maxSeconds ||
    frames * audio.channels.length > TIME_PITCH_LIMITS.maxSamples ||
    audio.channels.some(channel => !(channel instanceof Float32Array || channel instanceof Float64Array)
      || channel.length !== frames)) throw new Error('Mix preparation input exceeds its PCM budget or is invalid.');
  return {sampleRate: audio.sampleRate, channels: audio.channels.map(channel => channel instanceof Float32Array
    ? new Float32Array(channel) : new Float64Array(channel))};
}

/** Peak-only worker jobs copy at most 60 seconds / one quarter of the existing transfer cap.
 * Sequential chunks retain caller buffers and never allocate a whole-song processed copy. */
export const NATIVE_PEAK_CHUNK_SAMPLES = TIME_PITCH_LIMITS.maxSamples / 4;
export async function scanNativePeakInWorker(audio: TimePitchPcm, signal?: AbortSignal): Promise<NativeSamplePeak> {
  const frames = audio.channels[0]?.length ?? 0, channels = audio.channels.length;
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < 8000 || audio.sampleRate > 192000 ||
    ![1, 2].includes(channels) || !frames || audio.channels.some(c =>
      !(c instanceof Float32Array || c instanceof Float64Array) || c.length !== frames)) throw new Error('Invalid native peak input.');
  const chunkFrames = Math.min(audio.sampleRate * 60, Math.floor(NATIVE_PEAK_CHUNK_SAMPLES / channels));
  let value = 0;
  for (let start = 0; start < frames; start += chunkFrames) {
    if (signal?.aborted) throw new Error('Mix preparation was cancelled.');
    const end = Math.min(frames, start + chunkFrames);
    const copy = privateCopy({sampleRate: audio.sampleRate, channels: audio.channels.map(c => c.subarray(start, end))});
    const peak = await runWorker({protocol: PREPARE_WORKER_PROTOCOL, kind: 'peak', audio: copy},
      copy.channels.map(c => c.buffer), data => {
        if (!data.ok || data.kind !== 'peak' || data.result?.version !== 'native-sample-peak@1' ||
          data.result.frames !== end - start || !Number.isFinite(data.result.value) || data.result.value < 0 || data.result.value > 16)
          throw new Error('Invalid native peak worker receipt.');
        return data.result;
      }, signal, 30000);
    value = Math.max(value, peak.value);
  }
  return {version: 'native-sample-peak@1', frames, value};
}

function runWorker<T>(message: MixWorkerRequest, transfer: ArrayBuffer[], validate: (response: MixWorkerResponse) => T,
  signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Mix preparation was cancelled.')); return; }
    if (typeof Worker === 'undefined') { reject(new Error('Mix preparation requires a browser Worker.')); return; }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      reject(new Error('Preparation timeout must be between 100 and 30000 ms.')); return;
    }
    const worker = new Worker(new URL('./mix-worker.js', import.meta.url), {type: 'module'});
    let settled = false;
    const finish = (result: T | null, error: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = (): void => finish(null, new Error('Mix preparation was cancelled.'));
    const timeout = setTimeout(() => finish(null, new Error('Mix preparation exceeded its time budget.')), timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    worker.onerror = event => finish(null, new Error('Mix worker failed: ' + event.message));
    worker.onmessageerror = () => finish(null, new Error('Mix worker returned an unreadable message.'));
    worker.onmessage = (event: MessageEvent<MixWorkerResponse>): void => {
      if (settled) return;
      try {
        const data = event.data;
        if (data?.protocol !== PREPARE_WORKER_PROTOCOL || typeof data.ok !== 'boolean') {
          throw new Error('Mix worker returned an invalid response.');
        }
        if (!data.ok) throw new Error(data.error);
        finish(validate(data), null);
      } catch (error) { finish(null, error instanceof Error ? error : new Error(String(error))); }
    };
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage(message, transfer); }
    catch (error) { finish(null, error instanceof Error ? error : new Error(String(error))); }
  });
}

/** Browser loop preparation remains worker-owned and bounded; no synchronous DSP fallback. */
export async function prepareFiniteLoop(audio: TimePitchPcm, loopFrames: number, tailFrames: number, bars: 4 | 8,
  levelGain: number, signal?: AbortSignal): Promise<PreparedFiniteLoop> {
  const copy = privateCopy(audio);
  return runWorker({protocol: PREPARE_WORKER_PROTOCOL, kind: 'loop', audio: copy, loopFrames, tailFrames, bars, levelGain},
    copy.channels.map(c => c.buffer), data => {
      if (!data.ok || data.kind !== 'loop' || data.result.processor !== 'finite-loop@1' || data.result.loopFrames !== loopFrames ||
        data.result.tailFrames !== tailFrames || data.result.audio.sampleRate !== audio.sampleRate ||
        data.result.audio.channels.length !== audio.channels.length || data.result.audio.channels.some(c => !(c instanceof Float32Array) || c.length !== loopFrames + tailFrames) ||
        !Number.isFinite(data.result.metrics.periodicity) || data.result.metrics.periodicity < 0.35 || data.result.metrics.periodicity > 1.000001 ||
        !Number.isFinite(data.result.metrics.energyRatio) || data.result.metrics.energyRatio < 1 || data.result.metrics.energyRatio > 4 ||
        !Number.isFinite(data.result.metrics.peak) || data.result.metrics.peak < 0 || data.result.metrics.peak * levelGain > TIME_PITCH_LIMITS.peakCeiling + 1e-7 ||
        !Number.isFinite(data.result.metrics.seamError) || data.result.metrics.seamError < 0 || data.result.metrics.seamError > 1e-7) throw new Error('Invalid finite loop worker receipt.');
      return data.result;
    }, signal, 30000);
}

/** Browser only. Node calls renderTimePitch directly. No synchronous browser fallback. */
export async function prepareTimePitch(audio: TimePitchPcm, options: TimePitchOptions,
  signal?: AbortSignal, timeoutMs = 30_000): Promise<PreparedTimePitch> {
  if (signal?.aborted) throw new Error('Mix preparation was cancelled.');
  const copy = privateCopy(audio), expected = structuredClone(options), frames = copy.channels[0]!.length;
  const message: MixWorkerRequest = {protocol: PREPARE_WORKER_PROTOCOL, kind: 'render', audio: copy, options: expected};
  return runWorker(message, copy.channels.map(channel => channel.buffer), data => {
    if (!data.ok || data.kind !== 'render') throw new Error('Mix worker returned the wrong job kind.');
    const result = data.result;
    if (result?.processor !== TIME_PITCH_PROCESSOR || result.audio?.sampleRate !== audio.sampleRate ||
      result.mapping?.inputFrames !== frames || result.mapping.tempoRatio !== expected.tempoRatio ||
      result.mapping.pitchSemitones !== (expected.pitchSemitones ?? 0) ||
      JSON.stringify(result.mapping.returnToOriginal) !== JSON.stringify(expected.returnToOriginal ?? null) ||
      JSON.stringify(result.mapping.rampIn ?? null) !== JSON.stringify(expected.rampIn ?? null) ||
      !Number.isSafeInteger(result.mapping.outputFrames) || result.mapping.outputFrames < 1 ||
      result.mapping.outputFrames * audio.channels.length > TIME_PITCH_LIMITS.maxSamples / TIME_PITCH_LIMITS.minTempoRatio ||
      result.audio.channels?.length !== audio.channels.length || result.audio.channels.some(channel =>
        !(channel instanceof Float32Array) || channel.length !== result.mapping.outputFrames) ||
      !Number.isFinite(result.metrics?.outputPeak) || result.metrics.outputPeak > TIME_PITCH_LIMITS.peakCeiling + 1e-7 ||
      result.metrics.boundaryJump !== 0) throw new Error('Mix worker returned an invalid prepared render.');
    return result;
  }, signal, timeoutMs);
}

/** Audio analysis uses the same disposable worker ownership and abort/late-result rules. */
export async function analyzeMixPairInWorker(from: TimePitchPcm, to: TimePitchPcm,
  signal?: AbortSignal, options: {readonly from?: MixAnalysisOptions; readonly to?: MixAnalysisOptions} = {}, timeoutMs = 30_000): Promise<MixPairAnalysis> {
  if (signal?.aborted) throw new Error('Mix preparation was cancelled.');
  const left = privateCopy(from), right = privateCopy(to);
  const message: MixWorkerRequest = {protocol: PREPARE_WORKER_PROTOCOL, kind: 'analyze', from: left, to: right,
    ...(options.from ? {fromOptions: structuredClone(options.from)} : {}), ...(options.to ? {toOptions: structuredClone(options.to)} : {})};
  return runWorker(message, [...left.channels, ...right.channels].map(channel => channel.buffer), data => {
    if (!data.ok || data.kind !== 'analyze' || !data.result?.from || !data.result.to ||
      !Number.isFinite(data.result.from.tempo?.confidence) || !Number.isFinite(data.result.to.tempo?.confidence)) {
      throw new Error('Mix worker returned invalid analysis.');
    }
    return data.result;
  }, signal, timeoutMs);
}

/**
 * Bounded leading mono copy of the supplied window, independent of full-song length or the
 * WSOLA budget. The cache selects/rebinds native window coordinates; inputs stay untouched.
 */
export function monoAnalysisCopy(audio: TimePitchPcm): {sampleRate: number; channels: [Float32Array<ArrayBuffer>]} {
  const sourceFrames = audio.channels[0]?.length ?? 0;
  const frames = songAnalysisWindowFrames(sourceFrames, audio.sampleRate);
  if (!Number.isInteger(audio.sampleRate) || audio.sampleRate < MIX_ANALYSIS_LIMITS.minSampleRate ||
    audio.sampleRate > MIX_ANALYSIS_LIMITS.maxSampleRate || ![1, 2].includes(audio.channels.length) || !frames ||
    audio.channels.some(channel => !(channel instanceof Float32Array || channel instanceof Float64Array) || channel.length !== sourceFrames)) {
    throw new Error('Song analysis input exceeds its PCM budget or is invalid.');
  }
  const mono = new Float32Array(frames), scale = 1 / audio.channels.length;
  for (const channel of audio.channels) for (let i = 0; i < frames; i++) mono[i]! += channel[i]! * scale;
  return {sampleRate: audio.sampleRate, channels: [mono]};
}

/** S18: one song's analysis in a disposable worker, with the same abort/late-result rules. */
export async function analyzeMixSongInWorker(audio: TimePitchPcm, signal?: AbortSignal,
  options: MixAnalysisOptions = {}, levelAudio: TimePitchPcm = audio, timeoutMs = 30_000): Promise<MixAnalysis> {
  if (signal?.aborted) throw new Error('Mix preparation was cancelled.');
  const copy = monoAnalysisCopy(audio), frames = copy.channels[0].length;
  const levelFrames = Math.min(levelAudio.channels[0]?.length ?? 0, songLevelWindowFrames(frames, levelAudio.sampleRate, levelAudio.channels.length));
  if (levelAudio.sampleRate !== audio.sampleRate || ![1, 2].includes(levelAudio.channels.length) || levelFrames < 1 ||
    levelAudio.channels.some(c => !(c instanceof Float32Array || c instanceof Float64Array) || c.length < levelFrames)) throw new Error('Invalid bounded stereo level input.');
  const levelCopy = {sampleRate: audio.sampleRate, channels: levelAudio.channels.map(c => new Float32Array(c.subarray(0, levelFrames)))};
  const message: MixWorkerRequest = {protocol: PREPARE_WORKER_PROTOCOL, kind: 'analyze-one', audio: copy,
    levelAudio: levelCopy, options: structuredClone(options)};
  return runWorker(message, [copy.channels[0].buffer, ...levelCopy.channels.map(c => c.buffer)], data => {
    if (!data.ok || data.kind !== 'analyze-one') {
      throw new Error('Mix worker returned invalid song analysis.');
    }
    validateSongAnalysis(data.result, frames, audio.sampleRate);
    if (data.result.level?.frames !== levelFrames || data.result.level.channels !== levelCopy.channels.length) throw new Error('Mix worker level evidence does not match its stereo window.');
    return data.result;
  }, signal, timeoutMs);
}
