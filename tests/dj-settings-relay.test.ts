// DJ booth settings on the PC: the settings file (atomic, capped, symlink refusal), the relay endpoints (the DJ side with the
// relay token, the phone side same-origin only), and the browser-side store that keeps the Studio and the phone in step.
// Temp folders only; no audio.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {request, type IncomingHttpHeaders} from 'node:http';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import test, {type TestContext} from 'node:test';
import {createPhoneRelay, LIMITS, type EncoderProcess, type PhoneRelay} from '../scripts/phone-relay.js';
import {DjSettingsFile, DjSettingsFileError, SETTINGS_FILE_LIMITS} from '../scripts/dj-settings-file.js';
import {defaultDjSettings, mergeDjSettings, STYLE_IDS} from '../web/dj-settings.js';
import {DjSettingsStore, SETTINGS_CACHE_KEY, type KeyValueStorage} from '../web/dj-settings-store.js';

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
const phoneHeaders = (port: number, extra: Record<string, string> = {}): Record<string, string> =>
  ({origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...extra});
const json = (result: HttpResult): Record<string, any> => JSON.parse(result.body.toString('utf8')) as Record<string, any>;
const djPost = (port: number, body: unknown, headers = djHeaders()): Promise<HttpResult> =>
  http(port, '/api/dj/settings', {method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)});
const phonePost = (port: number, body: unknown, headers = phoneHeaders(port)): Promise<HttpResult> =>
  http(port, '/api/settings', {method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)});

async function relay(t: TestContext): Promise<{relay: PhoneRelay; port: number; root: string; file: string}> {
  const root = await mkdtemp(join(tmpdir(), 'eutonos settings '));
  await writeFile(join(root, 'package.json'), '{"private":true}');
  const encoder = (): EncoderProcess => { const stdin = new PassThrough(), stdout = new PassThrough(); return {stdin, stdout, kill: () => undefined, on: () => undefined}; };
  const created = createPhoneRelay({root, feedbackRoot: root, token: TOKEN, spawnEncoder: encoder});
  t.after(async () => { await created.close(); await rm(root, {recursive: true, force: true}); });
  created.server.listen(0, '127.0.0.1');
  await once(created.server, 'listening');
  const address = created.server.address();
  assert.ok(address && typeof address !== 'string');
  return {relay: created, port: address.port, root, file: join(root, 'local', 'dj-settings', 'settings.json')};
}
const tmp = async (t: TestContext): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'eutonos settings file '));
  t.after(async () => { await rm(root, {recursive: true, force: true}); });
  return root;
};

test('settings file: defaults when absent, partial merge, atomic write, reset, rev counts writes', async t => {
  const root = await tmp(t), file = new DjSettingsFile(root);
  const empty = await file.read();
  assert.deepEqual([empty.updatedAt, empty.rev], [null, 0]);
  assert.deepEqual(empty.settings, defaultDjSettings());
  await assert.rejects(stat(join(root, 'local')), /ENOENT/, 'a read creates nothing');
  const first = await file.write({explore: {mode: 'manual', value: 'high'}}, new Date('2026-11-17T10:00:00Z'));
  assert.deepEqual([first.rev, first.updatedAt, first.settings.explore], [1, '2026-11-17T10:00:00.000Z', {mode: 'manual', value: 'high'}]);
  const second = await file.write({waitBars: {mode: 'manual', value: 4}});
  assert.equal(second.rev, 2);
  assert.deepEqual(second.settings.explore, {mode: 'manual', value: 'high'}, 'a partial write keeps the other settings');
  assert.deepEqual((await new DjSettingsFile(root).read()).settings.waitBars, {mode: 'manual', value: 4}, 'a new reader sees it');
  assert.deepEqual((await readdir(join(root, 'local', 'dj-settings'))), ['settings.json'], 'no temporary file is left behind');
  const reset = await file.write({}, new Date(), true);
  assert.deepEqual(reset.settings, defaultDjSettings()); assert.equal(reset.rev, 3);
  // Concurrent writes are serialized: every one lands and rev counts them all.
  await Promise.all([1, 2, 3, 4, 5].map(n => file.write({maxStretch: {mode: 'manual', value: n % 2 ? 8 : 15}})));
  assert.equal((await file.read()).rev, 8);
});

