// The relay's song-dossier store: token, origin and DJ guard, validation, size caps, symlink and junction
// refusal, atomic replace and read-back. Mirrors the ratings endpoint tests. Temp folders only.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {request, type IncomingHttpHeaders} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import test, {type TestContext} from 'node:test';
import {createPhoneRelay, LIMITS, type EncoderProcess, type PhoneRelay} from '../scripts/phone-relay.js';
import {DOSSIER_FILE_LIMITS, DossierFileError, SongDossierFile} from '../scripts/song-dossier-file.js';
import {dossierId, parseSongDossier} from '../web/song-dossier.js';
import {sampleDossier, sha} from './helpers/dossier-fixtures.js';

const DJ = 'http://127.0.0.1:4173';
const TOKEN = '0123456789abcdef0123456789abcdef';
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
const post = (port: number, body: unknown, headers = djHeaders()): Promise<HttpResult> =>
  http(port, '/api/dj/dossier', {method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)});
const json = (result: HttpResult): Record<string, any> => JSON.parse(result.body.toString('utf8')) as Record<string, any>;
const idOf = (n: number): string => dossierId(sampleDossier(n).key);

async function relay(t: TestContext): Promise<{relay: PhoneRelay; port: number; root: string; dir: string}> {
  const root = await mkdtemp(join(tmpdir(), 'eutonos dossiers '));
  await writeFile(join(root, 'package.json'), '{"private":true}');
  const encoder = (): EncoderProcess => { const stdin = new PassThrough(), stdout = new PassThrough(); return {stdin, stdout, kill: () => undefined, on: () => undefined}; };
  const created = createPhoneRelay({root, feedbackRoot: root, token: TOKEN, spawnEncoder: encoder});
  t.after(async () => { await created.close(); await rm(root, {recursive: true, force: true}); });
  created.server.listen(0, '127.0.0.1');
  await once(created.server, 'listening');
  const address = created.server.address();
  assert.ok(address && typeof address !== 'string');
  return {relay: created, port: address.port, root, dir: join(root, 'local', 'song-dossiers')};
}

test('dossier endpoints need the DJ origin, the token and the DJ guard, like the other DJ endpoints', async t => {
  const {port, dir} = await relay(t);
  const body = sampleDossier(1);
  const noToken = {origin: DJ, 'content-type': 'application/json'};
  assert.equal((await post(port, body, noToken)).status, 401);
  assert.equal((await http(port, '/api/dj/dossier?token=' + TOKEN, {method: 'POST', headers: noToken, body: JSON.stringify(body)})).status, 401, 'no query token');
  assert.equal((await http(port, '/api/dj/dossiers', {headers: noToken})).status, 401, 'GET needs the token too');
  assert.equal((await post(port, body, {origin: 'https://pc.tail1.ts.net', 'x-relay-token': TOKEN, 'content-type': 'application/json'})).status, 403, 'tailnet origin refused');
  assert.equal((await http(port, '/api/dj/dossiers', {headers: {origin: 'https://pc.tail1.ts.net', 'x-relay-token': TOKEN}})).status, 403);
  assert.equal((await http(port, '/api/dj/dossiers', {headers: {'x-relay-token': TOKEN, 'x-forwarded-for': '100.1.2.3'}})).status, 403, 'proxied request refused');
  assert.equal((await http(port, '/api/dj/dossier', {headers: djHeaders()})).status, 405, 'dossier is POST only');
  assert.equal((await http(port, '/api/dj/dossiers', {method: 'POST', headers: djHeaders(), body: '{}'})).status, 405, 'dossiers is GET only');
  const preflight = await http(port, '/api/dj/dossier', {method: 'OPTIONS', headers: djHeaders({'access-control-request-method': 'POST'})});
  assert.equal(preflight.status, 204);
  await assert.rejects(stat(dir), /ENOENT/, 'nothing was created by refused or read-only requests');
});

