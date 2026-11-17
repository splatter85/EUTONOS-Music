/** S20 Windows/browser engineering gate. Generated fixtures only; no listening claim. */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser} from 'playwright';
import {createDemoServer} from './serve.js';
import {buildSyntheticSet} from '../tests/helpers/synthetic-set.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'artifacts', 'deck-browser');
await mkdir(output, {recursive: true});
const report = {platform: process.platform, node: process.version, source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  browser: '', checks: [] as string[], metrics: [] as unknown[], error: ''};
const set = await buildSyntheticSet([
  {id: 'deck-174-a', bpm: 174, bars: 20, tonic: 9, mode: 'minor'},
  // Matched-tempo, distinct-key control fixture; unequal-tempo refusal has its own pre-check gate.
  {id: 'deck-174-b', bpm: 174, bars: 20, tonic: 4, mode: 'minor'},
]);
const server = createDemoServer(root);
let browser: Browser | undefined;
try {
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1360, height: 1000}});
  const errors: string[] = [];
  await context.route('http://127.0.0.1:7870/**', route => route.abort('connectionrefused'));
  await context.route(origin + '/local/s16-rated/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/local/s16-rated/', '');
    if (!/^(?:catalog\.json|pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path)) return route.fulfill({status: 404});
    try { return await route.fulfill({body: await readFile(join(set.out, ...path.split('/')))}); }
    catch { return route.fulfill({status: 404}); }
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/studio.html?pack=set&dossiers=off');
  await page.waitForFunction(() => document.getElementById('global-status')?.textContent?.includes('loaded · 2 songs'));
  assert.equal(await page.locator('.deck-control').count(), 8);
  assert.equal(await page.locator('#set-crossfader').isVisible(), true);
  assert.equal(await page.locator('#automatic-xfader').isVisible(), false);
  report.checks.push('set Studio shows eight independently owned knobs and the accessible crossfader');

  // Actual native offline DSP: the unchanged automatic lanes remain equivalent, and manual
  // fader takeover replaces their gain automation while the distinct lifetime gate still closes.
  const native = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {DeckMixer} = await load('/dist/web/deck-mixer.js') as typeof import('../web/deck-mixer.js');
    const {crossfadeAutomation, bassSwapAutomation, filterSweepAutomation, createMixAutomationGraph} =
      await load('/dist/src/mix-automation.js') as typeof import('../src/mix-automation.js');
    const rate = 48000, duration = 36000, at = 24000, end = at + duration;
    const rms = (data: Float32Array, start: number, finish: number): number => {
      let sum = 0; for (let i = start; i < finish; i++) sum += data[i]! ** 2; return Math.sqrt(sum / (finish - start));
    };
    async function render(kind: 'crossfade' | 'bass' | 'sweep', deck: boolean, manual = false, mid = false) {
      const audio = new OfflineAudioContext(1, 96000, rate), buffer = audio.createBuffer(1, 96000, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = 0.12 * Math.sin(i * 2 * Math.PI * 110 / rate) + 0.08 * Math.sin(i * 2 * Math.PI * 1700 / rate);
      const source = audio.createBufferSource(); source.buffer = buffer;
      const plan = (kind === 'bass' ? bassSwapAutomation : kind === 'sweep' ? filterSweepAutomation : crossfadeAutomation)(duration, rate).outgoing;
      let mixer: InstanceType<typeof DeckMixer> | undefined;
      if (deck) {
        mixer = new DeckMixer(audio, audio.destination);
        const owner = mixer.a.createOwner(); source.connect(mixer.a.input);
        owner.setLifetime(0, end); if (manual) mixer.setCrossfader(0);
        owner.schedule(plan, at);
      } else { source.connect(audio.destination); createMixAutomationGraph(audio, source, audio.destination, at, plan); }
      source.start(0); source.stop(end / rate);
      const suspended = mid ? audio.suspend(0.8).then(async () => { mixer!.setCrossfader(0); await audio.resume(); }) : null;
      const rendered = await audio.startRendering(); await suspended;
      const out = Array.from(rendered.getChannelData(0)); mixer?.release(); return out;
    }
    const checks = [];
    for (const kind of ['crossfade', 'bass', 'sweep'] as const) {
      const legacy = await render(kind, false), deck = await render(kind, true);
      let error = 0; for (let i = 0; i < legacy.length; i++) error = Math.max(error, Math.abs(legacy[i]! - deck[i]!));
      if (error > 0.00002) throw Error(kind + ' automatic native output differs: ' + error);
      checks.push({kind, maximumSampleDifference: error});
    }
    const manual = new Float32Array(await render('crossfade', true, true));
    const takeover = new Float32Array(await render('crossfade', true, false, true));
    const auto = new Float32Array(await render('crossfade', true));
    const window = [Math.round(rate * 1.1), Math.round(rate * 1.2)] as const;
    const autoRms = rms(auto, ...window), manualRms = rms(manual, ...window), takeoverRms = rms(takeover, ...window);
    if (manualRms < autoRms * 3 || takeoverRms < autoRms * 3) throw Error('Manual takeover did not replace the automatic fade.');
    const after = Math.max(...manual.slice(end + 128).map(Math.abs)), afterTakeover = Math.max(...takeover.slice(end + 128).map(Math.abs));
    if (after !== 0 || afterTakeover !== 0) throw Error('Manual fader bypassed source lifetime silence.');
    checks.push({autoRms, manualRms, takeoverRms, maximumAfterLifetime: after});
    return checks;
  });
  report.metrics.push(...native);
  report.checks.push('native offline crossfade, bass swap and filter-sweep automatic samples match original graph within 0.00002');
  report.checks.push('native manual-before-plan and mid-mix takeover replace fade; scheduled source lifetime still closes to exact silence');

  await page.locator('#deck-a-low').focus(); await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.getElementById('deck-a-low')?.getAttribute('aria-valuetext')?.includes('You'));
  await page.locator('#deck-a-filter').focus(); await page.keyboard.press('ArrowRight');
  await page.locator('#deck-crossfader').evaluate(node => { (node as HTMLInputElement).value = '0.35'; node.dispatchEvent(new Event('input')); });
  // Explore is the set default with a fresh seed per load; pin one so this gate is reproducible. This seed
  // draws a candidate whose PASS arrives after its audio-clock deadline, so it exercises the re-choose of a
  // later (again pre-checked) bar; before that change it refused Next ("Request Next again").
  await page.evaluate(seed => {
    const field = document.getElementById('set-explore-seed') as HTMLInputElement;
    field.value = seed; field.dispatchEvent(new Event('change'));
  }, '1763426704');
  await page.locator('#dj-play').click();
  await page.waitForFunction(() => document.getElementById('dj-now')?.textContent?.includes('deck-174-a'));
  assert.match(await page.locator('#deck-a-title').innerText(), /deck-174-a/);
  assert.match(await page.locator('#deck-a-motion').innerText(), /Original pitch/);
  report.checks.push('keyboard EQ/filter and crossfader takeover before Play are retained when the first source starts');

  await page.locator('#dj-next').click();
  await page.waitForFunction(() => document.getElementById('set-mix')?.textContent?.startsWith('Planned:'), undefined, {timeout: 30000});
  assert.match(await page.locator('#deck-a-low').getAttribute('aria-valuetext') ?? '', /You/);
  assert.match(await page.locator('#deck-crossfader-owner').innerText(), /You/);
  await page.screenshot({path: join(output, 'studio-decks-desktop.png'), fullPage: true});
  await page.waitForFunction(() => {
    const now = document.getElementById('dj-now')?.textContent ?? '';
    return now.includes('deck-174-b') && !now.includes('deck-174-a');
  }, undefined, {timeout: 40000});
  assert.match(await page.locator('#deck-b-title').innerText(), /deck-174-b/);
  assert.doesNotMatch(await page.locator('#deck-a-title').innerText(), /deck-174-b/);
  assert.match(await page.locator('#deck-crossfader-owner').innerText(), /You/);
  report.checks.push('Next preserves manual control and the incoming song remains on physical B after settlement');

  await page.locator('#dj-pause').click();
  await page.waitForFunction(() => document.getElementById('dj-pause')?.getAttribute('aria-label') === 'Resume');
  const position = await page.locator('#deck-b-time').innerText();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#deck-b-time').innerText(), position, 'display follows suspended audio time');
  await page.locator('#dj-pause').click();
  await page.locator('#deck-crossfader-return').click();
  await page.getByRole('button', {name: 'Return Deck A Low to DJ', exact: true}).click();
  await page.waitForFunction(() => document.getElementById('deck-crossfader-owner')?.textContent === 'DJ controls the crossfader'
    && document.getElementById('deck-a-low')?.getAttribute('aria-valuetext')?.endsWith('DJ'));
  assert.match(await page.locator('#deck-a-low').getAttribute('aria-valuetext') ?? '', /DJ/);
  assert.match(await page.locator('#deck-a-filter').getAttribute('aria-valuetext') ?? '', /You/, 'returning another control does not release filter');
  report.checks.push('pause freezes the clock display; explicit individual handback returns only the selected control');

  await page.locator('#dj-stop').click();
  await page.waitForFunction(() => document.getElementById('dj-now')?.textContent === 'Nothing');
  assert.match(await page.locator('#deck-a-filter').getAttribute('aria-valuetext') ?? '', /You/);
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: join(output, 'studio-decks-mobile.png'), fullPage: true});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  report.checks.push('Stop retains manual ownership, mobile layout fits, and page has no script errors');
  console.log(JSON.stringify(report, null, 2));
} catch (error) { report.error = error instanceof Error ? error.stack ?? error.message : String(error); console.error(report.error); process.exitCode = 1; }
finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve())); await set.cleanup();
}
