import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeRecordings} from '../src/browser-pack.js';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import {DeterministicDj, type DjOptions} from '../src/dj.js';
import {bridgeSeed, planHybridHandoff, S05_HYBRID_POLICY, type HybridBridgeExit} from '../src/hybrid-handoff.js';
import type {AudioPack} from '../src/pack-types.js';
import {compileS01Phrase, type S01PhraseRole} from '../src/phrase-plan.js';
import {SmallPlayer} from '../src/player.js';
import {decodeProceduralSamples, ProceduralSource} from '../src/procedural-source.js';
import {RecordedSource, WebAudioClock} from '../src/web-audio.js';
import {ContextDouble, deferred, fixturePack, outputValue, type SourceDouble} from './audio-double.js';

const loaded = await fixturePack();
const A = 's01-recording-a', B = 's01-recording-b', RECIPE = 's01-recipe';
const route = 's01-a-to-b';
const bridge = compileS01Phrase(loaded.pack, {seed: 7, state: 'explore', allowFixtures: true});

/** Identify a 48 kHz double by its decoded length: each original sample has a distinct length. */
function roleOf(source: SourceDouble): S01PhraseRole | 'recording' {
  const length = source.buffer!.length;
  const role = ({12000: 'drum', 3600: 'percussion', 18000: 'bass', 48000: 'harmony', 768000: 'recording'} as const)[length];
  assert.ok(role, `unexpected buffer length ${length}`);
  return role;
}
/** The last stop() wins in Web Audio; a stop at or before the start produces no frame. */
function sounding(source: SourceDouble): {start: number; stop: number} | null {
  const start = source.starts[0]?.when;
  if (start === undefined) return null;
  const stop = source.stops.at(-1) ?? Infinity;
  return stop > start ? {start, stop} : null;
}
const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('the S05 policy binds exact identities and resolves every boundary on one clock', async () => {
  assert.deepEqual({id: S05_HYBRID_POLICY.id, revision: S05_HYBRID_POLICY.revision, route: S05_HYBRID_POLICY.route,
    performer: S05_HYBRID_POLICY.performer, recipe: S05_HYBRID_POLICY.recipe, review: S05_HYBRID_POLICY.review},
  {id: 's05-hybrid-handoff', revision: 1, route: {id: route, revision: 1}, performer: {id: 's04-s01-performer', revision: 1},
    recipe: {id: RECIPE, revision: 1}, review: 'engineering-only'});
  assert.ok(Object.isFrozen(S05_HYBRID_POLICY) && Object.isFrozen(S05_HYBRID_POLICY.leadIn.roles));
  for (const [rate, expected] of [[48000, [388800, 484800, 772800, 868800]], [44100, [357210, 445410, 710010, 798210]]] as const) {
    const context = new ContextDouble(rate), clock = new WebAudioClock(context.audio);
    const start = {at: clock.stamp(rate / 10), entryCueId: 'entry'};
    const plan = planHybridHandoff(loaded.pack, route, bridge, 'phrase', start, clock, true, rate / 10);
    assert.deepEqual([plan.fromExit.frame, plan.bridgeFull.frame, plan.toStart.frame, plan.end.frame], expected);
    assert.equal(plan.fromFadeFrames, rate * 2, 'A fades over exactly one 120 BPM bar');
    assert.deepEqual(plan.leadIn, {quarters: 4, roles: ['percussion']});
    assert.deepEqual(plan.tail, {quarters: 4, roles: ['percussion']});
    assert.deepEqual(plan.bridge, {recipe: {id: RECIPE, revision: 1}, performer: {id: 's04-s01-performer', revision: 1},
      seed: 7, state: 'explore', exit: 'phrase'});
    const ending = planHybridHandoff(loaded.pack, route, bridge, 'end', start, clock, true);
    assert.equal(ending.toStart.frame, expected[0] + rate * 16);
    assert.equal(ending.end.frame, ending.toStart.frame, 'the natural end leaves no bridge tail');
    assert.equal(ending.tail.quarters, 0);
  }
  const context = new ContextDouble(48000), clock = new WebAudioClock(context.audio);
  const start = {at: clock.stamp(4800), entryCueId: 'entry'};
  assert.throws(() => planHybridHandoff(loaded.pack, route, bridge, 'phrase', start, clock, false), /fixture mode/);
  assert.throws(() => planHybridHandoff(loaded.pack, route, bridge, 'bogus' as HybridBridgeExit, start, clock, true), /declared phrase exit/);
  assert.throws(() => planHybridHandoff(loaded.pack, route, bridge, 'phrase', start, clock, true, 400000), /passed or is too close/);
  const revised = structuredClone(loaded.pack) as unknown as {routes: {revision: number}[]};
  revised.routes[0]!.revision = 2;
  assert.throws(() => planHybridHandoff(revised as unknown as AudioPack, route, bridge, 'phrase', start, clock, true), /No hybrid handoff policy/);
  const rekeyed = structuredClone(loaded.pack) as unknown as {assets: {id: string; key: string | null}[]};
  rekeyed.assets.find(asset => asset.id === B)!.key = 'E minor';
  assert.throws(() => planHybridHandoff(rekeyed as unknown as AudioPack, route, bridge, 'phrase', start, clock, true), /one key and harmony/);
  clock.invalidate();
  assert.throws(() => planHybridHandoff(loaded.pack, route, bridge, 'phrase', start, clock, true), /Stale engine generation/);
});

