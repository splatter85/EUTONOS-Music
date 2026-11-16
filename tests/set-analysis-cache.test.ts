import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import type {AudioAsset} from '../src/pack-types.js';
import type {DecodedRecording} from '../src/web-audio.js';
import {analyzeMixAudio, measureMixLevel, nativeSamplePeak} from '../src/mix-analysis.js';
import {MixAnalysisCache, type MixPreparationRuntime} from '../src/mix-transition.js';
import {PersistentSetAnalysisCache, decodeAnalysis, encodeAnalysis} from '../web/set-analysis-cache.js';
import type {AnalysisStorage, StoredAnalysis} from '../web/analysis-storage.js';
import {WAVEFORM_BINS, WAVEFORM_VERSION, type SongWaveform} from '../web/set-waveform.js';
import {measuredSongLabel} from '../web/set-song-list.js';
import {deferred} from './audio-double.js';

function recording(hash = 'a', rate = 8000): DecodedRecording {
  const frames = rate * 12, channels = [new Float32Array(frames), new Float32Array(frames)];
  for (let i = 0; i < frames; i++) {
    const beat = (i % (rate / 2)) / rate;
    const value = 0.04 * Math.sin(2 * Math.PI * 440 * i / rate) + 0.2 * Math.exp(-beat * 60) * Math.sin(2 * Math.PI * 80 * i / rate);
    channels[0]![i] = value; channels[1]![i] = -value;
  }
  const asset = {id: 'cache-' + hash, title: 'Synthetic cache signal', source_kind: 'recording',
    timing: {bpm: 120, meter: [4, 4]}, file: {sha256: hash.repeat(64), frames, sample_rate: rate, channels: 2}} as unknown as AudioAsset;
  const buffer = {sampleRate: rate, length: frames, duration: frames / rate, numberOfChannels: 2,
    getChannelData: (channel: number) => channels[channel]!} as AudioBuffer;
  return {asset, buffer};
}
const wave = async (buffer: AudioBuffer): Promise<SongWaveform> => ({version: WAVEFORM_VERSION,
  sampleRate: buffer.sampleRate, frames: buffer.length, channels: buffer.numberOfChannels,
  peaks: Array(WAVEFORM_BINS).fill(0.24) as number[]});
function runtime() {
  let calls = 0, peaks = 0;
  const value: MixPreparationRuntime = {
    analyze: async () => { throw new Error('Unexpected pair analysis.'); },
    render: async () => { throw new Error('No rendering belongs in the analysis cache.'); },
    analyzeOne: async (audio, _signal, options, levelAudio) => {
      calls++; return {...analyzeMixAudio(audio, options), level: measureMixLevel(levelAudio ?? audio)};
    },
    scanPeak: async audio => { peaks++; return nativeSamplePeak(audio); },
  };
  return {value, get calls() { return calls; }, get peaks() { return peaks; }};
}
class MemoryStorage implements AnalysisStorage {
  readonly rows = new Map<string, StoredAnalysis>();
  reads = 0; writes = 0; removes = 0;
  async read(key: string): Promise<unknown> { this.reads++; return structuredClone(this.rows.get(key)); }
  async latest(identity: string): Promise<unknown> {
    return structuredClone([...this.rows.values()].filter(row => row.identity === identity).sort((a, b) => b.usedAt - a.usedAt)[0]);
  }
  async write(row: StoredAnalysis): Promise<void> { this.writes++; this.rows.set(row.key, structuredClone(row)); }
  async remove(key: string, expected?: unknown): Promise<void> {
    const prior = expected as StoredAnalysis | undefined, current = this.rows.get(key);
    if (!prior || current?.key === prior.key && current?.identity === prior.identity &&
      current?.payload === prior.payload && current?.digest === prior.digest) { this.removes++; this.rows.delete(key); }
  }
}
async function prepared(start = 0) {
  const song = recording(), store = new MemoryStorage(), run = runtime(), cache = new PersistentSetAnalysisCache(store, wave);
  const result = await cache.analyze(song, run.value, undefined, start);
  assert.ok(result.ok); await cache.flush();
  return {song, store, run, result, cache};
}

test('persistent cache reuses the canonical key and restores exact successful evidence without workers', async () => {
  const {song, store, result} = await prepared();
  const key = MixAnalysisCache.key(song.asset, song.buffer.sampleRate);
  assert.equal(store.rows.size, 1); assert.ok(store.rows.has(key));
  const run = runtime(), cache = new PersistentSetAnalysisCache(store, wave);
  const restored = await cache.analyze(song, run.value);
  assert.deepEqual(restored, result); assert.equal(run.calls, 0); assert.equal(run.peaks, 0);
  assert.equal(cache.presentation(song.asset, 8000).source, 'saved'); await cache.flush();
});

