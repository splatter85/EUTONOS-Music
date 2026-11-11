import assert from 'node:assert/strict';
import test from 'node:test';
import {bassSwapAutomation, createMixAutomationGraph, MIX_FILTER_Q_DB, mixCurveValue,
  sweepAutomation, validateMixAutomation, type MixAutomation} from '../src/mix-automation.js';
import {RecordedSource, WebAudioClock} from '../src/web-audio.js';
import {bufferDouble, ContextDouble, fixturePack, NodeDouble, ParameterDouble} from './audio-double.js';

class MixParameterDouble extends ParameterDouble {
  readonly exponentials: {value: number; time: number}[] = [];
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.exponentials.push({value, time}); return this;
  }
}
class FilterDouble extends NodeDouble {
  type: BiquadFilterType = 'lowpass';
  frequency = new MixParameterDouble();
  Q = new MixParameterDouble();
  gain = new MixParameterDouble();
}
class MixContext extends ContextDouble {
  readonly filters: FilterDouble[] = [];
  createBiquadFilter(): BiquadFilterNode {
    const filter = new FilterDouble(this.audio); this.filters.push(filter);
    return filter as unknown as BiquadFilterNode;
  }
}
const {pack} = await fixturePack();
const asset = pack.assets[0]!;
const rate = 48000;
const recording = () => ({asset, buffer: bufferDouble(rate,
  Math.round(asset.file.frames * rate / asset.file.sample_rate), asset.file.channels)});
const shape = () => bassSwapAutomation(rate, rate);

test('bass swap has complementary attenuation and delays incoming bass release until outgoing cut', () => {
  const plan = shape();
  validateMixAutomation(plan.outgoing, rate); validateMixAutomation(plan.incoming, rate);
  for (const frame of [0, 12000, 24000, 36000, 48000]) {
    assert.ok(Math.abs(mixCurveValue(plan.outgoing.gain, frame) + mixCurveValue(plan.incoming.gain, frame) - 1) < 1e-12);
  }
  assert.equal(mixCurveValue(plan.incoming.lowShelfDb, 24000), -24);
  assert.equal(mixCurveValue(plan.outgoing.lowShelfDb, 24000), -24);
  assert.equal(mixCurveValue(plan.outgoing.gain, 48000), 0);
  assert.equal(mixCurveValue(plan.incoming.highPassHz, 48000), 0);
  assert.equal(mixCurveValue(plan.incoming.lowShelfDb, 48000), 0);
});

for (const kind of ['highpass', 'lowpass'] as const) {
  test(`${kind} sweep supports opening and closing on bounded explicit endpoints`, () => {
    const open = sweepAutomation(rate, rate, kind, 'open');
    const close = sweepAutomation(rate, rate, kind, 'close');
    const property = kind === 'highpass' ? 'highPassHz' : 'lowPassHz';
    assert.equal(open[property][0]!.value, close[property].at(-1)!.value);
    assert.equal(open[property].at(-1)!.value, close[property][0]!.value);
    assert.equal(open.gain[0]!.value, 1);
    assert.equal(open.gain.at(-1)!.value, 1);
  });
}

test('automation refuses malformed lanes, bounds, nonfinite values and invalid durations', () => {
  const good = shape().outgoing;
  const invalid: MixAutomation[] = [
    {...good, durationFrames: 0}, {...good, durationFrames: 121 * rate},
    {...good, gain: [{frame: 0, value: 1}, {frame: 0, value: 0}]},
    {...good, gain: [{frame: 1, value: 1}, {frame: rate, value: 0}]},
    {...good, gain: [{frame: 0, value: 2}, {frame: rate, value: 0}]},
    {...good, lowShelfDb: [{frame: 0, value: -25}, {frame: rate, value: 0}]},
    {...good, highPassHz: [{frame: 0, value: 0}, {frame: rate, value: NaN}]},
    {...good, lowPassHz: [{frame: 0, value: rate}, {frame: rate, value: 0}]},
    {...good, gain: [{frame: 0, value: 0}, {frame: rate, value: 1, curve: 'exponential'}]},
    {...good, gain: [{frame: 0, value: 1}, {frame: rate, value: 0, curve: 'exponential'}]},
  ];
  for (const plan of invalid) assert.throws(() => validateMixAutomation(plan, rate));
  assert.throws(() => validateMixAutomation(good, 0));
  assert.throws(() => validateMixAutomation(good, 44100.5));
  assert.throws(() => bassSwapAutomation(9, rate));
});

