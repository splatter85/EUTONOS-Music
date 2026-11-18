// DJ song sources: folder allow-list validation and refusals, union/dedupe/dislike/cap/ratings, the virtual pack passing the
// existing validators, serving by opaque id with TOCTOU re-hash, Music Studio (fake, in-process) read and write-back, and the
// relay endpoints (DJ side with the token, phone side same-origin with no paths). Temp folders and synthetic tones only.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {request, type IncomingHttpHeaders} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import test, {type TestContext} from 'node:test';
import {createPhoneRelay, type EncoderProcess} from '../scripts/phone-relay.js';
import {DjSources, SourcesError, assetIdOf, tempoFromName} from '../scripts/dj-sources.js';
import {RatingsFile, SourcesFile, SourcesFileError} from '../scripts/dj-sources-file.js';
import {SourcePathError, isInside, isUnsafeName, validateFolderPath} from '../scripts/dj-sources-path.js';
import {validatePackFiles} from '../src/audio.js';
import {eligibleForPlayback, validatePackManifest} from '../src/pack.js';
import {SOURCES_LIMITS, isSongSourceStamp, parseSourcesDoc, parseTickPatch} from '../web/dj-sources.js';
import {pcm16Wav} from './helpers/synthetic-set.js';

const DJ = 'http://127.0.0.1:4173';
const TOKEN = '0123456789abcdef0123456789abcdef';
const RATE = 8000;
/** A distinct original tone per seed (never owner audio). */
function tone(seed: number, seconds = 12): Uint8Array {
  const frames = seconds * RATE, channel = new Float32Array(frames);
  const hz = 110 + seed * 7.3;
  for (let i = 0; i < frames; i++) channel[i] = 0.3 * Math.sin(2 * Math.PI * hz * i / RATE) * (i % 4000 < 200 ? 1 : 0.6);
  return pcm16Wav({sampleRate: RATE, channels: [channel]});
}
async function temp(t: TestContext, prefix = 'eutonos sources '): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await writeFile(join(root, 'package.json'), '{"private":true}');
  t.after(async () => { await rm(root, {recursive: true, force: true}); });
  return root;
}
async function folderWith(t: TestContext, names: Record<string, Uint8Array | string>): Promise<string> {
  const dir = await temp(t, 'eutonos songs ');
  for (const [name, data] of Object.entries(names)) {
    await mkdir(join(dir, ...name.split('/').slice(0, -1)), {recursive: true});
    await writeFile(join(dir, ...name.split('/')), data);
  }
  return dir;
}

/** In-process Music Studio: loved/liked/disliked takes, a PATCH rating route, dj-audio WAV. */
interface FakeTake { id: string; title: string; rating: 'love' | 'like' | 'dislike' | null; seed: number; bpm?: number }
function fakeStudio(takes: FakeTake[], calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.hostname !== '127.0.0.1' || url.port !== '7870') throw new Error('unexpected host');
    if (url.pathname === '/api/takes/rated') {
      const listed = takes.filter(x => x.rating === 'love' || x.rating === 'like').map(x => ({id: x.id, title: x.title, rating: x.rating,
        bpm: x.bpm ?? null, key: null, revision: x.id.replace(/\D/g, '').padEnd(16, '0')}));
      return new Response(JSON.stringify({schema: 'music-studio.rated-takes.v1', takes: listed}), {status: 200});
    }
    const audio = /^\/api\/takes\/(ms-[^/]+)\/dj-audio$/.exec(url.pathname);
    if (audio) {
      const take = takes.find(x => x.id === audio[1]);
      return take ? new Response(Buffer.from(tone(take.seed)), {status: 200}) : new Response('no', {status: 404});
    }
    const patch = /^\/api\/takes\/(ms-[^/]+)$/.exec(url.pathname);
    if (patch && init?.method === 'PATCH') {
      const take = takes.find(x => x.id === patch[1]);
      if (!take) return new Response('no', {status: 404});
      take.rating = (JSON.parse(String(init.body)) as {rating: FakeTake['rating']}).rating;
      return new Response('{}', {status: 200});
    }
    return new Response('no', {status: 404});
  }) as typeof fetch;
}
const studioDown: typeof fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
// ids must match ms-YYYYMMDD-HHMMSS-xxxx (4 alphanumerics)
const takeId = (n: number): string => `ms-20261110-0900${String(n).padStart(2, '0')}-a${String(n).padStart(3, '0')}`;
const studioTake = (n: number, rating: FakeTake['rating'], extra: Partial<FakeTake> = {}): FakeTake => ({id: takeId(n), title: `Take ${n}`, rating, seed: n, ...extra});

async function service(t: TestContext, fetchImpl: typeof fetch = studioDown): Promise<{sources: DjSources; root: string}> {
  const root = await temp(t);
  return {sources: new DjSources({root, fetch: fetchImpl}), root};
}
const refreshed = async (sources: DjSources) => { await sources.refresh(); return sources.view({wait: true}); };

// ---------------------------------------------------------------- path validation
test('folder validation accepts a plain local folder and canonicalises it', async t => {
  const dir = await folderWith(t, {'a.wav': tone(1)});
  const ok = await validateFolderPath(` "${dir}" `);
  assert.match(ok.id, /^folder-[0-9a-f]{12}$/);
  assert.equal(ok.canonical.toLowerCase(), dir.toLowerCase());
  assert.equal((await validateFolderPath(dir.toUpperCase())).id, ok.id, 'case alias gives the same id');
});

