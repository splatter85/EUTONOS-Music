import assert from 'node:assert/strict';
import test from 'node:test';
import {compileS01Phrase} from '../src/phrase-plan.js';
import {decodeProceduralSamples, ProceduralSource} from '../src/procedural-source.js';
import {WebAudioClock} from '../src/web-audio.js';
import {SmallPlayer} from '../src/player.js';
import {bufferDouble, ContextDouble, deferred, fixturePack, outputValue} from './audio-double.js';

const loaded = await fixturePack();
const plan = compileS01Phrase(loaded.pack, {seed: 1, state: 'explore', allowFixtures: true});
async function fixture(rate = 48000, fades = {fadeInFrames: 0, fadeOutFrames: 0}, selected = plan) {
  const context = new ContextDouble(rate), clock = new WebAudioClock(context.audio);
  const samples = await decodeProceduralSamples(loaded, context.audio, selected);
  const source = new ProceduralSource(context.audio, selected, samples, context.destination, {allowFixtures: true, ...fades});
  return {context, clock, samples, source};
}
function connectedGain(context: ContextDouble, node: {connections: readonly AudioNode[]}) {
  assert.equal(node.connections.length, 1, 'each node in the sampler path has exactly one output connection');
  const gain = context.gains.find(candidate => candidate as unknown as AudioNode === node.connections[0]);
  assert.ok(gain, 'the output connection must lead to a registered gain');
  return gain;
}
function masterGain(context: ContextDouble) {
  const gains = context.gains.filter(gain => gain.connections.includes(context.destination));
  assert.equal(gains.length, 1, 'the finite source has one master output');
  return gains[0]!;
}

test('native sampler decodes exactly the original palette without detaching verified bytes', async () => {
  const {context, samples} = await fixture();
  assert.equal(samples.length, 4);
  assert.equal(context.decodedInputBytes.length, 4);
  for (const sample of samples) {
    assert.equal(sample.asset.source_kind, 'sample');
    assert.equal(loaded.files.get(sample.asset.file.path)!.length, sample.asset.file.bytes);
  }
  const changed = structuredClone(loaded.pack);
  const revised = {...loaded, pack: {...changed, revision: 2}};
  await assert.rejects(decodeProceduralSamples(revised, context.audio, plan), /pack revision|supported|original|requires s01/i);
  await assert.rejects(decodeProceduralSamples({...loaded, allowFixtures: false}, context.audio, plan), /fixture|eligible|permission/i);
  const missing = new Map(loaded.files);
  missing.delete(samples[0]!.asset.file.path);
  await assert.rejects(decodeProceduralSamples({...loaded, files: missing}, context.audio, plan), /Missing verified sample bytes/);
  const tampered = new Map(loaded.files), modified = new Uint8Array(tampered.get(samples[0]!.asset.file.path)!);
  modified[100] = modified[100]! ^ 1; tampered.set(samples[0]!.asset.file.path, modified);
  await assert.rejects(decodeProceduralSamples({...loaded, files: tampered}, context.audio, plan), /bound hash/);
});

test('sampler schedules every event and tail on the retained clock at both output rates', async () => {
  for (const rate of [44100, 48000]) {
    const {context, clock, source, samples} = await fixture(rate);
    const start = {at: clock.stamp(rate), entryCueId: 'entry'};
    assert.throws(() => source.scheduleStart(start), /Prepare before start/);
    await source.prepare(clock);
    assert.equal(context.sources.length, 0, 'prepare makes no live note sources');
    assert.equal(source.resourceUsage.liveMixBuses, 0, 'mix buses belong to the scheduling transaction');
    await assert.rejects(source.prepare(clock), /once/);
    assert.deepEqual(source.getValidExits(), [{cueId: 'phrase', offsetFrames: rate * 8}, {cueId: 'end', offsetFrames: rate * 16}]);
    source.scheduleStart(start);
    assert.equal(source.reference.id, plan.recipe.id);
    assert.equal(source.kind, 'procedural');
    assert.equal(source.endFrame, rate * 17);
    assert.equal(context.sources.length, plan.events.length);
    for (const [index, event] of plan.events.entries()) {
      const node = context.sources[index]!, sample = samples.find(s => s.asset.id === event.sample.id)!;
      const at = rate + Math.round(event.atQuarters * rate / 2);
      const nativeEnd = event.atQuarters * sample.asset.file.sample_rate / 2 + sample.asset.file.frames;
      const end = rate + Math.round(nativeEnd * rate / sample.asset.file.sample_rate);
      const length = Math.min(sample.buffer.length, end - at);
      assert.deepEqual(node.starts, [{when: at / rate, offset: 0}]);
      assert.deepEqual(node.stops, [(at + length) / rate]);
      assert.equal(connectedGain(context, node).gain.value, event.gain);
    }
    assert.throws(() => source.scheduleStart(start), /once/);
    assert.ok(source.resourceUsage.allocatedNoteNodes <= 256);
    assert.equal(source.resourceUsage.liveNoteNodes, plan.events.length);
    assert.equal(source.resourceUsage.liveMixBuses, 2);
    assert.ok(source.resourceUsage.sampleValues <= 1024 * 1024);
    source.release(); source.release();
    assert.equal(source.resourceUsage.liveNoteNodes, 0);
    assert.equal(source.resourceUsage.liveMixBuses, 0);
    assert.equal(source.resourceUsage.sampleValues, 0);
    assert.ok(context.sources.every(s => s.connections.length === 0 && s.onended === null));
    assert.ok(context.gains.every(g => g.connections.length === 0));
  }
});

