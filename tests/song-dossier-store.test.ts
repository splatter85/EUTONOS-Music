// Dossier store (memory, IndexedDB-like local, relay) and the background scheduler, with fake analysis:
// priority order, nothing while a handover is busy, one song at a time, version invalidation, relay-down
// fallback, backoff and the progress line. No audio and no browser; engineering checks only.
import assert from 'node:assert/strict';
import test from 'node:test';
import {currentKey, dossierId, isCurrentFor, type DossierIdentity, type SongDossier} from '../web/song-dossier.js';
import {DossierScheduler, DossierStore, RelayDossierRemote, type AnalyseResult, type DossierLocal, type DossierRemote, type SchedulerOrder, type SchedulerSong} from '../web/song-dossier-store.js';
import {identity, sampleDossier} from './helpers/dossier-fixtures.js';

class MemoryLocal implements DossierLocal {
  readonly rows = new Map<string, SongDossier>();
  gets = 0;
  async get(id: string): Promise<SongDossier | null> { this.gets++; return this.rows.get(id) ?? null; }
  async put(dossier: SongDossier): Promise<void> { this.rows.set(dossierId(dossier.key), dossier); }
}
class FakeRemote implements DossierRemote {
  readonly rows = new Map<string, SongDossier>();
  down = false;
  gets = 0; puts = 0;
  async get(id: string): Promise<SongDossier | null> { this.gets++; if (this.down) throw new Error('relay down'); return this.rows.get(id) ?? null; }
  async put(dossier: SongDossier): Promise<void> { this.puts++; if (this.down) throw new Error('relay down'); this.rows.set(dossierId(dossier.key), dossier); }
}
const songs = (n: number): SchedulerSong[] => Array.from({length: n}, (_, i) => ({id: `s${i + 1}`, identity: identity(i + 1)}));
/** A dossier for the song's identity under any analysis tag (the content is irrelevant to scheduling). */
const dossierFor = (song: SchedulerSong, analysis?: string): SongDossier => {
  const base = sampleDossier(1);
  return {...base, key: analysis ? currentKey(song.identity, analysis) : currentKey(song.identity)};
};
interface Rig {scheduler: DossierScheduler; store: DossierStore; local: MemoryLocal; remote: FakeRemote; analysed: string[]; flags: {busy: boolean; order: SchedulerOrder; warm: Set<string>; now: number};
  active: {count: number; max: number}}
function rig(n: number, options: {analysis?: string; fail?: Set<string>; list?: SchedulerSong[]; withRemote?: boolean} = {}): Rig {
  const local = new MemoryLocal(), remote = new FakeRemote();
  const store = new DossierStore(local, options.withRemote === false ? null : remote, options.analysis);
  const flags = {busy: false, order: {nowPlaying: null, next: null, queue: []} as SchedulerOrder, warm: new Set<string>(), now: 1_000_000};
  const analysed: string[] = [], active = {count: 0, max: 0};
  const list = options.list ?? songs(n);
  const scheduler = new DossierScheduler({store, songs: () => list, order: () => flags.order, busy: () => flags.busy, now: () => flags.now,
    planWarm: song => flags.warm.has(song.id), ...(options.analysis ? {analysis: options.analysis} : {}),
    analyse: async (song): Promise<AnalyseResult> => {
      active.count++; active.max = Math.max(active.max, active.count);
      await new Promise(resolve => setImmediate(resolve));
      active.count--; analysed.push(song.id);
      if (options.fail?.has(song.id)) return {ok: false, reason: 'decode failed'};
      flags.warm.add(song.id);
      return {ok: true, dossier: dossierFor(song, options.analysis)};
    }});
  return {scheduler, store, local, remote, analysed, flags, active};
}
const drain = async (r: Rig, limit = 50): Promise<string[]> => {
  const results: string[] = [];
  for (let i = 0; i < limit; i++) { const step = await r.scheduler.step(); results.push(step); if (step === 'idle' || step === 'busy') break; }
  return results;
};

test('songs are analysed in priority order: now playing, next, queue order, then the rest', async () => {
  const r = rig(6);
  r.flags.order = {nowPlaying: 's4', next: 's6', queue: ['s2', 's5']};
  await drain(r);
  assert.deepEqual(r.analysed, ['s4', 's6', 's2', 's5', 's1', 's3']);
  assert.equal(r.scheduler.progress().text, 'Analysed 6/6 · next ready');
});