test('folder validation refuses UNC, device, relative, reserved, missing, file, empty and control-character paths', async t => {
  const dir = await folderWith(t, {'a.wav': tone(1)});
  const refuse = async (input: unknown, code: string): Promise<void> => {
    await assert.rejects(validateFolderPath(input), (e: unknown) => e instanceof SourcePathError && e.code === code, `${String(input)} -> ${code}`);
  };
  await refuse('\\\\server\\share\\music', 'unc');
  await refuse('//server/share/music', 'unc');
  await refuse('\\\\?\\C:\\Windows', 'unc');
  await refuse('\\\\.\\PhysicalDrive0', 'unc');
  await refuse('relative\\folder', process.platform === 'win32' ? 'not-absolute' : 'not-absolute');
  await refuse(42, 'invalid');
  await refuse('', 'invalid');
  await refuse(`${dir}\u0000x`, 'invalid');
  await refuse('x'.repeat(SOURCES_LIMITS.maxPathChars + 1), 'invalid');
  await refuse(join(dir, 'missing folder'), 'missing');
  await refuse(join(dir, 'a.wav'), 'not-directory');
  if (process.platform === 'win32') {
    await refuse(`${dir}\\CON`, 'reserved');
    await refuse(`${dir}\\nul.txt`, 'reserved');
    await refuse(`${dir}\\COM1`, 'reserved');
    await refuse(`${dir}\\trailing.`, 'reserved');
    await refuse(`${dir}\\a.wav::$DATA`, 'reserved');
    await refuse('C:relative', 'not-absolute');
  }
});

test('isUnsafeName and isInside', () => {
  for (const name of ['CON', 'con.txt', 'Aux', 'LPT3', 'a.', 'a ', 'x:y', 'a|b', '']) assert.equal(isUnsafeName(name), true, name);
  for (const name of ['song.wav', 'Beats 2026', 'constant', 'com10', 'nulled.wav']) assert.equal(isUnsafeName(name), false, name);
  assert.equal(isInside('/a/b', '/a/b/c'), true);
  assert.equal(isInside('/a/b', '/a/bc'), false);
  assert.equal(isInside('/a/b', '/a/b'), true);
});

test('folder validation refuses a symlink or junction, and a path reached through one', async t => {
  const dir = await folderWith(t, {'real/a.wav': tone(1)});
  const link = join(dir, 'link');
  try { await symlink(join(dir, 'real'), link, process.platform === 'win32' ? 'junction' : 'dir'); } catch { t.skip('cannot create a link here'); return; }
  await assert.rejects(validateFolderPath(link), (e: unknown) => e instanceof SourcePathError && e.code === 'link');
  await assert.rejects(validateFolderPath(join(link)), (e: unknown) => e instanceof SourcePathError && e.code === 'link');
  await mkdir(join(dir, 'real', 'inner'));
  await assert.rejects(validateFolderPath(join(link, 'inner')), (e: unknown) => e instanceof SourcePathError && e.code === 'link');
});

test('refusal messages never echo the typed path', async t => {
  const dir = await folderWith(t, {});
  const secret = join(dir, 'private owner folder name');
  for (const input of [secret, `\\\\host\\${secret}`, `${secret}\\CON`]) {
    try { await validateFolderPath(input); assert.fail('should refuse'); }
    catch (error) { assert.ok(error instanceof SourcePathError); assert.ok(!error.message.includes('private owner'), error.message); }
  }
});

// ---------------------------------------------------------------- stores
test('sources file: defaults, ticks, folders, atomic write, caps, symlink refusal, damaged file replaced', async t => {
  const root = await temp(t);
  const file = new SourcesFile(root);
  const first = await file.read();
  assert.equal(first.rev, 0);
  assert.equal(first.ticks['studio-loved'], true);
  assert.equal(first.ticks['pack-fl'], false);
  const ticked = await file.setTicks({'studio-liked': false});
  assert.equal(ticked.ticks['studio-liked'], false);
  assert.equal(ticked.rev, 1);
  await assert.rejects(file.setTicks({'folder-0123456789ab': true}), (e: unknown) => e instanceof SourcesFileError && e.code === 'invalid');
  const dir = await folderWith(t, {});
  const v = await validateFolderPath(dir);
  const added = await file.addFolder({id: v.id, label: v.label, path: v.canonical});
  assert.equal(added.folders.length, 1);
  assert.equal(added.ticks[v.id], true);
  await assert.rejects(file.addFolder({id: v.id, label: v.label, path: v.canonical}), (e: unknown) => e instanceof SourcesFileError);
  const removed = await file.removeFolder(v.id);
  assert.equal(removed.folders.length, 0);
  assert.ok((await stat(dir)).isDirectory(), 'removing a folder never touches files');
  const files = await readdir(file.directory);
  assert.deepEqual(files.filter(name => name.endsWith('.part')), []);
  // folder cap
  for (let i = 0; i < SOURCES_LIMITS.maxFolders; i++) {
    const d = await folderWith(t, {});
    const f = await validateFolderPath(d);
    await file.addFolder({id: f.id, label: f.label, path: f.canonical});
  }
  const extra = await validateFolderPath(await folderWith(t, {}));
  await assert.rejects(file.addFolder({id: extra.id, label: extra.label, path: extra.canonical}), (e: unknown) => e instanceof SourcesFileError && e.code === 'full');
  // damaged file reads as invalid, a write replaces it
  await writeFile(join(file.directory, 'sources.json'), '{broken');
  await assert.rejects(file.read(), (e: unknown) => e instanceof SourcesFileError && e.code === 'invalid');
  const healed = await file.setTicks({'pack-fl': true});
  assert.equal(healed.ticks['pack-fl'], true);
});

