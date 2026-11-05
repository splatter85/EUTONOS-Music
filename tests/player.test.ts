import assert from 'node:assert/strict';
import test from 'node:test';
import {SmallPlayer} from '../src/player.js';
import {ContextDouble, deferred, fixturePack, outputValue} from './audio-double.js';

const loaded = await fixturePack();
const a = loaded.pack.assets[0]!.id;
const b = loaded.pack.assets[1]!.id;
const route = loaded.pack.routes[0]!.id;
const setup = () => {
  const context = new ContextDouble();
  const player = new SmallPlayer(context.audio, loaded, route);
  return {context, player};
};

test('Now/Next follows the audio clock through scheduled, mixing and complete playback', async () => {
  const {context, player} = setup();
  assert.equal(player.snapshot().state, 'idle');
  const play = player.play('a');
  assert.equal(context.resumeCalls, 1, 'resume is requested synchronously from the Play action');
  assert.equal(player.snapshot().state, 'loading');
  assert.equal(player.snapshot().requested, a);
  assert.deepEqual(player.snapshot().now, [], 'accepted intent is not a started voice');
  await play;
  const start = context.sources[0]!.starts[0]!.when;
  assert.equal(start, 0.1);
  assert.equal(player.snapshot().state, 'scheduled');
  assert.equal(player.snapshot().next, a);
  context.advance(start + 1);
  assert.equal(player.snapshot().state, 'playing');
  assert.deepEqual(player.snapshot().now, [a]);
  assert.equal(player.snapshot().next, null);
  await player.scheduleAB();
  assert.deepEqual(context.sources[1]!.starts, [{when: 8.1, offset: 0}]);
  assert.deepEqual(context.sources[0]!.stops, [12.1]);
  assert.deepEqual(context.gains[1]!.gain.calls.slice(-2), [
    {kind: 'set', value: 1, time: 8.1}, {kind: 'ramp', value: 0, time: 12.1},
  ]);
  assert.deepEqual(context.gains[2]!.gain.calls, [
    {kind: 'set', value: 0, time: 8.1}, {kind: 'ramp', value: 1, time: 12.1},
  ]);
  assert.equal(player.snapshot().next, b);
  assert.equal(player.snapshot().transition, 'scheduled');
  assert.ok(Math.abs(player.snapshot().transitionInSeconds! - 7) <= 1 / context.sampleRate + 1e-12,
    'countdown may round up the current output frame by at most one sample');
  assert.equal(player.snapshot().durationSeconds, 24);
  context.currentTime = 8.1;
  assert.deepEqual(player.snapshot().now, [a, b]);
  assert.equal(player.snapshot().next, null);
  assert.equal(player.snapshot().transition, 'mixing');
  context.currentTime = 12.1;
  assert.deepEqual(player.snapshot().now, [b]);
  assert.equal(player.snapshot().transition, 'complete');
  context.currentTime = 24.1;
  assert.deepEqual(player.snapshot().now, []);
  assert.equal(player.snapshot().state, 'ended');
  assert.equal(player.snapshot().elapsedSeconds, 24);
  assert.equal(outputValue(context), 0);
  await player.dispose();
});

test('Pause freezes the context while keeping the pending handoff and Resume preserves its schedule', async () => {
  const {context, player} = setup();
  await player.play('a');
  await player.scheduleAB();
  context.advance(2.1);
  const before = player.snapshot();
  const scheduledTimes = context.sources.map(source => source.starts[0]!.when);
  await player.pause();
  assert.equal(player.snapshot().state, 'paused');
  assert.equal(context.state, 'suspended');
  assert.equal(outputValue(context), 0, 'Pause silences immediately, not at the next musical cue');
  context.advance(90);
  assert.equal(player.snapshot().currentFrame, before.currentFrame);
  assert.equal(player.snapshot().elapsedSeconds, before.elapsedSeconds);
  assert.equal(player.snapshot().next, b);
  await player.resume();
  assert.equal(context.state, 'running');
  assert.equal(player.snapshot().state, 'playing');
  assert.equal(context.sources.length, 2, 'Resume does not restart one-shot sources');
  assert.deepEqual(context.sources.map(source => source.starts[0]!.when), scheduledTimes);
  assert.equal(outputValue(context), 0.65);
  context.advance(6);
  assert.equal(player.snapshot().transition, 'mixing');
  assert.deepEqual(player.snapshot().now, [a, b]);
  await player.dispose();
});

test('denied ownership during Resume keeps an existing paused voice silent and freezes its clock', async () => {
  const {context, player} = setup();
  await player.play('a');
  context.advance(2);
  await player.pause();
  const paused = player.snapshot();
  await assert.rejects(player.resume(Promise.reject(new Error('ownership unavailable'))), /ownership unavailable/);
  assert.equal(player.snapshot().state, 'paused');
  assert.equal(outputValue(context), 0);
  assert.equal(context.state, 'suspended', 'failed ownership must suspend, not merely mute, the resumed context');
  context.advance(60);
  assert.equal(player.snapshot().currentFrame, paused.currentFrame);
  assert.equal(player.snapshot().elapsedSeconds, paused.elapsedSeconds);
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0]!.starts.length, 1);
  await player.dispose();
});

