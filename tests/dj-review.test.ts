import assert from 'node:assert/strict';
import test from 'node:test';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import {DeterministicDj} from '../src/dj.js';
import {SmallPlayer} from '../src/player.js';
import {ContextDouble, deferred, fixturePack} from './audio-double.js';

const A = 's01-recording-a', B = 's01-recording-b';
type Intent = ControlRequest extends infer R ? R extends ControlRequest
  ? Omit<R, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'source'> : never : never;

async function setup() {
  const loaded = await fixturePack();
  const context = new ContextDouble();
  const player = new SmallPlayer(context.audio, loaded, 's01-a-to-b');
  const dj = new DeterministicDj(player, loaded);
  let counter = 0;
  const request = (intent: Intent, id = `review-${++counter}`): ControlRequest => ({
    schemaVersion: CONTROL_VERSION, commandId: id,
    expectedRevision: dj.snapshot().control.revision, source: 'manual', ...intent,
  });
  const send = (intent: Intent, id?: string) => dj.request(request(intent, id));
  const start = async () => {
    await send({type: 'transport', action: 'play'});
    context.advance(0.2);
    dj.snapshot();
  };
  return {context, player, dj, request, send, start};
}

/** Delay promise observation after the real renderer has committed native events. */
function delayCompletion<Args extends unknown[]>(operation: (...args: Args) => Promise<void>) {
  const committed = deferred(), completion = deferred();
  return {
    committed: committed.promise,
    release: completion.release,
    operation: async (...args: Args): Promise<void> => {
      await operation(...args);
      committed.release();
      await completion.promise;
    },
  };
}

test('DJ adopts a native transition whose entry crossed before its promise was observed', async () => {
  const {context, player, dj, send, start} = await setup();
  await start();
  const delayed = delayCompletion(player.scheduleAB.bind(player));
  player.scheduleAB = delayed.operation;
  const pending = send({type: 'queueTrack', trackId: B}, 'delayed-entry-b');
  try {
    await delayed.committed;
    context.advance(8);
    const state = dj.snapshot();
    assert.equal(state.control.queue.length, 0);
    assert.equal(state.pending?.phase, 'started');
    assert.deepEqual(state.control.audible?.sources?.map(source => source.id), [A, B]);
    assert.equal(state.control.audible?.state, 'explore');
    assert.equal(dj.operation('delayed-entry-b')?.execution.status, 'started');
    delayed.release();
    assert.equal((await pending).execution.status, 'started');
    context.advance(4);
    assert.equal(dj.operation('delayed-entry-b')?.execution.status, 'completed');
    assert.equal(dj.snapshot().control.audible?.source?.id, B);
  } finally {
    delayed.release();
    await pending;
    await dj.dispose();
  }
});

test('future native transitions remain cancellable before delayed promise observation', async () => {
  for (const removeEntry of [false, true]) {
    const {context, player, dj, send, start} = await setup();
    await start();
    const delayed = delayCompletion(player.scheduleAB.bind(player));
    player.scheduleAB = delayed.operation;
    const pending = send({type: 'queueTrack', trackId: B}, 'delayed-cancel-b');
    try {
      await delayed.committed;
      const cancelled = await send(removeEntry
        ? {type: 'cancelQueue', queueCommandId: 'delayed-cancel-b'} : {type: 'cancelNext'});
      assert.equal(cancelled.execution.status, 'applied');
      assert.equal(dj.snapshot().pending, null);
      assert.equal(dj.snapshot().player.transition, 'none');
      assert.equal(dj.snapshot().control.queue.length, removeEntry ? 0 : 1);
      assert.equal(context.sources[1]!.connections.length, 0);
      delayed.release();
      assert.equal((await pending).execution.status, 'cancelled');
      context.advance(8);
      assert.deepEqual(dj.snapshot().player.now, [A]);
      assert.equal(dj.snapshot().pending, null, 'late promise settlement cannot resurrect B');
    } finally {
      delayed.release();
      await pending;
      await dj.dispose();
    }
  }
});

test('new targets cannot supersede the receipt of a native handoff already mixing', async () => {
  const {context, player, dj, send, start} = await setup();
  await start();
  const delayed = delayCompletion(player.scheduleAB.bind(player));
  player.scheduleAB = delayed.operation;
  const pending = send({type: 'queueTrack', trackId: B}, 'delayed-mixing-b');
  try {
    await delayed.committed;
    context.advance(8);
    const target = await send({type: 'setState', state: 'surge'});
    assert.equal(target.execution.status, 'blocked');
    assert.equal(dj.operation('delayed-mixing-b')?.execution.status, 'started');
    assert.equal(dj.snapshot().control.requested.state, 'surge');
    assert.equal(dj.snapshot().control.audible?.state, 'explore');
    delayed.release();
    assert.equal((await pending).execution.status, 'started');
    context.advance(4);
    assert.equal(dj.operation('delayed-mixing-b')?.execution.status, 'completed');
    assert.equal(context.sources.length, 2);
  } finally {
    delayed.release();
    await pending;
    await dj.dispose();
  }
});

