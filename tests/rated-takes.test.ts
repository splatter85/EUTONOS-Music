import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {importRatedTakes, RATED_INTAKE_LIMITS, selectSet, setAssetId, type RatedCatalog, type RatedTake} from '../src/rated-takes.js';
import {importDelivery} from '../src/importer.js';
import {parseSetArgument, runRatedIntake} from '../scripts/import-rated-takes.js';
import {loadBrowserPack, MAX_AUDITION_BYTES} from '../src/browser-pack.js';
import {eligibleForPlayback, validatePackManifest} from '../src/pack.js';
import {loadPack} from '../src/node.js';
import {SmallPlayer} from '../src/player.js';
import {DeterministicDj} from '../src/dj.js';
import {CONTROL_VERSION} from '../src/control.js';
import {ContextDouble} from './audio-double.js';

const hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const json = (v: unknown) => Buffer.from(JSON.stringify(v));
function wav(): Uint8Array {
  const frames = 68000, bytes = new Uint8Array(44 + frames * 2), d = new DataView(bytes.buffer);
  const tag = (at: number, v: string) => bytes.set(new TextEncoder().encode(v), at);
  tag(0, 'RIFF'); d.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, 8000, true); d.setUint32(28, 16000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  tag(36, 'data'); d.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) d.setInt16(44 + i * 2, Math.round(6000 * Math.sin(i / 13)), true);
  return bytes;
}
type Extra = readonly (readonly ['love' | 'like' | 'dislike', string, number])[];
/** Default: one 120 BPM take per rating. `extra` appends takes (rating, id, requested BPM) to their rating set. */
async function fixture(extra: Extra = []) {
  const root = await mkdtemp(join(tmpdir(), 'rated-test-')), source = join(root, 'source'), out = join(root, 'out');
  await mkdir(source);
  const audio = wav(), recipe = json({seed: 9, caption: 'Synthetic test only; inert data', nested: {model: 'synthetic@1'}});
  const takes: RatedTake[] = [];
  const sets = [];
  for (const rating of ['love', 'like', 'dislike'] as const) {
   const group: RatedTake[] = [];
   const base = {love: 'take-a', like: 'take-b', dislike: 'take-c'}[rating];
   for (const [id, bpm] of [[base, 120] as const, ...extra.filter(e => e[0] === rating).map(e => [e[1], e[2]] as const)]) {
    await mkdir(join(source, rating, id), {recursive: true});
    const files = {audio: {path: `${id}/take.wav`, sha256: hash(audio), bytes: audio.length},
      recipe: {path: `${id}/recipe.json`, sha256: hash(recipe), bytes: recipe.length},
      dj_audio: {path: `${id}/audition.wav`, sha256: hash(audio), bytes: audio.length}};
    await writeFile(join(source, rating, files.audio.path), audio);
    await writeFile(join(source, rating, files.recipe.path), recipe);
    await writeFile(join(source, rating, files.dj_audio.path), audio);
    const take: RatedTake = {id, title: `Synthetic ${id}`, rating, duration_seconds: 8.5,
      tempo: {bpm, source: 'requested'}, key: {value: 'A minor', source: 'requested'}, ...files};
    takes.push(take); group.push(take);
   }
    await writeFile(join(source, rating, 'manifest.json'), json({schema_version: 'music-studio.rated-set.v1', rating, takes: group}));
    sets.push({rating, manifest: `${rating}/manifest.json`});
  }
  await writeFile(join(source, 'manifest.json'), json({schema_version: 'music-studio.rated-export.v1', sets}));
  return {root, source, out, takes, cleanup: () => rm(root, {recursive: true, force: true})};
}
async function changeSet(source: string, group: string, change: (data: any) => void) {
  const path = join(source, group, 'manifest.json'), data = JSON.parse(await readFile(path, 'utf8'));
  change(data); await writeFile(path, json(data));
}
async function browserReader(out: string): Promise<typeof fetch> {
  return async input => {
    const u = new URL(String(input));
    return new Response(new Uint8Array(await readFile(join(out, ...u.pathname.slice(1).split('/')))));
  };
}

