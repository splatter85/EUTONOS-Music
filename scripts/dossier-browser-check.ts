/**
 * Song-dossier browser gate (increment 2). Synthetic original fixtures, a temporary relay store and
 * isolated Chromium profiles only. Run after build: node dist/scripts/dossier-browser-check.js
 *
 *  1. A fresh profile loads a three-song set: the background scheduler analyses every song before any
 *     Play, the page shows "Analysed 3/3 · next ready", and the relay's local/song-dossiers holds 3 files.
 *  2. A SECOND fresh profile (empty IndexedDB, like phone:host) restores all three dossiers from the
 *     relay store and fetches only the next song's audio (to warm the planner's cache), not all three.
 * Browser/worker/storage evidence does not establish device playback or listening.
 */
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser} from 'playwright';
import {createDemoServer} from './serve.js';
import {createPhoneRelay, type EncoderProcess, type PhoneRelay} from './phone-relay.js';
import {buildSyntheticSet} from '../tests/helpers/synthetic-set.js';
import {parseSongDossier} from '../web/song-dossier.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'artifacts', 'dossier-browser');
await mkdir(output, {recursive: true});
const TOKEN = '0123456789abcdef0123456789abcdef';
const report = {platform: process.platform, node: process.version, browser: '', checks: [] as string[], metrics: [] as unknown[], error: ''};
const set = await buildSyntheticSet([
  {id: 'dossier-174-a', bpm: 174, bars: 20, tonic: 9, mode: 'minor', stereo: true},
  {id: 'dossier-168-b', bpm: 168, bars: 20, tonic: 9, mode: 'minor', stereo: true},
  {id: 'dossier-140-c', bpm: 140, bars: 20, tonic: 4, mode: 'minor', stereo: true},
]);
const dossierRoot = await mkdtemp(join(tmpdir(), 'eutonos-dossier-check-'));
const server = createDemoServer(root);
const encoder = (): EncoderProcess => { const stdin = new PassThrough(), stdout = new PassThrough(); return {stdin, stdout, kill: () => undefined, on: () => undefined}; };
let relay: PhoneRelay | undefined, browser: Browser | undefined;
const errors: string[] = [];
const listen = (target: {listen(port: number, host: string, cb: () => void): unknown; address(): unknown; once(event: string, cb: (e: Error) => void): unknown}): Promise<number> =>
  new Promise((resolve, reject) => {
    target.once('error', reject);
    target.listen(0, '127.0.0.1', () => { const a = target.address(); resolve(typeof a === 'object' && a ? (a as {port: number}).port : 0); });
  });
try {
  const origin = `http://127.0.0.1:${await listen(server)}`;
  relay = createPhoneRelay({spawnEncoder: encoder, djOrigins: [origin], feedbackRoot: dossierRoot, token: TOKEN});
  const relayOrigin = `http://127.0.0.1:${await listen(relay.server)}`;
  browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  report.browser = browser.version();
  const url = `${origin}/studio.html?pack=set&relay=${encodeURIComponent(relayOrigin)}&sources=legacy#relayToken=${TOKEN}`;
  const store = (): Promise<string[]> => readdir(join(dossierRoot, 'local', 'song-dossiers')).catch(() => []);

  async function open(label: string): Promise<{page: import('playwright').Page; wavs: () => string[]; dossierCalls: () => string[]; close(): Promise<void>}> {
    const context = await browser!.newContext({viewport: {width: 1280, height: 1000}});
    context.setDefaultTimeout(60_000);
    await context.route('http://127.0.0.1:7870/**', route => route.abort('connectionrefused'));
    const wavs: string[] = [], calls: string[] = [];
    await context.route(origin + '/local/s16-rated/**', async route => {
      const path = new URL(route.request().url()).pathname.replace('/local/s16-rated/', '');
      if (!/^(?:catalog\.json|pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path)) return route.fulfill({status: 404});
      if (path.endsWith('.wav')) wavs.push(path);
      try { return await route.fulfill({body: await readFile(join(set.out, ...path.split('/')))}); } catch { return route.fulfill({status: 404}); }
    });
    context.on('request', request => { if (request.url().startsWith(relayOrigin + '/api/dj/dossier')) calls.push(`${request.method()} ${new URL(request.url()).pathname}`); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
    await page.goto(url);
    return {page, wavs: () => wavs, dossierCalls: () => calls, close: () => context.close()};
  }

  // 1. Fresh profile: songs are analysed before any Play, and saved on the PC.
  const first = await open('first');
  await first.page.waitForFunction(() => document.getElementById('global-status')?.textContent?.includes('loaded · 3 songs'));
  await first.page.waitForFunction(() => /Analysed 3\/3 · next ready/.test(document.getElementById('set-analysis')?.textContent ?? ''));
  assert.equal(await first.page.locator('#dj-now').innerText(), 'Nothing', 'background analysis never starts playback');
  assert.ok(first.wavs().length >= 3, 'every song was fetched and analysed with no Play pressed');
  const saved = await store();
  assert.equal(saved.length, 3, 'three dossier files are in local/song-dossiers');
  const dossiers = await Promise.all(saved.map(async name => parseSongDossier(JSON.parse(await readFile(join(dossierRoot, 'local', 'song-dossiers', name), 'utf8')))));
  for (const d of dossiers) {
    assert.ok(d.tempo.bpm !== null && d.grid.downbeatSeconds.length > 0 && d.cost.analysisMs > 0, 'tempo, downbeats and cost recorded');
  }
  report.metrics.push({firstProfile: {wavRequests: first.wavs().length, files: saved.length, analysisMs: dossiers.map(d => d.cost.analysisMs), bpm: dossiers.map(d => d.tempo.bpm)}});
  report.checks.push('a fresh profile analyses the whole set before any Play, shows "Analysed 3/3 · next ready" and saves 3 valid dossiers on the PC store');
  await first.close();

  // 2. Second fresh profile (empty IndexedDB): dossiers come back from the relay; only the next song's audio is fetched.
  const second = await open('second');
  await second.page.waitForFunction(() => document.getElementById('global-status')?.textContent?.includes('loaded · 3 songs'));
  await second.page.waitForFunction(() => /Analysed 3\/3 · next ready/.test(document.getElementById('set-analysis')?.textContent ?? ''));
  assert.equal(second.wavs().length, 1, 'only the next song was fetched (to warm the planner cache); the other dossiers came from the PC store');
  assert.ok(second.dossierCalls().some(call => call.startsWith('GET /api/dj/dossiers')), 'the page asked the relay for stored dossiers');
  assert.equal((await store()).length, 3, 'the store still holds exactly 3 files (re-saved, not duplicated)');
  report.metrics.push({secondProfile: {wavRequests: second.wavs().length, relayCalls: second.dossierCalls().length}});
  report.checks.push('a second fresh profile restores the dossiers from the PC store and fetches only the next song to warm the planner cache');
  await second.page.screenshot({path: join(output, 'studio-dossiers.png'), fullPage: true});
  await second.close();
  assert.deepEqual(errors, []);
  report.checks.push('no uncaught browser errors');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (errors.length) report.error += '\nPage errors: ' + errors.join(' | ');
  console.error(report.error); process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await relay?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await set.cleanup();
  await rm(dossierRoot, {recursive: true, force: true});
}