test('Stop consumes a native initial entry before its Play promise is observed', async () => {
  const {context, player, dj, send, request} = await setup();
  await send({type: 'queueTrack', trackId: B}, 'delayed-start-b');
  const delayed = delayCompletion(player.play.bind(player));
  player.play = delayed.operation;
  const play = request({type: 'transport', action: 'play'}, 'delayed-start-play');
  const pending = dj.request(play);
  try {
    await delayed.committed;
    const beforeEntry = dj.snapshot().control.revision;
    context.advance(0.2);
    // The one known queue entry advances the revision when request() reconciles
    // its native start. No intervening snapshot observes that crossed entry.
    const stopped = await dj.request({schemaVersion: CONTROL_VERSION,
      commandId: 'delayed-start-stop', expectedRevision: beforeEntry + 1,
      source: 'manual', type: 'transport', action: 'stop'});
    assert.equal(stopped.execution.status, 'applied');
    assert.equal(dj.snapshot().control.queue.length, 0);
    assert.deepEqual(dj.snapshot().player.now, []);
    assert.equal(dj.operation('delayed-start-b')?.execution.status, 'completed');
    assert.equal(dj.operation('delayed-start-play')?.execution.status, 'completed');
    delayed.release();
    assert.equal((await pending).execution.status, 'completed');
    const sourceCount = context.sources.length;
    await dj.request(play);
    assert.equal(context.sources.length, sourceCount, 'retry cannot restart stopped audio');
  } finally {
    delayed.release();
    await pending;
    await dj.dispose();
  }
});

test('Pause preserves a committed initial voice while Play observation is delayed', async () => {
  const {context, player, dj, send} = await setup();
  await send({type: 'queueTrack', trackId: B}, 'pause-committed-b');
  const delayed = delayCompletion(player.play.bind(player));
  player.play = delayed.operation;
  const pending = send({type: 'transport', action: 'play'}, 'pause-committed-play');
  try {
    await delayed.committed;
    await send({type: 'transport', action: 'pause'});
    assert.equal(dj.operation('pause-committed-play')?.execution.status, 'scheduled');
    assert.equal(dj.snapshot().player.state, 'paused');
    assert.equal(dj.snapshot().control.queue.length, 1);
    delayed.release();
    assert.equal((await pending).execution.status, 'scheduled');
    await send({type: 'transport', action: 'play'});
    context.advance(0.2);
    assert.equal(dj.snapshot().control.queue.length, 0);
    assert.equal(dj.snapshot().control.audible?.source?.id, B);
    assert.equal(dj.snapshot().control.audible?.state, 'explore');
    assert.equal(context.sources.length, 1);
  } finally {
    delayed.release();
    await pending;
    await dj.dispose();
  }
});

test('Cancel next cannot stop an already started source because its Play promise is delayed', async () => {
  const {context, player, dj, send} = await setup();
  await send({type: 'queueTrack', trackId: A}, 'already-started-a');
  const delayed = delayCompletion(player.play.bind(player));
  player.play = delayed.operation;
  const pending = send({type: 'transport', action: 'play'}, 'already-started-play');
  try {
    await delayed.committed;
    context.advance(0.2);
    const result = await send({type: 'cancelNext'});
    assert.equal(result.execution.status, 'applied');
    assert.deepEqual(dj.snapshot().player.now, [A]);
    assert.equal(dj.snapshot().control.queue.length, 0);
    assert.equal(dj.operation('already-started-play')?.execution.status, 'completed');
    delayed.release();
    assert.equal((await pending).execution.status, 'completed');
  } finally {
    delayed.release();
    await pending;
    await dj.dispose();
  }
});

test('concurrent exact retry shares the in-flight initial effect during decode', async () => {
  const {context, dj, request} = await setup();
  const gate = deferred();
  context.decodeGate = gate;
  const play = request({type: 'transport', action: 'play'}, 'concurrent-play');
  const pending = dj.request(play);
  try {
    const replay = await dj.request(play);
    assert.equal(replay.receipt.status, 'accepted');
    assert.equal(replay.execution.status, 'pending');
    assert.equal(context.resumeCalls, 1);
    gate.release();
    const result = await pending;
    assert.deepEqual(replay.receipt, result.receipt);
    assert.equal(context.sources.length, 1);
    context.advance(0.2);
    assert.equal((await dj.request(play)).execution.status, 'completed');
    assert.equal(context.sources.length, 1);
  } finally {
    gate.release();
    await pending;
    await dj.dispose();
  }
});
