import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {Worker as ThreadWorker} from 'node:worker_threads';
import {
  WAVEFORM_VERSION, WAVEFORM_BINS, WAVEFORM_CHUNK_SAMPLES, WAVEFORM_WORKER_PROTOCOL,
  WaveformAccumulator, summarizeWaveform, validateWaveform,
  type SongWaveform, type WaveformDimensions, type WaveformWorkerRequest, type WaveformWorkerResponse,
} from '../web/set-waveform.js';

const dimensions = (frames: number, channels = 1): WaveformDimensions =>
  ({sampleRate: 48_000, frames, channels});

function pcmBuffer(channels: Float32Array[], sampleRate = 48_000): AudioBuffer {
  return {sampleRate, length: channels[0]!.length, numberOfChannels: channels.length,
    duration: channels[0]!.length / sampleRate, getChannelData: (channel: number) => channels[channel]!
  } as AudioBuffer;
}

function referencePeaks(channels: Float32Array[]): number[] {
  const frames = channels[0]!.length;
  return Array.from({length: WAVEFORM_BINS}, (_, bin) => {
    let peak = 0;
    for (let frame = Math.floor(bin * frames / WAVEFORM_BINS);
      frame < Math.floor((bin + 1) * frames / WAVEFORM_BINS); frame++) {
      for (const channel of channels) peak = Math.max(peak, Math.abs(channel[frame]!));
    }
    return peak;
  });
}

function resultFor(expected: WaveformDimensions): SongWaveform {
  return {version: WAVEFORM_VERSION, ...expected, peaks: Array<number>(WAVEFORM_BINS).fill(0)};
}

test('fixed waveform bins cover exact boundaries and the final partial bin across chunks', () => {
  for (const frames of [512, 513, 1025, 8193]) {
    const samples = Float32Array.from({length: frames}, (_, frame) => (frame % 41 - 20) / 23);
    samples[frames - 1] = 1.25;
    const reducer = new WaveformAccumulator(dimensions(frames));
    for (let start = 0; start < frames; start += 137) {
      reducer.append(start, [samples.subarray(start, Math.min(frames, start + 137))]);
    }
    const result = reducer.finish();
    assert.deepEqual(result.peaks, referencePeaks([samples]));
    assert.equal(result.peaks[511], 1.25);
    assert.equal(result.frames, frames);
  }
  const samples = new Float32Array(513);
  samples[511] = 0.5;
  samples[512] = 1;
  const reducer = new WaveformAccumulator(dimensions(513));
  reducer.append(0, [samples]);
  assert.deepEqual(reducer.finish().peaks.slice(510), [0, 1]);
});

test('stereo anti-phase peaks retain both native channels and the final frame', () => {
  const left = Float32Array.from({length: 1027}, (_, index) => index % 2 ? 0.75 : -0.5);
  const right = Float32Array.from(left, value => -value);
  right[right.length - 1] = -2;
  const reducer = new WaveformAccumulator(dimensions(left.length, 2));
  reducer.append(0, [left.subarray(0, 1000), right.subarray(0, 1000)]);
  reducer.append(1000, [left.subarray(1000), right.subarray(1000)]);
  const result = reducer.finish();
  assert.deepEqual(result.peaks, referencePeaks([left, right]));
  assert.equal(result.peaks[511], 2);
  assert.equal(result.channels, 2);
  assert.ok(result.peaks.every(peak => peak >= 0.75));
});

test('short native buffers retain raw values, zero empty bins and immutable summaries', () => {
  const expected = dimensions(3);
  const reducer = new WaveformAccumulator(expected);
  expected.frames = 100;
  reducer.append(0, [new Float32Array([-0.125, 0, 0.25])]);
  const result = reducer.finish();
  assert.equal(result.peaks.length, 512);
  assert.equal(result.frames, 3);
  assert.deepEqual(result.peaks, referencePeaks([new Float32Array([-0.125, 0, 0.25])]));
  assert.equal(Math.max(...result.peaks), 0.25);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.peaks));
  assert.throws(() => { (result.peaks as number[])[511] = 1; }, TypeError);
});

test('invalid native dimensions are refused before reduction', () => {
  for (const change of [
    {sampleRate: NaN}, {sampleRate: 7999}, {sampleRate: 192001}, {sampleRate: 44100.5},
    {frames: 0}, {frames: -1}, {frames: Infinity}, {frames: 1.5}, {frames: 0x1_0000_0000},
    {channels: 0}, {channels: 3}, {channels: 1.5},
  ]) assert.throws(() => new WaveformAccumulator({...dimensions(8), ...change}), /dimensions/);
});

