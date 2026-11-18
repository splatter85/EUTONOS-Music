/**
 * DJ song sources service (phone relay side). Builds the DJ's song pool as the UNION of the ticked sources and serves it
 * as a virtual `em.audio-pack.v0` set pack (requested-not-measured grid, routes [], eligibility 'unreviewed',
 * transition 'none-authored (DJ decides)'). Everything is READ-ONLY toward the sources: nothing is written, moved or
 * deleted outside `local/dj-sources/` (the stores and our own Music Studio audio cache).
 *
 * Safety model: the browser never supplies a path. Songs are served by opaque id (`src-` plus 32 hex of the audio's
 * SHA-256) and every serve re-reads the file through a no-follow handle, re-checks it is still a plain file inside its
 * allow-listed root and re-hashes it against the scan, so a file swapped after the scan is refused (409), not served.
 * Only WAV is accepted: the pack contract carries PCM16 WAV only, and no codec is invented here.
 *
 * Unrated folder songs are playable and labelled unrated, kept apart from loved/liked. A disliked song is never in the
 * pool; it stays in the DJ-side ratings file (and in Music Studio) as a negative example, with an Undo.
 */
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, open, readdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {basename, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readPcm16Wav, type PcmInfo} from '../src/audio.js';
import {MAX_AUDIO_BYTES, quartersToFrames, validatePackManifest} from '../src/pack.js';
import {packReader} from '../src/node.js';
import {FIXED_SOURCES, FOLDER_ID, SOURCES_LIMITS, defaultSourcesDoc, isTicked, RATING_WORDS, type DislikedSong, type PoolSong, type PoolStatus,
  type RateAction, type SongRating, type SourceKind, type SourcesView, type SourceStatus} from '../web/dj-sources.js';
import {RatingsFile, SourcesFile, SourcesFileError, type RatingEntry, type RatingsDoc} from './dj-sources-file.js';
import {SourcePathError, ensureSafeDirs, isInside, isUnsafeName, realNative, validateFolderPath} from './dj-sources-path.js';

export class SourcesError extends Error {
  constructor(readonly code: 'studio-down' | 'studio-refused' | 'unknown-song' | 'invalid' | 'changed' | 'not-ready', message: string) { super(message); }
}
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const STUDIO_BASE = 'http://127.0.0.1:7870';
export const PACK_SOURCES: Readonly<Record<string, readonly string[]>> = {
  'pack-fl': ['local', 's09-fl', 'pack'], 'pack-mock-fl': ['dist', 'generated', 's06-mock-fl', 'pack'], 'pack-rated': ['local', 's16-rated', 'pack'],
};
const SCAN_LIMITS = Object.freeze({maxDepth: 3, maxEntries: 5000, staleMs: 5000, hashCacheEntries: 3000, listBytes: 1024 * 1024,
  studioListMs: 2000, studioAudioMs: 60_000, maxStudioTakes: 4096});
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.aif', '.aiff', '.wma', '.mp4']);
const digest = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const foldCase = (p: string): string => process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;
const cleanText = (value: string, max: number): string => value.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const assetIdOf = (sha256: string): string => `src-${sha256.slice(0, 32)}`;

/** Where a candidate's bytes live; re-verified on every serve. */
type Locator =
  | {readonly kind: 'file'; readonly root: string; readonly path: string; readonly size: number}
  | {readonly kind: 'pack'; readonly dir: string; readonly rel: string; readonly size: number};
interface Candidate {
  readonly sourceId: string;
  readonly sourceLabel: string;
  readonly title: string;
  readonly sha256: string;
  readonly rating: SongRating;
  readonly takeId?: string;
  readonly bpm: number;
  readonly tempoSource: 'requested' | 'placeholder';
  readonly pcm: Pick<PcmInfo, 'sample_rate' | 'channels' | 'frames'>;
  /** Pack songs keep their authored timing; others get the requested grid at frame zero. */
  readonly timing: {readonly bars: number; readonly phrase_bars: number; readonly first_downbeat_frame: number};
  readonly key: string | null;
  readonly locator: Locator;
}
interface SourceRun { available: boolean; message: string; candidates: Candidate[] | null }
interface ValidatedFile { readonly sha256: string; readonly pcm: PcmInfo; readonly bytes: number }

/** Reads a plain file through a no-follow handle with a hard size bound; the size must match `expected` when given. */
async function readBounded(path: string, max: number, expected?: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > max || (expected !== undefined && info.size !== expected)) throw new SourcesError('changed', 'A source file changed.');
    const data = Buffer.allocUnsafe(info.size + 1);
    let count = 0;
    while (count < data.length) {
      const got = await handle.read(data, count, data.length - count, count);
      if (!got.bytesRead) break;
      count += got.bytesRead;
    }
    if (count !== info.size) throw new SourcesError('changed', 'A source file changed while it was read.');
    return data.subarray(0, count);
  } finally { await handle.close(); }
}
/** Filename tempo hint ("track 120bpm.wav", "bpm_98"); anything outside 60-180 is ignored. */
export function tempoFromName(name: string): number | null {
  const m = /(\d{2,3}(?:\.\d{1,2})?)[\s_-]*bpm|bpm[\s_-]*(\d{2,3}(?:\.\d{1,2})?)/i.exec(name);
  const value = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(value) && value >= 60 && value <= 180 ? value : null;
}
export const PLACEHOLDER_BPM = 120;
const bodyBars = (frames: number, bpm: number, rate: number): number => Math.floor(frames * bpm / (240 * rate));