test('a promoted song jumps the queue without waiting for the running job', async () => {
  const r = rig(4);
  r.flags.order = {nowPlaying: null, next: 's2', queue: ['s3']};
  r.scheduler.promote('s4');
  await r.scheduler.step();
  assert.deepEqual(r.analysed, ['s4']);
  await r.scheduler.step();
  assert.deepEqual(r.analysed, ['s4', 's2']);
});

test('nothing is analysed while a handover is being prepared or mixed, and work resumes after', async () => {
  const r = rig(3);
  r.flags.busy = true;
  assert.equal(await r.scheduler.step(), 'busy');
  assert.equal(await r.scheduler.step(), 'busy');
  assert.deepEqual(r.analysed, [], 'no analysis during a handover');
  assert.match(r.scheduler.progress().text, /paused during handover/);
  r.flags.busy = false;
  assert.equal(await r.scheduler.step(), 'analysed');
  assert.equal(r.analysed.length, 1);
});

test('only one song is analysed at a time, even when steps overlap', async () => {
  const r = rig(5);
  await Promise.all([r.scheduler.step(), r.scheduler.step(), r.scheduler.step()]);
  assert.equal(r.active.max, 1);
  assert.equal(r.analysed.length, 1, 'an overlapping step does not start a second job');
});

test('the start loop analyses the whole set one at a time and then idles', async () => {
  const r = rig(4);
  let waits = 0;
  const scheduler = new DossierScheduler({store: r.store, songs: () => songs(4), order: () => r.flags.order, busy: () => false,
    analyse: async song => { r.active.count++; r.active.max = Math.max(r.active.max, r.active.count); await new Promise(res => setImmediate(res)); r.active.count--; r.analysed.push(song.id); return {ok: true, dossier: dossierFor(song)}; },
    wait: async () => { waits++; if (waits > 2) scheduler.stop(); await new Promise(res => setImmediate(res)); }});
  scheduler.start();
  while (waits <= 2) await new Promise(res => setImmediate(res));
  assert.deepEqual(r.analysed, ['s1', 's2', 's3', 's4']);
  assert.equal(r.active.max, 1);
  assert.equal(scheduler.progress().analysed, 4);
});

test('a stored dossier is used with no analysis: memory, then local, then relay, written back to local', async () => {
  const r = rig(2);
  const [a, b] = songs(2) as [SchedulerSong, SchedulerSong];
  r.local.rows.set(dossierId(dossierFor(a).key), dossierFor(a));
  r.remote.rows.set(dossierId(dossierFor(b).key), dossierFor(b));
  await drain(r);
  assert.deepEqual(r.analysed, [], 'both came from storage');
  assert.equal(r.remote.gets, 1, 'the relay was asked only for the song IndexedDB did not have');
  assert.ok(r.local.rows.has(dossierId(dossierFor(b).key)), 'the relay copy was cached locally');
  assert.equal(r.scheduler.progress().analysed, 2);
});

test('an older analysis version is never used for planning and is re-analysed lazily', async () => {
  const [song] = songs(1) as [SchedulerSong];
  const old = rig(1, {list: [song]});
  old.local.rows.set(dossierId(dossierFor(song, 'song-dossier@0+mix-analysis-v4').key), dossierFor(song, 'song-dossier@0+mix-analysis-v4'));
  old.local.rows.set(dossierId(dossierFor(song).key), dossierFor(song, 'song-dossier@0+mix-analysis-v4'));
  await drain(old);
  assert.deepEqual(old.analysed, ['s1'], 'a dossier under an older version (even misfiled under the current id) does not count');
  assert.ok(isCurrentFor(old.local.rows.get(dossierId(dossierFor(song).key))!, song.identity), 'the fresh dossier replaced it');
  // A version bump: dossiers saved under v1 are missing under v2.
  const v1 = rig(3, {analysis: 'song-dossier@1+x'});
  await drain(v1);
  assert.equal(v1.scheduler.progress().analysed, 3);
  const v2 = new DossierScheduler({store: new DossierStore(v1.local, v1.remote, 'song-dossier@2+x'), analysis: 'song-dossier@2+x', songs: () => songs(3), order: () => v1.flags.order, busy: () => false,
    analyse: async song => ({ok: true, dossier: dossierFor(song, 'song-dossier@2+x')})});
  assert.equal(await v2.step(), 'analysed');
  assert.equal(v2.progress().analysed, 1, 'only the re-analysed song is current under v2');
  assert.equal(v1.local.rows.size, 4, 'the three v1 dossiers stay stored beside the one new v2 dossier');
});

