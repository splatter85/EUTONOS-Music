/**
 * EMF-S06 producer import (Node-only, not exported from the browser index).
 *
 * A producer delivery is data: WAV files plus a small JSON description. The importer never
 * runs producer code, never trusts producer-measured file facts and never upgrades review:
 * it measures every WAV itself, keeps the PCM samples verbatim (optionally dropping a
 * verified-silent tail), writes canonical 44-byte WAV headers (so producer metadata chunks
 * never enter a pack) and validates the result with the unchanged pack loader.
 */
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {readPcm16Wav} from './audio.js';
import {loadPack, packReader} from './node.js';
import {fail, portablePath, validatePackManifest} from './pack.js';
import {PACK_VERSION, type AudioPack} from './pack-types.js';
import {compilePhrase, PhrasePlanError, PERFORMER_PALETTE_CONTRACT, S01_PERFORMER, type S01PhraseState} from './phrase-plan.js';

export const DELIVERY_VERSION = 'em.producer-delivery.v0' as const;
export const IMPORT_RECEIPT_VERSION = 'em.import-receipt.v0' as const;
export const IMPORTER = Object.freeze({id: 'eutonos-music-importer', revision: 1});
/** A dropped tail may hold only residue at or below -60 dBFS. */
export const MAX_DROPPED_TAIL_PEAK = 0.001;
const MAX_JSON_BYTES = 1024 * 1024;
const RESERVED = new Set(['manifest.json', 'import.json']);
const ASSET_KEYS = ['id', 'revision', 'title', 'source_kind', 'source', 'expected_sha256', 'keep_frames', 'rights',
  'eligibility', 'genres', 'states', 'key', 'harmony_pitch_classes', 'timing', 'cues'];

type Json = Record<string, unknown>;

export interface ImportedAsset {
  readonly id: string;
  readonly revision: number;
  readonly source: string;
  readonly source_sha256: string;
  readonly source_frames: number;
  /** The producer's own receipt hash (e.g. fl_verify_export), checked against the source bytes. */
  readonly producer_sha256: string | null;
  readonly keep_frames: number | null;
  readonly dropped_tail_peak: number | null;
  readonly path: string;
  readonly sha256: string;
  readonly sample_rate: number;
  readonly channels: 1 | 2;
  readonly frames: number;
  readonly peak: number;
}

export interface GeneratorCheck {
  readonly recipe: {readonly id: string; readonly revision: number};
  readonly state: S01PhraseState;
  readonly result: 'compatible' | 'compatibility' | 'eligibility';
  readonly detail: string | null;
}

export interface ImportReceipt {
  readonly schema_version: typeof IMPORT_RECEIPT_VERSION;
  readonly importer: typeof IMPORTER;
  readonly producer: {readonly id: string; readonly revision: number; readonly kind: string;
    readonly description: string; readonly verified: false};
  readonly pack: {readonly id: string; readonly revision: number};
  readonly manifest_sha256: string;
  readonly assets: readonly ImportedAsset[];
  /** Fixture-mode check of each recipe against the S04 performer's palette contract. */
  readonly generator: {readonly performer: typeof S01_PERFORMER; readonly contract: typeof PERFORMER_PALETTE_CONTRACT;
    readonly checks: readonly GeneratorCheck[]};
  readonly limits: readonly string[];
}

const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', {fatal: true}).decode(bytes);

function object(value: unknown, at: string, keys: readonly string[]): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('INVALID_DELIVERY', at, 'expected an object');
  for (const key of Object.keys(value)) {
    if (key === 'file' && at.startsWith('delivery.assets[')) {
      fail('UNSUPPORTED_FIELD', `${at}.file`, 'the importer measures file facts itself; give `source` instead');
    }
    if (!keys.includes(key)) fail('UNSUPPORTED_FIELD', `${at}.${key}`, `not part of ${DELIVERY_VERSION}`);
  }
  return value as Json;
}

function text(value: unknown, at: string, max = 200): string {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > max) {
    return fail('INVALID_DELIVERY', at, `expected nonempty trimmed text (max ${max})`);
  }
  return value;
}

function integer(value: unknown, at: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    return fail('INVALID_DELIVERY', at, `expected an integer in [${min}, ${max}]`);
  }
  return value;
}

function deliveryPath(value: unknown, at: string): string {
  const path = portablePath(value, at);
  if (RESERVED.has(path.toLowerCase()) || path.toLowerCase().startsWith('audio/')) {
    fail('UNSAFE_PATH', at, 'manifest.json, IMPORT.json and audio/ are written by the importer');
  }
  return path;
}

/** Canonical 44-byte PCM16 header around verbatim sample bytes. */
function canonicalWav(sampleRate: number, channels: 1 | 2, pcm: Uint8Array): Uint8Array {
  const out = new Uint8Array(44 + pcm.length), view = new DataView(out.buffer);
  const tag = (at: number, value: string) => out.set(new TextEncoder().encode(value), at);
  tag(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); tag(36, 'data');
  view.setUint32(40, pcm.length, true); out.set(pcm, 44);
  return out;
}