export interface DjSourcesOptions {
  /** Repository (or test) root holding `local/` and the pack folders. */
  readonly root?: string;
  readonly studioBase?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

export class DjSources {
  private readonly root: string;
  private readonly sourcesFile: SourcesFile;
  private readonly ratingsFile: RatingsFile;
  private readonly studioBase: string;
  private readonly doFetch: typeof fetch;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private readonly hashCache = new Map<string, ValidatedFile>();
  private readonly runs = new Map<string, SourceRun>();
  private pool: {songs: PoolSong[]; byId: Map<string, Candidate>; rev: string; ok: boolean; message: string; disliked: DislikedSong[]} =
    {songs: [], byId: new Map(), rev: 'none', ok: false, message: 'Not scanned yet.', disliked: []};
  private inflight: Promise<void> | null = null;
  private again = false;
  private lastScanEnd = 0;
  private scanning = false;
  /** Resolves after the first scan's local phase (packs and folders), so the manifest never answers before that. */
  private firstLocal: Promise<void>;
  private resolveFirstLocal!: () => void;
  private firstLocalDone = false;
  private ratings: RatingsDoc | null = null;

  constructor(options: DjSourcesOptions = {}) {
    this.root = resolve(options.root ?? repositoryRoot);
    this.sourcesFile = new SourcesFile(this.root);
    this.ratingsFile = new RatingsFile(this.root);
    const base = options.studioBase ?? STUDIO_BASE;
    const url = new URL(base);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Music Studio is read only from the loopback address.');
    this.studioBase = url.origin;
    this.doFetch = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? (() => undefined);
    this.firstLocal = new Promise<void>(resolveFirst => { this.resolveFirstLocal = resolveFirst; });
  }

  /** The stored sources; a damaged file reads as the defaults (the next write replaces it), an unsafe folder is refused. */
  private async readDoc(): Promise<Awaited<ReturnType<SourcesFile['read']>>> {
    try { return await this.sourcesFile.read(); } catch (error) {
      if (error instanceof SourcesFileError && error.code !== 'unsafe') return defaultSourcesDoc();
      throw new SourcesError('invalid', 'The sources folder on the PC is not usable (it must be a plain folder).');
    }
  }

  // ---------------------------------------------------------------- file inspection
  /** Validates WAV bytes with the existing pack validator and hashes them (cached by path, size and mtime). */
  private async inspect(path: string, size: number, mtimeMs: number): Promise<ValidatedFile> {
    const key = `${foldCase(path)}|${size}|${mtimeMs}`;
    const hit = this.hashCache.get(key);
    if (hit) return hit;
    const bytes = await readBounded(path, MAX_AUDIO_BYTES, size);
    const pcm = readPcm16Wav(bytes);
    const result = {sha256: digest(bytes), pcm, bytes: bytes.byteLength};
    if (this.hashCache.size >= SCAN_LIMITS.hashCacheEntries) this.hashCache.clear();
    this.hashCache.set(key, result);
    return result;
  }
  private durationProblem(pcm: PcmInfo, bytes: number): string | null {
    const seconds = pcm.frames / pcm.sample_rate;
    if (bytes > SOURCES_LIMITS.maxFileBytes) return 'larger than 64 MiB';
    if (seconds < SOURCES_LIMITS.minSeconds) return `shorter than ${SOURCES_LIMITS.minSeconds} s`;
    if (seconds > SOURCES_LIMITS.maxSeconds) return 'longer than 20 minutes';
    // The DJ decodes one song at the output rate (up to 48 kHz) within a 128 MiB budget.
    if (Math.ceil(pcm.frames * 48000 / pcm.sample_rate) * pcm.channels * 4 > 128 * 1024 * 1024) return 'too long to decode in memory';
    return null;
  }

