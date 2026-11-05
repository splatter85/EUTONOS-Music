import assert from 'node:assert/strict';
import test from 'node:test';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import {DeterministicDj} from '../src/dj.js';
import {SmallPlayer} from '../src/player.js';
import {ContextDouble, deferred, fixturePack, outputValue} from './audio-double.js';

const A = 's01-recording-a', B = 's01-recording-b';
type Intent = ControlRequest extends infer R ? R extends ControlRequest
  ? Omit<R, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'source'> : never : never;
async function setup() {
  const loaded = await fixturePack();
  const context = new ContextDouble();
  const player = new SmallPlayer(context.audio, loaded, 's01-a-to-b');
  const dj = new DeterministicDj(player, loaded);
  let counter = 0;
  const request = (intent: Intent, id = `command-${++counter}`, source: 'manual' | 'automation' = 'manual'): ControlRequest => ({
    schemaVersion: CONTROL_VERSION, commandId: id, expectedRevision: dj.snapshot().control.revision, source, ...intent,
  });
  const send = (intent: Intent, id?: string, source?: 'manual' | 'automation') => dj.request(request(intent, id, source));
  const start = async () => { await send({type: 'transport', action: 'play'}); context.advance(0.2); dj.snapshot(); };
  return {loaded, context, player, dj, request, send, start};
}

test('stopped DJ selects deterministically but target/queue/Next do not start audio', async () => {
  const {dj, context, send} = await setup();
  assert.equal(dj.snapshot().control.requested.state, 'explore');
  assert.equal(dj.snapshot().control.audible?.source, null);
  assert.equal((await send({type: 'requestGenre', genreId: 'synthetic-test'})).execution.status, 'queued');
  assert.equal((await send({type: 'nextSong'})).execution.trackId, A);
  assert.equal(context.sources.length, 0);
  assert.equal(dj.snapshot().control.planned, null, 'a choice without preparation is not a plan');
  await send({type: 'transport', action: 'play'});
  assert.equal(context.sources.length, 1);
  assert.equal(dj.snapshot().control.audible?.source, null, 'scheduled is not started');
  context.advance(0.2);
  assert.equal(dj.snapshot().control.audible?.source?.id, A);
  await dj.dispose();
});

test('receipt replay also deduplicates audio effects, queue edits and failures across generations', async () => {
  const {dj, context, request, send} = await setup();
  const queue = request({type: 'queueTrack', trackId: B}, 'queue-b');
  const queued = await dj.request(queue);
  assert.deepEqual((await dj.request(queue)).receipt, queued.receipt);
  assert.equal(dj.snapshot().control.queue.length, 1);
  const play = request({type: 'transport', action: 'play'}, 'play-b');
  const started = await dj.request(play);
  await dj.request(play);
  assert.equal(context.sources.length, 1);
  context.advance(0.2);
  assert.equal(dj.snapshot().control.queue.length, 0);
  await send({type: 'transport', action: 'stop'});
  const generation = dj.snapshot().control.engineGeneration;
  const replay = await dj.request(play);
  assert.deepEqual(replay.receipt, started.receipt);
  assert.equal(context.sources.length, 1, 'old accepted Play cannot start a new generation');
  assert.equal(dj.snapshot().control.engineGeneration, generation);
  assert.equal((await dj.request({...play, type: 'transport', action: 'mute'})).execution.reason, 'id-conflict');
  const rejected = await dj.request({...play, commandId: 'new-stale'});
  assert.equal(rejected.execution.reason, 'stale-revision');
  assert.deepEqual((await dj.request({...play, commandId: 'new-stale'})).receipt, rejected.receipt);
  await dj.dispose();
});

test('state selection exposes requested, scheduled and renderer-confirmed states separately', async () => {
  const {dj, context, start, send} = await setup();
  await start();
  const result = await send({type: 'setState', state: 'drive'}, 'drive');
  assert.equal(result.execution.status, 'scheduled');
  let state = dj.snapshot();
  assert.equal(state.control.requested.state, 'drive');
  assert.equal(state.control.audible?.state, 'explore');
  assert.equal(state.control.audible?.source?.id, A);
  assert.equal(state.control.planned?.source.id, B);
  assert.equal(state.pending?.state, 'drive');
  context.advance(8);
  state = dj.snapshot();
  assert.deepEqual(state.control.audible?.sources?.map(s => s.id), [A, B]);
  assert.equal(state.control.audible?.state, 'drive');
  assert.equal(dj.operation('drive')?.execution.status, 'started');
  context.advance(4);
  assert.equal(dj.snapshot().control.audible?.source?.id, B);
  assert.equal(dj.operation('drive')?.execution.status, 'completed');
  assert.equal(dj.snapshot().control.planned, null);
  await dj.dispose();
});

