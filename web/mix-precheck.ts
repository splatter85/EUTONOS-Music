/** Browser adapter for one preselected plan. Worker deadlines never schedule music. */
import {makePrecheckWindow, validatePrecheckEvaluation, PRECHECK_PROTOCOL, PRECHECK_LIMITS,
  type PrecheckRequest, type PrecheckReport, type PrecheckWindow} from './mix-precheck-data.js';
import type {TransitionEvaluation} from './mix-evaluator.js';

const abortError = (): DOMException => new DOMException('Mix pre-check cancelled.', 'AbortError');
function runWorker(window: PrecheckWindow, signal?: AbortSignal): Promise<TransitionEvaluation> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === 'undefined') return Promise.reject(new Error('This browser cannot run the offline mix check.'));
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null, timeout: ReturnType<typeof setTimeout> | undefined, settled = false;
    let phase: 'ready' | 'chunk' | 'complete' = 'ready', index = 0, offset = 0, awaitingEnd = 0;
    const cleanup = (): void => {
      if (timeout !== undefined) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
    };
    const fail = (error: unknown): void => {
      if (settled) return; settled = true; cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const onAbort = (): void => fail(abortError());
    const next = (): void => {
      const stream = window.job.streams[index];
      if (!stream) {
        phase = 'complete'; worker!.postMessage({protocol: PRECHECK_PROTOCOL, kind: 'finish'}); return;
      }
      const count = Math.min(stream.frames - offset, Math.floor(PRECHECK_LIMITS.chunkSamples / stream.channels));
      const channels = window.copy(stream.name, offset, count);
      awaitingEnd = offset + count; phase = 'chunk';
      worker!.postMessage({protocol: PRECHECK_PROTOCOL, kind: 'chunk', name: stream.name, start: offset, channels},
        channels.map(channel => channel.buffer as ArrayBuffer));
    };
    try {
      signal?.addEventListener('abort', onAbort, {once: true});
      if (signal?.aborted) { onAbort(); return; }
      worker = new Worker(new URL('./mix-precheck-worker.js', import.meta.url), {type: 'module'});
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (settled) return;
        try {
          const reply = event.data as Record<string, unknown> | null;
          if (!reply || typeof reply !== 'object' || reply.protocol !== PRECHECK_PROTOCOL || typeof reply.ok !== 'boolean')
            throw new Error('Invalid mix pre-check reply.');
          if (!reply.ok) throw new Error(typeof reply.error === 'string' ? reply.error : 'Offline mix check failed.');
          if (phase === 'ready' && reply.kind === 'ready') next();
          else if (phase === 'chunk' && reply.kind === 'chunk' && reply.name === window.job.streams[index]?.name &&
            reply.nextFrame === awaitingEnd) {
            offset = awaitingEnd;
            if (offset === window.job.streams[index]!.frames) { index++; offset = 0; }
            next();
          } else if (phase === 'complete' && reply.kind === 'complete') {
            const source = window.job.streams.some(stream => stream.name === 'prepared') ? 'prepared'
              : window.job.spec.nativeRate?.incoming ? 'native-rate-model' : window.job.spec.tempoRatio === 1 ? 'native' : 'linear-resample';
            const result = validatePrecheckEvaluation(reply.result, window.job.spec.recipe, {source, frames: window.job.coverage.frames});
            // A prepared pitch-preserving buffer is mandatory for a non-native blend.
            if (result.bSource === 'linear-resample') throw new Error('The pre-check could not use the actual prepared entry.');
            settled = true; cleanup(); resolve(result);
          } else throw new Error('Unexpected mix pre-check phase or frame acknowledgment.');
        } catch (error) { fail(error); }
      };
      worker.onerror = event => { event.preventDefault(); fail(new Error(event.message || 'Offline mix check failed.')); };
      worker.onmessageerror = () => fail(new Error('Offline mix check reply could not be decoded.'));
      timeout = setTimeout(() => fail(new Error('The offline mix check exceeded its preparation deadline.')), PRECHECK_LIMITS.timeoutMs);
      worker.postMessage({protocol: PRECHECK_PROTOCOL, kind: 'start', job: window.job});
    } catch (error) { fail(error); }
  });
}
export async function browserMixPrecheck(request: PrecheckRequest, signal?: AbortSignal): Promise<PrecheckReport> {
  if (signal?.aborted) throw abortError();
  let window: PrecheckWindow | null = null;
  try {
    window = makePrecheckWindow(request);
    const evaluation = await runWorker(window, signal);
    const reasons = evaluation.flags.map(flag => flag.metric + ' ' + flag.level).join(', ');
    const phase = evaluation.measurements?.beatPhase;
    const reason = (reasons || 'no configured defect flagged') + (phase && !phase.judged ? '; beat phase unjudged' : '');
    return {version: PRECHECK_PROTOCOL, status: evaluation.verdict, reason, evaluation, coverage: window.job.coverage};
  } catch (error) {
    if (signal?.aborted) throw abortError();
    return {version: PRECHECK_PROTOCOL, status: 'unavailable', reason: error instanceof Error ? error.message : String(error),
      evaluation: null, coverage: window?.job.coverage ?? null};
  }
}