test('a nonzero persisted analysis window stays in full native coordinates on reuse', async () => {
  const start = 16000, {song, store, result} = await prepared(start);
  const run = runtime(), restored = await new PersistentSetAnalysisCache(store, wave).analyze(song, run.value, undefined, start);
  assert.deepEqual(restored, result); assert.equal(run.calls, 0);
  assert.ok(restored.ok); assert.equal(restored.analysis.frames, song.buffer.length);
  assert.equal(restored.analysis.analyzedWindow!.startFrame, start);
  assert.ok(restored.analysis.energyCurve.every(point => point.startFrame >= start));
  assert.equal(restored.analysis.level!.startFrame, start);
});

test('concurrent callers share disk lookup and computation; one abort does not cancel another', async () => {
  const song = recording(), store = new MemoryStorage(), cache = new PersistentSetAnalysisCache(store, wave);
  const entered = deferred(), gate = deferred(), run = runtime(), original = run.value.analyzeOne!;
  const slow: MixPreparationRuntime = {...run.value, analyzeOne: async (...args) => { entered.release(); await gate.promise; return original(...args); }};
  const abort = new AbortController(), first = cache.analyze(song, slow, abort.signal), second = cache.analyze(song, slow);
  await entered.promise; abort.abort(); await assert.rejects(first, /cancelled/);
  gate.release(); assert.ok((await second).ok);
  assert.equal(store.reads, 1); assert.equal(run.calls, 1); await cache.flush();
});

test('an already aborted request starts no shared work or waveform', async () => {
  const song = recording(), store = new MemoryStorage(), run = runtime(), cache = new PersistentSetAnalysisCache(store, wave);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(cache.analyze(song, run.value, abort.signal), /cancelled/);
  assert.equal(store.reads, 0); assert.equal(run.calls, 0); assert.equal(cache.size, 0);
});

test('failed shared analyses are not persisted or retained and the next request retries', async () => {
  const song = recording(), store = new MemoryStorage(), cache = new PersistentSetAnalysisCache(store, wave), run = runtime();
  let attempts = 0;
  const failing: MixPreparationRuntime = {...run.value, analyzeOne: async () => { attempts++; throw new Error('synthetic refusal'); }};
  const results = await Promise.all([cache.analyze(song, failing), cache.analyze(song, failing)]);
  assert.ok(results.every(result => !result.ok)); assert.equal(attempts, 1); await cache.flush();
  assert.equal(cache.has(song.asset, 8000), false); assert.equal(store.rows.size, 0);
  assert.ok((await cache.analyze(song, run.value)).ok); await cache.flush(); assert.equal(run.calls, 1);
});

test('unavailable storage preserves the canonical memory path', async () => {
  const bad: AnalysisStorage = {read: async () => { throw new Error('denied'); }, latest: async () => { throw new Error('denied'); },
    write: async () => { throw new Error('denied'); }, remove: async () => { throw new Error('denied'); }};
  const song = recording(), run = runtime(), cache = new PersistentSetAnalysisCache(bad, wave);
  const first = await cache.analyze(song, run.value), second = await cache.analyze(song, run.value);
  assert.ok(first.ok && second.ok); assert.equal(first, second); assert.equal(run.calls, 1);
  await cache.flush(); assert.equal(cache.presentation(song.asset, 8000).source, 'session');
});

test('persistent writes cannot delay a ready analysis', {timeout: 3000}, async () => {
  const song = recording(), store = new MemoryStorage(), run = runtime(), entered = deferred(), gate = deferred();
  store.write = async () => { entered.release(); await gate.promise; };
  const cache = new PersistentSetAnalysisCache(store, wave);
  assert.ok((await cache.analyze(song, run.value)).ok);
  await entered.promise; assert.ok(cache.has(song.asset, 8000)); gate.release(); await cache.flush();
});

test('quota failure leaves a successful session entry intact', async () => {
  const song = recording(), store = new MemoryStorage(), run = runtime();
  store.write = async () => { throw new Error('quota'); };
  const cache = new PersistentSetAnalysisCache(store, wave);
  assert.ok((await cache.analyze(song, run.value)).ok); await cache.flush();
  assert.ok((await cache.analyze(song, run.value)).ok); assert.equal(run.calls, 1); assert.equal(store.rows.size, 0);
});

