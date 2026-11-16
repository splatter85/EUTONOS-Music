import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {decodeRecording, loadBrowserPack, SET_LIMITS, type LoadedBrowserPack} from '../src/browser-pack.js';
import {CONTROL_VERSION, ControlContract, type ControlRequest} from '../src/control.js';
import {DeterministicDj} from '../src/dj.js';
import {analyzeMixAudio, measureMixLevel, nativeSamplePeak, MIX_ANALYSIS_VERSION, type MixAnalysis} from '../src/mix-analysis.js';
import {barAtOrAfter, chooseSetTransition, downbeatAt, equalPowerCrossfade, MixAnalysisCache, nextBoundary,
  planRouteFreeTransition, prepareMixTransition, setBarGrid, type MixPreparationRuntime, type SetBarGrid} from '../src/mix-transition.js';
import {SmallPlayer} from '../src/player.js';
import {renderTimePitch, renderFiniteLoop, nativeRateOutputAt, TIME_PITCH_LIMITS} from '../src/time-pitch.js';
import {SONG_ANALYSIS_WINDOW} from '../src/mix-analysis.js';
import {RecordedSource, WebAudioClock} from '../src/web-audio.js';
import {ContextDouble, NodeDouble, ParameterDouble, deferred} from './audio-double.js';
import {buildSyntheticSet, decodePcm16, SYNTHETIC_SET} from './helpers/synthetic-set.js';

function audioBuffer(rate: number, channels: Float32Array[]): AudioBuffer {
  return {sampleRate: rate, length: channels[0]!.length, duration: channels[0]!.length / rate, numberOfChannels: channels.length,
    getChannelData: (i: number) => channels[i]!,
    copyToChannel: (source: Float32Array, i: number) => { channels[i]!.set(source); }} as AudioBuffer;
}
class FilterDouble extends NodeDouble {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new ParameterDouble();
  readonly gain = new ParameterDouble();
  readonly Q = new ParameterDouble();
}
/** Decodes the real synthetic PCM, so analysis sees the generated songs. Renders nothing. */
class SetContext extends ContextDouble {
  decodes = 0;
  constructor(rate = 16000) { super(rate); }
  createBiquadFilter(): BiquadFilterNode { return new FilterDouble(this.audio) as unknown as BiquadFilterNode; }
  createBuffer(count: number, frames: number, rate: number): AudioBuffer {
    return audioBuffer(rate, Array.from({length: count}, () => new Float32Array(frames)));
  }
  override async decodeAudioData(input: ArrayBuffer): Promise<AudioBuffer> {
    this.decodes++;
    const pcm = decodePcm16(new Uint8Array(input));
    assert.equal(pcm.sampleRate, this.sampleRate, 'synthetic set is generated at the context rate');
    return audioBuffer(this.sampleRate, pcm.channels);
  }
}
function countingRuntime() {
  const calls = {analyzeOne: 0, analyze: 0, render: 0, peak: 0};
  const runtime: MixPreparationRuntime = {
    analyze: async (from, to) => { calls.analyze++; return {from: analyzeMixAudio(from), to: analyzeMixAudio(to)}; },
    render: async (audio, options) => { calls.render++; return renderTimePitch(audio, options); },
    scanPeak: async audio => { calls.peak++; return nativeSamplePeak(audio); },
    renderLoop: async (audio, loop, tail, bars, gain) => renderFiniteLoop(audio, loop, tail, bars, gain),
    analyzeOne: async (audio, _signal, options, levelAudio) => { calls.analyzeOne++; return {...analyzeMixAudio(audio, options), level: measureMixLevel(levelAudio ?? audio)}; },
  };
  return {runtime, calls};
}
function fileFetcher(root: string, log: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    log.push(url.pathname);
    return new Response(new Uint8Array(await readFile(join(root, ...decodeURIComponent(url.pathname).slice(1).split('/')))));
  }) as typeof fetch;
}
async function loadSet(set: Awaited<ReturnType<typeof buildSyntheticSet>>, log: string[] = []): Promise<LoadedBrowserPack> {
  return loadBrowserPack(new URL('http://localhost/pack/manifest.json'), false, fileFetcher(set.out, log),
    {allowUnreviewed: true, set: true});
}
let request = 0;
const req = (body: Record<string, unknown>, revision: number): ControlRequest =>
  ({schemaVersion: CONTROL_VERSION, commandId: `set-${++request}`, expectedRevision: revision, source: 'manual', ...body}) as ControlRequest;

test('set loader fetches only the manifest and rights evidence, then verifies each song on demand', async () => {
  const set = await buildSyntheticSet();
  try {
    const log: string[] = [];
    const loaded = await loadSet(set, log);
    assert.equal(loaded.pack.assets.length, 4);
    assert.equal(loaded.files.size, 0, 'no audio is resident after load');
    assert.ok(log.every(path => !path.endsWith('.wav')), 'no audio fetched up front');
    assert.ok(loaded.lazy);
    const context = new SetContext();
    const first = await decodeRecording(loaded, context.audio, loaded.pack.assets[0]!);
    assert.equal(first.buffer.length, loaded.pack.assets[0]!.file.frames);
    assert.equal(log.filter(path => path.endsWith('.wav')).length, 1, 'exactly one song fetched');
    // Tampered audio is refused by the per-asset hash check.
    const asset = loaded.pack.assets[1]!, path = join(set.out, 'pack', ...asset.file.path.split('/'));
    const bytes = await readFile(path); bytes[100] = bytes[100]! ^ 0xff; await writeFile(path, bytes);
    await assert.rejects(decodeRecording(loaded, context.audio, asset), /SHA-256|hash|differs/i);
    // The resident 1–2 recording loader keeps refusing a set pack.
    await assert.rejects(loadBrowserPack(new URL('http://localhost/pack/manifest.json'), false, fileFetcher(set.out),
      {allowUnreviewed: true, maxBytes: 128 * 1024 * 1024}), /one or two|recording/i);
  } finally { await set.cleanup(); }
});

test('per-song decode budget refuses one oversized song without touching the others', async () => {
  const set = await buildSyntheticSet();
  try {
    const loaded = await loadSet(set);
    const huge = {...loaded.pack.assets[0]!, file: {...loaded.pack.assets[0]!.file, frames: SET_LIMITS.maxDecodedSongBytes}};
    const pack = {...loaded.pack, assets: [huge, ...loaded.pack.assets.slice(1)]};
    await assert.rejects(decodeRecording({...loaded, pack}, new SetContext().audio, huge), /per-song memory budget/);
  } finally { await set.cleanup(); }
});

