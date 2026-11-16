/**
 * EMF-S18 set-mode browser gate. Run after npm run build: node dist/scripts/set-browser-check.js
 * Headless Chromium on an ephemeral loopback port. A synthetic four-song set (generated tones,
 * never owner audio) is imported through the real `importRatedTakes --set` path into a temp
 * folder and routed to the page at /local/s16-rated/, the only folder serve.ts exposes for it.
 * Proves: any-to-any order via queue reorder, Next on a 4-bar boundary, one Auto step anchored
 * to the song's entry, and the phone Auto command shape. Not listening or device evidence.
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
const output = new URL('../../artifacts/set-browser/', import.meta.url);
await mkdir(output, {recursive: true});
const report: {platform: string; node: string; source: string; browser?: string; checks: string[]; plans: string[]; error?: string} = {
  platform: process.platform, node: process.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), checks: [], plans: [],
};
// Fast tempos keep the 16-bar Auto step short; 120 BPM keeps a large tempo jump in the set.
const SONGS = [
  {id: 'synthetic-174-a', bpm: 174, bars: 20, tonic: 9, mode: 'minor' as const},
  {id: 'synthetic-168', bpm: 168, bars: 20, tonic: 9, mode: 'minor' as const},
  {id: 'synthetic-120', bpm: 120, bars: 12, tonic: 2, mode: 'major' as const},
  {id: 'synthetic-174-b', bpm: 174, bars: 20, tonic: 4, mode: 'minor' as const},
];
const set = await buildSyntheticSet(SONGS);
const server = createDemoServer(root);
let browser: Browser | undefined;
const errors: string[] = [];
const text = (page: Page, id: string) => page.locator('#' + id).innerText();
const waitText = (page: Page, id: string, pattern: RegExp, timeout = 15000) =>
  page.waitForFunction(([target, source]) => new RegExp(source!).test(document.getElementById(target!)?.textContent ?? ''),
    [id, pattern.source], {timeout});
const title = (id: string) => `Synthetic ${SONGS.find(s => s.id === id)!.bpm} BPM (${id})`;
const queueTitles = async (page: Page) => (await page.locator('#dj-queue li span:first-child').allInnerTexts()).map(t => t.replace(/^\d+\.\s*/, ''));
async function moveToHead(page: Page, songId: string): Promise<void> {
  for (let guard = 0; guard < 8; guard++) {
    const titles = await queueTitles(page), at = titles.indexOf(title(songId));
    assert.ok(at >= 0, `${songId} is queued`);
    if (at === 0) return;
    await page.getByRole('button', {name: `Move ${title(songId)} up`}).click();
    await page.waitForFunction(([want, before]) => {
      const first = Array.from(document.querySelectorAll('#dj-queue li span:first-child')).map(n => n.textContent ?? '');
      return first.findIndex(t => t.includes(want!)) === Number(before) - 1;
    }, [songId, String(at)]);
  }
  throw new Error(`Could not move ${songId} to the head`);
}