test('gaps, duplicates, mismatched channels and invalid chunks do not consume frames', () => {
  const reducer = new WaveformAccumulator(dimensions(8, 2));
  const four = [new Float32Array(4).fill(0.25), new Float32Array(4).fill(-0.5)];
  assert.equal(reducer.append(0, four), 4);
  const badChunks: [number, readonly Float32Array[]][] = [
    [5, four], [0, four], [3, four], [NaN, four],
    [4, []], [4, [four[0]!]], [4, [new Float32Array(2), new Float32Array(3)]],
    [4, [new Float32Array(5), new Float32Array(5)]],
    [4, [new Float64Array(4) as unknown as Float32Array, four[1]!]],
  ];
  for (const [start, channels] of badChunks) assert.throws(() => reducer.append(start, channels), /chunks/);
  assert.throws(() => reducer.append(4, null as unknown as Float32Array[]), /chunks/);
  assert.equal(reducer.append(4, four), 8);
  assert.deepEqual(reducer.finish().peaks, referencePeaks([
    new Float32Array(8).fill(0.25), new Float32Array(8).fill(-0.5),
  ]));
});

test('invalid PCM refuses the entire chunk and permits a clean retry', () => {
  for (const bad of [NaN, Infinity, -Infinity, 16.01, -16.01]) {
    const reducer = new WaveformAccumulator(dimensions(4));
    assert.throws(() => reducer.append(0, [new Float32Array([8, 0, bad, 0])]), /PCM/);
    reducer.append(0, [new Float32Array([0.125, -0.25, 0, 0])]);
    assert.equal(Math.max(...reducer.finish().peaks), 0.25);
  }
  const boundary = new WaveformAccumulator(dimensions(2));
  boundary.append(0, [new Float32Array([-16, 16])]);
  assert.equal(Math.max(...boundary.finish().peaks), 16);
});

test('the private PCM budget applies to total samples across channels', () => {
  const mono = new WaveformAccumulator(dimensions(WAVEFORM_CHUNK_SAMPLES + 1));
  assert.throws(() => mono.append(0, [new Float32Array(WAVEFORM_CHUNK_SAMPLES + 1)]), /bounded/);
  mono.append(0, [new Float32Array(WAVEFORM_CHUNK_SAMPLES)]);
  mono.append(WAVEFORM_CHUNK_SAMPLES, [new Float32Array([0.5])]);
  assert.equal(mono.finish().peaks[511], 0.5);
  const frames = WAVEFORM_CHUNK_SAMPLES / 2 + 1;
  const stereo = new WaveformAccumulator(dimensions(frames, 2));
  const samples = new Float32Array(frames);
  assert.throws(() => stereo.append(0, [samples, samples]), /bounded/);
  stereo.append(0, [samples.subarray(0, frames - 1), samples.subarray(0, frames - 1)]);
  stereo.append(frames - 1, [new Float32Array([1]), new Float32Array([-2])]);
  assert.equal(stereo.finish().peaks[511], 2);
});

test('completion requires all frames and closes the reducer exactly once', () => {
  const reducer = new WaveformAccumulator(dimensions(2));
  assert.throws(() => reducer.finish(), /missing native frames/);
  reducer.append(0, [new Float32Array(1)]);
  assert.throws(() => reducer.finish(), /missing native frames/);
  reducer.append(1, [new Float32Array(1)]);
  reducer.finish();
  assert.throws(() => reducer.finish(), /already complete/);
  assert.throws(() => reducer.append(2, [new Float32Array(1)]), /already complete/);
});

test('cache and worker result validation checks metadata and copies immutable peaks', () => {
  const expected = dimensions(1024, 2), original = resultFor(expected);
  const validated = validateWaveform(original, expected);
  (original.peaks as number[])[0] = 8;
  assert.equal(validated.peaks[0], 0);
  assert.notEqual(validated, original);
  assert.ok(Object.isFrozen(validated));
  assert.ok(Object.isFrozen(validated.peaks));
  for (const change of [
    {version: 'set-waveform@2'}, {sampleRate: 44100}, {frames: 1023}, {channels: 1},
    {peaks: Array(511).fill(0)}, {peaks: Array(513).fill(0)}, {peaks: new Float32Array(512)},
  ]) assert.throws(() => validateWaveform({...original, ...change}, expected), /match/);
  for (const value of [null, undefined, [], 'waveform']) {
    assert.throws(() => validateWaveform(value, expected), /Invalid waveform result/);
  }
});