test('analysis cache keys by audio hash, analysis version, rate and requested BPM, and runs once per song', async () => {
  const set = await buildSyntheticSet();
  try {
    const loaded = await loadSet(set), context = new SetContext(), {runtime, calls} = countingRuntime();
    const cache = new MixAnalysisCache();
    const asset = loaded.pack.assets[0]!;
    const key = MixAnalysisCache.key(asset, 16000);
    assert.ok(key.includes(asset.file.sha256) && key.includes(MIX_ANALYSIS_VERSION) && key.includes(':16000:') &&
      key.endsWith(String(asset.timing!.bpm)));
    assert.notEqual(MixAnalysisCache.key(asset, 48000), key);
    assert.notEqual(MixAnalysisCache.key({...asset, file: {...asset.file, sha256: 'f'.repeat(64)}}, 16000), key);
    const recording = await decodeRecording(loaded, context.audio, asset);
    const [a, b] = await Promise.all([cache.analyze(recording, runtime), cache.analyze(recording, runtime)]);
    assert.equal(calls.analyzeOne, 1);
    assert.ok(a.ok && b.ok && a.analysis === b.analysis);
    assert.equal(calls.peak, 1);
    await cache.analyze(recording, runtime, undefined, 1);
    assert.equal(calls.peak, 1, 'a second evidence window reuses the full-native peak receipt');
    // Without analyzeOne the mono copy goes through the pair analyzer, still once.
    const plain = new MixAnalysisCache(), counted = countingRuntime(), {analyzeOne: _, ...pairOnly} = counted.runtime;
    assert.ok((await plain.analyze(recording, pairOnly)).ok);
    assert.equal(counted.calls.analyze, 1);
    // A failure is an explicit unavailable result, then dropped so the next request retries.
    let fail = true, attempts = 0;
    const flaky: MixPreparationRuntime = {...runtime, analyzeOne: async (audio, signal, options) => {
      attempts++;
      if (fail) throw new Error('synthetic failure');
      return analyzeMixAudio(audio, options);
    }};
    const failed = new MixAnalysisCache();
    const [r1, r2] = await Promise.all([failed.analyze(recording, flaky), failed.analyze(recording, flaky)]);
    assert.equal(r1.ok, false); assert.equal(r2.ok, false);
    assert.equal(attempts, 1, 'concurrent callers share one failed run');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failed.has(asset, 16000), false, 'the failure is not cached');
    fail = false;
    assert.equal((await failed.analyze(recording, flaky)).ok, true);
    assert.equal(attempts, 2);
    assert.equal(failed.has(asset, 16000), true);
  } finally { await set.cleanup(); }
});

function requestedGrid(bpm: number, rate = 16000): SetBarGrid {
  return {source: 'requested', bpm, barFrames: 4 * 60 * rate / bpm, downbeats: [0]};
}

test('bar boundaries count from the song (Next) or from the entry bar (Auto)', () => {
  const grid = requestedGrid(120); // 2 s bars at 16 kHz = 32000 frames
  assert.equal(downbeatAt(grid, 5), 160000);
  assert.equal(barAtOrAfter(grid, 160001), 6);
  assert.deepEqual(nextBoundary(grid, 0, 4, 5 * 32000 + 1), {bar: 8, frame: 8 * 32000});
  assert.deepEqual(nextBoundary(grid, 0, 8, 5 * 32000), {bar: 8, frame: 8 * 32000});
  assert.deepEqual(nextBoundary(grid, 0, 4, 4 * 32000), {bar: 4, frame: 4 * 32000}, 'an exact downbeat qualifies');
  assert.deepEqual(nextBoundary(grid, 3, 16, 4 * 32000), {bar: 19, frame: 19 * 32000}, 'Auto: N bars after the entry bar');
});

test('route-free fallback: 90 -> 128 is a clean cut on the downbeat; 122 -> 128 crossfades one bar; equal tempo four', () => {
  const rate = 16000, frames = 60 * rate;
  const cut = planRouteFreeTransition({grid: requestedGrid(90), frames}, {grid: requestedGrid(128), frames}, 8 * 4 * 60 * rate / 90, rate);
  assert.equal(cut.kind, 'route-free');
  assert.ok(cut.kind === 'route-free');
  assert.equal(cut.recipe, 'fallback-cut');
  assert.equal(cut.fromExitFrame, 8 * 4 * 60 * rate / 90, 'exactly on the boundary downbeat');
  assert.equal(cut.toEntryFrame, 0);
  assert.ok(cut.overlapFrames <= rate * 0.02, 'a short complementary cut');
  const near = planRouteFreeTransition({grid: requestedGrid(122), frames}, {grid: requestedGrid(128), frames}, 0, rate);
  assert.ok(near.kind === 'route-free' && near.recipe === 'fallback-crossfade' && near.bars === 1);
  assert.equal(near.overlapFrames, Math.round(4 * 60 * rate / 122));
  const same = planRouteFreeTransition({grid: requestedGrid(128), frames}, {grid: requestedGrid(128), frames}, 0, rate);
  assert.ok(same.kind === 'route-free' && same.bars === 4);
  // Too little A audio for four bars shrinks to one bar, then to a cut, then refuses.
  const tight = planRouteFreeTransition({grid: requestedGrid(128), frames: Math.round(2 * 4 * 60 * rate / 128)},
    {grid: requestedGrid(128), frames}, 0, rate);
  assert.ok(tight.kind === 'route-free' && tight.bars === 1);
  assert.equal(planRouteFreeTransition({grid: requestedGrid(128), frames: 10}, {grid: requestedGrid(128), frames}, 0, rate).kind, 'unavailable');
  const fade = equalPowerCrossfade(1600, rate);
  for (let i = 0; i < fade.outgoing.gain.length; i++) {
    const power = fade.outgoing.gain[i]!.value ** 2 + fade.incoming.gain[i]!.value ** 2;
    assert.ok(Math.abs(power - 1) < 1e-9, 'equal power at every point');
  }
});

test('set choice: any analyzed pair stays on the requested bar, else the route-free fallback', async () => {
  const set = await buildSyntheticSet();
  try {
    const loaded = await loadSet(set), context = new SetContext();
    const assets = new Map(SYNTHETIC_SET.map(s => [s.id, loaded.pack.assets.find(a => a.id === set.idFor(s.id))!]));
    const analysis = new Map<string, MixAnalysis>();
    for (const [id, asset] of assets) {
      const recording = await decodeRecording(loaded, context.audio, asset);
      analysis.set(id, analyzeMixAudio({sampleRate: 16000, channels: [recording.buffer.getChannelData(0)]}, {generationBpm: asset.timing!.bpm}));
    }
    const input = (fromId: string, toId: string, withAnalysis: boolean) => {
      const from = assets.get(fromId)!, to = assets.get(toId)!;
      return {from: {asset: from, analysis: withAnalysis ? analysis.get(fromId)! : null, frames: from.file.frames},
        to: {asset: to, analysis: withAnalysis ? analysis.get(toId)! : null, frames: to.file.frames, channels: 1},
        sampleRate: 16000, earliestFrame: 3 * 16000, boundary: {bars: 4, anchorBar: 0}};
    };
    // 90 -> 128 never blends (tempo gap) and cuts on a bar that is a multiple of 4 from bar 1.
    const big = chooseSetTransition(input('synthetic-90', 'synthetic-128-a', true));
    if (big.kind === 'unavailable') assert.fail(big.reason);
    assert.ok(['cut', 'fallback-cut'].includes(big.plan.recipe), big.plan.recipe);
    assert.equal(big.exitBar % 4, 0);
    assert.ok(Math.abs(big.plan.fromExitFrame - downbeatAt(big.fromGrid, big.exitBar)) <= big.fromGrid.barFrames / 8);
    // 122 -> 128 blends (analyzed) or falls back to a one-bar crossfade.
    const near = chooseSetTransition(input('synthetic-122', 'synthetic-128-b', true));
    assert.ok(near.kind !== 'unavailable' && ['blend', 'cut', 'fallback-crossfade'].includes(near.plan.recipe), JSON.stringify(near.kind));
    // Without analysis the requested grid is labelled and the fallback is exactly on the boundary.
    const plain = chooseSetTransition(input('synthetic-122', 'synthetic-128-b', false));
    assert.ok(plain.kind === 'route-free' && plain.plan.recipe === 'fallback-crossfade');
    assert.equal(plain.kind === 'route-free' && plain.fromGrid.source, 'requested');
    assert.equal(plain.kind === 'route-free' && plain.plan.fromExitFrame, downbeatAt(requestedGrid(122), 4));
    assert.ok(plain.notes.some(n => /requested grid/.test(n)));
  } finally { await set.cleanup(); }
});

