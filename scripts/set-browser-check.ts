/**
 * EMF-S18 set-mode browser gate. Run after npm run build: node dist/scripts/set-browser-check.js
 * Headless Chromium on an ephemeral loopback port. A synthetic four-song set (generated tones,
 * never owner audio) is imported through the real `importRatedTakes --set` path into a temp
 * folder and routed to the page at /local/s16-rated/, the only folder serve.ts exposes for it.
 * Proves: any-to-any order via queue reorder, Next on a 4-bar boundary, one Auto step anchored
 * to the song's entry, and the phone Auto command shape. Not listening or device evidence.
 */
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type Page} from 'playwright';
import {createDemoServer} from './serve.js';
import {buildSyntheticSet} from '../tests/helpers/synthetic-set.js';
import {PassThrough} from 'node:stream';
import {createPhoneRelay, studioSetPageUrl, type EncoderProcess} from './phone-relay.js';

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
  {id: 'synthetic-174-c', bpm: 174, bars: 20, tonic: 9, mode: 'minor' as const},
  {id: 'synthetic-120', bpm: 120, bars: 12, tonic: 2, mode: 'major' as const},
  {id: 'synthetic-174-b', bpm: 174, bars: 20, tonic: 4, mode: 'minor' as const},
];
const set = await buildSyntheticSet(SONGS);
let servedSet = set;
let longSet: Awaited<ReturnType<typeof buildSyntheticSet>> | undefined;
let motionSet: Awaited<ReturnType<typeof buildSyntheticSet>> | undefined;
const server = createDemoServer(root);
let browser: Browser | undefined;
const errors: string[] = [];
const text = (page: Page, id: string) => page.locator('#' + id).innerText();
const waitText = async (page: Page, id: string, pattern: RegExp, timeout = 15000) => {
  try {
    await page.waitForFunction(([target, source]) => new RegExp(source!).test(document.getElementById(target!)?.textContent ?? ''),
      [id, pattern.source], {timeout});
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : error}; ${id}: ${await text(page, id)}; mix: ${await text(page, 'set-mix')}`);
  }
};
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
    try { return await route.fulfill({body: await readFile(join(servedSet.out, ...path.split('/')))}); }
    catch { return route.fulfill({status: 404}); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/studio.html?pack=set&dossiers=off');
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

  // Phone UX: the Studio set page reports its queue and handover status to a real relay and obeys
  // the phone's set-next through the same reorder as the Queue arrows; unknown ids are refused.
  {
    const fakeEncoder = (): EncoderProcess => {
      const stdin = new PassThrough(), stdout = new PassThrough();
      stdin.pipe(stdout);
      return {stdin, stdout, kill: () => { stdin.unpipe(stdout); stdout.end(); }, on: () => undefined};
    };
    const relay = createPhoneRelay({spawnEncoder: fakeEncoder, djOrigins: [origin], feedbackRoot: await mkdtemp(join(tmpdir(), 'eutonos-feedback-'))});
    await new Promise<void>((resolve, reject) => { relay.server.once('error', reject); relay.server.listen(0, '127.0.0.1', resolve); });
    const relayAddress = relay.server.address();
    assert.ok(relayAddress && typeof relayAddress !== 'string');
    const control = async (body: unknown): Promise<number> => (await fetch(`http://127.0.0.1:${relayAddress.port}/api/control`,
      {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})).status;
    const phonePage = await context.newPage();
    phonePage.on('pageerror', error => errors.push(`phone-stream page: ${error.message}`));
    try {
      await phonePage.goto(studioSetPageUrl(origin, relayAddress.port, relay.token, '&sources=legacy'));
      await waitText(phonePage, 'global-status', /Rated set.*loaded · 4 songs/);
      await phonePage.locator('#phone-stream').click();
      const until = async (check: () => boolean, label: string): Promise<void> => {
        const deadline = Date.now() + 15000;
        while (!check()) { if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`); await new Promise(r => setTimeout(r, 50)); }
      };
      await until(() => (relay.status().dj.status?.queue?.length ?? 0) === 4, 'queue of four in the phone status');
      const first = relay.status().dj.status!;
      assert.equal(first.canSetNext, true);
      assert.equal(first.state, 'idle');
      assert.equal(first.next, first.queue![0]!.title, 'before anything plays, Next-up is the queue head');
      assert.match(first.nextStatus ?? '', /Queued/);
      assert.ok(first.queue!.every(item => /^[A-Za-z0-9._:-]+$/.test(item.id) && item.title.length > 0));
      const pick = first.queue![3]!;
      assert.equal(await control({command: 'set-next', songId: pick.id}), 202);
      await waitText(phonePage, 'phone-stream-detail', /set-next: moved .* to the front of the queue/);
      assert.equal((await queueTitles(phonePage))[0], pick.title, 'the picked song is now the queue head');
      await until(() => relay.status().dj.status?.queue?.[0]?.id === pick.id && relay.status().dj.status?.next === pick.title, 'new head reported to the phone');
      assert.equal(await control({command: 'set-next', songId: pick.id}), 202);
      await waitText(phonePage, 'phone-stream-detail', /set-next: .* is already next/);
      assert.equal(await control({command: 'set-next', songId: 'no-such-song'}), 202);
      await waitText(phonePage, 'phone-stream-detail', /set-next: refused: no-such-song is not in the queue/);
      assert.equal((await queueTitles(phonePage))[0], pick.title, 'an unknown id changes nothing');
      assert.equal(await control({command: 'set-next', songId: '../x'}), 400);
      // Handover card: after Play and Next the phone gets the plan in plain words (same plan data as "Why this handover").
      await phonePage.locator('#dj-play').click();
      await waitText(phonePage, 'dj-now', new RegExp(pick.title.replace(/[()]/g, '\\$&')));
      await phonePage.locator('#dj-next').click();
      await until(() => !!relay.status().dj.status?.transitionNext, 'planned handover in the phone status');
      const planned = relay.status().dj.status!;
      assert.ok(planned.transitionNext!.recipe.length > 3 && !/^[a-z]+-[a-z-]+$/.test(planned.transitionNext!.recipe), `plain recipe words: ${planned.transitionNext!.recipe}`);
      assert.match(planned.transitionNext!.tempo, /^[+-]?\d+\.\d%$/);
      // Part B: the mix-structure@1 sentence may follow the entry time.
      assert.match(planned.transitionNext!.entry, /^enters at \d+:\d\d( · .+)?$/);
      assert.match(planned.nextStatus ?? '', /Ready/);
      await phonePage.locator('#dj-stop').click();
      await phonePage.locator('#phone-stream').click();
    } finally { await phonePage.close(); await relay.close(); }
    report.checks.push('phone relay: set page reports queue and next status, set-next reorders to the head, repeat is a no-op, unknown or path-like ids are refused');
  }

  // Any-to-any: start with the third catalogue song, then reorder so 174-b follows it.
  await moveToHead(page, 'synthetic-174-c');
  await page.locator('#dj-play').click();
  await waitText(page, 'dj-now', /synthetic-174-c/);
  await moveToHead(page, 'synthetic-174-b');
  assert.equal(await page.locator('#dj-now').innerText(), title('synthetic-174-c'), 'a queue edit never moves the music');
  report.checks.push('reorder before Play picks the first song; reorder while playing does not move the music');

  // Matching-tempo control fixtures keep actual Next/Auto admission independent of the
  // known different-tempo fallback phase defect covered by mix-precheck-browser-check.
  // No gate, threshold, measured evidence or production choice is overridden.
  // Next on the next 4-bar boundary.
  await page.selectOption('#set-next-bars', '4');
  await page.locator('#dj-next').click();
  await waitText(page, 'set-mix', /Planned: .*leaves on bar \d+ of the outgoing song \(4-bar boundary\)/, 30000);
  const planned = await text(page, 'set-mix');
  report.plans.push(planned);
  const exitBar = Number(/bar (\d+) of the outgoing/.exec(planned)![1]);
  assert.equal((exitBar - 1) % 4, 0, `Next lands on a 4-bar boundary (bar ${exitBar})`);
  assert.match(planned, /tempo change (?:\+)?0\.0%/, '174 -> 174 control fixture');
  // S21 readout: recipe with its tempo band, EQ choreography, where B enters and why (plan data only).
  await waitText(page, 'set-why-recipe', /tempo gap 0\.0% \(normal\)/, 10000);
  await waitText(page, 'set-why-entry', /B enters at \d+:\d\d \(\d+% in/, 10000);
  // S21: no start bias, so B may enter a phrase into the song; Auto counts from that entry.
  const [, entryMin, entrySec] = /B enters at (\d+):(\d\d)/.exec((await page.locator('#set-why-entry').textContent())!)!;
  const entryBars = Math.round((Number(entryMin) * 60 + Number(entrySec)) / (4 * 60 / 174));
  assert.ok((await page.locator('#set-why-choreo').textContent())!.length > 10, 'choreography described');
  // Owner clarification 2026-11-16: explore (seeded random styles) is the default for set Auto/Next.
  assert.ok(await page.locator('#set-explore').isChecked(), 'explore is on by default');
  assert.match((await page.locator('#set-why-mode').textContent())!, /^explore \(seed \d+\) · plan tp-[0-9a-f]{8}$/);
  await page.locator('#set-why summary').click();
  // A rating never attaches to the planned (not yet heard) handover: nothing has finished, so it is refused.
  await page.locator('#set-why [data-rate="like"]').click();
  await waitText(page, 'set-why-rating', /no handover has finished yet, so there is nothing to rate/, 5000);
  report.checks.push('S21 readout shows recipe, tempo band, choreography, B entry and plan id; rating before any handover has finished is refused');
  await page.locator('#set-explore-seed').fill('7'); await page.locator('#set-explore-seed').dispatchEvent('change'); await page.locator('#set-explore').check();
  assert.match(await text(page, 'dj-next-title'), /synthetic-174-b/);
  await waitText(page, 'dj-now', /^Synthetic 174 BPM \(synthetic-174-b\)$/, 40000);
  report.checks.push(`Next moves 174-c -> 174-b (not catalogue order) on bar ${exitBar} of the outgoing song; recipe and tempo change shown`);
  // Rate the LAST COMPLETED handover (same code path as the phone): the panel names which one, and re-rating replaces it.
  await waitText(page, 'set-rate-which', /last handover that finished: .* \(.*, plan tp-[0-9a-f]{8}\)/, 60000);
  await page.locator('#set-rate-tags [data-tag="great-blend"]').click();
  await page.locator('#set-rate-note').fill('smooth enough');
  await page.locator('#set-why [data-rate="like"]').click();
  await waitText(page, 'set-why-rating', /Rated "like": .*plan tp-[0-9a-f]{8}\)\. Saved in this browser only/, 5000);
  await waitText(page, 'set-rate-which', /Current rating: Like \(this browser only\)/, 5000);
  const cache = async () => JSON.parse(await page.evaluate(() => localStorage.getItem('eutonos-music.transition-feedback.v1') ?? '{}')) as {entries: {rating: string; tags: string[]; note: string; device: string; plan: {id: string}}[]};
  const stored = await cache();
  assert.equal(stored.entries.length, 1);
  assert.deepEqual([stored.entries[0]!.rating, stored.entries[0]!.tags, stored.entries[0]!.note, stored.entries[0]!.device], ['like', ['great-blend'], 'smooth enough', 'pc']);
  await page.locator('#set-why [data-rate="dislike"]').click();
  await waitText(page, 'set-why-rating', /Rated "dislike": /, 5000);
  assert.deepEqual((await cache()).entries.map(e => [e.rating, e.plan.id]), [['dislike', stored.entries[0]!.plan.id]], 're-rating the same plan replaces the rating');
  report.checks.push('Studio rating applies to the last completed handover (named in the panel), keeps tags and note, and a re-rating replaces the earlier one');

  // One Auto step: anchored to where 174-b came in, 16 bars later.
  await page.selectOption('#set-auto-bars', '16');
  await page.locator('#set-auto').click();
  assert.equal(await page.locator('#set-auto').getAttribute('aria-pressed'), 'true');
  await waitText(page, 'set-mix', /Planned: .*\(Auto every 16 bars\)/, 30000);
  const auto = await text(page, 'set-mix');
  report.plans.push(auto);
  const autoBar = Number(/bar (\d+) of the outgoing/.exec(auto)![1]);
  await waitText(page, 'set-why-mode', /^explore \(seed 7\) · plan tp-/, 10000);
  report.checks.push('Seeded explore (seed 7) labels the next plan record as explore with its seed');
  assert.ok(autoBar >= 14 && autoBar <= 17 + entryBars + 1, `Auto leaves 16 bars after entry (about ${entryBars} bars into B) or the last full bar before the end (bar ${autoBar})`);
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
    {id: 'long-122', bpm: 122, seconds: 180, stereo: true, transitionEvidence: true, gain: 0.5},
    {id: 'long-128', bpm: 128, seconds: 181, stereo: true, transitionEvidence: true, gain: 0.2},
  ], 48000);
  await context.route(origin + '/s19-synthetic/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/s19-synthetic/', '');
    if (!/^(?:pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path)) return route.fulfill({status: 404});
    try { return await route.fulfill({body: await readFile(join(longSet!.out, ...path.split('/')))}); }
    catch { return route.fulfill({status: 404}); }
  });
  const nativeJoins = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {loadBrowserPack, decodeRecording} = await load('/dist/src/browser-pack.js') as typeof import('../src/browser-pack.js');
    const {MixAnalysisCache, browserMixPreparation, chooseSetTransition, renderSetBlend} = await load('/dist/src/mix-transition.js') as typeof import('../src/mix-transition.js');
    const {RecordedSource, WebAudioClock} = await load('/dist/src/web-audio.js') as typeof import('../src/web-audio.js');
    const loaded = await loadBrowserPack(new URL('/s19-synthetic/pack/manifest.json', location.href), false, fetch,
      {set: true, allowUnreviewed: true});
    const rate = 48000, decoder = new OfflineAudioContext(2, 1, rate);
    const recordings = await Promise.all(loaded.pack.assets.map(a => decodeRecording(loaded, decoder, a)));
    const [from, to] = recordings, cache = new MixAnalysisCache();
    const [a, b] = await Promise.all(recordings.map(r => cache.analyze(r, browserMixPreparation)));
    if (!a!.ok || !b!.ok) throw new Error('Actual song worker analysis unavailable.');
    const results = [];
    for (const recipe of ['blend', 'filter-sweep', 'loudness-match'] as const) {
    // S21 phrase overlaps and the smoothstep return place the native join later: render 50 s.
    const offline = new OfflineAudioContext(2, rate * 50, rate);
    const choice = chooseSetTransition({from: {asset: from!.asset, analysis: a!.analysis, frames: from!.buffer.length},
      to: {asset: to!.asset, analysis: b!.analysis, frames: to!.buffer.length, channels: 2},
      sampleRate: rate, earliestFrame: 3 * rate, boundary: {bars: 4, anchorBar: 0}, options: {recipe}});
    if (choice.kind !== 'analyzed' || choice.plan.recipe !== recipe) throw new Error('Actual song workers did not select ' + recipe + ': ' + JSON.stringify(choice));
    let preparedSamples = 0;
    const runtime = {...browserMixPreparation, render: async (...args: Parameters<typeof browserMixPreparation.render>) => {
      preparedSamples = args[0].channels[0]!.length * args[0].channels.length;
      return browserMixPreparation.render(...args);
    }};
    const ready = await renderSetBlend(offline, to!, choice.plan, b!.analysis, undefined, runtime);
    const gain = ready.plan.levelMatch?.toGain ?? 1;
    const source = new RecordedSource(offline, ready.incoming, offline.destination, {allowUnreviewed: true, levelGain: gain});
    const clock = new WebAudioClock(offline); await source.prepare(clock);
    const start = 4800, outgoing = new RecordedSource(offline, from!, offline.destination, {allowUnreviewed: true});
    await outgoing.prepare(clock);
    outgoing.scheduleStart({at: clock.stamp(start), entryCueId: from!.asset.cues.find(c => c.kind === 'entry')!.id});
    const at = start + choice.plan.fromExitFrame;
    source.scheduleMixStart(clock.stamp(at), ready.entryFrame, ready.plan.automation.incoming);
    outgoing.transitionMixOut(clock.stamp(at), choice.plan.fromExitFrame, ready.plan.automation.outgoing);
    const joinAt = at + ready.nativeJoin.outputFrame - ready.entryFrame;
    const output = await offline.startRendering();
    let seamError = 0, nativeError = 0, mixedSamplePeak = 0;
    for (let c = 0; c < 2; c++) {
      const actual = output.getChannelData(c), native = to!.buffer.getChannelData(c);
      seamError = Math.max(seamError, Math.abs(actual[joinAt - 1]! - native[ready.nativeJoin.sourceFrame - 1]! * gain));
      for (let i = 0; i < 2048; i++) nativeError = Math.max(nativeError, Math.abs(actual[joinAt + i]! - native[ready.nativeJoin.sourceFrame + i]! * gain));
      for (let i = at; i < joinAt + 2048; i++) mixedSamplePeak = Math.max(mixedSamplePeak, Math.abs(actual[i]!));
    }
    source.release(); outgoing.release();
    results.push({recipe: choice.plan.recipe, preparedSamples, originalSamples: to!.buffer.length * 2, joinAt,
      nativeFrame: ready.nativeJoin.sourceFrame, measuredJoin: b!.analysis.structure.downbeatFrames.includes(ready.nativeJoin.sourceFrame),
      seamError, nativeError, mixedSamplePeak, gain, residualLu: ready.plan.levelMatch?.matchedDeltaLu,
      levelChannels: [a!.analysis.level?.channels, b!.analysis.level?.channels],
      analyzedFrames: [a!.analysis.analyzedWindow!.frames, b!.analysis.analyzedWindow!.frames]});
    }
    return results;
  });
  for (const nativeJoin of nativeJoins) {
  assert.equal(nativeJoin.measuredJoin, true);
  // S21: longer phrase overlaps lengthen the entry render; the 12M-sample budget is unchanged (bounded to 30 s stereo here).
  assert.ok(nativeJoin.preparedSamples < 12_000_000 / 4 && nativeJoin.preparedSamples < 30 * 48000 * 2, JSON.stringify(nativeJoin));
  assert.ok(nativeJoin.analyzedFrames.every(n => n <= 60 * 48000));
  assert.ok(nativeJoin.seamError < 1e-5 && nativeJoin.nativeError < 1e-5, JSON.stringify(nativeJoin));
  assert.deepEqual(nativeJoin.levelChannels, [2, 2]);
  if (nativeJoin.recipe === 'loudness-match') assert.ok(nativeJoin.mixedSamplePeak <= 10 ** (-1 / 20) + 1e-5);
  report.plans.push(JSON.stringify(nativeJoin));
  report.checks.push(`180s -> 181s stereo 48k 122 -> 128 actual-worker ${nativeJoin.recipe}: bounded PCM, exact gained native predecessor/continuation`);
  }
  servedSet = longSet;
  await page.reload();
  await waitText(page, 'global-status', /Rated set.*loaded · 2 songs/);
  await page.selectOption('#mix-recipe', 'filter-sweep');
  await page.locator('#dj-play').click();
  await waitText(page, 'dj-now', /long-122/);
  await page.locator('#dj-next').click();
  await waitText(page, 'set-mix', /Planned: Filter sweep/, 60000);
  const selectedFilter = await text(page, 'set-mix');
  await page.selectOption('#mix-recipe', 'loudness-match');
  assert.equal(await text(page, 'set-mix'), selectedFilter, 'selector changes future requests only');
  await page.locator('#dj-cancel').click();
  await waitText(page, 'dj-next-title', /^Nothing scheduled$/);
  await page.locator('#dj-next').click();
  await waitText(page, 'set-mix', /Planned: Loudness match.*B level.*measured windows/, 60000);
  report.plans.push(await text(page, 'set-mix'));
  await page.locator('#dj-stop').click();
  await waitText(page, 'dj-now', /^Nothing$/);
  report.checks.push('Studio selected filter and loudness recipes use real workers; changing selection preserves scheduled effect, cancel permits the next recipe, level readout labels measured windows');
  motionSet = await buildSyntheticSet([...([120, 144, 90, 128].map(bpm => ({id: `motion-${bpm}`, bpm,
    tonic: bpm === 144 ? 0 : 9, bars: 20, transitionEvidence: true, gain: 0.5}))),
    {id: 'motion-144b', bpm: 144, tonic: 0, bars: 20, transitionEvidence: true, gain: 0.5}]);
  await context.route(origin + '/s19-motion/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/s19-motion/', '');
    if (!/^(?:pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path)) return route.fulfill({status: 404});
    try { return await route.fulfill({body: await readFile(join(motionSet!.out, ...path.split('/')))}); }
    catch { return route.fulfill({status: 404}); }
  });
  const motion = await page.evaluate(async ids => {
    const load = (path: string) => import(path);
    const {loadBrowserPack, decodeRecording} = await load('/dist/src/browser-pack.js') as typeof import('../src/browser-pack.js');
    const {MixAnalysisCache, browserMixPreparation, chooseSetTransition, renderSetBlend, renderPlannedMix, prepareOutgoingLoop} = await load('/dist/src/mix-transition.js') as typeof import('../src/mix-transition.js');
    const {RecordedSource, WebAudioClock} = await load('/dist/src/web-audio.js') as typeof import('../src/web-audio.js');
    const {nativeRateInputAt, nativeRateOutputAt} = await load('/dist/src/time-pitch.js') as typeof import('../src/time-pitch.js');
    const loaded = await loadBrowserPack(new URL('/s19-motion/pack/manifest.json', location.href), false, fetch, {set: true, allowUnreviewed: true});
    const rate = 16000, decoder = new OfflineAudioContext(1, 1, rate), cache = new MixAnalysisCache();
    const recordings = await Promise.all(loaded.pack.assets.map(a => decodeRecording(loaded, decoder, a)));
    const analyses = await Promise.all(recordings.map(r => cache.analyze(r, browserMixPreparation)));
    const rows = [];
    let rampPlan: import('../src/mix-planner.js').AutomaticMixPlan | undefined;
    for (const recipe of ['tempo-ramp', 'brake', 'loop-extend'] as const) {
      const ai = recordings.findIndex(r => r.asset.id === ids[recipe === 'brake' ? 2 : 0]);
      const bi = recordings.findIndex(r => r.asset.id === ids[recipe === 'tempo-ramp' ? 1 : 3]);
      const from = recordings[ai]!, to = recordings[bi]!, a = analyses[ai]!, b = analyses[bi]!;
      if (!a.ok || !b.ok) throw new Error('Actual motion analysis worker unavailable.');
      const choice = chooseSetTransition({from: {asset: from.asset, analysis: a.analysis, frames: from.buffer.length},
        to: {asset: to.asset, analysis: b.analysis, frames: to.buffer.length, channels: 1}, sampleRate: rate,
        earliestFrame: 4 * rate, boundary: {bars: 4, anchorBar: 0}, options: {recipe}});
      if (choice.kind !== 'analyzed' || choice.plan.recipe !== recipe) throw new Error('Actual motion selection failed: ' + JSON.stringify(choice));
      const plan = choice.plan, offline = new OfflineAudioContext(1, rate * 70, rate), clock = new WebAudioClock(offline);
      if (recipe === 'tempo-ramp') rampPlan = plan;
      const ready = recipe === 'loop-extend' ? await renderSetBlend(offline, to, plan, b.analysis, undefined, browserMixPreparation) :
        await renderPlannedMix(offline, from, to, plan, {from: a.analysis, to: b.analysis}, undefined, browserMixPreparation);
      const loopBuffer = await prepareOutgoingLoop(offline, from, plan, 1, undefined, browserMixPreparation);
      const outgoing = new RecordedSource(offline, from, offline.destination, {allowUnreviewed: true});
      const incoming = new RecordedSource(offline, ready.incoming, offline.destination, {allowUnreviewed: true});
      await outgoing.prepare(clock); await incoming.prepare(clock);
      const start = 1600, effect = start + plan.fromExitFrame, entry = effect + (plan.entryDelayFrames ?? 0);
      outgoing.scheduleStart({at: clock.stamp(start), entryCueId: from.asset.cues.find(c => c.kind === 'entry')!.id});
      incoming.scheduleMixStart(clock.stamp(entry), ready.entryFrame, plan.automation.incoming);
      outgoing.transitionMixOut(clock.stamp(effect), plan.fromExitFrame, plan.automation.outgoing,
        {...(plan.nativeRate ? {rate: plan.nativeRate.outgoing} : {}), ...(loopBuffer ? {loopBuffer} : {})});
      const endFrame = incoming.endFrame, rendered = await offline.startRendering(), samples = rendered.getChannelData(0);
      let finite = true, peak = 0; for (const x of samples) { finite &&= Number.isFinite(x); peak = Math.max(peak, Math.abs(x)); }
      let rateOffset: number | null = null, rateRmsError: number | null = null, eofError: number | null = null;
      if (plan.nativeRate?.incoming) {
        const ramp = plan.nativeRate.incoming, probe = entry + ramp.frames + 1024;
        const native = to.buffer.getChannelData(0), nominal = plan.toEntryFrame + nativeRateInputAt(ramp, probe - entry);
        const errorAt = (shift: number): number => {
          let total = 0; for (let i = 0; i < 4096; i++) {
            const at = nominal + shift + i, left = Math.floor(at), t = at - left;
            const expected = native[left]! * (1 - t) + native[left + 1]! * t;
            total += (samples[probe + i]! - expected) ** 2;
          } return Math.sqrt(total / 4096);
        };
        let best = Infinity, shift = 0;
        for (let x = -256; x <= 256; x++) { const error = errorAt(x); if (error < best) { best = error; shift = x; } }
        const center = shift;
        for (let x = center - 1; x <= center + 1; x += 0.02) { const error = errorAt(x); if (error < best) { best = error; shift = x; } }
        rateOffset = shift; rateRmsError = best;
        const nominalEnd = entry + Math.round(nativeRateOutputAt(ramp, to.buffer.length - plan.toEntryFrame));
        let last = entry; for (let i = entry; i < nominalEnd + 512; i++) if (Math.abs(samples[i]!) > 1e-7) last = i;
        eofError = last + 1 - nominalEnd;
        if (last >= endFrame) throw new Error('Native EOF was outside its guarded lifecycle.');
      }
      const loopSeam = plan.loopExtension ? Math.abs(loopBuffer!.getChannelData(0)[0]! - from.buffer.getChannelData(0)[plan.fromExitFrame]!) : null;
      incoming.release(); outgoing.release();
      rows.push({recipe, finite, peak, addedFrames: entry - effect, loopSamples: loopBuffer?.length ?? 0, loopSeam,
        rateOffset, rateRmsError, eofError, nativeRateMap: plan.nativeRate ? 'analytic nominal; browser k-rate measured separately' : null});
    }
    // Suspend the owner audio clock after a real native ramp, then schedule a loop Next on
    // that same source. The duplicate generated 144 BPM take is a distinct playlist asset.
    const ai = recordings.findIndex(r => r.asset.id === ids[1]), bi = recordings.findIndex(r => r.asset.id === ids[4]);
    const from = recordings[ai]!, to = recordings[bi]!, a = analyses[ai]!, b = analyses[bi]!;
    if (!a.ok || !b.ok) throw new Error('Native loop continuation analysis unavailable.');
    const offline = new OfflineAudioContext(1, rate * 70, rate), clock = new WebAudioClock(offline), start = 1600;
    const first = new RecordedSource(offline, {...from, nativeRate: rampPlan!.nativeRate!.incoming!}, offline.destination, {allowUnreviewed: true});
    await first.prepare(clock); first.scheduleMixStart(clock.stamp(start), rampPlan!.toEntryFrame, rampPlan!.automation.incoming);
    const suspended = offline.suspend((start + rampPlan!.overlapFrames + 512) / rate), rendering = offline.startRendering();
    await suspended; if (!first.settleMixEntry()) throw new Error('Native rate entry did not settle.');
    const next = chooseSetTransition({from: {asset: from.asset, analysis: a.analysis, frames: from.buffer.length},
      to: {asset: to.asset, analysis: b.analysis, frames: to.buffer.length, channels: 1}, sampleRate: rate,
      earliestFrame: first.nativeFrameAtClock(clock.currentFrame + 2 * rate), boundary: {bars: 4, anchorBar: 0}, options: {recipe: 'loop-extend'}});
    if (next.kind !== 'analyzed' || next.plan.recipe !== 'loop-extend') throw new Error('Native-ramped loop Next failed: ' + JSON.stringify(next));
    const plan = next.plan, loopBuffer = await prepareOutgoingLoop(offline, first.nativeRecording, plan, 1, undefined, browserMixPreparation);
    const ready = await renderSetBlend(offline, to, plan, b.analysis, undefined, browserMixPreparation);
    const second = new RecordedSource(offline, ready.incoming, offline.destination, {allowUnreviewed: true}); await second.prepare(clock);
    const effect = first.clockFrameAtNative(plan.fromExitFrame), entry = effect + plan.entryDelayFrames!;
    second.scheduleMixStart(clock.stamp(entry), ready.entryFrame, plan.automation.incoming);
    first.transitionMixOut(clock.stamp(effect), plan.fromExitFrame, plan.automation.outgoing, {loopBuffer: loopBuffer!});
    await offline.resume(); const output = (await rendering).getChannelData(0), fade = Math.round(rate * 0.02);
    const baseline = Array.from({length: rate / 2}, (_, i) => Math.abs(output[effect - i - 1]! - output[effect - i - 2]!)).sort((x, y) => x - y);
    let maxJump = 0, renderedPeak = 0;
    for (const value of output) renderedPeak = Math.max(renderedPeak, Math.abs(value));
    for (let i = effect; i < effect + fade * 2; i++) maxJump = Math.max(maxJump, Math.abs(output[i]! - output[i - 1]!));
    const jumpRatio = maxJump / baseline[Math.floor(baseline.length * 0.999)]!;
    first.release(); second.release();
    rows.push({recipe: 'native-rate-to-loop', finite: output.every(Number.isFinite), peak: renderedPeak, addedFrames: plan.entryDelayFrames!,
      loopSamples: loopBuffer!.length, loopSeam: null, rateOffset: null, rateRmsError: null, eofError: null, nativeRateMap: '20ms complementary splice', jumpRatio});
    return rows;
  }, [...[120, 144, 90, 128].map(bpm => motionSet!.idFor(`motion-${bpm}`)), motionSet.idFor('motion-144b')]);
  for (const row of motion) {
    assert.equal(row.finite, true); assert.ok(row.peak < 1);
    if (row.recipe === 'tempo-ramp') { assert.ok(Math.abs(row.rateOffset!) <= 256 && row.rateRmsError! < 0.005 && Math.abs(row.eofError!) <= 256, JSON.stringify(row)); }
    if (row.recipe === 'loop-extend') { assert.equal(row.addedFrames, 8 * 16000); assert.equal(row.loopSeam, 0); assert.ok(row.loopSamples < 12_000_000); }
    if (row.recipe === 'native-rate-to-loop') assert.ok(row.jumpRatio! < 4, JSON.stringify(row));
    report.plans.push(JSON.stringify(row)); report.checks.push(`actual-worker ${row.recipe} renders native browser PCM with bounded motion/loop evidence`);
  }
  servedSet = motionSet;
  const motionTitle = (bpm: number) => `Synthetic ${bpm} BPM (motion-${bpm})`;
  const moveMotion = async (bpm: number): Promise<void> => {
    for (let guard = 0; guard < 8; guard++) {
      const queued = await queueTitles(page), index = queued.indexOf(motionTitle(bpm));
      assert.ok(index >= 0, `${bpm} queued`); if (index === 0) return;
      await page.getByRole('button', {name: `Move ${motionTitle(bpm)} up`}).click();
      await page.waitForFunction(([want, before]) => Array.from(document.querySelectorAll('#dj-queue li span:first-child'))
        .findIndex(n => n.textContent?.includes(want!)) === Number(before) - 1, [motionTitle(bpm), String(index)]);
    }
  };
  await page.reload(); await waitText(page, 'global-status', /Rated set.*loaded · 5 songs/);
  await moveMotion(120); await page.locator('#dj-play').click(); await waitText(page, 'dj-now', /motion-120/);
  await moveMotion(144); await page.selectOption('#mix-recipe', 'tempo-ramp'); await page.locator('#dj-next').click();
  await waitText(page, 'set-mix', /Planned: Tempo ramp \(pitch moves\)/, 60000);
  report.plans.push(await text(page, 'set-mix'));
  await waitText(page, 'dj-now', /^Synthetic 144 BPM \(motion-144\)$/, 40000);
  await page.getByRole('button', {name: `Add ${motionTitle(120)} to the queue`}).click(); await moveMotion(120);
  await page.locator('#dj-next').click(); await waitText(page, 'set-mix', /Planned: Tempo ramp \(pitch moves\).*tempo change -16\.7%/, 60000);
  report.plans.push(await text(page, 'set-mix')); await page.locator('#dj-stop').click(); await waitText(page, 'dj-now', /^Nothing$/);
  report.checks.push('Studio actual-worker tempo ramp reaches native B, then Next plans from B with its integrated mapping');
  for (const recipe of ['loop-extend', 'brake'] as const) {
    await page.reload(); await waitText(page, 'global-status', /Rated set.*loaded · 5 songs/);
    await moveMotion(recipe === 'brake' ? 90 : 120); await page.locator('#dj-play').click();
    await waitText(page, 'dj-now', recipe === 'brake' ? /motion-90/ : /motion-120/);
    await moveMotion(128); await page.selectOption('#mix-recipe', recipe); await page.locator('#dj-next').click();
    await waitText(page, 'set-mix', recipe === 'brake' ? /Planned: Brake \(pitch drops\).*A slows before B enters.*A effect starts/ : /Planned: Loop extension.*adds 4 repeated A bars before B enters.*A effect starts/, 60000);
    report.plans.push(await text(page, 'set-mix'));
    await page.locator('#dj-cancel').click(); await waitText(page, 'dj-next-title', /^Nothing scheduled$/);
    await page.locator('#dj-stop').click(); await waitText(page, 'dj-now', /^Nothing$/);
    report.checks.push(`Studio selected ${recipe} prepares actual workers and distinguishes A prelude from delayed B entry; Cancel/Stop release it`);
  }
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
  await motionSet?.cleanup();
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
}