function peakOf(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let peak = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
  return peak / 32768;
}

interface Prepared { readonly entry: Json; readonly bytes: Uint8Array; readonly report: ImportedAsset }

async function prepareAsset(value: unknown, at: string, read: (path: string) => Promise<Uint8Array>): Promise<Prepared> {
  const o = object(value, at, ASSET_KEYS);
  const id = text(o.id, `${at}.id`, 96), revision = integer(o.revision, `${at}.revision`, 1, Number.MAX_SAFE_INTEGER);
  const source = deliveryPath(o.source, `${at}.source`);
  if (!source.toLowerCase().endsWith('.wav')) fail('INVALID_DELIVERY', `${at}.source`, 'expected a .wav file');
  if (o.eligibility === 'listening-reviewed') {
    fail('REVIEW_NOT_IMPORTABLE', `${at}.eligibility`, 'an import cannot confer listening review; deliver fixture-only or unreviewed');
  }
  const expected = o.expected_sha256 === undefined || o.expected_sha256 === null ? null : text(o.expected_sha256, `${at}.expected_sha256`, 64);
  if (expected !== null && !/^[a-f0-9]{64}$/.test(expected)) fail('INVALID_HASH', `${at}.expected_sha256`, 'expected a lowercase SHA-256');

  const sourceBytes = await read(source), sourceHash = hex(sourceBytes);
  if (expected !== null && expected !== sourceHash) {
    fail('HASH_MISMATCH', `${at}.source`, 'the delivered WAV differs from the producer receipt');
  }
  const info = readPcm16Wav(sourceBytes);
  const keep = o.keep_frames === undefined || o.keep_frames === null ? null : integer(o.keep_frames, `${at}.keep_frames`, 1, info.frames);
  const align = info.channels * 2, frames = keep ?? info.frames;
  const pcm = sourceBytes.subarray(info.data_offset, info.data_offset + frames * align);
  let droppedPeak: number | null = null;
  if (keep !== null) {
    droppedPeak = keep === info.frames ? 0 : peakOf(sourceBytes.subarray(info.data_offset + keep * align, info.data_offset + info.data_bytes));
    if (droppedPeak > MAX_DROPPED_TAIL_PEAK) {
      fail('TAIL_NOT_SILENT', `${at}.keep_frames`, `the dropped tail peaks at ${droppedPeak.toFixed(5)} (limit ${MAX_DROPPED_TAIL_PEAK})`);
    }
  }
  const peak = peakOf(pcm);
  if (peak === 0) fail('SILENT_AUDIO', `${at}.source`, 'the kept audio is digitally silent');
  if (peak >= 32767 / 32768) fail('CLIPPED_AUDIO', `${at}.source`, 'the kept audio reaches full scale (possible clipping)');

  const bytes = canonicalWav(info.sample_rate, info.channels, pcm);
  const path = `audio/${id}.wav`, sha256 = hex(bytes);
  const entry: Json = {id, revision, title: o.title, source_kind: o.source_kind,
    file: {path, sha256, bytes: bytes.length, format: 'pcm16-wav', sample_rate: info.sample_rate, channels: info.channels, frames},
    rights: o.rights, eligibility: o.eligibility, genres: o.genres, states: o.states, key: o.key,
    harmony_pitch_classes: o.harmony_pitch_classes, timing: o.timing, cues: o.cues};
  return {entry, bytes, report: {id, revision, source, source_sha256: sourceHash, source_frames: info.frames,
    producer_sha256: expected, keep_frames: keep, dropped_tail_peak: droppedPeak, path, sha256,
    sample_rate: info.sample_rate, channels: info.channels, frames, peak}};
}

function generatorChecks(pack: AudioPack): GeneratorCheck[] {
  const checks: GeneratorCheck[] = [];
  for (const recipe of pack.recipes) {
    for (const state of ['explore', 'drive'] as const) {
      if (!recipe.states.includes(state)) continue;
      const ref = {id: recipe.id, revision: recipe.revision};
      try {
        compilePhrase(pack, {recipe: ref, seed: 0, state, allowFixtures: true});
        checks.push({recipe: ref, state, result: 'compatible', detail: null});
      } catch (error) {
        if (!(error instanceof PhrasePlanError) || (error.code !== 'compatibility' && error.code !== 'eligibility')) throw error;
        checks.push({recipe: ref, state, result: error.code, detail: error.message});
      }
    }
  }
  return checks;
}

/**
 * Imports `<deliveryDir>/delivery.json` into a new pack directory. The output must not exist;
 * the pack is built beside it and renamed into place only after loadPack accepts it.
 */
