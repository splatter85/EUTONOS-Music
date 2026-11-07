import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {MusicLibrary, LIBRARY_LIMITS, decodeLibrarySnapshot, emptyLibrary,
  type LibraryStorage, type PlaybackObservation} from '../src/library.js';
import {FileLibraryStorage} from '../src/library-file.js';
import {canonicalJson, digestJson, LibraryError, MAX_LIBRARY_BYTES} from '../src/library-codec.js';
import {captureRecipeReplay, createRecipeStudyPack} from '../src/recipe-library.js';
import {S01_RECIPE, S11_RECIPE_FAMILIES} from '../src/phrase-plan.js';

const raw = JSON.parse(await readFile(new URL('../../fixtures/s01/manifest.json', import.meta.url), 'utf8'));
const pack = createRecipeStudyPack(raw, {id: 's11-fixture-studies', revision: 1}, S01_RECIPE);
const replay = await captureRecipeReplay(pack,
  {recipe: S11_RECIPE_FAMILIES[0], seed: 42, state: 'explore', allowFixtures: true});
class MemoryStorage implements LibraryStorage {
  raw: string | null = null;
  fail = false;
  async read(): Promise<string | null> { return this.raw; }
  async compareAndSwap(expected: string | null, next: string): Promise<boolean> {
    if (this.fail) throw new LibraryError('storage', 'injected write failure');
    if (this.raw !== expected) return false;
    this.raw = next; return true;
  }
}
async function setup(storage: LibraryStorage = new MemoryStorage()) {
  const library = new MusicLibrary(storage);
  const first = await library.registerPack(pack, 0);
  const saved = await library.saveVibe({id: 'quiet', label: 'Quiet study', replay}, first.revision);
  return {library, saved, storage};
}
function event(id: string): PlaybackObservation {
  return {id, playback_id: 'playback-one', kind: 'started', observed_at: '2026-11-07T21:00:00.000Z',
    engine_generation: 1, at_frame: 0, replay};
}
const code = (value: LibraryError['code']) => (error: unknown) => error instanceof LibraryError && error.code === value;

test('catalogue stores immutable exact metadata and prevents same-reference replacement', async () => {
  const {library, saved} = await setup();
  assert.equal(saved.revision, 2);
  assert.equal(saved.catalogue[0]!.sha256, await digestJson(pack));
  assert.ok(Object.isFrozen(saved.catalogue[0]!.pack.assets));
  assert.equal((await library.registerPack(pack, 0)).revision, 2, 'identical registration is idempotent');
  const changed = structuredClone(pack);
  Object.assign(changed.assets[0]!, {title: 'Changed metadata'});
  await assert.rejects(library.registerPack(changed, 2), code('conflict'));
  assert.equal((await library.read()).revision, 2);
  Object.assign(changed, {revision: 2});
  assert.equal((await library.registerPack(changed, 2)).catalogue.length, 2, 'old revision remains available');
});

test('saved selection reopens stopped, retains preferences, and cannot silently choose new metadata', async () => {
  const {library, storage, saved} = await setup();
  await library.setPreferences({volume: 0.25, muted: true}, saved.revision);
  const reopened = new MusicLibrary(storage), restored = await reopened.restore('quiet');
  assert.deepEqual(Object.keys(restored).sort(), ['preferences', 'requires_explicit_play', 'transport', 'vibe']);
  assert.equal(restored.transport, 'stopped');
  assert.equal(restored.requires_explicit_play, true);
  assert.deepEqual(restored.preferences, {volume: 0.25, muted: true});
  assert.equal((await reopened.resolveVibe('quiet', pack, {allowFixtures: true})).seed, 42);
  await assert.rejects(reopened.resolveVibe('quiet', pack), /eligibility/);
  await assert.rejects(reopened.resolveVibe('quiet', {...pack, revision: 2}, {allowFixtures: true}), code('unavailable'));
  const removed = await reopened.removeVibe('quiet', 3);
  assert.equal(removed.vibes.length, 0);
  assert.equal(removed.catalogue.length, 1);
  await assert.rejects(reopened.restore('quiet'), code('unavailable'));
});

test('stale revisions and simultaneous writers never silently overwrite saved state', async () => {
  const storage = new MemoryStorage(), first = new MusicLibrary(storage), second = new MusicLibrary(storage);
  const results = await Promise.allSettled([
    first.setPreferences({volume: 0.2, muted: false}, 0),
    second.setPreferences({volume: 0.8, muted: true}, 0),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await first.read()).revision, 1);
  const before = storage.raw;
  await assert.rejects(second.setPreferences({volume: 0.5, muted: false}, 0), code('conflict'));
  assert.equal(storage.raw, before);
});

test('invalid, future, oversized and digest-corrupt snapshots are preserved instead of reset', async () => {
  const storage = new MemoryStorage(), library = new MusicLibrary(storage);
  for (const bad of [
    '{', JSON.stringify({...emptyLibrary(), schema_version: 'em.music-library.v99'}),
    ' '.repeat(MAX_LIBRARY_BYTES + 1),
    JSON.stringify({...emptyLibrary(), catalogue: [{pack, sha256: '0'.repeat(64)}]}),
    JSON.stringify({...emptyLibrary(), transport: 'playing'}),
  ]) {
    storage.raw = bad;
    await assert.rejects(library.read());
    await assert.rejects(library.setPreferences({volume: 0.5, muted: false}, 0));
    assert.equal(storage.raw, bad);
  }
});

