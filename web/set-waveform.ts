/**
 * Full-song display data only. One worker scans private PCM chunks; this module
 * neither creates an audio context nor schedules playback.
 */
export const WAVEFORM_VERSION = 'set-waveform@1';
export const WAVEFORM_BINS = 512;
export const WAVEFORM_CHUNK_SAMPLES = 1_048_576;
export const WAVEFORM_WORKER_PROTOCOL = 'eutonos.set-waveform.v1';
const WORKER_TIMEOUT_MS = 30_000;

export interface SongWaveform {
  version: typeof WAVEFORM_VERSION;
  sampleRate: number;
  frames: number;
  channels: number;
  /** Raw absolute sample maxima, without normalization. Empty bins are zero. */
  peaks: readonly number[];
}

export interface WaveformDimensions {
  sampleRate: number;
  frames: number;
  channels: number;
}

function checkDimensions(value: WaveformDimensions): void {
  if (!Number.isInteger(value.sampleRate) || value.sampleRate < 8000 || value.sampleRate > 192000 ||
      !Number.isInteger(value.frames) || value.frames < 1 || value.frames > 0xffffffff ||
      ![1, 2].includes(value.channels)) {
    throw new Error('Invalid waveform dimensions.');
  }
}

/** Validate untrusted worker/cache data, then detach its object identity and freeze it. */
export function validateWaveform(value: unknown, expected: WaveformDimensions): SongWaveform {
  checkDimensions(expected);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid waveform result.');
  const result = value as Record<string, unknown>;
  if (result.version !== WAVEFORM_VERSION || result.sampleRate !== expected.sampleRate ||
      result.frames !== expected.frames || result.channels !== expected.channels ||
      !Array.isArray(result.peaks) || result.peaks.length !== WAVEFORM_BINS) {
    throw new Error('Waveform version, dimensions or bins do not match.');
  }
  const peaks: number[] = [];
  for (const peak of result.peaks) {
    if (typeof peak !== 'number' || !Number.isFinite(peak) || peak < 0 || peak > 16) {
      throw new Error('Invalid waveform peak.');
    }
    peaks.push(peak);
  }
  return Object.freeze({
    version: WAVEFORM_VERSION,
    sampleRate: expected.sampleRate,
    frames: expected.frames,
    channels: expected.channels,
    peaks: Object.freeze(peaks),
  });
}

/**
 * Import-safe pure reducer. Bin k covers native frames
 * [floor(k * frames / 512), floor((k + 1) * frames / 512)).
 * Appends are contiguous and transactional, including the last partial chunk.
 */
export class WaveformAccumulator {
  private readonly dimensions: WaveformDimensions;
  private peaks = Array<number>(WAVEFORM_BINS).fill(0);
  private nextFrame = 0;
  private finished = false;

  constructor(dimensions: WaveformDimensions) {
    checkDimensions(dimensions);
    this.dimensions = {...dimensions};
  }

  append(startFrame: number, channels: readonly Float32Array[]): number {
    if (this.finished) throw new Error('Waveform is already complete.');
    const count = channels?.[0]?.length ?? 0;
    if (!Number.isInteger(startFrame) || startFrame !== this.nextFrame ||
        !Array.isArray(channels) || channels.length !== this.dimensions.channels ||
        count < 1 || count * channels.length > WAVEFORM_CHUNK_SAMPLES ||
        startFrame + count > this.dimensions.frames ||
        channels.some(channel => !(channel instanceof Float32Array) || channel.length !== count)) {
      throw new Error('Waveform chunks must be bounded, equal-length and contiguous.');
    }
    const nextPeaks = this.peaks.slice();
    for (let frame = 0; frame < count; frame++) {
      const bin = Math.ceil((startFrame + frame + 1) * WAVEFORM_BINS / this.dimensions.frames) - 1;
      for (const channel of channels) {
        const peak = Math.abs(channel[frame]!);
        if (!Number.isFinite(peak) || peak > 16) throw new Error('Invalid waveform PCM sample.');
        if (peak > nextPeaks[bin]!) nextPeaks[bin] = peak;
      }
    }
    this.peaks = nextPeaks;
    this.nextFrame += count;
    return this.nextFrame;
  }

  finish(): SongWaveform {
    if (this.finished) throw new Error('Waveform is already complete.');
    if (this.nextFrame !== this.dimensions.frames) throw new Error('Waveform is missing native frames.');
    const result = validateWaveform({version: WAVEFORM_VERSION, ...this.dimensions, peaks: this.peaks},
      this.dimensions);
    this.finished = true;
    return result;
  }
}

export type WaveformWorkerRequest =
  | {protocol: typeof WAVEFORM_WORKER_PROTOCOL; kind: 'start'; dimensions: WaveformDimensions}
  | {protocol: typeof WAVEFORM_WORKER_PROTOCOL; kind: 'chunk'; startFrame: number; channels: Float32Array[]}
  | {protocol: typeof WAVEFORM_WORKER_PROTOCOL; kind: 'finish'};

