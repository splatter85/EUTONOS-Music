import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readPcm16Wav} from '../src/audio.js';
import {importDelivery, MAX_DELIVERY_BYTES, MAX_DROPPED_TAIL_PEAK, type ImportReceipt} from '../src/importer.js';
import {loadPack} from '../src/node.js';
import {PackError} from '../src/pack.js';

const RATE = 8000;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Mono PCM16 WAV; an optional chunk before `data` stands in for producer metadata. */
function wav(samples: readonly number[], extra?: {tag: string; body: Uint8Array}): Uint8Array {
  const chunk = extra ? 8 + extra.body.length + (extra.body.length % 2) : 0;
  const data = samples.length * 2, out = new Uint8Array(44 + chunk + data), v = new DataView(out.buffer);
  const tag = (at: number, s: string) => out.set(new TextEncoder().encode(s), at);
  tag(0, 'RIFF'); v.setUint32(4, 36 + chunk + data, true); tag(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  let at = 36;
  if (extra) { tag(at, extra.tag); v.setUint32(at + 4, extra.body.length, true); out.set(extra.body, at + 8); at += chunk; }
  tag(at, 'data'); v.setUint32(at + 4, data, true);
  samples.forEach((s, i) => v.setInt16(at + 8 + i * 2, s, true));
  return out;
}
/** A decaying tone that reaches zero by `sounding`, then `silent` zero frames. */
const tone = (sounding: number, silent = 0, period = 40, peak = 6000) => [
  ...Array.from({length: sounding}, (_, i) => Math.round(peak * (1 - i / sounding) * (i % period < period / 2 ? 1 : -1))),
  ...Array<number>(silent).fill(0)];

const RIGHTS = {origin: 'Synthetic importer test material.', creator: 'EUTONOS Music tests', license: 'CC0-1.0',
  allowed_uses: ['playback', 'redistribution', 'sample-reuse'], evidence: 'PROVENANCE.md'};
const sample = (id: string, harmony: number[] | null, extra: Record<string, unknown> = {}) => ({
  id, revision: 1, title: `${id} one-shot`, source_kind: 'sample', source: `renders/${id}.wav`, rights: RIGHTS,
  eligibility: 'fixture-only', genres: ['synthetic-test'], states: ['explore', 'drive'], key: harmony ? 'A minor' : null,
  harmony_pitch_classes: harmony, timing: null, cues: [], ...extra});

function baseDelivery() {
  return {
    schema_version: 'em.producer-delivery.v0',
    producer: {id: 'hand-made', revision: 1, kind: 'manual', description: 'A delivery written by a test.'},
    pack: {id: 'imported', revision: 1},
    assets: [
      {id: 'take', revision: 1, title: 'Take', source_kind: 'recording', source: 'renders/take.wav', rights: RIGHTS,
        eligibility: 'fixture-only', genres: ['synthetic-test'], states: ['explore', 'drive'], key: 'A minor',
        harmony_pitch_classes: [0, 4, 9], timing: {bpm: 120, meter: [4, 4], bars: 4, phrase_bars: 4, first_downbeat_frame: 0},
        cues: [{id: 'entry', kind: 'entry', position_quarters: 0}, {id: 'end', kind: 'exit', position_quarters: 16}]},
      sample('kick', null), sample('hat', null), sample('bass', [9]), sample('chord', [0, 4, 9]),
    ] as Record<string, unknown>[],
    palettes: [{id: 'kit', revision: 1, samples: [
      {asset: {id: 'kick', revision: 1}, role: 'drum', root_midi: null}, {asset: {id: 'hat', revision: 1}, role: 'percussion', root_midi: null},
      {asset: {id: 'bass', revision: 1}, role: 'bass', root_midi: 45}, {asset: {id: 'chord', revision: 1}, role: 'harmony', root_midi: 57}]}],
    recipes: [{id: 'groove', revision: 1, palette: {id: 'kit', revision: 1}, bpm: 120, meter: [4, 4], phrase_bars: 4, key: 'A minor',
      harmony_pitch_classes: [0, 4, 9], genres: ['synthetic-test'], states: ['explore', 'drive']}],
    routes: [] as unknown[],
  };
}
type Delivery = ReturnType<typeof baseDelivery>;
const AUDIO: Record<string, number[]> = {
  take: tone(64000, 0, 80, 5000), kick: tone(1500), hat: tone(800, 0, 6), bass: tone(3000, 0, 80), chord: tone(6000, 0, 30),
};

async function fixture(change: (d: Delivery, audio: Record<string, Uint8Array>) => void = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'em-import-'));
  const delivery = join(root, 'delivery'), d = baseDelivery();
  const audio = Object.fromEntries(Object.entries(AUDIO).map(([id, s]) => [`renders/${id}.wav`, wav(s)]));
  change(d, audio);
  await mkdir(join(delivery, 'renders'), {recursive: true});
  for (const [path, bytes] of Object.entries(audio)) await writeFile(join(delivery, ...path.split('/')), bytes);
  await writeFile(join(delivery, 'PROVENANCE.md'), '# Test provenance\n\nSynthetic, CC0-1.0.\n');
  await writeFile(join(delivery, 'delivery.json'), JSON.stringify(d, null, 2));
  return {root, delivery, out: join(root, 'out', 'pack')};
}
async function refused(change: Parameters<typeof fixture>[0], code: string): Promise<void> {
  const {root, delivery, out} = await fixture(change);
  try {
    await assert.rejects(importDelivery(delivery, out), (error: unknown) => {
      assert.ok(error instanceof PackError, String(error));
      assert.equal(error.code, code, error.message);
      return true;
    });
    assert.equal(await stat(out).catch(() => null), null, 'a refused import leaves no pack');
    const parent = await readdir(join(root, 'out')).catch(() => [] as string[]);
    assert.deepEqual(parent.filter(name => name.startsWith('.import-')), [], 'and no scratch folder');
  } finally { await rm(root, {recursive: true, force: true}); }
}
const asset = (d: Delivery, id: string) => d.assets.find(a => a.id === id)!;

