import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio} from '../src/mix-analysis.js';
import {DeterministicDj} from '../src/dj.js';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import {SmallPlayer} from '../src/player.js';
import {prepareMixTransition, type MixPreparationRuntime} from '../src/mix-transition.js';
import {outputFrameAtSource, renderTimePitch, type PreparedTimePitch} from '../src/time-pitch.js';
import {ContextDouble, NodeDouble, ParameterDouble, deferred, fixturePack} from './audio-double.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';

function audioBuffer(rate: number, frames: number, count = 1): AudioBuffer {
  const channels = Array.from({length: count}, () => new Float32Array(frames));
  return {sampleRate: rate, length: frames, duration: frames / rate, numberOfChannels: count,
    getChannelData: (i: number) => channels[i]!,
    copyToChannel: (source: Float32Array, i: number) => { channels[i]!.set(source); },
  } as AudioBuffer;
}
class FilterDouble extends NodeDouble {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new ParameterDouble();
  readonly gain = new ParameterDouble();
  readonly Q = new ParameterDouble();
}
class MixContext extends ContextDouble {
  constructor() { super(16000); }
  createBiquadFilter(): BiquadFilterNode { return new FilterDouble(this.audio) as unknown as BiquadFilterNode; }
  createBuffer(channels: number, frames: number, rate: number): AudioBuffer { return audioBuffer(rate, frames, channels); }
  override async decodeAudioData(input: ArrayBuffer): Promise<AudioBuffer> {
    const shape = await super.decodeAudioData(input), buffer = audioBuffer(this.sampleRate, shape.length, shape.numberOfChannels);
    const signal = makeMixFixture({sampleRate: this.sampleRate, bpm: 120}).channels[0]!;
    for (let c = 0; c < shape.numberOfChannels; c++) buffer.getChannelData(c).set(signal.subarray(0, shape.length));
    return buffer;
  }
}
const inline: MixPreparationRuntime = {
  analyze: async (from, to) => ({from: analyzeMixAudio(from), to: analyzeMixAudio(to)}),
  render: async (audio, options) => renderTimePitch(audio, options),
};
async function setup(runtime: MixPreparationRuntime = inline) {
  const loaded = await fixturePack(), context = new MixContext();
  const player = new SmallPlayer(context.audio, loaded, loaded.pack.routes[0]!.id, runtime);
  await player.play('a'); context.advance(0.2);
  return {loaded, context, player};
}
function blockedRuntime(base: MixPreparationRuntime = inline) {
  const entered = deferred(), gate = deferred();
  let signal: AbortSignal | undefined, calls = 0, processed: PreparedTimePitch | undefined;
  const runtime: MixPreparationRuntime = {...base, render: async (audio, options, abort) => {
    signal = abort; calls++; entered.release(); await gate.promise;
    processed = await base.render(audio, options, abort);
    return processed;
  }};
  return {runtime, entered, gate, get signal() { return signal; }, get calls() { return calls; },
    get processed() { return processed; }};
}
/** Controlled cue/energy evidence isolates deadline selection from detector accuracy. */
function lateRuntime(exits: readonly number[]) {
  return blockedRuntime({...inline, analyze: async (from, to, signal) => {
    const analysis = await inline.analyze(from, to, signal), rate = from.sampleRate;
    const cue = (seconds: number, score: number) => ({frame: Math.round(seconds * rate), seconds,
      score, confidence: 0.9, reasons: ['Controlled deadline-test cue.']});
    const energy = (frames: number, split: number) => [
      {startFrame: 0, endFrame: split * rate, rms: 0.1, lowRms: 0.1, dbfs: -20},
      {startFrame: split * rate, endFrame: frames, rms: 1, lowRms: 1, dbfs: 0},
    ];
    return {from: {...analysis.from, tempo: {...analysis.from.tempo, bpm: 120},
      mixOut: exits.map((seconds, i) => cue(seconds, 1 - i * 0.01)),
      energyCurve: energy(analysis.from.frames, 8)},
    to: {...analysis.to, tempo: {...analysis.to.tempo, bpm: 124},
      key: {...analysis.to.key, tonic: 8}, mixIn: [cue(1, 1), cue(2, 0.99)],
      energyCurve: energy(analysis.to.frames, 2)}};
  }});
}