test('set player: lazy decode, any-to-any transitions at a bar boundary, settled entry mixes out again; pair APIs refuse', async () => {
  const set = await buildSyntheticSet();
  try {
    const loaded = await loadSet(set), context = new SetContext(), {runtime} = countingRuntime();
    const player = new SmallPlayer(context.audio, loaded, null, runtime);
    assert.equal(player.routeFree, true);
    assert.throws(() => player.pair, /no authored pair/);
    assert.throws(() => player.play('a'), /no authored pair/);
    const [s128a, s122, s90, s128b] = SYNTHETIC_SET.map(s => set.idFor(s.id));
    await player.playAsset(s90!);
    assert.equal(context.decodes, 1, 'only the playing song is decoded');
    context.advance(0.5);
    const start = player.snapshot().voices[0]!.start.frame;
    await player.scheduleMixTo(s128a!, {bars: 4, anchor: 'song'});
    assert.equal(context.decodes, 2, 'the next song is decoded on demand');
    let snap = player.snapshot();
    assert.equal(snap.transition, 'scheduled');
    const summary = snap.mix!.summary!;
    assert.ok(['cut', 'fallback-cut'].includes(summary.recipe), summary.recipe);
    assert.equal(summary.set!.toId, s128a);
    assert.equal((summary.set!.exitBar - 1) % 4, 0, 'exit on a 4-bar boundary counted from bar 1');
    assert.equal(snap.transitionAt!.frame, start + summary.fromExitFrame);
    assert.ok(Math.abs(summary.set!.tempoChange - 128 / 90) < 0.05);
    // Run to the end of the handover: the entry graph settles and B can transition onward.
    context.advance((snap.transitionEnd!.frame - player.clock.currentFrame) / 16000 + 0.01);
    snap = player.snapshot();
    assert.equal(snap.voices.length, 1, 'completed transition settled to one voice');
    assert.equal(snap.voices[0]!.source.id, s128a);
    assert.equal(snap.transition, 'none');
    await player.scheduleMixTo(s122!, {bars: 8, anchor: 'song'});
    snap = player.snapshot();
    assert.equal(snap.transition, 'scheduled', 'a song that entered by mix mixes out again');
    assert.equal((snap.mix!.summary!.set!.exitBar - 1) % 8, 0);
    // Cancel before the effect restores the playing song, then go any-to-any to the fourth song.
    assert.equal(player.cancelPendingTransition(), true);
    assert.equal(player.snapshot().voices.length, 1);
    await player.scheduleMixTo(s128b!, {bars: 4, anchor: 'entry'});
    assert.equal(player.snapshot().mix!.summary!.set!.anchor, 'entry');
    await assert.rejects(player.scheduleMixTo(s128b!), /Only one transition/);
    await assert.rejects(new SmallPlayer(context.audio, loaded, null, runtime).scheduleMixTo(s128a!), /Play a set song first/);
    player.stop();
  } finally { await set.cleanup(); }
});

test('set DJ: any-to-any in mix only, queue edits wait for Next, reorder re-targets, direct is refused', async () => {
  const set = await buildSyntheticSet();
  try {
    const loaded = await loadSet(set), context = new SetContext(), {runtime} = countingRuntime();
    const player = new SmallPlayer(context.audio, loaded, null, runtime);
    const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix'});
    assert.equal(dj.setMode, true);
    const ids = SYNTHETIC_SET.map(s => set.idFor(s.id));
    const rev = () => dj.snapshot().control.revision;
    // Queue the set in a custom order: 90, 128-b, 122.
    const q1 = req({type: 'queueTrack', trackId: ids[2]}, rev()); await dj.request(q1);
    const q2 = req({type: 'queueTrack', trackId: ids[3]}, rev()); await dj.request(q2);
    const q3 = req({type: 'queueTrack', trackId: ids[1]}, rev()); await dj.request(q3);
    assert.equal((await dj.request(req({type: 'transport', action: 'play'}, rev()))).execution.status, 'scheduled');
    context.advance(0.5); dj.snapshot();
    assert.equal(dj.snapshot().player.now[0], ids[2], 'Play takes the queue head');
    assert.deepEqual(dj.snapshot().control.queue.map(q => q.commandId), [q2.commandId, q3.commandId]);
    // A queue edit while playing does not move the music.
    const q4 = req({type: 'queueTrack', trackId: ids[0]}, rev());
    const queued = await dj.request(q4);
    assert.equal(queued.execution.status, 'queued');
    assert.equal(dj.snapshot().player.transition, 'none');
    // Reorder: 122 to the head, then Next goes 90 -> 122 at the 4-bar boundary.
    const moved = await dj.request(req({type: 'reorderQueue', queueCommandId: q3.commandId, toIndex: 0}, rev()));
    assert.equal(moved.execution.status, 'applied');
    dj.setSetBoundary({bars: 4, anchor: 'song'});
    const next = await dj.request(req({type: 'nextSong'}, rev()));
    assert.equal(next.execution.status, 'scheduled', next.execution.reason);
    assert.equal(dj.snapshot().pending?.source.id, ids[1]);
    assert.equal(dj.nextArmed, true);
    // Reordering another entry to the head re-targets the outstanding Next before its effect.
    const retarget = await dj.request(req({type: 'reorderQueue', queueCommandId: q4.commandId, toIndex: 0}, rev()));
    assert.equal(retarget.execution.status, 'scheduled', retarget.execution.reason);
    assert.equal(dj.snapshot().pending?.source.id, ids[0], 'now 90 -> 128-a');
    assert.equal(dj.operation(q3.commandId)?.execution.status, 'queued', 'the displaced entry stays queued');
    // Run through the handover; the reserved head is acknowledged and the Next disarms.
    const end = dj.snapshot().pending!.end!.frame;
    context.advance((end - player.clock.currentFrame) / 16000 + 0.01);
    const after = dj.snapshot();
    assert.equal(after.player.now.at(-1), ids[0]);
    assert.equal(after.pending, null);
    assert.equal(dj.nextArmed, false);
    assert.deepEqual(after.control.queue.map(q => q.commandId), [q3.commandId, q2.commandId]);
    // Direct handoff has no authored route in a set.
    dj.setHandoff('direct');
    const refused = await dj.request(req({type: 'nextSong'}, rev()));
    assert.equal(refused.execution.status, 'no-match');
    assert.match(refused.execution.reason, /no authored routes/);
    assert.equal(dj.nextArmed, false);
    await dj.dispose();
  } finally { await set.cleanup(); }
});

