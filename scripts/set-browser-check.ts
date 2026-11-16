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
let longSet: Awaited<ReturnType<typeof buildSyntheticSet>> | undefined;
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

  // S19: real 180/181s stereo 48 kHz input, real analysis/render workers and native offline
  // audio. No confidence overrides; section/accent changes exist in the generated PCM.
  longSet = await buildSyntheticSet([
    {id: 'long-122', bpm: 122, seconds: 180, stereo: true, transitionEvidence: true},
    {id: 'long-128', bpm: 128, seconds: 181, stereo: true, transitionEvidence: true},
  ], 48000);
  await context.route(origin + '/s19-synthetic/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/s19-synthetic/', '');
    if (!/^(?:pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path)) return route.fulfill({status: 404});
    try { return await route.fulfill({body: await readFile(join(longSet!.out, ...path.split('/')))}); }
    catch { return route.fulfill({status: 404}); }
  });
  const nativeJoin = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {loadBrowserPack, decodeRecording} = await load('/dist/src/browser-pack.js') as typeof import('../src/browser-pack.js');
    const {MixAnalysisCache, browserMixPreparation, chooseSetTransition, renderSetBlend} = await load('/dist/src/mix-transition.js') as typeof import('../src/mix-transition.js');
    const {RecordedSource, WebAudioClock} = await load('/dist/src/web-audio.js') as typeof import('../src/web-audio.js');
    const loaded = await loadBrowserPack(new URL('/s19-synthetic/pack/manifest.json', location.href), false, fetch,
      {set: true, allowUnreviewed: true});
    const rate = 48000, offline = new OfflineAudioContext(2, rate * 35, rate);
    const recordings = await Promise.all(loaded.pack.assets.map(a => decodeRecording(loaded, offline, a)));
    const [from, to] = recordings, cache = new MixAnalysisCache();
    const [a, b] = await Promise.all(recordings.map(r => cache.analyze(r, browserMixPreparation)));
    if (!a!.ok || !b!.ok) throw new Error('Actual song worker analysis unavailable.');
    const choice = chooseSetTransition({from: {asset: from!.asset, analysis: a!.analysis, frames: from!.buffer.length},
      to: {asset: to!.asset, analysis: b!.analysis, frames: to!.buffer.length, channels: 2},
      sampleRate: rate, earliestFrame: 3 * rate, boundary: {bars: 4, anchorBar: 0}});
    if (choice.kind !== 'analyzed' || choice.plan.recipe !== 'blend') throw new Error('Actual song workers did not select a blend: ' + JSON.stringify(choice));
    let preparedSamples = 0;
    const runtime = {...browserMixPreparation, render: async (...args: Parameters<typeof browserMixPreparation.render>) => {
      preparedSamples = args[0].channels[0]!.length * args[0].channels.length;
      return browserMixPreparation.render(...args);
    }};
    const ready = await renderSetBlend(offline, to!, choice.plan, b!.analysis, undefined, runtime);
    const source = new RecordedSource(offline, ready.incoming, offline.destination, {allowUnreviewed: true});
    const clock = new WebAudioClock(offline); await source.prepare(clock);
    const start = 4800, outgoing = new RecordedSource(offline, from!, offline.destination, {allowUnreviewed: true});
    await outgoing.prepare(clock);
    outgoing.scheduleStart({at: clock.stamp(start), entryCueId: from!.asset.cues.find(c => c.kind === 'entry')!.id});
    const at = start + choice.plan.fromExitFrame;
    source.scheduleMixStart(clock.stamp(at), ready.entryFrame, choice.plan.automation.incoming);
    outgoing.transitionMixOut(clock.stamp(at), choice.plan.fromExitFrame, choice.plan.automation.outgoing);
    const joinAt = at + ready.nativeJoin.outputFrame - ready.entryFrame;
    const output = await offline.startRendering();
    let seamError = 0, nativeError = 0;
    for (let c = 0; c < 2; c++) {
      const actual = output.getChannelData(c), native = to!.buffer.getChannelData(c);
      seamError = Math.max(seamError, Math.abs(actual[joinAt - 1]! - native[ready.nativeJoin.sourceFrame - 1]!));
      for (let i = 0; i < 2048; i++) nativeError = Math.max(nativeError, Math.abs(actual[joinAt + i]! - native[ready.nativeJoin.sourceFrame + i]!));
    }
    source.release(); outgoing.release();
    return {recipe: choice.plan.recipe, preparedSamples, originalSamples: to!.buffer.length * 2, joinAt,
      nativeFrame: ready.nativeJoin.sourceFrame, measuredJoin: b!.analysis.structure.downbeatFrames.includes(ready.nativeJoin.sourceFrame),
      seamError, nativeError, analyzedFrames: [a!.analysis.analyzedWindow!.frames, b!.analysis.analyzedWindow!.frames]};
  });
  assert.equal(nativeJoin.recipe, 'blend'); assert.equal(nativeJoin.measuredJoin, true);
  assert.ok(nativeJoin.preparedSamples < 12_000_000 / 4 && nativeJoin.preparedSamples < nativeJoin.originalSamples / 10, JSON.stringify(nativeJoin));
  assert.ok(nativeJoin.analyzedFrames.every(n => n <= 60 * 48000));
  assert.ok(nativeJoin.seamError < 1e-5 && nativeJoin.nativeError < 1e-5, JSON.stringify(nativeJoin));
  report.plans.push(JSON.stringify(nativeJoin));
  report.checks.push('180s -> 181s stereo 48k 122 -> 128 really blends in actual workers with bounded PCM; native offline join matches predecessor and continuation samples');
  assert.deepEqual(errors, []);
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
  await longSet?.cleanup();
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
}
