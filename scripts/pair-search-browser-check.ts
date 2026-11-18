/**
 * Transition engine increment 3 (pair-search@1) Chromium gate. Run after build: node dist/scripts/pair-search-browser-check.js
 * Headless Chromium on an ephemeral loopback port (listen(0)); generated synthetic songs only, never owner audio.
 * Proves on the real Studio page with the real pre-check Worker: `?pairsearch=live` starts the background search for
 * the queue head while A plays, the readiness line reports checked plans, and Next then schedules from the table
 * (rung L0 in "Why this handover"). Off stays the default. Not listening, device or owner-pack evidence.
 */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type Page} from 'playwright';
import {createDemoServer} from './serve.js';
import {buildSyntheticSet} from '../tests/helpers/synthetic-set.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'artifacts', 'pair-search-browser');
await mkdir(output, {recursive: true});
const report = {platform: process.platform, node: process.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  browser: '', checks: [] as string[], readiness: [] as string[], why: [] as string[], error: ''};
// 48 bars at 120 BPM = 96 s each: well over 60 s of lead before Next.
const set = await buildSyntheticSet([
  {id: 'pair-120-a', bpm: 120, bars: 48, tonic: 9, mode: 'minor'},
  {id: 'pair-120-b', bpm: 120, bars: 48, tonic: 4, mode: 'minor'},
]);
const server = createDemoServer(root);
let browser: Browser | undefined;
const errors: string[] = [];
const content = (page: Page, id: string) => page.evaluate(target => document.getElementById(target)?.textContent ?? '', id);
async function waitContent(page: Page, id: string, pattern: RegExp, timeout = 30000): Promise<void> {
  try {
    await page.waitForFunction(([target, source]) => new RegExp(source!).test(document.getElementById(target!)?.textContent ?? ''), [id, pattern.source], {timeout});
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}; ${id}: ${await content(page, id)}; mix: ${await content(page, 'set-mix')}`);
  }
}
try {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1280, height: 1100}});
  context.setDefaultTimeout(30000);
  await context.route('http://127.0.0.1:7870/**', route => route.abort('connectionrefused'));
  await context.route(url => /^\/local\/s16-rated(?:\/|$)/.test(url.pathname), async route => {
    const path = new URL(route.request().url()).pathname.replace('/local/s16-rated/', '');
    if (!/^(?:catalog\.json|pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path)) return route.fulfill({status: 404});
    try { return await route.fulfill({body: await readFile(join(set.out, ...path.split('/')))}); }
    catch { return route.fulfill({status: 404}); }
  });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));

  const plain = await context.newPage();
  await plain.goto(origin + '/studio.html?pack=set&dossiers=off');
  await waitContent(plain, 'global-status', /loaded · 2 songs/);
  assert.equal(await plain.locator('#set-pair-search-mode').inputValue(), 'off');
  assert.equal(await content(plain, 'set-pair-search'), 'Pair search off.');
  await plain.close();
  report.checks.push('pair search is off by default on the Studio set page');

  const page = await context.newPage();
  await page.goto(origin + '/studio.html?pack=set&dossiers=off&pairsearch=live');
  await waitContent(page, 'global-status', /loaded · 2 songs/);
  assert.equal(await page.locator('#set-pair-search-mode').inputValue(), 'live');
  await page.locator('#dj-play').click();
  await waitContent(page, 'dj-now', /pair-120-a/);
  const started = Date.now();
  await waitContent(page, 'set-pair-search', /Pair search \(live\): [1-9]\d* checked plans? in \d+ exit slots.*search finished/, 90000);
  const searchMs = Date.now() - started;
  report.readiness.push(await content(page, 'set-pair-search'));
  report.checks.push(`background search with the real pre-check Worker finished while A played (${searchMs} ms wall, synthetic set)`);
  await page.locator('#dj-next').click();
  await waitContent(page, 'set-mix', /^Planned: /, 30000);
  await waitContent(page, 'set-why-reasons', /Ladder \(engine-ladder@1\): L0 checked plan from the pair search/, 10000);
  report.why.push(...(await page.locator('#set-why-reasons li').allTextContents()).filter(t => /Ladder|Pair search|Shadow/.test(t)));
  report.checks.push('Next after the search schedules from the pair plan table (rung L0 shown in Why this handover)');
  await page.locator('#dj-stop').click();
  assert.deepEqual(errors, []);
  console.log(`Pair search browser check passed (${report.checks.length} checks, ${report.browser}).`);
  for (const line of [...report.readiness, ...report.why]) console.log('  ' + line);
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (errors.length) report.error += `\nPage errors: ${errors.join(' | ')}`;
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await browser?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await set.cleanup();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
