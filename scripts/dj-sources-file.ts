/**
 * Durable, local-only stores for the DJ song sources, in the repo's git-ignored `local/dj-sources/`:
 *  - `sources.json`: the source ticks and the folder allow-list (written only by the phone relay);
 *  - `ratings.json`: DJ-side ratings of folder and pack songs, keyed by the song's audio-hash id, plus the dislike
 *    memory (a disliked song stays here as a negative example so an Undo can restore it).
 * Same discipline as the booth settings file: directories created one component at a time and refused if any is a
 * symlink or junction, a target that is not a plain file is refused, O_NOFOLLOW where the OS has it, a write goes to a
 * temporary file in the same folder and is renamed over the target, a size cap applies, errors carry a code and a fixed
 * message and never a path.
 */
import {constants} from 'node:fs';
import {lstat, mkdir, open, rename, unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ASSET_ID, SOURCES_ENVELOPE, SOURCES_LIMITS, SONG_RATINGS, defaultSourcesDoc, isSourceId, parseSourcesDoc,
  type SongRating, type SourceFolder, type SourcesDoc} from '../web/dj-sources.js';

export const SOURCES_DIR_SEGMENTS = ['local', 'dj-sources'] as const;
export const SOURCES_FILE_LIMITS = Object.freeze({maxSourcesBytes: 32 * 1024, maxRatingsBytes: 1024 * 1024});
export const defaultSourcesRoot = fileURLToPath(new URL('../../', import.meta.url));
export const RATINGS_ENVELOPE = 'em.dj-ratings.v1' as const;

