/** EMS-S01/EMF-S18 data intake. Private inventory, explicit two-take audition or a rated set; never a review promotion. */
import {createHash, randomUUID} from 'node:crypto';
import {lstat, mkdir, open, readdir, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {readPcm16Wav} from './audio.js';
import {importDelivery} from './importer.js';
import {MAX_AUDIO_BYTES, portablePath, quartersToFrames} from './pack.js';
import {MAX_AUDITION_BYTES} from './browser-pack.js';

export const RATED_EXPORT_VERSION = 'music-studio.rated-export.v1';
export const RATED_CATALOG_VERSION = 'eutonos.rated-catalog.v1';
export const RATED_INTAKE_LIMITS = Object.freeze({jsonBytes: 1024 * 1024, fileBytes: 256 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024 * 1024, takes: 4096, pairBytes: MAX_AUDITION_BYTES,
  /** EMF-S18 set budget: total dj_audio bytes and take count of one set pack (no pair cap applies). */
  setBytes: 512 * 1024 * 1024, setTakes: 32});
/** `loved-liked` selects every love and like take; an explicit list names takes (love/like only). */
export type SetSelection = 'loved-liked' | readonly string[];
export type TakeRating = 'love' | 'like' | 'dislike';
export interface RatedFile {path: string; sha256: string; bytes: number}
export interface RatedTake {
  id: string; title: string; rating: TakeRating; duration_seconds: number;
  tempo: {bpm: number | null; source: 'requested' | 'unknown'};
  key: {value: string | null; source: 'requested' | 'unknown'};
  audio: RatedFile; recipe: RatedFile; dj_audio: RatedFile;
}
export interface RatedCatalog {
  schema_version: typeof RATED_CATALOG_VERSION;
  takes: RatedTake[];
  pair: null | {take_ids: [string, string]; asset_ids: [string, string]; manifest: 'pack/manifest.json';
    grid: 'requested-not-measured'; transition: 'zero-overlap-cut'; eligibility: 'unreviewed'; max_bytes: number};
  /** EMF-S18 additive field; absent in catalogues written before S18 (readers must treat absence as null). */
  set?: null | {selection: 'loved-liked' | 'explicit'; take_ids: string[]; asset_ids: string[]; manifest: 'pack/manifest.json';
    grid: 'requested-not-measured'; transition: 'none-authored (DJ decides)'; eligibility: 'unreviewed';
    order: 'catalog'; total_bytes: number; max_bytes: number; max_takes: number};
  limits: string[];
}
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function bad(where: string, detail: string): never { throw new Error(`INVALID_RATED_EXPORT at ${where}: ${detail}`); }
function obj(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) bad(where, 'expected object');
  return value as Record<string, unknown>;
}
function text(value: unknown, where: string, max = 400): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > max) bad(where, 'expected bounded nonempty text');
  return value;
}
function num(value: unknown, where: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) {
    bad(where, `expected ${integer ? 'integer' : 'number'} in [${min}, ${max}]`);
  }
  return value;
}
function rating(value: unknown, where: string): TakeRating {
  if (value !== 'love' && value !== 'like' && value !== 'dislike') bad(where, 'expected love, like or dislike');
  return value;
}
function parseJson(bytes: Uint8Array, where: string): unknown {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { return bad(where, 'expected UTF-8 JSON'); }
}
function descriptor(value: unknown, where: string): RatedFile {
  const d = obj(value, where), path = portablePath(d.path, `${where}.path`);
  const hash = text(d.sha256, `${where}.sha256`, 64);
  if (!/^[a-f0-9]{64}$/.test(hash)) bad(where, 'expected lowercase SHA-256');
  return {path, sha256: hash, bytes: num(d.bytes, `${where}.bytes`, 1, RATED_INTAKE_LIMITS.fileBytes, true)};
}
function metadata(value: unknown, where: string, groupRating: TakeRating): RatedTake {
  const t = obj(value, where), id = text(t.id, `${where}.id`, 128);
  // File names are data, never host paths. Preserve the producer's ID verbatim in the catalog.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) bad(where, 'take id must be a portable filename component');
  if (rating(t.rating, `${where}.rating`) !== groupRating) bad(where, 'take rating differs from its set');
  const tempo = obj(t.tempo, `${where}.tempo`), key = obj(t.key, `${where}.key`);
  const bpm = tempo.bpm === null ? null : num(tempo.bpm, `${where}.tempo.bpm`, 20, 400);
  const keyValue = key.value === null ? null : text(key.value, `${where}.key.value`, 128);
  if (tempo.source !== (bpm === null ? 'unknown' : 'requested')) bad(where, 'tempo source must distinguish requested from unknown');
  if (key.source !== (keyValue === null ? 'unknown' : 'requested')) bad(where, 'key source must distinguish requested from unknown');
  const audio = descriptor(t.audio, `${where}.audio`), recipe = descriptor(t.recipe, `${where}.recipe`), dj = descriptor(t.dj_audio, `${where}.dj_audio`);
  if (audio.path !== `${id}/take.wav` || recipe.path !== `${id}/recipe.json` || dj.path !== `${id}/audition.wav`) {
    bad(where, 'expected take.wav, recipe.json and audition.wav under the take id');
  }
  return {id, title: text(t.title, `${where}.title`), rating: groupRating,
    duration_seconds: num(t.duration_seconds, `${where}.duration_seconds`, Number.MIN_VALUE, 24 * 3600),
    tempo: {bpm, source: bpm === null ? 'unknown' : 'requested'},
    key: {value: keyValue, source: keyValue === null ? 'unknown' : 'requested'}, audio, recipe, dj_audio: dj};
}