test('sources and ratings stores refuse a symlinked local/dj-sources folder', async t => {
  const root = await temp(t);
  const elsewhere = await temp(t, 'eutonos elsewhere ');
  await mkdir(join(root, 'local'));
  try { await symlink(elsewhere, join(root, 'local', 'dj-sources'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { t.skip('cannot create a link here'); return; }
  await assert.rejects(new SourcesFile(root).setTicks({'pack-fl': true}), (e: unknown) => e instanceof SourcesFileError && e.code === 'unsafe');
  await assert.rejects(new RatingsFile(root).set(assetIdOf('a'.repeat(64)), {rating: 'like', title: 't', label: 'l'}), (e: unknown) => e instanceof SourcesFileError && e.code === 'unsafe');
  assert.deepEqual(await readdir(elsewhere), ['package.json'], 'nothing was written through the link');
});

test('ratings file: set, clear, caps, validation', async t => {
  const root = await temp(t);
  const ratings = new RatingsFile(root);
  const id = assetIdOf('b'.repeat(64));
  assert.deepEqual((await ratings.read()).ratings, {});
  const doc = await ratings.set(id, {rating: 'dislike', title: 'T', label: 'Folder: x', previous: 'like'});
  assert.equal(doc.ratings[id]?.rating, 'dislike');
  assert.equal(doc.ratings[id]?.previous, 'like');
  assert.equal(Object.keys((await ratings.set(id, null)).ratings).length, 0);
  await assert.rejects(ratings.set('src-not-an-id', {rating: 'like', title: 't', label: 'l'}), (e: unknown) => e instanceof SourcesFileError && e.code === 'invalid');
  await assert.rejects(ratings.set(id, {rating: 'meh' as 'like', title: 't', label: 'l'}), (e: unknown) => e instanceof SourcesFileError);
  for (let i = 0; i < 3; i++) await ratings.set(assetIdOf(String(i).repeat(64)), {rating: 'like', title: `t${i}`, label: 'l'});
  assert.equal(Object.keys((await ratings.read()).ratings).length, 3);
});

test('document and patch parsers reject unknown ids, extra fields and bad types', () => {
  assert.throws(() => parseTickPatch({'nope': true}));
  assert.throws(() => parseTickPatch({'studio-loved': 'yes'}));
  assert.deepEqual(parseTickPatch({'studio-loved': false}), {'studio-loved': false});
  assert.throws(() => parseSourcesDoc({version: 'em.dj-sources.v1', updatedAt: null, rev: 0, ticks: {}, folders: [], extra: 1}));
  assert.throws(() => parseSourcesDoc({version: 'x', updatedAt: null, rev: 0, ticks: {}, folders: []}));
  assert.equal(isSongSourceStamp({source: 'studio-loved', label: 'Music Studio: loved', rating: 'love'}), true);
  assert.equal(isSongSourceStamp({source: 'studio-loved', label: 'x', rating: 'love', extra: 1}), false);
  assert.equal(isSongSourceStamp({source: 'C:\\secret', label: 'x', rating: 'love'}), false);
});

// ---------------------------------------------------------------- scanning and the pool
test('tempo hint from file names', () => {
  assert.equal(tempoFromName('beat 128bpm.wav'), 128);
  assert.equal(tempoFromName('bpm_98 loop.wav'), 98);
  assert.equal(tempoFromName('beat 300bpm.wav'), null);
  assert.equal(tempoFromName('nothing.wav'), null);
});

test('a folder is scanned: valid WAV playable and unrated; bad, tiny and non-WAV files skipped with a clear note and no paths', async t => {
  const {sources, root} = await service(t);
  const dir = await folderWith(t, {
    'one.wav': tone(1), 'two 100bpm.wav': tone(2), 'sub/three.wav': tone(3),
    'short.wav': tone(4, 5), 'garbage.wav': Buffer.from('not a wav at all, definitely not riff'), 'song.mp3': 'x', 'notes.txt': 'x',
    'CON.wav': tone(5),
  });
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  const added = await sources.addFolder(dir);
  assert.equal(added.folders.length, 1);
  const view = await refreshed(sources);
  assert.equal(view.songs.length, 3);
  assert.ok(view.songs.every(s => s.rating === 'unrated' && s.source.startsWith('folder-')));
  assert.deepEqual(view.songs.map(s => s.title).sort(), ['one', 'three', 'two 100bpm']);
  const status = view.sources.find(s => s.id.startsWith('folder-'))!;
  assert.equal(status.songs, 3);
  assert.match(status.message, /non-WAV/);
  assert.match(status.message, /skipped/);
  assert.ok(!status.message.includes(root) && !status.message.includes(dir));
  assert.equal(view.songs.find(s => s.title === 'two 100bpm')?.tempoSource, 'requested');
  assert.equal(view.songs.find(s => s.title === 'one')?.tempoSource, 'placeholder');
  const phone = await sources.view({phone: true});
  assert.ok(phone.folders.every(f => !('path' in f)), 'the phone copy has no folder paths');
  assert.ok(!JSON.stringify(phone).toLowerCase().includes(tmpdir().toLowerCase().replace(/\\/g, '\\\\')), 'no temp-dir path anywhere in the phone view');
  assert.equal(view.pool.ok, true);
});

test('the virtual pack passes the existing pack validators and eligibility, and serves audio by opaque id', async t => {
  const {sources} = await service(t);
  const dir = await folderWith(t, {'a.wav': tone(1), 'b.wav': tone(2), 'c.wav': tone(3)});
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  await sources.addFolder(dir);
  const view = await refreshed(sources);
  const manifestBytes = await sources.manifest();
  const pack = validatePackManifest(JSON.parse(manifestBytes.toString('utf8')));
  assert.equal(pack.assets.length, 3);
  assert.deepEqual(pack.routes, []);
  for (const asset of pack.assets) {
    assert.equal(asset.eligibility, 'unreviewed');
    assert.equal(eligibleForPlayback(asset, false, true), true);
    assert.equal(eligibleForPlayback(asset, false, false), false, 'unreviewed is playable only with explicit owner-local audition');
    assert.match(asset.file.path, /^audio\/src-[0-9a-f]{32}\.wav$/);
    assert.equal(asset.timing?.meter[0], 4);
    assert.match(asset.rights.license, /local-only/i);
    assert.ok(!JSON.stringify(asset).includes(dir), 'no private folder path in the manifest');
  }
  await validatePackFiles(pack, async path => {
    const id = /^audio\/(src-[0-9a-f]{32})\.wav$/.exec(path)![1]!;
    return new Uint8Array(await sources.readAudio(id));
  });
  assert.deepEqual(view.songs.map(s => s.assetId).sort(), pack.assets.map(a => a.id).sort());
  assert.match(sources.provenance().toString(), /local-only/);
  await assert.rejects(sources.readAudio('src-' + '0'.repeat(32)), (e: unknown) => e instanceof SourcesError && e.code === 'unknown-song');
});

test('a file swapped or edited after the scan is refused when served (re-hash at serve), and the pool refreshes', async t => {
  const {sources} = await service(t);
  const dir = await folderWith(t, {'a.wav': tone(1), 'b.wav': tone(2)});
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  await sources.addFolder(dir);
  const view = await refreshed(sources);
  const a = view.songs.find(s => s.title === 'a')!;
  await writeFile(join(dir, 'a.wav'), tone(9)); // same size, different audio
  await assert.rejects(sources.readAudio(a.assetId), (e: unknown) => e instanceof SourcesError && e.code === 'changed');
  const again = await refreshed(sources);
  assert.ok(!again.songs.some(s => s.assetId === a.assetId), 'the old id is gone');
  assert.equal(again.songs.length, 2);
  // a file turned into something else
  const b = again.songs.find(s => s.title === 'b')!;
  await rm(join(dir, 'b.wav'));
  await mkdir(join(dir, 'b.wav'));
  await assert.rejects(sources.readAudio(b.assetId), (e: unknown) => e instanceof SourcesError && e.code === 'changed');
});

test('a symlinked file inside an allowed folder is never followed or served', async t => {
  const {sources} = await service(t);
  const outside = await folderWith(t, {'secret.wav': tone(7)});
  const dir = await folderWith(t, {'a.wav': tone(1), 'b.wav': tone(2)});
  try { await symlink(join(outside, 'secret.wav'), join(dir, 'link.wav'), 'file'); } catch { t.skip('cannot create a file link here'); return; }
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  await sources.addFolder(dir);
  const view = await refreshed(sources);
  assert.deepEqual(view.songs.map(s => s.title).sort(), ['a', 'b']);
});

test('malicious WAV headers are skipped by the existing validator, not served', async t => {
  const {sources} = await service(t);
  const huge = Buffer.from(tone(1));
  huge.writeUInt32LE(0xfffffff0, 40); // data size far beyond the file
  const lying = Buffer.from(tone(2));
  lying.writeUInt32LE(0x7fffffff, 4); // RIFF size wrong
  const mono8 = Buffer.from(tone(3));
  mono8.writeUInt16LE(8, 34); // 8-bit
  const dir = await folderWith(t, {'ok1.wav': tone(4), 'ok2.wav': tone(5), 'huge.wav': huge, 'lying.wav': lying, 'bits.wav': mono8});
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  await sources.addFolder(dir);
  const view = await refreshed(sources);
  assert.deepEqual(view.songs.map(s => s.title).sort(), ['ok1', 'ok2']);
});

test('a folder with more than 128 WAV files is refused with a clear message, not silently cut', async t => {
  const {sources} = await service(t);
  const files: Record<string, Uint8Array> = {};
  const small = tone(1, 10);
  for (let i = 0; i < SOURCES_LIMITS.maxFilesPerFolder + 1; i++) files[`s${String(i).padStart(3, '0')}.wav`] = small;
  const dir = await folderWith(t, files);
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  await sources.addFolder(dir);
  const view = await refreshed(sources);
  const status = view.sources.find(s => s.id.startsWith('folder-'))!;
  assert.match(status.message, /limit is 128/);
  assert.equal(view.songs.length, 0);
  assert.equal(view.pool.ok, false);
});

test('the pool cap is 128 songs in total across sources and is refused with a message', {timeout: 120_000}, async t => {
  const {sources} = await service(t);
  const dirs: string[] = [];
  for (let d = 0; d < 2; d++) {
    const files: Record<string, Uint8Array> = {};
    for (let i = 0; i < 65; i++) files[`s${String(i).padStart(3, '0')}.wav`] = tone(d * 100 + i, 10);
    dirs.push(await folderWith(t, files));
  }
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  await sources.addFolder(dirs[0]!);
  assert.equal((await refreshed(sources)).pool.ok, true);
  await sources.addFolder(dirs[1]!);
  const view = await refreshed(sources);
  assert.equal(view.pool.ok, false);
  assert.match(view.pool.message, /limit is 128/);
  await assert.rejects(sources.manifest(), (e: unknown) => e instanceof SourcesError && e.code === 'not-ready');
  const folderId = view.folders[1]!.id;
  const fixed = await sources.setTicks({[folderId]: false});
  assert.equal(fixed.pool.ok, true);
  assert.equal(fixed.songs.length, 65);
});

test('union de-duplicates identical audio across folders (same hash), keeping the first source and noting the other', async t => {
  const {sources} = await service(t);
  const shared = tone(1);
  const one = await folderWith(t, {'same.wav': shared, 'only1.wav': tone(2)});
  const two = await folderWith(t, {'same copy.wav': shared, 'only2.wav': tone(3)});
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  await sources.addFolder(one);
  await sources.addFolder(two);
  const view = await refreshed(sources);
  assert.equal(view.songs.length, 3);
  const same = view.songs.find(s => s.title === 'same')!;
  assert.equal(same.also.length, 1);
});

test('unticking a source removes its songs and ticking restores them; a missing folder degrades with a message', async t => {
  const {sources} = await service(t);
  const dir = await folderWith(t, {'a.wav': tone(1), 'b.wav': tone(2)});
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  const added = await sources.addFolder(dir);
  const id = added.folders[0]!.id;
  assert.equal((await refreshed(sources)).songs.length, 2);
  assert.equal((await sources.setTicks({[id]: false})).songs.length, 0);
  assert.equal((await sources.setTicks({[id]: true})).songs.length, 2);
  await rm(dir, {recursive: true, force: true});
  const view = await refreshed(sources);
  assert.equal(view.songs.length, 0);
  assert.match(view.sources.find(s => s.id === id)!.message, /not found/);
  assert.equal(view.pool.ok, false);
  const removed = await sources.removeFolder(id);
  assert.equal(removed.folders.length, 0);
  await assert.rejects(sources.removeFolder('folder-000000000000'), (e: unknown) => e instanceof SourcesError);
  await assert.rejects(sources.removeFolder('../etc'), (e: unknown) => e instanceof SourcesError && e.code === 'invalid');
});

test('overlapping folders are refused and a bad path never becomes a root', async t => {
  const {sources} = await service(t);
  const dir = await folderWith(t, {'a.wav': tone(1), 'inner/b.wav': tone(2)});
  await sources.addFolder(dir);
  await assert.rejects(sources.addFolder(join(dir, 'inner')), (e: unknown) => e instanceof SourcesError && /overlaps/.test(e.message));
  await assert.rejects(sources.addFolder('\\\\server\\share'), (e: unknown) => e instanceof SourcesError && e.code === 'invalid');
  assert.equal((await sources.view()).folders.length, 1);
});

// ---------------------------------------------------------------- Music Studio and ratings
test('Music Studio: loved and liked songs only; dislikes and unrated never appear; labelled with source and rating', async t => {
  const takes = [studioTake(1, 'love'), studioTake(2, 'like'), studioTake(3, 'dislike'), studioTake(4, null), studioTake(5, 'love', {bpm: 124})];
  const {sources} = await service(t, fakeStudio(takes));
  const view = await refreshed(sources);
  assert.deepEqual(view.songs.map(s => s.title).sort(), ['Take 1', 'Take 2', 'Take 5']);
  assert.equal(view.songs.find(s => s.title === 'Take 1')!.rating, 'love');
  assert.equal(view.songs.find(s => s.title === 'Take 2')!.rating, 'like');
  assert.equal(view.songs.find(s => s.title === 'Take 5')!.tempoSource, 'requested');
  assert.equal(view.songs.find(s => s.title === 'Take 1')!.sourceLabel, 'Music Studio: loved');
  // untick liked
  const loved = await sources.setTicks({'studio-liked': false});
  assert.deepEqual(loved.songs.map(s => s.title).sort(), ['Take 1', 'Take 5']);
});

test('Music Studio not running: a clear message, local sources keep working, nothing throws', async t => {
  const {sources} = await service(t, studioDown);
  const dir = await folderWith(t, {'a.wav': tone(1), 'b.wav': tone(2)});
  await sources.addFolder(dir);
  const view = await refreshed(sources);
  const loved = view.sources.find(s => s.id === 'studio-loved')!;
  assert.equal(loved.available, false);
  assert.match(loved.message, /not running/);
  assert.ok(!loved.message.includes('fetch failed'));
  assert.equal(view.songs.length, 2);
});

test('Music Studio: a hostile listing is ignored (bad ids, dislike ratings, oversized)', async t => {
  const hostile: typeof fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === '/api/takes/rated') {
      return new Response(JSON.stringify({schema: 'music-studio.rated-takes.v1', takes: [
        {id: '../../etc/passwd', title: 'x', rating: 'love', revision: 'a'.repeat(16)},
        {id: takeId(1), title: 'bad', rating: 'dislike', revision: 'a'.repeat(16)},
        {id: takeId(2), title: 'rev', rating: 'love', revision: '../..'},
      ]}));
    }
    return new Response('no', {status: 404});
  }) as typeof fetch;
  const {sources} = await service(t, hostile);
  const view = await refreshed(sources);
  assert.equal(view.songs.length, 0);
  const wrong: typeof fetch = (async () => new Response(JSON.stringify({nope: 1}))) as typeof fetch;
  const {sources: other} = await service(t, wrong);
  const refused = await refreshed(other);
  assert.match(refused.sources.find(s => s.id === 'studio-loved')!.message, /refused|Unexpected/i);
});

