/** Isolated, reproducible browser checks against the loopback demo server. */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
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
const server = createDemoServer();
await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const address = server.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const directory = resolve(options.get('--output') ?? 'artifacts/s02-browser');
await mkdir(directory, {recursive: true});
let browser;
const checks: {name: string; status: string}[] = [];
try {
  browser = await chromium.launch({headless: true,
    ...(options.has('--browser') ? {executablePath: options.get('--browser')} : {})});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}});
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  await page.goto(`${origin}/checks.html`);
  await page.getByRole('button', {name: 'Run offline checks'}).click();
  await page.waitForFunction(() => /checks passed|failed/.test(document.getElementById('check-status')!.textContent!), null,
    {timeout: 30000});
  const offline = JSON.parse(await page.locator('#check-results').innerText());
  await writeFile(resolve(directory, 'offline.json'), JSON.stringify(offline, null, 2) + '\n');
  assert.equal(offline.results.length, 7);
  assert.ok(offline.results.every((r: {status: string}) => r.status === 'PASS'), JSON.stringify(offline, null, 2));
  checks.push({name: 'Seven native offline audio checks', status: 'PASS'});

  await page.goto(origin);
  await page.getByRole('button', {name: 'Play A', exact: true}).waitFor({state: 'visible'});
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#play-a')!.disabled);
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  await page.screenshot({path: resolve(directory, 'player-ready.png'), fullPage: true});
  await page.getByRole('button', {name: 'Play A', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#status')!.textContent === 'Playing.');
  await page.getByRole('button', {name: 'Schedule A → B', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#next-title')!.textContent!.includes('S01 B'));
  assert.match(await page.locator('#now-title').innerText(), /S01 A/);
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#clock-detail')!.textContent!.includes('suspended'));
  const paused = await page.locator('#clock-detail').innerText();
  const elapsed = await page.locator('#now-detail').innerText();
  // A short wall-clock wait checks suspension; it never schedules an audio event.
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(await page.locator('#clock-detail').innerText(), paused);
  assert.equal(await page.locator('#now-detail').innerText(), elapsed);
  assert.match(await page.locator('#next-title').innerText(), /S01 B/);
  await page.screenshot({path: resolve(directory, 'player-paused.png'), fullPage: true});
  await page.getByRole('button', {name: 'Resume', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#status')!.textContent === 'Playing.');
  await page.getByRole('button', {name: 'Mute', exact: true}).click();
  assert.equal(await page.getByRole('button', {name: 'Unmute', exact: true}).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', {name: 'Unmute', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#status')!.textContent === 'Crossfading A → B.', null,
    {timeout: 12000});
  assert.match(await page.locator('#now-title').innerText(), /S01 A.*S01 B/);
  await page.screenshot({path: resolve(directory, 'player-crossfade.png'), fullPage: true});
  await page.waitForFunction(() => document.querySelector('#next-detail')!.textContent === 'Handoff complete.', null,
    {timeout: 6000});
  assert.equal(await page.locator('#now-title').innerText(), 'S01 B — syncopated pulse');
  checks.push({name: 'Live A → B, Now/Next, frozen pause/resume and mute', status: 'PASS'});
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  assert.equal(await page.locator('#next-title').innerText(), 'Nothing queued');

  await page.getByRole('button', {name: 'Play B', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#now-title')!.textContent!.includes('S01 B'));
  assert.equal(await page.locator('#transition').isDisabled(), true);
  const second = await context.newPage();
  await second.goto(origin);
  await second.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#play-a')!.disabled);
  await second.getByRole('button', {name: 'Play A', exact: true}).click();
  await second.waitForFunction(() => document.querySelector('#error')!.textContent!.includes('Another tab owns playback'));
  assert.equal(await second.locator('#now-title').innerText(), 'Nothing playing');
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  await second.getByRole('button', {name: 'Play A', exact: true}).click();
  await second.waitForFunction(() => document.querySelector('#now-title')!.textContent!.includes('S01 A'));
  await second.getByRole('button', {name: 'Stop', exact: true}).click();
  await second.close();
  checks.push({name: 'Play B and same-origin ownership conflict/release', status: 'PASS'});

  // A scheduled incoming voice must disappear when stopped before its cue.
  await page.getByRole('button', {name: 'Play A', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#status')!.textContent === 'Playing.');
  await page.getByRole('button', {name: 'Schedule A → B', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#next-title')!.textContent!.includes('S01 B'));
  await page.getByRole('button', {name: 'Stop', exact: true}).click();
  await page.getByRole('button', {name: 'Play B', exact: true}).click();
  await page.waitForFunction(() => document.querySelector('#now-title')!.textContent!.includes('S01 B'));
  assert.equal(await page.locator('#next-title').innerText(), 'Nothing queued');
  await page.reload();
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#play-a')!.disabled);
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  assert.equal(await page.locator('#pause').isDisabled(), true);
  checks.push({name: 'Stop cancels pending transition; replacement and reload stay explicit', status: 'PASS'});

  await page.setViewportSize({width: 390, height: 844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile layout overflows');
  await page.screenshot({path: resolve(directory, 'player-mobile.png'), fullPage: true});
  assert.deepEqual(errors, []);
  checks.push({name: 'Desktop/mobile layout and no page script errors', status: 'PASS'});
  const report = {browser: await browser.version(), platform: process.platform, node: process.version,
    playwright: playwrightVersion, checks, offlineReport: 'offline.json', physicalOutput: 'NOT TESTED', listening: 'NOT TESTED'};
  await writeFile(resolve(directory, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