/** Reject aliases, symlinks (including parent components), casing differences and unbounded reads. */
async function sourceReader(directory: string) {
  const root = await realpath(directory);
  let total = 0;
  return async (path: string, max: number): Promise<Uint8Array> => {
    portablePath(path);
    let current = root;
    for (const segment of path.split('/')) {
      if (!(await readdir(current)).includes(segment)) bad(path, 'missing file or casing differs');
      current = join(current, segment);
      const info = await lstat(current);
      if (info.isSymbolicLink() || await realpath(current) !== current) bad(path, 'symlinks and aliases are not accepted');
    }
    const handle = await open(current, 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > max || info.size > RATED_INTAKE_LIMITS.totalBytes - total) bad(path, 'file or total input size exceeds budget');
      // Read into a bounded buffer; growth during a read cannot allocate arbitrary memory.
      const data = new Uint8Array(info.size + 1);
      let count = 0;
      while (count < data.length) {
        const got = await handle.read(data, count, data.length - count, count);
        if (!got.bytesRead) break;
        count += got.bytesRead;
      }
      if (count !== info.size) bad(path, 'source changed during read');
      total += count;
      return data.subarray(0, count);
    } finally { await handle.close(); }
  };
}

type ScratchReader = Awaited<ReturnType<typeof sourceReader>>;
/** One requested-grid, unreviewed recording entry; PCM format and duration are re-checked from the copied audition bytes. */
async function recordingAsset(read: ScratchReader, delivery: string, t: RatedTake, id: string, where: string) {
  const bytes = await read(t.dj_audio.path, MAX_AUDIO_BYTES), info = readPcm16Wav(bytes);
  if (Math.abs(info.frames / info.sample_rate - t.duration_seconds) > Math.max(0.05, 1 / info.sample_rate)) {
    bad(t.id, 'duration differs from full-length audition audio');
  }
  if (t.tempo.bpm === null) bad(t.id, 'requested BPM is unknown; a requested grid cannot be assigned');
  const bpm = t.tempo.bpm;
  const bars = Math.floor(info.frames * bpm / (240 * info.sample_rate));
  if (bars < 2 || bars > 4096) bad(where, 'each take needs at least two whole bars and at most 4096 bars');
  // Round in the same frame domain as the pack validator, keeping every original tail frame.
  if (quartersToFrames(bars * 4, bpm, info.sample_rate) > info.frames + 1) bad(where, 'whole-bar body exceeds the audio');
  await writeFile(join(delivery, `${id}.wav`), bytes);
  return {id, revision: 1, title: t.title, source_kind: 'recording', source: `${id}.wav`, expected_sha256: t.dj_audio.sha256,
    rights: {origin: 'Owner-selected local Music Studio rated export; source identity and rights unverified.',
      creator: 'As recorded in the private recipe; not verified', license: 'Owner-requested local audition only; no redistribution grant',
      allowed_uses: ['playback'], evidence: 'PROVENANCE.md'},
    eligibility: 'unreviewed', genres: [], states: ['browse', 'explore', 'drive', 'surge', 'afterglow'], key: null,
    harmony_pitch_classes: null, timing: {bpm, meter: [4, 4], bars, phrase_bars: 1, first_downbeat_frame: 0},
    cues: [{id: 'entry', kind: 'entry', position_quarters: 0}, {id: 'exit', kind: 'exit', position_quarters: (bars - 1) * 4}]};
}

