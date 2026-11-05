import assert from 'node:assert/strict';
import test from 'node:test';
import {compileS01Phrase} from '../src/phrase-plan.js';
import {decodeProceduralSamples, ProceduralSource} from '../src/procedural-source.js';
import {SmallPlayer} from '../src/player.js';
import {WebAudioClock} from '../src/web-audio.js';
import {ContextDouble, deferred, fixturePack, outputValue} from './audio-double.js';

const loaded = await fixturePack();
const plan = compileS01Phrase(loaded.pack, {seed: 2, state: 'drive', allowFixtures: true});

test('review: repeated cancelled procedural starts share bounded pending sample decoding', async () => {
  const context = new ContextDouble(), player = new SmallPlayer(context.audio, loaded, 's01-a-to-b');
  const gate = deferred(), enteredNativeDecode = deferred();
  context.decodeGate = gate;
  const decode = context.decodeAudioData.bind(context);
  context.decodeAudioData = async bytes => {
    const pending = decode(bytes);
    enteredNativeDecode.release();
    return pending;
  };
  const pending: Promise<void>[] = [];
  try {
    for (let index = 0; index < 4; index++) {
      const selection = compileS01Phrase(loaded.pack, {seed: index, state: 'drive', allowFixtures: true});
      pending.push(player.playProcedural(selection));
      player.stop();
    }
    await enteredNativeDecode.promise;
    assert.equal(context.decodedInputBytes.length, 1,
      'Stop cancels playback, but repeated requests must not multiply the fixed palette decode job');
  } finally {
    gate.release();
    await Promise.all(pending);
    context.decodeGate = null;
    await player.dispose();
  }
  assert.equal(context.decodedInputBytes.length, 4, 'all cancelled requests share exactly one four-sample palette');
  assert.equal(context.sources.length, 0, 'cancelled decode completion cannot allocate note sources');
});

test('review: cached procedural samples do not bypass current pack and reuse eligibility checks', async () => {
  const local = {...loaded, pack: structuredClone(loaded.pack)};
  const context = new ContextDouble(), player = new SmallPlayer(context.audio, local, 's01-a-to-b');
  try {
    await player.playProcedural(plan);
    player.stop();
    const kick = local.pack.assets.find(asset => asset.id === 's01-kick')!;
    Reflect.set(kick.rights, 'allowed_uses', ['playback', 'redistribution']);
    const before = context.sources.length;
    await assert.rejects(player.playProcedural(plan), /sample-reuse|permission|eligibility/i);
    assert.equal(context.sources.length, before);
    assert.equal(player.snapshot().state, 'idle');
    assert.equal(outputValue(context), 0);
  } finally { await player.dispose(); }
});

test('review: late denied ownership for a procedural request cannot stop its recording replacement', async () => {
  const context = new ContextDouble(), player = new SmallPlayer(context.audio, loaded, 's01-a-to-b');
  const ownership = deferred();
  try {
    const stale = player.playProcedural(plan, ownership.promise);
    await player.play('b');
    const replacement = player.snapshot();
    ownership.reject(new Error('old ownership denied'));
    await stale;
    assert.equal(player.snapshot().requested, 's01-recording-b');
    assert.deepEqual(player.snapshot().voices, replacement.voices);
    assert.equal(context.sources.length, 1, 'only recording B was scheduled');
    assert.equal(context.sources[0]!.connections.length, 1);
    assert.equal(outputValue(context), 0.65);
  } finally { await player.dispose(); }
});

