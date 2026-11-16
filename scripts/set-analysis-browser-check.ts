/**
 * S20 set-analysis browser gate. Synthetic fixtures and isolated Chromium storage only.
 * Run after build: node dist/scripts/set-analysis-browser-check.js
 * Browser/worker/storage evidence does not establish device playback or listening.
 */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser} from 'playwright';
import {createDemoServer} from './serve.js';
import {buildSyntheticSet} from '../tests/helpers/synthetic-set.js';
import type {AudioAsset} from '../src/pack-types.js';
import type {MixAnalysis} from '../src/mix-analysis.js';
import type {StoredAnalysis} from '../web/analysis-storage.js';
import type {WaveformWorkerRequest, WaveformWorkerResponse} from '../web/set-waveform.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'artifacts', 'set-analysis-browser');
await mkdir(output, {recursive: true});
const report = {
  platform: process.platform, node: process.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  browser: '', checks: [] as string[], metrics: [] as unknown[], error: '',
};
const set = await buildSyntheticSet([
  {id: 'analysis-174-a', bpm: 174, bars: 20, tonic: 9, mode: 'minor', stereo: true},
  {id: 'analysis-168-b', bpm: 168, bars: 20, tonic: 9, mode: 'minor', stereo: true},
]);
const manifest = JSON.parse(await readFile(set.manifest, 'utf8')) as {assets: AudioAsset[]};
const server = createDemoServer(root);
let browser: Browser | undefined;
const errors: string[] = [];
try {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port;
  browser = await chromium.launch({headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
  report.browser = browser.version();
  const context = await browser.newContext({viewport: {width: 1360, height: 1000}});
  context.setDefaultTimeout(30000);
  await context.route('http://127.0.0.1:7870/**', route => route.abort('connectionrefused'));
  const fetched: string[] = [];
  await context.route(origin + '/local/s16-rated/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/local/s16-rated/', '');
    if (!/^(?:catalog\.json|pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav))$/.test(path)) {
      return route.fulfill({status: 404});
    }
    fetched.push(path);
    try { return await route.fulfill({body: await readFile(join(set.out, ...path.split('/')))}); }
    catch { return route.fulfill({status: 404}); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/studio.html?pack=set');
  await page.waitForFunction(() => document.getElementById('global-status')?.textContent?.includes('loaded · 2 songs'));
  assert.equal(fetched.filter(path => path.endsWith('.wav')).length, 0);
  await page.locator('#deck-a-low').focus(); await page.keyboard.press('ArrowLeft');
  for (const asset of manifest.assets) {
    await page.getByRole('button', {name: 'Analyze ' + asset.title, exact: true}).click();
    await page.waitForFunction(title => {
      const row = Array.from(document.querySelectorAll('#set-songs .set-song-row'))
        .find(node => node.querySelector('.song-title')?.textContent === title);
      return row?.querySelector('.song-analysis')?.textContent?.includes('BPM measured estimate') &&
        row.querySelector('.song-actions button')?.textContent === 'Analyzed';
    }, asset.title);
  }
  assert.equal(await page.locator('#dj-now').innerText(), 'Nothing', 'Analyze must not start playback');
  assert.match(await page.locator('#deck-a-low').getAttribute('aria-valuetext') ?? '', /You/);
  const labels = await page.locator('#set-songs .song-analysis').allTextContents();
  assert.equal(labels.length, 2);
  for (const label of labels) assert.match(label, /BPM measured estimate · .+ key estimate/);
  const canvases = await page.locator('#set-songs .song-wave').evaluateAll(nodes =>
    nodes.map(node => (node as HTMLCanvasElement).toDataURL()));
  // Observe committed rows, not just a finished UI promise. This read never creates a schema.
  await page.waitForFunction(async hashes => {
    return new Promise<boolean>(resolve => {
      const opening = indexedDB.open('eutonos-set-analysis-v1');
      opening.onupgradeneeded = () => opening.transaction?.abort();
      opening.onerror = opening.onblocked = () => resolve(false);
      opening.onsuccess = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains('analyses')) { db.close(); resolve(false); return; }
        const transaction = db.transaction('analyses', 'readonly'), request = transaction.objectStore('analyses').getAll();
        let matched = false;
        request.onsuccess = () => {
          try {
            const rows = request.result as StoredAnalysis[];
            matched = hashes.every(hash => rows.some(row => {
              if (!row.key.startsWith(hash + ':')) return false;
              const body = JSON.parse(row.payload);
              return body.analysis?.tempo?.bpm !== null && body.waveform?.peaks?.length === 512;
            }));
          } catch { matched = false; }
        };
        transaction.oncomplete = () => { db.close(); resolve(matched); };
        transaction.onerror = transaction.onabort = () => { db.close(); resolve(false); };
      };
    });
  }, manifest.assets.map(asset => asset.file.sha256));
  report.checks.push('Studio Analyze saves measured BPM/key and full-song waveforms without playing or releasing manual EQ');

  const reloadStart = fetched.length;
  await page.reload();
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('#set-songs .set-song-row'));
    return rows.length === 2 && rows.every(row => row.querySelector('.song-actions button')?.textContent === 'Analyzed');
  });
  assert.deepEqual(await page.locator('#set-songs .song-analysis').allTextContents(), labels);
  assert.deepEqual(await page.locator('#set-songs .song-wave').evaluateAll(nodes =>
    nodes.map(node => (node as HTMLCanvasElement).toDataURL())), canvases);
  assert.equal(fetched.slice(reloadStart).filter(path => path.endsWith('.wav')).length, 0,
    'saved metadata and waveforms must restore without fetching native songs');
  report.metrics.push({savedLabels: labels, reloadWavRequests: 0});
  report.checks.push('page reload restores identical measured labels and waveform pixels from actual IndexedDB with zero WAV requests');
  await page.screenshot({path: join(output, 'studio-analysis-desktop.png'), fullPage: true});

  const cacheMetrics = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {loadBrowserPack, decodeRecording} = await load('/dist/src/browser-pack.js') as typeof import('../src/browser-pack.js');
    const {MixAnalysisCache, browserMixPreparation, chooseSetTransition} =
      await load('/dist/src/mix-transition.js') as typeof import('../src/mix-transition.js');
    const {PersistentSetAnalysisCache, decodeAnalysis} =
      await load('/dist/web/set-analysis-cache.js') as typeof import('../web/set-analysis-cache.js');
    const {IndexedDbAnalysisStorage} =
      await load('/dist/web/analysis-storage.js') as typeof import('../web/analysis-storage.js');
    function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
    const loaded = await loadBrowserPack(new URL('/local/s16-rated/pack/manifest.json', location.href), false, fetch,
      {set: true, allowUnreviewed: true});
    const storage = new IndexedDbAnalysisStorage(), firstAsset = loaded.pack.assets[0]!;
    // Read the two fixture rows to discover the Studio's actual output rate.
    const saved = await new Promise<StoredAnalysis | undefined>((resolve, reject) => {
      const opening = indexedDB.open('eutonos-set-analysis-v1');
      opening.onerror = () => reject(new Error('Could not reopen saved Studio analysis.'));
      opening.onsuccess = () => {
        const db = opening.result, transaction = db.transaction('analyses', 'readonly');
        const request = transaction.objectStore('analyses').getAll();
        let row: StoredAnalysis | undefined;
        request.onsuccess = () => { row = (request.result as StoredAnalysis[])
          .find(candidate => candidate.key.startsWith(firstAsset.file.sha256 + ':')); };
        transaction.oncomplete = () => { db.close(); resolve(row); };
        transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error('Could not read saved Studio analysis.')); };
      };
    });
    check(saved, 'Studio saved no analysis for its first synthetic song.');
    const rate = (JSON.parse(saved.payload) as {sampleRate: number}).sampleRate;
    const decoder = new OfflineAudioContext(2, 1, rate);
    const recordings = await Promise.all(loaded.pack.assets.map(asset => decodeRecording(loaded, decoder, asset)));
    check(recordings.length === 2, 'Expected exactly two synthetic songs.');
    const original = await Promise.all(recordings.map(async recording => {
      const row = await storage.read(MixAnalysisCache.key(recording.asset, rate));
      return decodeAnalysis(row, recording.asset, {sampleRate: rate, frames: recording.buffer.length,
        channels: recording.buffer.numberOfChannels}, 0);
    }));
    let computeCalls = 0, waveCalls = 0;
    const forbidden = async (): Promise<never> => { computeCalls++; throw new Error('Unexpected canonical recomputation.'); };
    const runtime = {...browserMixPreparation, analyze: forbidden, analyzeOne: forbidden, scanPeak: forbidden};
    const cache = new PersistentSetAnalysisCache(storage, async () => {
      waveCalls++; throw new Error('Unexpected waveform recomputation.');
    });
    const reused = await Promise.all(recordings.map(recording => cache.analyze(recording, runtime)));
    await cache.flush();
    const analysis = reused.map(result => {
      if (!result.ok) throw new Error('Saved planner analysis was not reusable: ' + result.reason);
      return result.analysis;
    });
    check(computeCalls === 0 && waveCalls === 0, 'A fresh persistent cache did work for valid saved results.');
    for (let i = 0; i < recordings.length; i++) {
      check(JSON.stringify(analysis[i]) === JSON.stringify(original[i]!.analysis), 'Cached full-song coordinates changed.');
      const view = cache.presentation(recordings[i]!.asset, rate);
      check(view.source === 'saved' && Object.isFrozen(view.waveform) && Object.isFrozen(view.waveform?.peaks),
        'Restored display data must be saved and immutable.');
    }
    const choose = (a: MixAnalysis, b: MixAnalysis) => chooseSetTransition({
      from: {asset: recordings[0]!.asset, analysis: a, frames: recordings[0]!.buffer.length},
      to: {asset: recordings[1]!.asset, analysis: b, frames: recordings[1]!.buffer.length,
        channels: recordings[1]!.buffer.numberOfChannels},
      sampleRate: rate, earliestFrame: 2 * rate, boundary: {bars: 4, anchorBar: 0}, options: {},
    });
    const planned = choose(analysis[0]!, analysis[1]!);
    check(planned.kind !== 'unavailable', 'Saved fixture analysis did not provide a transition.');
    check(JSON.stringify(planned) === JSON.stringify(choose(original[0]!.analysis, original[1]!.analysis)),
      'Restored analysis changed the unchanged planner result.');

    // Miss probes deliberately stop at canonical computation. They cannot rewrite a good row.
    const a = recordings[0]!, changedHash = (a.asset.file.sha256[0] === '0' ? '1' : '0') + a.asset.file.sha256.slice(1);
    const changedRate = rate === 32000 ? 48000 : 32000;
    const resampled = await decodeRecording(loaded, new OfflineAudioContext(2, 1, changedRate), a.asset);
    const probes = [
      {name: 'hash', recording: {...a, asset: {...a.asset, file: {...a.asset.file, sha256: changedHash}}}, start: 0},
      {name: 'rate', recording: resampled, start: 0},
      {name: 'window', recording: a, start: Math.min(a.buffer.length - 1, rate * 4)},
      {name: 'requested BPM', recording: {...a, asset: {...a.asset,
        timing: {...a.asset.timing!, bpm: a.asset.timing!.bpm + 1}}}, start: 0},
    ];
    const invalidations: string[] = [];
    for (const probe of probes) {
      let entered = 0;
      const miss = new PersistentSetAnalysisCache(storage, async () => { throw new Error('Miss probe needs no waveform.'); });
      const result = await miss.analyze(probe.recording, {...browserMixPreparation,
        analyzeOne: async () => { entered++; throw new Error('Expected canonical cache miss.'); }}, undefined, probe.start);
      await miss.flush();
      check(entered === 1 && !result.ok && result.reason.includes('Expected canonical cache miss'),
        probe.name + ' reused incompatible saved analysis.');
      invalidations.push(probe.name);
    }

    // Recompute the checksum so schema validation, rather than checksum rejection, must catch it.
    const key = MixAnalysisCache.key(a.asset, rate), good = await storage.read(key) as StoredAnalysis;
    const malformed = JSON.parse(good.payload);
    check(malformed.analysis.beatGrid.frames.length > 0, 'Fixture has no measured beat frames.');
    malformed.analysis.beatGrid.frames[0] = String(malformed.analysis.beatGrid.frames[0]);
    const payload = JSON.stringify(malformed);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))),
      value => value.toString(16).padStart(2, '0')).join('');
    await storage.write({...good, payload, digest, usedAt: Date.now()});
    let canonicalCalls = 0;
    const recoveredCache = new PersistentSetAnalysisCache(storage);
    const recovered = await recoveredCache.analyze(a, {...browserMixPreparation,
      analyzeOne: async (...args: Parameters<NonNullable<typeof browserMixPreparation.analyzeOne>>) => {
        canonicalCalls++; return browserMixPreparation.analyzeOne!(...args);
      }});
    await recoveredCache.flush();
    check(recovered.ok, 'Canonical fallback after malformed persistence was unavailable.');
    check(canonicalCalls === 1 && recoveredCache.presentation(a.asset, rate).source === 'session',
      'A rechecksummed string coordinate was accepted as planner evidence.');
    check(JSON.stringify(recovered.analysis) === JSON.stringify(original[0]!.analysis),
      'Canonical fallback changed the fixture analysis.');
    const repaired = await decodeAnalysis(await storage.read(key), a.asset,
      {sampleRate: rate, frames: a.buffer.length, channels: a.buffer.numberOfChannels}, 0);
    check(repaired.analysis.beatGrid.frames.every(frame => typeof frame === 'number'),
      'Canonical fallback did not replace the malformed record.');
    return {rate, freshCacheComputations: computeCalls, freshCacheWaveforms: waveCalls,
      plannedKind: planned.kind, invalidations, canonicalFallbackComputations: canonicalCalls};
  });
  report.metrics.push(cacheMetrics);
  report.checks.push('fresh cache reuses exact full-song analysis and the unchanged planner result with zero analysis/waveform computation');
  report.checks.push('hash, decoded rate, window start and requested-BPM changes miss; rechecksummed malformed coordinates trigger real canonical fallback and repair');

  const workerMetrics = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {summarizeWaveform, WAVEFORM_BINS, WAVEFORM_CHUNK_SAMPLES, WAVEFORM_WORKER_PROTOCOL} =
      await load('/dist/web/set-waveform.js') as typeof import('../web/set-waveform.js');
    function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
    const frames = WAVEFORM_CHUNK_SAMPLES + 73, rate = 48000;
    const buffer = new AudioBuffer({length: frames, numberOfChannels: 2, sampleRate: rate});
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    for (let i = 0; i < frames; i++) { left[i] = (i % 37 - 18) / 64; right[i] = -left[i]!; }
    left[524287] = 1.25; right[524288] = -2; right[frames - 1] = -3;
    const expected = Array.from({length: WAVEFORM_BINS}, (_, bin) => {
      let peak = 0;
      for (let frame = Math.floor(bin * frames / WAVEFORM_BINS);
        frame < Math.floor((bin + 1) * frames / WAVEFORM_BINS); frame++) {
        peak = Math.max(peak, Math.abs(left[frame]!), Math.abs(right[frame]!));
      }
      return peak;
    });
    const sum = (data: Float32Array): number => { let total = 0; for (const value of data) total += value; return total; };
    const before = [sum(left), sum(right)];
    const NativeWorker = Worker, chunks: {start: number; frames: number; samples: number}[] = [];
    let created = 0, terminated = 0, pending = 0, maxPending = 0;
    class ObservedWorker extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options); created++;
        this.addEventListener('message', (event: MessageEvent<WaveformWorkerResponse>) => {
          if (event.data?.protocol === WAVEFORM_WORKER_PROTOCOL && event.data.ok && event.data.kind === 'chunk') pending--;
        });
      }
      override postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []): void {
        const job = message as WaveformWorkerRequest;
        if (job.protocol === WAVEFORM_WORKER_PROTOCOL && job.kind === 'chunk') {
          pending++; maxPending = Math.max(maxPending, pending);
          chunks.push({start: job.startFrame, frames: job.channels[0]!.length,
            samples: job.channels.reduce((count, channel) => count + channel.length, 0)});
        }
        if (Array.isArray(transfer)) super.postMessage(message, transfer);
        else super.postMessage(message, transfer);
      }
      override terminate(): void { terminated++; super.terminate(); }
    }
    globalThis.Worker = ObservedWorker;
    try {
      const result = await summarizeWaveform(buffer);
      check(result.peaks.length === 512 && result.peaks.every((peak, i) => peak === expected[i]),
        'Real worker maxima differ at a bin, channel or final partial boundary.');
      check(result.peaks[511] === 3, 'The final native frame or raw amplitude was lost.');
      check(Object.isFrozen(result) && Object.isFrozen(result.peaks), 'Real worker result is mutable.');
      check(left.byteLength === frames * 4 && right.byteLength === frames * 4 &&
        sum(left) === before[0] && sum(right) === before[1], 'Worker detached or changed native PCM.');
      check(created === 1 && terminated === 1 && maxPending === 1 && pending === 0,
        'Worker count, sequencing or cleanup differs.');
      check(chunks.length === 3 && chunks.every(chunk => chunk.samples <= WAVEFORM_CHUNK_SAMPLES) &&
        chunks[0]!.start === 0 && chunks[1]!.start === 524288 && chunks[2]!.start === 1048576 &&
        chunks[2]!.frames === 73, 'Native PCM did not use the bounded sequential chunk protocol.');
      return {frames, channels: 2, bins: result.peaks.length, chunks, created, terminated, maxPending,
        finalPeak: result.peaks[511], nativeBytesPerChannel: left.byteLength};
    } finally { globalThis.Worker = NativeWorker; }
  });
  report.metrics.push(workerMetrics);
  report.checks.push('real waveform module worker preserves stereo anti-phase peaks, exact bins and final frame using three bounded sequential private chunks without detaching native PCM');

  const storageMetrics = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {IndexedDbAnalysisStorage, ANALYSIS_STORE_ENTRIES, ANALYSIS_STORE_BYTES, ANALYSIS_RECORD_BYTES} =
      await load('/dist/web/analysis-storage.js') as typeof import('../web/analysis-storage.js');
    function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
    const rows = (name: string): Promise<StoredAnalysis[]> => new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(new Error('Could not inspect the browser cache.'));
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction('analyses', 'readonly');
        const all = transaction.objectStore('analyses').getAll();
        let values: StoredAnalysis[] = [];
        all.onsuccess = () => { values = all.result as StoredAnalysis[]; };
        transaction.oncomplete = () => { db.close(); resolve(values); };
        transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error('Could not inspect cache rows.')); };
      };
    });
    const digest = async (payload: string): Promise<string> =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))),
        value => value.toString(16).padStart(2, '0')).join('');
    const lruName = 'eutonos-analysis-gate-lru', lru = new IndexedDbAnalysisStorage(indexedDB, lruName);
    const payload = '{"syntheticStorageProbe":true}', hash = await digest(payload);
    for (let i = 0; i < ANALYSIS_STORE_ENTRIES; i++) {
      await lru.write({key: 'entry-' + i.toString().padStart(3, '0'), identity: 'lru-probe',
        payload, digest: hash, usedAt: i + 1});
    }
    await lru.read('entry-000');
    await lru.write({key: 'entry-064', identity: 'lru-probe', payload, digest: hash, usedAt: Date.now() + 1});
    const retained = await rows(lruName);
    check(retained.length === ANALYSIS_STORE_ENTRIES && retained.some(row => row.key === 'entry-000') &&
      retained.some(row => row.key === 'entry-064') && !retained.some(row => row.key === 'entry-001'),
    'Actual IndexedDB did not retain the recently read row and evict the oldest.');
    const stale: StoredAnalysis = {key: 'repair-probe', identity: 'corrupt-identity', payload, digest: hash, usedAt: Date.now() + 2};
    await lru.write(stale);
    const repaired = {...stale, identity: 'repaired-identity', usedAt: Date.now() + 3};
    await lru.write(repaired);
    await lru.remove(stale.key, stale);
    check((await lru.read(stale.key) as StoredAnalysis | undefined)?.identity === 'repaired-identity',
      'A stale delete erased a repaired envelope with identical payload/digest.');
    await lru.remove(repaired.key, {...repaired, usedAt: 0});
    check(await lru.read(repaired.key) === undefined, 'LRU touches incorrectly blocked a matching conditional removal.');

    const byteName = 'eutonos-analysis-gate-bytes', bytes = new IndexedDbAnalysisStorage(indexedDB, byteName);
    const large = 'x'.repeat(600_000), largeDigest = await digest(large);
    for (let i = 0; i < 20; i++) {
      await bytes.write({key: 'large-' + i.toString().padStart(2, '0'), identity: 'byte-probe',
        payload: large, digest: largeDigest, usedAt: i + 1});
    }
    const boundedRows = await rows(byteName);
    const accountedBytes = boundedRows.reduce((total, row) => total + row.payload.length * 2 + 2048, 0);
    check(boundedRows.length < 20 && boundedRows.length <= ANALYSIS_STORE_ENTRIES && accountedBytes <= ANALYSIS_STORE_BYTES,
      'Actual IndexedDB exceeded its accounted byte or entry budget.');
    check(boundedRows.some(row => row.key === 'large-19') && !boundedRows.some(row => row.key === 'large-00'),
      'Byte eviction did not retain the newest record.');
    let oversizedRejected = false;
    try { await bytes.write({key: 'oversized', identity: 'byte-probe', payload: 'x'.repeat(ANALYSIS_RECORD_BYTES + 1),
      digest: hash, usedAt: 100}); } catch { oversizedRejected = true; }
    check(oversizedRejected && await bytes.read('oversized') === undefined, 'An oversized record reached IndexedDB.');
    return {entryLimit: ANALYSIS_STORE_ENTRIES, retainedLruRows: retained.length,
      byteLimit: ANALYSIS_STORE_BYTES, accountedBytes, retainedLargeRows: boundedRows.length,
      staleDeletePreservedRepair: true, oversizedRejected};
  });
  report.metrics.push(storageMetrics);
  report.checks.push('actual IndexedDB enforces entry/LRU and byte budgets, rejects oversized records, and protects repaired envelopes from stale deletes');

  await page.setViewportSize({width: 390, height: 844});
  await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.equal(await page.locator('#set-songs .song-wave').count(), 2);
  assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('#set-songs .set-song-row')).every(row => {
    const bounds = row.getBoundingClientRect();
    return bounds.left >= 0 && bounds.right <= window.innerWidth;
  })), true);
  assert.deepEqual(await page.locator('#set-songs .song-analysis').allTextContents(), labels);
  await page.screenshot({path: join(output, 'studio-analysis-mobile.png'), fullPage: true});
  assert.deepEqual(errors, []);
  report.checks.push('390px Studio preserves readable measured metadata and waveform rows without horizontal overflow or uncaught browser errors');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  if (errors.length) report.error += '\nPage errors: ' + errors.join(' | ');
  console.error(report.error); process.exitCode = 1;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await set.cleanup();
}