test('exponential filter curves use positive endpoints and evaluate geometrically', () => {
  const points = [{frame: 0, value: 100}, {frame: rate, value: 1600, curve: 'exponential' as const}];
  assert.equal(mixCurveValue(points, rate / 2), 400);
  assert.equal(mixCurveValue(points, -1), 100);
  assert.equal(mixCurveValue(points, rate * 2), 1600);
  const context = new MixContext();
  const input = context.createBufferSource(), output = context.createGain(); input.connect(output);
  const plan = {...shape().incoming, highPassHz: points};
  const graph = createMixAutomationGraph(context.audio, input, output, rate * 2, plan);
  assert.deepEqual(context.filters[1]!.frequency.exponentials, [{value: 1600, time: 3}]);
  graph.release();
});

test('native plan schedules all parameters against the same absolute frame origin', () => {
  const context = new MixContext();
  const input = context.createBufferSource(), output = context.createGain(); input.connect(output);
  const graph = createMixAutomationGraph(context.audio, input, output, rate * 2, shape().outgoing);
  assert.deepEqual(context.filters.map(filter => filter.type), ['lowshelf', 'highpass', 'lowpass']);
  assert.equal(context.filters[1]!.Q.value, MIX_FILTER_Q_DB);
  assert.equal(context.filters[2]!.Q.value, MIX_FILTER_Q_DB);
  for (const filter of context.filters) {
    const lane = filter.type === 'lowshelf' ? filter.gain : filter.frequency;
    assert.ok(lane.calls.every(call => call.time >= 2 && call.time <= 3));
  }
  assert.deepEqual(context.gains[1]!.gain.calls, [{kind: 'set', value: 0, time: 2}]);
  assert.equal(context.gains[2]!.gain.value, 0, 'wet branch stays silent before its scheduled entry');
  graph.restore();
  assert.deepEqual(context.sources[0]!.connections, [output]);
  assert.ok(context.filters.every(filter => filter.connections.length === 0));
  graph.restore(); graph.release();
});

test('invalid plans and clock/context disagreement allocate no effects', () => {
  const context = new MixContext(), other = new MixContext();
  const input = context.createBufferSource(), output = context.createGain(); input.connect(output);
  assert.throws(() => createMixAutomationGraph(context.audio, input, output, -1, shape().outgoing), /future/);
  assert.throws(() => createMixAutomationGraph(context.audio, input, other.destination, rate, shape().outgoing), /owner context/);
  assert.throws(() => createMixAutomationGraph(context.audio, input, output, rate,
    {...shape().outgoing, durationFrames: 0}));
  assert.equal(context.filters.length, 0);
  assert.deepEqual(context.sources[0]!.connections, [output]);
});

test('ordinary recorded preparation and authored cues still allocate no filters', async () => {
  const context = new MixContext(), clock = new WebAudioClock(context.audio);
  const source = new RecordedSource(context.audio, recording(), context.destination, {allowFixtures: true});
  await source.prepare(clock); source.scheduleStart({at: clock.stamp(rate), entryCueId: 'entry'});
  source.transitionOut('exit', clock.stamp(9 * rate));
  assert.equal(context.filters.length, 0);
  assert.equal(context.gains.length, 1);
  source.release();
});

test('analyzed entry uses explicit decoded-frame offset and ends at prepared EOF', async () => {
  const context = new MixContext(), clock = new WebAudioClock(context.audio);
  const source = new RecordedSource(context.audio, recording(), context.destination, {allowFixtures: true});
  await source.prepare(clock); source.scheduleMixStart(clock.stamp(2 * rate), 3 * rate, shape().incoming);
  assert.deepEqual(context.sources[0]!.starts, [{when: 2, offset: 3}]);
  assert.equal(source.endFrame, recording().buffer.length - rate);
  assert.equal(context.filters.length, 3);
  assert.throws(() => source.scheduleMixStart(clock.stamp(3 * rate), 0, shape().incoming), /once/);
  source.release();
  assert.ok(context.filters.every(filter => !filter.connections.length));
});