test('bridge seeds are replayable uint32 values derived from the command ID', () => {
  assert.equal(bridgeSeed(''), 0x811c9dc5);
  assert.equal(bridgeSeed('next-1'), bridgeSeed('next-1'));
  assert.notEqual(bridgeSeed('next-1'), bridgeSeed('next-2'));
  for (const id of ['a', 'command-1', crypto.randomUUID()]) {
    const seed = bridgeSeed(id);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
    assert.equal(compileS01Phrase(loaded.pack, {seed, state: 'drive', allowFixtures: true}).seed, seed);
  }
});

test('a lead-in window allocates only its roles and a role handoff exit cancels every other attack', async () => {
  const context = new ContextDouble(48000), clock = new WebAudioClock(context.audio);
  const samples = await decodeProceduralSamples(loaded, context.audio, bridge);
  const make = (leadIn: {quarters: number; roles: S01PhraseRole[]}) =>
    new ProceduralSource(context.audio, bridge, samples, context.destination, {allowFixtures: true, leadIn});
  assert.throws(() => make({quarters: 2, roles: ['percussion']}), /whole bars/);
  assert.throws(() => make({quarters: 4, roles: ['percussion', 'percussion']}), /distinct performer roles/);
  assert.throws(() => make({quarters: 4, roles: ['vocal' as S01PhraseRole]}), /distinct performer roles/);
  const window = {quarters: 4, roles: ['percussion'] as S01PhraseRole[]};
  const source = make(window);
  window.roles.push('bass');
  assert.deepEqual(source.leadIn, {quarters: 4, roles: ['percussion']}, 'caller mutation cannot widen a committed window');
  await source.prepare(clock);
  const start = 48000;
  source.scheduleStart({at: clock.stamp(start), entryCueId: 'entry'});
  const kept = bridge.events.filter(event => event.atQuarters >= 4 || event.role === 'percussion');
  assert.ok(kept.length < bridge.events.length);
  assert.equal(source.resourceUsage.allocatedNoteNodes, kept.length);
  const leadInEnd = (start + 96000) / 48000;
  const leadInNotes = context.sources.filter(note => note.starts[0]!.when < leadInEnd);
  assert.ok(leadInNotes.length > 0 && leadInNotes.every(note => roleOf(note) === 'percussion'),
    'only percussion is allocated before the lead-in ends');

  const at = start + 384000, exitTime = at / 48000, tailEnd = (at + 96000) / 48000;
  const stopsBefore = context.sources.map(note => [...note.stops]);
  assert.throws(() => source.transitionOut('phrase', clock.stamp(at), {quarters: 2, roles: ['percussion']}), /whole bars/);
  assert.throws(() => source.transitionOut('end', clock.stamp(start + 768000), {quarters: 4, roles: ['percussion']}),
    /exceeds the finite performance/);
  assert.deepEqual(context.sources.map(note => [...note.stops]), stopsBefore, 'refusals leave every note unchanged');
  source.transitionOut('phrase', clock.stamp(at), {quarters: 4, roles: ['percussion']});
  assert.deepEqual(source.retainedRoles, {quarters: 4, roles: ['percussion']});
  assert.equal(source.endFrame, at + 96000);
  let tailHits = 0;
  for (const note of context.sources) {
    const interval = sounding(note);
    if (roleOf(note) === 'percussion') {
      if (note.starts[0]!.when >= tailEnd) assert.equal(interval, null, 'no percussion attack after the tail');
      else assert.ok(interval && interval.stop <= tailEnd + 1e-12);
      if (interval && interval.start >= exitTime) tailHits++;
    } else if (note.starts[0]!.when >= exitTime) {
      assert.equal(interval, null, `${roleOf(note)} attack after the handoff exit was not cancelled`);
    } else assert.ok(interval && interval.stop <= exitTime + 1e-12, 'earlier notes end inside their bar');
  }
  assert.ok(tailHits > 0, 'the percussion tail keeps at least one hit');
  const master = context.gains.find(gain => gain.connections.includes(context.destination))!;
  assert.deepEqual(master.gain.calls.slice(-2), [{kind: 'set', value: 1, time: exitTime}, {kind: 'ramp', value: 0, time: tailEnd}]);

  assert.equal(source.cancelTransition(), true);
  assert.equal(source.retainedRoles, null);
  assert.equal(source.endFrame, start + 768000);
  for (const note of context.sources) assert.equal(note.stops.at(-1), note.stops[0], 'cancellation restores each natural stop');
  source.release();
});