test('a bad checksum is a miss, removes only that record and recomputes canonically', async () => {
  const {song, store} = await prepared(), key = MixAnalysisCache.key(song.asset, 8000);
  const row = store.rows.get(key)!; store.rows.set(key, {...row, payload: row.payload + ' '});
  const unrelated = {...row, key: 'unrelated', identity: 'unrelated'}; store.rows.set(unrelated.key, unrelated);
  const run = runtime(), cache = new PersistentSetAnalysisCache(store, wave);
  assert.ok((await cache.analyze(song, run.value)).ok); await cache.flush();
  assert.equal(run.calls, 1); assert.ok(store.removes >= 1); assert.deepEqual(store.rows.get('unrelated'), unrelated);
});

test('checksummed corrupt dimensions, versions, keys, coordinates and arrays are never planner evidence', async () => {
  const {song, store} = await prepared(), row = store.rows.get(MixAnalysisCache.key(song.asset, 8000))!;
  const alterations: ((body: any) => void)[] = [
    body => { body.version = 'old'; }, body => { body.frames--; }, body => { body.channels = 1; },
    body => { body.analysis.version = 'old'; }, body => { body.analysis.nativePeak.frames--; },
    body => { body.analysis.analyzedWindow.startFrame++; }, body => { body.analysis.key.tonic = 99; },
    body => { body.analysis.key.status = 'certain'; }, body => { body.analysis.tempo.candidates = [null]; },
    body => { body.analysis.beatGrid.frames = [-1]; }, body => { body.analysis.limitations = ['x'.repeat(1025)]; },
    body => { body.waveform.peaks = [0]; }, body => { body.analysis.energyCurve[0].startFrame = 0.5; },
    body => { body.analysis.level.startFrame = 8; },
    body => { body.analysis.level.startFrame = '0'; },
    body => { body.analysis.energyCurve[0].startFrame = '0'; },
    body => { body.analysis.beatGrid.frames = ['0']; },
    body => { body.analysis.structure.downbeatFrames = ['0']; },
    body => { body.analysis.structure.phraseFrames = ['0']; },
  ];
  for (const alter of alterations) {
    const body = JSON.parse(row.payload); alter(body);
    const payload = JSON.stringify(body), bad = {...row, payload, digest: createHash('sha256').update(payload).digest('hex')};
    await assert.rejects(decodeAnalysis(bad, song.asset, {sampleRate: 8000, frames: song.buffer.length, channels: 2}));
    const saved = new MemoryStorage(); saved.rows.set(bad.key, bad);
    const run = runtime(), cache = new PersistentSetAnalysisCache(saved, wave);
    assert.ok((await cache.analyze(song, run.value)).ok); await cache.flush(); assert.equal(run.calls, 1);
  }
});

test('SHA, requested BPM, decoded rate and window start remain distinct cache identities', async () => {
  const {song, store} = await prepared();
  const altered = [
    {...song, asset: {...song.asset, file: {...song.asset.file, sha256: 'b'.repeat(64)}}},
    {...song, asset: {...song.asset, timing: {...song.asset.timing!, bpm: 128}}}, recording('a', 16000),
  ];
  for (const other of altered) {
    const run = runtime(), cache = new PersistentSetAnalysisCache(store, wave);
    assert.ok((await cache.analyze(other, run.value)).ok); await cache.flush(); assert.equal(run.calls, 1);
  }
  const run = runtime(), cache = new PersistentSetAnalysisCache(store, wave);
  assert.ok((await cache.analyze(song, run.value, undefined, 8000)).ok); await cache.flush(); assert.equal(run.calls, 1);
  assert.equal(store.rows.size, 5);
});

test('session front cache evicts by use and rejects invalid native windows before work', async () => {
  const song = recording(), run = runtime(), cache = new PersistentSetAnalysisCache(null, wave, 2);
  await cache.analyze(song, run.value); await cache.analyze(song, run.value, undefined, 8000);
  await cache.analyze(song, run.value); await cache.analyze(song, run.value, undefined, 16000);
  assert.equal(cache.size, 2); assert.ok(cache.has(song.asset, 8000)); assert.equal(cache.has(song.asset, 8000, 8000), false);
  for (const start of [-1, 0.5, song.buffer.length]) await assert.rejects(cache.analyze(song, run.value, undefined, start), /native song window/);
  await cache.flush();
});

test('display restoration reads small saved metadata and waveform without native audio or workers', async () => {
  const {song, store, result} = await prepared();
  let waves = 0;
  const cache = new PersistentSetAnalysisCache(store, async () => { waves++; throw new Error('No decode was requested.'); });
  await cache.restore(song.asset, 8000);
  const data = cache.presentation(song.asset, 8000);
  assert.deepEqual(data.analysis, result.analysis); assert.equal(data.waveform?.peaks.length, WAVEFORM_BINS);
  assert.equal(data.source, 'saved'); assert.equal(waves, 0);
  await cache.restore(song.asset, 48000); assert.equal(cache.presentation(song.asset, 48000).analysis, null);
});

