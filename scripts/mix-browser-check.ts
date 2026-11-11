/** Additive DJ mix qualification; existing browser groups and authored defaults are unchanged. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser} from 'playwright';
import {createDemoServer} from './serve.js';
import type {MixCheckResult} from '../web/mix-checks.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const helperPath = '/dist/tests/helpers/mix-fixtures.js';
const helper = new URL('../tests/helpers/mix-fixtures.js', import.meta.url);
const baseline = createDemoServer(root);
const server = createServer((request, response) => {
  const path = (request.url ?? '').split('?')[0]!;
  if (path !== '/mix-checks' && path !== helperPath) { baseline.emit('request', request, response); return; }
  if (!/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(request.headers.host ?? '') ||
    (request.method !== 'GET' && request.method !== 'HEAD')) {
    response.writeHead(400); response.end(); return;
  }
  const send = (body: string, type: string) => {
    response.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  if (path === '/mix-checks') {
    send('<!doctype html><meta charset="utf-8"><title>Isolated DJ mix checks</title><button id="activate">Enable test context</button>',
      'text/html; charset=utf-8');
    return;
  }
  void readFile(helper, 'utf8').then(body => send(body, 'text/javascript; charset=utf-8')).catch(() => {
    response.writeHead(500); response.end('Synthetic test helper unavailable');
  });
});
const output = new URL('../../artifacts/dj-transitions/browser/', import.meta.url);
await mkdir(output, {recursive: true});
const report: {platform: string; node: string; source: string; dirty: boolean; browser?: string;
  results: MixCheckResult[]; physicalOutput: string; listening: string; error?: string} = {
  platform: process.platform, node: process.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim().length !== 0,
  results: [], physicalOutput: 'NOT TESTED', listening: 'NOT TESTED',
};
let browser: Browser | undefined;
const errors: string[] = [];
try {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({headless: true}); report.browser = browser.version();
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/mix-checks');
  // Genuine browser gesture permits the bounded native AudioContext test.
  await page.locator('#activate').click();
  const native = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {loadBrowserPack} = await load('/dist/src/browser-pack.js') as typeof import('../src/browser-pack.js');
    const {runMixChecks} = await load('/dist/web/mix-checks.js') as typeof import('../web/mix-checks.js');
    const loaded = await loadBrowserPack(new URL('/fixtures/s01/manifest.json', location.href), true);
    return runMixChecks(loaded);
  });
  report.results.push(...native);
  assert.ok(native.length === 12 && native.every(result => result.status === 'PASS'),
    JSON.stringify(native.filter(result => result.status !== 'PASS')));
  await page.goto(origin + '/');
  await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled);
  assert.equal(await page.locator('#handoff').inputValue(), 'direct');
  assert.equal(await page.locator('#volume').inputValue(), '0.65');
  assert.equal(await page.locator('#mix-pitch').isChecked(), false);
  assert.equal(await page.locator('#mix-return').isChecked(), false);
  assert.equal(await page.locator('#mix-detail').isVisible(), false);
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  report.results.push({name: 'Real page retains direct handoff, volume0.65, stopped state and opt-in defaults',
    status: 'PASS', evidence: {handoff: 'direct', volume: 0.65, pitchShift: false, returnTempo: false,
      initiallyStopped: true, mixDetailsHidden: true}});

  await page.locator('#handoff').selectOption('mix');
  assert.equal(await page.locator('#mix-detail').isVisible(), true);
  await page.locator('#play').click();
  await page.waitForFunction(() => (document.getElementById('now-title')?.textContent ?? '').includes('S01 A'));
  await page.locator('#next-song').click();
  await page.waitForFunction(() => /authored crossfade/i.test(document.getElementById('mix-detail')?.textContent ?? ''),
    null, {timeout: 30000});
  const detail = await page.locator('#mix-detail').innerText();
  assert.match(detail, /confidence|unsupported|insufficient/i);
  assert.match(await page.locator('#next-title').innerText(), /S01 B/);
  assert.equal(await page.locator('#cancel-next').isEnabled(), true);
  await page.screenshot({path: fileURLToPath(new URL('s01-mix-fallback.png', output)), fullPage: true});
  await page.locator('#cancel-next').click();
  await page.waitForFunction(() => (document.getElementById('next-title')?.textContent ?? '') === 'Nothing scheduled');
  await page.locator('#stop').click();
  await page.waitForFunction(() => (document.getElementById('now-title')?.textContent ?? '') === 'Nothing playing');
  await page.reload();
  await page.waitForFunction(() => !(document.getElementById('play') as HTMLButtonElement).disabled);
  assert.equal(await page.locator('#handoff').inputValue(), 'direct');
  assert.equal(await page.locator('#mix-pitch').isChecked(), false);
  assert.equal(await page.locator('#mix-return').isChecked(), false);
  assert.equal(await page.locator('#now-title').innerText(), 'Nothing playing');
  report.results.push({name: 'Real page opt-in mix explains low-confidence S01 authored fallback and cancels/restores safely',
    status: 'PASS', evidence: {fallbackDetail: detail, originalDirectRouteUsed: true,
      preBoundaryCancellation: true, reloadStopped: true, reloadDefaultsPreserved: true}});
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1; console.error(report.error);
} finally {
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
  try { await browser?.close(); }
  finally {
    if (server.listening) await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }
}
