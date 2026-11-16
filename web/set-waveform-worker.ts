import {
  WaveformAccumulator, WAVEFORM_WORKER_PROTOCOL,
  type WaveformWorkerRequest, type WaveformWorkerResponse,
} from './set-waveform.js';

// This entry point is loaded only as a module worker. The reducer has no startup effects.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WaveformWorkerRequest>) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(message: WaveformWorkerResponse): void;
};
let accumulator: WaveformAccumulator | null = null;
let failed = false;
const fail = (error: unknown): void => {
  failed = true;
  scope.postMessage({protocol: WAVEFORM_WORKER_PROTOCOL, ok: false,
    error: error instanceof Error ? error.message : String(error)});
};
scope.onmessage = (event): void => {
  if (failed) return;
  try {
    const job = event.data;
    if (job?.protocol !== WAVEFORM_WORKER_PROTOCOL) throw new Error('Unsupported waveform protocol.');
    if (job.kind === 'start') {
      if (accumulator) throw new Error('Waveform worker already has a song.');
      accumulator = new WaveformAccumulator(job.dimensions);
      scope.postMessage({protocol: WAVEFORM_WORKER_PROTOCOL, ok: true, kind: 'ready'});
    } else if (job.kind === 'chunk') {
      if (!accumulator) throw new Error('Waveform worker needs song dimensions first.');
      const nextFrame = accumulator.append(job.startFrame, job.channels);
      scope.postMessage({protocol: WAVEFORM_WORKER_PROTOCOL, ok: true, kind: 'chunk', nextFrame});
    } else if (job.kind === 'finish') {
      if (!accumulator) throw new Error('Waveform worker needs song dimensions first.');
      const result = accumulator.finish();
      scope.postMessage({protocol: WAVEFORM_WORKER_PROTOCOL, ok: true, kind: 'complete', result});
    } else throw new Error('Unsupported waveform job kind.');
  } catch (error) { fail(error); }
};
scope.onmessageerror = (): void => { fail(new Error('Waveform worker request could not be decoded.')); };