export type SourcesFileErrorCode = 'unsafe' | 'too-large' | 'invalid' | 'full';
export class SourcesFileError extends Error {
  constructor(readonly code: SourcesFileErrorCode, message: string) { super(message); }
}
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const enoent = (error: NodeJS.ErrnoException): null => { if (error.code === 'ENOENT') return null; throw error; };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** One JSON document in `local/dj-sources/`, serialized writes, atomic replace. */
class JsonDoc<T extends {readonly rev: number; readonly updatedAt: string | null}> {
  private queue: Promise<unknown> = Promise.resolve();
  readonly directory: string;
  constructor(readonly root: string, private readonly name: string, private readonly maxBytes: number,
    private readonly parse: (value: unknown) => T, private readonly empty: () => T) {
    this.directory = join(resolve(root), ...SOURCES_DIR_SEGMENTS);
  }
  serialize<R>(work: () => Promise<R>): Promise<R> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private async ensureDirectory(create: boolean): Promise<boolean> {
    let current = resolve(this.root);
    for (const segment of SOURCES_DIR_SEGMENTS) {
      current = join(current, segment);
      let info = await lstat(current).catch(enoent);
      if (!info) {
        if (!create) return false;
        await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
        info = await lstat(current);
      }
      if (info.isSymbolicLink() || !info.isDirectory()) throw new SourcesFileError('unsafe', `${segment} is not a plain directory.`);
    }
    return true;
  }
  private get target(): string { return join(this.directory, this.name); }
  async readStored(): Promise<T | null> {
    if (!await this.ensureDirectory(false)) return null;
    const info = await lstat(this.target).catch(enoent);
    if (!info) return null;
    if (info.isSymbolicLink() || !info.isFile()) throw new SourcesFileError('unsafe', 'The file is not a plain file.');
    if (info.size > this.maxBytes) throw new SourcesFileError('too-large', 'The stored file is too large.');
    const handle = await open(this.target, constants.O_RDONLY | NO_FOLLOW);
    try {
      if (!(await handle.stat()).isFile()) throw new SourcesFileError('unsafe', 'The file is not a plain file.');
      const text = await handle.readFile({encoding: 'utf8'});
      try { return this.parse(JSON.parse(text)); } catch { throw new SourcesFileError('invalid', 'The stored file is not valid.'); }
    } finally { await handle.close(); }
  }
  read(): Promise<T> { return this.serialize(async () => (await this.readStored()) ?? this.empty()); }
  /** `change` gets the current document (or the empty one) and returns the next body; `rev` and `updatedAt` are set here. */
  update(change: (current: T) => Omit<T, 'rev' | 'updatedAt'>, now: Date): Promise<T> {
    return this.serialize(async () => {
      await this.ensureDirectory(true);
      let current: T | null = null;
      try { current = await this.readStored(); } catch (error) {
        // A damaged file is replaced by a valid write; an unsafe one is never touched.
        if (!(error instanceof SourcesFileError) || error.code === 'unsafe') throw error;
      }
      const base = current ?? this.empty();
      const next = {...change(base), rev: Math.min(1_000_000_000, base.rev + 1), updatedAt: now.toISOString()} as unknown as T;
      const body = Buffer.from(JSON.stringify(next) + '\n');
      if (body.byteLength > this.maxBytes) throw new SourcesFileError('too-large', 'The file would be too large.');
      const existing = await lstat(this.target).catch(enoent);
      if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new SourcesFileError('unsafe', 'The file is not a plain file.');
      const temporary = join(this.directory, `tmp-${randomBytes(8).toString('hex')}.part`);
      try {
        const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, 0o600);
        try { await handle.writeFile(body); await handle.sync().catch(() => undefined); } finally { await handle.close(); }
        await rename(temporary, this.target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return next;
    });
  }
}

/** Sources file: ticks and folder allow-list. */
export class SourcesFile {
  private readonly doc: JsonDoc<SourcesDoc>;
  constructor(root: string = defaultSourcesRoot) {
    this.doc = new JsonDoc(root, 'sources.json', SOURCES_FILE_LIMITS.maxSourcesBytes, parseSourcesDoc, defaultSourcesDoc);
  }
  get directory(): string { return this.doc.directory; }
  read(): Promise<SourcesDoc> { return this.doc.read(); }
  setTicks(patch: Readonly<Record<string, boolean>>, now = new Date()): Promise<SourcesDoc> {
    return this.doc.update(current => {
      const folderIds = new Set(current.folders.map(f => f.id));
      for (const id of Object.keys(patch)) if (!isSourceId(id) || (id.startsWith('folder-') && !folderIds.has(id))) {
        throw new SourcesFileError('invalid', 'That source is not on the list.');
      }
      return {version: SOURCES_ENVELOPE, ticks: {...current.ticks, ...patch}, folders: current.folders};
    }, now);
  }
  addFolder(folder: SourceFolder & {path: string}, now = new Date()): Promise<SourcesDoc> {
    return this.doc.update(current => {
      if (current.folders.some(f => f.id === folder.id)) throw new SourcesFileError('invalid', 'That folder is already on the list.');
      if (current.folders.length >= SOURCES_LIMITS.maxFolders) throw new SourcesFileError('full', `At most ${SOURCES_LIMITS.maxFolders} folders can be added; remove one first.`);
      return {version: SOURCES_ENVELOPE, ticks: {...current.ticks, [folder.id]: true}, folders: [...current.folders, {id: folder.id, label: folder.label, path: folder.path}]};
    }, now);
  }
  /** Removes a folder from the allow-list only; no file is touched. */
  removeFolder(id: string, now = new Date()): Promise<SourcesDoc> {
    return this.doc.update(current => {
      if (!current.folders.some(f => f.id === id)) throw new SourcesFileError('invalid', 'That folder is not on the list.');
      const ticks = {...current.ticks}; delete ticks[id];
      return {version: SOURCES_ENVELOPE, ticks, folders: current.folders.filter(f => f.id !== id)};
    }, now);
  }
}

/** One DJ-side rating entry. `previous` is what Undo restores after a dislike; `takeId` links a Music Studio take. */
export interface RatingEntry {
  readonly rating: 'love' | 'like' | 'dislike';
  readonly title: string;
  readonly label: string;
  readonly previous?: SongRating;
  readonly takeId?: string;
}
export interface RatingsDoc {
  readonly version: typeof RATINGS_ENVELOPE;
  readonly updatedAt: string | null;
  readonly rev: number;
  readonly ratings: Readonly<Record<string, RatingEntry>>;
}
const TAKE_ID = /^ms-\d{8}-\d{6}-[a-z0-9]{4}$/;
export const emptyRatings = (): RatingsDoc => ({version: RATINGS_ENVELOPE, updatedAt: null, rev: 0, ratings: {}});
export function parseRatingsDoc(value: unknown): RatingsDoc {
  if (!isRecord(value) || value.version !== RATINGS_ENVELOPE) throw new Error('envelope');
  if (Object.keys(value).some(k => !['version', 'updatedAt', 'rev', 'ratings'].includes(k))) throw new Error('unknown field');
  const {updatedAt, rev} = value;
  if (updatedAt !== null && !(typeof updatedAt === 'string' && ISO_TIME.test(updatedAt) && !Number.isNaN(Date.parse(updatedAt)))) throw new Error('updatedAt');
  if (!Number.isSafeInteger(rev) || (rev as number) < 0 || (rev as number) > 1_000_000_000) throw new Error('rev');
  if (!isRecord(value.ratings) || Object.keys(value.ratings).length > SOURCES_LIMITS.maxRatings) throw new Error('ratings');
  const ratings: Record<string, RatingEntry> = {};
  for (const [id, raw] of Object.entries(value.ratings)) {
    if (!ASSET_ID.test(id) || !isRecord(raw) || Object.keys(raw).some(k => !['rating', 'title', 'label', 'previous', 'takeId'].includes(k))) throw new Error('entry');
    if (!['love', 'like', 'dislike'].includes(raw.rating as string)) throw new Error('rating');
    const text = (v: unknown, max: number): string => { if (typeof v !== 'string' || !v.length || v.length > max || /[\x00-\x1f\x7f]/.test(v)) throw new Error('text'); return v; };
    if (raw.previous !== undefined && !SONG_RATINGS.includes(raw.previous as SongRating)) throw new Error('previous');
    if (raw.takeId !== undefined && (typeof raw.takeId !== 'string' || !TAKE_ID.test(raw.takeId))) throw new Error('takeId');
    ratings[id] = {rating: raw.rating as RatingEntry['rating'], title: text(raw.title, 200), label: text(raw.label, 80),
      ...(raw.previous !== undefined ? {previous: raw.previous as SongRating} : {}), ...(raw.takeId !== undefined ? {takeId: raw.takeId as string} : {})};
  }
  return {version: RATINGS_ENVELOPE, updatedAt: updatedAt as string | null, rev: rev as number, ratings};
}
export class RatingsFile {
  private readonly doc: JsonDoc<RatingsDoc>;
  constructor(root: string = defaultSourcesRoot) {
    this.doc = new JsonDoc(root, 'ratings.json', SOURCES_FILE_LIMITS.maxRatingsBytes, parseRatingsDoc, emptyRatings);
  }
  read(): Promise<RatingsDoc> { return this.doc.read(); }
  /** Sets (or with `entry === null` clears) the entry for one song id. */
  set(assetId: string, entry: RatingEntry | null, now = new Date()): Promise<RatingsDoc> {
    if (!ASSET_ID.test(assetId)) return Promise.reject(new SourcesFileError('invalid', 'Unknown song.'));
    return this.doc.update(current => {
      const ratings = {...current.ratings};
      if (entry === null) delete ratings[assetId]; else ratings[assetId] = entry;
      if (Object.keys(ratings).length > SOURCES_LIMITS.maxRatings) throw new SourcesFileError('full', 'Too many stored ratings.');
      try { parseRatingsDoc({version: RATINGS_ENVELOPE, updatedAt: null, rev: 0, ratings}); } catch { throw new SourcesFileError('invalid', 'That rating is not valid.'); }
      return {version: RATINGS_ENVELOPE, ratings};
    }, now);
  }
}