test('settings file: bad values change nothing, unknown keys are ignored, the size cap and a damaged file are handled', async t => {
  const root = await tmp(t), file = new DjSettingsFile(root);
  await file.write({explore: {mode: 'manual', value: 'low'}});
  for (const bad of [{explore: {mode: 'manual', value: 'wild'}}, {styles: {mode: 'manual', value: []}}, {maxStretch: {mode: 'manual', value: 99}}, 'text', null]) {
    await assert.rejects(file.write(bad), (error: unknown) => error instanceof DjSettingsFileError && error.code === 'invalid', JSON.stringify(bad));
  }
  const kept = await file.read();
  assert.equal(kept.rev, 1, 'a refused write did not count'); assert.deepEqual(kept.settings.explore, {mode: 'manual', value: 'low'});
  const ignored = await file.write({surprise: true, explore: {mode: 'manual', value: 'off', extra: 1}});
  assert.equal((ignored.settings as unknown as Record<string, unknown>).surprise, undefined);
  assert.ok((await readFile(join(root, 'local', 'dj-settings', 'settings.json'), 'utf8')).length < SETTINGS_FILE_LIMITS.maxFileBytes);
  // A stored file that is too large or damaged is reported, and a valid write replaces a damaged one.
  const path = join(root, 'local', 'dj-settings', 'settings.json');
  await writeFile(path, 'x'.repeat(SETTINGS_FILE_LIMITS.maxFileBytes + 1));
  await assert.rejects(file.read(), (error: unknown) => error instanceof DjSettingsFileError && error.code === 'too-large');
  await writeFile(path, '{"version":"em.dj-settings-file.v1"');
  await assert.rejects(file.read(), (error: unknown) => error instanceof DjSettingsFileError && error.code === 'invalid');
  const repaired = await file.write({waitBars: {mode: 'manual', value: 0}});
  assert.equal(repaired.rev, 1); assert.deepEqual(repaired.settings.waitBars, {mode: 'manual', value: 0});
});