test('a recording exit can use a one-off fade length and cancellation still restores it', async () => {
  const context = new ContextDouble(48000), clock = new WebAudioClock(context.audio);
  const recording = (await decodeRecordings(loaded, context.audio)).find(item => item.asset.id === A)!;
  const source = new RecordedSource(context.audio, recording, context.destination, {allowFixtures: true, fadeOutFrames: 192000});
  await source.prepare(clock);
  source.scheduleStart({at: clock.stamp(4800), entryCueId: 'entry'});
  assert.throws(() => source.transitionOut('exit', clock.stamp(388800), -1), /nonnegative integer/);
  assert.throws(() => source.transitionOut('exit', clock.stamp(388800), 0.5), /nonnegative integer/);
  source.transitionOut('exit', clock.stamp(388800), 96000);
  assert.deepEqual(context.gains[0]!.gain.calls.slice(-2), [{kind: 'set', value: 1, time: 8.1}, {kind: 'ramp', value: 0, time: 10.1}]);
  assert.deepEqual(context.sources[0]!.stops, [10.1]);
  assert.equal(source.endFrame, 484800);
  assert.equal(source.cancelTransition(), true);
  assert.deepEqual(context.sources[0]!.stops, [10.1, 16.1]);
  assert.equal(source.endFrame, 772800);
});

async function playing() {
  const context = new ContextDouble();
  const player = new SmallPlayer(context.audio, loaded, route);
  await player.play('a');
  context.advance(1);
  return {context, player};
}