test('review: Pause during procedural preparation retains the seed when Resume restarts preparation', async () => {
  const context = new ContextDouble(), player = new SmallPlayer(context.audio, loaded, 's01-a-to-b');
  const gate = deferred();
  context.decodeGate = gate;
  try {
    const pending = player.playProcedural(plan);
    await player.pause();
    gate.release();
    await pending;
    assert.equal(player.snapshot().state, 'paused');
    assert.equal(context.sources.length, 0);
    assert.equal(context.state, 'suspended');
    context.decodeGate = null;
    await player.resume();
    assert.equal(player.snapshot().requested, plan.recipe.id);
    assert.equal(context.sources.length, plan.events.length);
    const start = player.snapshot().voices[0]!.start.frame;
    assert.deepEqual(context.sources.map(source => source.starts[0]!.when),
      plan.events.map(event => (start + Math.round(event.atQuarters * context.sampleRate / 2)) / context.sampleRate));
  } finally {
    gate.release();
    await player.dispose();
  }
});

test('review: procedural construction owns sample metadata and scheduled start stamps', async () => {
  const context = new ContextDouble(), clock = new WebAudioClock(context.audio);
  const samples = (await decodeProceduralSamples(loaded, context.audio, plan))
    .map(sample => ({asset: structuredClone(sample.asset), buffer: sample.buffer}));
  const source = new ProceduralSource(context.audio, plan, samples, context.destination, {allowFixtures: true});
  try {
    Reflect.set(samples[0]!.asset.file, 'sha256', '0'.repeat(64));
    samples.pop();
    await source.prepare(clock);
    const start = {at: clock.stamp(context.sampleRate), entryCueId: 'entry'};
    source.scheduleStart(start);
    Reflect.set(start.at, 'frame', 123);
    start.entryCueId = 'changed-after-start';
    source.transitionOut('phrase', clock.stamp(context.sampleRate * 9));
    assert.equal(source.endFrame, context.sampleRate * 9);
  } finally { source.release(); }
});

test('review: note allocation failure disconnects the entire partial procedural graph', async () => {
  const context = new ContextDouble(), clock = new WebAudioClock(context.audio);
  const samples = await decodeProceduralSamples(loaded, context.audio, plan);
  const source = new ProceduralSource(context.audio, plan, samples, context.destination, {allowFixtures: true});
  await source.prepare(clock);
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    // Target a partial note graph independently of any fixed mixer gains.
    if (context.sources.length === 3) throw new Error('native gain allocation failed');
    return createGain();
  };
  assert.throws(() => source.scheduleStart({at: clock.stamp(context.sampleRate), entryCueId: 'entry'}),
    /native gain allocation failed/);
  assert.equal(source.resourceUsage.liveNoteNodes, 0);
  assert.equal(source.resourceUsage.sampleValues, 0);
  assert.ok(context.sources.every(node => node.connections.length === 0 && node.onended === null));
  assert.ok(context.gains.every(gain => gain.connections.length === 0));
  assert.equal(context.sources.length, 3, 'failure occurs while constructing the third note');
  assert.equal(context.sources.some(node => node.starts.length > 0), false);
  source.release();
});

test('review: a pair-bus connection failure releases every allocated gain before any note starts', async () => {
  const context = new ContextDouble(), clock = new WebAudioClock(context.audio);
  const samples = await decodeProceduralSamples(loaded, context.audio, plan);
  const source = new ProceduralSource(context.audio, plan, samples, context.destination, {allowFixtures: true});
  await source.prepare(clock);
  const createGain = context.createGain.bind(context);
  let newGains = 0;
  context.createGain = () => {
    const gain = createGain();
    if (++newGains === 2) gain.connect = () => { throw new Error('second pair-bus connection failed'); };
    return gain;
  };
  assert.throws(() => source.scheduleStart({at: clock.stamp(context.sampleRate), entryCueId: 'entry'}),
    /second pair-bus connection failed/);
  assert.equal(context.sources.length, 0, 'bus failure precedes note allocation');
  assert.equal(source.resourceUsage.liveNoteNodes, 0);
  assert.equal(source.resourceUsage.sampleValues, 0);
  assert.ok(context.gains.every(gain => gain.connections.length === 0 && gain.disconnectCalls > 0));
  assert.deepEqual(context.gains[0]!.gain.calls, [], 'the failed schedule never opens the master gate');
  source.release();
  source.release();
});