test('any producer delivery imports into a loader-valid pack with a deterministic manifest and receipt', async () => {
  const {root, delivery, out} = await fixture();
  try {
    const before = await readFile(join(delivery, 'delivery.json'));
    const {pack, receipt} = await importDelivery(delivery, out);
    const again = await importDelivery(delivery, join(root, 'again'));
    assert.deepEqual(await readFile(join(out, 'manifest.json')), await readFile(join(root, 'again', 'manifest.json')));
    assert.deepEqual(await readFile(join(out, 'IMPORT.json')), await readFile(join(root, 'again', 'IMPORT.json')));
    assert.deepEqual(again.receipt, receipt);
    assert.deepEqual(await readFile(join(delivery, 'delivery.json')), before, 'the delivery is never rewritten');
    const loaded = await loadPack(out);
    assert.equal(loaded.audio.length, 5);
    assert.deepEqual(pack.assets.map(a => a.file.path), ['take', 'kick', 'hat', 'bass', 'chord'].map(id => `audio/${id}.wav`));
    const written: ImportReceipt = JSON.parse(await readFile(join(out, 'IMPORT.json'), 'utf8'));
    assert.deepEqual(written, receipt);
    assert.equal(receipt.manifest_sha256, sha(await readFile(join(out, 'manifest.json'))));
    assert.deepEqual(receipt.producer, {id: 'hand-made', revision: 1, kind: 'manual', description: 'A delivery written by a test.', verified: false});
    assert.ok(receipt.limits.includes('Listening: NOT TESTED.'));
    assert.deepEqual(receipt.generator.checks.map(c => [c.recipe.id, c.state, c.result]), [['groove', 'explore', 'compatible'], ['groove', 'drive', 'compatible']]);
    for (const a of receipt.assets) {
      assert.equal(a.sha256, a.source_sha256, 'a canonical 44-byte source passes through byte-identical');
      assert.equal(a.producer_sha256, null);
    }
    assert.ok(!JSON.stringify(receipt).includes(root), 'the receipt holds no host paths');
    assert.deepEqual((await readdir(join(root, 'out'))).sort(), ['pack']);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('producer metadata chunks are dropped while PCM samples stay verbatim; producer receipts are checked', async () => {
  const secret = new TextEncoder().encode('INFOISFTC:/Users/someone/private/project.flp');
  let sourceHash = '';
  const {root, delivery, out} = await fixture((d, audio) => {
    audio['renders/take.wav'] = wav(AUDIO.take!, {tag: 'LIST', body: secret});
    sourceHash = sha(audio['renders/take.wav']);
    asset(d, 'take').expected_sha256 = sourceHash;
  });
  try {
    const {receipt} = await importDelivery(delivery, out);
    const bytes = new Uint8Array(await readFile(join(out, 'audio', 'take.wav')));
    const source = new Uint8Array(await readFile(join(delivery, 'renders', 'take.wav')));
    assert.ok(!Buffer.from(bytes).includes(Buffer.from('someone')), 'producer metadata never enters the pack');
    const a = readPcm16Wav(bytes), s = readPcm16Wav(source);
    assert.equal(a.data_offset, 44);
    assert.deepEqual(bytes.subarray(44), source.subarray(s.data_offset, s.data_offset + s.data_bytes));
    const report = receipt.assets.find(x => x.id === 'take')!;
    assert.equal(report.source_sha256, sourceHash);
    assert.equal(report.producer_sha256, sourceHash);
    assert.notEqual(report.sha256, sourceHash);
  } finally { await rm(root, {recursive: true, force: true}); }
  await refused(d => { asset(d, 'take').expected_sha256 = 'f'.repeat(64); }, 'HASH_MISMATCH');
  await refused(d => { asset(d, 'take').expected_sha256 = 'ABC'; }, 'INVALID_HASH');
});

test('keep_frames drops only a tail at or below -60 dBFS', async () => {
  const quiet = Math.floor(MAX_DROPPED_TAIL_PEAK * 32768);
  const {root, delivery, out} = await fixture((d, audio) => {
    audio['renders/kick.wav'] = wav([...tone(1500), ...Array<number>(500).fill(0), quiet, -quiet]);
    asset(d, 'kick').keep_frames = 1500;
  });
  try {
    const {receipt} = await importDelivery(delivery, out);
    const kick = receipt.assets.find(a => a.id === 'kick')!;
    assert.deepEqual([kick.source_frames, kick.keep_frames, kick.frames], [2002, 1500, 1500]);
    assert.equal(kick.dropped_tail_peak, quiet / 32768);
    assert.equal(readPcm16Wav(new Uint8Array(await readFile(join(out, 'audio', 'kick.wav')))).frames, 1500);
  } finally { await rm(root, {recursive: true, force: true}); }
  await refused((d, audio) => { audio['renders/kick.wav'] = wav([...tone(1500), ...Array<number>(500).fill(0), 40]); asset(d, 'kick').keep_frames = 1500; }, 'TAIL_NOT_SILENT');
  await refused(d => { asset(d, 'kick').keep_frames = 0; }, 'INVALID_DELIVERY');
  await refused(d => { asset(d, 'kick').keep_frames = 1501; }, 'INVALID_DELIVERY');
});

test('technical refusals: silence, full scale, review claims, measured and unknown fields, versions', async () => {
  await refused((_d, audio) => { audio['renders/hat.wav'] = wav(Array<number>(800).fill(0)); }, 'SILENT_AUDIO');
  await refused((_d, audio) => { audio['renders/hat.wav'] = wav([0, 32767, 0]); }, 'CLIPPED_AUDIO');
  await refused((_d, audio) => { audio['renders/hat.wav'] = wav([0, -32768, 0]); }, 'CLIPPED_AUDIO');
  await refused(d => { asset(d, 'take').eligibility = 'listening-reviewed'; }, 'REVIEW_NOT_IMPORTABLE');
  await refused(d => { asset(d, 'take').file = {path: 'audio/take.wav'}; }, 'UNSUPPORTED_FIELD');
  await refused(d => { asset(d, 'take').script = 'run me'; }, 'UNSUPPORTED_FIELD');
  await refused(d => { (d as Record<string, unknown>).install = true; }, 'UNSUPPORTED_FIELD');
  await refused(d => { d.schema_version = 'em.producer-delivery.v9'; }, 'UNSUPPORTED_VERSION');
  await refused(d => { asset(d, 'take').timing = null; }, 'INVALID_TIMING');
  await refused(d => { asset(d, 'hat').id = 'kick'; }, 'DUPLICATE_ID');
  await refused((_d, audio) => { audio['renders/hat.wav'] = new TextEncoder().encode('not a wav file at all, but long enough to parse......'); }, 'INVALID_WAV');
});

test('paths stay inside the delivery, keep exact case and avoid importer-owned names', async () => {
  await refused(d => { asset(d, 'take').source = '../outside.wav'; }, 'UNSAFE_PATH');
  await refused(d => { asset(d, 'take').source = 'C:/take.wav'; }, 'UNSAFE_PATH');
  await refused(d => { asset(d, 'take').source = 'audio/take.wav'; }, 'UNSAFE_PATH');
  await refused(d => { asset(d, 'take').source = 'Renders/take.wav'; }, 'MISSING_MEDIA');
  await refused(d => { asset(d, 'take').source = 'renders/take.txt'; }, 'INVALID_DELIVERY');
  await refused(d => { asset(d, 'take').rights = {...RIGHTS, evidence: 'manifest.json'}; }, 'UNSAFE_PATH');
  await refused(d => { asset(d, 'take').rights = {...RIGHTS, evidence: 'MISSING.md'}; }, 'MISSING_MEDIA');
  const {root, delivery, out} = await fixture();
  try {
    await writeFile(join(delivery, 'PROVENANCE.md'), '  \n');
    await assert.rejects(importDelivery(delivery, out), /MISSING_PROVENANCE/);
    await writeFile(join(delivery, 'PROVENANCE.md'), 'ok\n');
    await mkdir(out, {recursive: true});
    await assert.rejects(importDelivery(delivery, out), /OUTPUT_EXISTS/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('generator checks report contract mismatches without blocking a technically valid import', async () => {
  const {root, delivery, out} = await fixture((_d, audio) => { audio['renders/chord.wav'] = wav(tone(8001, 0, 30)); });
  try {
    const {receipt} = await importDelivery(delivery, out);
    assert.deepEqual(receipt.generator.checks.map(c => c.result), ['compatibility', 'compatibility']);
    assert.match(receipt.generator.checks[0]!.detail!, /harmony sample lasts at most 2 quarter note\(s\).*8000 frames at 8000 Hz/);
  } finally { await rm(root, {recursive: true, force: true}); }
  const second = await fixture(d => { for (const a of d.assets) a.eligibility = 'unreviewed'; });
  try {
    const {receipt} = await importDelivery(second.delivery, second.out);
    assert.deepEqual(receipt.generator.checks.map(c => c.result), ['eligibility', 'eligibility']);
    assert.equal(receipt.browser_player.result, 'refused');
    assert.match(receipt.browser_player.detail!, /Recording is not eligible/);
  } finally { await rm(second.root, {recursive: true, force: true}); }
});

test('the receipt says whether the current browser player can load the pack', async () => {
  const whole = await fixture();
  try {
    const {receipt} = await importDelivery(whole.delivery, whole.out);
    assert.deepEqual(receipt.browser_player, {loader: 'loadBrowserPack (fixture mode)', result: 'loadable', detail: null});
  } finally { await rm(whole.root, {recursive: true, force: true}); }
  // One-shots alone are a valid pack and a compatible palette, but the S02 loader needs a recording.
  const palette = await fixture(d => { d.assets = d.assets.filter(a => a.id !== 'take'); });
  try {
    const {receipt} = await importDelivery(palette.delivery, palette.out);
    assert.deepEqual(receipt.generator.checks.map(c => c.result), ['compatible', 'compatible']);
    assert.equal(receipt.browser_player.result, 'refused');
    assert.match(receipt.browser_player.detail!, /one or two recordings/);
    assert.ok(receipt.limits.some(l => /browser_player is loadable/.test(l)));
  } finally { await rm(palette.root, {recursive: true, force: true}); }
});

test('reserved ids, clashing evidence paths and unreadable evidence are refused', async () => {
  await refused(d => { d.recipes[0]!.id = 's01-recipe'; }, 'RESERVED_ID');
  await refused(d => { d.pack.id = 's01-foundation'; }, 'RESERVED_ID');
  await refused(d => { asset(d, 'take').rights = {...RIGHTS, evidence: 'audio'}; }, 'UNSAFE_PATH');
  await refused(d => { asset(d, 'kick').rights = {...RIGHTS, evidence: 'provenance.md'}; }, 'UNSAFE_PATH');
  await refused((d, files) => {
    files['notes'] = new TextEncoder().encode('notes\n');
    asset(d, 'take').rights = {...RIGHTS, evidence: 'notes'};
    asset(d, 'kick').rights = {...RIGHTS, evidence: 'notes/more.md'};
  }, 'UNSAFE_PATH');
  await refused((d, files) => {
    files['latin1.md'] = new Uint8Array([0x52, 0xe9, 0x73, 0x75, 0x6d, 0xe9]);
    asset(d, 'take').rights = {...RIGHTS, evidence: 'latin1.md'};
  }, 'MISSING_PROVENANCE');
});

test('a delivery may make the importer read at most 256 MiB in total', async () => {
  // One maximum-size WAV named by four assets: each read counts, so with delivery.json and the
  // recording already read, the fourth copy exceeds the cap.
  const big = new Uint8Array(64 * 1024 * 1024), v = new DataView(big.buffer), data = big.length - 44;
  big.set(wav([]).subarray(0, 44));
  v.setUint32(4, 36 + data, true); v.setUint32(40, data, true); v.setInt16(44, 1000, true);
  assert.ok(4 * big.length >= MAX_DELIVERY_BYTES && 3 * big.length < MAX_DELIVERY_BYTES);
  await refused((d, files) => {
    files['renders/big.wav'] = big;
    for (const id of ['kick', 'hat', 'bass', 'chord']) asset(d, id).source = 'renders/big.wav';
  }, 'INVALID_DELIVERY');
});