export type WaveformWorkerResponse =
  | {protocol: typeof WAVEFORM_WORKER_PROTOCOL; ok: true; kind: 'ready'}
  | {protocol: typeof WAVEFORM_WORKER_PROTOCOL; ok: true; kind: 'chunk'; nextFrame: number}
  | {protocol: typeof WAVEFORM_WORKER_PROTOCOL; ok: true; kind: 'complete'; result: SongWaveform}
  | {protocol: typeof WAVEFORM_WORKER_PROTOCOL; ok: false; error: string};

function aborted(): DOMException {
  return new DOMException('Waveform preparation cancelled.', 'AbortError');
}

/**
 * Scan every native frame in one worker, at most one private chunk in flight.
 * The resource deadline only bounds this display job; it is not a music clock.
 */
export async function summarizeWaveform(buffer: AudioBuffer, signal?: AbortSignal): Promise<SongWaveform> {
  if (signal?.aborted) throw aborted();
  const dimensions = {sampleRate: buffer.sampleRate, frames: buffer.length, channels: buffer.numberOfChannels};
  checkDimensions(dimensions);
  if (typeof Worker === 'undefined') throw new Error('Waveform preparation requires a browser worker.');
  return new Promise<SongWaveform>((resolve, reject) => {
    let worker: Worker | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let phase: 'ready' | 'chunk' | 'complete' = 'ready';
    let nextFrame = 0;
    let awaitingEnd = 0;
    const cleanup = (): void => {
      if (timeout !== undefined) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = (): void => { fail(aborted()); };
    const sendNext = (): void => {
      if (nextFrame === dimensions.frames) {
        phase = 'complete';
        worker!.postMessage({protocol: WAVEFORM_WORKER_PROTOCOL, kind: 'finish'} satisfies WaveformWorkerRequest);
        return;
      }
      awaitingEnd = Math.min(dimensions.frames,
        nextFrame + Math.floor(WAVEFORM_CHUNK_SAMPLES / dimensions.channels));
      const copies: Float32Array<ArrayBuffer>[] = [];
      for (let channel = 0; channel < dimensions.channels; channel++) {
        // Reacquire each native view per chunk: playback may acquire the buffer
        // between worker acknowledgments. Only these private copies transfer.
        const native = buffer.getChannelData(channel);
        if (!(native instanceof Float32Array) || native.length !== dimensions.frames) {
          throw new Error('Waveform native PCM dimensions changed.');
        }
        copies.push(new Float32Array(native.subarray(nextFrame, awaitingEnd)));
      }
      phase = 'chunk';
      worker!.postMessage({protocol: WAVEFORM_WORKER_PROTOCOL, kind: 'chunk',
        startFrame: nextFrame, channels: copies} satisfies WaveformWorkerRequest,
      copies.map(channel => channel.buffer));
    };
    try {
      signal?.addEventListener('abort', onAbort, {once: true});
      if (signal?.aborted) { onAbort(); return; }
      worker = new Worker(new URL('./set-waveform-worker.js', import.meta.url), {type: 'module'});
      worker.onmessage = (event: MessageEvent<unknown>): void => {
        if (settled) return;
        try {
          if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
            throw new Error('Invalid waveform worker reply.');
          }
          const reply = event.data as Record<string, unknown>;
          if (reply.protocol !== WAVEFORM_WORKER_PROTOCOL || typeof reply.ok !== 'boolean') {
            throw new Error('Invalid waveform worker protocol.');
          }
          if (!reply.ok) {
            throw new Error(typeof reply.error === 'string' ? reply.error : 'Waveform worker failed.');
          }
          if (phase === 'ready' && reply.kind === 'ready') {
            sendNext();
          } else if (phase === 'chunk' && reply.kind === 'chunk' && reply.nextFrame === awaitingEnd) {
            nextFrame = awaitingEnd;
            sendNext();
          } else if (phase === 'complete' && reply.kind === 'complete') {
            const result = validateWaveform(reply.result, dimensions);
            settled = true;
            cleanup();
            resolve(result);
          } else throw new Error('Unexpected waveform worker reply or frame acknowledgment.');
        } catch (error) { fail(error); }
      };
      worker.onerror = (event): void => {
        event.preventDefault();
        fail(new Error(event.message || 'Waveform worker failed.'));
      };
      worker.onmessageerror = (): void => { fail(new Error('Waveform worker reply could not be decoded.')); };
      timeout = setTimeout(() => { fail(new Error('Waveform preparation timed out.')); }, WORKER_TIMEOUT_MS);
      worker.postMessage({protocol: WAVEFORM_WORKER_PROTOCOL, kind: 'start', dimensions} satisfies WaveformWorkerRequest);
    } catch (error) { fail(error); }
  });
}