test('sampler fixes rhythm and pitched pairs with no more than two active signals per native sum', async () => {
  for (const rate of [44100, 48000]) for (const state of ['explore', 'drive'] as const) {
    const selected = compileS01Phrase(loaded.pack, {seed: 2, state, allowFixtures: true});
    const {context, clock, source} = await fixture(rate, undefined, selected);
    await source.prepare(clock);
    const master = masterGain(context);
    source.scheduleStart({at: clock.stamp(rate), entryCueId: 'entry'});
    const buses = new Map<string, ReturnType<typeof connectedGain>>();
    const boundaries: {frame: number; delta: number; role: string; bus: ReturnType<typeof connectedGain>}[] = [];
    for (const [index, event] of selected.events.entries()) {
      const node = context.sources[index]!, gain = connectedGain(context, node), bus = connectedGain(context, gain);
      assert.notEqual(bus, master);
      assert.equal(bus.gain.value, 1);
      assert.deepEqual(bus.gain.calls, [], 'pair sums apply no automation');
      assert.equal(connectedGain(context, bus), master);
      if (buses.has(event.role)) assert.equal(bus, buses.get(event.role), 'a role keeps its fixed pair');
      buses.set(event.role, bus);
      boundaries.push({frame: Math.round(node.starts[0]!.when * rate), delta: 1, role: event.role, bus},
        {frame: Math.round(node.stops[0]! * rate), delta: -1, role: event.role, bus});
    }
    assert.equal(buses.size, 4);
    assert.equal(buses.get('drum'), buses.get('percussion'));
    assert.equal(buses.get('bass'), buses.get('harmony'));
    assert.notEqual(buses.get('drum'), buses.get('bass'));
    assert.equal(new Set(buses.values()).size, source.resourceUsage.liveMixBuses);
    const roleVoices = new Map<string, number>(), pairVoices = new Map<ReturnType<typeof connectedGain>, number>();
    for (const boundary of boundaries.sort((a, b) => a.frame - b.frame || a.delta - b.delta)) {
      const roleCount = (roleVoices.get(boundary.role) ?? 0) + boundary.delta;
      const pairCount = (pairVoices.get(boundary.bus) ?? 0) + boundary.delta;
      roleVoices.set(boundary.role, roleCount); pairVoices.set(boundary.bus, pairCount);
      assert.ok(roleCount >= 0 && roleCount <= 1, 'actual rounded note deadlines keep each role monophonic');
      assert.ok(pairCount >= 0 && pairCount <= 2, 'actual rounded note deadlines keep each pair bounded');
    }
    assert.ok([...roleVoices.values(), ...pairVoices.values()].every(count => count === 0));
    source.release();
    assert.equal(source.resourceUsage.liveMixBuses, 0);
    assert.ok([...buses.values()].every(bus => bus.connections.length === 0));
  }
});

test('sampler refuses stale clocks, wrong ownership, altered samples and missing reuse rights before note allocation', async () => {
  const {context, clock, samples} = await fixture();
  const construct = (values = samples, destination = context.destination) =>
    new ProceduralSource(context.audio, plan, values, destination, {allowFixtures: true});
  await assert.rejects(construct().prepare(new WebAudioClock(new ContextDouble().audio)), /owner context and clock/);
  await assert.rejects(construct(samples, new ContextDouble().destination).prepare(clock), /another context/);
  const first = samples[0]!;
  await assert.rejects(construct([{...first, asset: {...first.asset, rights: {...first.asset.rights, allowed_uses: ['playback']}}}, ...samples.slice(1)]).prepare(clock), /sample-reuse permission/);
  await assert.rejects(construct([{...first, asset: {...first.asset, file: {...first.asset.file, sha256: '0'.repeat(64)}}}, ...samples.slice(1)]).prepare(clock), /metadata differs/);
  await assert.rejects(construct([{...first, buffer: bufferDouble(44100, 100)}, ...samples.slice(1)]).prepare(clock), /Decoded buffer/);
  await assert.rejects(construct([first, first, ...samples.slice(2)]).prepare(clock), /Missing or duplicate/);
  await assert.rejects(new ProceduralSource(context.audio, plan, samples, context.destination).prepare(clock), /eligible review status/);
  assert.equal(context.sources.length, 0);
  const source = construct();
  await source.prepare(clock);
  const old = clock.stamp(48000); clock.invalidate();
  assert.throws(() => source.getValidExits(), /Stale/);
  assert.throws(() => source.scheduleStart({at: old, entryCueId: 'entry'}), /Stale/);
  source.release();
  assert.equal(context.sources.length, 0);
});