test('rating a folder song stores it by hash (love, like, clear) and shows it on the row', async t => {
  const {sources, root} = await service(t);
  const dir = await folderWith(t, {'a.wav': tone(1), 'b.wav': tone(2), 'c.wav': tone(3)});
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  await sources.addFolder(dir);
  const a = (await refreshed(sources)).songs.find(s => s.title === 'a')!;
  assert.equal((await sources.rate(a.assetId, 'love')).songs.find(s => s.assetId === a.assetId)!.rating, 'love');
  assert.equal((await sources.rate(a.assetId, 'like')).songs.find(s => s.assetId === a.assetId)!.rating, 'like');
  const stored = JSON.parse(await readFile(join(root, 'local', 'dj-sources', 'ratings.json'), 'utf8')) as {ratings: Record<string, {rating: string}>};
  assert.equal(stored.ratings[a.assetId]?.rating, 'like');
  assert.equal((await sources.rate(a.assetId, null)).songs.find(s => s.assetId === a.assetId)!.rating, 'unrated');
  assert.deepEqual(JSON.parse(await readFile(join(root, 'local', 'dj-sources', 'ratings.json'), 'utf8')).ratings, {});
  await assert.rejects(sources.rate('src-' + '1'.repeat(32), 'love'), (e: unknown) => e instanceof SourcesError && e.code === 'unknown-song');
  await assert.rejects(sources.rate('nope', 'love'), (e: unknown) => e instanceof SourcesError && e.code === 'invalid');
});