export async function importDelivery(deliveryDir: string, outputDir: string): Promise<{pack: AudioPack; receipt: ImportReceipt}> {
  const output = resolve(outputDir);
  if (await stat(output).then(() => true, () => false)) fail('OUTPUT_EXISTS', basename(output), 'choose a new output directory');
  const read = await packReader(deliveryDir);
  const raw = await read('delivery.json');
  if (raw.length > MAX_JSON_BYTES) fail('INVALID_DELIVERY', 'delivery.json', 'exceeds 1 MiB');
  let parsed: unknown;
  try { parsed = JSON.parse(decode(raw)); } catch (error) { return fail('INVALID_DELIVERY', 'delivery.json', String((error as Error).message)); }
  const d = object(parsed, 'delivery', ['schema_version', 'producer', 'pack', 'assets', 'palettes', 'recipes', 'routes']);
  if (d.schema_version !== DELIVERY_VERSION) fail('UNSUPPORTED_VERSION', 'delivery.schema_version', `expected ${DELIVERY_VERSION}`);
  const p = object(d.producer, 'delivery.producer', ['id', 'revision', 'kind', 'description']);
  const producer = {id: text(p.id, 'delivery.producer.id', 96), revision: integer(p.revision, 'delivery.producer.revision', 1, Number.MAX_SAFE_INTEGER),
    kind: text(p.kind, 'delivery.producer.kind', 96), description: text(p.description, 'delivery.producer.description', 400), verified: false as const};
  const identity = object(d.pack, 'delivery.pack', ['id', 'revision']);
  if (!Array.isArray(d.assets) || d.assets.length > 64) fail('INVALID_DELIVERY', 'delivery.assets', 'expected at most 64 assets');

  const prepared: Prepared[] = [];
  for (const [i, asset] of (d.assets as unknown[]).entries()) prepared.push(await prepareAsset(asset, `delivery.assets[${i}]`, read));
  const manifest = {schema_version: PACK_VERSION, id: identity.id, revision: identity.revision,
    assets: prepared.map(a => a.entry), palettes: d.palettes, recipes: d.recipes, routes: d.routes};
  const pack = validatePackManifest(manifest);

  const evidence = new Map<string, Uint8Array>();
  for (const asset of pack.assets) {
    const path = deliveryPath(asset.rights.evidence, `${asset.id}.rights.evidence`);
    if (evidence.has(path)) continue;
    const bytes = await read(path);
    if (bytes.length > MAX_JSON_BYTES || !decode(bytes).trim()) fail('MISSING_PROVENANCE', path, 'rights evidence must be nonempty UTF-8 text up to 1 MiB');
    evidence.set(path, bytes);
  }

  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
  const receipt: ImportReceipt = {schema_version: IMPORT_RECEIPT_VERSION, importer: IMPORTER, producer,
    pack: {id: pack.id, revision: pack.revision}, manifest_sha256: hex(manifestBytes),
    assets: prepared.map(a => a.report),
    generator: {performer: S01_PERFORMER, contract: PERFORMER_PALETTE_CONTRACT, checks: generatorChecks(pack)},
    limits: [
      'Technical import only: PCM16 parse, not silent, not full scale, dropped tails at or below -60 dBFS, pack schema, rights evidence present, hashes and PCM metadata re-read by loadPack.',
      'Producer identity, rights and musical labels are recorded as delivered; they are not verified.',
      'Generator checks run in fixture mode at seed 0 and say nothing about how the result sounds.',
      'Listening: NOT TESTED.',
    ]};

  await mkdir(dirname(output), {recursive: true});
  const scratch = join(dirname(output), `.import-${basename(output)}-${randomUUID().slice(0, 8)}`);
  try {
    await mkdir(join(scratch, 'audio'), {recursive: true});
    for (const a of prepared) await writeFile(join(scratch, ...a.report.path.split('/')), a.bytes);
    for (const [path, bytes] of evidence) {
      await mkdir(dirname(join(scratch, ...path.split('/'))), {recursive: true});
      await writeFile(join(scratch, ...path.split('/')), bytes);
    }
    await writeFile(join(scratch, 'manifest.json'), manifestBytes);
    await writeFile(join(scratch, 'IMPORT.json'), JSON.stringify(receipt, null, 2) + '\n');
    await loadPack(scratch);
    await moveIntoPlace(scratch, output);
  } catch (error) {
    await rm(scratch, {recursive: true, force: true});
    throw error;
  }
  return {pack, receipt};
}

/** Windows antivirus or sync clients can hold a just-written folder briefly; retry, never overwrite. */
async function moveIntoPlace(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    if (await stat(to).then(() => true, () => false)) fail('OUTPUT_EXISTS', basename(to), 'the output appeared while importing');
    try { await rename(from, to); return; } catch (error) {
      const code = (error as {code?: string}).code;
      if (attempt >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await new Promise(done => setTimeout(done, 50));
    }
  }
}