function pairAssetId(id: string, side: 'a' | 'b'): string { return `s16-${side}-${digest(id).slice(0, 24)}`; }
async function buildPair(scratch: string, catalog: RatedCatalog, ids: readonly [string, string]): Promise<void> {
  if (ids[0] === ids[1]) bad('pair', 'choose two distinct take ids');
  const selected = ids.map(id => catalog.takes.find(t => t.id === id));
  const a = selected[0], b = selected[1];
  if (!a || !b) bad('pair', 'selected take is not in the rated inventory');
  if (a.tempo.bpm === null || a.tempo.bpm !== b.tempo.bpm) bad('pair', 'v0 audition requires two equal, known requested BPMs; these are not measured grids');
  if (a.dj_audio.bytes + b.dj_audio.bytes > MAX_AUDITION_BYTES) bad('pair', 'selected pair exceeds 128 MiB; original audio was not shortened');
  const delivery = join(scratch, '.delivery');
  await mkdir(delivery);
  const read = await sourceReader(scratch);
  const assets = [];
  // The bounded DJ's initial deterministic sort must pick the directed route's A first.
  for (const [index, t] of [a, b].entries()) assets.push(await recordingAsset(read, delivery, t, pairAssetId(t.id, index === 0 ? 'a' : 'b'), 'pair'));
  await writeFile(join(delivery, 'PROVENANCE.md'), 'Owner-requested local audition, not a rights certification. No redistribution or sample reuse is granted.\nRatings are owner taste labels, not listening review.\n4/4, frame-zero downbeat and constant tempo are requested-grid audition assumptions, not measured facts.\nThe zero-overlap cut may shorten the outgoing take and cut its tail. Full source and audition audio are retained privately.\nListening: NOT TESTED by the importer.\n');
  await writeFile(join(delivery, 'delivery.json'), JSON.stringify({schema_version: 'em.producer-delivery.v0',
    producer: {id: 'music-studio-rated-export', revision: 1, kind: 'owner-local', description: 'Explicit rated-takes audition, requested grid only'},
    pack: {id: 's16-rated-audition', revision: 1}, assets, palettes: [], recipes: [],
    routes: [{id: 's16-a-to-b', revision: 1, from: {id: assets[0]!.id, revision: 1}, to: {id: assets[1]!.id, revision: 1},
      exit_cue: 'exit', entry_cue: 'entry', overlap_quarters: 0, review: 'fixture-only'}]}, null, 2) + '\n');
  await importDelivery(delivery, join(scratch, 'pack'));
  await rm(delivery, {recursive: true, force: true});
  catalog.pair = {take_ids: [a.id, b.id], asset_ids: [assets[0]!.id, assets[1]!.id], manifest: 'pack/manifest.json',
    grid: 'requested-not-measured', transition: 'zero-overlap-cut', eligibility: 'unreviewed', max_bytes: MAX_AUDITION_BYTES};
}

