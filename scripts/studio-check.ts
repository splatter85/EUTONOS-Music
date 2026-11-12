/**
 * EUTONOS Studio browser gate. Run after npm run build (and the mock FL producer):
 * node dist/scripts/studio-check.js
 * Headless Chromium on an ephemeral loopback port. The Music Studio service is never
 * contacted: its origin is first refused, then answered by an in-test fake, so this
 * checks the page's wiring only — not the generator, physical output or listening.
 */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type Page, type Route} from 'playwright';
import {createDemoServer} from './serve.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = new URL('../../artifacts/studio-browser/', import.meta.url);
await mkdir(output, {recursive: true});
const report: {platform: string; node: string; source: string; browser?: string; checks: string[]; error?: string} = {
  platform: process.platform, node: process.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), checks: [],
};
const server = createDemoServer(root);
let browser: Browser | undefined;
let current: Page | undefined;
const errors: string[] = [];
const text = (page: Page, id: string) => page.locator('#' + id).innerText();
const waitText = (page: Page, id: string, pattern: RegExp, timeout = 15000) =>
  page.waitForFunction(([target, source]) => new RegExp(source!).test(document.getElementById(target!)?.textContent ?? ''),
    [id, pattern.source], {timeout});

// A tiny in-test stand-in for the local Music Studio API (http://127.0.0.1:7870).
const fake = {online: false, patched: [] as unknown[], generated: [] as unknown[],
  takes: [{id: 'take-1', title: 'Fake take', duration_seconds: 30, bpm: 120, key: 'A minor', starred: false, rejected: false, rating: null as string | null}]};
async function studioApi(route: Route): Promise<void> {
  if (!fake.online) { await route.abort('connectionrefused'); return; }
  const request = route.request(), url = new URL(request.url()), method = request.method();
  const json = (body: unknown, status = 200) => route.fulfill({status, contentType: 'application/json',
    headers: {'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH', 'access-control-allow-headers': 'content-type'},
    body: JSON.stringify(body)});
  if (method === 'OPTIONS') return json({});
  if (url.pathname === '/api/health') return json({engine: 'ready', model: 'fake', version: 'test'});
  if (url.pathname === '/api/takes') return json({takes: fake.takes});
  if (url.pathname === '/api/generate' && method === 'POST') { fake.generated.push(request.postDataJSON()); return json({job_id: 'job-1'}); }
  if (url.pathname === '/api/jobs/job-1') return json({status: 'done', progress: 1, take_ids: ['take-1']});
  if (url.pathname === '/api/takes/take-1' && method === 'PATCH') {
    const change = request.postDataJSON(); fake.patched.push(change); Object.assign(fake.takes[0]!, change);
    return json(fake.takes[0]);
  }
  return json({error: 'not found'}, 404);
}