test('analyzed exit is atomic on invalid offsets/envelopes and stays frame aligned', async () => {
  const context = new MixContext(), clock = new WebAudioClock(context.audio);
  const source = new RecordedSource(context.audio, recording(), context.destination, {allowFixtures: true});
  await source.prepare(clock); source.scheduleStart({at: clock.stamp(rate), entryCueId: 'entry'});
  assert.throws(() => source.transitionMixOut(clock.stamp(3 * rate), rate, shape().outgoing), /align/);
  assert.throws(() => source.transitionMixOut(clock.stamp(3 * rate), 2 * rate, shape().incoming), /neutral/);
  assert.equal(context.filters.length, 0); assert.equal(context.sources[0]!.stops.length, 0);
  source.transitionMixOut(clock.stamp(3 * rate), 2 * rate, shape().outgoing);
  assert.deepEqual(context.sources[0]!.stops, [4]);
  assert.equal(source.endFrame, 4 * rate);
  source.release();
});

test('pre-boundary mix cancellation restores original graph/EOF and permits another mix', async () => {
  const context = new MixContext(), clock = new WebAudioClock(context.audio);
  const source = new RecordedSource(context.audio, recording(), context.destination, {allowFixtures: true});
  await source.prepare(clock); source.scheduleStart({at: clock.stamp(rate), entryCueId: 'entry'});
  const end = source.endFrame, original = [...context.sources[0]!.connections];
  source.transitionMixOut(clock.stamp(3 * rate), 2 * rate, shape().outgoing);
  context.currentTime = 2;
  assert.equal(source.cancelTransition(), true);
  assert.deepEqual(context.sources[0]!.connections, original);
  assert.equal(source.endFrame, end);
  assert.ok(context.filters.every(filter => !filter.connections.length));
  source.transitionMixOut(clock.stamp(4 * rate), 3 * rate, shape().outgoing);
  context.currentTime = 4;
  assert.equal(source.cancelTransition(), false, 'committed audio cannot be retrospectively unmixed');
  assert.equal(source.endFrame, 5 * rate);
  source.release();
});

test('prepared derivatives keep original identity and demand valid provenance and mapped entry', async () => {
  const context = new MixContext(), clock = new WebAudioClock(context.audio), original = recording();
  const derived = {...original, buffer: bufferDouble(rate, original.buffer.length + rate, asset.file.channels),
    processed: {sourceFrames: original.buffer.length, outputFrames: original.buffer.length + rate, algorithm: 'test@1'}};
  const source = new RecordedSource(context.audio, derived, context.destination, {allowFixtures: true});
  await source.prepare(clock);
  assert.deepEqual(source.reference, {id: asset.id, revision: asset.revision});
  assert.throws(() => source.scheduleStart({at: clock.stamp(rate), entryCueId: 'entry'}), /mapped mix entry/);
  assert.throws(() => source.getValidExits(), /mapped mix offsets/);
  source.scheduleMixStart(clock.stamp(rate), 0, shape().incoming);
  assert.equal(source.endFrame, rate + derived.buffer.length);
  source.release();
  for (const processed of [{...derived.processed, sourceFrames: 1}, {...derived.processed, outputFrames: 1},
    {...derived.processed, algorithm: ''}]) {
    await assert.rejects(new RecordedSource(context.audio, {...derived, processed}, context.destination,
      {allowFixtures: true}).prepare(clock), /original\/rendered frames/);
  }
});

test('mix start/exit rejects stale generations before audio effects', async () => {
  const context = new MixContext(), clock = new WebAudioClock(context.audio);
  const source = new RecordedSource(context.audio, recording(), context.destination, {allowFixtures: true});
  await source.prepare(clock); const stamp = clock.stamp(rate); clock.invalidate();
  assert.throws(() => source.scheduleMixStart(stamp, 0, shape().incoming), /Stale/);
  assert.equal(context.filters.length, 0); assert.equal(context.sources[0]!.starts.length, 0);
  source.release();
});
