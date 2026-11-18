/**
 * DJ song sources Chromium gate. Run after build: node dist/scripts/dj-sources-browser-check.js
 * Headless Chromium, ephemeral loopback ports only (never the live phone host ports), a temp root and temp song folder of generated
 * tones, and an in-process fake Music Studio (the relay's server-side fetch is injected, nothing listens on 7870). Proves on the
 * real Studio page and the real phone page (strict CSP) through a real relay: a folder is added by path, sources are ticked and
 * unticked and the song list follows, songs show source and rating, love/like/dislike (and clear) work from the Studio and from the
 * phone, a dislike removes the song at once and Undo restores it, a Music Studio rating is written back to Music Studio, and the
 * phone card never shows a folder path. Not listening, device or real-phone evidence.
 */
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type Page} from 'playwright';
import {createDemoServer} from './serve.js';
import {createPhoneRelay, studioSetPageUrl, type EncoderProcess, type PhoneRelay} from './phone-relay.js';
import {DjSources} from './dj-sources.js';
import {pcm16Wav} from '../tests/helpers/synthetic-set.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'artifacts', 'dj-sources-browser');
await mkdir(output, {recursive: true});
const report = {platform: process.platform, node: process.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), browser: '', checks: [] as string[], error: ''};
const RATE = 8000;
function tone(seed: number, seconds = 12): Uint8Array {
  const frames = seconds * RATE, channel = new Float32Array(frames), hz = 110 + seed * 9.1;
  for (let i = 0; i < frames; i++) channel[i] = 0.3 * Math.sin(2 * Math.PI * hz * i / RATE) * (i % 4000 < 200 ? 1 : 0.6);
  return pcm16Wav({sampleRate: RATE, channels: [channel]});
}
interface FakeTake { id: string; title: string; rating: 'love' | 'like' | 'dislike' | null; seed: number }
const takes: FakeTake[] = [
  {id: 'ms-20261110-090001-a001', title: 'Studio loved one', rating: 'love', seed: 1},
  {id: 'ms-20261110-090002-a002', title: 'Studio liked one', rating: 'like', seed: 2},
];
const fakeStudio = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname !== '127.0.0.1' || url.port !== '7870') throw new Error('unexpected host');
  if (url.pathname === '/api/takes/rated') {
    const listed = takes.filter(x => x.rating === 'love' || x.rating === 'like').map(x => ({id: x.id, title: x.title, rating: x.rating,
      bpm: null, key: null, revision: x.id.replace(/\D/g, '').padEnd(16, '0')}));
    return new Response(JSON.stringify({schema: 'music-studio.rated-takes.v1', takes: listed}), {status: 200});
  }
  const audio = /^\/api\/takes\/(ms-[^/]+)\/dj-audio$/.exec(url.pathname);
  if (audio) { const take = takes.find(x => x.id === audio[1]); return take ? new Response(Buffer.from(tone(take.seed)), {status: 200}) : new Response('no', {status: 404}); }
  const patch = /^\/api\/takes\/(ms-[^/]+)$/.exec(url.pathname);
  if (patch && init?.method === 'PATCH') {
    const take = takes.find(x => x.id === patch[1]); if (!take) return new Response('no', {status: 404});
    take.rating = (JSON.parse(String(init.body)) as {rating: FakeTake['rating']}).rating;
    return new Response('{}', {status: 200});
  }
  return new Response('no', {status: 404});
}) as typeof fetch;