test('validation rejects sparse, negative, nonnumeric and nonfinite peaks', () => {
  const expected = dimensions(512);
  for (const peak of [-0.01, 16.01, NaN, Infinity, -Infinity, '0', null, undefined]) {
    const peaks: unknown[] = Array(512).fill(0);
    peaks[511] = peak;
    assert.throws(() => validateWaveform({...resultFor(expected), peaks}, expected), /peak/);
  }
  assert.throws(() => validateWaveform({...resultFor(expected), peaks: Array(512)}, expected), /peak/);
  const accepted = validateWaveform({...resultFor(expected), peaks: Array(512).fill(16)}, expected);
  assert.equal(accepted.peaks[511], 16);
});

interface WorkerOptionsDouble {
  constructorError?: boolean;
  postError?: boolean;
  runtimeError?: boolean;
  messageError?: boolean;
  stallChunks?: boolean;
  onChunk?: () => void;
  transform?: (job: WaveformWorkerRequest, reply: WaveformWorkerResponse) => unknown;
}

class WaveformWorkerDouble {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminateCalls = 0;
  pendingChunks = 0;
  maxPendingChunks = 0;
  readonly chunks: {start: number; frames: number; samples: number}[] = [];
  readonly requests: string[] = [];
  private reducer: WaveformAccumulator | null = null;

  constructor(readonly options: WorkerOptionsDouble) {}
  terminate(): void { this.terminateCalls++; }
  postMessage(message: WaveformWorkerRequest, transfer: Transferable[] = []): void {
    if (this.options.postError && message.kind === 'chunk') throw new Error('Injected postMessage failure.');
    const job = structuredClone(message, {transfer});
    assert.ok(transfer.every(item => (item as ArrayBuffer).byteLength === 0), 'only private copies detach');
    this.requests.push(job.kind);
    let reply: WaveformWorkerResponse;
    if (job.kind === 'start') {
      this.reducer = new WaveformAccumulator(job.dimensions);
      reply = {protocol: WAVEFORM_WORKER_PROTOCOL, ok: true, kind: 'ready'};
    } else if (job.kind === 'chunk') {
      this.pendingChunks++;
      this.maxPendingChunks = Math.max(this.maxPendingChunks, this.pendingChunks);
      this.chunks.push({start: job.startFrame, frames: job.channels[0]!.length,
        samples: job.channels.reduce((sum, channel) => sum + channel.length, 0)});
      const nextFrame = this.reducer!.append(job.startFrame, job.channels);
      reply = {protocol: WAVEFORM_WORKER_PROTOCOL, ok: true, kind: 'chunk', nextFrame};
      // Deliberately damage the received private copies after using them.
      for (const channel of job.channels) channel.fill(15);
      this.options.onChunk?.();
      if (this.options.stallChunks) return;
    } else {
      reply = {protocol: WAVEFORM_WORKER_PROTOCOL, ok: true, kind: 'complete', result: this.reducer!.finish()};
    }
    const output = this.options.transform ? this.options.transform(job, reply) : reply;
    queueMicrotask(() => {
      if (job.kind === 'chunk') this.pendingChunks--;
      if (this.options.runtimeError) {
        this.onerror?.({message: 'Injected worker failure.', preventDefault: () => {}} as ErrorEvent);
      } else if (this.options.messageError) this.onmessageerror?.();
      else this.onmessage?.({data: structuredClone(output)} as MessageEvent<unknown>);
    });
  }
}