test('dislike removes the song from the pool at once (and the manifest), keeps it as a negative example, and Undo restores it', async t => {
  const {sources} = await service(t);
  const dir = await folderWith(t, {'a.wav': tone(1), 'b.wav': tone(2), 'c.wav': tone(3)});
  await sources.setTicks({'studio-loved': false, 'studio-liked': false});
  await sources.addFolder(dir);
  const a = (await refreshed(sources)).songs.find(s => s.title === 'a')!;
  await sources.rate(a.assetId, 'like');
  const after = await sources.rate(a.assetId, 'dislike');
  assert.equal(after.songs.length, 2);
  assert.ok(!after.songs.some(s => s.assetId === a.assetId));
  assert.deepEqual(after.disliked.map(d => [d.assetId, d.previous]), [[a.assetId, 'like']]);
  const manifest = validatePackManifest(JSON.parse((await sources.manifest()).toString()));
  assert.ok(!manifest.assets.some(x => x.id === a.assetId), 'a disliked song is not in the served pack');
  await assert.rejects(sources.readAudio(a.assetId), (e: unknown) => e instanceof SourcesError && e.code === 'unknown-song');
  // a rescan keeps it out
  assert.ok(!(await refreshed(sources)).songs.some(s => s.assetId === a.assetId));
  const undone = await sources.rate(a.assetId, null);
  assert.equal(undone.songs.length, 3);
  assert.equal(undone.disliked.length, 0);
  assert.equal(undone.songs.find(s => s.assetId === a.assetId)!.rating, 'like', 'Undo restores the previous rating');
});

