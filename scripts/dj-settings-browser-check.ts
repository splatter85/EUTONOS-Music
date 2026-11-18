/**
 * DJ booth settings Chromium gate. Run after build: node dist/scripts/dj-settings-browser-check.js
 * Headless Chromium, ephemeral loopback ports only (never the live phone host ports), a temp settings folder, generated synthetic songs.
 * Proves on the real Studio page and the real phone page (strict CSP) through a real relay: touching a control pins it to Manual,
 * the last allowed style cannot be unticked, Reset restores the safe defaults, a phone change reaches the Studio and the settings
 * file on the PC, and "Why this handover" shows the settings that planned a handover. Not listening, device or real-phone evidence.
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
import {buildSyntheticSet} from '../tests/helpers/synthetic-set.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'artifacts', 'dj-settings-browser');
await mkdir(output, {recursive: true});
const report = {platform: process.platform, node: process.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), browser: '', checks: [] as string[], error: ''};
const set = await buildSyntheticSet([
  {id: 'set-120-a', bpm: 120, bars: 48, tonic: 9, mode: 'minor'},
  {id: 'set-120-b', bpm: 120, bars: 48, tonic: 4, mode: 'minor'},
]);
const settingsRoot = await mkdtemp(join(tmpdir(), 'eutonos-booth-'));
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
async function waitFor(page: Page, selector: string, pattern: RegExp, timeout = 15000): Promise<void> {
  try {
    await page.waitForFunction(([s, source]) => new RegExp(source!).test(document.querySelector(s!)?.textContent ?? ''), [selector, pattern.source], {timeout});
  } catch (error) { throw new Error(`${error instanceof Error ? error.message : error}; ${selector}: ${await content(page, selector)}`); }
}
const pressed = (page: Page, id: string) => page.locator('#' + id).getAttribute('aria-pressed');
const onDisk = async () => JSON.parse(await readFile(join(settingsRoot, 'local', 'dj-settings', 'settings.json'), 'utf8')) as {rev: number; settings: Record<string, {mode: string; value: unknown}>};
async function waitDisk(check: (file: Awaited<ReturnType<typeof onDisk>>) => boolean, label: string): Promise<void> {
  const end = Date.now() + 15000; let last = '';
  while (Date.now() < end) {
    try { const file = await onDisk(); if (check(file)) return; last = JSON.stringify(file.settings); } catch (error) { last = String(error); }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`settings file never showed: ${label}; last ${last}`);
}
try {
  const demoPort = await listen(demo);
  const origin = `http://127.0.0.1:${demoPort}`;
  relay = createPhoneRelay({spawnEncoder: fakeEncoder, djOrigins: [origin], feedbackRoot: settingsRoot});
  const relayPort = await listen(relay.server);
  const relayOrigin = `http://127.0.0.1:${relayPort}`;
  browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1280, height: 1100}});
  context.setDefaultTimeout(20000);
  await context.route('http://127.0.0.1:7870/**', route => route.abort('connectionrefused'));
  await context.route(url => /^\/local\/s16-rated(?:\/|$)/.test(url.pathname), async route => {
    const path = new URL(route.request().url()).pathname.replace('/local/s16-rated/', '');
    if (!/^(?:catalog\.json|pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path)) return route.fulfill({status: 404});
    try { return await route.fulfill({body: await readFile(join(set.out, ...path.split('/')))}); } catch { return route.fulfill({status: 404}); }
  });
  context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); });

  // ---- Studio, through the relay ----
  const studio = await context.newPage();
  await studio.goto(studioSetPageUrl(origin, relayPort, relay.token, '&dossiers=off&sources=legacy'));
  await waitFor(studio, '#global-status', /loaded · 2 songs/);
  await waitFor(studio, '#booth-message', /Saved on the PC/);
  assert.equal(await studio.locator('#booth-pairSearch').inputValue(), 'off');
  assert.equal(await pressed(studio, 'booth-pairSearch-dj'), 'true');
  assert.equal(await studio.locator('#booth-maxStretch').inputValue(), '15');
  assert.equal(await studio.locator('#booth-waitBars').inputValue(), '8');
  assert.equal(await studio.locator('#set-booth-card input[type=checkbox]:checked').count(), 8);
  report.checks.push('Studio booth card starts at the safe defaults (every setting on DJ decides)');

  await studio.locator('#booth-pairSearch').selectOption('shadow');
  assert.equal(await pressed(studio, 'booth-pairSearch-manual'), 'true', 'touching a control pins it');
  assert.equal(await studio.locator('#set-pair-search-mode').inputValue(), 'shadow', 'the older Studio control mirrors the setting');
  await waitDisk(f => f.settings.pairSearch?.value === 'shadow' && f.settings.pairSearch.mode === 'manual', 'pair search shadow');
  await studio.locator('#booth-pairSearch-dj').click();
  assert.equal(await pressed(studio, 'booth-pairSearch-dj'), 'true');
  assert.equal(await studio.locator('#set-pair-search-mode').inputValue(), 'off', 'handing it back to the DJ restores its own behaviour (the control keeps the last pinned value for next time)');
  await waitDisk(f => f.settings.pairSearch?.mode === 'dj', 'pair search handed back');
  report.checks.push('touching a control pins it to Manual, handing it back restores DJ decides, and the PC file follows');

  await studio.locator('#booth-maxStretch').selectOption('8');
  await studio.locator('#booth-waitBars').selectOption('0');
  await waitDisk(f => f.settings.maxStretch?.value === 8 && f.settings.waitBars?.value === 0, 'stretch 8 and wait 0');
  const ids = await studio.locator('#set-booth-card input[type=checkbox]').evaluateAll(boxes => boxes.map(b => b.id));
  assert.equal(ids.length, 8);
  for (const id of ids.slice(1)) await studio.locator('#' + id).uncheck();
  assert.equal(await studio.locator('#set-booth-card input[type=checkbox]:checked').count(), 1);
  await studio.locator('#' + ids[0]).click();
  assert.equal(await studio.locator('#' + ids[0]).isChecked(), true, 'the last allowed style cannot be unticked');
  await waitFor(studio, '#booth-message', /At least one style must stay allowed/);
  await waitDisk(f => Array.isArray(f.settings.styles?.value) && (f.settings.styles.value as unknown[]).length === 1, 'one style left');
  report.checks.push('the last allowed style cannot be unticked, with a message; the file keeps exactly one');

  // A handover planned with these settings carries the stamp, shown in Why this handover.
  await studio.locator('#dj-play').click();
  await waitFor(studio, '#dj-now', /set-120-a/);
  await studio.locator('#dj-next').click();
  await waitFor(studio, '#set-mix', /^Planned: /, 60000);
  await studio.locator('#set-why summary').click();
  await waitFor(studio, '#set-why-settings', /^ds-[0-9a-f]{8} · /);
  const why = await content(studio, '#set-why-settings');
  assert.match(why, /styles 1\/8/); assert.match(why, /stretch 8%/); assert.match(why, /wait 0b/);
  report.checks.push(`Why this handover shows the settings that planned it (${why})`);
  await studio.locator('#dj-stop').click();

  // ---- Phone page: CSP-safe, reads the same file, a change reaches the Studio ----
  const phone = await context.newPage();
  await phone.goto(relayOrigin + '/');
  await phone.locator('#booth summary').click();
  await waitFor(phone, '#booth-message', /Saved on the PC/);
  assert.equal(await phone.locator('#booth-maxStretch').inputValue(), '8', 'the phone reads what the Studio saved');
  assert.equal(await phone.locator('#booth-card input[type=checkbox]:checked').count(), 1);
  await phone.locator('#booth-explore').selectOption('low');
  assert.equal(await pressed(phone, 'booth-explore-manual'), 'true');
  await waitDisk(f => f.settings.explore?.value === 'low' && f.settings.explore.mode === 'manual', 'explore low from the phone');
  await studio.waitForFunction(() => (document.querySelector<HTMLSelectElement>('#booth-explore'))?.value === 'low', null, {timeout: 15000});
  report.checks.push('the phone card (strict CSP) reads the Studio settings; a phone change reaches the PC file and the open Studio');

  await phone.locator('#booth-reset').click();
  await waitDisk(f => f.settings.explore?.mode === 'dj' && f.settings.maxStretch?.mode === 'dj' && (f.settings.styles?.value as unknown[]).length === 8, 'reset');
  await studio.waitForFunction(() => document.querySelector<HTMLSelectElement>('#booth-maxStretch')?.value === '15' && document.querySelectorAll('#set-booth-card input[type=checkbox]:checked').length === 8, null, {timeout: 15000});
  assert.equal(await pressed(studio, 'booth-explore-dj'), 'true');
  report.checks.push('Reset to safe defaults from the phone restores every setting on the PC and in the Studio');

  assert.deepEqual(errors, []);
  console.log(`DJ settings browser check passed (${report.checks.length} checks, ${report.browser}).`);
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
  await set.cleanup();
  await rm(settingsRoot, {recursive: true, force: true});
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