async function withWorkerDouble(
  options: WorkerOptionsDouble, body: (workers: WaveformWorkerDouble[]) => Promise<void>,
): Promise<void> {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const workers: WaveformWorkerDouble[] = [];
  class InstalledWorker extends WaveformWorkerDouble {
    constructor(url: URL, workerOptions: WorkerOptions) {
      if (options.constructorError) throw new Error('Injected worker construction failure.');
      assert.equal(url.pathname.endsWith('/set-waveform-worker.js'), true);
      assert.deepEqual(workerOptions, {type: 'module'});
      super(options);
      workers.push(this);
    }
  }
  Object.defineProperty(globalThis, 'Worker', {value: InstalledWorker, writable: true, configurable: true});
  try { await body(workers); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
}

function assertClean(worker: WaveformWorkerDouble): void {
  assert.equal(worker.terminateCalls, 1);
  assert.equal(worker.onmessage, null);
  assert.equal(worker.onerror, null);
  assert.equal(worker.onmessageerror, null);
}

test('one worker receives sequential private chunks while active stereo PCM stays intact', async () => {
  const frames = WAVEFORM_CHUNK_SAMPLES + 73;
  const left = new Float32Array(frames).fill(0.125), right = new Float32Array(frames).fill(-0.25);
  left[524287] = 0.5;
  right[frames - 1] = -1.5;
  const expected = referencePeaks([left, right]);
  await withWorkerDouble({}, async workers => {
    const result = await summarizeWaveform(pcmBuffer([left, right]));
    assert.deepEqual(result.peaks, expected);
    assert.ok(Object.isFrozen(result.peaks));
    assert.equal(workers.length, 1);
    const worker = workers[0]!;
    assert.deepEqual(worker.chunks, [
      {start: 0, frames: 524288, samples: WAVEFORM_CHUNK_SAMPLES},
      {start: 524288, frames: 524288, samples: WAVEFORM_CHUNK_SAMPLES},
      {start: 1048576, frames: 73, samples: 146},
    ]);
    assert.equal(worker.maxPendingChunks, 1);
    assert.deepEqual(worker.requests, ['start', 'chunk', 'chunk', 'chunk', 'finish']);
    assertClean(worker);
  });
  assert.equal(left.byteLength, frames * 4);
  assert.equal(right.byteLength, frames * 4);
  assert.equal(left[0], 0.125);
  assert.equal(left[524287], 0.5);
  assert.equal(right[frames - 1], -1.5);
  assert.deepEqual(referencePeaks([left, right]), expected);
});

test('native channel views are reacquired between asynchronous chunk acknowledgments', async () => {
  const frames = WAVEFORM_CHUNK_SAMPLES + 1;
  let native = new Float32Array(frames).fill(0.125);
  const buffer = pcmBuffer([native]);
  buffer.getChannelData = () => native;
  let chunks = 0;
  await withWorkerDouble({onChunk: () => {
    if (++chunks === 1) {
      native = structuredClone(native, {transfer: [native.buffer]});
      native[frames - 1] = 2;
    }
  }}, async workers => {
    const result = await summarizeWaveform(buffer);
    assert.equal(result.peaks[511], 2);
    assert.equal(workers[0]!.chunks.length, 2);
    assertClean(workers[0]!);
  });
});

test('an already cancelled waveform job creates no worker and reads no PCM', async () => {
  const controller = new AbortController();
  controller.abort();
  await withWorkerDouble({}, async workers => {
    await assert.rejects(summarizeWaveform({} as AudioBuffer, controller.signal), {name: 'AbortError'});
    assert.equal(workers.length, 0);
  });
});

test('in-flight cancellation terminates the worker once and removes the abort listener', async () => {
  const controller = new AbortController();
  let adds = 0, removes = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args: Parameters<AbortSignal['addEventListener']>) => {
    adds++; return add(...args);
  };
  controller.signal.removeEventListener = (...args: Parameters<AbortSignal['removeEventListener']>) => {
    removes++; return remove(...args);
  };
  await withWorkerDouble({stallChunks: true, onChunk: () => { controller.abort(); }}, async workers => {
    await assert.rejects(summarizeWaveform(pcmBuffer([new Float32Array(8)]), controller.signal),
      {name: 'AbortError'});
    assert.equal(workers.length, 1);
    assert.deepEqual(workers[0]!.requests, ['start', 'chunk']);
    assertClean(workers[0]!);
    controller.abort();
    assert.equal(workers[0]!.terminateCalls, 1);
  });
  assert.equal(adds, 1);
  assert.equal(removes, 1);
});

