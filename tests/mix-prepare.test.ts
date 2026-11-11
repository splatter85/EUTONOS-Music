import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio} from '../src/mix-analysis.js';
import {renderTimePitch} from '../src/time-pitch.js';
import {prepareTimePitch, analyzeMixPairInWorker, PREPARE_WORKER_PROTOCOL,
  type MixWorkerRequest, type MixWorkerResponse} from '../src/mix-prepare.js';

/** A transport double only; native Worker execution is separately checked in Chromium. */
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<MixWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  message: MixWorkerRequest | null = null;
  terminated = 0;
  constructor(readonly url: URL, readonly options: WorkerOptions) { TestWorker.instances.push(this); }
  postMessage(message: MixWorkerRequest, transfer: Transferable[]): void {
    this.message = structuredClone(message, {transfer});
  }
  terminate(): void { this.terminated++; }
  response(): MixWorkerResponse {
    const message = this.message!;
    if (message.kind === 'render') return {protocol: PREPARE_WORKER_PROTOCOL, ok: true, kind: 'render',
      result: renderTimePitch(message.audio, message.options)};
    return {protocol: PREPARE_WORKER_PROTOCOL, ok: true, kind: 'analyze', result: {
      from: analyzeMixAudio(message.from), to: analyzeMixAudio(message.to)}};
  }
  reply(message: MixWorkerResponse = this.response()): void { this.onmessage?.({data: message} as MessageEvent<MixWorkerResponse>); }
}
async function withWorker(run: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', {value: TestWorker, writable: true, configurable: true});
  TestWorker.instances = [];
  try { await run(); }
  finally {
    if (original) Object.defineProperty(globalThis, 'Worker', original);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
}
const pcm = () => ({sampleRate: 8000, channels: [Float64Array.from({length: 4000}, (_, i) =>
  0.4 * Math.sin(2 * Math.PI * 220 * i / 8000))]});

test('prepare worker transfers private copies, returns complete output, and terminates', async () => withWorker(async () => {
  const input = pcm(), before = input.channels[0]!.slice();
  const task = prepareTimePitch(input, {tempoRatio: 1.04, pitchSemitones: 1});
  const worker = TestWorker.instances[0]!;
  assert.equal(worker.options.type, 'module');
  assert.match(worker.url.pathname, /mix-worker\.js$/);
  assert.equal(worker.message?.kind, 'render');
  assert.deepEqual(input.channels[0], before);
  const expected = worker.response(); worker.reply(expected);
  const result = await task;
  assert.equal(worker.terminated, 1);
  assert.equal(result.audio.channels[0]!.length, Math.round(4000 / 1.04));
  assert.deepEqual(input.channels[0], before);
  assert.equal(worker.onmessage, null);
}));

test('analyze pair uses the worker, preserves both sources and returns two distinct reports', async () => withWorker(async () => {
  const a = pcm(), b = pcm(); b.channels[0]!.fill(0);
  const task = analyzeMixPairInWorker(a, b);
  const worker = TestWorker.instances[0]!;
  assert.equal(worker.message?.kind, 'analyze');
  worker.reply();
  const result = await task;
  assert.deepEqual(result.from, analyzeMixAudio(a));
  assert.deepEqual(result.to, analyzeMixAudio(b));
  assert.equal(a.channels[0]!.length, 4000);
  assert.equal(b.channels[0]!.length, 4000);
  assert.equal(worker.terminated, 1);
}));

test('abort terminates preparation and a delayed worker result cannot revive it', async () => withWorker(async () => {
  const controller = new AbortController(), input = pcm();
  const task = prepareTimePitch(input, {tempoRatio: 1}, controller.signal);
  const worker = TestWorker.instances[0]!, callback = worker.onmessage!, delayed = worker.response();
  controller.abort();
  await assert.rejects(task, /cancelled/);
  callback({data: delayed} as MessageEvent<MixWorkerResponse>);
  assert.equal(worker.terminated, 1);
  assert.equal(input.channels[0]!.length, 4000);
}));

test('an already aborted request never creates a worker', async () => withWorker(async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareTimePitch(pcm(), {tempoRatio: 1}, controller.signal), /cancelled/);
  await assert.rejects(analyzeMixPairInWorker(pcm(), pcm(), controller.signal), /cancelled/);
  assert.equal(TestWorker.instances.length, 0);
}));

test('worker timeout rejects and terminates instead of blocking selection indefinitely', async () => withWorker(async () => {
  await assert.rejects(prepareTimePitch(pcm(), {tempoRatio: 1}, undefined, 100), /time budget/);
  assert.equal(TestWorker.instances[0]!.terminated, 1);
}));

test('malformed replies, wrong job kind and worker errors reject and clean up', async () => withWorker(async () => {
  const badMessages = [null, {protocol: 'old', ok: true},
    {protocol: PREPARE_WORKER_PROTOCOL, ok: false, error: 'Measured quality check failed.'},
    {protocol: PREPARE_WORKER_PROTOCOL, ok: true, kind: 'analyze', result: {}}];
  for (const message of badMessages) {
    const task = prepareTimePitch(pcm(), {tempoRatio: 1}), worker = TestWorker.instances.at(-1)!;
    worker.reply(message as MixWorkerResponse);
    await assert.rejects(task);
    assert.equal(worker.terminated, 1);
  }
  const task = prepareTimePitch(pcm(), {tempoRatio: 1}), worker = TestWorker.instances.at(-1)!;
  worker.onerror!({message: 'script failed'} as ErrorEvent);
  await assert.rejects(task, /script failed/);
  assert.equal(worker.terminated, 1);
}));

test('malformed prepared PCM is refused before any caller can schedule it', async () => withWorker(async () => {
  const task = prepareTimePitch(pcm(), {tempoRatio: 1}), worker = TestWorker.instances[0]!;
  const response = worker.response();
  assert.ok(response.ok && response.kind === 'render');
  worker.reply({...response, result: {...response.result, audio: {sampleRate: 8000, channels: []}}});
  await assert.rejects(task, /invalid prepared render/);
  assert.equal(worker.terminated, 1);
}));

test('browser wrapper does not silently run blocking DSP when Worker is unavailable', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Reflect.deleteProperty(globalThis, 'Worker');
  try { await assert.rejects(prepareTimePitch(pcm(), {tempoRatio: 1}), /requires a browser Worker/); }
  finally { if (original) Object.defineProperty(globalThis, 'Worker', original); }
});

test('worker input and time budgets reject invalid requests without constructing a worker', async () => withWorker(async () => {
  for (const timeout of [0, 50, Infinity, 30_001]) await assert.rejects(prepareTimePitch(pcm(), {tempoRatio: 1}, undefined, timeout));
  await assert.rejects(prepareTimePitch({sampleRate: 8000, channels: []}, {tempoRatio: 1}));
  await assert.rejects(analyzeMixPairInWorker({sampleRate: 0, channels: [new Float32Array(100)]}, pcm()));
  assert.equal(TestWorker.instances.length, 0);
}));