test('Music Studio ratings write back through its PATCH route; a dislike there stays out of the pool and is kept for Undo', async t => {
  const takes = [studioTake(1, 'love'), studioTake(2, 'like'), studioTake(3, 'like')];
  const calls: string[] = [];
  const {sources} = await service(t, fakeStudio(takes, calls));
  const view = await refreshed(sources);
  const t2 = view.songs.find(s => s.title === 'Take 2')!;
  // like -> love
  const loved = await sources.rate(t2.assetId, 'love');
  assert.equal(takes[1]!.rating, 'love');
  assert.equal(loved.songs.find(s => s.title === 'Take 2')!.rating, 'love');
  assert.ok(calls.includes(`PATCH /api/takes/${takeId(2)}`));
  // clear
  const cleared = await sources.rate(t2.assetId, null);
  assert.equal(takes[1]!.rating, null);
  assert.ok(!cleared.songs.some(s => s.title === 'Take 2'), 'an unrated Music Studio take is not offered by Music Studio');
});

test('Music Studio dislike removes immediately and Undo restores the earlier rating in Music Studio', async t => {
  const takes = [studioTake(1, 'love'), studioTake(2, 'like'), studioTake(3, 'like')];
  const {sources} = await service(t, fakeStudio(takes));
  const view = await refreshed(sources);
  const t1 = view.songs.find(s => s.title === 'Take 1')!;
  const disliked = await sources.rate(t1.assetId, 'dislike');
  assert.equal(takes[0]!.rating, 'dislike');
  assert.ok(!disliked.songs.some(s => s.title === 'Take 1'));
  assert.equal(disliked.disliked.length, 1);
  assert.equal(disliked.disliked[0]!.previous, 'love');
  const restored = await sources.rate(t1.assetId, null);
  assert.equal(takes[0]!.rating, 'love');
  assert.equal(restored.songs.find(s => s.title === 'Take 1')!.rating, 'love');
  assert.equal(restored.disliked.length, 0);
});