  // ---------------------------------------------------------------- scanning
  private async scanFolder(sourceId: string, label: string, rootPath: string, budget: {bytes: number}): Promise<SourceRun> {
    const wavs: {path: string; name: string; size: number; mtimeMs: number}[] = [];
    const skipped: string[] = [];
    let unsupported = 0, entries = 0;
    let canonicalRoot: string;
    try {
      const info = await lstat(rootPath);
      if (info.isSymbolicLink() || !info.isDirectory()) return {available: false, message: 'This folder is no longer a plain folder; it is skipped.', candidates: null};
      canonicalRoot = await realNative(rootPath);
      if (foldCase(canonicalRoot.replace(/[\\/]+$/, '')) !== foldCase(rootPath.replace(/[\\/]+$/, ''))) {
        return {available: false, message: 'This folder now goes through a link or junction; it is skipped.', candidates: null};
      }
    } catch { return {available: false, message: 'This folder was not found; it is skipped. Remove it or put it back.', candidates: null}; }
    const stack: {dir: string; depth: number}[] = [{dir: canonicalRoot, depth: 0}];
    while (stack.length) {
      const {dir, depth} = stack.pop()!;
      let names: string[];
      try { names = (await readdir(dir)).sort(); } catch { continue; }
      for (const name of names) {
        if (++entries > SCAN_LIMITS.maxEntries) return {available: true, message: `More than ${SCAN_LIMITS.maxEntries} entries in this folder tree; narrow the folder.`, candidates: []};
        if (isUnsafeName(name)) continue;
        const path = join(dir, name);
        const info = await lstat(path).catch(() => null);
        if (!info || info.isSymbolicLink()) continue; // links and junctions are never followed
        if (info.isDirectory()) { if (depth < SCAN_LIMITS.maxDepth) stack.push({dir: path, depth: depth + 1}); continue; }
        if (!info.isFile()) continue;
        const ext = extname(name).toLowerCase();
        if (ext === '.wav') wavs.push({path, name, size: info.size, mtimeMs: info.mtimeMs});
        else if (AUDIO_EXTENSIONS.has(ext)) unsupported++;
      }
    }
    if (wavs.length > SOURCES_LIMITS.maxFilesPerFolder) {
      return {available: true, candidates: [], message: `This folder has ${wavs.length} WAV files; the limit is ${SOURCES_LIMITS.maxFilesPerFolder} songs in total. Use a smaller folder or untick it.`};
    }
    wavs.sort((a, b) => (a.path < b.path ? -1 : 1));
    const candidates: Candidate[] = [];
    for (const file of wavs) {
      const skip = (why: string): void => { skipped.push(`${cleanText(file.name, 60)}: ${why}`); };
      if (file.size > SOURCES_LIMITS.maxFileBytes) { skip('larger than 64 MiB'); continue; }
      if (budget.bytes + file.size > SOURCES_LIMITS.maxScanBytes) { skip('scan size budget reached (4 GiB)'); continue; }
      let validated: ValidatedFile;
      try { validated = await this.inspect(file.path, file.size, file.mtimeMs); }
      catch (error) { skip(error instanceof SourcesError ? 'changed while reading' : 'not a valid 16-bit PCM WAV'); continue; }
      const problem = this.durationProblem(validated.pcm, validated.bytes);
      if (problem) { skip(problem); continue; }
      const hint = tempoFromName(file.name);
      const bpm = hint ?? PLACEHOLDER_BPM;
      const bars = bodyBars(validated.pcm.frames, bpm, validated.pcm.sample_rate);
      if (bars < 2) { skip('too short for two whole bars'); continue; }
      budget.bytes += file.size;
      candidates.push({sourceId, sourceLabel: label, title: cleanText(basename(file.name, extname(file.name)), 120) || 'Untitled', sha256: validated.sha256,
        rating: 'unrated', bpm, tempoSource: hint ? 'requested' : 'placeholder', pcm: validated.pcm,
        timing: {bars, phrase_bars: 1, first_downbeat_frame: 0}, key: null, locator: {kind: 'file', root: canonicalRoot, path: file.path, size: file.size}});
      await new Promise<void>(next => setImmediate(next));
    }
    const notes: string[] = [];
    if (unsupported) notes.push(`${unsupported} non-WAV audio file${unsupported === 1 ? '' : 's'} not used (only 16-bit PCM WAV; convert them to WAV)`);
    if (skipped.length) notes.push(`skipped ${skipped.length}: ${skipped.slice(0, 3).join('; ')}${skipped.length > 3 ? '; ...' : ''}`);
    return {available: true, candidates, message: notes.join('. ')};
  }