test('settings file: a symlinked or junctioned file or folder is never written or read through, and errors name no path', async t => {
  const root = await tmp(t);
  const dir = join(root, 'local', 'dj-settings');
  await mkdir(dir, {recursive: true});
  const target = join(root, 'target.txt');
  await writeFile(target, 'untouched');
  let canLink = true;
  try { await symlink(target, join(dir, 'settings.json'), 'file'); } catch { canLink = false; }
  if (canLink) {
    const file = new DjSettingsFile(root);
    await assert.rejects(file.write({explore: {mode: 'manual', value: 'low'}}), (error: unknown) => error instanceof DjSettingsFileError && error.code === 'unsafe' && !error.message.includes(root));
    await assert.rejects(file.read(), (error: unknown) => error instanceof DjSettingsFileError && error.code === 'unsafe');
    assert.equal(await readFile(target, 'utf8'), 'untouched', 'nothing was written through the symlink');
  } else t.diagnostic('file symlinks need privilege here: file-symlink refusal NOT exercised');
  const store = await tmp(t), outside = join(store, 'outside');
  await mkdir(outside); await mkdir(join(store, 'root'));
  let canDirLink = true;
  try { await symlink(outside, join(store, 'root', 'local'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { canDirLink = false; }
  if (canDirLink) {
    await assert.rejects(new DjSettingsFile(join(store, 'root')).write({}), (error: unknown) => error instanceof DjSettingsFileError && error.code === 'unsafe');
    await assert.rejects(stat(join(outside, 'dj-settings')), /ENOENT/, 'nothing was created through the folder link');
  } else t.diagnostic('directory links are unavailable here: directory-link refusal NOT exercised');
});

test('relay DJ endpoint: the DJ origin, the token and the DJ guard apply like every other DJ endpoint', async t => {
  const {port, file} = await relay(t);
  const noToken = {origin: DJ, 'content-type': 'application/json'};
  assert.equal((await http(port, '/api/dj/settings', {headers: noToken})).status, 401);
  assert.equal((await djPost(port, {}, noToken)).status, 401);
  assert.equal((await http(port, '/api/dj/settings?token=' + TOKEN, {headers: noToken})).status, 401, 'no query token');
  assert.equal((await http(port, '/api/dj/settings', {headers: {origin: 'https://pc.tail1.ts.net', 'x-relay-token': TOKEN}})).status, 403, 'tailnet origin refused');
  assert.equal((await http(port, '/api/dj/settings', {headers: {'x-relay-token': TOKEN, 'x-forwarded-for': '100.1.2.3'}})).status, 403, 'proxied request refused');
  assert.equal((await http(port, '/api/dj/settings', {method: 'DELETE', headers: djHeaders()})).status, 405);
  assert.equal((await http(port, '/api/dj/settings', {method: 'OPTIONS', headers: djHeaders({'access-control-request-method': 'POST'})})).status, 204);
  await assert.rejects(stat(file), /ENOENT/, 'refused and read-only requests create nothing');
});

test('relay DJ endpoint: GET returns defaults, POST merges, validates, resets and persists to local/dj-settings', async t => {
  const {port, file, root} = await relay(t);
  const initial = json(await http(port, '/api/dj/settings', {headers: djHeaders()}));
  assert.deepEqual([initial.rev, initial.updatedAt, initial.version], [0, null, 'em.dj-settings-file.v1']);
  assert.deepEqual(initial.settings, defaultDjSettings());
  const a = await djPost(port, {styles: {mode: 'manual', value: ['crossfade', 'echo-reset']}, junk: 1});
  assert.equal(a.status, 200); assert.equal(json(a).rev, 1);
  assert.deepEqual(json(a).settings.styles, {mode: 'manual', value: ['crossfade', 'echo-reset']});
  assert.equal((await djPost(port, {explore: {mode: 'manual', value: 'low'}})).status, 200);
  const both = json(await http(port, '/api/dj/settings', {headers: djHeaders()}));
  assert.deepEqual([both.settings.explore.value, both.settings.styles.value.length, both.rev], ['low', 2, 2]);
  const onDisk = JSON.parse(await readFile(file, 'utf8')) as Record<string, any>;
  assert.equal(onDisk.rev, 2); assert.ok(file.startsWith(join(root, 'local', 'dj-settings')));
  // Bad values: 400 with a short reason, nothing changes.
  for (const bad of [{explore: {mode: 'manual', value: 'wild'}}, {styles: {mode: 'manual', value: []}}, {waitBars: {mode: 'manual', value: 3}}, '[1,2]']) {
    const r = await djPost(port, bad);
    assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(json(r).error, 'invalid-settings');
    assert.ok(!r.body.toString('utf8').includes(root), 'no path in the error');
  }
  assert.equal((await djPost(port, 'not json')).status, 400);
  assert.equal(json(await http(port, '/api/dj/settings', {headers: djHeaders()})).rev, 2, 'refused writes did not count');
  // Oversized body refused before anything is written.
  const big = await djPost(port, JSON.stringify({pad: 'x'.repeat(LIMITS.settingsBytes + 10)}));
  assert.equal(big.status, 413);
  // Reset restores the safe defaults in one call.
  const reset = json(await djPost(port, {reset: true}));
  assert.deepEqual(reset.settings, defaultDjSettings()); assert.equal(reset.rev, 3);
});

test('relay phone endpoint: same-origin only, JSON only, shares the file with the DJ endpoint', async t => {
  const {port, file} = await relay(t);
  const read = await http(port, '/api/settings', {headers: phoneHeaders(port)});
  assert.equal(read.status, 200); assert.deepEqual(json(read).settings, defaultDjSettings());
  // Cross-site, foreign origin and a non-JSON body are refused; nothing is written.
  assert.equal((await http(port, '/api/settings', {headers: {'sec-fetch-site': 'cross-site'}})).status, 403);
  assert.equal((await phonePost(port, {}, phoneHeaders(port, {origin: 'https://evil.example'}))).status, 403);
  assert.equal((await phonePost(port, {}, phoneHeaders(port, {'sec-fetch-site': 'cross-site'}))).status, 403);
  assert.equal((await phonePost(port, {}, {...phoneHeaders(port), 'content-type': 'text/plain'})).status, 403);
  assert.equal((await http(port, '/api/settings', {method: 'DELETE', headers: phoneHeaders(port)})).status, 405);
  await assert.rejects(stat(file), /ENOENT/);
  // The phone changes a setting; the Studio's DJ endpoint sees it, and the other way round.
  const changed = await phonePost(port, {maxStretch: {mode: 'manual', value: 8}});
  assert.equal(changed.status, 200); assert.equal(json(changed).rev, 1);
  assert.deepEqual(json(await http(port, '/api/dj/settings', {headers: djHeaders()})).settings.maxStretch, {mode: 'manual', value: 8});
  await djPost(port, {waitBars: {mode: 'manual', value: 0}});
  const seen = json(await http(port, '/api/settings', {headers: phoneHeaders(port)}));
  assert.deepEqual([seen.settings.maxStretch.value, seen.settings.waitBars.value, seen.rev], [8, 0, 2]);
  assert.equal((await phonePost(port, {explore: {mode: 'manual', value: 'wild'}})).status, 400);
  assert.deepEqual(json(await phonePost(port, {reset: true})).settings, defaultDjSettings());
  assert.equal((await phonePost(port, '{"x":' + 'y'.repeat(LIMITS.settingsBytes))).status, 413);
});

test('the phone page can load the settings modules it imports, and nothing else new', async t => {
  const {port, root} = await relay(t);
  // The relay serves only an allowlist from dist/web; copy the real built files into the temp root so the allowlist is what is tested.
  await mkdir(join(root, 'dist', 'web'), {recursive: true});
  const built = fileURLToPath(new URL('../web/', import.meta.url));
  for (const name of await readdir(built)) if (name.endsWith('.js')) await writeFile(join(root, 'dist', 'web', name), await readFile(join(built, name)));
  // The three modules the phone imports must be on the allowlist (a 404 here means a blank phone).
  for (const name of ['dj-settings.js', 'dj-settings-store.js', 'dj-settings-ui.js']) {
    const r = await http(port, `/${name}`, {headers: {host: `127.0.0.1:${port}`}});
    assert.equal(r.status, 200, name); assert.match(String(r.headers['content-type']), /javascript/);
    for (const m of r.body.toString('utf8').matchAll(/from '\.\/([a-z-]+\.js)'/g)) {
      assert.equal((await http(port, `/${m[1]}`)).status, 200, `${name} imports ${m[1]}`);
    }
  }
  assert.equal((await http(port, '/dj-settings-file.js')).status, 404);
});

// ---------- the browser-side store ----------
class Memory implements KeyValueStorage {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}
const stamp = (n: number): (() => Date) => () => new Date(Date.UTC(2026, 10, 17, 10, 0, n));

test('store: with no relay a change applies at once, persists in the browser and says local', async () => {
  const storage = new Memory();
  let changes = 0;
  const store = new DjSettingsStore({endpoint: null, storage, now: stamp(1), onChange: () => { changes++; }});
  assert.equal(store.relayReady, false);
  const outcome = store.update({explore: {mode: 'manual', value: 'off'}});
  assert.equal(changes, 1, 'the change is applied synchronously, before any await');
  assert.deepEqual(store.get().explore, {mode: 'manual', value: 'off'});
  assert.equal(await outcome, 'local');
  assert.equal(new DjSettingsStore({endpoint: null, storage}).get().explore.value, 'off', 'a reload in the same browser keeps it');
  await assert.rejects(store.update({explore: {mode: 'manual', value: 'wild'}}), Error);
  assert.equal(store.get().explore.value, 'off', 'a refused change changes nothing');
  assert.ok(storage.getItem(SETTINGS_CACHE_KEY));
  assert.equal(await store.reset(), 'local');
  assert.deepEqual(store.get(), defaultDjSettings());
  // A damaged cache starts from the defaults.
  storage.setItem(SETTINGS_CACHE_KEY, '{nope');
  assert.deepEqual(new DjSettingsStore({endpoint: null, storage}).get(), defaultDjSettings());
});

test('store: Studio and phone stores share the PC file; the newest change wins and a failed save is retried', async t => {
  const {port} = await relay(t);
  const origin = `http://127.0.0.1:${port}`;
  const studioFetch = ((input: string, init?: RequestInit) => fetch(input, {...init, headers: {...(init?.headers as Record<string, string>), origin: DJ}})) as typeof fetch;
  const phoneFetch = ((input: string, init?: RequestInit) => fetch(`${origin}${input}`, {...init, headers: {...(init?.headers as Record<string, string>), origin, 'sec-fetch-site': 'same-origin'}})) as typeof fetch;
  const studio = new DjSettingsStore({endpoint: `${origin}/api/dj/settings`, token: TOKEN, storage: new Memory(), fetch: studioFetch, now: stamp(10)});
  const phone = new DjSettingsStore({endpoint: '/api/settings', storage: new Memory(), fetch: phoneFetch, now: stamp(20)});
  assert.equal(await studio.update({explore: {mode: 'manual', value: 'high'}}), 'saved');
  assert.ok(studio.isSaved);
  await phone.sync();
  assert.deepEqual(phone.get().explore, {mode: 'manual', value: 'high'}, 'the phone adopts the Studio change');
  assert.equal(await phone.update({maxStretch: {mode: 'manual', value: 8}}), 'saved');
  await studio.sync();
  assert.deepEqual([studio.get().maxStretch.value, studio.get().explore.value], [8, 'high'], 'the Studio adopts the phone change and keeps its own');
  const ids = STYLE_IDS.slice(0, 3);
  await studio.update({styles: {mode: 'manual', value: ids}});
  await phone.sync();
  assert.deepEqual(phone.get().styles.value, ids);
  // Reset from the phone reaches the Studio.
  await phone.reset(); await studio.sync();
  assert.deepEqual(studio.get(), defaultDjSettings());
  // A store whose relay is unreachable keeps the change locally and pushes it on the next sync.
  let down = true;
  const flaky = new DjSettingsStore({endpoint: `${origin}/api/dj/settings`, token: TOKEN, storage: new Memory(), now: stamp(40),
    fetch: ((input: string, init?: RequestInit) => down ? Promise.reject(new Error('offline')) : studioFetch(input, init)) as typeof fetch});
  assert.equal(await flaky.update({waitBars: {mode: 'manual', value: 4}}), 'queued');
  assert.ok(flaky.pending && /Cannot reach the relay/.test(flaky.lastProblem));
  assert.deepEqual(flaky.get().waitBars, {mode: 'manual', value: 4}, 'applied locally while offline');
  down = false;
  await flaky.sync();
  assert.ok(flaky.isSaved && !flaky.pending);
  await phone.sync();
  assert.deepEqual(phone.get().waitBars, {mode: 'manual', value: 4});
});

test('store: a bad token or refused change is reported and does not mark the settings saved', async t => {
  const {port} = await relay(t);
  const origin = `http://127.0.0.1:${port}`;
  const withOrigin = ((input: string, init?: RequestInit) => fetch(input, {...init, headers: {...(init?.headers as Record<string, string>), origin: DJ}})) as typeof fetch;
  const wrong = new DjSettingsStore({endpoint: `${origin}/api/dj/settings`, token: 'f'.repeat(32), storage: new Memory(), fetch: withOrigin, now: stamp(1)});
  assert.equal(await wrong.update({explore: {mode: 'manual', value: 'low'}}), 'queued');
  assert.ok(!wrong.isSaved && /relay-token-required/.test(wrong.lastProblem), wrong.lastProblem);
  assert.equal(wrong.get().explore.value, 'low', 'still applied locally');
  const unchanged = mergeDjSettings(defaultDjSettings(), {});
  assert.deepEqual(unchanged, defaultDjSettings());
});