test('rating a Music Studio song while Music Studio is down says so and changes nothing', async t => {
  const takes = [studioTake(1, 'love'), studioTake(2, 'like')];
  let up = true;
  const inner = fakeStudio(takes);
  const flaky = ((input: string | URL | Request, init?: RequestInit) => up ? inner(input, init) : Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
  const {sources} = await service(t, flaky);
  const view = await refreshed(sources);
  const song = view.songs.find(s => s.title === 'Take 1')!;
  up = false;
  await assert.rejects(sources.rate(song.assetId, 'like'), (e: unknown) => e instanceof SourcesError && e.code === 'studio-down' && /not running/.test(e.message));
  assert.equal(takes[0]!.rating, 'love');
});

test('the pack sources are listed unavailable when absent and never scanned unless ticked', async t => {
  const {sources} = await service(t);
  const view = await refreshed(sources);
  assert.deepEqual(view.sources.map(s => s.id), ['studio-loved', 'studio-liked', 'pack-fl', 'pack-mock-fl', 'pack-rated']);
  assert.equal(view.sources.find(s => s.id === 'pack-fl')!.ticked, false);
  const ticked = await sources.setTicks({'pack-fl': true});
  const fl = (await refreshed(sources), await sources.view()).sources.find(s => s.id === 'pack-fl')!;
  void ticked;
  assert.equal(fl.available, false);
  assert.match(fl.message, /Not present/);
});

// ---------------------------------------------------------------- relay endpoints
interface HttpResult {status: number | undefined; headers: IncomingHttpHeaders; body: Buffer}
function http(port: number, path: string, options: {method?: string; headers?: Record<string, string>; body?: Buffer | string} = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = request({hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', setHost: false,
      headers: {host: `127.0.0.1:${port}`, ...options.headers}}, incoming => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => { resolve({status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks)}); });
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(options.body);
  });
}
const djHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({origin: DJ, 'x-relay-token': TOKEN, 'content-type': 'application/json', ...extra});
const phoneHeaders = (port: number, extra: Record<string, string> = {}): Record<string, string> =>
  ({origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...extra});
const json = (result: HttpResult): Record<string, any> => JSON.parse(result.body.toString('utf8')) as Record<string, any>;

async function relay(t: TestContext, fetchImpl: typeof fetch = studioDown) {
  const root = await temp(t);
  const encoder = (): EncoderProcess => { const stdin = new PassThrough(), stdout = new PassThrough(); return {stdin, stdout, kill: () => undefined, on: () => undefined}; };
  const sources = new DjSources({root, fetch: fetchImpl});
  const created = createPhoneRelay({root, feedbackRoot: root, token: TOKEN, spawnEncoder: encoder, sources});
  t.after(async () => { await created.close(); });
  created.server.listen(0, '127.0.0.1');
  await once(created.server, 'listening');
  const address = created.server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  const djPost = (body: unknown, headers = djHeaders()): Promise<HttpResult> => http(port, '/api/dj/sources', {method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)});
  const phonePost = (body: unknown, headers = phoneHeaders(port)): Promise<HttpResult> => http(port, '/api/sources', {method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)});
  return {relay: created, port, root, sources, djPost, phonePost};
}

