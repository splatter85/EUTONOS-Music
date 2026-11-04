/**
 * Isolated S03 browser checks. Audio/queue behavior is observed through the real
 * UI; native offline comparisons remain distinct from physical output/listening.
 */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Browser, Page} from 'playwright';
import {createDemoServer} from './serve.js';

const args = process.argv.slice(2);
const options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const name = args[i], value = args[i + 1];
  assert.ok(name && ['--browser', '--playwright-module', '--output'].includes(name) && value,
    'Usage: browser-check.js [--browser CHROMIUM_PATH] [--playwright-module MODULE_PATH] [--output DIRECTORY]');
  options.set(name, value);
}
const modulePath = options.get('--playwright-module');
const moduleName = modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright';
const {chromium} = await import(moduleName);
const playwrightVersion = JSON.parse(await readFile(new URL('./package.json', import.meta.resolve(moduleName)), 'utf8')).version as string;
const directory = resolve(options.get('--output') ?? 'artifacts/s03-browser');
await mkdir(directory, {recursive: true});
const server = createDemoServer();
let browser: Browser | undefined;
let currentPage: Page | undefined;
let stage = 'Start isolated browser and server';
const started = Date.now();
const checks: {name: string; status: string}[] = [];
const errors: string[] = [];

async function waitText(page: Page, selector: string, expected: RegExp, timeout = 5000): Promise<void> {
  await page.waitForFunction(({selector, source, flags}) =>
    new RegExp(source, flags).test(document.querySelector(selector)?.textContent ?? ''),
  {selector, source: expected.source, flags: expected.flags}, {timeout});
}
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const play = document.querySelector<HTMLButtonElement>('#play');
    return play !== null && !play.disabled;
  });
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
}
async function queueCount(page: Page, count: number): Promise<void> {
  await page.waitForFunction(count => document.querySelectorAll('#queue li:not(.empty-queue)').length === count, count);
}
async function pressed(page: Page, id: string, value: boolean): Promise<void> {
  await page.waitForFunction(({id, value}) =>
    document.getElementById(id)?.getAttribute('aria-pressed') === String(value), {id, value});
}
async function stop(page: Page): Promise<void> {
  await page.locator('#stop').click();
  await waitText(page, '#execution', /^accepted · applied · Stopped\./);
  await waitText(page, '#now-title', /^Nothing playing$/);
  await waitText(page, '#next-title', /^Nothing scheduled$/);
}
function observeErrors(page: Page, label: string): void {
  page.on('pageerror', error => errors.push(label + ': ' + error.message));
}

