import assert from 'node:assert/strict';
import test from 'node:test';
import {validatePackManifest} from '../src/pack.js';
import type {AudioAsset, AudioPack} from '../src/pack-types.js';
import {checkedRoute, cueFrame, planTransition, RecordedSource, WebAudioClock} from '../src/web-audio.js';
import {bufferDouble, ContextDouble, fixturePack} from './audio-double.js';

const {pack} = await fixturePack();
const a = pack.assets[0]!;
const routeId = pack.routes[0]!.id;
const recording = (asset: AudioAsset, rate: number) => ({asset,
  buffer: bufferDouble(rate, Math.round(asset.file.frames * rate / asset.file.sample_rate), asset.file.channels)});

/** Metadata-only fixture for checking pickup and selected-entry units. */
function offsetPack(): AudioPack {
  const shifted: AudioAsset = {...a, file: {...a.file, frames: a.file.frames + 7, bytes: a.file.bytes + 14},
    timing: {...a.timing!, first_downbeat_frame: 7, phrase_bars: 2},
    cues: [...a.cues, {id: 'middle-entry', kind: 'entry', position_quarters: 8}]};
  return validatePackManifest({...pack, assets: [shifted, ...pack.assets.slice(1)]});
}

test('Web Audio clock reads the owner context and invalidates old generations', () => {
  const context = new ContextDouble(44_100);
  const clock = new WebAudioClock(context.audio);
  context.currentTime = 0.00001;
  assert.equal(clock.currentFrame, 1, 'future scheduling rounds up fractional output frames');
  context.currentTime = 2;
  assert.equal(clock.currentFrame, 88_200);
  const old = clock.stamp(90_000);
  clock.invalidate();
  assert.notEqual(clock.engineGeneration, old.engineGeneration);
  assert.equal(clock.sampleRate, 44_100);
  assert.equal(clock.context, context.audio);
});

test('cue mapping converts native 24 kHz pickups and subtracts a nonzero selected entry', async () => {
  const shifted = offsetPack();
  const asset = shifted.assets[0]!;
  for (const rate of [44_100, 48_000]) {
    const context = new ContextDouble(rate);
    const clock = new WebAudioClock(context.audio);
    const pickup = rate === 44_100 ? 13 : 14; // Seven native frames on the output clock.
    assert.equal(cueFrame(asset, 'middle-entry', 'entry', rate), 4 * rate + pickup);
    assert.equal(cueFrame(asset, 'exit', 'exit', rate), 8 * rate + pickup);
    const start = {at: clock.stamp(rate), entryCueId: 'middle-entry'};
    const plan = planTransition(shifted, routeId, start, clock, true);
    assert.equal(plan.at.frame, 5 * rate, 'exit is four seconds after this selected entry');
    assert.equal(plan.overlapFrames, 4 * rate);
    assert.equal(plan.end.frame, 9 * rate);
    const source = new RecordedSource(context.audio, recording(asset, rate), context.destination,
      {allowFixtures: true, fadeOutFrames: plan.overlapFrames});
    await source.prepare(clock);
    assert.deepEqual(source.getValidExits(), [
      {cueId: 'exit', offsetFrames: 8 * rate + pickup},
      {cueId: 'end', offsetFrames: 16 * rate + pickup},
    ]);
    source.scheduleStart(start);
    assert.deepEqual(context.sources[0]!.starts, [{when: 1, offset: (4 * rate + pickup) / rate}]);
    source.transitionOut('exit', plan.at);
    assert.deepEqual(context.sources[0]!.stops, [9]);
    assert.equal(source.endFrame, 9 * rate);
    source.release();
  }
});

test('directed routes reject missing permission, stale revisions and late or stale plans', () => {
  const context = new ContextDouble();
  const clock = new WebAudioClock(context.audio);
  const start = {at: clock.stamp(4_800), entryCueId: 'entry'};
  assert.throws(() => checkedRoute(pack, routeId), /explicit fixture mode/);
  assert.throws(() => checkedRoute(pack, 'b-to-a', true), /No directed route/);
  const unavailable = {...pack, assets: [{...a, eligibility: 'unreviewed'}, ...pack.assets.slice(1)]} as AudioPack;
  assert.throws(() => checkedRoute(unavailable, routeId, true), /eligible review status/);
  const denied = {...pack, assets: [{...a, rights: {...a.rights, allowed_uses: []}}, ...pack.assets.slice(1)]};
  assert.throws(() => checkedRoute(denied, routeId, true), /playback permission/);
  const staleReference = {...pack, routes: [{...pack.routes[0]!, to: {...pack.routes[0]!.to, revision: 2}}]};
  assert.throws(() => checkedRoute(staleReference, routeId, true), /MISSING_REFERENCE/);
  context.currentTime = 8.05;
  assert.throws(() => planTransition(pack, routeId, start, clock, true, 4_800), /exit cue has passed or is too close/);
  context.currentTime = 8.2;
  assert.throws(() => planTransition(pack, routeId, start, clock, true), /exit cue has passed/);
  clock.invalidate();
  assert.throws(() => planTransition(pack, routeId, start, clock, true), /Stale engine generation/);
});