test('set DJ: a Next while stopped is not carried into the next Play; a later queue edit does not hand over', async () => {
  const set = await buildSyntheticSet();
  try {
    const loaded = await loadSet(set), context = new SetContext(), {runtime} = countingRuntime();
    const player = new SmallPlayer(context.audio, loaded, null, runtime);
    const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix'});
    const ids = SYNTHETIC_SET.map(s => set.idFor(s.id));
    const rev = () => dj.snapshot().control.revision;
    const early = await dj.request(req({type: 'nextSong'}, rev()));
    assert.equal(early.execution.status, 'queued', early.execution.reason);
    assert.equal(dj.nextArmed, false, 'nothing is playing, so the Next is not armed');
    assert.equal((await dj.request(req({type: 'transport', action: 'play'}, rev()))).execution.status, 'scheduled');
    context.advance(0.5); dj.snapshot();
    const playing = dj.snapshot().player.now[0]!;
    const other = ids.find(id => id !== playing)!;
    const q = req({type: 'queueTrack', trackId: other}, rev());
    assert.equal((await dj.request(q)).execution.status, 'queued');
    const moved = await dj.request(req({type: 'reorderQueue', queueCommandId: q.commandId, toIndex: 0}, rev()));
    assert.equal(moved.execution.status, 'applied', moved.execution.reason);
    assert.equal(dj.snapshot().player.transition, 'none', 'no handover without a fresh Next');
    assert.equal(dj.snapshot().pending, null);
    assert.equal(dj.nextArmed, false);
    await dj.dispose();
  } finally { await set.cleanup(); }
});

test('set player releases the prepared decode when scheduleMixTo is cancelled or fails', async () => {
  const set = await buildSyntheticSet();
  try {
    const loaded = await loadSet(set), context = new SetContext(), {runtime} = countingRuntime();
    const player = new SmallPlayer(context.audio, loaded, null, runtime);
    const retained = () => (player as unknown as {setDecoded: Map<string, unknown>}).setDecoded.size;
    const [s128a, s122, s90] = SYNTHETIC_SET.map(s => set.idFor(s.id));
    await player.playAsset(s90!);
    context.advance(0.5);
    const decodesBefore = context.decodes;
    // Cancelled: a stop during preparation leaves nothing retained.
    const cancelled = player.scheduleMixTo(s128a!);
    player.cancelPendingTransition();
    player.stop();
    await cancelled.catch(() => undefined);
    assert.equal(retained(), 0, 'cancelled preparation released its decode');
    // Failed: a render failure on every attempt rejects and still releases the decode.
    await player.playAsset(s90!);
    context.advance(0.5);
    (player as unknown as {prepareSetIncoming: () => Promise<never>}).prepareSetIncoming = async () => { throw new Error('synthetic render failure'); };
    await assert.rejects(player.scheduleMixTo(s122!), /synthetic render failure/);
    assert.equal(retained(), 0, 'failed preparation released its decode');
    assert.equal(player.snapshot().mix?.phase, 'unavailable');
    assert.equal(player.snapshot().voices.length, 1, 'the playing song is unchanged');
    assert.ok(context.decodes > decodesBefore);
    player.stop();
  } finally { await set.cleanup(); }
});

test('reorderQueue validates the entry and index, bumps the revision and is manual-only', () => {
  const control = new ControlContract({tracks: [{id: 'a', available: true}, {id: 'b', available: true}, {id: 'c', available: true}],
    genres: []}, 0);
  for (const id of ['a', 'b', 'c']) control.accept(req({type: 'queueTrack', trackId: id}, control.snapshot().revision));
  const [qa, , qc] = control.snapshot().queue;
  const before = control.snapshot().revision;
  const ok = control.accept(req({type: 'reorderQueue', queueCommandId: qc!.commandId, toIndex: 0}, before));
  assert.equal(ok.status, 'accepted');
  assert.equal(control.snapshot().revision, before + 1);
  assert.deepEqual(control.snapshot().queue.map(q => q.trackId), ['c', 'a', 'b']);
  const rev = control.snapshot().revision;
  assert.equal((control.accept(req({type: 'reorderQueue', queueCommandId: qa!.commandId, toIndex: 3}, rev)) as {code?: string}).code, 'invalid-request');
  assert.equal((control.accept(req({type: 'reorderQueue', queueCommandId: 'missing', toIndex: 0}, rev)) as {code?: string}).code, 'missing-queue-entry');
  assert.equal((control.accept(req({type: 'reorderQueue', queueCommandId: qa!.commandId, toIndex: -1}, rev)) as {code?: string}).code, 'invalid-request');
  assert.equal((control.accept({...req({type: 'reorderQueue', queueCommandId: qa!.commandId, toIndex: 1}, rev), source: 'automation'}) as {code?: string}).code, 'manual-only');
  control.acknowledgeQueueEntry(qa!.commandId, control.snapshot().revision);
  assert.deepEqual(control.snapshot().queue.map(q => q.trackId), ['c', 'b']);
});

test('requested-grid fallback is labelled when analysis confidence is low', () => {
  const asset = {timing: {bpm: 100, first_downbeat_frame: 0}, file: {sample_rate: 16000}, id: 'x'} as never;
  const weak = {tempo: {bpm: 100, confidence: 0.2}, structure: {downbeatConfidence: 0.9, downbeatFrames: [0, 1]}} as never;
  assert.equal(setBarGrid(asset, weak, 16000).source, 'requested');
  assert.equal(setBarGrid(asset, null, 48000).barFrames, 4 * 60 * 48000 / 100);
});

/** Controlled confident evidence isolates the set blend path from detector accuracy on short tones. */
function confidentRuntime() {
  const base = countingRuntime();
  const runtime: MixPreparationRuntime = {...base.runtime, analyzeOne: async (audio, signal, options) => {
    const analysis = await base.runtime.analyzeOne!(audio, signal, options);
    const bpm = options!.generationBpm!, rate = audio.sampleRate, bar = 4 * 60 * rate / bpm;
    const bars = Math.floor(analysis.frames / bar);
    const downbeats = Array.from({length: bars}, (_, i) => Math.round(i * bar));
    const cue = (barIndex: number) => ({frame: Math.round(barIndex * bar), seconds: barIndex * bar / rate,
      score: 0.9, confidence: 0.9, reasons: ['Controlled set-test cue.']});
    return {...analysis, tempo: {...analysis.tempo, bpm, confidence: 0.95, ambiguity: 0},
      beatGrid: {...analysis.beatGrid, confidence: 0.95},
      structure: {...analysis.structure, downbeatFrames: downbeats, downbeatConfidence: 0.95, phraseConfidence: 0.9,
        phraseFrames: downbeats.filter((_, i) => i % 4 === 0)},
      key: {...analysis.key, tonic: 9, mode: 'minor', name: 'A minor', confidence: 0.9, status: 'estimated'},
      mixOut: [4, 8, 12].map(cue), mixIn: [cue(1)]};
  }};
  return {runtime, calls: base.calls};
}