try {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => { reject(error); };
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  const runningBrowser = await chromium.launch({headless: true,
    ...(options.has('--browser') ? {executablePath: options.get('--browser')} : {})}) as Browser;
  browser = runningBrowser;
  const context = await runningBrowser.newContext({viewport: {width: 1280, height: 1000}});
  context.setDefaultTimeout(5000);
  context.setDefaultNavigationTimeout(10000);
  const page = await context.newPage();
  currentPage = page;
  observeErrors(page, 'primary');

  stage = 'Nine native offline audio checks';
  await page.goto(origin + '/checks.html');
  await page.getByRole('button', {name: 'Run offline checks'}).click();
  await page.waitForFunction(() => /checks passed|failed/.test(document.getElementById('check-status')!.textContent!), null,
    {timeout: 30000});
  const offline = JSON.parse(await page.locator('#check-results').innerText());
  await writeFile(resolve(directory, 'offline.json'), JSON.stringify(offline, null, 2) + '\n');
  assert.equal(offline.results.length, 9);
  assert.ok(offline.results.every((result: {status: string}) => result.status === 'PASS'), JSON.stringify(offline, null, 2));
  checks.push({name: stage, status: 'PASS'});

  stage = 'Stopped requests and manual initial selection';
  await page.goto(origin);
  await ready(page);
  await page.screenshot({path: resolve(directory, 'player-ready.png'), fullPage: true});
  await page.locator('#genre').fill('synthetic-test');
  await page.locator('#apply-genre').click();
  await waitText(page, '#requested-target', /^explore · synthetic-test$/);
  await waitText(page, '#execution', /^accepted · queued ·/);
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  await page.locator('#queue-a').click();
  await queueCount(page, 1);
  assert.match(await page.locator('#queue li').innerText(), /S01 A/);
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  await page.locator('#play').click();
  await waitText(page, '#now-title', /^S01 A — slow triangle pulse$/);
  await queueCount(page, 0);
  checks.push({name: stage, status: 'PASS'});

  stage = 'Paused FIFO reservation, future cancellation and explicit Next rescheduling';
  await page.locator('#pause').click();
  await waitText(page, '#clock-detail', /^suspended ·/);
  await waitText(page, '#now-detail', /^paused ·/);
  assert.equal(await page.locator('#pause').innerText(), 'Resume');
  // Observe UI frames over a bounded interval while paused. This checks a
  // frozen clock; operation waits below remain condition-based.
  await page.evaluate(async () => {
    const clock = document.getElementById('clock-detail')!.textContent;
    const detail = document.getElementById('now-detail')!.textContent;
    const until = performance.now() + 180;
    do {
      await new Promise<number>(resolve => requestAnimationFrame(resolve));
      if (document.getElementById('clock-detail')!.textContent !== clock
        || document.getElementById('now-detail')!.textContent !== detail) {
        throw new Error('Paused audio clock or elapsed display advanced.');
      }
    } while (performance.now() < until);
  });
  await page.locator('#queue-b').click();
  await waitText(page, '#next-title', /^S01 B — syncopated pulse$/);
  await queueCount(page, 1);
  // Diagnostics live in a closed disclosure; read the clock's DOM text even
  // when it has no rendered innerText. The same state is used by waitText above.
  assert.match(await page.locator('#clock-detail').textContent() ?? '', /^suspended ·/);
  await page.screenshot({path: resolve(directory, 'player-paused.png'), fullPage: true});
  await page.locator('#cancel-next').click();
  await waitText(page, '#next-title', /^Nothing scheduled$/);
  await waitText(page, '#execution', /^accepted · applied · Future selection cancelled/);
  await queueCount(page, 1);
  assert.match(await page.locator('#queue li').innerText(), /S01 B/);
  assert.equal(await page.locator('#cancel-next').isDisabled(), true);
  await page.locator('#next-song').click();
  await waitText(page, '#next-title', /^S01 B — syncopated pulse$/);
  await queueCount(page, 1);
  assert.match(await page.locator('#clock-detail').textContent() ?? '', /^suspended ·/);
  checks.push({name: stage, status: 'PASS'});

  stage = 'Hold refuses target changes, release replays nothing, and mute survives resume';
  await page.locator('#hold').click();
  await pressed(page, 'hold', true);
  await page.locator('#state').selectOption('drive');
  await page.locator('#apply-state').click();
  await waitText(page, '#execution', /^rejected · rejected · held$/);
  assert.equal(await page.locator('#requested-target').innerText(), 'explore · synthetic-test · held');
  await page.locator('#genre').fill('');
  await page.locator('#apply-genre').click();
  await waitText(page, '#error', /^held$/);
  assert.equal(await page.locator('#requested-target').innerText(), 'explore · synthetic-test · held');
  await page.locator('#hold').click();
  await pressed(page, 'hold', false);
  await waitText(page, '#requested-target', /^explore · synthetic-test$/);
  assert.match(await page.locator('#next-title').innerText(), /S01 B/);
  await page.locator('#mute').click();
  await pressed(page, 'mute', true);
  await page.locator('#pause').click();
  await waitText(page, '#clock-detail', /^running ·/);
  await waitText(page, '#now-detail', /^playing · muted ·/);
  assert.equal(await page.locator('#mute').innerText(), 'Unmute');
  await page.locator('#mute').click();
  await pressed(page, 'mute', false);
  await waitText(page, '#now-detail', /^playing · [0-9]/);
  checks.push({name: stage, status: 'PASS'});

  stage = 'One live A to B handoff with renderer-reported queue consumption and mixture';
  await waitText(page, '#status', /^Crossfading A → B$/, 12000);
  await waitText(page, '#now-title', /^S01 A.* \+ S01 B/);
  await queueCount(page, 0);
  await page.screenshot({path: resolve(directory, 'player-crossfade.png'), fullPage: true});
  await waitText(page, '#status', /^Handoff complete$/, 6000);
  assert.equal(await page.locator('#now-title').innerText(), 'S01 B — syncopated pulse');
  assert.equal(await page.locator('#cancel-next').isDisabled(), true);
  checks.push({name: stage, status: 'PASS'});
  await stop(page);

  stage = 'Unsupported target reports no match without starting audio';
  await page.locator('#state').selectOption('surge');
  await page.locator('#apply-state').click();
  await waitText(page, '#execution', /^accepted · no-match ·/);
  assert.equal(await page.locator('#requested-target').innerText(), 'surge · synthetic-test');
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  await page.locator('#play').click();
  await waitText(page, '#execution', /^accepted · no-match ·/);
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  await page.locator('#state').selectOption('explore');
  await page.locator('#apply-state').click();
  await waitText(page, '#requested-target', /^explore · synthetic-test$/);
  await waitText(page, '#execution', /^accepted · queued ·/);
  checks.push({name: stage, status: 'PASS'});

  stage = 'Blocked FIFO head cannot be overtaken; removal and Next serve the retained tail';
  await page.locator('#queue-a').click();
  await queueCount(page, 1);
  await page.locator('#play').click();
  await waitText(page, '#now-title', /^S01 A — slow triangle pulse$/);
  await queueCount(page, 0);
  await page.locator('#pause').click();
  await waitText(page, '#clock-detail', /^suspended ·/);
  await page.locator('#queue-a').click();
  await queueCount(page, 1);
  await waitText(page, '#execution', /^accepted · no-match · Manual queue head/);
  await page.locator('#queue-b').click();
  await queueCount(page, 2);
  await waitText(page, '#execution', /^accepted · queued · Waiting behind/);
  const queued = await page.locator('#queue li').allTextContents();
  assert.match(queued[0]!, /S01 A/);
  assert.match(queued[1]!, /S01 B/);
  await page.locator('#next-song').click();
  await waitText(page, '#execution', /^accepted · no-match · Manual queue head/);
  assert.equal(await page.locator('#next-title').innerText(), 'Nothing scheduled');
  await page.screenshot({path: resolve(directory, 'player-blocked-queue.png'), fullPage: true});
  await page.locator('#queue li').first().getByRole('button', {name: /^Cancel queued 1:/}).click();
  await queueCount(page, 1);
  await waitText(page, '#execution', /^accepted · applied · Queue entry removed/);
  assert.match(await page.locator('#queue li').innerText(), /S01 B/);
  assert.equal(await page.locator('#next-title').innerText(), 'Nothing scheduled');
  await page.locator('#next-song').click();
  await waitText(page, '#next-title', /^S01 B — syncopated pulse$/);
  await stop(page);
  await queueCount(page, 1);
  assert.match(await page.locator('#queue li').innerText(), /S01 B/, 'Stop retains unstarted queue entries');
  await page.locator('#play').click();
  await waitText(page, '#now-title', /^S01 B — syncopated pulse$/);
  await queueCount(page, 0);
  checks.push({name: stage, status: 'PASS'});

  stage = 'Same-origin playback ownership conflict and explicit transfer';
  const second = await context.newPage();
  currentPage = second;
  observeErrors(second, 'second');
  await second.goto(origin);
  await ready(second);
  await second.locator('#play').click();
  await waitText(second, '#error', /Another tab owns playback/);
  assert.equal(await second.locator('#now-title').innerText(), 'Nothing playing');
  await stop(page);
  await second.locator('#play').click();
  await waitText(second, '#now-title', /^S01 A — slow triangle pulse$/);
  await stop(second);
  await second.close();
  currentPage = page;
  await page.bringToFront();
  checks.push({name: stage, status: 'PASS'});

  stage = 'Reload clears pending audio and permits a fresh explicit Play';
  await page.locator('#play').click();
  await waitText(page, '#now-title', /^S01 A — slow triangle pulse$/);
  await page.locator('#next-song').click();
  await waitText(page, '#next-title', /^S01 B — syncopated pulse$/);
  await page.reload();
  await ready(page);
  assert.equal(await page.locator('#next-title').innerText(), 'Nothing scheduled');
  assert.equal(await page.locator('#pause').isDisabled(), true);
  assert.equal(await page.locator('#requested-target').innerText(), 'explore · any genre');
  await queueCount(page, 0);
  await page.locator('#play').click();
  await waitText(page, '#now-title', /^S01 A — slow triangle pulse$/);
  await stop(page);
  checks.push({name: stage, status: 'PASS'});

  stage = 'Mobile controls, viewport fit and no page script errors';
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('#queue-a').click();
  await queueCount(page, 1);
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile layout overflows');
  await page.screenshot({path: resolve(directory, 'player-mobile.png'), fullPage: true});
  await page.locator('#queue li').first().getByRole('button', {name: /^Cancel queued 1:/}).click();
  await queueCount(page, 0);
  assert.deepEqual(errors, []);
  checks.push({name: stage, status: 'PASS'});
  const report = {browser: await runningBrowser.version(), platform: process.platform, node: process.version,
    playwright: playwrightVersion, elapsedMilliseconds: Date.now() - started, checks, offlineReport: 'offline.json',
    physicalOutput: 'NOT TESTED', listening: 'NOT TESTED'};
  await writeFile(resolve(directory, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({path: resolve(directory, 'failure.png'), fullPage: true, timeout: 5000}).catch(() => undefined);
  }
  await writeFile(resolve(directory, 'failure.json'), JSON.stringify({stage, checks, errors,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    platform: process.platform, node: process.version}, null, 2) + '\n').catch(() => undefined);
  throw error;
} finally {
  // Browser failure must still release the loopback listener on all three OSes.
  try { await browser?.close(); }
  finally {
    if (server.listening) {
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    }
  }
}
