import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {importRatedTakes, type RatedTake} from '../src/rated-takes.js';
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
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rated-test-')), source = join(root, 'source'), out = join(root, 'out');
  await mkdir(source);
  const audio = wav(), recipe = json({seed: 9, caption: 'Synthetic test only; inert data', nested: {model: 'synthetic@1'}});
  const takes: RatedTake[] = [];
  const sets = [];
  for (const [rating, id] of [['love', 'take-a'], ['like', 'take-b'], ['dislike', 'take-c']] as const) {
    await mkdir(join(source, rating, id), {recursive: true});
    const files = {audio: {path: `${id}/take.wav`, sha256: hash(audio), bytes: audio.length},
      recipe: {path: `${id}/recipe.json`, sha256: hash(recipe), bytes: recipe.length},
      dj_audio: {path: `${id}/audition.wav`, sha256: hash(audio), bytes: audio.length}};
    await writeFile(join(source, rating, files.audio.path), audio);
    await writeFile(join(source, rating, files.recipe.path), recipe);
    await writeFile(join(source, rating, files.dj_audio.path), audio);
    const take: RatedTake = {id, title: `Synthetic ${id}`, rating, duration_seconds: 8.5,
      tempo: {bpm: 120, source: 'requested'}, key: {value: 'A minor', source: 'requested'}, ...files};
    takes.push(take);
    await writeFile(join(source, rating, 'manifest.json'), json({schema_version: 'music-studio.rated-set.v1', rating, takes: [take]}));
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

test('browser audition budget is bounded even when explicitly requested', async () => {
  await assert.rejects(loadBrowserPack(new URL('http://127.0.0.1/manifest.json'), true, undefined,
    {allowUnreviewed: true, maxBytes: MAX_AUDITION_BYTES + 1}), /at most 128 MiB/);
});