test('the player commits A → bridge → B in absolute frames with non-overlapping role ownership', async () => {
  const {context, player} = await playing();
  await player.scheduleHybrid(bridge);
  const snapshot = player.snapshot();
  assert.deepEqual(snapshot.voices.map(voice => [voice.source.id, voice.start.frame, voice.endFrame]), [
    [A, 4800, 484800], [RECIPE, 388800, 868800], [B, 772800, 1540800]]);
  assert.deepEqual([snapshot.transitionAt!.frame, snapshot.transitionEnd!.frame], [388800, 868800]);
  assert.deepEqual(snapshot.handoff, {policy: {id: 's05-hybrid-handoff', revision: 1},
    bridge: {recipe: {id: RECIPE, revision: 1}, performer: {id: 's04-s01-performer', revision: 1}, seed: 7, state: 'explore', exit: 'phrase'},
    phase: 'scheduled', fromExit: {engineGeneration: snapshot.engineGeneration, frame: 388800},
    bridgeFull: {engineGeneration: snapshot.engineGeneration, frame: 484800},
    toStart: {engineGeneration: snapshot.engineGeneration, frame: 772800},
    end: {engineGeneration: snapshot.engineGeneration, frame: 868800}});
  assert.equal(snapshot.next, RECIPE);
  assert.equal(snapshot.durationSeconds, 32);
  const [a, b, ...notes] = context.sources;
  assert.deepEqual(a!.stops, [10.1], 'A stops when its one-bar tail has faded');
  const aGain = context.gains.find(gain => gain.connections.length && (a!.connections[0] as unknown) === gain)!;
  assert.deepEqual(aGain.gain.calls.slice(-2), [{kind: 'set', value: 1, time: 8.1}, {kind: 'ramp', value: 0, time: 10.1}]);
  assert.deepEqual(b!.starts, [{when: 16.1, offset: 0}]);
  const bGain = context.gains.find(gain => (b!.connections[0] as unknown) === gain)!;
  assert.deepEqual(bGain.gain.calls, [{kind: 'set', value: 1, time: 16.1}], 'B enters at full gain on its cue');
  assert.ok(notes.length > 0 && notes.every(note => roleOf(note) !== 'recording'));
  // Ownership: A sounds until 10.1; bridge drums, bass and harmony in [10.1, 16.1); B from 16.1.
  // Only bridge percussion overlaps a recording, inside A's fading bar and the bridge tail.
  for (const note of notes) {
    const interval = sounding(note);
    if (!interval) continue;
    if (roleOf(note) === 'percussion') assert.ok(interval.start >= 8.1 && interval.stop <= 18.1 + 1e-12);
    else assert.ok(interval.start >= 10.1 && interval.stop <= 16.1 + 1e-12, `${roleOf(note)} sounds outside its ownership window`);
  }
  assert.ok(notes.some(note => sounding(note) && roleOf(note) === 'bass'), 'the bridge takes the bass role');
  assert.ok(notes.some(note => sounding(note)?.start! < 10.1), 'percussion enters during A\'s tail');
  assert.ok(notes.some(note => sounding(note)?.start! >= 16.1), 'percussion continues under B');

  const at = (seconds: number) => { context.currentTime = seconds; return player.snapshot(); };
  assert.equal(at(8.0).handoff!.phase, 'scheduled');
  let view = at(9);
  assert.equal(view.handoff!.phase, 'lead-in');
  assert.deepEqual(view.now, [A, RECIPE]);
  assert.equal(view.transition, 'mixing');
  view = at(12);
  assert.equal(view.handoff!.phase, 'bridge');
  assert.deepEqual(view.now, [RECIPE]);
  assert.equal(view.next, B);
  view = at(17);
  assert.equal(view.handoff!.phase, 'tail');
  assert.deepEqual(view.now, [RECIPE, B]);
  view = at(18.1);
  assert.equal(view.handoff!.phase, 'complete');
  assert.equal(view.transition, 'complete');
  assert.deepEqual(view.now, [B]);
  view = at(32.1);
  assert.equal(view.state, 'ended');
  assert.equal(outputValue(context), 0);
  await player.dispose();
});

test('the end exit hands straight to B at the natural phrase end with no tail', async () => {
  const {context, player} = await playing();
  await player.scheduleHybrid(compileS01Phrase(loaded.pack, {seed: 11, state: 'drive', allowFixtures: true}), 'end');
  const snapshot = player.snapshot();
  assert.deepEqual(snapshot.voices.map(voice => [voice.source.id, voice.start.frame, voice.endFrame]), [
    [A, 4800, 484800], [RECIPE, 388800, 1156800], [B, 1156800, 1924800]]);
  assert.equal(snapshot.handoff!.toStart.frame, snapshot.handoff!.end.frame);
  for (const note of context.sources.slice(2)) {
    const interval = sounding(note);
    if (interval && roleOf(note) !== 'percussion') assert.ok(interval.start >= 10.1 && interval.stop <= 24.1 + 1e-12);
  }
  context.currentTime = 24.1;
  assert.deepEqual(player.snapshot().now, [B]);
  assert.equal(player.snapshot().handoff!.phase, 'complete');
  await player.dispose();
});