try {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  browser = await chromium.launch({headless: true});
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}});
  context.setDefaultTimeout(10000);
  await context.route('http://127.0.0.1:7870/**', studioApi);
  const page = await context.newPage();
  current = page;
  page.on('pageerror', error => errors.push(error.message));

  await page.goto(origin + '/studio.html?pack=mock-fl');
  await waitText(page, 'global-status', /loaded/);
  assert.equal(await page.getByRole('tab', {name: 'DJ Booth'}).getAttribute('aria-selected'), 'true');
  report.checks.push('loads the S06 mock pack and opens on DJ Booth');

  // DJ: play A, mix to B, stop. Status text reports the audio clock, not measured output.
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await waitText(page, 'dj-now', /mock A/);
  await page.getByRole('button', {name: /Mix to next/}).click();
  await waitText(page, 'dj-next-title', /mock B|Nothing scheduled/);
  await waitText(page, 'dj-now', /mock B/, 40000);
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  await waitText(page, 'dj-now', /^Nothing$/);
  report.checks.push('DJ plays deck A, mixes to deck B on the clock, and stops');

  // Bridge toggle and energy pad are requests, reflected without playback.
  await page.getByRole('radio', {name: 'Bridge'}).click();
  assert.equal(await page.getByRole('radio', {name: 'Bridge'}).getAttribute('aria-checked'), 'true');
  await page.getByRole('radio', {name: 'Beatmatch'}).click();
  assert.equal(await page.getByRole('radio', {name: 'Beatmatch'}).getAttribute('aria-checked'), 'true');
  assert.equal(await page.getByRole('radio', {name: 'Bridge'}).getAttribute('aria-checked'), 'false');
  await page.getByRole('radio', {name: 'Bridge'}).click();
  await page.locator('#state-pads button[data-state="drive"]').click();
  await waitText(page, 'dj-requested', /drive/);
  report.checks.push('Bridge mode and the Drive energy pad update the requested state');

  // Produce: generator offline first.
  await page.getByRole('tab', {name: 'Produce'}).click();
  assert.equal(await page.locator('#panel-produce').isVisible(), true);
  await waitText(page, 'gen-status', /not running/);
  assert.equal(await page.locator('#gen-offline').isVisible(), true);
  assert.equal(await page.locator('#gen-go').isDisabled(), true);
  report.checks.push('generator shows the Music Studio offline message and disables Generate');

  // Sampler: play, stop, new seed, save.
  await page.getByRole('button', {name: 'Play pattern'}).click();
  await waitText(page, 'sampler-status', /Playing seed/);
  await page.getByRole('button', {name: 'Stop pattern'}).click();
  await waitText(page, 'sampler-status', /ready\. Press/);
  const before = await page.locator('#seed').inputValue();
  await page.getByRole('button', {name: 'Random seed'}).click();
  assert.notEqual(await page.locator('#seed').inputValue(), before);
  await page.locator('#seed').fill('42');
  await page.getByRole('radio', {name: 'Drive'}).click();
  await page.getByRole('button', {name: /Save to Library/}).click();
  await waitText(page, 'sampler-status', /Saved to Library/);
  report.checks.push('pattern sampler plays, stops, rolls a seed and saves seed 42 · drive');

  // One owner: starting the DJ stops the sampler.
  await page.getByRole('button', {name: 'Play pattern'}).click();
  await waitText(page, 'sampler-status', /Playing seed/);
  await page.getByRole('tab', {name: 'DJ Booth'}).click();
  await page.getByRole('button', {name: 'Play', exact: true}).click();
  await waitText(page, 'dj-now', /mock A/);
  await page.getByRole('tab', {name: 'Produce'}).click();
  await waitText(page, 'sampler-status', /ready\. Press|finished/);
  await page.getByRole('tab', {name: 'DJ Booth'}).click();
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  await waitText(page, 'dj-now', /^Nothing$/);
  report.checks.push('starting the DJ stops the sampler (one playback owner)');

  // Library: saved pattern restores into Produce, stopped.
  await page.getByRole('tab', {name: 'Library'}).click();
  await waitText(page, 'lib-vibes', /Seed 42 · Drive/);
  assert.ok((await page.locator('#lib-tracks tr').count()) >= 2);
  await page.getByRole('button', {name: /Open Seed 42/}).click();
  await waitText(page, 'sampler-status', /Opened seed 42 · drive/);
  assert.equal(await page.getByRole('tab', {name: 'Produce'}).getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#seed').inputValue(), '42');
  report.checks.push('Library lists the pack and restores the saved pattern into Produce, stopped');

  // Generator against the in-test fake service.
  fake.online = true;
  await waitText(page, 'gen-status', /Ready/, 12000);
  await page.getByRole('button', {name: 'Generate'}).click();
  await waitText(page, 'gen-takes', /Fake take/, 12000);
  await waitText(page, 'gen-go', /^Generate$/, 12000);
  assert.equal(fake.generated.length, 1);
  assert.equal((fake.generated[0] as {bpm: number}).bpm, 120);
  assert.equal((fake.generated[0] as {thinking: boolean}).thinking, false);
  await page.getByRole('tab', {name: 'Library'}).click();
  await waitText(page, 'lib-takes', /Fake take/);
  await page.locator('#lib-takes').getByRole('button', {name: 'Love Fake take'}).click();
  await page.waitForFunction(() => document.querySelector('#lib-takes .take.is-love') !== null);
  assert.equal(await page.locator('#lib-takes').getByRole('button', {name: 'Love Fake take'}).getAttribute('aria-pressed'), 'true');
  await page.locator('#lib-takes').getByRole('button', {name: 'Nope Fake take'}).click();
  await page.waitForFunction(() => document.querySelector('#lib-takes .take.is-dislike') !== null);
  await page.waitForFunction(() => !/Fake take/.test(document.getElementById('gen-takes')?.textContent ?? ''));
  assert.deepEqual(fake.patched, [{rating: 'love'}, {rating: 'dislike'}]);
  report.checks.push('with a fake Music Studio: Generate posts the form, takes list, Love and Nope patch the rating (Nope hides it from Recent)');

  for (const [tab, file] of [['DJ Booth', 'dj.png'], ['Produce', 'produce.png'], ['Library', 'library.png']] as const) {
    await page.getByRole('tab', {name: tab}).click();
    await page.screenshot({path: fileURLToPath(new URL(file, output))});
  }
  // Phone width: no horizontal page scroll on any tab.
  await page.setViewportSize({width: 390, height: 844});
  for (const tab of ['DJ Booth', 'Produce', 'Library']) {
    await page.getByRole('tab', {name: tab}).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `${tab} overflows by ${overflow}px at 390px`);
  }
  report.checks.push('fits a 390px phone width on all three tabs');
  await page.screenshot({path: fileURLToPath(new URL('mobile.png', output)), fullPage: true});
  assert.deepEqual(errors, []);
  report.checks.push('no page errors');
  console.log(`Studio browser check passed (${report.checks.length} checks, ${report.browser}).`);
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (errors.length) report.error += `\nPage errors: ${errors.join(' | ')}`;
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await browser?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
}