/** Stable per take, independent of which other takes a set selects. */
export function setAssetId(id: string): string { return `s18-${digest(id).slice(0, 24)}`; }
/** Selects a set in catalog order (love set, then like set, each in export order) and refuses dislikes. */
export function selectSet(catalog: RatedCatalog, selection: SetSelection): RatedTake[] {
  let chosen: RatedTake[];
  if (selection === 'loved-liked') chosen = catalog.takes.filter(t => t.rating === 'love' || t.rating === 'like');
  else {
    if (!Array.isArray(selection)) bad('set', 'expected loved-liked or a list of take ids');
    const wanted = new Set<string>();
    for (const id of selection) {
      if (typeof id !== 'string' || wanted.has(id)) bad('set', 'explicit take ids must be distinct strings');
      const take = catalog.takes.find(t => t.id === id);
      if (!take) bad('set', `selected take ${id} is not in the rated inventory`);
      if (take.rating === 'dislike') bad('set', `selected take ${id} is rated dislike; sets admit love and like takes only`);
      wanted.add(id);
    }
    chosen = catalog.takes.filter(t => wanted.has(t.id));
  }
  if (chosen.length < 2) bad('set', 'a set needs at least two love or like takes');
  if (chosen.length > RATED_INTAKE_LIMITS.setTakes) bad('set', `SET_TOO_LARGE: ${chosen.length} takes exceeds the ${RATED_INTAKE_LIMITS.setTakes}-take set budget; choose an explicit list`);
  const total = chosen.reduce((sum, t) => sum + t.dj_audio.bytes, 0);
  if (total > RATED_INTAKE_LIMITS.setBytes) {
    bad('set', `SET_TOO_LARGE: ${total} audition bytes exceeds the ${RATED_INTAKE_LIMITS.setBytes / (1024 * 1024)} MiB set budget; original audio was not shortened`);
  }
  return chosen;
}
async function buildSet(scratch: string, catalog: RatedCatalog, selection: SetSelection): Promise<void> {
  const chosen = selectSet(catalog, selection);
  const delivery = join(scratch, '.delivery');
  await mkdir(delivery);
  const read = await sourceReader(scratch);
  const assets = [];
  for (const t of chosen) assets.push(await recordingAsset(read, delivery, t, setAssetId(t.id), 'set'));
  await writeFile(join(delivery, 'PROVENANCE.md'), 'Owner-requested local set, not a rights certification. No redistribution or sample reuse is granted.\nRatings are owner taste labels, not listening review. Dislikes are never selected.\n4/4, frame-zero downbeat and constant tempo are requested-grid assumptions, not measured facts. Requested BPMs may differ between takes.\nNo transition routes are authored; any mix between takes is decided later by the DJ and is not reviewed here.\nFull source and audition audio are retained privately.\nListening: NOT TESTED by the importer.\n');
  await writeFile(join(delivery, 'delivery.json'), JSON.stringify({schema_version: 'em.producer-delivery.v0',
    producer: {id: 'music-studio-rated-export', revision: 1, kind: 'owner-local', description: 'Rated-takes set, requested grid only, no authored routes'},
    pack: {id: 's18-rated-set', revision: 1}, assets, palettes: [], recipes: [], routes: []}, null, 2) + '\n');
  const total = chosen.reduce((sum, t) => sum + t.dj_audio.bytes, 0);
  // Audio plus delivery JSON and provenance; the importer's 256 MiB producer default stays unchanged for other callers.
  await importDelivery(delivery, join(scratch, 'pack'), {maxDeliveryBytes: RATED_INTAKE_LIMITS.setBytes + 2 * 1024 * 1024});
  await rm(delivery, {recursive: true, force: true});
  catalog.set = {selection: selection === 'loved-liked' ? 'loved-liked' : 'explicit', take_ids: chosen.map(t => t.id),
    asset_ids: assets.map(a => a.id), manifest: 'pack/manifest.json', grid: 'requested-not-measured',
    transition: 'none-authored (DJ decides)', eligibility: 'unreviewed', order: 'catalog', total_bytes: total,
    max_bytes: RATED_INTAKE_LIMITS.setBytes, max_takes: RATED_INTAKE_LIMITS.setTakes};
}

