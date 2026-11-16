import assert from 'node:assert/strict';
import test from 'node:test';
import type {AudioAsset} from '../src/pack-types.js';
import type {DecodedRecording} from '../src/web-audio.js';
import type {RouteFreePlan} from '../src/mix-transition.js';
import type {AutomaticMixPlan} from '../src/mix-planner.js';
import type {MixAnalysis, MixPcm} from '../src/mix-analysis.js';
import {crossfadeAutomation} from '../src/mix-automation.js';
import {renderFiniteLoop} from '../src/time-pitch.js';
import {evaluateTransition, planTransitionSpec, type TransitionSpec, type TransitionEvaluation} from '../web/mix-evaluator.js';
import {makePrecheckWindow, validatePrecheckEvaluation, precheckLabel, PRECHECK_LIMITS, PRECHECK_PROTOCOL,
  type PrecheckRequest, type PrecheckWindow} from '../web/mix-precheck-data.js';
import {browserMixPrecheck} from '../web/mix-precheck.js';

const rate = 8000;
function buffer(channels: Float32Array[]): AudioBuffer {
  return {sampleRate: rate, length: channels[0]!.length, numberOfChannels: channels.length,
    getChannelData: (i: number) => channels[i]!, duration: channels[0]!.length / rate} as AudioBuffer;
}
function recording(id: string, seed: number, seconds = 20): DecodedRecording {
  let state = seed;
  const values = Float32Array.from({length: rate * seconds}, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return 0.1 * (state / 2 ** 32 - 0.5);
  });
  const asset = {id, source_kind: 'recording', file: {sha256: id.repeat(64), frames: values.length,
    sample_rate: rate, channels: 2}, timing: {bpm: 120, meter: [4, 4]}} as unknown as AudioAsset;
  return {asset, buffer: buffer([values, new Float32Array(values)])};
}
function request(): PrecheckRequest {
  const from = recording('a', 1), to = recording('b', 2);
  const plan: RouteFreePlan = {kind: 'route-free', recipe: 'fallback-crossfade', fromExitFrame: 6 * rate,
    toEntryFrame: 3 * rate, overlapFrames: 2 * rate, preRollFrames: 0, bars: 1, fromBpm: 120, toBpm: 120,
    tempoChange: 1, fromGrid: 'requested', toGrid: 'requested', reason: 'Synthetic native check',
    automation: crossfadeAutomation(2 * rate, rate)};
  return {plan, from, to, incoming: to, entryFrame: plan.toEntryFrame, fromGain: 0.5, analysis: {from: null, to: null}};
}
const pcm = (audio: AudioBuffer): MixPcm => ({sampleRate: audio.sampleRate,
  channels: Array.from({length: audio.numberOfChannels}, (_, c) => audio.getChannelData(c))});
function collect(window: PrecheckWindow): Map<string, MixPcm> {
  const result = new Map<string, MixPcm>();
  for (const stream of window.job.streams) {
    const channels = Array.from({length: stream.channels}, () => new Float32Array(stream.frames));
    for (let start = 0; start < stream.frames;) {
      const count = Math.min(stream.frames - start, Math.floor(PRECHECK_LIMITS.chunkSamples / stream.channels));
      const copies = window.copy(stream.name, start, count); copies.forEach((copy, c) => channels[c]!.set(copy, start));
      start += count;
    }
    result.set(stream.name, {sampleRate: window.job.rate, channels});
  }
  return result;
}
function evaluateWindow(window: PrecheckWindow): TransitionEvaluation {
  const input = collect(window), prepared = input.get('prepared'), loop = input.get('loop');
  return evaluateTransition(input.get('from')!, input.get('to')!, window.job.spec, window.job.analysis,
    prepared ? {audio: prepared, entryFrame: window.job.preparedEntry!, ...(loop ? {outgoingLoop: loop} : {})} : undefined);
}
function spec(r: PrecheckRequest): TransitionSpec {
  return {...(r.plan.kind === 'mix' ? planTransitionSpec(r.plan) : {recipe: r.plan.recipe === 'fallback-cut' ? 'cut' : 'blend',
    fromStartFrame: r.plan.fromExitFrame, toEntryFrame: r.plan.toEntryFrame, preRollFrames: 0,
    tempoRatio: 1, automation: r.plan.automation} as TransitionSpec), fixedGains: {from: r.fromGain, to: 1}};
}
function continuation(r: PrecheckRequest, seconds: number): PrecheckRequest {
  const source = r.to.buffer, start = r.plan.toEntryFrame, size = seconds * rate;
  const prepared = buffer(Array.from({length: 2}, (_, c) => source.getChannelData(c).slice(start, start + size)));
  return {...r, incoming: {asset: r.to.asset, buffer: prepared,
    processed: {sourceFrames: source.length, outputFrames: size, algorithm: 'synthetic-prepared@1'},
    continuation: {buffer: source, sourceFrame: start + size}}, entryFrame: 0};
}