test('set player blends 122 -> 128 with a returning time map, then mixes the processed song out to 90 on its own bars', async () => {
  const set = await buildSyntheticSet();
  try {
    const loaded = await loadSet(set), context = new SetContext(), {runtime, calls} = confidentRuntime();
    const player = new SmallPlayer(context.audio, loaded, null, runtime);
    const [, s122, s90, s128b] = SYNTHETIC_SET.map(s => set.idFor(s.id));
    await player.playAsset(s122!);
    context.advance(0.5);
    await player.scheduleMixTo(s128b!, {bars: 4, anchor: 'song'});
    let snap = player.snapshot(), summary = snap.mix!.summary!;
    assert.equal(summary.recipe, 'blend');
    assert.equal(summary.processor, 'eutonos-wsola@1');
    assert.equal(summary.returnToOriginalTempo, true);
    assert.equal(calls.render, 1);
    assert.equal(summary.set!.exitBar, 5, 'the first 4-bar boundary after the preparation allowance');
    assert.equal(summary.fromExitFrame, Math.round(4 * 4 * 60 * 16000 / 122));
    context.advance((snap.transitionEnd!.frame - player.clock.currentFrame) / 16000 + 0.01);
    snap = player.snapshot();
    assert.equal(snap.voices.length, 1);
    // The processed song exits after its tempo return, mapped from native bars into its buffer.
    await player.scheduleMixTo(s90!, {bars: 4, anchor: 'song'});
    snap = player.snapshot(); summary = snap.mix!.summary!;
    assert.ok(['cut', 'fallback-cut'].includes(summary.recipe), summary.recipe);
    assert.equal((summary.set!.exitBar - 1) % 4, 0);
    assert.equal(summary.fromHash, loaded.pack.assets.find(a => a.id === s128b)!.file.sha256);
    assert.ok(summary.fromExitFrame >= Math.round(8 * 4 * 60 * 16000 / 128), 'native exit after the blend entry and tempo return');
    assert.equal(calls.analyzeOne, 3, 'each song analyzed once (cache hit for the processed song)');
    player.stop();
  } finally { await set.cleanup(); }
});

test('180/181s stereo 48k set really blends within the unchanged render budget, joins native B ahead and then mixes out', async () => {
  const rate = 48000;
  const songs = [{id: 'long-122', bpm: 122, seconds: 180, stereo: true, transitionEvidence: true, gain: 0.5},
    {id: 'long-128', bpm: 128, seconds: 181, stereo: true, transitionEvidence: true, gain: 0.2}];
  const set = await buildSyntheticSet(songs, rate);
  try {
    const loaded = await loadSet(set), context = new SetContext(rate), base = countingRuntime();
    const renders: number[] = [], analyzed: number[] = [];
    const runtime: MixPreparationRuntime = {...base.runtime,
      analyzeOne: async (audio, signal, options, levelAudio) => { analyzed.push(audio.channels[0]!.length); return base.runtime.analyzeOne!(audio, signal, options, levelAudio); },
      render: async (audio, options, signal) => { renders.push(audio.channels[0]!.length * audio.channels.length); return base.runtime.render(audio, options, signal); }};
    const player = new SmallPlayer(context.audio, loaded, null, runtime);
    await player.playAsset(set.idFor('long-122'));
    context.advance(0.5);
    const nativeB = await decodeRecording(loaded, context.audio, loaded.pack.assets.find(a => a.id === set.idFor('long-128'))!);
    await player.scheduleMixTo(set.idFor('long-128'), {bars: 4, anchor: 'song'});
    let snap = player.snapshot(), summary = snap.mix!.summary!;
    assert.equal(summary.recipe, 'blend', JSON.stringify(snap.mix));
    assert.equal(summary.set!.fromGrid, 'measured'); assert.equal(summary.set!.toGrid, 'measured');
    const join = summary.nativeJoin!;
    assert.ok(join && join.at.frame > snap.transitionAt!.frame + Math.round(8 * 60 * rate / summary.fromBpm));
    assert.ok(snap.transitionEnd!.frame < join.at.frame, 'A handover slot ends before B finishes its owned tempo return');
    assert.equal(context.sources.length, 3, 'A plus the bounded processed entry and ahead-scheduled native continuation');
    const processed = context.sources[1]!, native = context.sources[2]!;
    assert.equal(native.starts[0]!.when * rate, join.at.frame);
    assert.equal(native.starts[0]!.offset * rate, join.sourceFrame);
    assert.equal(processed.buffer!.length, join.outputFrame);
    for (let c = 0; c < 2; c++) assert.equal(processed.buffer!.getChannelData(c).at(-1), nativeB.buffer.getChannelData(c)[join.sourceFrame - 1], 'last prepared sample is the exact native predecessor');
    assert.ok(renders[0]! < TIME_PITCH_LIMITS.maxSamples / 4 && renders[0]! < 181 * rate * 2 / 10);
    assert.equal(TIME_PITCH_LIMITS.maxSamples, 12_000_000); assert.equal(SET_LIMITS.maxDecodedSongBytes, 128 * 1024 * 1024);
    assert.ok(analyzed.every(frames => frames <= SONG_ANALYSIS_WINDOW.seconds * rate));
    assert.equal(player.cancelPendingTransition(), true, 'before effect, cancellation releases both incoming one-shots');
    assert.ok(processed.stops.length > 0 && native.stops.length > 0);
    assert.equal(player.snapshot().voices.length, 1);

    await player.scheduleMixTo(set.idFor('long-128'), {bars: 4, anchor: 'song'});
    snap = player.snapshot(); summary = snap.mix!.summary!;
    await player.pause(); const frozen = player.clock.currentFrame; context.advance(100);
    assert.equal(player.clock.currentFrame, frozen); await player.resume();
    const originalEntryNode = context.sources.at(-2)!, originalNativeNode = context.sources.at(-1)!;
    const originalEntry = originalNativeNode.starts[0]!;
    context.advance((snap.transitionEnd!.frame - player.clock.currentFrame) / rate + 0.01);
    snap = player.snapshot();
    assert.equal(snap.voices.length, 1); assert.equal(snap.transition, 'none');
    assert.ok(player.clock.currentFrame < summary.nativeJoin!.at.frame);
    assert.ok(originalEntryNode.connections.length > 0, 'the processed B entry remains owned and audible before its native join');
    const rendersBefore = renders.length;
    await player.scheduleMixTo(set.idFor('long-122'), {bars: 4, anchor: 'song'});
    const following = player.snapshot();
    assert.ok(renders.length > rendersBefore, 'Next preparation actually starts before the prior native join');
    assert.ok(following.mix!.earliestEffect!.frame >= summary.nativeJoin!.at.frame, 'new effect waits for native source coordinates');
    assert.equal(following.transitionAt!.frame,
      Math.round(originalEntry.when * rate + following.mix!.summary!.fromExitFrame - originalEntry.offset * rate));
    assert.equal(player.cancelPendingTransition(), true);
    assert.equal(originalEntryNode.stops.length, 0, 'cancelling Next preserves the still-finishing B entry');
    assert.deepEqual(originalNativeNode.starts, [originalEntry], 'the original native join is never restarted');
    assert.equal(originalNativeNode.stops.at(-1)! * rate, player.snapshot().voices[0]!.endFrame,
      'cancelling the new exit restores the original B native EOF');
    assert.ok(context.sources.slice(-2).every(n => n.connections.length === 0), 'only the new future incoming branches are released');
    const aheadStarts = context.sources.map(n => n.starts.length);
    context.advance((summary.nativeJoin!.at.frame - player.clock.currentFrame) / rate + 0.01);
    snap = player.snapshot(); assert.equal(snap.voices.length, 1); assert.equal(snap.now[0], set.idFor('long-128'));
    assert.deepEqual(context.sources.map(n => n.starts.length), aheadStarts, 'settlement starts no source');
    await player.scheduleMixTo(set.idFor('long-122'), {bars: 4, anchor: 'song'});
    snap = player.snapshot();
    assert.equal(snap.mix!.summary!.recipe, 'blend', 'native B can be the next outgoing song');
    assert.equal(snap.transitionAt!.frame,
      Math.round(originalEntry.when * rate + snap.mix!.summary!.fromExitFrame - originalEntry.offset * rate), 'next exit uses original-song coordinates on the unchanged clock');
    player.stop();
    assert.ok(context.sources.slice(-2).every(n => n.stops.length > 0), 'Stop releases entry and future native source');

    // Native-start failure must stop the already-started entry and leave no audible orphan.
    const fault = new SetContext(rate), create = fault.createBufferSource.bind(fault);
    fault.createBufferSource = () => {
      const node = create();
      if (fault.sources.length === 1) {
        const stop = node.stop.bind(node);
        node.stop = when => { stop(when); throw new Error('injected cleanup stop failure'); };
      }
      if (fault.sources.length === 2) node.start = () => { throw new Error('injected native start failure'); };
      return node;
    };
    const preparedRecording = {asset: nativeB.asset, buffer: processed.buffer!,
      processed: {sourceFrames: nativeB.buffer.length, outputFrames: processed.buffer!.length, algorithm: 'eutonos-wsola@1'},
      continuation: {buffer: nativeB.buffer, sourceFrame: join.sourceFrame}};
    const source = new RecordedSource(fault.audio, preparedRecording, fault.destination, {allowUnreviewed: true});
    const clock = new WebAudioClock(fault.audio); await source.prepare(clock);
    assert.throws(() => source.scheduleMixStart(clock.stamp(100), 0, equalPowerCrossfade(1600, rate).incoming), /injected native start failure/);
    assert.equal(fault.sources[0]!.stops.length, 1); source.release();
    assert.ok(fault.sources.every(n => n.connections.length === 0));
    await checkLateAuto(set, loaded);
    await checkSelectedSetRecipes(set, loaded);
  } finally { await set.cleanup(); }
});