test('a hybrid handoff can be cancelled before the bridge enters, never after', async () => {
  const {context, player} = await playing();
  await player.scheduleHybrid(bridge);
  context.currentTime = 5;
  assert.equal(player.cancelPendingTransition(), true);
  const restored = player.snapshot();
  assert.deepEqual(restored.voices.map(voice => voice.source.id), [A]);
  assert.equal(restored.handoff, null);
  assert.equal(restored.next, null);
  assert.deepEqual(context.sources[0]!.stops, [10.1, 16.1], 'A regains its natural end');
  for (const note of context.sources.slice(1)) assert.equal(sounding(note), null, 'released bridge and B never sound');
  await player.scheduleHybrid(compileS01Phrase(loaded.pack, {seed: 8, state: 'explore', allowFixtures: true}));
  context.currentTime = 8.2;
  assert.equal(player.cancelPendingTransition(), false, 'once the bridge has entered, the handoff finishes');
  assert.equal(player.snapshot().handoff!.phase, 'lead-in');
  player.stop();
  assert.deepEqual(player.snapshot().voices, []);
  assert.equal(outputValue(context), 0);
  await player.dispose();
});

test('a late or duplicate hybrid preparation is refused and leaves A unchanged', async () => {
  const {context, player} = await playing();
  context.decodeGate = deferred();
  const late = player.scheduleHybrid(bridge);
  context.advance(7.95);
  context.decodeGate.release();
  await assert.rejects(late, /passed or is too close/);
  assert.deepEqual(context.sources[0]!.stops, [], 'A was not altered');
  assert.deepEqual(player.snapshot().voices.map(voice => voice.source.id), [A]);
  for (const source of context.sources.slice(1)) assert.equal(sounding(source), null);
  await player.dispose();

  const second = await playing();
  const first = second.player.scheduleHybrid(bridge);
  const duplicate = second.player.scheduleHybrid(compileS01Phrase(loaded.pack, {seed: 9, state: 'explore', allowFixtures: true}));
  await first;
  await assert.rejects(duplicate, /already scheduled/);
  assert.equal(second.player.snapshot().handoff!.bridge.seed, 7);
  assert.equal(second.player.snapshot().voices.length, 3);
  await assert.rejects(second.player.scheduleHybrid(bridge), /Only one A → B transition/);
  await assert.rejects(second.player.scheduleAB(), /Only one A → B transition/);
  await second.player.dispose();
});

test('pause freezes a scheduled bridge without recreating sources; Stop releases all three voices', async () => {
  const {context, player} = await playing();
  await player.scheduleHybrid(bridge);
  context.advance(10);
  assert.equal(player.snapshot().handoff!.phase, 'bridge');
  const count = context.sources.length;
  await player.pause();
  context.advance(60);
  assert.equal(player.snapshot().handoff!.phase, 'bridge');
  await player.resume();
  assert.equal(context.sources.length, count, 'resume restarts no one-shot node');
  player.stop();
  assert.equal(player.snapshot().handoff, null);
  assert.equal(outputValue(context), 0);
  await player.dispose();
});

type Intent = ControlRequest extends infer R ? R extends ControlRequest
  ? Omit<R, 'schemaVersion' | 'commandId' | 'expectedRevision' | 'source'> : never : never;
async function dj(options: DjOptions = {handoff: 'hybrid'}) {
  const context = new ContextDouble();
  const player = new SmallPlayer(context.audio, loaded, route);
  const controller = new DeterministicDj(player, loaded, 'explore', options);
  let counter = 0;
  const request = (intent: Intent, id = `command-${++counter}`): ControlRequest => ({
    schemaVersion: CONTROL_VERSION, commandId: id, expectedRevision: controller.snapshot().control.revision, source: 'manual', ...intent,
  });
  const send = (intent: Intent, id?: string) => controller.request(request(intent, id));
  await send({type: 'transport', action: 'play'});
  context.advance(0.2);
  controller.snapshot();
  return {context, player, dj: controller, request, send};
}