test('a posted dossier is validated, stored under local/song-dossiers, read back whole and listed', async t => {
  const {port, dir} = await relay(t);
  const first = sampleDossier(1), second = sampleDossier(2);
  const a = await post(port, first);
  assert.equal(a.status, 200);
  assert.deepEqual([json(a).ok, json(a).replaced, json(a).files, json(a).id], [true, false, 1, idOf(1)]);
  assert.equal((await post(port, second)).status, 200);
  const list = json(await http(port, '/api/dj/dossiers', {headers: djHeaders()}));
  assert.equal(list.version, 'em.song-dossier-index.v1');
  assert.deepEqual(list.entries.map((e: {id: string}) => e.id).sort(), [idOf(1), idOf(2)].sort());
  assert.equal(list.files, 2);
  const one = await http(port, `/api/dj/dossiers?key=${idOf(1)}`, {headers: djHeaders()});
  assert.equal(one.status, 200);
  assert.deepEqual(parseSongDossier(json(one)), first, 'the same dossier comes back');
  assert.equal((await http(port, `/api/dj/dossiers?key=${idOf(9)}`, {headers: djHeaders()})).status, 404);
  assert.equal(json(await http(port, `/api/dj/dossiers?key=${idOf(9)}`, {headers: djHeaders()})).error, 'dossier-not-found');
  assert.deepEqual((await readdir(dir)).sort(), [`${idOf(1)}.json`, `${idOf(2)}.json`].sort(), 'one plain file per song and no temporary files');
});

test('re-posting the same key replaces the file atomically; concurrent writes leave valid files only', async t => {
  const {port, dir} = await relay(t);
  const base = sampleDossier(3);
  await post(port, base);
  const changed = {...base, cost: {...base.cost, analysisMs: 777}};
  const replaced = json(await post(port, changed));
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.files, 1);
  assert.equal(parseSongDossier(JSON.parse(await readFile(join(dir, `${idOf(3)}.json`), 'utf8'))).cost.analysisMs, 777);
  const results = await Promise.all(Array.from({length: 8}, (_, i) => post(port, {...base, cost: {...base.cost, analysisMs: 100 + i}})));
  assert.ok(results.every(r => r.status === 200));
  const files = await readdir(dir);
  assert.deepEqual(files, [`${idOf(3)}.json`], 'no temporary file is left');
  assert.ok(parseSongDossier(JSON.parse(await readFile(join(dir, files[0]!), 'utf8'))), 'the surviving file is a whole valid dossier');
});

test('the relay refuses bad JSON, unknown fields, wrong values and oversized bodies without writing', async t => {
  const {port, dir} = await relay(t);
  const good = JSON.parse(JSON.stringify(sampleDossier(4))) as Record<string, any>;
  assert.equal((await post(port, 'not json')).status, 400);
  const cases: Record<string, unknown> = {
    'unknown field': {...good, extra: 'x'}, 'nested unknown field': {...good, tempo: {...good.tempo, extra: 1}}, 'bad version': {...good, version: 'em.song-dossier.v9'},
    'bad hash': {...good, key: {...good.key, sha256: '../../../etc/passwd'}}, 'control text': {...good, limitations: ['a\u0000b']}, 'array': [1, 2],
  };
  for (const [name, value] of Object.entries(cases)) {
    const result = await post(port, value);
    assert.equal(result.status, 400, name);
    assert.equal(json(result).error, 'invalid-dossier', name);
  }
  assert.equal((await post(port, 'x'.repeat(LIMITS.dossierBytes + 1))).status, 413, 'body cap');
  await assert.rejects(stat(dir), /ENOENT/, 'nothing was written');
});

test('keys are validated: no path can be named, nothing outside local/song-dossiers is read or written', async t => {
  const {port, root} = await relay(t);
  for (const key of ['../../package', '..%2F..%2Fpackage', 'package.json', `${sha(1)}_x`, '%00', 'a'.repeat(400)]) {
    const result = await http(port, `/api/dj/dossiers?key=${key}`, {headers: djHeaders()});
    assert.equal(result.status, 400, key);
  }
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), '{"private":true}');
});