test('display restore accepts decoder rounding while planner reuse requires exact native dimensions', async () => {
  for (const delta of [-1, 1]) {
    const original = recording(), nominal = original.buffer.length - delta;
    const song = {...original, asset: {...original.asset, file: {...original.asset.file, frames: nominal}}};
    const store = new MemoryStorage(), computed = runtime(), first = new PersistentSetAnalysisCache(store, wave);
    assert.ok((await first.analyze(song, computed.value)).ok); await first.flush();
    const row = store.rows.get(MixAnalysisCache.key(song.asset, 8000))!;
    await assert.rejects(decodeAnalysis(row, song.asset, {sampleRate: 8000, frames: nominal, channels: 2}), /native dimensions/);
    const restored = new PersistentSetAnalysisCache(store, async () => { throw new Error('Saved waveform must be used.'); });
    await restored.restore(song.asset, 8000);
    const view = restored.presentation(song.asset, 8000);
    assert.equal(view.analysis?.frames, song.buffer.length); assert.equal(store.rows.size, 1);
    const reused = runtime(); assert.ok((await restored.analyze(song, reused.value)).ok); await restored.flush();
    assert.equal(reused.calls, 0); assert.equal(reused.peaks, 0);
  }
});

test('saved waveform validation publishes an immutable copy', async () => {
  const {song, store} = await prepared(), row = store.rows.get(MixAnalysisCache.key(song.asset, 8000))!;
  const decoded = await decodeAnalysis(row, song.asset, {sampleRate: 8000, frames: song.buffer.length, channels: 2});
  assert.ok(Object.isFrozen(decoded.waveform)); assert.ok(Object.isFrozen(decoded.waveform!.peaks));
  assert.throws(() => { (decoded.waveform!.peaks as number[])[0] = 9; }, TypeError);
  const cache = new PersistentSetAnalysisCache(store, wave); await cache.restore(song.asset, 8000);
  assert.ok(Object.isFrozen(cache.presentation(song.asset, 8000).waveform));
});

test('decoded waveform observation is independent of analysis and retries a failed job', async () => {
  const song = recording(), store = new MemoryStorage(); let attempts = 0;
  const cache = new PersistentSetAnalysisCache(store, async buffer => { if (++attempts === 1) throw new Error('worker stopped'); return wave(buffer); });
  cache.observe(song); await cache.flush();
  assert.equal(cache.presentation(song.asset, 8000).waveform, null);
  cache.observe(song); await cache.flush();
  assert.equal(cache.presentation(song.asset, 8000).waveform?.frames, song.buffer.length);
  assert.equal(cache.presentation(song.asset, 8000).analysis, null); assert.equal(store.rows.size, 0); assert.equal(attempts, 2);
});

test('waveform queue holds only one running and one queued native buffer', {timeout: 3000}, async () => {
  const songs = [recording('a'), recording('b'), recording('c')], gates = [deferred(), deferred(), deferred()];
  let started = 0;
  const cache = new PersistentSetAnalysisCache(null, async buffer => { const i = started++; await gates[i]!.promise; return wave(buffer); });
  songs.forEach(song => cache.observe(song));
  assert.equal(cache.presentation(songs[0]!.asset, 8000).wavePending, true);
  assert.equal(cache.presentation(songs[1]!.asset, 8000).wavePending, true);
  assert.equal(cache.presentation(songs[2]!.asset, 8000).wavePending, false);
  gates[0]!.release(); gates[1]!.release(); await cache.flush(); assert.equal(started, 2);
  cache.observe(songs[2]!); gates[2]!.release(); await cache.flush(); assert.equal(started, 3);
});

test('BPM/key display distinguishes estimates and never promotes an ambiguous alternative', async () => {
  const {result, cache} = await prepared();
  const ambiguous = {...result.analysis, key: {...result.analysis.key, name: null, tonic: null, mode: null, status: 'ambiguous' as const}};
  assert.match(measuredSongLabel(ambiguous), /Key uncertain/);
  const insufficient = {...ambiguous, tempo: {...ambiguous.tempo, bpm: null}};
  assert.equal(measuredSongLabel(insufficient), 'Tempo uncertain · Key uncertain');
  const stored = await encodeAnalysis(recording().asset, result.analysis, 2, null);
  assert.ok(stored.digest.length === 64); await cache.flush();
});