test('the DJ drives A → procedural bridge → B and reports each renderer phase separately', async () => {
  const {context, dj: controller, send} = await dj();
  const next = await send({type: 'nextSong'}, 'next-1');
  assert.equal(next.execution.status, 'scheduled');
  assert.match(next.execution.reason, /procedural bridge/);
  assert.equal(next.execution.trackId, B);
  let view = controller.snapshot();
  assert.deepEqual(view.player.handoff!.bridge, {recipe: {id: RECIPE, revision: 1},
    performer: {id: 's04-s01-performer', revision: 1}, seed: bridgeSeed('next-1'), state: 'explore', exit: 'phrase'});
  assert.equal(view.control.planned!.source.id, B);
  assert.equal(view.control.planned!.at.frame, 772800, 'B is planned at its own entry, the bridge exit');
  assert.deepEqual(view.control.audible!.sources!.map(source => source.id), [A]);
  const advanceTo = (seconds: number) => { context.currentTime = seconds; return controller.snapshot(); };
  view = advanceTo(9);
  assert.equal(controller.operation('next-1')!.execution.status, 'scheduled', 'B has not entered yet');
  assert.match(controller.operation('next-1')!.execution.reason, /bridge has entered/);
  assert.deepEqual(view.control.audible!.sources!.map(source => source.id), [A, RECIPE]);
  assert.equal(view.control.audible!.state, 'explore', 'the bridge serves the requested state');
  view = advanceTo(12);
  assert.deepEqual(view.control.audible!.sources!.map(source => source.id), [RECIPE]);
  view = advanceTo(17);
  assert.equal(controller.operation('next-1')!.execution.status, 'started');
  assert.deepEqual(view.control.audible!.sources!.map(source => source.id), [RECIPE, B]);
  assert.equal(view.control.audible!.source!.id, B);
  view = advanceTo(18.2);
  assert.equal(controller.operation('next-1')!.execution.status, 'completed');
  assert.deepEqual(view.control.audible!.sources!.map(source => source.id), [B]);
  assert.equal(view.pending, null);
  assert.equal((await send({type: 'nextSong'})).execution.status, 'no-match', 'no invented B → A or bridge loop');
  await controller.dispose();
});

test('hybrid cancellation, exact retries, queue priority and the direct default stay deterministic', async () => {
  const {context, dj: controller, request, send} = await dj();
  const next = request({type: 'nextSong'}, 'next-a');
  await controller.request(next);
  const scheduled = context.sources.length;
  assert.equal((await controller.request(next)).execution.status, 'scheduled', 'an exact retry reconciles');
  assert.equal(context.sources.length, scheduled, 'an exact retry schedules no second bridge');
  context.currentTime = 4;
  assert.equal((await send({type: 'cancelNext'})).execution.status, 'applied');
  assert.equal(controller.operation('next-a')!.execution.status, 'cancelled');
  assert.equal(controller.snapshot().player.handoff, null);
  assert.deepEqual(controller.snapshot().player.voices.map(voice => voice.source.id), [A]);

  const queued = await send({type: 'queueTrack', trackId: B}, 'queue-b');
  assert.equal(queued.execution.status, 'scheduled');
  assert.equal(controller.snapshot().player.handoff!.bridge.seed, bridgeSeed('queue-b'));
  assert.equal(controller.snapshot().control.queue.length, 1, 'the queue head stays reserved until B enters');
  context.currentTime = 8.2;
  let view = controller.snapshot();
  assert.equal(view.control.queue.length, 1, 'the bridge entering does not consume the queue entry for B');
  assert.equal(view.control.planned!.at.frame, 772800);
  assert.match(controller.operation('queue-b')!.execution.reason, /bridge has entered/);
  assert.equal((await send({type: 'cancelNext'})).execution.status, 'blocked');
  assert.equal((await send({type: 'nextSong'})).execution.status, 'blocked');
  assert.ok(controller.snapshot().player.handoff, 'the handoff is unchanged by the refused commands');
  context.currentTime = 12;
  assert.equal((await send({type: 'transport', action: 'stop'})).execution.status, 'applied');
  view = controller.snapshot();
  assert.equal(view.player.handoff, null);
  assert.equal(view.control.queue.length, 1, 'Stop during the bridge keeps the unstarted B entry');
  await send({type: 'transport', action: 'play'});
  context.advance(0.2);
  assert.deepEqual(controller.snapshot().player.voices.map(voice => voice.source.id), [B], 'Play serves the retained B');
  await controller.dispose();

  const direct = await dj({});
  assert.equal(direct.dj.handoffMode, 'direct');
  await direct.send({type: 'nextSong'});
  assert.equal(direct.dj.snapshot().player.handoff, null);
  assert.equal(direct.dj.snapshot().player.transitionEnd!.frame, 580_800, 'S03 crossfade remains A exit + 4 s');
  await direct.send({type: 'cancelNext'});
  direct.dj.setHandoff('hybrid');
  await direct.send({type: 'nextSong'});
  assert.ok(direct.dj.snapshot().player.handoff, 'the switch applies to the next selection');
  assert.throws(() => direct.dj.setHandoff('fade' as 'direct'), /Unsupported handoff/);
  assert.throws(() => new DeterministicDj(direct.player, loaded, 'explore', {bridgeExit: 'never' as 'end'}), /Unsupported handoff/);
  await direct.dj.dispose();
});