test('the store has a file count and total size cap and refuses when full, changing nothing', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eutonos dossier caps '));
  t.after(async () => { await rm(root, {recursive: true, force: true}); });
  const store = new SongDossierFile(root);
  await mkdir(store.directory, {recursive: true});
  for (let i = 0; i < DOSSIER_FILE_LIMITS.maxFiles; i++) await writeFile(join(store.directory, `${sha(1000 + i)}_x_none_none.json`), '{}');
  await assert.rejects(store.put(sampleDossier(1)), (error: unknown) => error instanceof DossierFileError && error.code === 'full');
  assert.equal((await readdir(store.directory)).length, DOSSIER_FILE_LIMITS.maxFiles, 'a refused write changed nothing');
  // Replacing an existing key is allowed at the file-count cap.
  const second = new SongDossierFile(join(root, 'second'));
  await mkdir(second.directory, {recursive: true});
  await second.put(sampleDossier(1));
  const size = Buffer.byteLength(JSON.stringify(sampleDossier(1))) + 1;
  const big = Buffer.alloc(DOSSIER_FILE_LIMITS.maxTotalBytes - size - Math.floor(size / 2), 120);
  await writeFile(join(second.directory, `${sha(5000)}_x_none_none.json`), big);
  await assert.rejects(second.put(sampleDossier(2)), (error: unknown) => error instanceof DossierFileError && error.code === 'full', 'total size cap');
  assert.equal((await second.put(sampleDossier(1))).replaced, true, 'replacing a small file still fits');
});

test('a symlinked dossier file or folder is never written or read through, and errors name no path', async t => {
  const {port, root, dir} = await relay(t);
  await mkdir(dir, {recursive: true});
  const target = join(root, 'target.txt');
  await writeFile(target, 'untouched');
  const id = idOf(6);
  let canLink = true;
  try { await symlink(target, join(dir, `${id}.json`), 'file'); } catch { canLink = false; }
  if (canLink) {
    const result = await post(port, sampleDossier(6));
    assert.equal(result.status, 409);
    assert.equal(json(result).error, 'dossier-unsafe');
    assert.ok(!result.body.toString('utf8').includes(root), 'no filesystem path in the error');
    assert.equal(await readFile(target, 'utf8'), 'untouched', 'nothing was written through the symlink');
    assert.equal((await http(port, `/api/dj/dossiers?key=${id}`, {headers: djHeaders()})).status, 409, 'and it is not read through either');
    assert.ok(!(await http(port, '/api/dj/dossiers', {headers: djHeaders()})).body.toString('utf8').includes(id), 'a link is not listed');
  } else t.diagnostic('file symlinks need privilege here: file-symlink refusal NOT exercised');
  // A linked or junctioned folder (a junction needs no privilege on Windows).
  const store = await mkdtemp(join(tmpdir(), 'eutonos dossier links '));
  t.after(async () => { await rm(store, {recursive: true, force: true}); });
  const outside = join(store, 'outside');
  await mkdir(outside);
  await mkdir(join(store, 'root'));
  let canDirLink = true;
  try { await symlink(outside, join(store, 'root', 'local'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { canDirLink = false; }
  if (canDirLink) {
    await assert.rejects(new SongDossierFile(join(store, 'root')).put(sampleDossier(7)), (error: unknown) => error instanceof DossierFileError && error.code === 'unsafe');
    await assert.rejects(stat(join(outside, 'song-dossiers')), /ENOENT/, 'nothing was created through the folder link');
  } else t.diagnostic('directory links are unavailable here: directory-link refusal NOT exercised');
});

test('stray and mismatched files are ignored or refused: a renamed dossier is not served under another key', async t => {
  const {port, dir} = await relay(t);
  await post(port, sampleDossier(1));
  await writeFile(join(dir, 'tmp-abc.part'), 'half written');
  await writeFile(join(dir, 'notes.txt'), 'x');
  await writeFile(join(dir, `${idOf(2)}.json`), JSON.stringify(sampleDossier(1)), 'utf8');
  const list = json(await http(port, '/api/dj/dossiers', {headers: djHeaders()}));
  assert.ok(!list.entries.some((e: {id: string}) => e.id.includes('tmp') || e.id.includes('notes')), 'stray files are not listed');
  const wrong = await http(port, `/api/dj/dossiers?key=${idOf(2)}`, {headers: djHeaders()});
  assert.equal(wrong.status, 400, 'a file whose content does not match its name is refused');
  assert.equal(json(wrong).error, 'invalid-dossier');
  await writeFile(join(dir, `${idOf(3)}.json`), '{"version":"em.song-dossier.v1"', 'utf8');
  assert.equal((await http(port, `/api/dj/dossiers?key=${idOf(3)}`, {headers: djHeaders()})).status, 400, 'a truncated file is refused');
});