test('phrase exit is checked before effects; cancelling restores every future note and the entry envelope', async () => {
  const {source, context, clock} = await fixture(48000, {fadeInFrames: 48000, fadeOutFrames: 192000});
  await source.prepare(clock);
  const master = masterGain(context);
  source.scheduleStart({at: clock.stamp(48000), entryCueId: 'entry'});
  const original = context.sources.map(s => s.stops[0]);
  const automation = [...master.gain.calls];
  assert.throws(() => source.transitionOut('phrase', clock.stamp(432001)), /align/);
  assert.throws(() => source.transitionOut('unknown', clock.stamp(432000)), /align/);
  assert.throws(() => source.transitionOut('end', clock.stamp(816000)), /fade exceeds/);
  assert.deepEqual(master.gain.calls, automation);
  source.transitionOut('phrase', clock.stamp(432000));
  assert.equal(source.endFrame, 624000);
  assert.deepEqual(master.gain.calls.slice(-2), [{kind: 'set', value: 1, time: 9}, {kind: 'ramp', value: 0, time: 13}]);
  context.currentTime = 2;
  assert.equal(source.cancelTransition(), true);
  assert.equal(source.endFrame, 816000);
  assert.deepEqual(context.sources.map(s => s.stops.at(-1)), original);
  source.transitionOut('phrase', clock.stamp(432000));
  context.currentTime = 9;
  assert.equal(source.cancelTransition(), false);
  source.release();
});

test('stop mutes immediately at its stamp and release cancels future notes even after invalidation', async () => {
  const {source, clock, context} = await fixture();
  await source.prepare(clock);
  const master = masterGain(context);
  assert.throws(() => source.scheduleStart({at: clock.stamp(48000), entryCueId: 'middle'}), /zero entry/);
  source.scheduleStart({at: clock.stamp(48000), entryCueId: 'entry'});
  assert.throws(() => source.stop(clock.stamp(48000 * 18)), /cannot extend/);
  source.stop(clock.stamp(96000));
  assert.equal(source.endFrame, 96000);
  assert.deepEqual(master.gain.calls.slice(-2), [{kind: 'cancel', time: 2}, {kind: 'set', value: 0, time: 2}]);
  assert.ok(context.sources.every(s => s.stops.at(-1)! <= 2));
  clock.invalidate(); source.release(); source.release();
  assert.ok(context.sources.every(s => s.stops.at(-1) === 0 && s.onended === null));
  assert.equal(source.resourceUsage.liveNoteNodes, 0);
  assert.equal(source.resourceUsage.liveMixBuses, 0);
});

test('partial pair-bus allocation or connection failure clears the gated graph before notes start', async () => {
  for (const failure of ['allocation', 'connection'] as const) for (const failAt of [1, 2]) {
    const {source, clock, context} = await fixture();
    await source.prepare(clock);
    const master = masterGain(context), create = context.createGain.bind(context);
    let attempts = 0;
    context.createGain = () => {
      const fail = ++attempts === failAt;
      if (fail && failure === 'allocation') throw new Error('injected pair-bus allocation failure');
      const bus = create();
      if (fail && failure === 'connection') bus.connect = () => { throw new Error('injected pair-bus connection failure'); };
      return bus;
    };
    assert.throws(() => source.scheduleStart({at: clock.stamp(48000), entryCueId: 'entry'}), /injected pair-bus/);
    assert.equal(context.sources.length, 0, 'both pair buses must be connected before note allocation');
    assert.equal(source.resourceUsage.liveNoteNodes, 0);
    assert.equal(source.resourceUsage.liveMixBuses, 0);
    assert.equal(source.resourceUsage.sampleValues, 0);
    assert.equal(master.gain.value, 0);
    assert.deepEqual(master.gain.calls, [], 'failed pair setup never opens the output gate');
    assert.ok(context.gains.every(gain => gain.connections.length === 0 && gain.disconnectCalls > 0),
      'every successfully allocated bus is registered before a later native operation can fail');
    const disconnects = context.gains.map(gain => gain.disconnectCalls);
    source.release(); source.release();
    assert.deepEqual(context.gains.map(gain => gain.disconnectCalls), disconnects);
  }
});