test('manual FIFO blocks automatic overtaking and consumes only at renderer entry', async () => {
  const {dj, context, send, start} = await setup();
  await start();
  await send({type: 'queueTrack', trackId: A}, 'head-a');
  await send({type: 'queueTrack', trackId: B}, 'tail-b');
  const next = await send({type: 'nextSong'});
  assert.equal(next.execution.status, 'no-match');
  assert.match(next.execution.reason, /Manual queue head/);
  assert.equal(context.sources.length, 1);
  assert.deepEqual(dj.snapshot().control.queue.map(q => q.trackId), [A, B]);
  await send({type: 'cancelQueue', queueCommandId: 'head-a'});
  await send({type: 'nextSong'});
  assert.equal(dj.snapshot().control.queue[0]?.commandId, 'tail-b', 'scheduling does not consume');
  assert.equal(dj.snapshot().pending?.source.id, B);
  context.advance(8);
  assert.equal(dj.snapshot().control.queue.length, 0);
  await dj.dispose();
});

test('queue append preserves an existing manual plan and its FIFO outcome', async () => {
  const {dj, context, send, start} = await setup();
  await start();
  await send({type: 'queueTrack', trackId: B}, 'head-b');
  const at = dj.snapshot().pending!.at;
  const tail = await send({type: 'queueTrack', trackId: A}, 'tail-a');
  assert.equal(tail.execution.status, 'queued');
  assert.deepEqual(dj.snapshot().pending!.at, at);
  assert.equal(context.sources.length, 2, 'queue append must not restart B');
  context.advance(13);
  assert.deepEqual(dj.snapshot().control.queue.map(q => q.commandId), ['tail-a']);
  assert.equal(dj.operation('tail-a')?.execution.status, 'queued');
  assert.equal((await send({type: 'nextSong'})).execution.status, 'no-match', 'no invented B to A route');
  await dj.dispose();
});

test('future cancellation retains queue, restores current audio, and permits explicit rescheduling', async () => {
  const {dj, context, send, start} = await setup();
  await start();
  await send({type: 'queueTrack', trackId: B}, 'queued-b');
  const oldEnd = dj.snapshot().player.voices[0]!.endFrame;
  const cancel = await send({type: 'cancelNext'});
  assert.equal(cancel.execution.status, 'applied');
  assert.equal(dj.snapshot().pending, null);
  assert.equal(dj.snapshot().control.planned, null);
  assert.equal(dj.snapshot().control.queue.length, 1);
  assert.ok(dj.snapshot().player.voices[0]!.endFrame > oldEnd);
  assert.equal(context.sources[1]!.connections.length, 0);
  await send({type: 'nextSong'}, 'retry-next');
  assert.equal(dj.snapshot().pending?.source.id, B);
  context.advance(8);
  assert.equal(dj.snapshot().control.queue.length, 0);
  const lateCancel = await send({type: 'cancelNext'});
  assert.equal(lateCancel.execution.status, 'blocked');
  assert.deepEqual(dj.snapshot().player.now, [A, B]);
  await send({type: 'transport', action: 'stop'});
  assert.equal(outputValue(context), 0);
  assert.deepEqual(dj.snapshot().player.now, []);
  await dj.dispose();
});

test('removing a scheduled queue head cancels its native future voice and preserves tail', async () => {
  const {dj, context, start, send} = await setup();
  await start();
  await send({type: 'queueTrack', trackId: B}, 'remove-b');
  await send({type: 'queueTrack', trackId: A}, 'keep-a');
  await send({type: 'cancelQueue', queueCommandId: 'remove-b'});
  assert.equal(dj.snapshot().pending, null);
  assert.deepEqual(dj.snapshot().control.queue.map(q => q.commandId), ['keep-a']);
  assert.equal(context.sources[1]!.connections.length, 0);
  assert.equal(dj.operation('remove-b')?.execution.status, 'cancelled');
  assert.equal((await send({type: 'cancelQueue', queueCommandId: 'remove-b'})).execution.reason, 'missing-queue-entry');
  await dj.dispose();
});