test('a queued B with an unmet target plays an explore bridge that claims no state', async () => {
  const {context, dj: controller, send} = await dj({handoff: 'hybrid', bridgeExit: 'end'});
  await send({type: 'setState', state: 'surge'});
  const queued = await send({type: 'queueTrack', trackId: B}, 'queue-surge');
  assert.equal(queued.execution.status, 'scheduled', 'the manual queue serves B even though surge stays unmet');
  const view = controller.snapshot();
  assert.equal(view.player.handoff!.bridge.state, 'explore');
  assert.equal(view.player.handoff!.bridge.exit, 'end');
  assert.equal(view.player.handoff!.toStart.frame, 388800 + 768000);
  context.currentTime = 12;
  assert.equal(controller.snapshot().control.audible!.source!.id, RECIPE);
  assert.equal(controller.snapshot().control.audible!.state, null);
  await controller.dispose();
});

test('a re-served queue keeps the bridge state honest, and Drive reschedules a drive bridge', async () => {
  const {context, dj: controller, send} = await dj();
  await send({type: 'setState', state: 'surge'});
  await send({type: 'queueTrack', trackId: B}, 'queue-1');
  assert.equal(controller.snapshot().player.handoff!.bridge.state, 'explore');
  const explore = await send({type: 'setState', state: 'explore'});
  assert.equal(explore.execution.status, 'scheduled');
  assert.match(explore.execution.reason, /already serves/);
  assert.equal(controller.snapshot().player.handoff!.bridge.seed, bridgeSeed('queue-1'), 'nothing was rescheduled');
  const drive = await send({type: 'setState', state: 'drive'}, 'drive-1');
  assert.equal(drive.execution.status, 'scheduled');
  let view = controller.snapshot();
  assert.equal(view.player.handoff!.bridge.state, 'drive', 'an explore bridge never claims to serve Drive');
  assert.equal(view.player.handoff!.bridge.seed, bridgeSeed('drive-1'));
  assert.equal(controller.operation('queue-1')!.execution.status, 'scheduled');
  context.currentTime = 12;
  view = controller.snapshot();
  assert.equal(view.control.audible!.source!.id, RECIPE);
  assert.equal(view.control.audible!.state, 'drive');
  const removal = await send({type: 'cancelQueue', queueCommandId: 'queue-1'});
  assert.equal(removal.execution.status, 'blocked');
  assert.match(removal.execution.reason, /bridge has entered/);
  assert.notEqual(controller.operation('queue-1')!.execution.status, 'cancelled');
  assert.equal(controller.snapshot().control.queue.length, 0, 'the listing drops the entry, as in S03');
  assert.ok(controller.snapshot().player.handoff, 'the handoff itself is unchanged');
  context.currentTime = 17;
  controller.snapshot();
  assert.equal(controller.operation('queue-1')!.execution.status, 'started');
  assert.equal(controller.snapshot().control.queue.length, 0, 'B entered with the entry already unlisted');
  await controller.dispose();
});