const sourcesRoot = await mkdtemp(join(tmpdir(), 'eutonos-sources-'));
await writeFile(join(sourcesRoot, 'package.json'), '{"private":true}');
const songDir = await mkdtemp(join(tmpdir(), 'eutonos-songs-'));
for (const [i, name] of ['Folder alpha 120bpm.wav', 'Folder beta.wav'].entries()) await writeFile(join(songDir, name), tone(10 + i));
const fakeEncoder = (): EncoderProcess => { const stdin = new PassThrough(), stdout = new PassThrough(); return {stdin, stdout, kill: () => undefined, on: () => undefined}; };
const demo = createDemoServer(root);
let relay: PhoneRelay | undefined;
let browser: Browser | undefined;
const errors: string[] = [];
const content = (page: Page, selector: string) => page.evaluate(s => document.querySelector(s)?.textContent ?? '', selector);
async function listen(server: import('node:http').Server): Promise<number> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return address.port;
}
async function waitFor(page: Page, selector: string, pattern: RegExp, timeout = 20000): Promise<void> {
  try {
    await page.waitForFunction(([s, source]) => new RegExp(source!).test(document.querySelector(s!)?.textContent ?? ''), [selector, pattern.source], {timeout});
  } catch (error) { throw new Error(`${error instanceof Error ? error.message : error}; ${selector}: ${await content(page, selector)}`); }
}
async function waitCount(page: Page, selector: string, count: number, timeout = 20000): Promise<void> {
  try { await page.waitForFunction(([s, n]) => document.querySelectorAll(s as string).length === n, [selector, count], {timeout}); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : error}; ${selector} count ${await page.locator(selector).count()}`); }
}
const rowOf = (page: Page, scope: string, title: string) => page.locator(`${scope} [data-src-song]`, {hasText: title}).first();
async function waitPressed(page: Page, scope: string, title: string, action: string, on: boolean): Promise<void> {
  const button = rowOf(page, scope, title).locator(`button[data-rate=${action}]`);
  try { await page.waitForFunction(([s, t, a, want]) => {
    const row = Array.from(document.querySelectorAll(`${s} [data-src-song]`)).find(r => (r.textContent ?? '').includes(t as string));
    return row?.querySelector(`button[data-rate=${a}]`)?.getAttribute('aria-pressed') === String(want);
  }, [scope, title, action, on], {timeout: 20000}); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : error}; ${title} ${action} pressed=${await button.getAttribute('aria-pressed').catch(() => 'missing')}`); }
}
const ratingsOnDisk = async () => JSON.parse(await readFile(join(sourcesRoot, 'local', 'dj-sources', 'ratings.json'), 'utf8')) as {ratings?: Record<string, {rating: string}>};
try {
  const demoPort = await listen(demo);
  const origin = `http://127.0.0.1:${demoPort}`;
  const sources = new DjSources({root: sourcesRoot, fetch: fakeStudio});
  relay = createPhoneRelay({spawnEncoder: fakeEncoder, djOrigins: [origin], feedbackRoot: sourcesRoot, sourcesRoot, sources});
  const relayPort = await listen(relay.server);
  const relayOrigin = `http://127.0.0.1:${relayPort}`;
  browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1280, height: 1400}});
  context.setDefaultTimeout(20000);
  await context.route('http://127.0.0.1:7870/**', route => route.abort('connectionrefused'));
  context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); });

  // ---- Studio: the pool starts from the two default-on Music Studio sources ----
  const studio = await context.newPage();
  await studio.goto(studioSetPageUrl(origin, relayPort, relay.token, '&dossiers=off'));
  await waitFor(studio, '#global-status', /Song sources: 2 songs/);
  await waitCount(studio, '#set-songs [data-src-song]', 2);
  assert.match(await content(studio, '#set-songs'), /Music Studio: loved/);
  await waitPressed(studio, '#set-songs', 'Studio loved one', 'love', true);
  await waitPressed(studio, '#set-songs', 'Studio liked one', 'like', true);
  report.checks.push('Studio starts from the ticked Music Studio sources; each song shows its source and its rating');

  // ---- add a folder by path; it is ticked and its unrated songs join ----
  await studio.locator('#src-path').fill(songDir);
  await studio.locator('#src-add').click();
  await waitFor(studio, '#global-status', /Song sources: 4 songs/, 30000);
  await waitCount(studio, '#set-songs [data-src-song]', 4);
  assert.match(await content(studio, '#set-songs'), /unrated/i);
  assert.match(await content(studio, '#src-list'), /2 songs/);
  report.checks.push('adding a folder by path joins its unrated songs to the pool and the queue refreshes');

  // ---- rate from the Studio: love, clear, dislike, Undo ----
  const alpha = 'Folder alpha';
  await rowOf(studio, '#set-songs', alpha).locator('button[data-rate=love]').click();
  await waitPressed(studio, '#set-songs', alpha, 'love', true);
  await rowOf(studio, '#set-songs', alpha).locator('button[data-rate=love]').click();
  await waitPressed(studio, '#set-songs', alpha, 'love', false);
  await rowOf(studio, '#set-songs', alpha).locator('button[data-rate=like]').click();
  await waitPressed(studio, '#set-songs', alpha, 'like', true);
  const rated = await ratingsOnDisk();
  assert.ok(Object.values(rated.ratings ?? {}).some(r => r.rating === 'like'), 'the folder song rating is kept on the PC by file hash');
  await rowOf(studio, '#set-songs', alpha).locator('button[data-rate=dislike]').click();
  await waitCount(studio, '#set-songs [data-src-song]', 3);
  await waitCount(studio, '#src-disliked [data-undo]', 1);
  assert.equal(await rowOf(studio, '#set-songs', alpha).count(), 0, 'a disliked song leaves the playable list at once');
  await studio.locator('#src-disliked-wrap summary').click();
  await studio.locator('#src-disliked [data-undo]').click();
  await waitCount(studio, '#set-songs [data-src-song]', 4);
  report.checks.push('Studio rating: love, clear, like, dislike (leaves the pool at once) and Undo (restores it); folder ratings are stored by hash on the PC');

  // ---- Music Studio songs write the rating back to Music Studio ----
  await rowOf(studio, '#set-songs', 'Studio liked one').locator('button[data-rate=love]').click();
  await waitPressed(studio, '#set-songs', 'Studio liked one', 'love', true);
  assert.equal(takes.find(x => x.id === 'ms-20261110-090002-a002')?.rating, 'love', 'the rating was written back to Music Studio');
  report.checks.push('rating a Music Studio song writes the rating back through Music Studio');

  // ---- untick a source: the pool follows ----
  await studio.locator('#src-tick-studio-loved').uncheck();
  await waitCount(studio, '#set-songs [data-src-song]', 2, 30000);
  await studio.locator('#src-tick-studio-loved').check();
  await waitCount(studio, '#set-songs [data-src-song]', 4, 30000);
  report.checks.push('unticking and ticking a source changes the pool and the queue');

  // ---- phone: strict CSP, no folder paths, rating reaches the Studio ----
  const phone = await context.newPage();
  await phone.goto(relayOrigin + '/');
  await phone.locator('#sources > summary').click();
  await waitCount(phone, '#sources-songs [data-src-song]', 4);
  const phoneText = await content(phone, '#sources-card');
  assert.ok(!phoneText.includes(songDir) && !phoneText.includes(tmpdir()) && !/[A-Za-z]:[\/]/.test(phoneText), 'the phone card shows no folder path');
  assert.equal(await phone.locator('#sources-add').count(), 0, 'the phone cannot add folders');
  await rowOf(phone, '#sources-songs', 'Folder beta').locator('button[data-rate=dislike]').click();
  await waitCount(phone, '#sources-songs [data-src-song]', 3);
  await waitCount(studio, '#set-songs [data-src-song]', 3, 30000);
  assert.equal(await rowOf(studio, '#set-songs', 'Folder beta').count(), 0);
  await phone.locator('#sources-disliked-wrap summary').click();
  await phone.locator('#sources-disliked [data-undo]').click();
  await waitCount(phone, '#sources-songs [data-src-song]', 4);
  await rowOf(phone, '#sources-songs', 'Folder beta').locator('button[data-rate=love]').click();
  await waitPressed(phone, '#sources-songs', 'Folder beta', 'love', true);
  await waitPressed(studio, '#set-songs', 'Folder beta', 'love', true);
  report.checks.push('the phone card (strict CSP) shows no folder path, cannot add folders; a phone dislike removes the song from the Studio queue, Undo restores it, and a phone love reaches the Studio');

  assert.deepEqual(errors, []);
  console.log(`DJ sources browser check passed (${report.checks.length} checks, ${report.browser}).`);
  for (const line of report.checks) console.log('  ' + line);
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (errors.length) report.error += `\nPage errors: ${errors.join(' | ')}`;
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await browser?.close();
  await relay?.close();
  await new Promise<void>(resolve => demo.close(() => resolve()));
  await rm(sourcesRoot, {recursive: true, force: true});
  await rm(songDir, {recursive: true, force: true});
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