test('bounded native windows preserve the full evaluator result and original recipe without copying a song', () => {
  const r = request(), window = makePrecheckWindow(r);
  const expected = evaluateTransition(pcm(r.from.buffer), pcm(r.to.buffer), spec(r));
  assert.deepEqual(evaluateWindow(window), expected);
  assert.equal(window.job.spec.recipe, 'blend'); assert.equal(r.plan.recipe, 'fallback-crossfade');
  assert.equal(window.job.coverage.frames, 8 * rate);
  assert.ok(window.job.streams.every(s => s.frames < r.from.buffer.length));
  assert.ok(window.job.streams.reduce((n, s) => n + s.frames * s.channels, 0) <= PRECHECK_LIMITS.inputSamples);
});

test('measured beat evidence is rebased with its source without changing phase judgment', () => {
  const r = request();
  const analysis = {tempo: {bpm: 120}, beatGrid: {frames: Array.from({length: 40}, (_, n) => n * rate / 2)}} as unknown as MixAnalysis;
  const withAnalysis = {...r, analysis: {from: analysis, to: analysis}};
  const actual = evaluateWindow(makePrecheckWindow(withAnalysis));
  assert.deepEqual(actual, evaluateTransition(pcm(r.from.buffer), pcm(r.to.buffer), spec(r), withAnalysis.analysis));
  assert.equal(actual.measurements!.beatPhase.judged, true);
});

test('actual prepared B and native continuation preserve every sampled frame across an included join', () => {
  const r = continuation(request(), 3), window = makePrecheckWindow(r), input = collect(window);
  const native = r.to.buffer, start = r.plan.toEntryFrame;
  const joined = {sampleRate: rate, channels: Array.from({length: 2}, (_, c) => native.getChannelData(c).slice(start))};
  const expected = evaluateTransition(pcm(r.from.buffer), pcm(native), spec(r), undefined, {audio: joined, entryFrame: 0});
  assert.deepEqual(evaluateWindow(window), expected);
  assert.equal(window.job.coverage.nativeJoin, 'inside-window');
  assert.equal(input.get('prepared')!.channels[0]![3 * rate], native.getChannelData(0)[start + 3 * rate]);
  assert.equal(r.incoming.buffer.getChannelData(0).byteLength, 3 * rate * 4);
});

test('a later native join is explicitly outside the unchanged E+3-second window', () => {
  const r = continuation(request(), 8), window = makePrecheckWindow(r);
  assert.equal(window.job.coverage.nativeJoin, 'after-window');
  assert.equal(window.job.coverage.afterFrames, 3 * rate);
  const label = precheckLabel({version: PRECHECK_PROTOCOL, status: 'pass', reason: 'synthetic',
    evaluation: evaluateWindow(window), coverage: window.job.coverage});
  assert.match(label, /later native join is outside this check/);
});

test('outgoing precontext uses the active prepared/native voice and remains raw before fixed gain', () => {
  const original = request(), from = original.from, prepared = buffer([new Float32Array(3 * rate).fill(0.125), new Float32Array(3 * rate).fill(-0.125)]);
  const r = {...original, fromPlayback: {recording: {asset: from.asset, buffer: prepared,
    continuation: {buffer: from.buffer, sourceFrame: 5 * rate}}, entryFrame: 0, elapsedFrames: 4 * rate}};
  const window = makePrecheckWindow(r), a = collect(window).get('from')!;
  assert.equal(a.channels[0]![0], 0.125); assert.equal(a.channels[1]![0], -0.125);
  assert.equal(a.channels[0]![2 * rate], from.buffer.getChannelData(0)[5 * rate]);
  assert.equal(a.channels[0]![3 * rate], from.buffer.getChannelData(0)[6 * rate]);
  assert.deepEqual(window.job.spec.fixedGains, {from: 0.5, to: 1});
});

/** Rebasing an interpolation coordinate changes rounding, never the verdict or threshold. */
function numericParity(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number');
    assert.ok(Math.abs((actual as number) - expected) <= 1e-9, `numeric drift: ${actual} vs ${expected}`);
  } else if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object');
    assert.deepEqual(Object.keys(actual), Object.keys(expected));
    for (const key of Object.keys(expected)) numericParity((actual as Record<string, unknown>)[key],
      (expected as Record<string, unknown>)[key]);
  } else assert.equal(actual, expected);
}