test('saved/historical references and input fields are validated before a write', async () => {
  const {library, storage} = await setup();
  const before = await storage.read();
  await assert.rejects(library.saveVibe({id: 'missing', label: 'Missing',
    replay: {...replay, pack_sha256: '0'.repeat(64)}}, 2), code('unavailable'));
  await assert.rejects(library.recordObservation({...event('invalid'), kind: 'scheduled'} as unknown as PlaybackObservation, 2));
  await assert.rejects(library.recordObservation({...event('invalid'), at_frame: -1}, 2));
  await assert.rejects(library.recordObservation({...event('invalid'), observed_at: 'yesterday'}, 2));
  await assert.rejects(library.setPreferences({volume: NaN, muted: false}, 2));
  assert.equal(await storage.read(), before);
});

test('renderer history deduplicates retained IDs, detects collisions and reports bounded retention', async () => {
  const {library} = await setup();
  let state = await library.recordObservation(event('event-0'), 2);
  assert.equal((await library.recordObservation(event('event-0'), 0)).revision, state.revision);
  await assert.rejects(library.recordObservation({...event('event-0'), kind: 'ended'}, state.revision), code('conflict'));
  for (let i = 1; i < LIBRARY_LIMITS.history + 2; i++) {
    state = await library.recordObservation(event('event-' + i), state.revision);
  }
  assert.equal(state.history.length, LIBRARY_LIMITS.history);
  assert.equal(state.history[0]!.id, 'event-2');
  assert.equal(state.dropped_history, 2);
  assert.equal(state.catalogue.length, 1);
  // Deduplication deliberately does not claim a lifetime ledger after an ID is pruned.
  state = await library.recordObservation(event('event-0'), state.revision);
  assert.equal(state.dropped_history, 3);
  assert.equal(state.history.at(-1)!.id, 'event-0');
});

test('write failure leaves the old snapshot readable and retryable', async () => {
  const storage = new MemoryStorage(), {library} = await setup(storage), before = storage.raw;
  storage.fail = true;
  await assert.rejects(library.setPreferences({volume: 0.1, muted: true}, 2), code('storage'));
  assert.equal(storage.raw, before);
  storage.fail = false;
  assert.equal((await library.setPreferences({volume: 0.1, muted: true}, 2)).revision, 3);
});

test('file adapter survives reopen, CAS conflict, uncertain lock and invalid UTF-8 without losing data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emf-s11-library-'));
  try {
    const storage = await FileLibraryStorage.open(directory), {library} = await setup(storage);
    const second = await FileLibraryStorage.open(directory);
    assert.equal((await new MusicLibrary(second).restore('quiet')).transport, 'stopped');
    const before = await storage.read();
    assert.equal(await second.compareAndSwap(null, canonicalJson(emptyLibrary())), false);
    await writeFile(join(directory, 'library.lock'), 'other-owner');
    await assert.rejects(library.setPreferences({volume: 0.1, muted: true}, 2), code('storage'));
    assert.equal(await storage.read(), before);
    assert.equal(await readFile(join(directory, 'library.lock'), 'utf8'), 'other-owner');
    await rm(join(directory, 'library.lock'));
    await library.setPreferences({volume: 0.1, muted: true}, 2);
    assert.deepEqual((await readdir(directory)).sort(), ['library.json']);
    await writeFile(join(directory, 'library.json'), new Uint8Array([0xff]));
    await assert.rejects(library.read(), code('invalid'));
    await assert.rejects(library.setPreferences({volume: 0.4, muted: false}, 3), code('invalid'));
    assert.deepEqual([...await readFile(join(directory, 'library.json'))], [0xff]);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('independent file adapter writers cannot both commit the same expected snapshot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emf-s11-cas-'));
  try {
    const a = await FileLibraryStorage.open(directory), b = await FileLibraryStorage.open(directory);
    const outcomes = await Promise.allSettled([
      a.compareAndSwap(null, canonicalJson({...emptyLibrary(), revision: 1})),
      b.compareAndSwap(null, canonicalJson({...emptyLibrary(), revision: 2})),
    ]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled' && item.value).length, 1);
    assert.ok([1, 2].includes((await decodeLibrarySnapshot(await a.read())).revision));
    assert.deepEqual((await readdir(directory)).sort(), ['library.json']);
  } finally { await rm(directory, {recursive: true, force: true}); }
});

test('a committed file save with failed lock cleanup explicitly requires reconciliation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emf-s11-reconcile-'));
  try {
    const storage = await FileLibraryStorage.open(directory), read = storage.read.bind(storage);
    // Simulate external damage to the owned lock after acquisition. Cleanup must not
    // delete that now-unrecognized lock or report that the committed snapshot was lost.
    storage.read = async () => {
      const previous = await read();
      await writeFile(join(directory, 'library.lock'), 'changed-lock-owner');
      return previous;
    };
    await assert.rejects(storage.compareAndSwap(null, canonicalJson({...emptyLibrary(), revision: 1})), code('reconcile'));
    assert.equal((await decodeLibrarySnapshot(await read())).revision, 1);
    assert.equal(await readFile(join(directory, 'library.lock'), 'utf8'), 'changed-lock-owner');
  } finally { await rm(directory, {recursive: true, force: true}); }
});