test('inventory preserves every rating, original/recipe/audio bytes and hashes without a playback pair', async () => {
  const f = await fixture();
  try {
    const catalog = await importRatedTakes(f.source, f.out);
    assert.equal(catalog.pair, null);
    assert.deepEqual(catalog.takes.map(t => t.rating), ['love', 'like', 'dislike']);
    for (const t of catalog.takes) for (const kind of ['audio', 'recipe', 'dj_audio'] as const) {
      const bytes = await readFile(join(f.out, t[kind].path));
      assert.equal(hash(bytes), t[kind].sha256);
      assert.deepEqual(bytes, await readFile(join(f.source, t.rating, t[kind].path.replace(`inventory/${t.rating}/`, ''))));
    }
    assert.deepEqual(JSON.parse(await readFile(join(f.out, 'catalog.json'), 'utf8')), catalog);
    assert.match(catalog.limits.join(' '), /negative examples.*never selected automatically/);
    await assert.rejects(importRatedTakes(f.source, f.out), /OUTPUT_EXISTS/);
  } finally { await f.cleanup(); }
});

test('explicit requested-grid pair stays unreviewed, retains full frames and records a zero-overlap cut', async () => {
  const f = await fixture();
  try {
    const catalog = await importRatedTakes(f.source, f.out, {pair: ['take-a', 'take-b']});
    assert.equal(catalog.pair!.transition, 'zero-overlap-cut');
    assert.equal(catalog.set, null, 'pair mode records no set');
    const {pack} = await loadPack(join(f.out, 'pack'));
    assert.equal(pack.routes[0]!.overlap_quarters, 0);
    assert.ok(pack.assets.every(a => a.eligibility === 'unreviewed' && a.key === null && a.harmony_pitch_classes === null));
    assert.ok(pack.assets.every(a => a.file.frames === 68000 && a.timing!.bars === 4));
    assert.ok(pack.assets.every(a => a.rights.allowed_uses.join(',') === 'playback'));
    assert.equal(eligibleForPlayback(pack.assets[0]!, true), false);
    assert.equal(eligibleForPlayback(pack.assets[0]!, true, true), true);
    const fetcher = await browserReader(f.out), url = new URL('http://127.0.0.1/pack/manifest.json');
    await assert.rejects(loadBrowserPack(url, true, fetcher), /not eligible/);
    const loaded = await loadBrowserPack(url, true, fetcher, {allowUnreviewed: true, maxBytes: MAX_AUDITION_BYTES});
    assert.equal(loaded.pack.assets[0]!.eligibility, 'unreviewed');
    const receipt = JSON.parse(await readFile(join(f.out, 'pack', 'IMPORT.json'), 'utf8'));
    assert.equal(receipt.browser_player.result, 'refused', 'ordinary loader admission remains refused');
  } finally { await f.cleanup(); }
});

test('DJ schedules the selected direction on one clock; A stops exactly when B starts and Stop remains available', async () => {
  const f = await fixture();
  try {
    const catalog = await importRatedTakes(f.source, f.out, {pair: ['take-b', 'take-a']});
    const loaded = await loadBrowserPack(new URL('http://127.0.0.1/pack/manifest.json'), true, await browserReader(f.out), {allowUnreviewed: true});
    const context = new ContextDouble(8000), player = new SmallPlayer(context.audio, loaded, 's16-a-to-b');
    const dj = new DeterministicDj(player, loaded);
    const play = await dj.request({schemaVersion: CONTROL_VERSION, commandId: 'play', expectedRevision: 0, source: 'manual', type: 'transport', action: 'play'});
    assert.notEqual(play.execution.status, 'failed');
    assert.equal(player.snapshot().requested, catalog.pair!.asset_ids[0], 'route A starts first even when the source IDs sort in reverse order');
    const next = await dj.request({schemaVersion: CONTROL_VERSION, commandId: 'next', expectedRevision: dj.snapshot().control.revision, source: 'manual', type: 'nextSong'});
    assert.equal(next.execution.status, 'scheduled');
    const boundary = context.sources[1]!.starts[0]!.when;
    assert.equal(context.sources[0]!.stops.at(-1), boundary);
    context.currentTime = boundary;
    assert.deepEqual(player.snapshot().now, [catalog.pair!.asset_ids[1]]);
    assert.equal(player.snapshot().transition, 'complete');
    player.stop(); assert.deepEqual(player.snapshot().now, []);
    await dj.dispose();
  } finally { await f.cleanup(); }
});