test('native-rate and near-EOF brake crops preserve the nominal model within floating-point rounding', () => {
  for (const brake of [false, true]) {
    const r = request(), duration = 2 * rate;
    const plan = {...r.plan, kind: 'mix', version: 'automatic-mix@1', recipe: brake ? 'brake' : 'tempo-ramp',
      fromExitFrame: brake ? r.from.buffer.length - Math.round(1.2 * rate) : r.plan.fromExitFrame,
      preRollFrames: 0, tempoRatio: 1, nativeRate: {pitchMoves: true,
        outgoing: {start: 1, end: brake ? 0.05 : 1.05, frames: duration},
        ...(brake ? {} : {incoming: {start: 0.95, end: 1, frames: duration}})},
      ...(brake ? {entryDelayFrames: duration - 160, automation: {outgoing: crossfadeAutomation(duration, rate).outgoing,
        incoming: crossfadeAutomation(160, rate).incoming}} : {})} as unknown as AutomaticMixPlan;
    const adapted = {...r, plan, incoming: {...r.to, ...(plan.nativeRate?.incoming ? {nativeRate: plan.nativeRate.incoming} : {})}};
    const actual = evaluateWindow(makePrecheckWindow(adapted));
    const expected = evaluateTransition(pcm(r.from.buffer), pcm(r.to.buffer), spec(adapted));
    assert.equal(actual.verdict, expected.verdict);
    assert.deepEqual(actual.flags.map(({value: _value, ...flag}) => flag), expected.flags.map(({value: _value, ...flag}) => flag));
    numericParity(actual, expected);
  }
});

test('window budgets, identity and chunk bounds refuse before native PCM is copied', () => {
  const r = request(); let reads = 0;
  const native = r.from.buffer;
  const guarded = {...native, getChannelData: (c: number) => { reads++; return native.getChannelData(c); }} as AudioBuffer;
  assert.throws(() => makePrecheckWindow({...r, from: {...r.from, buffer: guarded}, plan: {...r.plan,
    automation: crossfadeAutomation(500 * rate, rate)}}), /bounded|duration|budget/i);
  assert.equal(reads, 0);
  assert.throws(() => makePrecheckWindow({...r, incoming: r.from}), /does not belong/);
  assert.throws(() => makePrecheckWindow({...r, entryFrame: -1}), /entry/);
  const window = makePrecheckWindow(r);
  for (const start of [-1, 0.5, 999999]) assert.throws(() => window.copy('from', start, 1), /chunk/);
  assert.throws(() => window.copy('from', 0, PRECHECK_LIMITS.chunkSamples), /chunk/);
  const copy = window.copy('from', 0, 16)[0]!;
  copy.fill(9); assert.notEqual(r.from.buffer.getChannelData(0)[3 * rate], 9, 'private PCM copy only');
});

test('worker replies require complete measurements, unchanged judgment and the actual source mode', () => {
  const r = request(), window = makePrecheckWindow(r), valid = evaluateWindow(window);
  assert.equal(validatePrecheckEvaluation(valid, 'blend', {source: 'native', frames: window.job.coverage.frames}), valid);
  const broken: unknown[] = [
    {...valid, thresholds: 'relaxed'}, {...valid, verdict: 'fail'}, {...valid, penalty: 999},
    {...valid, bSource: 'prepared'}, {...valid, measurements: {...valid.measurements!, truePeakDbtp: undefined}},
    {...valid, measurements: {...valid.measurements!, boundaryFlux: {...valid.measurements!.boundaryFlux, judged: false}}},
    {...valid, measurements: {...valid.measurements!, beatPhase: {...valid.measurements!.beatPhase, beats: 1}}},
    {...valid, measurements: {...valid.measurements!, stereoCorrelation: NaN}},
    {...valid, measurements: {loudness: {momentaryMaxUpLu: null, momentaryMaxDownLu: null,
      shortTermMaxUpLu: null, shortTermMaxDownLu: null}, lowBuildUp: {}, beatPhase: {judged: false, beats: 0},
      boundaryFlux: {judged: false}, silenceGapMs: 0}, verdict: 'pass', flags: [], penalty: 0},
  ];
  for (const reply of broken) assert.throws(() => validatePrecheckEvaluation(reply, 'blend',
    {source: 'native', frames: window.job.coverage.frames}));
});

test('an unavailable worker fails closed without audio fallback or native PCM transfer', async () => {
  const nativeWorker = globalThis.Worker;
  try {
    globalThis.Worker = undefined as unknown as typeof Worker;
    const result = await browserMixPrecheck(request());
    assert.equal(result.status, 'unavailable'); assert.equal(result.evaluation, null);
  } finally { globalThis.Worker = nativeWorker; }
});