test('relay down: analysis proceeds, dossiers are kept locally, queued and sent when the relay returns', async () => {
  const r = rig(3);
  r.remote.down = true;
  await drain(r);
  assert.equal(r.analysed.length, 3, 'a down relay never blocks analysis');
  assert.equal(r.local.rows.size, 3, 'kept in the local store');
  assert.equal(r.store.unsyncedCount, 3);
  assert.match(r.scheduler.progress().text, /PC store not reachable/);
  r.remote.down = false;
  assert.equal(await r.store.flush(), 0);
  assert.equal(r.remote.rows.size, 3);
  assert.ok(!r.store.relayDown);
  assert.ok(!/not reachable/.test(r.scheduler.progress().text));
});

test('with no relay token the store is local only and still works', async () => {
  const r = rig(2, {withRemote: false});
  await drain(r);
  assert.equal(r.local.rows.size, 2);
  assert.equal(r.store.hasRemote, false);
  assert.equal(await r.store.flush(), 0);
});

test('a failed song is skipped for a while, reported, and retried after the back-off', async () => {
  const r = rig(3, {fail: new Set(['s2'])});
  const results = await drain(r);
  assert.deepEqual(results.filter(x => x === 'failed'), ['failed']);
  assert.match(r.scheduler.progress().text, /Analysed 2\/3 · 1 could not be analysed/);
  assert.equal(await r.scheduler.step(), 'idle', 'not retried inside the back-off');
  r.flags.now += 61_000;
  assert.equal(await r.scheduler.step(), 'failed', 'retried after it');
});

test('the next song must be ready AND in the planner cache before it counts as next ready', async () => {
  const r = rig(3);
  const [a] = songs(1) as [SchedulerSong];
  r.local.rows.set(dossierId(dossierFor(a).key), dossierFor(a));
  r.flags.order = {nowPlaying: null, next: 's1', queue: ['s2', 's3']};
  await r.scheduler.lookupAll();
  assert.match(r.scheduler.progress().text, /Analysed 1\/3 · next not ready yet/, 'a dossier alone does not warm the planner cache');
  await r.scheduler.step();
  assert.equal(r.analysed[0], 's1', 'the next song is warmed first even though its dossier exists');
  assert.match(r.scheduler.progress().text, /next ready/);
  await drain(r);
  assert.equal(r.analysed.filter(x => x === 's1').length, 1, 'warmed once, not in a loop');
});

test('the relay client sends the token, parses what it gets back and refuses a mismatched dossier', async () => {
  const seen: {url: string; method: string; token: string | null}[] = [];
  const store = new Map<string, string>();
  const fake: typeof fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? 'GET';
    seen.push({url, method, token: (init?.headers as Record<string, string>)['X-Relay-Token'] ?? null});
    if (method === 'POST') { const d = JSON.parse(String(init?.body)) as SongDossier; store.set(dossierId(d.key), String(init?.body)); return new Response('{"ok":true}', {status: 200}); }
    const id = new URL(url).searchParams.get('key')!;
    if (id === 'swap') return new Response(JSON.stringify(sampleDossier(9)), {status: 200});
    return store.has(id) ? new Response(store.get(id), {status: 200}) : new Response('{}', {status: 404});
  };
  const remote = new RelayDossierRemote('http://127.0.0.1:7777', 'tok', fake);
  const d = sampleDossier(1);
  await remote.put(d);
  assert.deepEqual(await remote.get(dossierId(d.key)), d);
  assert.equal(await remote.get(dossierId(sampleDossier(2).key)), null, '404 is a miss');
  assert.ok(seen.every(s => s.token === 'tok' && s.url.startsWith('http://127.0.0.1:7777/api/dj/dossier')));
  await assert.rejects(remote.get(dossierId(sampleDossier(5).key)).then(() => remote.get('swap')), /./, 'unknown id');
});