test('Hold refuses both target sources, permits manual queue/Next, and release replays nothing', async () => {
  const {dj, context, send, start} = await setup();
  await start();
  await send({type: 'hold', enabled: true});
  assert.equal((await send({type: 'setState', state: 'drive'}, 'auto-drive', 'automation')).execution.reason, 'held');
  assert.equal((await send({type: 'requestGenre', genreId: null})).execution.reason, 'held');
  await send({type: 'queueTrack', trackId: B}, 'held-queue');
  await send({type: 'nextSong'});
  assert.equal(context.sources.length, 2);
  assert.equal((await send({type: 'hold', enabled: false}, 'auto-release', 'automation')).execution.reason, 'manual-only');
  await send({type: 'hold', enabled: false});
  assert.equal(dj.snapshot().control.requested.state, 'explore');
  assert.equal(dj.snapshot().pending?.state, 'explore');
  await dj.dispose();
});

test('unmet new target cancels only an automatic future plan and keeps truthful audible state', async () => {
  const {dj, context, start, send} = await setup();
  await start();
  await send({type: 'nextSong'}, 'old-next');
  assert.equal((await send({type: 'setState', state: 'surge'})).execution.status, 'no-match');
  const state = dj.snapshot();
  assert.equal(state.control.requested.state, 'surge');
  assert.equal(state.control.audible?.state, 'explore');
  assert.equal(state.pending, null);
  assert.equal(dj.operation('old-next')?.execution.status, 'superseded');
  context.advance(16);
  assert.equal(dj.snapshot().player.state, 'ended');
  assert.deepEqual(dj.snapshot().player.now, []);
  assert.equal((await send({type: 'transport', action: 'play'})).execution.status, 'no-match');
  await dj.dispose();
});

test('manual queued track retains priority over an unmet state and missing genres do not mutate intent', async () => {
  const {dj, context, start, send} = await setup();
  await start();
  await send({type: 'queueTrack', trackId: B}, 'manual-b');
  const before = dj.snapshot().pending;
  assert.equal((await send({type: 'setState', state: 'surge'})).execution.status, 'blocked');
  assert.deepEqual(dj.snapshot().pending, before);
  assert.equal((await send({type: 'requestGenre', genreId: 'missing-genre'})).execution.reason, 'missing-genre');
  assert.equal(dj.snapshot().control.requested.genreId, null);
  context.advance(8);
  assert.equal(dj.snapshot().control.audible?.state, 'explore', 'unmet requested Surge cannot relabel the scheduled source');
  await dj.dispose();
});

test('rapid targets supersede in-flight transition work; mute never undoes a valid plan', async () => {
  const {dj, context, start, send} = await setup();
  await start();
  const next = send({type: 'nextSong'}, 'racing-next');
  const surge = send({type: 'setState', state: 'surge'}, 'racing-surge');
  await Promise.all([next, surge]);
  assert.equal(dj.snapshot().pending, null);
  assert.equal(context.sources.filter(s => s.starts.length && s.connections.length).length, 1);
  const drive = send({type: 'setState', state: 'drive'}, 'fresh-drive');
  await send({type: 'transport', action: 'mute'});
  await drive;
  assert.equal(dj.snapshot().pending?.source.id, B);
  assert.equal(outputValue(context), 0);
  await send({type: 'transport', action: 'unmute'});
  assert.equal(dj.snapshot().pending?.source.id, B);
  assert.ok(outputValue(context) > 0);
  await dj.dispose();
});

test('Stop or Pause preempts pending decode and preserves unstarted queue for a fresh Play', async () => {
  for (const action of ['stop', 'pause'] as const) {
    const {dj, context, send} = await setup();
    const gate = deferred();
    context.decodeGate = gate;
    await send({type: 'queueTrack', trackId: B}, 'pending-b');
    const first = send({type: 'transport', action: 'play'}, 'old-play');
    await send({type: 'transport', action});
    gate.release();
    await first;
    assert.equal(context.sources.length, 0);
    assert.equal(dj.snapshot().control.queue.length, 1);
    assert.equal(dj.snapshot().control.planned, null);
    assert.equal(dj.operation('old-play')?.execution.status, 'cancelled');
    await send({type: 'transport', action: 'play'});
    context.advance(0.2);
    assert.deepEqual(dj.snapshot().player.now, [B]);
    assert.equal(dj.snapshot().control.queue.length, 0);
    await dj.dispose();
  }
});

test('two queued entries may reserve initial start and transition without consuming either early', async () => {
  const {dj, context, send} = await setup();
  await send({type: 'queueTrack', trackId: A}, 'initial-a');
  await send({type: 'queueTrack', trackId: B}, 'then-b');
  await send({type: 'transport', action: 'play'});
  await send({type: 'nextSong'});
  assert.equal(dj.snapshot().control.queue.length, 2);
  assert.equal(dj.snapshot().pending?.source.id, B);
  context.advance(0.2);
  assert.deepEqual(dj.snapshot().control.queue.map(q => q.trackId), [B]);
  context.advance(8);
  assert.equal(dj.snapshot().control.queue.length, 0);
  await dj.dispose();
});