async function checkSelectedSetRecipes(set: Awaited<ReturnType<typeof buildSyntheticSet>>, loaded: LoadedBrowserPack): Promise<void> {
  const rate = 48000, context = new SetContext(rate), {runtime} = countingRuntime();
  const player = new SmallPlayer(context.audio, loaded, null, runtime);
  const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix', mix: {recipe: 'loudness-match'}});
  const rev = () => dj.snapshot().control.revision;
  await dj.request(req({type: 'queueTrack', trackId: set.idFor('long-122')}, rev()));
  await dj.request(req({type: 'queueTrack', trackId: set.idFor('long-128')}, rev()));
  await dj.request(req({type: 'transport', action: 'play'}, rev())); context.advance(0.5);
  await dj.request(req({type: 'nextSong'}, rev()));
  let snap = dj.snapshot().player, summary = snap.mix!.summary!;
  assert.equal(summary.recipe, 'loudness-match', JSON.stringify(summary));
  assert.deepEqual([summary.levelMatch!.from.channels, summary.levelMatch!.to.channels], [2, 2]);
  const incomingGain = summary.levelMatch!.toGain;
  assert.ok(incomingGain > 0 && incomingGain <= 4);
  dj.setMixOptions({recipe: 'filter-sweep'});
  assert.equal(dj.snapshot().player.mix!.summary!.recipe, 'loudness-match', 'future choice does not alter committed effect');
  const starts = context.sources.map(n => n.starts.length);
  context.advance((snap.transitionEnd!.frame - player.clock.currentFrame) / rate + 0.01);
  snap = dj.snapshot().player;
  assert.equal(snap.now[0], set.idFor('long-128'));
  assert.ok(player.clock.currentFrame < summary.nativeJoin!.at.frame, 'DJ Next is accepted during the still-owned tempo return');
  assert.deepEqual(context.sources.map(n => n.starts.length), starts);
  // Requeue A so a second match must use the gain already audible on B.
  await dj.request(req({type: 'queueTrack', trackId: set.idFor('long-122')}, rev()));
  dj.setMixOptions({recipe: 'loudness-match', fromLevelGain: 3});
  await dj.request(req({type: 'nextSong'}, rev()));
  summary = dj.snapshot().player.mix!.summary!;
  assert.equal(summary.recipe, 'loudness-match');
  assert.equal(summary.levelMatch!.fromGain, incomingGain, 'continued native source gain overrides caller hint');
  assert.equal(player.cancelPendingTransition(), true);
  assert.ok(context.sources.slice(-2).every(n => n.stops.length > 0));
  await dj.dispose();
}

async function checkLateAuto(set: Awaited<ReturnType<typeof buildSyntheticSet>>, loaded: LoadedBrowserPack): Promise<void> {
    const context = new SetContext(48000), {runtime} = countingRuntime();
    const player = new SmallPlayer(context.audio, loaded, null, runtime);
    await player.playAsset(set.idFor('long-128')); context.advance(110);
    await player.scheduleMixTo(set.idFor('long-122'), {bars: 64, anchor: 'entry'});
    const snap = player.snapshot(), summary = snap.mix!.summary!;
    assert.equal(summary.recipe, 'blend', JSON.stringify(snap.mix));
    assert.equal(summary.set!.exitBar, 65, 'window-local bar 9 remains song bar 65');
    assert.ok(summary.fromExitFrame > 119 * 48000);
    const asset = loaded.pack.assets.find(a => a.id === set.idFor('long-128'))!;
    const key0 = MixAnalysisCache.key(asset, 48000), keyLater = MixAnalysisCache.key(asset, 48000, 100 * 48000);
    assert.notEqual(key0, keyLater, 'window coordinates are part of analysis identity');
    player.stop();
}

