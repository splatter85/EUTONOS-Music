/**
 * EUTONOS Studio browser gate. Run after npm run build (and the mock FL producer):
 * node dist/scripts/studio-check.js
 * Headless Chromium on an ephemeral loopback port. The Music Studio service is never
 * contacted: its origin is first refused, then answered by an in-test fake, so this
 * checks the page's wiring only — not the generator, physical output or listening.
 */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type Page, type Route} from 'playwright';
import {createDemoServer} from './serve.js';
import type {AudioPack} from '../src/pack-types.js';

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
const fake = {online: false, exports: 0, patched: [] as unknown[], generated: [] as unknown[],
  takes: [{id: 'take-1', title: 'Fake take', duration_seconds: 30, bpm: 120, key: 'A minor', starred: false, rejected: false, rating: null as string | null}]};
let generateGate: Promise<void> | undefined;
let failGenerate = false;
async function studioApi(route: Route): Promise<void> {
  if (!fake.online) { await route.abort('connectionrefused'); return; }
  const request = route.request(), url = new URL(request.url()), method = request.method();
  const json = (body: unknown, status = 200) => route.fulfill({status, contentType: 'application/json',
    headers: {'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,PATCH', 'access-control-allow-headers': 'content-type'},
    body: JSON.stringify(body)});
  if (method === 'OPTIONS') return json({});
  if (url.pathname === '/api/exports/rated' && method === 'POST') { fake.exports++; return json({path: '/private/test-snapshot'}); }
  if (url.pathname === '/api/health') return json({engine: 'ready', model: 'fake', version: 'test'});
  if (url.pathname === '/api/takes/take-1/audio') return route.fulfill({contentType: 'audio/wav', body: await readFile(new URL('../../fixtures/s01/audio/s01-recording-a.wav', import.meta.url))});
  if (url.pathname === '/api/takes') return json({takes: fake.takes});
  if (url.pathname === '/api/generate' && method === 'POST') {
    fake.generated.push(request.postDataJSON());
    await generateGate;
    return failGenerate ? json({error: 'Synthetic submission failure'}, 503) : json({job_id: 'job-1'});
  }
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
  let releaseGenerate!: () => void;
  generateGate = new Promise<void>(resolve => { releaseGenerate = resolve; });
  failGenerate = true;
  const submitting = page.waitForRequest(request => request.url().endsWith('/api/generate') && request.method() === 'POST');
  await page.evaluate(() => {
    const form = document.getElementById('gen-form') as HTMLFormElement;
    form.requestSubmit(); form.requestSubmit();
  });
  await submitting;
  assert.equal(await page.locator('#gen-go').isDisabled(), true, 'submission must disable Generate before its response');
  assert.equal(fake.generated.length, 1, 'repeated submit must not create a second pending generation');
  await waitText(page, 'gen-status', /Submitting/);
  releaseGenerate();
  await waitText(page, 'gen-error', /Synthetic submission failure/);
  await page.waitForFunction(() => !(document.getElementById('gen-go') as HTMLButtonElement).disabled);
  assert.equal(fake.generated.length, 1, 'failed submission is not automatically retried');
  generateGate = undefined; failGenerate = false;
  await page.getByRole('button', {name: 'Generate'}).click();
  await waitText(page, 'gen-takes', /Fake take/, 12000);
  await waitText(page, 'gen-go', /^Generate$/, 12000);
  assert.equal(fake.generated.length, 2);
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
  report.checks.push('deferred generation admits one request, reports submission separately, and recovers from failure only on explicit retry');

  await page.getByRole('button', {name: 'Export all rated takes', exact: true}).click();
  await waitText(page, 'export-rated-status', /Private rated snapshot exported/);
  assert.equal(fake.exports, 1);
  assert.equal(await page.locator('#lib-takes button').filter({hasText: 'Export this take'}).count(), 1);
  report.checks.push('bulk rated export calls the snapshot endpoint; individual export remains separately labelled');

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
  // Synthetic unreviewed pair: original fixtures only; no private audio is read or written.
  const original = JSON.parse(await readFile(new URL('../../fixtures/s01/manifest.json', import.meta.url), 'utf8')) as AudioPack;
  const pair: AudioPack = {...original,
    assets: original.assets.filter(a => a.source_kind === 'recording').map(a => ({...a, eligibility: 'unreviewed', key: null, harmony_pitch_classes: null})),
    palettes: [], recipes: [], routes: original.routes.map(r => ({...r, overlap_quarters: 0})),
  };
  const catalog = {schema_version: 'eutonos.rated-catalog.v1', takes: [
    {id: 'a', title: 'A', rating: 'love', tempo: {bpm: 120, source: 'requested'}},
    {id: 'b', title: 'B', rating: 'like', tempo: {bpm: 120, source: 'requested'}},
    {id: 'negative', title: 'Never autoqueued', rating: 'dislike', tempo: {bpm: 120, source: 'requested'}},
  ], pair: {take_ids: ['a', 'b'], asset_ids: pair.assets.map(a => a.id), grid: 'requested-not-measured'}};
  await context.route(origin + '/local/s16-rated/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/local/s16-rated/', '');
    if (path === 'catalog.json') return route.fulfill({json: catalog});
    if (path === 'pack/manifest.json') return route.fulfill({json: pair});
    const fixture = path.replace(/^pack\//, '');
    if (fixture === 'PROVENANCE.md' || pair.assets.some(a => a.file.path === fixture)) {
      return route.fulfill({body: await readFile(new URL('../../fixtures/s01/' + fixture, import.meta.url))});
    }
    return route.fulfill({status: 404});
  });
  await page.goto(origin + '/studio.html?pack=rated');
  await waitText(page, 'global-status', /loaded/);
  assert.equal(await text(page, 'dj-now'), 'Nothing');
  assert.equal(await page.locator('#dj-play').isEnabled(), true);
  assert.equal(await page.locator('#mode-hybrid').isDisabled(), true);
  assert.equal(await page.locator('#mode-mix').isDisabled(), true);
  assert.equal(await page.locator('#mode-direct').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('#rated-transition-help').isVisible(), true);
  assert.match(await text(page, 'rated-transition-help'), /direct cut with no overlap/);
  await page.getByRole('tab', {name: 'Library'}).click();
  await waitText(page, 'rated-inventory', /3 takes.*1 love.*1 like.*1 dislike/);
  assert.match(await text(page, 'lib-tracks'), /requested.*unmeasured/);
  assert.match(await text(page, 'lib-tracks'), /unreviewed/);
  assert.doesNotMatch(await text(page, 'dj-queue'), /Never autoqueued/);
  const refused = await page.evaluate(async () => {
    const modulePath = '/dist/src/browser-pack.js';
    const {loadBrowserPack} = await import(modulePath);
    try { await loadBrowserPack(new URL('/local/s16-rated/pack/manifest.json', location.href), true); return false; }
    catch { return true; }
  });
  assert.equal(refused, true, 'unreviewed pair must still fail without explicit local audition');
  await page.getByRole('tab', {name: 'Produce'}).click();
  await waitText(page, 'sampler-status', /no samples or recipes/);
  for (const id of ['s-play', 's-save', 'seed', 'dice', 's-explore', 's-drive']) assert.equal(await page.locator('#' + id).isDisabled(), true, id);
  assert.equal(await text(page, 'sampler-error'), '');
  await page.getByRole('tab', {name: 'DJ Booth'}).click();
  await page.locator('#dj-play').click(); await waitText(page, 'dj-now', /S01 A/);
  await page.locator('#dj-next').click(); await waitText(page, 'dj-now', /S01 B/, 40000);
  await page.locator('#dj-stop').click(); await waitText(page, 'dj-now', /^Nothing$/);
  assert.equal(await page.locator('#mode-direct').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('#mode-mix').isDisabled(), true);
  assert.equal(await page.locator('#mode-hybrid').isDisabled(), true);
  report.checks.push('synthetic rated pair uses direct cut only, refuses default loading, opens stopped in explicit audition, separates taste/review/grid, disables sampler, and plays A to B without autoqueuing the negative inventory');
  // Preview shares the cross-tab playback lock with the DJ, in both directions.
  const other = await context.newPage();
  other.on('pageerror', error => errors.push(error.message));
  await other.goto(origin + '/studio.html?pack=mock-fl&tab=library');
  await waitText(other, 'lib-takes', /Fake take/);
  await page.locator('#dj-play').click(); await waitText(page, 'dj-now', /S01 A/);
  await other.getByRole('button', {name: 'Preview Fake take', exact: true}).click();
  await waitText(other, 'gen-error', /Another tab is playing/);
  assert.equal(await other.locator('#preview').evaluate((element: HTMLAudioElement) => element.paused), true);
  await page.locator('#dj-stop').click(); await waitText(page, 'dj-now', /^Nothing$/);
  await other.getByRole('button', {name: 'Preview Fake take', exact: true}).click();
  await other.waitForFunction(() => !(document.getElementById('preview') as HTMLAudioElement).paused);
  await page.locator('#dj-play').click(); await waitText(page, 'dj-error', /Another tab is playing/);
  await other.getByRole('button', {name: 'Stop Fake take', exact: true}).click();
  await page.locator('#dj-play').click(); await waitText(page, 'dj-now', /S01 A/);
  await page.locator('#dj-stop').click(); await waitText(page, 'dj-now', /^Nothing$/);
  await other.close();
  report.checks.push('take preview and DJ mutually exclude playback across tabs; stopping preview releases ownership');
  // A rejected old media play promise must not stop its replacement or release its lock.
  const race = await context.newPage();
  race.on('pageerror', error => errors.push(error.message));
  let releaseAlpha!: () => void;
  let alphaGate = new Promise<void>(resolve => { releaseAlpha = resolve; });
  await race.route('http://127.0.0.1:7870/api/takes', route => route.fulfill({json: {takes: [
    {id: 'alpha', title: 'Alpha'}, {id: 'beta', title: 'Beta'},
  ]}}));
  await race.route('http://127.0.0.1:7870/api/takes/*/audio', async route => {
    if (route.request().url().includes('/alpha/')) await alphaGate;
    await route.fulfill({contentType: 'audio/wav', body: await readFile(new URL('../../fixtures/s01/audio/s01-recording-a.wav', import.meta.url))}).catch(() => undefined);
  });
  await race.goto(origin + '/studio.html?tab=library');
  await waitText(race, 'lib-takes', /Alpha.*Beta/);
  const alphaRequest = race.waitForRequest('**/api/takes/alpha/audio');
  await race.getByRole('button', {name: 'Preview Alpha', exact: true}).click();
  await alphaRequest;
  await race.locator('#master-mute').click();
  await race.getByRole('button', {name: 'Preview Beta', exact: true}).click();
  await race.waitForFunction(() => {
    const audio = document.getElementById('preview') as HTMLAudioElement;
    return !audio.paused && audio.src.includes('/beta/audio');
  });
  releaseAlpha();
  await race.getByRole('button', {name: 'Stop Beta', exact: true}).waitFor();
  assert.equal(await text(race, 'gen-error'), '');
  await page.locator('#dj-play').click(); await waitText(page, 'dj-error', /Another tab is playing/);
  assert.equal(await race.locator('#preview').evaluate((audio: HTMLAudioElement) => audio.muted && !audio.paused), true);
  await race.getByRole('button', {name: 'Stop Beta', exact: true}).click();
  await page.locator('#dj-play').click(); await waitText(page, 'dj-now', /S01 A/);
  await page.locator('#dj-stop').click(); await waitText(page, 'dj-now', /^Nothing$/);
  // Stop and pagehide invalidate a pending start as well as a pending play failure.
  for (const end of ['stop', 'pagehide']) {
    alphaGate = new Promise<void>(resolve => { releaseAlpha = resolve; });
    const pending = race.waitForRequest('**/api/takes/alpha/audio');
    await race.getByRole('button', {name: 'Preview Alpha', exact: true}).click();
    await pending;
    if (end === 'stop') await race.getByRole('button', {name: 'Stop Alpha', exact: true}).click();
    else await race.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    releaseAlpha();
    assert.equal(await race.locator('#preview').evaluate((audio: HTMLAudioElement) => audio.paused && !audio.hasAttribute('src')), true);
    assert.equal(await text(race, 'gen-error'), '');
    await page.locator('#dj-play').click(); await waitText(page, 'dj-now', /S01 A/);
    await page.locator('#dj-stop').click(); await waitText(page, 'dj-now', /^Nothing$/);
  }
  await race.close();
  report.checks.push('switching a pending preview preserves newer audio and its lock after the old play rejects; mute, stop and pagehide remain effective');
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