test('new requests during an active handoff retain intent without a third voice or cancellation', async () => {
  const {dj, context, start, send} = await setup();
  await start();
  await send({type: 'nextSong'});
  context.advance(8);
  const request = await send({type: 'setState', state: 'surge'});
  assert.equal(request.execution.status, 'blocked');
  assert.equal(dj.snapshot().control.requested.state, 'surge');
  assert.equal(dj.snapshot().control.audible?.state, 'explore');
  assert.equal(context.sources.length, 2);
  context.advance(4);
  assert.equal(dj.snapshot().pending, null);
  assert.equal((await send({type: 'nextSong'})).execution.status, 'no-match');
  await dj.dispose();
});

test('a late cue is a visible no-match and keeps the reserved queue entry', async () => {
  const {dj, context, start, send} = await setup();
  await start();
  context.advance(8);
  const result = await send({type: 'queueTrack', trackId: B}, 'late-b');
  assert.equal(result.execution.status, 'no-match');
  assert.match(result.execution.reason, /cue has passed|too close/);
  assert.equal(dj.snapshot().control.queue[0]?.commandId, 'late-b');
  assert.deepEqual(dj.snapshot().player.now, [A]);
  assert.equal(context.sources.length, 1);
  await dj.dispose();
});

test('Stop reconciles a crossed start before teardown even without a UI poll', async () => {
  const {dj, context, start, send, request} = await setup();
  await start();
  await send({type: 'queueTrack', trackId: B}, 'crossed-b');
  // Capture the client's revision before crossing; request() itself reconciles the
  // crossed entry. A stale new command is refused, and a fresh Stop is explicit.
  const stop = request({type: 'transport', action: 'stop'}, 'boundary-stop');
  context.advance(8);
  assert.equal((await dj.request(stop)).execution.reason, 'stale-revision');
  await send({type: 'transport', action: 'stop'});
  assert.equal(dj.snapshot().control.queue.length, 0, 'already-started B must not reappear in the queue');
  assert.deepEqual(dj.snapshot().player.now, []);
  await dj.dispose();
});

test('paused selection does not resume the clock and consumes a muted entry on time', async () => {
  const {dj, context, start, send} = await setup();
  await start();
  await send({type: 'transport', action: 'pause'});
  const frame = dj.snapshot().player.currentFrame;
  await send({type: 'queueTrack', trackId: B}, 'paused-b');
  assert.equal(context.state, 'suspended');
  context.advance(30);
  assert.equal(dj.snapshot().player.currentFrame, frame);
  assert.equal(dj.snapshot().control.queue.length, 1);
  await send({type: 'transport', action: 'mute'});
  await send({type: 'transport', action: 'play'});
  context.advance(8);
  assert.equal(dj.snapshot().control.queue.length, 0);
  assert.equal(dj.snapshot().control.audible?.muted, true);
  assert.equal(outputValue(context), 0);
  await dj.dispose();
});

test('removing the initial reservation during decode prevents that cancelled track from starting', async () => {
  const {dj, context, send} = await setup();
  const gate = deferred();
  context.decodeGate = gate;
  await send({type: 'queueTrack', trackId: B}, 'decode-b');
  const play = send({type: 'transport', action: 'play'}, 'decode-play');
  await send({type: 'cancelQueue', queueCommandId: 'decode-b'});
  gate.release();
  await play;
  assert.equal(context.sources.length, 0);
  assert.equal(dj.snapshot().control.queue.length, 0);
  assert.equal(dj.operation('decode-b')?.execution.status, 'cancelled');
  assert.equal(dj.operation('decode-play')?.execution.status, 'cancelled');
  await dj.dispose();
});

test('a compatible new target rebinds the future plan without restarting its source', async () => {
  const {dj, context, send, start} = await setup();
  await start();
  await send({type: 'nextSong'}, 'explore-next');
  const at = dj.snapshot().pending!.at;
  const drive = await send({type: 'setState', state: 'drive'}, 'rebound-drive');
  assert.equal(drive.execution.status, 'scheduled');
  assert.deepEqual(dj.snapshot().pending!.at, at);
  assert.equal(dj.snapshot().pending!.state, 'drive');
  assert.equal(dj.snapshot().control.audible?.state, 'explore');
  assert.equal(context.sources.length, 2);
  context.advance(8);
  assert.equal(dj.snapshot().control.audible?.state, 'drive');
  assert.equal(dj.operation('rebound-drive')?.execution.status, 'started');
  await dj.dispose();
});

