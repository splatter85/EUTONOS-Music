/**
 * Same-thread pre-check runtime: the exact window, evaluator, validation and status rules of the Worker adapter
 * (`browserMixPrecheck`), run inline. For Node tests and the pair-search timing measurement only; the browser
 * page always uses the Worker so the main thread never runs the evaluator.
 */
import {evaluateTransition} from './mix-evaluator.js';
import {makePrecheckWindow, validatePrecheckEvaluation, reportFromEvaluation, PRECHECK_PROTOCOL, PRECHECK_LIMITS,
  type PrecheckRequest, type PrecheckReport} from './mix-precheck-data.js';
import type {MixPcm} from '../src/mix-analysis.js';

export async function inlineMixPrecheck(request: PrecheckRequest, signal?: AbortSignal): Promise<PrecheckReport> {
  if (signal?.aborted) throw new Error('Mix pre-check cancelled.');
  let coverage: PrecheckReport['coverage'] = null;
  try {
    const window = makePrecheckWindow(request);
    coverage = window.job.coverage;
    const input = new Map<string, MixPcm>();
    for (const stream of window.job.streams) {
      const channels = Array.from({length: stream.channels}, () => new Float32Array(stream.frames));
      for (let start = 0; start < stream.frames;) {
        const count = Math.min(stream.frames - start, Math.floor(PRECHECK_LIMITS.chunkSamples / stream.channels));
        window.copy(stream.name, start, count).forEach((copy, c) => channels[c]!.set(copy, start));
        start += count;
      }
      input.set(stream.name, {sampleRate: window.job.rate, channels});
    }
    const prepared = input.get('prepared'), loop = input.get('loop');
    const raw = evaluateTransition(input.get('from')!, input.get('to')!, window.job.spec, window.job.analysis,
      prepared ? {audio: prepared, entryFrame: window.job.preparedEntry!, ...(loop ? {outgoingLoop: loop} : {})} : undefined);
    const source = prepared ? 'prepared' : window.job.spec.nativeRate?.incoming ? 'native-rate-model' : window.job.spec.tempoRatio === 1 ? 'native' : 'linear-resample';
    const evaluation = validatePrecheckEvaluation(JSON.parse(JSON.stringify(raw)), window.job.spec.recipe, {source, frames: window.job.coverage.frames});
    if (evaluation.bSource === 'linear-resample') throw new Error('The pre-check could not use the actual prepared entry.');
    if (signal?.aborted) throw new Error('Mix pre-check cancelled.');
    return reportFromEvaluation(evaluation, window.job.coverage);
  } catch (error) {
    if (signal?.aborted) throw error;
    return {version: PRECHECK_PROTOCOL, status: 'unavailable', reason: error instanceof Error ? error.message : String(error), evaluation: null, coverage};
  }
}