test('relay: DJ sources endpoints need the token and a loopback DJ origin', async t => {
  const r = await relay(t);
  assert.equal((await http(r.port, '/api/dj/sources', {headers: {origin: DJ}})).status, 401);
  assert.equal((await http(r.port, '/api/dj/sources', {headers: {origin: 'http://evil.example', 'x-relay-token': TOKEN}})).status, 403);
  assert.equal((await http(r.port, '/api/dj/sources', {headers: djHeaders({'x-forwarded-for': '1.2.3.4'})})).status, 403);
  assert.equal((await http(r.port, '/api/dj/sources', {headers: djHeaders({host: 'evil.example'})})).status, 403);
  assert.equal((await http(r.port, '/api/dj/sources/pack/manifest.json', {headers: {origin: DJ}})).status, 401);
  assert.equal((await http(r.port, '/api/dj/sources/pack/audio/src-' + 'a'.repeat(32) + '.wav', {headers: {origin: DJ}})).status, 401);
  const preflight = await http(r.port, '/api/dj/sources', {method: 'OPTIONS', headers: {origin: DJ, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-relay-token'}});
  assert.equal(preflight.status, 204);
  assert.equal((await http(r.port, '/api/dj/sources', {method: 'PUT', headers: djHeaders(), body: '{}'})).status, 405);
  assert.equal((await http(r.port, '/api/dj/sources/pack/manifest.json', {method: 'POST', headers: djHeaders(), body: '{}'})).status, 405);
});

test('relay: add folder, tick, scan, serve the virtual pack, rate, remove, with phone and DJ views differing only in paths', async t => {
  const r = await relay(t);
  const dir = await folderWith(t, {'a.wav': tone(1), 'b.wav': tone(2), 'c.wav': tone(3)});
  assert.equal((await r.djPost({ticks: {'studio-loved': false, 'studio-liked': false}})).status, 200);
  const added = await r.djPost({addFolder: dir});
  assert.equal(added.status, 200);
  const djView = json(await http(r.port, '/api/dj/sources', {headers: djHeaders()}));
  assert.equal(djView.folders.length, 1);
  assert.ok(djView.folders[0].path, 'the DJ page sees the folder path');
  const bad = await r.djPost({addFolder: '\\\\server\\share'});
  assert.equal(bad.status, 400);
  assert.ok(!bad.body.toString().includes('server'), 'refusal does not echo the typed path');
  await r.sources.refresh();
  const poll = json(await http(r.port, '/api/dj/sources', {headers: djHeaders()}));
  assert.equal(poll.songs.length, 3);
  const phone = await http(r.port, '/api/sources', {headers: phoneHeaders(r.port)});
  assert.equal(phone.status, 200);
  const phoneView = json(phone);
  assert.equal(phoneView.songs.length, 3);
  assert.ok(!phone.body.toString().includes(dir.replace(/\\/g, '\\\\')), 'no folder path on the phone');
  assert.ok(!phone.body.toString().toLowerCase().includes(tmpdir().toLowerCase().replace(/\\/g, '\\\\')), 'no parent path on the phone');
  assert.ok(phoneView.folders.every((f: Record<string, unknown>) => !('path' in f)));
  // the virtual pack
  const manifestResult = await http(r.port, '/api/dj/sources/pack/manifest.json', {headers: djHeaders()});
  assert.equal(manifestResult.status, 200);
  const pack = validatePackManifest(JSON.parse(manifestResult.body.toString()));
  const evidence = await http(r.port, '/api/dj/sources/pack/PROVENANCE.md', {headers: djHeaders()});
  assert.equal(evidence.status, 200);
  const asset = pack.assets[0]!;
  const audio = await http(r.port, `/api/dj/sources/pack/${asset.file.path}`, {headers: djHeaders()});
  assert.equal(audio.status, 200);
  assert.equal(audio.headers['content-type'], 'audio/wav');
  await validatePackFiles({...pack, assets: [asset], palettes: [], recipes: [], routes: []}, async () => new Uint8Array(audio.body));
  assert.equal((await http(r.port, '/api/dj/sources/pack/audio/src-' + 'f'.repeat(32) + '.wav', {headers: djHeaders()})).status, 404);
  assert.equal((await http(r.port, '/api/dj/sources/pack/audio/..%2f..%2fpackage.json', {headers: djHeaders()})).status, 404);
  assert.equal((await http(r.port, '/api/dj/sources/pack/audio/src-' + 'a'.repeat(32) + '.wav.exe', {headers: djHeaders()})).status, 404);
  // rate from the phone and the DJ page
  const song = phoneView.songs[0];
  const liked = await r.phonePost({rate: {assetId: song.assetId, action: 'like'}});
  assert.equal(liked.status, 200);
  assert.equal(json(liked).songs.find((s: any) => s.assetId === song.assetId).rating, 'like');
  const disliked = await r.djPost({rate: {assetId: song.assetId, action: 'dislike'}});
  assert.equal(disliked.status, 200);
  assert.equal(json(disliked).songs.length, 2);
  assert.equal(json(disliked).disliked.length, 1);
  const undone = await r.phonePost({rate: {assetId: song.assetId, action: null}});
  assert.equal(json(undone).songs.length, 3);
  const removed = await r.djPost({removeFolder: djView.folders[0].id});
  assert.equal(removed.status, 200);
  assert.ok((await stat(dir)).isDirectory(), 'removing a folder never deletes files');
});

test('relay: the phone cannot add or remove folders, and its requests are same-origin JSON only', async t => {
  const r = await relay(t);
  const dir = await folderWith(t, {'a.wav': tone(1)});
  assert.equal((await r.phonePost({addFolder: dir})).status, 400);
  assert.equal((await r.phonePost({removeFolder: 'folder-0123456789ab'})).status, 400);
  assert.equal((await r.phonePost({rescan: true})).status, 400);
  assert.equal((await r.phonePost({ticks: {'pack-fl': true}, rate: null})).status, 400, 'exactly one change');
  assert.equal((await r.phonePost({ticks: {'../x': true}})).status, 400);
  assert.equal((await r.phonePost({rate: {assetId: 'src-' + 'a'.repeat(32), action: 'nuke'}})).status, 400);
  assert.equal((await r.phonePost('not json')).status, 400);
  assert.equal((await r.phonePost({ticks: {}}, phoneHeaders(r.port, {'sec-fetch-site': 'cross-site'}))).status, 403);
  assert.equal((await r.phonePost({ticks: {}}, phoneHeaders(r.port, {origin: 'http://evil.example'}))).status, 403);
  assert.equal((await r.phonePost({ticks: {}}, phoneHeaders(r.port, {'content-type': 'text/plain'}))).status, 403);
  assert.equal((await http(r.port, '/api/sources', {headers: {host: 'evil.example'}})).status, 400);
  assert.equal((await http(r.port, '/api/sources', {method: 'PUT', headers: phoneHeaders(r.port)})).status, 405);
  assert.equal((await http(r.port, '/api/sources', {method: 'POST', headers: phoneHeaders(r.port), body: 'x'.repeat(9000)})).status, 413);
  assert.deepEqual((await readdir(r.root)).includes('local') ? await readdir(join(r.root, 'local')).catch(() => []) : [], [], 'refused requests wrote nothing');
});

test('relay: the phone page files for sources are served from the fixed allowlist', async t => {
  const r = await relay(t);
  for (const file of ['/dj-sources.js', '/dj-sources-store.js', '/dj-sources-ui.js']) {
    const result = await http(r.port, file, {headers: {host: `127.0.0.1:${r.port}`}});
    assert.ok(result.status === 200 || result.status === 404, file); // 404 only when the repo has not been built here
  }
});

test('relay: Music Studio down gives a message in the view, and ratings of Music Studio songs fail with 502 not a crash', async t => {
  const takes = [studioTake(1, 'love'), studioTake(2, 'like')];
  let up = true;
  const inner = fakeStudio(takes);
  const flaky = ((input: string | URL | Request, init?: RequestInit) => up ? inner(input, init) : Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
  const r = await relay(t, flaky);
  await r.sources.refresh();
  const view = json(await http(r.port, '/api/sources', {headers: phoneHeaders(r.port)}));
  assert.equal(view.songs.length, 2);
  up = false;
  const result = await r.phonePost({rate: {assetId: view.songs[0].assetId, action: 'like'}});
  assert.equal(result.status, 502);
  assert.equal(json(result).error, 'sources-studio-down');
});