test('a mix becomes scheduled only after its processed buffer is ready', async () => {
  const block = blockedRuntime(), {context, player} = await setup(block.runtime);
  const task = player.scheduleMix(); await block.entered.promise;
  assert.equal(player.snapshot().mix?.phase, 'preparing');
  assert.equal(player.snapshot().transition, 'none');
  assert.equal(player.snapshot().next, null);
  assert.equal(context.sources.length, 1, 'no incoming native source allocated during processing');
  block.gate.release(); await task;
  const snapshot = player.snapshot();
  assert.equal(snapshot.mix?.phase, 'scheduled');
  assert.equal(snapshot.voices.length, 2);
  assert.equal(snapshot.transition, 'scheduled');
  assert.ok(snapshot.mix?.summary && snapshot.mix.summary.processor === 'eutonos-wsola@1');
  assert.equal(context.sources[1]!.starts.length, 1);
  player.stop();
});
test('Stop during processing aborts and a late successful result cannot revive audio', async () => {
  const block = blockedRuntime(), {context, player} = await setup(block.runtime);
  const task = player.scheduleMix(); await block.entered.promise;
  player.stop(); assert.equal(block.signal?.aborted, true);
  block.gate.release(); await task;
  assert.equal(player.snapshot().state, 'idle');
  assert.equal(player.snapshot().mix, null);
  assert.deepEqual(player.snapshot().voices, []);
  assert.equal(context.sources.length, 1);
});
test('Pause invalidates uncommitted processing and keeps existing A paused', async () => {
  const block = blockedRuntime(), {player} = await setup(block.runtime);
  const task = player.scheduleMix(); await block.entered.promise;
  await player.pause(); block.gate.release(); await task;
  assert.equal(block.signal?.aborted, true);
  assert.equal(player.snapshot().state, 'paused');
  assert.equal(player.snapshot().voices.length, 1);
  assert.equal(player.snapshot().mix, null);
  player.stop();
});
test('Resume aborts preparation requested while paused and clears late-result status', async () => {
  const block = blockedRuntime(), {context, player} = await setup(block.runtime);
  await player.pause();
  const task = player.scheduleMix(); await block.entered.promise;
  assert.equal(player.snapshot().mix?.phase, 'preparing');
  await player.resume();
  assert.equal(block.signal?.aborted, true);
  assert.equal(player.snapshot().mix, null);
  block.gate.release(); await task;
  assert.equal(player.snapshot().state, 'playing');
  assert.equal(player.snapshot().mix, null);
  assert.equal(player.snapshot().transition, 'none');
  assert.equal(player.snapshot().voices.length, 1);
  assert.equal(context.sources.length, 1);
  player.stop();
});
test('slow preparation selects a later A cue while preserving processed B mapping, identity and cancellation', async () => {
  const block = lateRuntime([4, 10, 13]), {loaded, context, player} = await setup(block.runtime);
  const before = player.snapshot(), rate = context.sampleRate;
  const task = player.scheduleMix({pitchSemitones: 1, returnToOriginalTempo: true});
  await block.entered.promise;
  context.advance(6); block.gate.release(); await task;
  const snapshot = player.snapshot(), summary = snapshot.mix!.summary!, processed = block.processed!;
  assert.equal(snapshot.mix?.phase, 'scheduled');
  assert.equal(summary.fromExitFrame, 10 * rate, 'later valid exit wins before the authored fallback');
  assert.equal(snapshot.transitionAt!.frame, before.voices[0]!.start.frame + 10 * rate);
  assert.equal(snapshot.transitionEnd!.frame - snapshot.transitionAt!.frame, 4 * rate);
  assert.ok(snapshot.transitionAt!.frame >= player.clock.currentFrame + Math.ceil(0.1 * rate));
  assert.equal(summary.toEntryFrame, rate, 'B entry stays fixed even though energy ranking now favors its second cue');
  assert.equal(summary.processedEntryFrame, outputFrameAtSource(processed.mapping, rate));
  assert.equal(summary.tempoRatio, 120 / 124);
  assert.equal(summary.pitchSemitones, 1);
  assert.equal(summary.returnToOriginalTempo, true);
  assert.equal(summary.processor, processed.processor);
  assert.equal(summary.outputFrames, processed.mapping.outputFrames);
  assert.equal(summary.toHash, loaded.pack.assets.find(a => a.id === player.pair.to.id)!.file.sha256);
  assert.deepEqual(snapshot.voices[1]!.source, {id: player.pair.to.id, revision: player.pair.to.revision});
  assert.equal(context.sources[1]!.buffer!.length, processed.mapping.outputFrames);
  assert.deepEqual(context.sources[1]!.buffer!.getChannelData(0), processed.audio.channels[0]);
  assert.deepEqual(context.sources[1]!.starts, [{when: snapshot.transitionAt!.frame / rate,
    offset: summary.processedEntryFrame / rate}]);
  assert.equal(block.calls, 1, 'retiming does not render B again');
  assert.equal(player.cancelPendingTransition(), true);
  assert.equal(player.snapshot().mix, null);
  assert.deepEqual(player.snapshot().voices, before.voices);
  assert.ok(context.sources[1]!.disconnectCalls > 0);
  assert.deepEqual(context.sources[1]!.connections, []);
  assert.deepEqual(context.sources[0]!.stops, [snapshot.transitionEnd!.frame / rate, before.voices[0]!.endFrame / rate]);
  player.stop();
});
test('slow preparation with no later valid analyzed exit uses the exact authored crossfade', async () => {
  const block = lateRuntime([4, 13]), {context, player} = await setup(block.runtime);
  const before = player.snapshot(), task = player.scheduleMix({pitchSemitones: 1});
  await block.entered.promise;
  context.advance(6); block.gate.release(); await task;
  const snapshot = player.snapshot();
  assert.equal(snapshot.mix?.phase, 'fallback');
  assert.match(snapshot.mix!.reason, /no later analyzed cue/);
  assert.equal(snapshot.mix?.summary, null);
  assert.equal(snapshot.transitionAt!.frame, before.voices[0]!.start.frame + 8 * context.sampleRate);
  assert.equal(snapshot.transitionEnd!.frame - snapshot.transitionAt!.frame, 4 * context.sampleRate);
  assert.ok(snapshot.transitionAt!.frame >= player.clock.currentFrame + Math.ceil(0.1 * context.sampleRate));
  assert.deepEqual(context.sources[1]!.starts, [], 'unused processed B never starts');
  assert.equal(context.sources[1]!.disconnectCalls, 1);
  assert.deepEqual(context.sources[2]!.starts, [{when: 8.1, offset: 0}]);
  assert.equal(block.calls, 1);
  assert.equal(player.cancelPendingTransition(), true);
  assert.deepEqual(player.snapshot().voices, before.voices);
  player.stop();
});
test('missed analyzed and authored deadlines resolve unavailable, preserve A and schedule no late B', async () => {
  const block = lateRuntime([4, 10, 13]), {context, player} = await setup(block.runtime);
  const before = player.snapshot(), gainCalls = structuredClone(context.gains[1]!.gain.calls);
  const task = player.scheduleMix({pitchSemitones: 1}); await block.entered.promise;
  context.advance(10); block.gate.release();
  await assert.doesNotReject(task);
  const snapshot = player.snapshot();
  assert.equal(snapshot.mix?.phase, 'unavailable');
  assert.match(snapshot.mix!.reason, /no later analyzed cue.*Authored fallback unavailable:.*exit cue has passed/);
  assert.equal(snapshot.mix?.summary, null);
  assert.equal(snapshot.state, 'playing');
  assert.deepEqual(snapshot.voices, before.voices);
  assert.equal(snapshot.transition, 'none');
  assert.equal(snapshot.next, null);
  assert.equal(context.sources.filter(s => s.starts.length).length, 1);
  assert.equal(context.sources[1]!.disconnectCalls, 1);
  assert.deepEqual(context.sources[0]!.stops, []);
  assert.deepEqual(context.gains[1]!.gain.calls, gainCalls);
  // Preparation ownership was cleared, so a fresh attempt reports its own outcome.
  const retry = player.scheduleMix({pitchSemitones: 1}); await assert.doesNotReject(retry);
  assert.equal(player.snapshot().mix?.phase, 'unavailable');
  assert.equal(player.snapshot().transition, 'none');
  player.stop();
});
for (const outcome of ['fallback', 'error'] as const) {
  test(`slow analysis ${outcome} after the authored deadline resolves unavailable without starting B`, async () => {
    const entered = deferred(), gate = deferred();
    const runtime: MixPreparationRuntime = {...inline, analyze: async (from, to, signal) => {
      entered.release(); await gate.promise;
      if (outcome === 'error') throw new Error('late analysis failure');
      const analysis = await inline.analyze(from, to, signal);
      return {...analysis, from: {...analysis.from, tempo: {...analysis.from.tempo, confidence: 0}}};
    }};
    const {context, player} = await setup(runtime), before = player.snapshot();
    const task = player.scheduleMix(); await entered.promise;
    context.advance(10); gate.release(); await assert.doesNotReject(task);
    const snapshot = player.snapshot();
    assert.equal(snapshot.mix?.phase, 'unavailable');
    assert.match(snapshot.mix!.reason, outcome === 'error' ? /late analysis failure/ : /confidence/);
    assert.match(snapshot.mix!.reason, /Authored fallback unavailable:.*exit cue has passed/);
    assert.deepEqual(snapshot.voices, before.voices);
    assert.equal(snapshot.state, 'playing');
    assert.equal(snapshot.transition, 'none');
    assert.equal(context.sources.length, 1);
    assert.deepEqual(context.sources[0]!.stops, []);
    player.stop();
  });
}
test('worker failure uses the unchanged authored transition, with a visible reason', async () => {
  const runtime: MixPreparationRuntime = {...inline, analyze: async () => { throw new Error('worker deliberately unavailable'); }};
  const {player} = await setup(runtime);
  const aStart = player.snapshot().voices[0]!.start.frame;
  await player.scheduleMix();
  const snapshot = player.snapshot();
  assert.equal(snapshot.mix?.phase, 'fallback');
  assert.match(snapshot.mix!.reason, /worker deliberately unavailable/);
  assert.equal(snapshot.transitionAt!.frame - aStart, 8 * snapshot.sampleRate);
  assert.equal(snapshot.transitionEnd!.frame - snapshot.transitionAt!.frame, 4 * snapshot.sampleRate);
  player.stop();
});
test('pre-boundary cancellation restores A; after entry cancellation refuses', async () => {
  const {context, player} = await setup();
  const originalEnd = player.snapshot().voices[0]!.endFrame;
  await player.scheduleMix();
  assert.equal(player.cancelPendingTransition(), true);
  assert.equal(player.snapshot().mix, null);
  assert.equal(player.snapshot().voices[0]!.endFrame, originalEnd);
  assert.equal(player.snapshot().voices.length, 1);
  await player.scheduleMix();
  context.advance(player.snapshot().transitionAt!.frame / context.sampleRate - context.currentTime);
  assert.equal(player.cancelPendingTransition(), false);
  assert.equal(player.snapshot().mix?.phase, 'mixing');
  player.stop();
});
test('DJ exact retries and Cancel next during preparation keep intent separate from prepared/audible state', async () => {
  const block = blockedRuntime(), {loaded, context, player} = await setup(block.runtime);
  // Give the DJ its own stopped pickup so it owns all request provenance.
  player.stop();
  const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix'});
  const command = (id: string, action: object): ControlRequest => ({...action, commandId: id,
    expectedRevision: dj.snapshot().control.revision, schemaVersion: CONTROL_VERSION, source: 'manual'}) as ControlRequest;
  await dj.request(command('play', {type: 'transport', action: 'play'})); context.advance(0.2);
  const next = command('next', {type: 'nextSong'}), task = dj.request(next);
  await block.entered.promise;
  assert.equal(dj.snapshot().pending, null);
  assert.equal(dj.snapshot().control.planned, null);
  assert.equal((await dj.request(next)).execution.status, 'pending');
  assert.equal(block.calls, 1);
  const cancelled = await dj.request(command('cancel', {type: 'cancelNext'}));
  assert.equal(cancelled.execution.status, 'applied');
  block.gate.release(); await task;
  assert.equal(dj.snapshot().player.voices.length, 1);
  assert.equal(dj.snapshot().pending, null);
  assert.equal(dj.snapshot().player.mix, null);
  await dj.dispose();
});
test('a late unavailable mix keeps the DJ FIFO and Hold with no pending or failed effect', async () => {
  const block = lateRuntime([4, 10, 13]), {loaded, context, player} = await setup(block.runtime);
  player.stop();
  const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix', mix: {pitchSemitones: 1}});
  const command = (id: string, action: object, source: 'manual' | 'automation' = 'manual'): ControlRequest =>
    ({...action, commandId: id, expectedRevision: dj.snapshot().control.revision,
      schemaVersion: CONTROL_VERSION, source}) as ControlRequest;
  await dj.request(command('hold', {type: 'hold', enabled: true}));
  await dj.request(command('initial-a', {type: 'queueTrack', trackId: player.pair.from.id}));
  await dj.request(command('head-b', {type: 'queueTrack', trackId: player.pair.to.id}));
  await dj.request(command('tail-a', {type: 'queueTrack', trackId: player.pair.from.id}));
  await dj.request(command('play', {type: 'transport', action: 'play'}));
  context.advance(0.2);
  const before = dj.snapshot(), next = command('late-next', {type: 'nextSong'}), task = dj.request(next);
  await block.entered.promise;
  assert.equal((await dj.request(command('held-drive', {type: 'setState', state: 'drive'}, 'automation')))
    .execution.reason, 'held');
  context.advance(10); block.gate.release();
  assert.equal((await task).execution.status, 'cancelled', 'unavailable resolves as an uncommitted DJ request');
  const snapshot = dj.snapshot();
  assert.equal(snapshot.player.mix?.phase, 'unavailable');
  assert.match(snapshot.player.mix!.reason, /exit cue has passed/);
  assert.deepEqual(snapshot.control.queue, before.control.queue);
  assert.deepEqual(snapshot.control.queue.map(q => q.commandId), ['head-b', 'tail-a']);
  assert.equal(snapshot.control.requested.hold, true);
  assert.equal(snapshot.control.requested.state, 'explore');
  assert.equal(snapshot.pending, null);
  assert.equal(snapshot.control.planned, null);
  assert.equal(snapshot.control.audible?.source?.id, player.pair.from.id);
  assert.equal(snapshot.player.state, 'playing');
  assert.equal(context.sources.filter(s => s.starts.length).length, 2, 'only the setup A and DJ A ever start');
  assert.equal((await dj.request(next)).execution.status, 'cancelled');
  assert.equal(block.calls, 1, 'an exact retry never repeats failed preparation');
  await dj.request(command('release', {type: 'hold', enabled: false}));
  assert.equal(dj.snapshot().control.requested.state, 'explore', 'Hold release does not replay rejected targets');
  assert.deepEqual(dj.snapshot().control.queue, before.control.queue);
  await dj.dispose();
});
test('new opt-in options keep direct as the DJ default and reject unknown modes', async () => {
  const {loaded, player} = await setup();
  const dj = new DeterministicDj(player, loaded);
  assert.equal(dj.handoffMode, 'direct');
  dj.setHandoff('mix'); dj.setMixOptions({allowPitchShift: true, returnToOriginalTempo: true});
  assert.equal(dj.handoffMode, 'mix');
  assert.throws(() => dj.setHandoff('other' as 'mix'));
  await dj.dispose();
});
test('ready boundary rejects otherwise valid render data for the wrong tempo or pitch', async () => {
  const loaded = await fixturePack(), context = new MixContext();
  const signal = makeMixFixture({sampleRate: context.sampleRate});
  const buffer = audioBuffer(context.sampleRate, signal.channels[0]!.length);
  buffer.getChannelData(0).set(signal.channels[0]!);
  const from = {asset: loaded.pack.assets.find(a => a.id === loaded.pack.routes[0]!.from.id)!, buffer};
  const to = {asset: loaded.pack.assets.find(a => a.id === loaded.pack.routes[0]!.to.id)!, buffer};
  for (const field of ['tempoRatio', 'pitchSemitones'] as const) {
    const runtime: MixPreparationRuntime = {...inline, render: async (audio, options) => {
      const result = renderTimePitch(audio, options);
      return {...result, mapping: {...result.mapping, [field]: field === 'tempoRatio' ? 1.04 : 1}};
    }};
    await assert.rejects(prepareMixTransition(context.audio, from, to, {}, undefined, runtime), /transformation/);
  }
});
test('ready boundary refuses fabricated output length and non-finite prepared samples', async () => {
  const loaded = await fixturePack(), context = new MixContext(), signal = makeMixFixture({sampleRate: context.sampleRate});
  const buffer = audioBuffer(context.sampleRate, signal.channels[0]!.length); buffer.getChannelData(0).set(signal.channels[0]!);
  const from = {asset: loaded.pack.assets.find(a => a.id === loaded.pack.routes[0]!.from.id)!, buffer};
  const to = {asset: loaded.pack.assets.find(a => a.id === loaded.pack.routes[0]!.to.id)!, buffer};
  for (const mode of ['length', 'sample']) {
    const runtime: MixPreparationRuntime = {...inline, render: async (audio, options) => {
      const result = renderTimePitch(audio, options);
      if (mode === 'sample') { result.audio.channels[0]![100] = NaN; return result; }
      const frames = result.mapping.outputFrames - 1;
      return {...result, mapping: {...result.mapping, outputFrames: frames},
        audio: {...result.audio, channels: result.audio.channels.map(c => c.slice(0, frames))}};
    }};
    await assert.rejects(prepareMixTransition(context.audio, from, to, {}, undefined, runtime), /length|peak\/finite/);
  }
});