/** Imports to a NEW directory. Any validation/pair failure removes scratch and publishes nothing. */
export async function importRatedTakes(sourceDirectory: string, outputDirectory: string,
  options: {pair?: readonly [string, string]; set?: SetSelection} = {}): Promise<RatedCatalog> {
  if (options.pair && options.set) bad('options', 'choose either --pair or --set, not both');
  const source = await realpath(sourceDirectory), output = resolve(outputDirectory);
  // Resolve existing parents before creating anything: a junction can make a
  // lexically external destination (including missing parents) enter the export.
  let ancestor = dirname(output);
  const missing: string[] = [basename(output)];
  for (;;) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      missing.unshift(basename(ancestor));
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  const destination = resolve(ancestor, ...missing), fromSource = relative(source, destination);
  if (!fromSource || (!isAbsolute(fromSource) && fromSource !== '..' && !fromSource.startsWith(`..${sep}`))) {
    bad('output', 'output must be outside the source export');
  }
  if (await lstat(output).then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; })) {
    bad('output', 'OUTPUT_EXISTS: choose a new directory');
  }
  const read = await sourceReader(source);
  const root = obj(parseJson(await read('manifest.json', RATED_INTAKE_LIMITS.jsonBytes), 'manifest.json'), 'manifest.json');
  if (root.schema_version !== RATED_EXPORT_VERSION || !Array.isArray(root.sets) || root.sets.length !== 3) {
    bad('manifest.json', 'expected music-studio.rated-export.v1 with exactly love, like and dislike sets');
  }
  await mkdir(dirname(output), {recursive: true});
  const scratch = join(dirname(output), `.rated-${randomUUID()}`);
  await mkdir(scratch);
  const catalog: RatedCatalog = {schema_version: RATED_CATALOG_VERSION, takes: [], pair: null, set: null, limits: [
    'Private inventory preserves original audio and recipe bytes and their hashes; no audio is published.',
    'Ratings are owner taste labels. Dislikes are retained as negative examples and never selected automatically.',
    'Requested tempo/key are not measured facts; ratings establish no rights, listening review or musical quality.',
    'Optional pair is explicit local unreviewed audition: requested 4/4 grid at frame zero, zero-overlap cut; outgoing tail may be cut.',
    'Technical import and hash checks only. Listening: NOT TESTED.',
    'Inventory file facts and duration are recorded from the export; PCM format and duration are independently checked for the selected pair or set only.',
  ]};
  if (options.set) {
    catalog.limits.push('Optional set is explicit local unreviewed material: love/like takes only, requested grid per take (BPMs may differ), no authored routes; the DJ decides transitions later. The current browser loader cannot yet play a set.');
  }
  const groups = new Set<TakeRating>(), ids = new Set<string>();
  try {
    for (const entry of root.sets) {
      const set = obj(entry, 'sets[]'), group = rating(set.rating, 'sets[].rating');
      if (groups.has(group) || set.manifest !== `${group}/manifest.json`) bad('sets[]', 'duplicate rating or unexpected set manifest path');
      groups.add(group);
      const manifest = obj(parseJson(await read(`${group}/manifest.json`, RATED_INTAKE_LIMITS.jsonBytes), `${group}/manifest.json`), group);
      if (manifest.schema_version !== 'music-studio.rated-set.v1' || manifest.rating !== group || !Array.isArray(manifest.takes)) bad(group, 'expected matching rated-set manifest');
      for (const raw of manifest.takes) {
        const take = metadata(raw, `${group}.takes[]`, group), folded = take.id.toLowerCase();
        if (ids.has(folded) || catalog.takes.length >= RATED_INTAKE_LIMITS.takes) bad(take.id, 'duplicate take id or too many takes');
        ids.add(folded);
        for (const kind of ['audio', 'recipe', 'dj_audio'] as const) {
          const file = take[kind], sourcePath = `${group}/${file.path}`;
          const max = kind === 'recipe' ? RATED_INTAKE_LIMITS.jsonBytes : RATED_INTAKE_LIMITS.fileBytes;
          const bytes = await read(sourcePath, max);
          if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) bad(sourcePath, 'HASH_MISMATCH or byte length mismatch');
          if (kind === 'recipe') obj(parseJson(bytes, sourcePath), sourcePath);
          const path = `inventory/${sourcePath}`;
          await mkdir(dirname(join(scratch, ...path.split('/'))), {recursive: true});
          await writeFile(join(scratch, ...path.split('/')), bytes);
          take[kind] = {...file, path};
        }
        catalog.takes.push(take);
      }
    }
    if (options.pair) await buildPair(scratch, catalog, options.pair);
    if (options.set) await buildSet(scratch, catalog, options.set);
    await writeFile(join(scratch, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    // A new output only: never overwrite a previous owner's inventory.
    if (await lstat(output).then(() => true, () => false)) bad('output', 'OUTPUT_EXISTS: output appeared during import');
    await rename(scratch, output);
    return catalog;
  } catch (error) { await rm(scratch, {recursive: true, force: true}); throw error; }
}