test('zero-overlap route permits unknown or different harmony but positive overlap retains the original rule', async () => {
  const f = await fixture();
  try {
    await importRatedTakes(f.source, f.out, {pair: ['take-a', 'take-b']});
    const {pack} = await loadPack(join(f.out, 'pack'));
    const raw = JSON.parse(JSON.stringify(pack));
    raw.assets[0].harmony_pitch_classes = [0, 4, 7]; raw.assets[1].harmony_pitch_classes = [2, 5, 9];
    assert.doesNotThrow(() => validatePackManifest(raw));
    raw.routes[0].overlap_quarters = 4;
    assert.throws(() => validatePackManifest(raw), /matching authored constant harmony/);
    raw.routes[0].overlap_quarters = 0; raw.assets[1].timing.bpm = 121;
    assert.throws(() => validatePackManifest(raw), /equal tempo/);
  } finally { await f.cleanup(); }
});

for (const [name, mutate, error] of [
  ['hash mismatch', (d: any) => { d.takes[0].audio.sha256 = '0'.repeat(64); }, /HASH_MISMATCH/],
  ['path traversal', (d: any) => { d.takes[0].recipe.path = '../private.json'; }, /UNSAFE_PATH|expected take.wav/],
  ['malformed tempo', (d: any) => { d.takes[0].tempo.bpm = '120'; }, /expected number/],
  ['source contradiction', (d: any) => { d.takes[0].tempo.source = 'measured'; }, /tempo source/],
  ['oversized declared file', (d: any) => { d.takes[0].audio.bytes = 300 * 1024 * 1024; }, /expected integer/],
  ['wrong duration', (d: any) => { d.takes[0].duration_seconds = 2; }, /duration differs/],
] as const) test(`rated intake refuses ${name} atomically`, async () => {
  const f = await fixture();
  try {
    await changeSet(f.source, 'love', mutate);
    await assert.rejects(importRatedTakes(f.source, f.out, name === 'wrong duration' ? {pair: ['take-a', 'take-b']} : {}), error);
    assert.deepEqual(await readdir(f.root), ['source']);
  } finally { await f.cleanup(); }
});

test('duplicate IDs and incompatible or missing pair selections never publish partial output', async () => {
  const f = await fixture();
  try {
    await assert.rejects(importRatedTakes(f.source, f.out, {pair: ['take-a', 'missing']}), /not in the rated inventory/);
    await assert.rejects(importRatedTakes(f.source, f.out, {pair: ['take-a', 'take-a']}), /distinct/);
    await changeSet(f.source, 'like', d => { d.takes[0].tempo.bpm = 121; });
    await assert.rejects(importRatedTakes(f.source, f.out, {pair: ['take-a', 'take-b']}), /equal, known requested BPMs/);
    await changeSet(f.source, 'like', d => { d.takes[0].id = 'TAKE-A'; });
    await assert.rejects(importRatedTakes(f.source, f.out), /expected take.wav|duplicate take id/);
    assert.deepEqual(await readdir(f.root), ['source']);
  } finally { await f.cleanup(); }
});