  private async scanPack(sourceId: string, label: string, segments: readonly string[], budget: {bytes: number}): Promise<SourceRun> {
    const dir = join(this.root, ...segments);
    const info = await lstat(dir).catch(() => null);
    if (!info || !info.isDirectory() || info.isSymbolicLink()) return {available: false, message: 'Not present on this PC.', candidates: null};
    try {
      const read = await packReader(dir);
      const manifestBytes = await read('manifest.json');
      if (manifestBytes.length > 1024 * 1024) throw new Error('manifest too large');
      const pack = validatePackManifest(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(manifestBytes)));
      const ratingByAsset = sourceId === 'pack-rated' ? await this.ratedCatalogRatings() : new Map<string, SongRating>();
      const candidates: Candidate[] = [];
      let skipped = 0;
      for (const asset of pack.assets) {
        if (asset.source_kind !== 'recording' || !asset.timing) { skipped++; continue; }
        const stat = await lstat(join(dir, ...asset.file.path.split('/'))).catch(() => null);
        if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size !== asset.file.bytes) { skipped++; continue; }
        if (asset.file.bytes > SOURCES_LIMITS.maxFileBytes || budget.bytes + asset.file.bytes > SOURCES_LIMITS.maxScanBytes) { skipped++; continue; }
        let validated: ValidatedFile;
        try {
          const abs = join(dir, ...asset.file.path.split('/'));
          validated = await this.inspect(abs, stat.size, stat.mtimeMs);
        } catch { skipped++; continue; }
        if (validated.sha256 !== asset.file.sha256) { skipped++; continue; }
        const problem = this.durationProblem(validated.pcm, validated.bytes);
        if (problem) { skipped++; continue; }
        budget.bytes += stat.size;
        candidates.push({sourceId, sourceLabel: label, title: cleanText(asset.title, 120) || 'Untitled', sha256: validated.sha256,
          rating: ratingByAsset.get(asset.id) ?? 'unrated', bpm: asset.timing.bpm, tempoSource: 'requested', pcm: validated.pcm,
          timing: {bars: asset.timing.bars, phrase_bars: asset.timing.phrase_bars, first_downbeat_frame: asset.timing.first_downbeat_frame},
          key: asset.key, locator: {kind: 'pack', dir, rel: asset.file.path, size: stat.size}});
      }
      return {available: true, candidates, message: skipped ? `${skipped} item${skipped === 1 ? '' : 's'} in this pack not used (samples, changed or invalid audio).` : ''};
    } catch { return {available: false, message: 'This pack could not be read or failed its checks.', candidates: null}; }
  }
  /** Ratings the rated catalogue records for its pair/set assets (love/like only by construction; dislikes are never in a pack). */
  private async ratedCatalogRatings(): Promise<Map<string, SongRating>> {
    const map = new Map<string, SongRating>();
    try {
      const path = join(this.root, 'local', 's16-rated', 'catalog.json');
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) return map;
      const catalog = JSON.parse(await readFile(path, 'utf8')) as {takes?: {id: string; rating: string}[]; set?: {take_ids: string[]; asset_ids: string[]} | null;
        pair?: {take_ids: string[]; asset_ids: string[]} | null};
      for (const group of [catalog.set, catalog.pair]) {
        group?.take_ids.forEach((takeId, index) => {
          const rating = catalog.takes?.find(t => t.id === takeId)?.rating;
          const asset = group.asset_ids[index];
          if (asset && (rating === 'love' || rating === 'like')) map.set(asset, rating);
        });
      }
    } catch { /* no catalogue: songs are unrated */ }
    return map;
  }

  // ---------------------------------------------------------------- Music Studio (read-only list, audio by id)
  private async studioJson(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.doFetch(`${this.studioBase}${path}`, {...init, redirect: 'error', signal: AbortSignal.timeout(SCAN_LIMITS.studioListMs)});
    if (!response.ok) throw new SourcesError('studio-refused', `Music Studio answered ${response.status}.`);
    const text = await response.text();
    if (text.length > SCAN_LIMITS.listBytes) throw new SourcesError('studio-refused', 'Music Studio sent too much data.');
    return JSON.parse(text);
  }
  private async studioTakes(): Promise<{id: string; title: string; rating: 'love' | 'like'; bpm: number | null; key: string | null; revision: string}[]> {
    const body = await this.studioJson('/api/takes/rated') as {schema?: string; takes?: unknown};
    if (!body || body.schema !== 'music-studio.rated-takes.v1' || !Array.isArray(body.takes)) throw new SourcesError('studio-refused', 'Unexpected Music Studio answer.');
    const takes: {id: string; title: string; rating: 'love' | 'like'; bpm: number | null; key: string | null; revision: string}[] = [];
    for (const raw of body.takes.slice(0, SCAN_LIMITS.maxStudioTakes) as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue;
      const {id, title, rating, bpm, key, revision} = raw;
      // Dislikes (and anything else) are never accepted, whatever the other side sends.
      if ((rating !== 'love' && rating !== 'like') || typeof id !== 'string' || !/^ms-\d{8}-\d{6}-[a-z0-9]{4}$/.test(id)) continue;
      if (typeof revision !== 'string' || !/^[a-f0-9]{16,64}$/.test(revision)) continue;
      takes.push({id, title: typeof title === 'string' && title.trim() ? cleanText(title, 120) : id, rating,
        bpm: typeof bpm === 'number' && Number.isFinite(bpm) && bpm >= 40 && bpm <= 240 ? bpm : null,
        key: typeof key === 'string' && key.trim() ? cleanText(key, 60) : null, revision});
    }
    return takes;
  }
  private async studioAudio(id: string, cachePath: string): Promise<void> {
    const response = await this.doFetch(`${this.studioBase}/api/takes/${id}/dj-audio`, {redirect: 'error', signal: AbortSignal.timeout(SCAN_LIMITS.studioAudioMs)});
    if (!response.ok || !response.body) throw new SourcesError('studio-refused', 'Music Studio could not render that take.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_AUDIO_BYTES) { await reader.cancel(); throw new SourcesError('studio-refused', 'A take is larger than 64 MiB.'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    readPcm16Wav(bytes); // throws on anything but consistent PCM16 WAV
    const temporary = `${cachePath}.${process.pid}.part`;
    try { await writeFile(temporary, bytes, {flag: 'wx', mode: 0o600}); await rename(temporary, cachePath); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }
  private async scanStudio(ticked: {love: boolean; like: boolean}, publish: () => void): Promise<{love: SourceRun; like: SourceRun}> {
    const down = (message: string): SourceRun => ({available: false, message, candidates: null});
    let takes;
    try { takes = await this.studioTakes(); }
    catch (error) {
      const message = error instanceof SourcesError ? `Music Studio refused: ${error.message}` :
        'Music Studio is not running (127.0.0.1:7870). Its loved and liked songs appear when it is.';
      return {love: down(message), like: down(message)};
    }
    const cacheDir = await ensureSafeDirs(this.root, ['local', 'dj-sources', 'studio-cache']);
    const runs = {love: {available: true, message: '', candidates: [] as Candidate[]} as SourceRun, like: {available: true, message: '', candidates: [] as Candidate[]} as SourceRun};
    const wanted = new Set<string>();
    let failed = 0;
    for (const take of takes) {
      const name = `${take.id}-${take.revision}.wav`;
      wanted.add(name);
      if (!ticked[take.rating]) continue;
      const path = join(cacheDir!, name);
      try {
        let info = await lstat(path).catch(() => null);
        if (!info) { await this.studioAudio(take.id, path); info = await lstat(path); }
        if (!info.isFile() || info.isSymbolicLink()) throw new SourcesError('changed', 'cache');
        const validated = await this.inspect(path, info.size, info.mtimeMs);
        const problem = this.durationProblem(validated.pcm, validated.bytes);
        if (problem) { failed++; continue; }
        const bpm = take.bpm ?? PLACEHOLDER_BPM, bars = bodyBars(validated.pcm.frames, bpm, validated.pcm.sample_rate);
        if (bars < 2) { failed++; continue; }
        const label = take.rating === 'love' ? 'Music Studio: loved' : 'Music Studio: liked';
        (runs[take.rating].candidates as Candidate[]).push({sourceId: take.rating === 'love' ? 'studio-loved' : 'studio-liked', sourceLabel: label,
          title: take.title, sha256: validated.sha256, rating: take.rating, takeId: take.id, bpm, tempoSource: take.bpm ? 'requested' : 'placeholder',
          pcm: validated.pcm, timing: {bars, phrase_bars: 1, first_downbeat_frame: 0}, key: take.key,
          locator: {kind: 'file', root: cacheDir!, path, size: info.size}});
        this.runs.set('studio-loved', {...runs.love}); this.runs.set('studio-liked', {...runs.like});
        publish();
      } catch { failed++; }
      await new Promise<void>(next => setImmediate(next));
    }
    // Our own cache only: drop copies of takes that were re-rated, renamed or removed.
    for (const name of await readdir(cacheDir!).catch(() => [] as string[])) {
      if (/^ms-\d{8}-\d{6}-[a-z0-9]{4}-[a-f0-9]{16,64}\.wav(?:\.\d+\.part)?$/.test(name) && !wanted.has(name)) await unlink(join(cacheDir!, name)).catch(() => undefined);
    }
    for (const rating of ['love', 'like'] as const) {
      const count = takes.filter(t => t.rating === rating).length;
      runs[rating].message = failed && ticked[rating] ? `${failed} take${failed === 1 ? '' : 's'} could not be fetched or checked.` : '';
      if (!count) runs[rating].message ||= 'No takes with this rating yet.';
    }
    return runs;
  }

  // ---------------------------------------------------------------- pool
  private async loadRatings(): Promise<RatingsDoc> {
    try { this.ratings = await this.ratingsFile.read(); } catch { this.ratings ??= {version: 'em.dj-ratings.v1', updatedAt: null, rev: 0, ratings: {}}; }
    return this.ratings;
  }
  private rebuildPool(doc: Awaited<ReturnType<SourcesFile['read']>>): void {
    const ratings = this.ratings?.ratings ?? {};
    const order = [...FIXED_SOURCES.map(s => s.id), ...doc.folders.map(f => f.id)];
    const songs: PoolSong[] = [];
    const byId = new Map<string, Candidate>();
    const studioTakeIds = new Set<string>();
    for (const id of order) for (const c of this.runs.get(id)?.candidates ?? []) if (c.takeId) studioTakeIds.add(c.takeId);
    for (const sourceId of order) {
      if (!isTicked(doc.ticks, sourceId)) continue;
      for (const c of this.runs.get(sourceId)?.candidates ?? []) {
        const assetId = assetIdOf(c.sha256);
        const override = c.takeId ? undefined : ratings[assetId];
        if (override?.rating === 'dislike') continue; // never playable
        const existing = songs.find(s => s.assetId === assetId);
        if (existing) {
          if (!existing.also.includes(c.sourceLabel) && existing.sourceLabel !== c.sourceLabel) (existing.also as string[]).push(c.sourceLabel);
          continue;
        }
        const rating: SongRating = override ? override.rating : c.rating;
        songs.push({assetId, title: c.title, source: c.sourceId, sourceLabel: c.sourceLabel, rating, also: [], tempoSource: c.tempoSource,
          seconds: Math.round(c.pcm.frames / c.pcm.sample_rate * 10) / 10});
        byId.set(assetId, c);
      }
    }
    const disliked: DislikedSong[] = Object.entries(ratings)
      .filter(([, entry]) => entry.rating === 'dislike' && !(entry.takeId && studioTakeIds.has(entry.takeId)))
      .map(([assetId, entry]) => ({assetId, title: entry.title, sourceLabel: entry.label, previous: entry.previous ?? 'unrated'}));
    let ok = true, message = '';
    if (songs.length > SOURCES_LIMITS.maxSongs) {
      ok = false;
      message = `The pool has ${songs.length} songs; the limit is ${SOURCES_LIMITS.maxSongs}. Untick a source or remove files; nothing was cut off.`;
    } else if (songs.length < SOURCES_LIMITS.minSongs) {
      ok = false;
      message = songs.length === 0 ? 'No playable songs yet. Tick a source that has songs (or add a folder of WAV files).' : 'Only one playable song; the DJ needs at least two.';
    } else message = `${songs.length} songs from the ticked sources.`;
    const rev = digest(JSON.stringify(songs.map(s => [s.assetId, s.title, byId.get(s.assetId)?.bpm]))).slice(0, 16);
    this.pool = {songs: ok ? songs : songs.length > SOURCES_LIMITS.maxSongs ? [] : songs, byId: ok ? byId : new Map(), rev: ok ? rev : `refused-${rev}`, ok, message, disliked};
    if (!ok) this.pool = {...this.pool, songs: songs.length > SOURCES_LIMITS.maxSongs ? [] : songs};
  }

  /** One scan of every ticked source; single-flight, a request during a scan queues exactly one more. */
  refresh(): Promise<void> {
    if (this.inflight) { this.again = true; return this.inflight; }
    this.inflight = (async () => {
      do {
        this.again = false;
        this.scanning = true;
        try { await this.scanOnce(); } catch (error) { this.log(`Sources: scan failed: ${error instanceof Error ? error.message : String(error)}`); }
        this.scanning = false;
        this.lastScanEnd = this.now();
      } while (this.again);
    })().finally(() => { this.inflight = null; this.scanning = false; this.lastScanEnd = this.now(); if (!this.firstLocalDone) { this.firstLocalDone = true; this.resolveFirstLocal(); } });
    return this.inflight;
  }
  private async scanOnce(): Promise<void> {
    const doc = await this.readDoc();
    await this.loadRatings();
    const budget = {bytes: 0};
    const active = new Set(['studio-loved', 'studio-liked', ...Object.keys(PACK_SOURCES), ...doc.folders.map(f => f.id)]);
    for (const id of [...this.runs.keys()]) if (!active.has(id)) this.runs.delete(id);
    for (const [id, segments] of Object.entries(PACK_SOURCES)) {
      const fixed = FIXED_SOURCES.find(s => s.id === id)!;
      this.runs.set(id, isTicked(doc.ticks, id) ? await this.scanPack(id, fixed.label, segments, budget) : {available: true, message: '', candidates: null});
    }
    for (const folder of doc.folders) {
      this.runs.set(folder.id, isTicked(doc.ticks, folder.id) && folder.path
        ? await this.scanFolder(folder.id, `Folder: ${folder.label}`, folder.path, budget) : {available: true, message: '', candidates: null});
    }
    this.rebuildPool(doc);
    if (!this.firstLocalDone) { this.firstLocalDone = true; this.resolveFirstLocal(); }
    const love = isTicked(doc.ticks, 'studio-loved'), like = isTicked(doc.ticks, 'studio-liked');
    if (love || like) {
      const result = await this.scanStudio({love, like}, () => this.rebuildPool(doc));
      this.runs.set('studio-loved', love ? result.love : {...result.love, candidates: null});
      this.runs.set('studio-liked', like ? result.like : {...result.like, candidates: null});
    } else { this.runs.set('studio-loved', {available: true, message: '', candidates: null}); this.runs.set('studio-liked', {available: true, message: '', candidates: null}); }
    this.rebuildPool(await this.readDoc());
  }

  // ---------------------------------------------------------------- views
  private statusList(doc: Awaited<ReturnType<SourcesFile['read']>>): SourceStatus[] {
    const status = (id: string, kind: SourceKind, label: string): SourceStatus => {
      const run = this.runs.get(id);
      return {id, kind, label, ticked: isTicked(doc.ticks, id), available: run ? run.available : true,
        songs: run?.candidates ? run.candidates.length : null, message: run?.message ?? ''};
    };
    return [...FIXED_SOURCES.map(s => status(s.id, s.kind, s.label)), ...doc.folders.map(f => status(f.id, 'folder', `Folder: ${f.label}`))];
  }
  /** The state the Studio and the phone show. A stale scan is refreshed in the background (the pages poll every few seconds). */
  async view(options: {phone?: boolean; wait?: boolean} = {}): Promise<SourcesView> {
    const stale = this.now() - this.lastScanEnd > SCAN_LIMITS.staleMs;
    if (!this.inflight && stale) void this.refresh();
    if (options.wait && this.inflight) await this.inflight;
    const doc = await this.readDoc();
    await this.loadRatings();
    const folders = doc.folders.map(f => ({id: f.id, label: f.label, ...(options.phone ? {} : {path: f.path})}));
    return {version: doc.version, updatedAt: doc.updatedAt, rev: doc.rev, ticks: doc.ticks, folders, sources: this.statusList(doc),
      pool: this.poolStatus(), songs: this.pool.songs, disliked: this.pool.disliked};
  }
  private poolStatus(): PoolStatus {
    return {ok: this.pool.ok, songs: this.pool.songs.length, rev: this.pool.rev, scanning: this.scanning, message: this.pool.message};
  }

  // ---------------------------------------------------------------- virtual pack
  async manifest(): Promise<Buffer> {
    if (!this.firstLocalDone) { if (!this.inflight) void this.refresh(); await this.firstLocal; }
    if (!this.pool.ok) throw new SourcesError('not-ready', this.pool.message);
    const assets = this.pool.songs.map(song => {
      const c = this.pool.byId.get(song.assetId)!;
      const exit = c.timing.bars * 4 - c.timing.phrase_bars * 4;
      return {id: song.assetId, revision: 1, title: c.title, source_kind: 'recording',
        file: {path: `audio/${song.assetId}.wav`, sha256: c.sha256, bytes: c.locator.size, format: 'pcm16-wav', sample_rate: c.pcm.sample_rate, channels: c.pcm.channels, frames: c.pcm.frames},
        rights: {origin: `Owner-selected local source (${c.sourceLabel}); source identity and rights unverified.`, creator: 'Not verified',
          license: 'Unreviewed, local-only audition; no redistribution grant', allowed_uses: ['playback'], evidence: 'PROVENANCE.md'},
        eligibility: 'unreviewed', genres: [], states: ['browse', 'explore', 'drive', 'surge', 'afterglow'], key: c.key, harmony_pitch_classes: null,
        timing: {bpm: c.bpm, meter: [4, 4], bars: c.timing.bars, phrase_bars: c.timing.phrase_bars, first_downbeat_frame: c.timing.first_downbeat_frame},
        cues: [{id: 'entry', kind: 'entry', position_quarters: 0}, {id: 'exit', kind: 'exit', position_quarters: Math.max(0, exit)}]};
    });
    const manifest = {schema_version: 'em.audio-pack.v0', id: 's22-song-sources', revision: 1, assets, palettes: [], recipes: [], routes: []};
    validatePackManifest(manifest); // never serve a manifest the loader would refuse
    return Buffer.from(JSON.stringify(manifest) + '\n');
  }
  provenance(): Buffer {
    return Buffer.from('Owner-selected local song sources: unreviewed, local-only. Not a rights certification; no redistribution or sample reuse is granted.\n' +
      'Ratings are owner taste labels, not listening review. Dislikes are never selected.\n' +
      '4/4, frame-zero downbeat and a requested or placeholder tempo; the DJ measures the real grid. Listening: NOT TESTED.\n');
  }
  /** The song's bytes, re-read and re-hashed now. A changed, moved or swapped file is refused and triggers a rescan. */
  async readAudio(assetId: string): Promise<Buffer> {
    const c = this.pool.byId.get(assetId);
    if (!c) throw new SourcesError('unknown-song', 'Unknown song.');
    try {
      let bytes: Buffer;
      if (c.locator.kind === 'file') {
        const {path, root, size} = c.locator;
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isFile()) throw new SourcesError('changed', 'not a plain file');
        const real = await realNative(path);
        if (foldCase(real) !== foldCase(path) || !isInside(root, real)) throw new SourcesError('changed', 'moved');
        bytes = await readBounded(path, MAX_AUDIO_BYTES, size);
      } else {
        const read = await packReader(c.locator.dir);
        bytes = Buffer.from(await read(c.locator.rel));
        if (bytes.byteLength !== c.locator.size) throw new SourcesError('changed', 'size');
      }
      if (digest(bytes) !== c.sha256) throw new SourcesError('changed', 'hash');
      return bytes;
    } catch (error) {
      void this.refresh();
      if (error instanceof SourcesError && error.code === 'unknown-song') throw error;
      throw new SourcesError('changed', 'That song changed on disk since the last scan; the pool is refreshing.');
    }
  }

  // ---------------------------------------------------------------- changes
  async setTicks(patch: Readonly<Record<string, boolean>>): Promise<SourcesView> {
    try { await this.sourcesFile.setTicks(patch); } catch (error) { throw this.translate(error); }
    await this.forceRefresh();
    return this.view({wait: false});
  }
  async addFolder(input: unknown): Promise<SourcesView> {
    let folder;
    try { folder = await validateFolderPath(input); } catch (error) { throw this.translate(error); }
    // A folder inside or containing an existing root would double-count files; refuse it plainly.
    const doc = await this.readDoc();
    for (const f of doc.folders) if (f.path && (isInside(f.path, folder.canonical) || isInside(folder.canonical, f.path)) && f.id !== folder.id) {
      throw new SourcesError('invalid', 'That folder overlaps one that is already added.');
    }
    try { await this.sourcesFile.addFolder({id: folder.id, label: folder.label, path: folder.canonical}); } catch (error) { throw this.translate(error); }
    await this.forceRefresh();
    return this.view({wait: false});
  }
  /** Removes the folder from the allow-list. Files on disk are never touched. */
  async removeFolder(id: unknown): Promise<SourcesView> {
    if (typeof id !== 'string' || !FOLDER_ID.test(id)) throw new SourcesError('invalid', 'Unknown folder.');
    try { await this.sourcesFile.removeFolder(id); } catch (error) { throw this.translate(error); }
    await this.forceRefresh();
    return this.view({wait: false});
  }
  private async forceRefresh(): Promise<void> {
    this.again = true;
    if (!this.inflight) { this.again = false; }
    await this.refresh();
  }
  private translate(error: unknown): Error {
    if (error instanceof SourcesError) return error;
    if (error instanceof SourcePathError) return new SourcesError('invalid', error.message);
    if (error instanceof SourcesFileError) return new SourcesError('invalid', error.message);
    return error instanceof Error ? error : new Error(String(error));
  }
  private async studioRate(takeId: string, rating: RateAction): Promise<void> {
    try {
      const response = await this.doFetch(`${this.studioBase}/api/takes/${takeId}`, {method: 'PATCH', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({rating}), redirect: 'error', signal: AbortSignal.timeout(SCAN_LIMITS.studioListMs)});
      if (!response.ok) throw new SourcesError('studio-refused', `Music Studio refused the rating (${response.status}).`);
    } catch (error) {
      if (error instanceof SourcesError) throw error;
      throw new SourcesError('studio-down', 'Music Studio is not running, so this rating was not saved. Start it and try again.');
    }
  }
  /**
   * Rates (or with `null` clears) one song. Music Studio songs write back to Music Studio, so both stay in sync; folder and
   * pack songs are stored DJ-side by audio hash. A dislike removes the song from the pool at once and keeps it as a
   * negative example; rating a disliked song `null` (Undo) restores what it was.
   */
  async rate(assetId: unknown, action: RateAction): Promise<SourcesView> {
    if (typeof assetId !== 'string' || !/^src-[0-9a-f]{32}$/.test(assetId)) throw new SourcesError('invalid', 'Unknown song.');
    const ratings = (await this.loadRatings()).ratings;
    const memory = ratings[assetId];
    const live = this.pool.byId.get(assetId), song = this.pool.songs.find(s => s.assetId === assetId);
    if (memory?.rating === 'dislike' && !live) {
      // Undo (null) restores the previous rating; a love/like chosen directly sets that rating.
      const target: SongRating | null = action === null ? (memory.previous && memory.previous !== 'unrated' ? memory.previous : null) : action === 'dislike' ? null : action;
      if (action === 'dislike') return this.view();
      if (memory.takeId) await this.studioRate(memory.takeId, target);
      else if (target) await this.ratingsFile.set(assetId, {rating: target, title: memory.title, label: memory.label});
      if (!(memory.takeId === undefined && target)) await this.ratingsFile.set(assetId, null);
    } else if (live && song) {
      const entry = (rating: RatingEntry['rating']): RatingEntry => ({rating, title: song.title, label: song.sourceLabel,
        ...(rating === 'dislike' ? {previous: song.rating} : {}), ...(live.takeId ? {takeId: live.takeId} : {})});
      if (live.takeId) {
        await this.studioRate(live.takeId, action);
        if (action === 'dislike') await this.ratingsFile.set(assetId, entry('dislike'));
        else await this.ratingsFile.set(assetId, null);
      } else if (action === null) await this.ratingsFile.set(assetId, null);
      else await this.ratingsFile.set(assetId, entry(action));
    } else throw new SourcesError('unknown-song', 'That song is not in the pool any more.');
    await this.loadRatings();
    await this.forceRefresh();
    return this.view();
  }
}
export {RATING_WORDS};