test('Stop or Pause during a pending decode cannot be undone by its eventual completion', async () => {
  for (const action of ['stop', 'pause'] as const) {
    const {context, player} = setup();
    context.decodeGate = deferred();
    const playing = player.play('a');
    assert.equal(context.decodedInputBytes.length, 1);
    assert.equal(player.snapshot().state, 'loading');
    if (action === 'stop') player.stop();
    else await player.pause();
    context.decodeGate.release();
    await playing;
    assert.equal(context.sources.length, 0, `${action}: obsolete decode must not schedule any source`);
    assert.equal(context.state, 'suspended');
    assert.equal(outputValue(context), 0);
    assert.equal(player.snapshot().state, action === 'stop' ? 'idle' : 'paused');
    assert.equal(player.snapshot().requested, action === 'stop' ? null : a);
    assert.ok(loaded.files.get(loaded.pack.assets[0]!.file.path)!.byteLength > 0,
      'decoder detachment must not consume the verified file cache');
    // A new explicit action is allowed after cancellation.
    context.decodeGate = null;
    if (action === 'stop') await player.play('b');
    else await player.resume();
    assert.equal(context.sources.length, 1);
    assert.equal(player.snapshot().next, action === 'stop' ? b : a);
    await player.dispose();
  }
});

test('Stop or a second Pause during pending Resume keeps output silent when Resume resolves late', async () => {
  for (const action of ['stop', 'pause'] as const) {
    const {context, player} = setup();
    await player.play('a');
    context.advance(1);
    await player.pause();
    context.resumeGate = deferred();
    const resuming = player.resume();
    assert.equal(player.snapshot().state, 'loading');
    if (action === 'stop') player.stop();
    else await player.pause();
    context.resumeGate.release();
    await resuming;
    assert.equal(player.snapshot().state, action === 'stop' ? 'idle' : 'paused');
    assert.equal(context.state, 'suspended', 'late running state is suspended again without a new user action');
    assert.equal(outputValue(context), 0);
    assert.equal(context.sources.length, 1, 'the old source was not started a second time');
    if (action === 'stop') assert.equal(context.sources[0]!.connections.length, 0);
    context.resumeGate = null;
    await player.dispose();
  }
});

test('replacing playback cancels both voices and their queued handoff before starting the requested track', async () => {
  const {context, player} = setup();
  await player.play('a');
  await player.scheduleAB();
  context.advance(1);
  const generation = player.snapshot().engineGeneration;
  const replacement = player.play('b');
  assert.equal(player.snapshot().state, 'loading');
  assert.equal(player.snapshot().requested, b);
  assert.deepEqual(player.snapshot().now, []);
  assert.equal(player.snapshot().next, null);
  assert.notEqual(player.snapshot().engineGeneration, generation);
  for (const old of context.sources.slice(0, 2)) {
    assert.equal(old.stops.at(-1), 1, 'both outgoing and future incoming voices cancel immediately');
    assert.equal(old.connections.length, 0);
    assert.equal(old.onended, null);
  }
  await replacement;
  assert.equal(context.sources.length, 3);
  assert.equal(player.snapshot().transition, 'none');
  assert.equal(player.snapshot().next, b);
  assert.equal(context.sources[2]!.starts.length, 1);
  await player.dispose();
});

