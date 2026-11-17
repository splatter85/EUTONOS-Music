/** Audio-call lifecycle tests. Generated PCM only; these doubles do not render or listen. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test, {before, after} from 'node:test';
import {loadBrowserPack} from '../src/browser-pack.js';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import {DeterministicDj} from '../src/dj.js';
import {nativeSamplePeak} from '../src/mix-analysis.js';
import type {MixPreparationRuntime} from '../src/mix-transition.js';
import {SET_CANDIDATE_ATTEMPTS, SmallPlayer} from '../src/player.js';
import {PRECHECK_PROTOCOL, type PrecheckRequest, type PrecheckReport, type PrecheckRuntime} from '../web/mix-precheck-data.js';
import {ContextDouble, NodeDouble, ParameterDouble, deferred} from './audio-double.js';
import {buildSyntheticSet, decodePcm16} from './helpers/synthetic-set.js';

function audioBuffer(rate: number, channels: Float32Array[]): AudioBuffer {
  return {sampleRate: rate, length: channels[0]!.length, duration: channels[0]!.length / rate,
    numberOfChannels: channels.length, getChannelData: (i: number) => channels[i]!,
    copyToChannel: (source: Float32Array, i: number) => channels[i]!.set(source)} as AudioBuffer;
}
class FilterDouble extends NodeDouble {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new ParameterDouble(); readonly gain = new ParameterDouble(); readonly Q = new ParameterDouble();
}
class SetContext extends ContextDouble {
  constructor() { super(16000); }
  createBiquadFilter(): BiquadFilterNode { return new FilterDouble(this.audio) as unknown as BiquadFilterNode; }
  createBuffer(count: number, frames: number, rate: number): AudioBuffer {
    return audioBuffer(rate, Array.from({length: count}, () => new Float32Array(frames)));
  }
  override async decodeAudioData(input: ArrayBuffer): Promise<AudioBuffer> {
    const pcm = decodePcm16(new Uint8Array(input));
    assert.equal(pcm.sampleRate, this.sampleRate); return audioBuffer(this.sampleRate, pcm.channels);
  }
}
// Exercise the existing native route-free selection, independently of detector accuracy.
const preparation: MixPreparationRuntime = {
  analyze: async () => { throw new Error('Synthetic analysis unavailable'); },
  analyzeOne: async () => { throw new Error('Synthetic analysis unavailable'); },
  scanPeak: async pcm => nativeSamplePeak(pcm),
  render: async () => { throw new Error('Native fixture must not render a blend'); },
};
let set: Awaited<ReturnType<typeof buildSyntheticSet>>;
before(async () => { set = await buildSyntheticSet([120, 122, 124].map(bpm => ({id: 'gate-' + bpm, bpm, bars: 20}))); });
after(async () => { await set?.cleanup(); });
function report(status: PrecheckReport['status']): PrecheckReport {
  // Trusted injected dependency for lifecycle isolation; actual worker/schema tests live separately.
  return {version: PRECHECK_PROTOCOL, status, reason: 'Synthetic gate ' + status, evaluation: null, coverage: null};
}
function controlled(status: PrecheckReport['status'] = 'pass') {
  const entered = deferred(), finished = deferred();
  let seen: PrecheckRequest | null = null, signal: AbortSignal | undefined, calls = 0;
  const run: PrecheckRuntime = async (request, abort) => {
    seen = request; signal = abort; calls++; entered.release();
    await finished.promise; return report(status);
  };
  return {run, entered: entered.promise, release: finished.release,
    get seen() { return seen!; }, get signal() { return signal!; }, get calls() { return calls; }};
}
async function setup(gate: PrecheckRuntime, start = true) {
  const fetcher = (async (input: string | URL | Request) => new Response(new Uint8Array(await readFile(
    join(set.out, ...decodeURIComponent(new URL(String(input)).pathname).slice(1).split('/')))))) as typeof fetch;
  const loaded = await loadBrowserPack(new URL('http://localhost/pack/manifest.json'), false, fetcher,
    {allowUnreviewed: true, set: true});
  const context = new SetContext(), player = new SmallPlayer(context.audio, loaded, null, preparation, undefined, gate);
  const ids = [120, 122, 124].map(bpm => set.idFor('gate-' + bpm));
  player.setDeckControl('a', 'low', -6); player.setDeckControl('b', 'filter', 0.25); player.setCrossfader(0.35);
  if (start) { await player.playAsset(ids[0]!); context.advance(0.5); }
  return {context, player, loaded, ids};
}
function owners(player: SmallPlayer): void {
  const decks = player.deckSnapshot()!;
  assert.equal(decks.a.controls.low.owner, 'you'); assert.equal(decks.a.controls.low.value, -6);
  assert.equal(decks.b.controls.filter.owner, 'you'); assert.ok(Math.abs(decks.b.controls.filter.value - 0.25) < 1e-12);
  assert.deepEqual(decks.crossfader, {owner: 'you', value: 0.35});
}
let sequence = 0;
const command = (dj: DeterministicDj, action: Record<string, unknown>) => dj.request({
  schemaVersion: CONTROL_VERSION, commandId: 'precheck-' + ++sequence,
  expectedRevision: dj.snapshot().control.revision, source: 'manual', ...action} as ControlRequest);

for (const verdict of ['pass', 'warn'] as const) test(verdict + ' admits exactly the selected plan and preserves controls and master tap', async () => {
  const gate = controlled(verdict), {context, player, ids} = await setup(gate.run);
  try {
    const tap = player.createStreamTap(), master = context.gains[0]!;
    const pending = player.scheduleMixTo(ids[1]!, {bars: 4, anchor: 'song'});
    await gate.entered;
    const selected = structuredClone(gate.seen.plan);
    assert.equal(context.sources.length, 1); assert.equal(player.snapshot().transition, 'none');
    assert.match(player.snapshot().mix!.reason, /Checking the selected/);
    assert.equal(gate.seen.fromGain, 1); assert.equal(gate.seen.fromPlayback!.elapsedFrames,
      selected.fromExitFrame, 'source position at S uses the existing audio clock');
    gate.release(); await pending;
    const snapshot = player.snapshot(), summary = snapshot.mix!.summary!;
    assert.equal(context.sources.length, 2); assert.equal(gate.calls, 1);
    assert.equal(snapshot.mix!.precheck!.status, verdict);
    assert.equal(summary.recipe, selected.recipe); assert.equal(summary.fromExitFrame, selected.fromExitFrame);
    assert.equal(summary.toEntryFrame, selected.toEntryFrame); assert.deepEqual(gate.seen.plan, selected);
    assert.deepEqual(master.connections, [context.destination, context.streamTaps[0]]);
    assert.equal(player.createStreamTap(), tap); assert.equal(context.streamTaps.length, 1); owners(player);
    assert.equal(player.cancelPendingTransition(), true); assert.equal(player.snapshot().voices.length, 1); owners(player);
    assert.ok(context.sources[1]!.connections.length === 0);
  } finally { await player.dispose(); }
});

for (const verdict of ['fail', 'unavailable'] as const) test(verdict + ' creates no incoming source and leaves A automation unchanged', async () => {
  const gate = controlled(verdict), {context, player, ids} = await setup(gate.run);
  try {
    const a = context.sources[0]!, stops = [...a.stops], gains = context.gains.map(node => structuredClone(node.gain.calls));
    const naturalEnd = player.snapshot().voices[0]!.endFrame;
    const pending = player.scheduleMixTo(ids[1]!); await gate.entered;
    const refusal = assert.rejects(pending, /DJ plan check/);
    gate.release(); await refusal;
    const snapshot = player.snapshot();
    // S21: a measured FAIL tries the next untried candidate (bounded). Part B (G11): an unavailable report
    // tries one more candidate (it may be shorter), then stops.
    if (verdict === 'fail') assert.ok(gate.calls >= 1 && gate.calls <= SET_CANDIDATE_ATTEMPTS, String(gate.calls));
    else assert.equal(gate.calls, 2);
    assert.equal(context.sources.length, 1);
    assert.deepEqual(a.stops, stops); assert.deepEqual(context.gains.map(node => node.gain.calls), gains);
    assert.equal(snapshot.voices[0]!.endFrame, naturalEnd); assert.equal(snapshot.now[0], ids[0]);
    assert.equal(snapshot.transition, 'none'); assert.equal(snapshot.mix!.phase, 'unavailable');
    assert.equal(snapshot.mix!.precheck!.status, verdict); owners(player);
    assert.equal((player as unknown as {setDecoded: Map<string, unknown>}).setDecoded.size, 0, 'prepared decode is released');
  } finally { await player.dispose(); }
});

test('a thrown gate error becomes unavailable without fallback selection or a new source', async () => {
  let calls = 0;
  const {context, player, ids} = await setup(async () => { calls++; throw new Error('Synthetic worker unavailable'); });
  try {
    await assert.rejects(player.scheduleMixTo(ids[1]!), /worker unavailable/);
    assert.equal(calls, 1); assert.equal(context.sources.length, 1);
    assert.equal(player.snapshot().mix!.precheck!.status, 'unavailable'); owners(player);
  } finally { await player.dispose(); }
});

for (const action of ['cancel', 'pause', 'stop'] as const) test(action + ' aborts the pending check and ignores a late PASS', async () => {
  const gate = controlled(), {context, player, ids} = await setup(gate.run);
  try {
    const pending = player.scheduleMixTo(ids[1]!); await gate.entered;
    if (action === 'cancel') assert.equal(player.cancelPendingTransition(), true);
    else if (action === 'pause') await player.pause();
    else player.stop();
    assert.equal(gate.signal.aborted, true);
    const frozen = player.clock.currentFrame;
    if (action === 'pause') { context.advance(10); assert.equal(player.clock.currentFrame, frozen); }
    gate.release(); await pending;
    assert.equal(context.sources.length, 1, 'late result cannot schedule B');
    assert.equal(player.snapshot().transition, 'none'); owners(player);
    if (action === 'stop') assert.equal(player.snapshot().voices.length, 0);
    else {
      assert.equal(player.snapshot().voices.length, 1);
      if (action === 'pause') { await player.resume(); assert.equal(context.sources.length, 1); }
    }
  } finally { await player.dispose(); }
});

test('a PASS arriving after its original audio deadline refuses instead of choosing a different bar', async () => {
  const gate = controlled(), {context, player, ids} = await setup(gate.run);
  try {
    const before = [...context.sources[0]!.stops], pending = player.scheduleMixTo(ids[1]!);
    await gate.entered; const selected = structuredClone(gate.seen.plan);
    context.advance(12);
    const late = assert.rejects(pending, /checked set transition missed its audio-clock deadline/);
    gate.release(); await late;
    assert.equal(context.sources.length, 1); assert.equal(gate.calls, 1); assert.deepEqual(gate.seen.plan, selected);
    assert.deepEqual(context.sources[0]!.stops, before); assert.equal(player.snapshot().transition, 'none');
    assert.equal(player.snapshot().now[0], ids[0]); owners(player);
  } finally { await player.dispose(); }
});

test('DJ refusal retains FIFO and disarms Next; Hold and explicit retry remain available', async () => {
  let verdict: PrecheckReport['status'] = 'fail', calls = 0;
  const {context, player, loaded, ids} = await setup(async () => { calls++; return report(verdict); }, false);
  const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix'});
  try {
    for (const id of ids) await command(dj, {type: 'queueTrack', trackId: id});
    await command(dj, {type: 'transport', action: 'play'}); context.advance(0.5); dj.snapshot();
    const before = dj.snapshot().control.queue;
    await command(dj, {type: 'hold', enabled: true});
    const refused = await command(dj, {type: 'nextSong'});
    assert.equal(refused.execution.status, 'no-match'); assert.match(refused.execution.reason, /DJ plan check FAIL/);
    assert.deepEqual(dj.snapshot().control.queue, before); assert.equal(dj.nextArmed, false);
    assert.equal(context.sources.length, 1); assert.equal(dj.snapshot().player.now[0], ids[0]); owners(player);
    const refusedCalls = calls;
    assert.ok(refusedCalls >= 1 && refusedCalls <= SET_CANDIDATE_ATTEMPTS, 'every untried candidate was checked once at most');
    verdict = 'warn';
    assert.equal((await command(dj, {type: 'nextSong'})).execution.status, 'scheduled', 'manual Next still works under Hold');
    assert.equal(calls, refusedCalls + 1); assert.equal(context.sources.length, 2); owners(player);
    await command(dj, {type: 'cancelNext'});
    assert.deepEqual(dj.snapshot().control.queue, before);
    await command(dj, {type: 'transport', action: 'stop'});
    assert.equal(dj.snapshot().player.voices.length, 0); assert.deepEqual(dj.snapshot().control.queue, before);
  } finally { await dj.dispose(); }
});

test('queue reorder cancels the old check and admits only the checked new head', async () => {
  const first = controlled(); let calls = 0;
  const {context, player, loaded, ids} = await setup(async (request, signal) => {
    calls++; return calls === 1 ? first.run(request, signal) : report('pass');
  }, false);
  const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix'});
  try {
    for (const id of ids) await command(dj, {type: 'queueTrack', trackId: id});
    await command(dj, {type: 'transport', action: 'play'}); context.advance(0.5); dj.snapshot();
    const original = command(dj, {type: 'nextSong'}); await first.entered;
    const newHead = dj.snapshot().control.queue.find(item => item.trackId === ids[2])!;
    const moved = await command(dj, {type: 'reorderQueue', queueCommandId: newHead.commandId, toIndex: 0});
    assert.equal(moved.execution.status, 'scheduled', moved.execution.reason); assert.equal(first.signal.aborted, true);
    first.release(); await original;
    assert.equal(calls, 2); assert.equal(context.sources.length, 2);
    assert.equal(dj.snapshot().pending!.source.id, ids[2]);
    assert.deepEqual(dj.snapshot().control.queue.map(item => item.trackId), [ids[2], ids[1]]);
    assert.equal(player.deckSnapshot()!.b.assetId, ids[2]); owners(player);
  } finally { first.release(); await dj.dispose(); }
});

test('S21 review: a clean cut reached after pre-check FAILs is flagged as a fallback, not a plain pass', async () => {
  // Part B: every non-cut candidate fails (crossfade, echo reset, each dissolve length); only then the cut passes.
  let calls = 0; const tried: string[] = [];
  const gate: PrecheckRuntime = async request => {
    calls++; tried.push(request.plan.recipe);
    return report(['cut', 'fallback-cut'].includes(request.plan.recipe) ? 'pass' : 'fail');
  };
  const {player, ids} = await setup(gate);
  try {
    await player.scheduleMixTo(ids[1]!, {bars: 4, anchor: 'song'});
    const mix = player.snapshot().mix!;
    const failed = calls - 1;
    assert.ok(['cut', 'fallback-cut'].includes(mix.summary!.recipe), mix.summary!.recipe);
    assert.ok(tried.includes('fallback-filter-dissolve') && tried.includes('fallback-tone-dissolve'), tried.join());
    assert.ok(tried.indexOf('fallback-filter-dissolve') < tried.length - 1, 'each dissolve was checked before the cut');
    assert.equal(mix.precheck!.status, 'pass', 'the cut itself measured PASS');
    assert.deepEqual(mix.fallbackAfterFailedPrecheck, {failedChecks: failed, last: 'DJ plan check FAIL: Synthetic gate fail'});
    assert.match(mix.reason, new RegExp(`Fallback after ${failed} failed pre-checks`));
    assert.ok(mix.summary!.set!.transition!.rejected.length >= failed, 'the failed checks are in the plan record');
    assert.ok(mix.summary!.set!.why!.some(line => new RegExp(`Clean cut \\(last resort\\) reached after ${failed} failed pre-checks`).test(line)));
  } finally { await player.dispose(); }
  // A first-try cut or any non-cut pass carries no flag.
  calls = 0; const clean = await setup(async () => report('pass'));
  try {
    await clean.player.scheduleMixTo(clean.ids[1]!, {bars: 4, anchor: 'song'});
    assert.equal(clean.player.snapshot().mix!.fallbackAfterFailedPrecheck, undefined);
  } finally { await clean.player.dispose(); }
});
