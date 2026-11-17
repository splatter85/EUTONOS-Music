/**
 * S20 live pre-check Chromium gate. Generated fixtures only; no listening claim.
 * Run after build: node dist/scripts/mix-precheck-browser-check.js
 * Musical scheduling remains the application's single AudioContext owner.
 */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type BrowserContext} from 'playwright';
import {createDemoServer} from './serve.js';
import {buildSyntheticSet} from '../tests/helpers/synthetic-set.js';
import type {AudioAsset} from '../src/pack-types.js';
import type {DecodedRecording} from '../src/web-audio.js';
import type {AutomaticMixPlan} from '../src/mix-planner.js';
import type {MixPcm} from '../src/mix-analysis.js';
import type {RouteFreePlan} from '../src/mix-transition.js';
import {SET_CANDIDATE_ATTEMPTS} from '../src/player.js';
import type {PrecheckRequest, PrecheckJob} from '../web/mix-precheck-data.js';
import type {TransitionEvaluation} from '../web/mix-evaluator.js';

interface StudioTrace {
  attempts: number; workers: number; terminated: number; contexts: number; starts: number;
  prematureStarts: number; results: TransitionEvaluation[];
}
type TraceWindow = typeof globalThis & {__mixGateTrace: StudioTrace};
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'artifacts', 'mix-precheck-browser');
await mkdir(output, {recursive: true});
const report = {
  platform: process.platform, node: process.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  browser: '', checks: [] as string[], metrics: [] as unknown[], error: '',
};
const set = await buildSyntheticSet([
  {id: 'precheck-174-a', bpm: 174, bars: 20, tonic: 9, mode: 'minor'},
  {id: 'precheck-168-b', bpm: 168, bars: 20, tonic: 9, mode: 'minor'},
]);
const mismatch = await buildSyntheticSet([
  {id: 'precheck-strong-174-a', bpm: 174, bars: 20, gain: 0.5},
  {id: 'precheck-quiet-168-b', bpm: 168, bars: 20, gain: 0.01},
]);
const manifest = JSON.parse(await readFile(set.manifest, 'utf8')) as {assets: AudioAsset[]};
const server = createDemoServer(root);
let browser: Browser | undefined;
const errors: string[] = [];
try {
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  report.browser = browser.version();
  async function isolated(fixture: typeof set): Promise<BrowserContext> {
    const context = await browser!.newContext({viewport: {width: 1360, height: 1000}});
    context.setDefaultTimeout(30000);
    await context.route('http://127.0.0.1:7870/**', route => route.abort('connectionrefused'));
    // Every owner-set URL is intercepted, including unknown paths. Nothing falls through.
    await context.route(url => /^\/local\/s16-rated(?:\/|$)/.test(url.pathname), async route => {
      const path = new URL(route.request().url()).pathname.replace('/local/s16-rated/', '');
      if (!/^(?:catalog\.json|pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path))
        return route.fulfill({status: 404});
      try { return await route.fulfill({body: await readFile(join(fixture.out, ...path.split('/')))}); }
      catch { return route.fulfill({status: 404}); }
    });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    return context;
  }

  const direct = await isolated(set), probe = await direct.newPage();
  // A real served module origin without starting the Studio's live playback owner.
  await probe.goto(origin + '/studio.html?pack=set');
  await probe.waitForFunction(() => document.getElementById('global-status')?.textContent?.includes('loaded · 2 songs'));
  const workerMetrics = await probe.evaluate(async assets => {
    const load = (path: string) => import(path);
    const {browserMixPrecheck} = await load('/dist/web/mix-precheck.js') as typeof import('../web/mix-precheck.js');
    const {makePrecheckWindow, PRECHECK_PROTOCOL, PRECHECK_LIMITS, precheckLabel} =
      await load('/dist/web/mix-precheck-data.js') as typeof import('../web/mix-precheck-data.js');
    const {evaluateTransition, planTransitionSpec, MIX_EVALUATION_THRESHOLDS} =
      await load('/dist/web/mix-evaluator.js') as typeof import('../web/mix-evaluator.js');
    const {crossfadeAutomation} = await load('/dist/src/mix-automation.js') as typeof import('../src/mix-automation.js');
    function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
    const pcm = (buffer: AudioBuffer): MixPcm => ({sampleRate: buffer.sampleRate,
      channels: Array.from({length: buffer.numberOfChannels}, (_, ch) => buffer.getChannelData(ch))});
    const tone = (rate: number, frames: number, channels: number, hz: number, gain = 0.08): AudioBuffer => {
      const buffer = new AudioBuffer({sampleRate: rate, length: frames, numberOfChannels: channels});
      for (let ch = 0; ch < channels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < frames; i++) data[i] = gain * Math.cos(2 * Math.PI * (hz + ch * 17) * i / rate);
      }
      return buffer;
    };
    const recording = (index: number, buffer: AudioBuffer): DecodedRecording => ({asset: {
      ...assets[index]!, file: {...assets[index]!.file, sample_rate: buffer.sampleRate,
        frames: buffer.length, channels: buffer.numberOfChannels as 1 | 2}}, buffer});
    function nativeRequest(rate: number, overlapSeconds: number, channels = 1, gain = 0.08): PrecheckRequest {
      const from = recording(0, tone(rate, rate * 32, channels, 220, gain));
      const to = recording(1, tone(rate, rate * 32, channels, 337, gain));
      const overlap = Math.round(rate * overlapSeconds);
      const plan: RouteFreePlan = {kind: 'route-free', recipe: 'fallback-crossfade', fromExitFrame: 12 * rate,
        toEntryFrame: 4 * rate, overlapFrames: overlap, preRollFrames: 0, bars: overlapSeconds / 2,
        fromBpm: 120, toBpm: 120, tempoChange: 1, fromGrid: 'requested', toGrid: 'requested',
        automation: crossfadeAutomation(overlap, rate), reason: 'Explicit generated browser-gate proposal.'};
      return {plan, from, to, incoming: to, entryFrame: plan.toEntryFrame,
        fromGain: 0.5, analysis: {from: null, to: null}};
    }
    const signature = (data: Float32Array): [number, number, number] => {
      let sum = 0, squares = 0; for (const value of data) {sum += value; squares += value * value;}
      return [data.byteLength, sum, squares];
    };

    // A full, uncropped canonical reference catches missing context or rebased-coordinate errors.
    const request = nativeRequest(48000, 8, 2), plan = request.plan as RouteFreePlan;
    const nativeViews = [...pcm(request.from.buffer).channels, ...pcm(request.to.buffer).channels] as Float32Array[];
    const before = nativeViews.map(signature), nativeBuffers = new Set(nativeViews.map(view => view.buffer));
    const canonical = evaluateTransition(pcm(request.from.buffer), pcm(request.to.buffer), {
      recipe: 'blend', fromStartFrame: plan.fromExitFrame, preRollFrames: 0, toEntryFrame: plan.toEntryFrame,
      tempoRatio: 1, automation: plan.automation, fixedGains: {from: request.fromGain, to: 1},
    });
    const NativeWorker = Worker;
    const chunks: {name: string; start: number; frames: number; samples: number}[] = [];
    let created = 0, terminated = 0, pending = 0, maxPending = 0, transferred = 0;
    let submitted: PrecheckJob | null = null;
    class ObservedWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); created++;
        this.addEventListener('message', (event: MessageEvent) => {
          if (event.data?.protocol === PRECHECK_PROTOCOL && event.data.ok && event.data.kind === 'chunk') pending--;
        });
      }
      override postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []): void {
        const data = message as {protocol?: string; kind?: string; job?: PrecheckJob; name?: string; start?: number; channels?: Float32Array[]};
        const chunk = data.protocol === PRECHECK_PROTOCOL && data.kind === 'chunk' ? data.channels! : null;
        if (data.kind === 'start') submitted = data.job!;
        if (chunk) {
          check(chunk.every(channel => !nativeBuffers.has(channel.buffer)), 'An active native buffer was submitted for transfer.');
          pending++; maxPending = Math.max(maxPending, pending);
          chunks.push({name: data.name!, start: data.start!, frames: chunk[0]!.length,
            samples: chunk.reduce((n, channel) => n + channel.length, 0)});
          check(Array.isArray(transfer) && transfer.length === chunk.length, 'PCM chunks must use private transferables.');
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer); else super.postMessage(message, transfer);
        if (chunk) {check(chunk.every(channel => channel.byteLength === 0), 'Private chunks were copied instead of transferred.'); transferred++;}
      }
      override terminate(): void {terminated++; super.terminate();}
    }
    globalThis.Worker = ObservedWorker;
    let observed;
    try {observed = await browserMixPrecheck(request);} finally {globalThis.Worker = NativeWorker;}
    check(observed.evaluation && JSON.stringify(observed.evaluation) === JSON.stringify(canonical),
      'Real worker/cropped-window measurements differ from the full canonical evaluator: ' + JSON.stringify({status: observed.status, reason: observed.reason, actual: observed.evaluation, canonical}));
    check(observed.evaluation.thresholds === 'mix-evaluation-thresholds@1' &&
      MIX_EVALUATION_THRESHOLDS.contextSeconds === 3, 'The live gate changed evaluator version/context.');
    check(JSON.stringify(nativeViews.map(signature)) === JSON.stringify(before), 'Real worker detached or changed native PCM.');
    check(created === 1 && terminated === 1 && maxPending === 1 && pending === 0 && transferred === chunks.length,
      'Worker ownership, private transfer sequencing or completion cleanup differs.');
    check(submitted !== null && chunks.length >= 4 && chunks.some(chunk => chunk.start > 0) &&
      chunks.every(chunk => chunk.samples <= PRECHECK_LIMITS.chunkSamples), 'The large stereo job did not cross bounded chunk boundaries.');
    for (const stream of (submitted as PrecheckJob).streams) {
      const sent = chunks.filter(chunk => chunk.name === stream.name); let position = 0;
      for (const chunk of sent) {check(chunk.start === position, 'A source stream contains a gap or duplicate chunk.'); position += chunk.frames;}
      check(position === stream.frames, 'A source stream was not copied in full.');
    }

    const small = nativeRequest(8000, 2), rate = small.from.buffer.sampleRate;
    const preparedPlan: AutomaticMixPlan = {
      kind: 'mix', version: 'automatic-mix@1', recipe: 'blend', sampleRate: rate,
      fromFrames: small.from.buffer.length, toFrames: small.to.buffer.length,
      fromExitFrame: 12 * rate, toEntryFrame: 4 * rate, preRollFrames: 0,
      overlapFrames: 2 * rate, overlapBeats: 4, fromBpm: 120, toBpm: 120 / 1.02,
      tempoRatio: 1.02, pitchSemitones: 0, returnToOriginalTempo: true, confidence: 0,
      evidence: {tempo: 0, beat: 0, key: 0, cue: 0, phrase: 0},
      harmonic: {fromCamelot: 'unknown', toCamelot: 'unknown', circleDistance: null, score: 0, relation: 'unknown'},
      automation: crossfadeAutomation(2 * rate, rate), reasons: ['Synthetic selected-plan/continuation fixture.'],
    };
    const joins = [];
    for (const seconds of [3.25, 7.25]) {
      const buffer = tone(rate, Math.round(seconds * rate), 1, 331, 0.06), entryFrame = rate / 4, sourceFrame = 6 * rate;
      const incoming: DecodedRecording = {...small.to, buffer,
        processed: {sourceFrames: small.to.buffer.length, outputFrames: buffer.length, algorithm: 'browser-gate-fixture@1'},
        continuation: {buffer: small.to.buffer, sourceFrame}};
      const checked: PrecheckRequest = {...small, plan: preparedPlan, incoming, entryFrame};
      const window = makePrecheckWindow(checked);
      const virtual = new Float32Array(buffer.length + small.to.buffer.length - sourceFrame);
      virtual.set(buffer.getChannelData(0)); virtual.set(small.to.buffer.getChannelData(0).subarray(sourceFrame), buffer.length);
      const expected = evaluateTransition(pcm(small.from.buffer), pcm(small.to.buffer),
        {...planTransitionSpec(preparedPlan), fixedGains: {from: small.fromGain, to: 1}}, undefined,
        {audio: {sampleRate: rate, channels: [virtual]}, entryFrame});
      const result = await browserMixPrecheck(checked);
      check(result.evaluation?.bSource === 'prepared' && JSON.stringify(result.evaluation) === JSON.stringify(expected),
        'Prepared/native concatenation differs from the full canonical reference: ' + JSON.stringify({status: result.status, reason: result.reason}));
      check(result.coverage?.nativeJoin === (seconds < 4 ? 'inside-window' : 'after-window'),
        'Native join coverage is mislabeled.');
      if (seconds < 4) {
        const join = buffer.length - entryFrame + window.job.preparedEntry!;
        const boundary = window.copy('prepared', join - 1, 2)[0]!;
        check(boundary[0] === buffer.getChannelData(0)[buffer.length - 1] &&
          boundary[1] === small.to.buffer.getChannelData(0)[sourceFrame], 'The actual native seam frame was skipped or duplicated.');
      } else check(precheckLabel(result).includes('later native join is outside this check'), 'The later join limitation is hidden.');
      joins.push({seconds, status: result.status, coverage: result.coverage});
    }

    const gapRequest = nativeRequest(8000, 1), gapPlan = gapRequest.plan as RouteFreePlan;
    const gap = await browserMixPrecheck({...gapRequest, plan: {...gapPlan, automation: {
      outgoing: {...gapPlan.automation.outgoing, gain: [{frame: 0, value: 1}, {frame: 800, value: 0}, {frame: 8000, value: 0}]},
      incoming: {...gapPlan.automation.incoming, gain: [{frame: 0, value: 0}, {frame: 6400, value: 0}, {frame: 8000, value: 1}]},
    }}});
    check(gap.status === 'fail' && gap.evaluation?.flags.some(flag => flag.metric === 'silenceGap' && flag.level === 'fail'),
      'The real worker did not refuse an introduced gap between active sources under the unchanged threshold.');
    globalThis.Worker = class {constructor() {throw new Error('Injected pre-check worker unavailable.');}} as unknown as typeof Worker;
    let unavailable;
    try {unavailable = await browserMixPrecheck(small);} finally {globalThis.Worker = NativeWorker;}
    check(unavailable.status === 'unavailable' && unavailable.evaluation === null && /worker unavailable/.test(unavailable.reason),
      'Worker creation failure was admitted or concealed.');
    const abort = new AbortController(); let abortCreated = 0, abortTerminated = 0, abortChunks = 0;
    class AbortWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {super(url, options); abortCreated++;}
      override postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []): void {
        if (Array.isArray(transfer)) super.postMessage(message, transfer); else super.postMessage(message, transfer);
        if ((message as {kind?: string}).kind === 'chunk') {abortChunks++; queueMicrotask(() => abort.abort());}
      }
      override terminate(): void {abortTerminated++; super.terminate();}
    }
    globalThis.Worker = AbortWorker; let aborted = false;
    try {await browserMixPrecheck(small, abort.signal);} catch (error) {aborted = error instanceof DOMException && error.name === 'AbortError';}
    finally {globalThis.Worker = NativeWorker;}
    check(aborted && abortCreated === 1 && abortTerminated === 1 && abortChunks === 1,
      'Cancellation after a real private transfer did not reject and terminate exactly one worker.');
    return {canonicalStatus: observed.status, source: observed.evaluation.bSource, chunks, created, terminated, maxPending,
      joins, gapStatus: gap.status, gapFlags: gap.evaluation!.flags,
      unavailable: unavailable.status, abortCreated, abortTerminated, abortChunks};
  }, manifest.assets);
  report.metrics.push(workerMetrics);
  console.log('Direct worker: native ' + workerMetrics.canonicalStatus.toUpperCase() + '; prepared joins ' +
    workerMetrics.joins.map(join => join.status.toUpperCase()).join('/') + '; introduced gap FAIL; unavailable refused; abort terminated.');
  report.checks.push('real Chromium module worker exactly matches the canonical full-window evaluator with unchanged thresholds');
  report.checks.push('large stereo input crosses bounded sequential private-transfer chunks; native PCM remains intact and the sole worker terminates');
  report.checks.push('prepared/native continuation seam matches canonical PCM; later native joins remain explicitly outside the fixed three-second coverage');
  report.checks.push('real introduced silence gap fails; worker creation failure stays unavailable; cancellation terminates after one real chunk');
  await direct.close();

  async function studioCase(fixture: typeof set, mode: 'observe' | 'unavailable', expectFail: boolean): Promise<void> {
    const context = await isolated(fixture);
    try {
      await context.addInitScript(({mode}) => {
        const trace: StudioTrace = {attempts: 0, workers: 0, terminated: 0, contexts: 0, starts: 0, prematureStarts: 0, results: []};
        (globalThis as TraceWindow).__mixGateTrace = trace;
        const NativeWorker = Worker;
        class StudioWorker extends NativeWorker {
          private readonly precheck: boolean;
          constructor(url: string | URL, options?: WorkerOptions) {
            const precheck = String(url).includes('/mix-precheck-worker.js');
            if (precheck) {
              trace.attempts++;
              if (mode === 'unavailable') throw new Error('Injected Studio pre-check worker unavailable.');
            }
            super(url, options); this.precheck = precheck;
            if (precheck) {
              trace.workers++;
              this.addEventListener('message', (event: MessageEvent) => {
                if (event.data?.protocol === 'live-mix-precheck@1' && event.data.ok && event.data.kind === 'complete')
                  trace.results.push(event.data.result as TransitionEvaluation);
              });
            }
          }
          override terminate(): void {if (this.precheck) trace.terminated++; super.terminate();}
        }
        globalThis.Worker = StudioWorker;
        const NativeAudioContext = AudioContext;
        class StudioAudioContext extends NativeAudioContext {
          constructor(options?: AudioContextOptions) {super(options); trace.contexts++;}
          override createBufferSource(): AudioBufferSourceNode {
            const node = super.createBufferSource(), start = node.start.bind(node);
            node.start = (...args: Parameters<AudioBufferSourceNode['start']>): void => {
              if (trace.attempts > trace.results.length) trace.prematureStarts++;
              trace.starts++; start(...args);
            };
            return node;
          }
        }
        globalThis.AudioContext = StudioAudioContext;
      }, {mode});
      const page = await context.newPage();
      await page.goto(origin + '/studio.html?pack=set');
      await page.waitForFunction(() => document.getElementById('global-status')?.textContent?.includes('loaded · 2 songs'));
      await page.locator('#set-next-bars').selectOption('8');
      await page.locator('#deck-a-low').focus(); await page.keyboard.press('ArrowLeft');
      await page.locator('#dj-play').click();
      await page.waitForFunction(() => document.getElementById('dj-now')?.textContent !== 'Nothing' &&
        document.getElementById('dj-queue')?.querySelectorAll('li:not(.empty)').length === 1);
      const before = {now: await page.locator('#dj-now').innerText(), queue: await page.locator('#dj-queue').innerText(),
        starts: await page.evaluate(() => (globalThis as TraceWindow).__mixGateTrace.starts)};
      await page.locator('#dj-next').click();
      await page.waitForFunction(() => {
        const text = document.getElementById('set-mix')?.textContent ?? '';
        return text.startsWith('Planned:') || text.startsWith('No handover:');
      }, undefined, {timeout: 40000});
      const detail = await page.locator('#set-mix').innerText();
      const trace = await page.evaluate(() => (globalThis as TraceWindow).__mixGateTrace);
      // S21: a FAIL excludes that candidate and checks the next, at most SET_CANDIDATE_ATTEMPTS per Next
      // (Part B: 10, for the longer tempo-agnostic chain). Part B (G11): an unavailable check tries one more
      // candidate, then stops. Each check is still one bounded worker.
      const maxAttempts = mode === 'unavailable' ? 2 : SET_CANDIDATE_ATTEMPTS;
      assert.ok(trace.attempts >= 1 && trace.attempts <= maxAttempts, 'A Studio Next checked ' + trace.attempts + ' candidates (bound ' + maxAttempts + ').');
      assert.equal(trace.contexts, 1, 'The gate must not create a second live audio owner.');
      assert.equal(trace.prematureStarts, 0, 'Incoming audio was scheduled before the check completed.');
      assert.match(await page.locator('#deck-a-low').getAttribute('aria-valuetext') ?? '', /You/);
      if (mode === 'unavailable') {
        assert.match(detail, /No handover:.*DJ plan check UNAVAILABLE.*worker unavailable/);
        assert.equal(trace.workers, 0); assert.equal(trace.results.length, 0);
      } else {
        assert.equal(trace.workers, trace.attempts); assert.equal(trace.terminated, trace.attempts);
        assert.equal(trace.results.length, trace.attempts);
        assert.ok(trace.results.slice(0, -1).every(r => r.verdict === 'fail'), 'Only a FAIL may move on to another candidate.');
        const first = trace.results[0]!, result = trace.results.at(-1)!;
        assert.ok(trace.results.every(r => r.thresholds === 'mix-evaluation-thresholds@1'));
        if (expectFail) {
          assert.equal(first.verdict, 'fail');
          assert.ok(first.flags.some(flag => flag.metric === 'loudness' && flag.level === 'fail'),
            'The level-mismatch fixture must expose a measured loudness failure.');
        }
        if (result.verdict === 'fail') assert.match(detail, /No handover:.*DJ plan check FAIL/);
        else {
          assert.match(detail, /^Planned:.*DJ plan check (PASS|WARN)/);
          assert.ok(trace.starts > before.starts, 'An admitted plan did not schedule its source.');
        }
      }
      if (mode === 'unavailable' || trace.results.at(-1)?.verdict === 'fail') {
        assert.equal(await page.locator('#dj-now').innerText(), before.now);
        assert.equal(await page.locator('#dj-queue').innerText(), before.queue);
        assert.equal(await page.locator('#dj-next-title').innerText(), 'Nothing scheduled');
        assert.equal(trace.starts, before.starts, 'A refused transition scheduled another source.');
      }
      report.metrics.push({studio: expectFail ? 'level-mismatch-fail' : mode, detail, trace});
      console.log('Studio ' + (expectFail ? 'level mismatch' : mode) + ': ' + detail +
        ' (' + trace.attempts + ' check(s); ' + trace.contexts + ' live owner; ' + trace.prematureStarts + ' premature starts).');
      if (expectFail) {
        await page.screenshot({path: join(output, 'studio-precheck-desktop.png'), fullPage: true});
        await page.setViewportSize({width: 390, height: 844});
        await page.screenshot({path: join(output, 'studio-precheck-mobile.png'), fullPage: true});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      await page.locator('#dj-stop').click();
      await page.waitForFunction(() => document.getElementById('dj-now')?.textContent === 'Nothing');
    } finally {await context.close();}
  }
  await studioCase(set, 'observe', false);
  report.checks.push('actual Studio Next runs one check and follows its frozen-threshold verdict while retaining manual ownership and one audio clock');
  await studioCase(mismatch, 'observe', true);
  report.checks.push('actual Studio level-mismatch FAIL leaves A, queue and source count unchanged; no alternative recipe or bypass starts');
  await studioCase(set, 'unavailable', false);
  assert.deepEqual(errors, []);
  report.checks.push('actual Studio unavailable worker refuses without another audio owner or queue change; 390px layout fits and pages have no script errors');
  console.log('Mix pre-check browser check passed (' + report.checks.length + ' checks, Chromium ' + report.browser + ').');
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(report.error); process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); await new Promise<void>(resolve => server.close(() => resolve()));
  await set.cleanup(); await mismatch.cleanup();
}