test('a partial native schedule failure leaves no connected output or later notes', async () => {
  const {source, clock, context} = await fixture();
  const create = context.createBufferSource.bind(context);
  context.createBufferSource = () => {
    const node = create();
    if (context.sources.length === 3) node.start = () => { throw new Error('injected native failure'); };
    return node;
  };
  await source.prepare(clock);
  const master = masterGain(context);
  assert.throws(() => source.scheduleStart({at: clock.stamp(48000), entryCueId: 'entry'}), /injected native failure/);
  assert.equal(source.resourceUsage.liveNoteNodes, 0);
  assert.equal(source.resourceUsage.liveMixBuses, 0);
  assert.ok(context.sources.every(s => s.connections.length === 0));
  assert.ok(context.gains.every(g => g.connections.length === 0));
  assert.deepEqual(master.gain.calls, [], 'a partial schedule never ungates output');
});

test('a clock crossing during scheduling fails silent rather than accepting a late phrase', async () => {
  const {source, clock, context} = await fixture();
  const create = context.createBufferSource.bind(context);
  context.createBufferSource = () => {
    const node = create(), start = node.start.bind(node);
    node.start = (...args) => { start(...args); context.currentTime = 2; };
    return node;
  };
  await source.prepare(clock);
  const master = masterGain(context);
  assert.throws(() => source.scheduleStart({at: clock.stamp(48000), entryCueId: 'entry'}), /future audio-clock/);
  assert.equal(source.resourceUsage.liveNoteNodes, 0);
  assert.equal(source.resourceUsage.liveMixBuses, 0);
  assert.deepEqual(master.gain.calls, []);
});

test('natural note completion disconnects each note and the finite source output', async () => {
  const {source, context, clock} = await fixture();
  await source.prepare(clock); source.scheduleStart({at: clock.stamp(48000), entryCueId: 'entry'});
  for (const node of context.sources) node.finish();
  assert.equal(source.resourceUsage.liveNoteNodes, 0);
  assert.equal(source.resourceUsage.liveMixBuses, 0);
  assert.ok(context.gains.every(g => g.connections.length === 0));
  source.release();
});

test('procedural audition reuses the player clock, Pause, Mute, Resume, Stop and finite end', async () => {
  const context = new ContextDouble(), player = new SmallPlayer(context.audio, loaded, 's01-a-to-b');
  const clock = player.clock;
  await player.playProcedural(plan);
  const scheduled = player.snapshot();
  assert.equal(scheduled.requested, plan.recipe.id);
  assert.equal(scheduled.now.length, 0);
  assert.equal(scheduled.next, plan.recipe.id);
  assert.equal(scheduled.durationSeconds, 16);
  context.advance(.2);
  assert.deepEqual(player.snapshot().now, [plan.recipe.id]);
  await assert.rejects(player.scheduleAB(), /Play A first/);
  await player.pause();
  const frame = clock.currentFrame; context.advance(2);
  assert.equal(clock.currentFrame, frame);
  const count = context.sources.length;
  player.setMuted(true); await player.resume();
  assert.equal(outputValue(context), 0);
  assert.equal(context.sources.length, count, 'Resume does not recreate any notes');
  assert.equal(player.clock, clock);
  context.advance(20);
  assert.equal(player.snapshot().state, 'ended');
  await player.playProcedural(plan);
  player.stop();
  assert.equal(player.snapshot().now.length, 0);
  assert.equal(outputValue(context), 0);
  assert.ok(context.sources.every(s => s.connections.length === 0));
  await player.dispose();
});

test('Stop during procedural decode wins, and a rejected ownership gate never starts notes', async () => {
  const context = new ContextDouble(), player = new SmallPlayer(context.audio, loaded, 's01-a-to-b');
  context.decodeGate = deferred();
  const pending = player.playProcedural(plan);
  player.stop(); context.decodeGate.release(); await pending;
  assert.equal(player.snapshot().state, 'idle');
  assert.equal(context.sources.length, 0);
  context.decodeGate = null;
  await assert.rejects(player.playProcedural(plan, Promise.reject(new Error('ownership denied'))), /ownership denied/);
  assert.equal(context.sources.length, 0);
  assert.equal(player.snapshot().state, 'idle');
  assert.equal(outputValue(context), 0);
  await player.dispose();
});