test('symlinked take directories cannot expose outside data', async t => {
  const f = await fixture();
  try {
    await renameTake();
    await assert.rejects(importRatedTakes(f.source, f.out), /symlinks and aliases/);
    assert.ok(!(await readdir(f.root)).includes('out'));
  } finally { await f.cleanup(); }
  async function renameTake() {
    const external = join(f.root, 'external'); await mkdir(external);
    await rm(join(f.source, 'love', 'take-a'), {recursive: true});
    try { await symlink(external, join(f.source, 'love', 'take-a'), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EPERM') { t.skip('symlink permission unavailable'); throw e; } throw e; }
  }
});

test('output parent aliases into the export are refused before creating directories', async () => {
  const f = await fixture();
  try {
    const alias = join(f.root, 'alias');
    await symlink(f.source, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const before = await readdir(f.source);
    for (const output of [join(alias, 'out'), join(alias, 'new-parent', 'out')]) {
      await assert.rejects(importRatedTakes(f.source, output), /output must be outside the source export/);
      assert.deepEqual(await readdir(f.source), before);
    }
    assert.deepEqual(await readdir(f.root), ['alias', 'source']);
  } finally { await f.cleanup(); }
});

test('ordinary external output with missing parents imports successfully', async () => {
  const f = await fixture();
  try {
    const output = join(f.root, 'new-parent', 'nested', 'out');
    const catalog = await importRatedTakes(f.source, output);
    assert.equal(catalog.takes.length, 3);
    assert.deepEqual(JSON.parse(await readFile(join(output, 'catalog.json'), 'utf8')), catalog);
    assert.deepEqual(await readdir(f.source), ['dislike', 'like', 'love', 'manifest.json']);
  } finally { await f.cleanup(); }
});

test('browser audition budget is bounded even when explicitly requested', async () => {
  await assert.rejects(loadBrowserPack(new URL('http://127.0.0.1/manifest.json'), true, undefined,
    {allowUnreviewed: true, maxBytes: MAX_AUDITION_BYTES + 1}), /at most 128 MiB/);
});

// EMF-S18 increment 1: rated set intake. Synthetic fixtures only; no listening.
const SET_EXTRA: Extra = [['love', 'take-d', 90], ['like', 'take-e', 128], ['dislike', 'take-f', 100]];

test('loved-liked set takes every love and like take in catalog order, never dislikes, with mixed BPMs and zero routes', async () => {
  const f = await fixture(SET_EXTRA);
  try {
    const catalog = await importRatedTakes(f.source, f.out, {set: 'loved-liked'});
    assert.equal(catalog.pair, null);
    assert.deepEqual(catalog.set!.take_ids, ['take-a', 'take-d', 'take-b', 'take-e'], 'love set then like set, each in export order');
    assert.deepEqual(catalog.set!.asset_ids, catalog.set!.take_ids.map(setAssetId));
    assert.equal(catalog.set!.selection, 'loved-liked');
    assert.equal(catalog.set!.grid, 'requested-not-measured');
    assert.equal(catalog.set!.transition, 'none-authored (DJ decides)');
    assert.equal(catalog.set!.eligibility, 'unreviewed');
    assert.equal(catalog.set!.total_bytes, catalog.takes.filter(t => t.rating !== 'dislike').reduce((n, t) => n + t.dj_audio.bytes, 0));
    assert.equal(catalog.set!.max_bytes, RATED_INTAKE_LIMITS.setBytes);
    assert.equal(catalog.takes.length, 6, 'inventory still keeps dislikes');
    const {pack} = await loadPack(join(f.out, 'pack'));
    assert.equal(pack.id, 's18-rated-set');
    assert.deepEqual(pack.routes, []);
    assert.deepEqual(pack.assets.map(a => a.id), catalog.set!.asset_ids);
    assert.deepEqual(pack.assets.map(a => a.timing!.bpm), [120, 90, 120, 128]);
    assert.ok(pack.assets.every(a => a.eligibility === 'unreviewed' && a.key === null && a.harmony_pitch_classes === null));
    assert.ok(pack.assets.every(a => a.rights.allowed_uses.join(',') === 'playback' && a.file.frames === 68000));
    assert.ok(!pack.assets.some(a => /take-c|take-f/.test(a.title)));
    const raw = JSON.parse(await readFile(join(f.out, 'pack', 'manifest.json'), 'utf8'));
    assert.doesNotThrow(() => validatePackManifest(raw), 'zero authored routes is a valid v0 pack');
    assert.deepEqual(JSON.parse(await readFile(join(f.out, 'catalog.json'), 'utf8')), catalog);
    // Increment 2 owns set playback: the current 1-2 recording browser loader still refuses a set.
    await assert.rejects(loadBrowserPack(new URL('http://127.0.0.1/pack/manifest.json'), true, await browserReader(f.out),
      {allowUnreviewed: true, maxBytes: MAX_AUDITION_BYTES}), /one or two recordings/);
  } finally { await f.cleanup(); }
});

test('explicit set keeps catalog order, admits love/like and refuses dislikes, unknown, duplicate or combined selections atomically', async () => {
  const f = await fixture(SET_EXTRA);
  try {
    for (const [options, error] of [
      [{set: ['take-a', 'take-c']}, /take-c is rated dislike/],
      [{set: ['take-a', 'missing']}, /not in the rated inventory/],
      [{set: ['take-a', 'take-a']}, /distinct/],
      [{set: ['take-a']}, /at least two/],
      [{set: 'loved-liked', pair: ['take-a', 'take-b']}, /either --pair or --set/],
    ] as const) {
      await assert.rejects(importRatedTakes(f.source, f.out, options as never), error);
      assert.deepEqual(await readdir(f.root), ['source'], 'failed set import publishes nothing');
    }
    const catalog = await importRatedTakes(f.source, f.out, {set: ['take-e', 'take-a', 'take-d']});
    assert.equal(catalog.set!.selection, 'explicit');
    assert.deepEqual(catalog.set!.take_ids, ['take-a', 'take-d', 'take-e']);
    const {pack} = await loadPack(join(f.out, 'pack'));
    assert.deepEqual(pack.assets.map(a => a.timing!.bpm), [120, 90, 128]);
    await assert.rejects(importRatedTakes(f.source, f.out, {set: 'loved-liked'}), /OUTPUT_EXISTS/);
  } finally { await f.cleanup(); }
});

test('set import is deterministic and stable asset IDs do not depend on the other selected takes', async () => {
  const f = await fixture(SET_EXTRA);
  try {
    const one = await importRatedTakes(f.source, join(f.root, 'one'), {set: 'loved-liked'});
    const two = await importRatedTakes(f.source, join(f.root, 'two'), {set: 'loved-liked'});
    assert.deepEqual(one, two);
    for (const path of [['catalog.json'], ['pack', 'manifest.json']]) {
      assert.deepEqual(await readFile(join(f.root, 'one', ...path)), await readFile(join(f.root, 'two', ...path)));
    }
    const subset = await importRatedTakes(f.source, join(f.root, 'three'), {set: ['take-b', 'take-d']});
    assert.deepEqual(subset.set!.asset_ids, [one.set!.asset_ids[1], one.set!.asset_ids[2]]);
  } finally { await f.cleanup(); }
});

test('set budget refuses too many takes or too many audition bytes; selection never shortens audio', () => {
  const take = (i: number, bytes: number, rating: RatedTake['rating'] = 'like'): RatedTake => ({id: `t${i}`, title: `T${i}`, rating,
    duration_seconds: 1, tempo: {bpm: 120, source: 'requested'}, key: {value: null, source: 'unknown'},
    audio: {path: 'a', sha256: '0'.repeat(64), bytes}, recipe: {path: 'r', sha256: '0'.repeat(64), bytes: 1},
    dj_audio: {path: 'd', sha256: '0'.repeat(64), bytes}});
  const catalog = (takes: RatedTake[]): RatedCatalog => ({schema_version: 'eutonos.rated-catalog.v1', takes, pair: null, set: null, limits: []});
  const max = RATED_INTAKE_LIMITS.setTakes;
  assert.equal(selectSet(catalog(Array.from({length: max}, (_, i) => take(i, 1000))), 'loved-liked').length, max);
  assert.throws(() => selectSet(catalog(Array.from({length: max + 1}, (_, i) => take(i, 1000))), 'loved-liked'), /SET_TOO_LARGE.*32-take/);
  const half = RATED_INTAKE_LIMITS.setBytes / 2;
  assert.equal(selectSet(catalog([take(1, half), take(2, half), take(3, half + 1, 'dislike')]), 'loved-liked').length, 2);
  assert.throws(() => selectSet(catalog([take(1, half), take(2, half + 1)]), 'loved-liked'), /SET_TOO_LARGE.*512 MiB/);
  assert.throws(() => selectSet(catalog([take(1, 1, 'dislike'), take(2, 1, 'dislike')]), 'loved-liked'), /at least two/);
});

test('a raised importer delivery budget must stay within its hard ceiling', async () => {
  await assert.rejects(importDelivery('missing-delivery', 'missing-out', {maxDeliveryBytes: 1024 * 1024 * 1024}), /maxDeliveryBytes/);
  await assert.rejects(importDelivery('missing-delivery', 'missing-out', {maxDeliveryBytes: 0}), /maxDeliveryBytes/);
});

test('CLI parses --set forms and refuses --set with --pair', async () => {
  assert.equal(parseSetArgument('loved-liked'), 'loved-liked');
  assert.deepEqual(parseSetArgument('take-a,take-b'), ['take-a', 'take-b']);
  assert.throws(() => parseSetArgument('take-a,,take-b'), /empty entries/);
  await assert.rejects(runRatedIntake(['--source', 's', '--out', 'o', '--set', 'loved-liked', '--pair', 'a', 'b']), /mutually exclusive/);
  await assert.rejects(runRatedIntake(['--source', 's', '--out', 'o', '--set']), /Usage/);
});