test('recording lifecycle schedules source and complementary fades on the same absolute clock', async () => {
  const context = new ContextDouble();
  const clock = new WebAudioClock(context.audio);
  const source = new RecordedSource(context.audio, recording(a, 48_000), context.destination,
    {allowFixtures: true, fadeInFrames: 48_000, fadeOutFrames: 192_000});
  assert.throws(() => source.scheduleStart({at: clock.stamp(4_800), entryCueId: 'entry'}), /Prepare before start/);
  await source.prepare(clock);
  await assert.rejects(source.prepare(clock), /once/);
  source.scheduleStart({at: clock.stamp(4_800), entryCueId: 'entry'});
  assert.deepEqual(context.sources[0]!.starts, [{when: 0.1, offset: 0}]);
  assert.deepEqual(context.gains[0]!.gain.calls, [
    {kind: 'set', value: 0, time: 0.1},
    {kind: 'ramp', value: 1, time: 1.1},
  ]);
  assert.throws(() => source.scheduleStart({at: clock.stamp(9_600), entryCueId: 'entry'}), /once/);
  assert.throws(() => source.transitionOut('exit', clock.stamp(388_799)), /align/);
  assert.equal(context.sources[0]!.stops.length, 0, 'invalid exit cannot partially stop A');
  source.transitionOut('exit', clock.stamp(388_800));
  assert.deepEqual(context.gains[0]!.gain.calls.slice(-2), [
    {kind: 'set', value: 1, time: 8.1},
    {kind: 'ramp', value: 0, time: 12.1},
  ]);
  assert.deepEqual(context.sources[0]!.stops, [12.1]);
  assert.throws(() => source.transitionOut('exit', clock.stamp(388_800)), /once/);
  context.sources[0]!.finish();
  assert.equal(context.sources[0]!.connections.length, 0);
  assert.equal(context.gains[0]!.connections.length, 0);
  source.release();
});

test('release cancels a future start after generation invalidation and is idempotent', async () => {
  const context = new ContextDouble();
  const clock = new WebAudioClock(context.audio);
  const source = new RecordedSource(context.audio, recording(a, 48_000), context.destination, {allowFixtures: true});
  await source.prepare(clock);
  source.scheduleStart({at: clock.stamp(48_000), entryCueId: 'entry'});
  clock.invalidate();
  assert.throws(() => source.getValidExits(), /Stale/);
  source.release();
  source.release();
  assert.deepEqual(context.sources[0]!.stops, [0], 'cancel before the future start, not at its cue');
  assert.equal(context.sources[0]!.onended, null);
  assert.equal(context.sources[0]!.disconnectCalls, 1);
  assert.equal(context.gains[0]!.disconnectCalls, 1);
  assert.throws(() => source.scheduleStart({at: clock.stamp(48_000), entryCueId: 'entry'}), /Prepare before start/);
});

test('cancelling a future source exit restores its original finish and coincident fade-in endpoint', async () => {
  const asset = offsetPack().assets[0]!;
  const context = new ContextDouble();
  const clock = new WebAudioClock(context.audio);
  const source = new RecordedSource(context.audio, recording(asset, 48_000), context.destination,
    {allowFixtures: true, fadeInFrames: 192_000, fadeOutFrames: 192_000});
  await source.prepare(clock);
  source.scheduleStart({at: clock.stamp(48_000), entryCueId: 'middle-entry'});
  const originalEnd = source.endFrame;
  assert.equal(originalEnd, 624_000, 'natural EOF accounts for the nonzero entry and native pickup');
  source.transitionOut('exit', clock.stamp(240_000));
  context.currentTime = 2;
  assert.equal(source.cancelTransition(), true);
  assert.equal(source.endFrame, originalEnd);
  assert.deepEqual(context.sources[0]!.stops, [9, 13]);
  assert.deepEqual(context.gains[0]!.gain.calls.slice(-2), [
    {kind: 'cancel', time: 5}, {kind: 'ramp', value: 1, time: 5},
  ], 'the original fade-in endpoint at the exit timestamp is restored after cancelling automation');
  assert.equal(source.cancelTransition(), true, 'repeated cancellation is harmless');
  assert.deepEqual(context.sources[0]!.stops, [9, 13]);
  source.transitionOut('exit', clock.stamp(240_000));
  context.currentTime = 5;
  const calls = [...context.gains[0]!.gain.calls];
  assert.equal(source.cancelTransition(), false);
  assert.equal(source.endFrame, 432_000);
  assert.deepEqual(context.sources[0]!.stops, [9, 13, 9]);
  assert.deepEqual(context.gains[0]!.gain.calls, calls, 'an exit that has begun cannot change its automation');
  source.release();
});

test('recordings reject another context, ineligible media, wrong decoded format and obsolete starts', async () => {
  const context = new ContextDouble();
  const other = new ContextDouble();
  const clock = new WebAudioClock(context.audio);
  const create = () => new RecordedSource(context.audio, recording(a, 48_000), context.destination, {allowFixtures: true});
  await assert.rejects(create().prepare(new WebAudioClock(other.audio)), /owner context and clock/);
  await assert.rejects(new RecordedSource(context.audio, recording(a, 48_000), other.destination,
    {allowFixtures: true}).prepare(clock), /another context/);
  await assert.rejects(new RecordedSource(context.audio, recording(a, 48_000), context.destination).prepare(clock), /not eligible/);
  await assert.rejects(new RecordedSource(context.audio, {...recording(a, 48_000),
    buffer: bufferDouble(44_100, 705_600)}, context.destination, {allowFixtures: true}).prepare(clock), /Decoded buffer/);
  assert.equal(context.sources.length, 0, 'rejected preparation cannot allocate a source');
  const source = create();
  await source.prepare(clock);
  context.currentTime = 0.2;
  assert.throws(() => source.scheduleStart({at: clock.stamp(4_800), entryCueId: 'entry'}), /future audio-clock/);
  const oldStart = {at: clock.stamp(48_000), entryCueId: 'entry'};
  clock.invalidate();
  assert.throws(() => source.scheduleStart(oldStart), /Stale/);
  assert.equal(context.sources[0]!.starts.length, 0);
  source.release();
});