test('concurrent A to B requests commit only one incoming voice and repeated scheduling is rejected', async () => {
  const {context, player} = setup();
  await player.play('a');
  const results = await Promise.allSettled([player.scheduleAB(), player.scheduleAB()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const failed = results.find(r => r.status === 'rejected');
  assert.ok(failed?.status === 'rejected');
  assert.match(String(failed.reason), /already scheduled/);
  assert.equal(context.sources.filter(source => source.starts.length > 0).length, 2);
  for (const abandoned of context.sources.filter(source => source.starts.length === 0)) {
    assert.equal(abandoned.connections.length, 0);
  }
  assert.deepEqual(context.sources[0]!.stops, [12.1], 'A receives one transition stop');
  await assert.rejects(player.scheduleAB(), /Only one/);
  context.advance(1);
  assert.equal(player.snapshot().next, b);
  await player.dispose();
});

test('future handoff cancellation restores A, cancels preparation, and refuses an overlap already started', async () => {
  const {context, player} = setup();
  const playing = player.play('a');
  player.cancelTransitionPreparation();
  assert.equal(player.cancelPendingTransition(), true);
  await playing;
  assert.equal(context.sources.length, 1, 'transition cancellation does not cancel initial Play');
  const original = player.snapshot().voices[0]!;
  const preparing = player.scheduleAB();
  player.cancelTransitionPreparation();
  await preparing;
  assert.equal(context.sources.length, 1, 'cancelled preparation cannot start B');
  await player.scheduleAB();
  player.cancelTransitionPreparation();
  assert.equal(player.snapshot().voices.length, 2, 'preparation-only cancellation retains committed audio');
  context.advance(1);
  assert.equal(player.cancelPendingTransition(), true);
  const cancelled = player.snapshot();
  assert.deepEqual(cancelled.voices, [original], 'A retains its original source, clock stamp and natural finish');
  assert.equal(cancelled.transitionAt, null);
  assert.equal(cancelled.transitionEnd, null);
  assert.equal(cancelled.transition, 'none');
  assert.deepEqual(cancelled.now, [a]);
  assert.deepEqual(context.sources[0]!.stops, [12.1, 16.1]);
  assert.deepEqual(context.gains[1]!.gain.calls.at(-1), {kind: 'cancel', time: 8.1});
  assert.deepEqual(context.sources[1]!.stops, [1]);
  assert.equal(context.sources[1]!.connections.length, 0);
  await player.scheduleAB();
  const scheduled = player.snapshot();
  assert.equal(scheduled.voices.length, 2);
  assert.deepEqual(scheduled.voices[1]!.source, {id: b, revision: loaded.pack.assets[1]!.revision});
  assert.equal(scheduled.transitionAt!.frame, 388_800);
  assert.equal(scheduled.transitionEnd!.frame, 580_800);
  assert.deepEqual(context.sources[0]!.stops, [12.1, 16.1, 12.1]);
  context.currentTime = 8.1;
  const stops = context.sources.map(source => [...source.stops]);
  const gains = context.gains.map(gain => [...gain.gain.calls]);
  assert.equal(player.cancelPendingTransition(), false, 'the audio clock refuses cancellation before any snapshot refresh');
  assert.deepEqual(context.sources.map(source => source.stops), stops);
  assert.deepEqual(context.gains.map(gain => gain.gain.calls), gains);
  assert.deepEqual(player.snapshot().now, [a, b]);
  await player.dispose();
});

test('a missed exit leaves A unchanged while Mute and Volume remain immediate listener controls', async () => {
  const {context, player} = setup();
  await player.play('a');
  context.advance(8.2);
  await assert.rejects(player.scheduleAB(), /Restart A/);
  assert.equal(context.sources.length, 1);
  assert.deepEqual(context.sources[0]!.stops, []);
  assert.deepEqual(player.snapshot().now, [a]);
  assert.equal(player.snapshot().transition, 'none');
  assert.deepEqual(context.gains[1]!.gain.calls, [{kind: 'set', value: 1, time: 0.1}]);
  player.setMuted(true);
  assert.equal(outputValue(context), 0);
  assert.equal(player.snapshot().state, 'playing');
  player.setVolume(0.3);
  assert.equal(outputValue(context), 0, 'changing volume must not unmute');
  player.setMuted(false);
  assert.equal(outputValue(context), 0.3);
  for (const invalid of [NaN, -0.1, 1.1]) assert.throws(() => player.setVolume(invalid), /between 0 and 1/);
  assert.equal(player.snapshot().volume, 0.3);
  player.stop();
  player.setVolume(1);
  player.setMuted(false);
  assert.equal(outputValue(context), 0, 'level controls cannot restart stopped output');
  await player.dispose();
});

test('unexpected context suspension requires an explicit Resume and cannot automatically restart output', async () => {
  const {context, player} = setup();
  await player.play('a');
  await player.scheduleAB();
  context.advance(2);
  const generation = player.snapshot().engineGeneration;
  context.setState('suspended');
  assert.equal(player.snapshot().state, 'paused');
  assert.equal(outputValue(context), 0);
  context.setState('running');
  assert.equal(context.state, 'suspended');
  assert.equal(player.snapshot().state, 'paused');
  assert.equal(outputValue(context), 0);
  await player.resume();
  assert.equal(player.snapshot().state, 'playing');
  assert.equal(player.snapshot().engineGeneration, generation);
  assert.equal(context.sources.length, 2);
  assert.equal(player.snapshot().next, b);
  await player.dispose();
  assert.equal(player.snapshot().state, 'closed');
  await assert.rejects(player.play('a'), /closed/);
});

test('failed decoding stops cleanly and a later explicit Play can retry preparation', async () => {
  const {context, player} = setup();
  context.decodeGate = deferred();
  const playing = player.play('a');
  const rejected = assert.rejects(playing, /decoder unavailable/);
  context.decodeGate.reject(new Error('decoder unavailable'));
  await rejected;
  assert.equal(player.snapshot().state, 'idle');
  assert.equal(context.sources.length, 0);
  assert.equal(outputValue(context), 0);
  context.decodeGate = null;
  await player.play('a');
  assert.equal(context.sources.length, 1);
  assert.equal(player.snapshot().next, a);
  await player.dispose();
});
