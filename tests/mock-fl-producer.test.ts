import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readPcm16Wav} from '../src/audio.js';
import type {LoadedBrowserPack} from '../src/browser-pack.js';
import {importDelivery, type ImportReceipt} from '../src/importer.js';
import {loadPack} from '../src/node.js';
import {compilePhrase, compileS01Phrase, maxRoleFrames} from '../src/phrase-plan.js';
import {decodeProceduralSamples, ProceduralSource} from '../src/procedural-source.js';
import {WebAudioClock} from '../src/web-audio.js';
import {generateMockPack, MOCK_RATE, MOCK_TAIL_FRAMES, produceMockDelivery} from '../scripts/mock-fl-producer.js';
import {ContextDouble} from './audio-double.js';

/** Pinned bytes: the synthesizer uses only + - * / and rounding, so every OS should match. */
const MOCK_MANIFEST_SHA256 = '792961c013c131cf81b8b55a9b97d16decd3edb4fa4b31a0acbde26b5c688d91';
const s01 = JSON.parse(await readFile(new URL('../../fixtures/s01/manifest.json', import.meta.url), 'utf8'));
const MOCK_RECIPE = {id: 's06-mock-recipe', revision: 1};

test('mock FL producer -> S08 MCP broker -> delivery -> importer -> loader -> unchanged generator (no FL Studio)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'em-s06-'));
  try {
    const delivery = await produceMockDelivery(join(root, 'delivery')) as {producer: {kind: string}; assets: {expected_sha256: string}[]};
    assert.equal(delivery.producer.kind, 'mock-fl-studio-mcp');
    assert.ok(delivery.assets.every(a => /^[a-f0-9]{64}$/.test(a.expected_sha256)), 'every render carries the fl_verify_export hash');
    assert.match(await readFile(join(root, 'delivery', 'PROVENANCE.md'), 'utf8'), /MOCK\. No FL Studio ran/);
    const {pack, receipt} = await importDelivery(join(root, 'delivery'), join(root, 'pack'));
    assert.equal(receipt.manifest_sha256, MOCK_MANIFEST_SHA256, 'the mock producer and importer are byte-reproducible');
    assert.equal(receipt.producer.verified, false);
    assert.ok(receipt.assets.every(a => a.producer_sha256 === a.source_sha256), 'the importer checked every producer receipt');
    assert.deepEqual(receipt.generator.checks.map(c => c.result), ['compatible', 'compatible']);
    assert.equal(receipt.browser_player.result, 'loadable', 'the current browser player accepts the imported pack');

    const loaded = await loadPack(join(root, 'pack'));
    for (const a of loaded.audio) assert.deepEqual([a.sample_rate, a.channels], [MOCK_RATE, 2], 'FL CLI defaults: stereo 44.1 kHz');
    for (const id of ['s06-mock-recording-a', 's06-mock-recording-b']) {
      const bytes = new Uint8Array(await readFile(join(root, 'pack', 'audio', `${id}.wav`))), info = readPcm16Wav(bytes);
      const tail = new Int16Array(bytes.slice(info.data_offset + (info.frames - MOCK_TAIL_FRAMES) * 4).buffer);
      assert.ok(tail.every(s => s === 0), `${id}: every note fades out by its end, so the render tail is silent`);
    }
    for (const member of pack.palettes[0]!.samples) {
      const asset = pack.assets.find(a => a.id === member.asset.id)!;
      assert.ok(asset.file.frames <= maxRoleFrames(member.role as 'drum', asset.file.sample_rate));
      assert.ok(receipt.assets.find(a => a.id === asset.id)!.keep_frames! < receipt.assets.find(a => a.id === asset.id)!.source_frames);
    }

    const files = new Map(await Promise.all(pack.assets.map(async a =>
      [a.file.path, new Uint8Array(await readFile(join(root, 'pack', ...a.file.path.split('/'))))] as const)));
    const browser: LoadedBrowserPack = {pack, files, allowFixtures: true};
    for (const state of ['explore', 'drive'] as const) for (const seed of [0, 1, 0xdeadbeef]) {
      const plan = compilePhrase(pack, {recipe: MOCK_RECIPE, seed, state, allowFixtures: true});
      const base = compileS01Phrase(s01, {seed, state, allowFixtures: true});
      const rename = new Map(base.samples.map(s => [s.asset.id, plan.samples.find(p => p.role === s.role)!.asset.id]));
      assert.deepEqual(plan.events, base.events.map(e => ({...e, sample: {...e.sample, id: rename.get(e.sample.id)!}})),
        'the same performer events, whoever produced the palette');
      for (const rate of [44100, 48000]) {
        const context = new ContextDouble(rate), clock = new WebAudioClock(context.audio);
        const samples = await decodeProceduralSamples(browser, context.audio, plan);
        assert.ok(samples.every(s => s.buffer.numberOfChannels === 2));
        const source = new ProceduralSource(context.audio, plan, samples, context.destination, {allowFixtures: true});
        await source.prepare(clock);
        source.scheduleStart({at: clock.stamp(rate), entryCueId: 'entry'});
        assert.equal(context.sources.length, plan.events.length);
        source.release();
      }
    }
    await assert.rejects(decodeProceduralSamples({...browser, allowFixtures: false}, new ContextDouble().audio,
      compilePhrase(pack, {recipe: MOCK_RECIPE, seed: 0, state: 'explore', allowFixtures: true})), /fixture|eligible|permission/i);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('a render changed after fl_verify_export is refused at import', async () => {
  const root = await mkdtemp(join(tmpdir(), 'em-s06-'));
  try {
    await produceMockDelivery(join(root, 'delivery'), {tamper: (id, wav) => {
      if (id !== 's06-mock-recording-b') return wav;
      const copy = new Uint8Array(wav); copy[50_000] = copy[50_000]! ^ 1; return copy;
    }});
    await assert.rejects(importDelivery(join(root, 'delivery'), join(root, 'pack')), /HASH_MISMATCH at delivery\.assets\[1\]\.source/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('the generator command replaces only a folder it made', async () => {
  const root = await mkdtemp(join(tmpdir(), 'em-s06-'));
  try {
    const foreign = join(root, 'foreign');
    await mkdir(foreign); await writeFile(join(foreign, 'keep.txt'), 'not ours');
    await assert.rejects(generateMockPack(foreign), /was not made by this script/);
    assert.equal(await readFile(join(foreign, 'keep.txt'), 'utf8'), 'not ours');
    const out = join(root, 'mine');
    const first = await generateMockPack(out);
    await writeFile(join(first, 'stale.txt'), 'old');
    const second = await generateMockPack(out);
    assert.equal(second, first);
    await assert.rejects(readFile(join(second, 'stale.txt')), /ENOENT/);
    const receipt: ImportReceipt = JSON.parse(await readFile(join(second, 'IMPORT.json'), 'utf8'));
    assert.equal(receipt.manifest_sha256, MOCK_MANIFEST_SHA256);
  } finally { await rm(root, {recursive: true, force: true}); }
});