test('explicit native ramp, brake and finite loop own real clock motion, cancellation and subsequent native exits', async () => {
  const songs = [120, 144, 90, 128].map(bpm => ({id: `style-${bpm}`, bpm, tonic: bpm === 144 ? 0 : 9, bars: 20, transitionEvidence: true, gain: 0.5}));
  const set = await buildSyntheticSet(songs);
  try {
    const loaded = await loadSet(set);
    for (const recipe of ['tempo-ramp', 'brake', 'loop-extend'] as const) {
      const context = new SetContext(), {runtime, calls} = countingRuntime(), player = new SmallPlayer(context.audio, loaded, null, runtime);
      const from = set.idFor(recipe === 'brake' ? 'style-90' : 'style-120');
      const to = set.idFor(recipe === 'tempo-ramp' ? 'style-144' : 'style-128');
      await player.playAsset(from); context.advance(0.5);
      const naturalEnd = player.snapshot().voices[0]!.endFrame;
      await player.scheduleMixTo(to, {bars: 4, anchor: 'song'}, {recipe});
      let snap = player.snapshot(), summary = snap.mix!.summary!;
      assert.equal(summary.recipe, recipe, JSON.stringify(snap.mix));
      const effect = snap.mix!.earliestEffect!.frame, entry = snap.transitionAt!.frame;
      if (recipe === 'tempo-ramp') {
        assert.ok(summary.tempoRatio < 0.92); assert.equal(summary.processor, 'native-rate@1'); assert.equal(calls.render, 0);
        assert.equal(context.sources[1]!.playbackRate.value, summary.nativeRate!.incoming!.start, 'rate initialized before partial start quantum');
        assert.ok(context.sources[1]!.playbackRate.calls.some(c => c.kind === 'ramp' && c.value === 1));
        assert.ok(context.sources[0]!.playbackRate.calls.some(c => c.kind === 'ramp' && c.value > 1));
      } else {
        assert.equal(entry - effect, summary.entryDelayFrames);
        assert.ok(entry > effect);
        if (recipe === 'loop-extend') {
          assert.equal(summary.entryDelayFrames, summary.loopExtension!.frames, 'exact added duration, not an ordinary source prelude');
          assert.equal(summary.fromExitFrame, summary.loopExtension!.endFrame, 'native source coordinates remain native');
          const loop = context.sources.at(-1)!;
          assert.equal(loop.starts[0]!.when * 16000, effect); assert.equal(context.sources[0]!.stops.at(-1)! * 16000, effect + 320);
          assert.equal(loop.buffer!.length, summary.entryDelayFrames! + Math.round(8 * 60 * 16000 / summary.fromBpm));
        }
      }
      assert.equal(player.cancelPendingTransition(), true);
      assert.equal(player.snapshot().voices[0]!.endFrame, naturalEnd);
      assert.equal(context.sources[0]!.stops.at(-1)! * 16000, naturalEnd);
      assert.ok(context.sources.slice(1).every(n => n.stops.length > 0 && n.connections.length === 0));
      if (recipe !== 'loop-extend') assert.ok(context.sources[0]!.playbackRate.calls.some(c => c.kind === 'set' && c.value === 1));
      await player.scheduleMixTo(to, {bars: 4, anchor: 'song'}, {recipe});
      snap = player.snapshot(); summary = snap.mix!.summary!;
      if (summary.entryDelayFrames) {
        context.advance((snap.mix!.earliestEffect!.frame - player.clock.currentFrame) / 16000 + 0.001);
        assert.equal(player.snapshot().mix!.phase, 'prelude'); assert.equal(player.snapshot().now.length, 1);
        assert.equal(player.cancelPendingTransition(), false, 'earliest A effect closes cancellation before B enters');
        if (recipe === 'loop-extend') { context.sources[0]!.finish(); assert.ok(context.sources.at(-1)!.connections.length > 0, 'original onended does not release finite loop'); }
      }
      context.advance((snap.transitionEnd!.frame - player.clock.currentFrame) / 16000 + 0.01);
      assert.equal(player.snapshot().now[0], to);
      if (recipe === 'tempo-ramp') {
        const start = snap.transitionAt!.frame, nativeEntry = summary.toEntryFrame, ramp = summary.nativeRate!.incoming!;
        const nativeLength = context.sources.at(-1)!.buffer!.length;
        assert.equal(player.snapshot().voices[0]!.endFrame, start + Math.round(nativeRateOutputAt(ramp, nativeLength - nativeEntry)) + 256);
        await player.scheduleMixTo(set.idFor('style-120'), {bars: 4, anchor: 'song'}, {recipe: 'tempo-ramp'});
        const next = player.snapshot(), exit = next.mix!.summary!.fromExitFrame;
        assert.equal(next.mix!.summary!.recipe, 'tempo-ramp', JSON.stringify(next.mix));
        assert.equal(next.transitionAt!.frame, start + Math.round(nativeRateOutputAt(ramp, exit - nativeEntry)), 'Next uses inverse integrated native map');
      }
      player.stop(); assert.ok(context.sources.every(n => n.connections.length === 0), 'Stop releases every live/future owned branch');
    }
    await checkLoopDj(set, loaded);
    for (const failure of ['start', 'stop', 'allocation', 'splice-gain', 'connect', 'graph'] as const) {
      const context = new SetContext(), create = context.createBufferSource.bind(context);
      const gains = context.createGain.bind(context);
      let spliceGains = 0, graphArmed = false, graphThrown = false;
      let graphParameter: ParameterDouble | null = null;
      context.createGain = () => {
        if (context.sources.length === 4 && failure === 'splice-gain' && ++spliceGains === 2) throw new Error('injected loop splice gain failure');
        const node = gains(), ramp = node.gain.linearRampToValueAtTime.bind(node.gain);
        node.gain.linearRampToValueAtTime = (value, at) => {
          if (context.sources.length === 4 && failure === 'graph' && !graphThrown) {
            // S20 filters persist across voices. Fault the delegated native schedule after
            // an actual attenuation event was recorded, so rollback must erase its future fade.
            if (graphArmed) { graphThrown = true; throw new Error('injected loop graph failure'); }
            const result = ramp(value, at);
            if (value < 1) { graphArmed = true; graphParameter = node.gain as unknown as ParameterDouble; }
            return result;
          }
          return ramp(value, at);
        };
        return node;
      };
      context.createBufferSource = () => {
        if (context.sources.length === 3 && failure === 'allocation') throw new Error('injected loop allocation failure');
        const node = create();
        if (context.sources.length === 4) {
          if (failure === 'start' || failure === 'stop') node[failure] = () => { throw new Error(`injected loop ${failure} failure`); };
          if (failure === 'connect') node.connect = () => { throw new Error('injected loop connect failure'); };
        }
        return node;
      };
      const {runtime} = countingRuntime(), player = new SmallPlayer(context.audio, loaded, null, runtime);
      await player.playAsset(set.idFor('style-120')); context.advance(0.5);
      const end = player.snapshot().voices[0]!.endFrame;
      const retainedGains = new Map(context.gains.map(node => [node, [...node.connections]]));
      await assert.rejects(player.scheduleMixTo(set.idFor('style-128'), {bars: 4, anchor: 'song'}, {recipe: 'loop-extend'}), /injected loop/);
      assert.equal(player.snapshot().voices.length, 1); assert.equal(player.snapshot().voices[0]!.endFrame, end);
      assert.equal(context.sources[0]!.stops.at(-1)! * 16000, end);
      assert.ok(context.sources.slice(1).every(n => n.connections.length === 0), 'failed loop and both B branches disconnected');
      assert.ok(context.gains.filter(node => !retainedGains.has(node)).every(node => node.connections.length === 0),
        'partially allocated splice/graph gains are released');
      for (const [node, connections] of retainedGains) assert.deepEqual(node.connections, connections,
        'persistent deck/master gains and the retained A source keep their original topology');
      assert.equal(context.sources[0]!.connections.length, 1, 'A direct graph restored');
      if (failure === 'graph') {
        assert.equal(graphThrown, true, 'delegated scheduling failure was actually injected');
        const parameter = graphParameter as ParameterDouble | null; assert.ok(parameter);
        const afterCancel = parameter.calls.slice(parameter.calls.map(call => call.kind).lastIndexOf('cancel') + 1);
        assert.ok(afterCancel.length > 0 && afterCancel.every(call => call.kind !== 'cancel' && call.value === 1),
          'rollback removes the previously recorded future attenuation from the native A fader');
      }
      context.advance(Math.min(25, (end - 1) / 16000 - context.currentTime));
      const controls = player.deckSnapshot()!.a.controls;
      assert.equal(controls.gain, 1, 'failed handover must not leave a future muted A');
      assert.equal(controls.low.value, 0); assert.equal(controls.highPassHz, 0); assert.equal(controls.lowPassHz, 8000);
      player.stop();
    }
    for (const failure of ['late', 'unstable'] as const) {
      const context = new SetContext(), base = countingRuntime(), entered = deferred(), gate = deferred();
      const runtime: MixPreparationRuntime = {...base.runtime, renderLoop: async (...args) => {
        entered.release(); await gate.promise;
        if (failure === 'unstable') throw new Error('Measured loop is unstable.');
        return base.runtime.renderLoop!(...args);
      }};
      const player = new SmallPlayer(context.audio, loaded, null, runtime);
      await player.playAsset(set.idFor('style-120')); context.advance(0.5);
      const task = player.scheduleMixTo(set.idFor('style-128'), {bars: 4, anchor: 'song'}, {recipe: 'loop-extend'});
      await entered.promise; if (failure === 'late') context.advance(20); gate.release(); await task;
      const snap = player.snapshot();
      assert.ok(['cut', 'fallback-crossfade', 'fallback-cut'].includes(snap.mix!.summary!.recipe), JSON.stringify(snap.mix));
      assert.ok(snap.mix!.earliestEffect!.frame > player.clock.currentFrame);
      assert.equal(context.sources.length, 2, 'missed/refused loop never allocates an audible loop or processed B branch');
      player.stop();
    }
    // Pair preparation also accepts genuine decoded PCM. The v0 authored route's equal-
    // tempo gate remains unchanged; do not fabricate a compatible route for these gaps.
    for (const recipe of ['tempo-ramp', 'brake', 'loop-extend'] as const) {
      const a = loaded.pack.assets.find(a => a.id === set.idFor(recipe === 'brake' ? 'style-90' : 'style-120'))!;
      const b = loaded.pack.assets.find(a => a.id === set.idFor(recipe === 'tempo-ramp' ? 'style-144' : 'style-128'))!;
      const context = new SetContext(), {runtime} = countingRuntime();
      const from = await decodeRecording(loaded, context.audio, a), to = await decodeRecording(loaded, context.audio, b);
      const ready = await prepareMixTransition(context.audio, from, to, {recipe, minimumFromFrame: 4 * 16000,
        returnToOriginalTempo: recipe === 'loop-extend'}, undefined, runtime);
      assert.ok(ready.kind === 'ready', JSON.stringify(ready)); assert.equal(ready.plan.recipe, recipe);
      if (recipe !== 'loop-extend') assert.equal(ready.incoming.buffer, to.buffer, 'native pair preparation retains original PCM');
    }
  } finally { await set.cleanup(); }
});