try {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1280, height: 1100}});
  context.setDefaultTimeout(15000);
  await context.route('http://127.0.0.1:7870/**', route => route.abort('connectionrefused'));
  const fetched: string[] = [];
  await context.route(origin + '/local/s16-rated/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/local/s16-rated/', '');
    if (!/^(?:catalog\.json|pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path)) return route.fulfill({status: 404});
    fetched.push(path);
    try { return await route.fulfill({body: await readFile(join(set.out, ...path.split('/')))}); }
    catch { return route.fulfill({status: 404}); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/studio.html?pack=set');
  await waitText(page, 'global-status', /Rated set.*loaded · 4 songs/);
  assert.equal(await page.locator('#set-panel').isVisible(), true);
  assert.equal(await page.locator('#mode-mix').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('#mode-direct').isDisabled(), true);
  assert.equal(await page.locator('#mode-hybrid').isDisabled(), true);
  assert.deepEqual(await queueTitles(page), set.order.map((_, i) => title([SONGS[0], SONGS[2], SONGS[1], SONGS[3]][i]!.id)),
    'the whole set is queued in catalogue order (love, then like)');
  assert.equal(fetched.filter(p => p.endsWith('.wav')).length, 0, 'no song audio is fetched before it is needed');
  assert.match(await text(page, 'set-songs'), /174 BPM requested.*(love|like)/s);
  report.checks.push('set page loads lazily (manifest only), automatic mix only, whole set queued in catalogue order with ratings');

  // Any-to-any: start with the third catalogue song, then reorder so 174-b follows it.
  await moveToHead(page, 'synthetic-168');
  await page.locator('#dj-play').click();
  await waitText(page, 'dj-now', /synthetic-168/);
  await moveToHead(page, 'synthetic-174-b');
  assert.equal(await page.locator('#dj-now').innerText(), title('synthetic-168'), 'a queue edit never moves the music');
  report.checks.push('reorder before Play picks the first song; reorder while playing does not move the music');

  // Next on the next 4-bar boundary.
  await page.selectOption('#set-next-bars', '4');
  await page.locator('#dj-next').click();
  await waitText(page, 'set-mix', /Planned: .*leaves on bar \d+ of the outgoing song \(4-bar boundary\)/, 30000);
  const planned = await text(page, 'set-mix');
  report.plans.push(planned);
  const exitBar = Number(/bar (\d+) of the outgoing/.exec(planned)![1]);
  assert.equal((exitBar - 1) % 4, 0, `Next lands on a 4-bar boundary (bar ${exitBar})`);
  assert.match(planned, /tempo change \+3\.6%/, '168 -> 174');
  assert.match(await text(page, 'dj-next-title'), /synthetic-174-b/);
  await waitText(page, 'dj-now', /^Synthetic 174 BPM \(synthetic-174-b\)$/, 40000);
  report.checks.push(`Next moves 168 -> 174-b (not catalogue order) on bar ${exitBar} of the outgoing song; recipe and tempo change shown`);

  // One Auto step: anchored to where 174-b came in, 16 bars later.
  await page.selectOption('#set-auto-bars', '16');
  await page.locator('#set-auto').click();
  assert.equal(await page.locator('#set-auto').getAttribute('aria-pressed'), 'true');
  await waitText(page, 'set-mix', /Planned: .*\(Auto every 16 bars\)/, 30000);
  const auto = await text(page, 'set-mix');
  report.plans.push(auto);
  const autoBar = Number(/bar (\d+) of the outgoing/.exec(auto)![1]);
  assert.ok(autoBar >= 14 && autoBar <= 17, `Auto leaves 16 bars after entry or the last full bar before the end (bar ${autoBar})`);
  assert.match(await text(page, 'dj-next-title'), /synthetic-174-a/);
  await waitText(page, 'dj-now', /^Synthetic 174 BPM \(synthetic-174-a\)$/, 60000);
  report.checks.push(`one Auto step moves 174-b -> 174-a on bar ${autoBar} (anchored to 174-b's entry), driven by the snapshot tick`);

  // Auto off (the phone auto command uses this same toggle), then stop.
  await page.locator('#set-auto').click();
  assert.equal(await page.locator('#set-auto').getAttribute('aria-pressed'), 'false');
  await page.locator('#dj-stop').click();
  await waitText(page, 'dj-now', /^Nothing$/);
  assert.ok(fetched.filter(p => p.endsWith('.wav')).length >= 3, 'songs were fetched lazily as they were needed');
  assert.deepEqual(errors, []);
  report.checks.push('Auto toggles off, Stop returns to silence, songs were fetched only when needed, no page errors');
  console.log(`Set browser check passed (${report.checks.length} checks, ${report.browser}).`);
  for (const plan of report.plans) console.log(`  plan: ${plan}`);
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (errors.length) report.error += `\nPage errors: ${errors.join(' | ')}`;
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await browser?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await set.cleanup();
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
}
