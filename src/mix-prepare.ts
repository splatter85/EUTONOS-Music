import {TIME_PITCH_LIMITS, TIME_PITCH_PROCESSOR,
  type PreparedTimePitch, type TimePitchOptions, type TimePitchPcm} from './time-pitch.js';
import type {MixAnalysis} from './mix-analysis.js';

export const PREPARE_WORKER_PROTOCOL = 'eutonos.mix-preparation.v1' as const;
export interface MixPairAnalysis {readonly from: MixAnalysis; readonly to: MixAnalysis;}
export type MixWorkerRequest = {readonly protocol: typeof PREPARE_WORKER_PROTOCOL;
  readonly kind: 'render'; readonly audio: TimePitchPcm; readonly options: TimePitchOptions} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly kind: 'analyze';
  readonly from: TimePitchPcm; readonly to: TimePitchPcm};
export type MixWorkerResponse = {readonly protocol: typeof PREPARE_WORKER_PROTOCOL;
  readonly ok: true; readonly kind: 'render'; readonly result: PreparedTimePitch} |
  {readonly protocol: typeof PREPARE_WORKER_PROTOCOL; readonly ok: true; readonly kind: 'analyze';
  readonly result: MixPairAnalysis} |
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
  signal?: AbortSignal, timeoutMs = 30_000): Promise<MixPairAnalysis> {
  if (signal?.aborted) throw new Error('Mix preparation was cancelled.');
  const left = privateCopy(from), right = privateCopy(to);
  const message: MixWorkerRequest = {protocol: PREPARE_WORKER_PROTOCOL, kind: 'analyze', from: left, to: right};
  return runWorker(message, [...left.channels, ...right.channels].map(channel => channel.buffer), data => {
    if (!data.ok || data.kind !== 'analyze' || !data.result?.from || !data.result.to ||
      !Number.isFinite(data.result.from.tempo?.confidence) || !Number.isFinite(data.result.to.tempo?.confidence)) {
      throw new Error('Mix worker returned invalid analysis.');
    }
    return data.result;
  }, signal, timeoutMs);
}
