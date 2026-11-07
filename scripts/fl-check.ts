/**
 * EMF-S09 owner-local check of the real-FL pack (`local/s09-fl/pack`, made by `npm run fl:produce`).
 * It is not part of the portable gate: the pack exists only on a PC where FL Studio rendered it.
 *
 * 1. Native offline measurement of A → procedural bridge → B for the pack's own policy (web/handoff-measure.ts).
 * 2. A live headless-Chromium run of the DJ page on that pack: hybrid handoff with a pause and resume
 *    inside the bridge, then Stop; every status change is logged with wall time and the audio-clock frame.
 * 3. The sampler page plays the real-FL palette and stops.
 *
 * Writes artifacts/s09-fl/fl-check.json and screenshots. Headless Chromium plays to no device:
 * physical output and listening are NOT TESTED.
 */
import assert from 'node:assert/strict';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Browser, Page} from 'playwright';
import {createDemoServer} from './serve.js';

const packDir = fileURLToPath(new URL('../../local/s09-fl/pack/', import.meta.url));
if (!(await stat(resolve(packDir, 'manifest.json')).then(() => true, () => false))) {
  console.error(`No real-FL pack at ${packDir}. Close FL Studio and run: npm run fl:produce`);
  process.exit(2);
}
const directory = resolve('artifacts/s09-fl');
await mkdir(directory, {recursive: true});
const {chromium} = await import('playwright');
const server = createDemoServer();
let browser: Browser | undefined;
let live: Page | undefined;
const errors: string[] = [];
const report: Record<string, unknown> = {platform: process.platform, node: process.version,
  physicalOutput: 'NOT TESTED', listening: 'NOT TESTED'};

async function waitText(page: Page, selector: string, expected: RegExp, timeout = 5000): Promise<void> {
  await page.waitForFunction(({selector, source}) => new RegExp(source).test(document.querySelector(selector)?.textContent ?? ''),
    {selector, source: expected.source}, {timeout});
}
/** Records each #status change with wall time and the clock text, in the page. */
async function logStatus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: {t: number; status: string; now: string; clock: string}[] = [];
    (window as unknown as {statusLog: typeof log}).statusLog = log;
    const push = () => log.push({t: Math.round(performance.now()), status: document.getElementById('status')!.textContent ?? '',
      now: document.getElementById('now-title')!.textContent ?? '', clock: document.getElementById('clock-detail')!.textContent ?? ''});
    push();
    new MutationObserver(push).observe(document.getElementById('status')!, {childList: true, characterData: true, subtree: true});
  });
}

try {
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => done()); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({headless: true}) as Browser;
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}});
  context.setDefaultTimeout(8000);
  const page = await context.newPage();
  live = page;
  page.on('pageerror', error => errors.push(error.message));

  // 1. Offline measurement.
  await page.goto(origin + '/checks.html');
  const offline = await page.evaluate(async path => {
    const module = await import('/dist/web/handoff-measure.js' as string);
    return module.measurePack(path);
  }, '/local/s09-fl/pack/manifest.json') as {results: {status: string}[]};
  report.offline = offline;
  assert.ok(offline.results.every(r => r.status === 'PASS'), JSON.stringify(offline, null, 2));

  // 2. Live DJ hybrid handoff with pause/resume inside the bridge.
  await page.goto(origin + '/?pack=fl');
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#play')!.disabled);
  assert.match(await page.locator('#status').innerText(), /^Ready — S09 real FL/);
  assert.equal(await page.locator('#track-a-title').innerText(), 'S09 FL A — chords, bass and kit (slow)');
  await logStatus(page);
  await page.locator('#handoff').selectOption('hybrid');
  await page.locator('#play').click();
  await waitText(page, '#now-title', /^S09 FL A/);
  await page.locator('#next-song').click();
  await waitText(page, '#execution', /^accepted · scheduled · Scheduled the checked A → procedural bridge → B handoff/);
  const nextDetail = await page.locator('#next-detail').innerText();
  await waitText(page, '#status', /^Bridge entering — A fades for one bar$/, 12000);
  await page.screenshot({path: resolve(directory, 'dj-bridge.png'), fullPage: true});
  await waitText(page, '#status', /^Procedural bridge playing$/, 4000);
  await page.locator('#pause').click();
  await waitText(page, '#clock-detail', /^suspended ·/);
  const pausedClock = await page.locator('#clock-detail').innerText();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('#clock-detail').innerText(), pausedClock, 'The clock moved while paused.');
  await page.locator('#pause').click();
  await waitText(page, '#clock-detail', /^running ·/);
  await waitText(page, '#status', /^B entered — bridge percussion fades$/, 10000);
  await waitText(page, '#now-title', /S09 FL B/);
  await waitText(page, '#status', /^Handoff complete$/, 4000);
  // After the resume, the latest execution line reports the resume command, not the handoff; the status log is the evidence.
  await page.locator('#stop').click();
  await waitText(page, '#now-title', /^Nothing playing$/);
  const statusLog = await page.evaluate(() => (window as unknown as {statusLog: unknown[]}).statusLog);
  report.liveDj = {nextDetail, pausedClock, statusLog, packSelectEnabledAfterStop: !(await page.locator('#dj-pack').isDisabled())};

  // 3. Sampler with the real-FL palette.
  await page.goto(origin + '/procedural.html?pack=fl');
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#play')!.disabled);
  const selection = await page.locator('#selection-detail').innerText();
  await page.locator('#play').click();
  await waitText(page, '#status', /^Playing the prepared phrase plan$/);
  await page.waitForTimeout(1000);
  await page.locator('#stop').click();
  await waitText(page, '#now-title', /^Nothing playing$/);
  report.sampler = {selection, played: true};
  assert.deepEqual(errors, []);
  report.result = 'PASS';
} catch (error) {
  report.result = 'FAIL';
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  report.failureState = await live?.evaluate(() => ({statusLog: (window as unknown as {statusLog?: unknown}).statusLog ?? null,
    status: document.getElementById('status')?.textContent, now: document.getElementById('now-title')?.textContent,
    execution: document.getElementById('execution')?.textContent, error: document.getElementById('error')?.textContent})).catch(() => null);
  await live?.screenshot({path: resolve(directory, 'failure.png'), fullPage: true}).catch(() => undefined);
  process.exitCode = 1;
} finally {
  report.pageErrors = errors;
  try { await browser?.close(); } finally {
    if (server.listening) { const closed = new Promise<void>(r => server.close(() => r())); server.closeAllConnections(); await closed; }
  }
  report.pack = JSON.parse(await readFile(resolve(packDir, 'IMPORT.json'), 'utf8')).manifest_sha256;
  await writeFile(resolve(directory, 'fl-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({result: report.result, error: report.error, report: resolve(directory, 'fl-check.json')}, null, 2));
}