test('Cancel next removes B while preserving an initial A whose start lead has not elapsed', async () => {
  const {dj, context, send} = await setup();
  await send({type: 'queueTrack', trackId: A}, 'lead-a');
  await send({type: 'queueTrack', trackId: B}, 'lead-b');
  await send({type: 'transport', action: 'play'});
  await send({type: 'nextSong'});
  await send({type: 'cancelNext'});
  assert.equal(dj.snapshot().pending?.source.id, A);
  context.advance(0.2);
  assert.deepEqual(dj.snapshot().player.now, [A]);
  assert.deepEqual(dj.snapshot().control.queue.map(q => q.trackId), [B]);
  await dj.dispose();
});

test('coalesced supported targets retain the native plan but supersede the older target receipt', async () => {
  const {dj, context, start, send, request} = await setup();
  await start();
  const drive = request({type: 'setState', state: 'drive'}, 'old-drive');
  await dj.request(drive);
  await send({type: 'setState', state: 'explore'}, 'latest-explore');
  context.advance(13);
  assert.equal(dj.snapshot().control.audible?.state, 'explore');
  assert.equal(dj.operation('latest-explore')?.execution.status, 'completed');
  assert.equal((await dj.request(drive)).execution.status, 'superseded');
  assert.equal(context.sources.length, 2);
  await dj.dispose();
});

test('queued tail receipts keep their own identity while stopped or blocked behind the head', async () => {
  const {dj, start, send} = await setup();
  await send({type: 'queueTrack', trackId: A}, 'stopped-a');
  const b = await send({type: 'queueTrack', trackId: B}, 'stopped-b');
  assert.equal(b.execution.status, 'queued');
  assert.equal(b.execution.trackId, B);
  assert.match(b.execution.reason, /behind/);
  await start();
  await send({type: 'cancelQueue', queueCommandId: 'stopped-b'});
  await send({type: 'queueTrack', trackId: A}, 'blocked-a');
  const tail = await send({type: 'queueTrack', trackId: B}, 'waiting-b');
  assert.equal(tail.execution.status, 'queued');
  assert.equal(tail.execution.trackId, B);
  assert.match(tail.execution.reason, /behind/);
  await dj.dispose();
});

test('a cue crossed during native cancellation reports started, never a falsely cancelled handoff', async () => {
  const {dj, player, context, send, start} = await setup();
  await start();
  await send({type: 'queueTrack', trackId: B}, 'last-moment-b');
  const cancel = player.cancelPendingTransition.bind(player);
  player.cancelPendingTransition = () => { context.advance(8); return cancel(); };
  const result = await send({type: 'cancelQueue', queueCommandId: 'last-moment-b'});
  assert.equal(result.execution.status, 'blocked');
  assert.equal(dj.operation('last-moment-b')?.execution.status, 'started');
  assert.deepEqual(dj.snapshot().player.now, [A, B]);
  assert.equal(dj.snapshot().control.queue.length, 0);
  await dj.dispose();
});

test('automatic tie-breaking is independent of manifest order, and concurrent Next retries share one plan', async () => {
  const loaded = await fixturePack();
  const reversed = {...loaded, pack: {...loaded.pack, assets: [...loaded.pack.assets].reverse()}};
  const context = new ContextDouble();
  const player = new SmallPlayer(context.audio, reversed, 's01-a-to-b');
  const dj = new DeterministicDj(player, reversed);
  await dj.request({schemaVersion: CONTROL_VERSION, commandId: 'play', expectedRevision: 0, source: 'manual', type: 'transport', action: 'play'});
  context.advance(0.2);
  assert.deepEqual(dj.snapshot().player.now, [A]);
  const next: ControlRequest = {schemaVersion: CONTROL_VERSION, commandId: 'same-next', expectedRevision: dj.snapshot().control.revision, source: 'manual', type: 'nextSong'};
  const first = dj.request(next), second = dj.request(next);
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a.receipt, b.receipt);
  assert.equal(context.sources.length, 2);
  assert.equal(dj.snapshot().pending?.source.id, B);
  await dj.request({schemaVersion: CONTROL_VERSION, commandId: 'stop', expectedRevision: dj.snapshot().control.revision, source: 'manual', type: 'transport', action: 'stop'});
  await dj.request(next);
  assert.equal(context.sources.length, 2, 'retry cannot resurrect the cancelled handoff');
  await dj.dispose();
});
