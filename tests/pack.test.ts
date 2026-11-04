import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {eligibleForPlayback, PackError, portablePath, validatePackManifest} from '../src/pack.js';
import {readPcm16Wav, sha256, validatePackFiles} from '../src/audio.js';
import {loadPack, packReader} from '../src/node.js';

const root = fileURLToPath(new URL('../../fixtures/s01/', import.meta.url));
const raw = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
const fresh = () => structuredClone(raw);
const code = (expected: string) => (error: unknown) => error instanceof PackError && error.code === expected;

test('real fixture pack has checked bytes, two recordings, four sample roles and a directed route', async () => {
  const {pack, audio} = await loadPack(root);
  assert.equal(pack.assets.filter(a => a.source_kind === 'recording').length, 2);
  assert.equal(pack.assets.filter(a => a.source_kind === 'sample').length, 4);
  assert.equal(new Set(pack.palettes[0]!.samples.map(s => s.role)).size, 4);
  assert.equal(pack.recipes.length, 1);
  assert.equal(pack.routes.length, 1);
  assert.equal(audio.length, 6);
  assert.ok(audio.every(a => a.peak > 0 && a.peak < 0.95));
  for (const a of pack.assets) {
    assert.equal(eligibleForPlayback(a), false, 'fixtures never silently count as listening-reviewed');
    assert.equal(eligibleForPlayback(a, true), true);
    assert.ok(a.rights.allowed_uses.includes('redistribution'));
  }
});

test('schema version, duplicate global IDs, file paths and cue IDs fail explicitly', () => {
  let p = fresh(); p.schema_version = 'em.audio-pack.v99';
  assert.throws(() => validatePackManifest(p), code('UNSUPPORTED_VERSION'));
  p = fresh(); p.assets.push(structuredClone(p.assets[0]));
  assert.throws(() => validatePackManifest(p), code('DUPLICATE_ID'));
  p = fresh(); p.palettes[0].id = p.assets[0].id;
  assert.throws(() => validatePackManifest(p), code('DUPLICATE_ID'));
  p = fresh(); p.assets[1].file.path = p.assets[0].file.path;
  assert.throws(() => validatePackManifest(p), code('DUPLICATE_ID'));
  p = fresh(); p.assets[0].cues.push(structuredClone(p.assets[0].cues[0]));
  assert.throws(() => validatePackManifest(p), code('DUPLICATE_ID'));
});

test('untrusted values and undeclared recipe code are rejected rather than interpreted', () => {
  for (const value of [null, [], true, {schema_version: 'em.audio-pack.v0'}]) {
    assert.throws(() => validatePackManifest(value), PackError);
  }
  for (const bpm of [NaN, Infinity, 0, -1, '120']) {
    const p = fresh(); p.assets[0].timing.bpm = bpm;
    assert.throws(() => validatePackManifest(p), PackError);
  }
  const p = fresh(); p.recipes[0].script = 'process.exit()';
  assert.throws(() => validatePackManifest(p), code('UNSUPPORTED_FIELD'));
  const q = fresh(); delete q.assets[0].rights;
  assert.throws(() => validatePackManifest(q), PackError);
});

test('portable paths reject traversal, URLs, Windows drives, reserved names and ambiguous separators', () => {
  for (const path of ['../audio/a.wav', '/a.wav', 'C:/a.wav', 'C:\\a.wav', 'audio\\a.wav',
    'https://example.com/a.wav', 'audio//a.wav', 'audio/./a.wav', 'audio/../a.wav',
    'audio/con.wav', 'audio/LPT1.wav', 'audio/a.wav.', 'audio/a.wav:stream', 'audio/%2e%2e/a.wav']) {
    assert.throws(() => portablePath(path), PackError, path);
  }
  assert.equal(portablePath('audio/a.wav'), 'audio/a.wav');
  const p = fresh(); p.assets[0].file.path = 'audio/A.wav';
  assert.throws(() => validatePackManifest(p), code('UNSAFE_PATH'));
});

test('cues require phrase boundaries, valid entry positions and enough overlap audio', () => {
  for (const position of [-1, 1, 4, 33, 100]) {
    const p = fresh(); p.assets[0].cues[0].position_quarters = position;
    assert.throws(() => validatePackManifest(p), PackError);
  }
  let p = fresh(); p.assets[0].cues.find((c: {kind: string}) => c.kind === 'entry').position_quarters = 32;
  assert.throws(() => validatePackManifest(p), code('INVALID_CUE'));
  p = fresh(); p.routes[0].overlap_quarters = 32;
  assert.throws(() => validatePackManifest(p), code('INVALID_CUE'));
  p = fresh(); p.routes[0].exit_cue = 'missing';
  assert.throws(() => validatePackManifest(p), code('INVALID_CUE'));
  p = fresh(); p.assets[0].timing.bars = 16;
  assert.throws(() => validatePackManifest(p), code('INVALID_LENGTH'));
});

