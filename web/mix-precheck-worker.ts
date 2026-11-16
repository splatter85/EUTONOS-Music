/** One bounded offline model job. This worker never owns a live audio context. */
import {evaluateTransition} from './mix-evaluator.js';
import {MIX_EVALUATION_THRESHOLDS} from './mix-evaluator.js';
import {PRECHECK_PROTOCOL, PRECHECK_LIMITS, type PrecheckJob, type PrecheckSource} from './mix-precheck-data.js';
import type {MixPcm} from '../src/mix-analysis.js';

type Request =
  | {protocol: typeof PRECHECK_PROTOCOL; kind: 'start'; job: PrecheckJob}
  | {protocol: typeof PRECHECK_PROTOCOL; kind: 'chunk'; name: PrecheckSource; start: number; channels: Float32Array[]}
  | {protocol: typeof PRECHECK_PROTOCOL; kind: 'finish'};
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<Request>) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(value: unknown): void;
};
const check = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
let job: PrecheckJob | null = null, streamIndex = 0, nextFrame = 0, finished = false;
const audio = new Map<PrecheckSource, MixPcm>();
const fail = (error: unknown): void => {
  finished = true; audio.clear();
  scope.postMessage({protocol: PRECHECK_PROTOCOL, ok: false, error: error instanceof Error ? error.message : String(error)});
};
scope.onmessage = event => {
  if (finished) return;
  try {
    const message = event.data;
    check(message?.protocol === PRECHECK_PROTOCOL, 'Unsupported pre-check protocol.');
    if (message.kind === 'start') {
      check(!job, 'Pre-check worker already has a job.');
      const request = message.job;
      check(request && Number.isInteger(request.rate) && request.rate >= 8000 && request.rate <= 192000 &&
        Array.isArray(request.streams) && request.streams.length >= 2 && request.streams.length <= 4, 'Invalid pre-check job.');
      const names = request.streams.map(stream => stream.name);
      check(names[0] === 'from' && names[1] === 'to' && new Set(names).size === names.length &&
        names.every(name => ['from', 'to', 'prepared', 'loop'].includes(name)), 'Invalid pre-check stream order.');
      check(request.streams.every(stream => Number.isSafeInteger(stream.frames) && stream.frames > 0 &&
        [1, 2].includes(stream.channels)) &&
        request.streams.reduce((n, stream) => n + stream.frames * stream.channels, 0) <= PRECHECK_LIMITS.inputSamples,
      'Pre-check input allocation exceeds its budget.');
      const context = Math.round(MIX_EVALUATION_THRESHOLDS.contextSeconds * request.rate);
      const S = Math.min(context, request.spec.fromStartFrame);
      const T = S + request.spec.preRollFrames + (request.spec.entryDelayFrames ?? 0);
      const length = Math.max(S + request.spec.automation.outgoing.durationFrames, T + request.spec.automation.incoming.durationFrames) + context;
      check(Number.isSafeInteger(length) && length > 0 &&
        length * Math.max(...request.streams.map(stream => stream.channels)) <= PRECHECK_LIMITS.renderSamples &&
        request.coverage.frames === length, 'Pre-check render allocation exceeds its budget.');
      check(!names.includes('loop') || names.includes('prepared'), 'The finite loop needs its prepared B entry.');
      for (const stream of request.streams) audio.set(stream.name, {sampleRate: request.rate,
        channels: Array.from({length: stream.channels}, () => new Float32Array(stream.frames))});
      job = request;
      scope.postMessage({protocol: PRECHECK_PROTOCOL, ok: true, kind: 'ready'});
    } else if (message.kind === 'chunk') {
      check(job, 'Pre-check worker needs a job before PCM.');
      const stream = job!.streams[streamIndex];
      const count = message.channels?.[0]?.length ?? 0;
      check(stream && message.name === stream.name && message.start === nextFrame && Array.isArray(message.channels) &&
        message.channels.length === stream.channels && count > 0 && nextFrame + count <= stream.frames &&
        count * stream.channels <= PRECHECK_LIMITS.chunkSamples &&
        message.channels.every(channel => channel instanceof Float32Array && channel.length === count),
      'Pre-check chunks must be bounded, contiguous and in stream order.');
      for (const channel of message.channels) for (const value of channel)
        check(Number.isFinite(value) && Math.abs(value) <= 16, 'Invalid pre-check PCM sample.');
      const target = audio.get(message.name)!;
      message.channels.forEach((channel, i) => (target.channels[i]! as Float32Array).set(channel, nextFrame));
      nextFrame += count;
      scope.postMessage({protocol: PRECHECK_PROTOCOL, ok: true, kind: 'chunk', name: stream!.name, nextFrame});
      if (nextFrame === stream!.frames) { streamIndex++; nextFrame = 0; }
    } else if (message.kind === 'finish') {
      check(job && streamIndex === job.streams.length, 'Pre-check is missing PCM.');
      const prepared = audio.get('prepared'), loop = audio.get('loop');
      const result = evaluateTransition(audio.get('from')!, audio.get('to')!, job!.spec, job!.analysis,
        prepared ? {audio: prepared, entryFrame: job!.preparedEntry!, ...(loop ? {outgoingLoop: loop} : {})} : undefined);
      finished = true; audio.clear();
      scope.postMessage({protocol: PRECHECK_PROTOCOL, ok: true, kind: 'complete', result});
    } else throw new Error('Unsupported pre-check request.');
  } catch (error) { fail(error); }
};
scope.onmessageerror = () => fail(new Error('Pre-check request could not be decoded.'));
