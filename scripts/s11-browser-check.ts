/**
 * Additive S11 native browser gate. Run after npm run build:
 * node dist/scripts/s11-browser-check.js
 * It uses an isolated browser, ephemeral loopback port, and exact test-only module routes.
 * No S09 server/UI changes, live AudioContext, FL operation or speaker output.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser} from 'playwright';
import {createDemoServer} from './serve.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const extraModules = new Map(['library-codec', 'library', 'recipe-library', 'library-indexeddb']
  .map(name => ['/dist/src/' + name + '.js', new URL('../src/' + name + '.js', import.meta.url)]));
const baseline = createDemoServer(root);
const server = createServer((request, response) => {
  const path = (request.url ?? '').split('?')[0]!, module = extraModules.get(path);
  if (path !== '/s11-checks' && !module) { baseline.emit('request', request, response); return; }
  if (!/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(request.headers.host ?? '') ||
    (request.method !== 'GET' && request.method !== 'HEAD')) {
    response.writeHead(400); response.end(); return;
  }
  const send = (body: string, type: string) => {
    response.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    response.end(request.method === 'HEAD' ? undefined : body);
  };
  if (!module) { send('<!doctype html><title>S11 isolated checks</title>', 'text/html'); return; }
  void readFile(module, 'utf8').then(body => send(body, 'text/javascript')).catch(() => {
    response.writeHead(500); response.end('Test module unavailable');
  });
});
const output = new URL('../../artifacts/s11-browser/', import.meta.url);
await mkdir(output, {recursive: true});
const report: {platform: string; node: string; source: string; dirty: boolean; browser?: string;
  groups: string[]; native?: unknown; error?: string} = {
  platform: process.platform, node: process.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim().length !== 0,
  groups: [],
};
let browser: Browser | undefined;
const errors: string[] = [];
try {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({headless: true});
  report.browser = browser.version();
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + address.port + '/s11-checks');
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {IndexedDbLibraryStorage} = await load('/dist/src/library-indexeddb.js') as typeof import('../src/library-indexeddb.js');
    const {MusicLibrary} = await load('/dist/src/library.js') as typeof import('../src/library.js');
    const {captureRecipeReplay, createRecipeStudyPack} = await load('/dist/src/recipe-library.js') as typeof import('../src/recipe-library.js');
    const {S01_RECIPE, S11_RECIPE_FAMILIES} = await load('/dist/src/phrase-plan.js') as typeof import('../src/phrase-plan.js');
    const {loadBrowserPack} = await load('/dist/src/browser-pack.js') as typeof import('../src/browser-pack.js');
    const loaded = await loadBrowserPack(new URL('/fixtures/s01/manifest.json', location.href), true);
    const pack = createRecipeStudyPack(loaded.pack, {id: 's11-browser-studies', revision: 1}, S01_RECIPE);
    const replay = await captureRecipeReplay(pack, {recipe: S11_RECIPE_FAMILIES[0], seed: 42, state: 'explore', allowFixtures: true});
    const adapter = await IndexedDbLibraryStorage.open('s11-reopen'), library = new MusicLibrary(adapter);
    let state = await library.registerPack(pack, 0);
    state = await library.saveVibe({id: 'saved', label: 'Saved study', replay}, state.revision);
    await library.setPreferences({volume: 0.25, muted: true}, state.revision);
    adapter.close();
  });
  await page.reload();
  await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {IndexedDbLibraryStorage} = await load('/dist/src/library-indexeddb.js') as typeof import('../src/library-indexeddb.js');
    const {MusicLibrary} = await load('/dist/src/library.js') as typeof import('../src/library.js');
    const adapter = await IndexedDbLibraryStorage.open('s11-reopen'), library = new MusicLibrary(adapter);
    const actualAudioContext = globalThis.AudioContext;
    Object.defineProperty(globalThis, 'AudioContext', {configurable: true,
      value: class { constructor() { throw new Error('restore attempted live audio'); } }});
    try {
      const restored = await library.restore('saved');
      if (restored.transport !== 'stopped' || !restored.requires_explicit_play ||
        restored.preferences.volume !== 0.25 || !restored.preferences.muted || restored.vibe.replay.seed !== 42) {
        throw new Error('reload did not retain a stopped exact selection');
      }
    } finally {
      Object.defineProperty(globalThis, 'AudioContext', {configurable: true, value: actualAudioContext});
      adapter.close();
    }
  });
  report.groups.push('IndexedDB save, real page reload, stopped restore without live audio');

  const cas = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {IndexedDbLibraryStorage} = await load('/dist/src/library-indexeddb.js') as typeof import('../src/library-indexeddb.js');
    const {canonicalJson} = await load('/dist/src/library-codec.js') as typeof import('../src/library-codec.js');
    const {emptyLibrary} = await load('/dist/src/library.js') as typeof import('../src/library.js');
    const a = await IndexedDbLibraryStorage.open('s11-cas'), b = await IndexedDbLibraryStorage.open('s11-cas');
    try {
      return await Promise.all([
        a.compareAndSwap(null, canonicalJson({...emptyLibrary(), revision: 1})),
        b.compareAndSwap(null, canonicalJson({...emptyLibrary(), revision: 2})),
      ]);
    } finally { a.close(); b.close(); }
  });
  assert.equal(cas.filter(Boolean).length, 1);
  report.groups.push('IndexedDB concurrent connections admit exactly one CAS writer');

  const corrupt = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {IndexedDbLibraryStorage} = await load('/dist/src/library-indexeddb.js') as typeof import('../src/library-indexeddb.js');
    const {MusicLibrary, emptyLibrary} = await load('/dist/src/library.js') as typeof import('../src/library.js');
    const results: string[] = [];
    for (const [index, value] of [undefined, 7, '{', JSON.stringify({...emptyLibrary(), schema_version: 'future'})].entries()) {
      const name = 's11-corrupt-' + index, adapter = await IndexedDbLibraryStorage.open(name);
      adapter.close();
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('snapshots', 'readwrite');
        transaction.objectStore('snapshots').put(value, 'current');
        transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
      });
      const reader = await IndexedDbLibraryStorage.open(name), library = new MusicLibrary(reader);
      let refused = 0;
      try { await library.read(); } catch { refused++; }
      try { await library.setPreferences({volume: 0.5, muted: false}, 0); } catch { refused++; }
      if (index < 2) {
        try { await reader.compareAndSwap(null, JSON.stringify(emptyLibrary())); } catch { refused++; }
      }
      const preserved = await new Promise<boolean>((resolve, reject) => {
        const transaction = database.transaction('snapshots', 'readonly');
        const request = transaction.objectStore('snapshots').openCursor('current');
        request.onsuccess = () => resolve(request.result !== null && Object.is(request.result.value, value));
        request.onerror = () => reject(request.error);
      });
      reader.close(); database.close();
      if (!preserved || refused !== (index < 2 ? 3 : 2)) throw new Error('corrupt existing record was overwritten');
      results.push(index === 0 ? 'present undefined retained' : 'corrupt value ' + index + ' retained');
    }
    return results;
  });
  assert.equal(corrupt.length, 4);
  report.groups.push('IndexedDB preserves malformed, future and present-undefined records');

  report.native = await page.evaluate(async () => {
    const load = (path: string) => import(path);
    const {loadBrowserPack} = await load('/dist/src/browser-pack.js') as typeof import('../src/browser-pack.js');
    const {createRecipeStudyPack} = await load('/dist/src/recipe-library.js') as typeof import('../src/recipe-library.js');
    const {S01_RECIPE, S11_RECIPE_FAMILIES, compilePhrase} = await load('/dist/src/phrase-plan.js') as typeof import('../src/phrase-plan.js');
    const {decodeProceduralSamples, ProceduralSource} = await load('/dist/src/procedural-source.js') as typeof import('../src/procedural-source.js');
    const {WebAudioClock} = await load('/dist/src/web-audio.js') as typeof import('../src/web-audio.js');
    const loaded = await loadBrowserPack(new URL('/fixtures/s01/manifest.json', location.href), true);
    const pack = createRecipeStudyPack(loaded.pack, {id: 's11-browser-studies', revision: 1}, S01_RECIPE);
    const bound = {...loaded, pack};
    const results: {recipe: string; rate: number; state: string; seed: number; frames: number; peak: number; differingBits: number}[] = [];
    for (const recipe of S11_RECIPE_FAMILIES) for (const rate of [44100, 48000]) {
      for (const state of ['explore', 'drive'] as const) for (const seed of [0, 104729]) {
        const render = async () => {
          const context = new OfflineAudioContext(1, rate * 16, rate), clock = new WebAudioClock(context);
          const plan = compilePhrase(pack, {recipe, seed, state, allowFixtures: true});
          const samples = await decodeProceduralSamples(bound, context, plan);
          const source = new ProceduralSource(context, plan, samples, context.destination, {allowFixtures: true});
          await source.prepare(clock);
          source.scheduleStart({at: clock.stamp(0), entryCueId: 'entry'});
          if (source.resourceUsage.allocatedNoteNodes > 256 || source.resourceUsage.maximumVoices !== 4) {
            throw new Error('native source exceeded bounds');
          }
          const audio = await context.startRendering();
          source.release();
          if (source.resourceUsage.liveNoteNodes || source.resourceUsage.liveMixBuses) throw new Error('native resources retained');
          return new Float32Array(audio.getChannelData(0));
        };
        const first = await render(), second = await render();
        const bitsA = new Uint32Array(first.buffer), bitsB = new Uint32Array(second.buffer);
        let peak = 0, differingBits = 0;
        for (let i = 0; i < first.length; i++) {
          if (!Number.isFinite(first[i]!)) throw new Error('non-finite output');
          peak = Math.max(peak, Math.abs(first[i]!));
          if (bitsA[i] !== bitsB[i]) differingBits++;
        }
        if (differingBits || peak <= 0 || peak >= 1) throw new Error('native replay, silence or headroom check failed');
        results.push({recipe: recipe.id, rate, state, seed, frames: first.length, peak, differingBits});
      }
    }
    return results;
  });
  report.groups.push('24 native recipe/state/seed/rate cases, paired bitwise replay, headroom and resource release');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