test('malformed, stale and corrupt worker replies reject and clean up', async () => {
  const transforms: NonNullable<WorkerOptionsDouble['transform']>[] = [
    () => null,
    () => ({protocol: 'different', ok: true, kind: 'ready'}),
    () => ({protocol: WAVEFORM_WORKER_PROTOCOL, ok: 'true', kind: 'ready'}),
    () => ({protocol: WAVEFORM_WORKER_PROTOCOL, ok: false, error: 'Worker refused input.'}),
    (job, reply) => job.kind === 'chunk' ? {protocol: WAVEFORM_WORKER_PROTOCOL, ok: true, kind: 'ready'} : reply,
    (job, reply) => job.kind === 'chunk' ? {...reply, nextFrame: 7} : reply,
    (job, reply) => job.kind === 'finish' ? {...reply,
      result: {...resultFor(dimensions(8)), peaks: Array(512).fill(NaN)}} : reply,
    (job, reply) => job.kind === 'finish' ? {...reply, result: resultFor(dimensions(9))} : reply,
  ];
  for (const transform of transforms) {
    await withWorkerDouble({transform}, async workers => {
      await assert.rejects(summarizeWaveform(pcmBuffer([new Float32Array(8)])));
      assertClean(workers[0]!);
    });
  }
});

test('worker construction, transport, runtime and native-data failures reject cleanly', async () => {
  for (const options of [
    {constructorError: true}, {postError: true}, {runtimeError: true}, {messageError: true},
  ]) {
    await withWorkerDouble(options, async workers => {
      await assert.rejects(summarizeWaveform(pcmBuffer([new Float32Array(8)])));
      if (options.constructorError) assert.equal(workers.length, 0);
      else assertClean(workers[0]!);
    });
  }
  await withWorkerDouble({}, async workers => {
    const buffer = pcmBuffer([new Float32Array(8)]);
    buffer.getChannelData = () => new Float32Array(7);
    await assert.rejects(summarizeWaveform(buffer), /PCM dimensions changed/);
    assertClean(workers[0]!);
  });
});

test('lack of a browser worker refuses preparation without a synchronous PCM fallback', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', {value: undefined, configurable: true});
  try {
    const buffer = pcmBuffer([new Float32Array(8)]);
    buffer.getChannelData = () => { throw new Error('PCM must not be read without a worker.'); };
    await assert.rejects(summarizeWaveform(buffer), /requires a browser worker/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
});

test('the actual worker entry accepts one song and rejects duplicate completion', {timeout: 5000}, async () => {
  // A Node worker adapter exercises the emitted browser entry module. This is
  // protocol evidence, not a browser/audio-device or listening qualification.
  const entry = new URL('../web/set-waveform-worker.js', import.meta.url);
  const source = [
    "const {parentPort} = require('node:worker_threads');",
    'const pending = []; let ready = false;',
    'globalThis.postMessage = value => parentPort.postMessage(value);',
    'parentPort.on("message", value => {',
    '  if (ready) globalThis.onmessage({data: value}); else pending.push(value);',
    '});',
    'import(' + JSON.stringify(entry.href) + ').then(() => {',
    '  ready = true; for (const value of pending) globalThis.onmessage({data: value});',
    '});',
  ].join('\n');
  const worker = new ThreadWorker(source, {eval: true});
  const request = async (message: WaveformWorkerRequest): Promise<WaveformWorkerResponse> => {
    const response = once(worker, 'message');
    worker.postMessage(message);
    return (await response)[0] as WaveformWorkerResponse;
  };
  try {
    assert.deepEqual(await request({protocol: WAVEFORM_WORKER_PROTOCOL, kind: 'start', dimensions: dimensions(3, 2)}),
      {protocol: WAVEFORM_WORKER_PROTOCOL, ok: true, kind: 'ready'});
    assert.deepEqual(await request({protocol: WAVEFORM_WORKER_PROTOCOL, kind: 'chunk', startFrame: 0,
      channels: [new Float32Array([0.5, -1, 0]), new Float32Array([-0.5, 1, 2])]}),
    {protocol: WAVEFORM_WORKER_PROTOCOL, ok: true, kind: 'chunk', nextFrame: 3});
    const result = await request({protocol: WAVEFORM_WORKER_PROTOCOL, kind: 'finish'});
    assert.equal(result.ok && result.kind, 'complete');
    if (!result.ok || result.kind !== 'complete') assert.fail('Expected completed waveform.');
    assert.deepEqual(result.result.peaks, referencePeaks([
      new Float32Array([0.5, -1, 0]), new Float32Array([-0.5, 1, 2]),
    ]));
    const duplicate = await request({protocol: WAVEFORM_WORKER_PROTOCOL, kind: 'finish'});
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.match(duplicate.error, /already complete/);
  } finally { await worker.terminate(); }
});