async function checkLoopDj(set: Awaited<ReturnType<typeof buildSyntheticSet>>, loaded: LoadedBrowserPack): Promise<void> {
  const context = new SetContext(), {runtime} = countingRuntime(), player = new SmallPlayer(context.audio, loaded, null, runtime);
  const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix', mix: {recipe: 'loop-extend'}});
  const command = (action: Record<string, unknown>) => dj.request(req(action, dj.snapshot().control.revision));
  await command({type: 'queueTrack', trackId: set.idFor('style-120')});
  await command({type: 'queueTrack', trackId: set.idFor('style-128')});
  await command({type: 'transport', action: 'play'}); context.advance(0.5);
  const naturalEnd = dj.snapshot().player.voices[0]!.endFrame;
  await command({type: 'nextSong'});
  assert.equal(dj.snapshot().player.mix!.summary!.recipe, 'loop-extend');
  const queued = dj.snapshot().control.queue[0]!;
  const priorLoop = context.sources.at(-1)!;
  await command({type: 'queueTrack', trackId: set.idFor('style-90')});
  const alternate = dj.snapshot().control.queue.find(q => q.trackId === set.idFor('style-90'))!;
  await command({type: 'reorderQueue', queueCommandId: alternate.commandId, toIndex: 0});
  assert.ok(priorLoop.stops.length > 1 && priorLoop.connections.length === 0, 'reorder releases superseded finite loop');
  await command({type: 'reorderQueue', queueCommandId: queued.commandId, toIndex: 0});
  await command({type: 'hold', enabled: true});
  assert.equal(dj.snapshot().player.transition, 'scheduled', 'Hold preserves an explicit manual Next');
  assert.equal(dj.snapshot().control.queue[0]!.commandId, queued.commandId, 'Hold retains FIFO');
  assert.equal((await command({type: 'cancelNext'})).execution.status, 'applied');
  assert.equal(player.snapshot().voices[0]!.endFrame, naturalEnd);
  await command({type: 'hold', enabled: false}); await command({type: 'nextSong'});
  assert.equal((await command({type: 'cancelNext'})).execution.status, 'applied');
  assert.equal(player.snapshot().voices[0]!.endFrame, naturalEnd);
  await command({type: 'nextSong'});
  const snap = dj.snapshot().player;
  context.advance((snap.mix!.earliestEffect!.frame - player.clock.currentFrame) / 16000 + 0.001);
  assert.equal(dj.snapshot().player.mix!.phase, 'prelude');
  assert.equal((await command({type: 'cancelNext'})).execution.status, 'blocked');
  assert.equal(dj.snapshot().player.now.length, 1, 'B is still future during owned A loop');
  await command({type: 'transport', action: 'stop'});
  assert.ok(context.sources.every(n => n.connections.length === 0)); await dj.dispose();
}