test('incompatible or unknown harmony/tempo/meter cannot acquire a fixture route', () => {
  let p = fresh(); p.assets[1].timing.bpm = 128;
  assert.throws(() => validatePackManifest(p), code('INCOMPATIBLE_ROUTE'));
  p = fresh(); p.assets[1].timing.meter = [3, 4];
  assert.throws(() => validatePackManifest(p), code('UNSUPPORTED_METER'));
  for (const pitches of [null, [0, 4, 7]]) {
    p = fresh(); p.assets[1].harmony_pitch_classes = pitches;
    assert.throws(() => validatePackManifest(p), code('INCOMPATIBLE_ROUTE'));
  }
  p = fresh(); p.routes[0].overlap_quarters = 5;
  assert.throws(() => validatePackManifest(p), code('INCOMPATIBLE_ROUTE'));
  p = fresh(); p.routes = []; p.assets[0].key = null; p.assets[0].harmony_pitch_classes = null;
  assert.equal(validatePackManifest(p).assets[0]!.key, null, 'unknown harmony can still be ordinary playback data');
});

test('versioned recipe/palette/source references cannot silently resolve to a different revision', () => {
  let p = fresh(); p.recipes[0].palette.revision++;
  assert.throws(() => validatePackManifest(p), code('MISSING_REFERENCE'));
  p = fresh(); p.palettes[0].samples[0].asset.id = 'missing';
  assert.throws(() => validatePackManifest(p), code('MISSING_REFERENCE'));
  p = fresh(); p.routes[0].to.revision++;
  assert.throws(() => validatePackManifest(p), code('MISSING_REFERENCE'));
});

test('rights and review eligibility stay distinct from valid JSON and fixture opt-in', () => {
  const p = fresh(); p.routes = [];
  p.assets[0].rights.allowed_uses = [];
  p.assets[1].eligibility = 'unreviewed';
  const pack = validatePackManifest(p);
  assert.equal(eligibleForPlayback(pack.assets[0]!, true), false);
  assert.equal(eligibleForPlayback(pack.assets[1]!, true), false);
});

test('actual missing bytes, byte lengths and content hash mismatch fail', async () => {
  const pack = validatePackManifest(raw), read = await packReader(root);
  const missing = fresh(); missing.assets[0].file.path = 'audio/missing.wav';
  await assert.rejects(validatePackFiles(validatePackManifest(missing), read), code('MISSING_MEDIA'));
  await assert.rejects(validatePackFiles(pack, async () => {throw new Error('absent');}), code('MISSING_MEDIA'));
  await assert.rejects(validatePackFiles(pack, async path => (await read(path)).subarray(1)), code('BYTE_LENGTH_MISMATCH'));
  await assert.rejects(validatePackFiles(pack, async path => {
    const bytes = await read(path); bytes[bytes.length - 8] = bytes[bytes.length - 8]! ^ 1; return bytes;
  }), code('HASH_MISMATCH'));
});

test('WAV sample rate, frame count and channels are measured from bytes', async () => {
  const read = await packReader(root);
  for (const [field, value] of [['sample_rate', 48000], ['frames', 100], ['channels', 2]] as const) {
    const p = fresh(), sample = p.assets.find((a: {source_kind: string}) => a.source_kind === 'sample');
    sample.file[field] = value;
    await assert.rejects(validatePackFiles(validatePackManifest(p), read), code('AUDIO_METADATA_MISMATCH'));
  }
});

test('WAV parser honors byte offsets, optional chunks and RIFF padding; rejects corrupt headers', async () => {
  const pack = validatePackManifest(raw), read = await packReader(root);
  const bytes = await read(pack.assets[0]!.file.path), info = readPcm16Wav(bytes);
  const wrapped = new Uint8Array(bytes.length + 10); wrapped.set(bytes, 7);
  assert.deepEqual(readPcm16Wav(wrapped.subarray(7, 7 + bytes.length)), info);
  const padded = new Uint8Array(bytes.length + 10); padded.set(bytes.subarray(0, 12));
  padded.set([74, 85, 78, 75, 1, 0, 0, 0, 42, 0], 12); padded.set(bytes.subarray(12), 22);
  new DataView(padded.buffer).setUint32(4, padded.length - 8, true);
  assert.equal(readPcm16Wav(padded).frames, info.frames);
  for (const offset of [0, 4, 8, 20, 22, 32, 34, 40]) {
    const corrupt = bytes.slice(); corrupt[offset] = corrupt[offset]! ^ 255;
    assert.throws(() => readPcm16Wav(corrupt), code('INVALID_WAV'));
  }
  assert.throws(() => readPcm16Wav(bytes.subarray(0, bytes.length - 1)), code('INVALID_WAV'));
  assert.equal((await sha256(bytes)).length, 64);
});

test('filesystem reader detects case mismatch and directory symlink escape on every OS', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'emf-pack-'));
  try {
    const inside = join(temporary, 'pack'), outside = join(temporary, 'outside');
    await mkdir(inside); await mkdir(outside);
    await writeFile(join(inside, 'UPPER.wav'), 'test'); await writeFile(join(outside, 'out.wav'), 'test');
    const read = await packReader(inside);
    await assert.rejects(read('upper.wav'), code('MISSING_MEDIA'));
    await symlink(outside, join(inside, 'audio'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(read('audio/out.wav'), code('UNSAFE_PATH'));
  } finally { await rm(temporary, {recursive: true, force: true}); }
});