test('pre-abort and mid-job cancellation terminate only the worker and never admit late results', async () => {
  const nativeWorker = globalThis.Worker; let created = 0, terminated = 0;
  class SilentWorker {
    onmessage: ((event: MessageEvent) => void) | null = null; onerror = null; onmessageerror = null;
    constructor() { created++; }
    postMessage(): void {} terminate(): void { terminated++; }
  }
  try {
    globalThis.Worker = SilentWorker as unknown as typeof Worker;
    const before = new AbortController(); before.abort();
    await assert.rejects(browserMixPrecheck(request(), before.signal), /cancelled/); assert.equal(created, 0);
    const abort = new AbortController(), r = request(), first = r.from.buffer.getChannelData(0)[0];
    const pending = browserMixPrecheck(r, abort.signal); abort.abort();
    await assert.rejects(pending, /cancelled/); assert.equal(created, 1); assert.equal(terminated, 1);
    assert.equal(r.from.buffer.getChannelData(0)[0], first);
  } finally { globalThis.Worker = nativeWorker; }
});

test('a stale worker acknowledgment is unavailable and its worker is terminated', async () => {
  const nativeWorker = globalThis.Worker; let terminated = 0;
  class BadWorker {
    onmessage: ((event: MessageEvent) => void) | null = null; onerror = null; onmessageerror = null;
    postMessage(): void { queueMicrotask(() => this.onmessage?.({data: {protocol: PRECHECK_PROTOCOL, ok: true,
      kind: 'chunk', name: 'from', nextFrame: -1}} as MessageEvent)); }
    terminate(): void { terminated++; }
  }
  try {
    globalThis.Worker = BadWorker as unknown as typeof Worker;
    const result = await browserMixPrecheck(request());
    assert.equal(result.status, 'unavailable'); assert.match(result.reason, /Unexpected/); assert.equal(terminated, 1);
  } finally { globalThis.Worker = nativeWorker; }
});


test('bounded finite-loop windows carry the actual fourth PCM stream without rebuilding or duplicating gain', () => {
  const r = request(), loopFrames = 8 * rate, overlap = 2 * rate, exit = 12 * rate;
  for (let c = 0; c < 2; c++) {
    const channel = r.from.buffer.getChannelData(c);
    for (let i = 0; i < channel.length; i++) channel[i] = 0.1 * Math.sin(2 * Math.PI * 136 * i / rate);
  }
  const normal = crossfadeAutomation(overlap, rate), duration = loopFrames + overlap;
  const plan = {...r.plan, kind: 'mix', recipe: 'loop-extend', tempoRatio: 1, fromExitFrame: exit,
    entryDelayFrames: loopFrames, loopExtension: {bars: 4, startFrame: exit - loopFrames, endFrame: exit, frames: loopFrames},
    automation: {incoming: normal.incoming, outgoing: {
      durationFrames: duration,
      gain: [{frame: 0, value: 1}, ...normal.outgoing.gain.map(point => ({...point, frame: point.frame + loopFrames}))],
      lowShelfDb: [{frame: 0, value: 0}, {frame: duration, value: 0}],
      highPassHz: [{frame: 0, value: 0}, {frame: duration, value: 0}],
      lowPassHz: [{frame: 0, value: rate / 2}, {frame: duration, value: rate / 2}],
    }}} as unknown as AutomaticMixPlan;
  const loop = renderFiniteLoop({sampleRate: rate, channels: pcm(r.from.buffer).channels.map(channel =>
    channel.subarray(exit - loopFrames, exit + overlap))}, loopFrames, overlap, 4, r.fromGain).audio;
  // A distinguishable actual prepared sample proves the supplied loop is used.
  (loop.channels[0]! as Float32Array)[1000] = 0.03;
  const checked = {...r, plan, loopBuffer: buffer(loop.channels as Float32Array[]),
    incoming: {...r.to, processed: {sourceFrames: r.to.buffer.length, outputFrames: r.to.buffer.length,
      algorithm: 'synthetic-prepared@1'}}};
  const window = makePrecheckWindow(checked);
  assert.deepEqual(window.job.streams.map(stream => stream.name), ['from', 'to', 'prepared', 'loop']);
  const expected = evaluateTransition(pcm(r.from.buffer), pcm(r.to.buffer), spec(checked), undefined,
    {audio: pcm(r.to.buffer), entryFrame: r.entryFrame, outgoingLoop: loop});
  assert.deepEqual(evaluateWindow(window), expected);
  assert.equal(collect(window).get('loop')!.channels[0]![1000], Math.fround(0.03));
  const {loopBuffer: _actualLoop, ...missingLoop} = checked;
  assert.throws(() => makePrecheckWindow(missingLoop), /actual prepared PCM/);
});
