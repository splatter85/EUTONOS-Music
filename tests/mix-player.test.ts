import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio} from '../src/mix-analysis.js';
import {DeterministicDj} from '../src/dj.js';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import {SmallPlayer} from '../src/player.js';
import {prepareMixTransition, type MixPreparationRuntime} from '../src/mix-transition.js';
import {renderTimePitch} from '../src/time-pitch.js';
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
function blockedRuntime() {
  const entered = deferred(), gate = deferred();
  let signal: AbortSignal | undefined, calls = 0;
  const runtime: MixPreparationRuntime = {...inline, render: async (audio, options, abort) => {
    signal = abort; calls++; entered.release(); await gate.promise;
    return renderTimePitch(audio, options);
  }};
  return {runtime, entered, gate, get signal() { return signal; }, get calls() { return calls; }};
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
test('missed analyzed and authored deadlines preserve A and schedule no late B', async () => {
  const block = blockedRuntime(), {context, player} = await setup(block.runtime);
  const task = player.scheduleMix(); await block.entered.promise;
  context.advance(10); block.gate.release();
  await assert.rejects(task, /exit cue has passed/);
  assert.equal(player.snapshot().mix?.phase, 'unavailable');
  assert.equal(player.snapshot().voices.length, 1);
  assert.equal(player.snapshot().transition, 'none');
  assert.equal(context.sources.filter(s => s.starts.length).length, 1);
  player.stop();
});
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
