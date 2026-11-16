import {renderTimePitch, renderFiniteLoop} from './time-pitch.js';
import {analyzeMixAudio, measureMixLevel} from './mix-analysis.js';
import {PREPARE_WORKER_PROTOCOL, type MixWorkerRequest, type MixWorkerResponse} from './mix-prepare.js';

// Keep DOM and worker ambient libraries separate. This module is loaded ONLY as a worker.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<MixWorkerRequest>) => void) | null;
  postMessage(message: MixWorkerResponse, transfer: ArrayBuffer[]): void;
};
scope.onmessage = (event): void => {
  try {
    if (event.data?.protocol !== PREPARE_WORKER_PROTOCOL) throw new Error('Unsupported prepare protocol.');
    if (event.data.kind === 'loop') {
      const job = event.data, result = renderFiniteLoop(job.audio, job.loopFrames, job.tailFrames, job.bars, job.levelGain);
      scope.postMessage({protocol: PREPARE_WORKER_PROTOCOL, ok: true, kind: 'loop', result}, result.audio.channels.map(c => c.buffer as ArrayBuffer));
    } else if (event.data.kind === 'render') {
      const result = renderTimePitch(event.data.audio, event.data.options);
      scope.postMessage({protocol: PREPARE_WORKER_PROTOCOL, ok: true, kind: 'render', result},
        result.audio.channels.map(channel => channel.buffer as ArrayBuffer));
    } else if (event.data.kind === 'analyze') {
      const result = {from: analyzeMixAudio(event.data.from), to: analyzeMixAudio(event.data.to)};
      scope.postMessage({protocol: PREPARE_WORKER_PROTOCOL, ok: true, kind: 'analyze', result}, []);
    } else if (event.data.kind === 'analyze-one') {
      const analysis = analyzeMixAudio(event.data.audio, event.data.options);
      const result = {...analysis, level: measureMixLevel(event.data.levelAudio ?? event.data.audio)};
      scope.postMessage({protocol: PREPARE_WORKER_PROTOCOL, ok: true, kind: 'analyze-one', result}, []);
    } else throw new Error('Unsupported prepare job kind.');
  } catch (error) {
    scope.postMessage({protocol: PREPARE_WORKER_PROTOCOL, ok: false,
      error: error instanceof Error ? error.message : String(error)}, []);
  }
};
