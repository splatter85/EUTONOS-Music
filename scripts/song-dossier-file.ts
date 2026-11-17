/**
 * Durable, local-only store for song dossiers: one JSON file per song, analysis version and tempo hint
 * in `<root>/local/song-dossiers/<id>.json` (the repo's git-ignored `/local/`). The phone relay's
 * loopback DJ side is the only writer. Same safety rules as the ratings file
 * (`transition-feedback-file.ts`): directories are created one component at a time and refused if any
 * is a symlink or junction; an existing target that is not a plain file is refused; files are opened
 * with O_NOFOLLOW where the OS has it; a write goes to a temporary file in the same folder and is
 * renamed over the target, so a reader never sees half a dossier. Per-dossier and whole-store caps.
 * Errors carry a code and a fixed message, never a path.
 */
import {constants} from 'node:fs';
import {lstat, mkdir, open, readdir, rename, unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dossierId, isDossierId, parseSongDossier, SONG_DOSSIER_LIMITS, type DossierIndexEntry, type SongDossier} from '../web/song-dossier.js';

export const DOSSIER_DIR_SEGMENTS = ['local', 'song-dossiers'] as const;
export const DOSSIER_FILE_LIMITS = Object.freeze({maxFileBytes: SONG_DOSSIER_LIMITS.maxBytes, maxFiles: 512, maxTotalBytes: 32 * 1024 * 1024});
export const defaultDossierRoot = fileURLToPath(new URL('../../', import.meta.url));

export type DossierFileErrorCode = 'unsafe' | 'full' | 'too-large' | 'invalid' | 'bad-id';
export class DossierFileError extends Error {
  constructor(readonly code: DossierFileErrorCode, message: string) { super(message); }
}
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const FILE_NAME = /^([0-9a-f]{64}_[a-z0-9-]{1,80}_(?:none|\d{1,4}p\d{3})_(?:none|\d{1,5}p\d{3}))\.json$/;
const enoent = (error: NodeJS.ErrnoException): null => { if (error.code === 'ENOENT') return null; throw error; };

export class SongDossierFile {
  private queue: Promise<unknown> = Promise.resolve();
  readonly directory: string;

  constructor(readonly root: string = defaultDossierRoot) {
    this.directory = join(resolve(root), ...DOSSIER_DIR_SEGMENTS);
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
  /** `create` false (reads) never makes folders; a missing folder just means no dossiers yet. */
  private async ensureDirectory(create: boolean): Promise<boolean> {
    let current = resolve(this.root);
    for (const segment of DOSSIER_DIR_SEGMENTS) {
      current = join(current, segment);
      let info = await lstat(current).catch(enoent);
      if (!info) {
        if (!create) return false;
        await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
        info = await lstat(current);
      }
      if (info.isSymbolicLink() || !info.isDirectory()) throw new DossierFileError('unsafe', `${segment} is not a plain directory.`);
    }
    return true;
  }
  private pathOf(id: string): string { return join(this.directory, `${id}.json`); }
  /** Plain dossier files only: others (links, folders, stray names) are ignored and never read. */
  private async files(): Promise<{id: string; bytes: number; mtime: Date}[]> {
    const out: {id: string; bytes: number; mtime: Date}[] = [];
    for (const name of await readdir(this.directory)) {
      const match = FILE_NAME.exec(name);
      if (!match) continue;
      const info = await lstat(join(this.directory, name)).catch(enoent);
      if (info?.isFile() && !info.isSymbolicLink()) out.push({id: match[1]!, bytes: info.size, mtime: info.mtime});
    }
    return out;
  }

  /** Validates, then atomically creates or replaces the file for this dossier's key. */
  async put(value: unknown): Promise<{id: string; replaced: boolean; bytes: number; files: number}> {
    let dossier: SongDossier, id: string;
    try { dossier = parseSongDossier(value); id = dossierId(dossier.key); }
    catch (error) { throw new DossierFileError('invalid', error instanceof Error ? error.message.slice(0, 160) : 'Invalid song dossier'); }
    const body = Buffer.from(JSON.stringify(dossier) + '\n');
    if (body.byteLength > DOSSIER_FILE_LIMITS.maxFileBytes) throw new DossierFileError('too-large', 'The dossier is too large.');
    return this.serialize(async () => {
      await this.ensureDirectory(true);
      const target = this.pathOf(id);
      const existing = await lstat(target).catch(enoent);
      if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new DossierFileError('unsafe', 'The dossier file is not a plain file.');
      const all = await this.files();
      const others = all.filter(f => f.id !== id);
      if (!existing && all.length >= DOSSIER_FILE_LIMITS.maxFiles) throw new DossierFileError('full', 'The dossier store is full.');
      if (others.reduce((sum, f) => sum + f.bytes, 0) + body.byteLength > DOSSIER_FILE_LIMITS.maxTotalBytes) throw new DossierFileError('full', 'The dossier store is full.');
      const temporary = join(this.directory, `tmp-${randomBytes(8).toString('hex')}.part`);
      try {
        const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, 0o600);
        try { await handle.writeFile(body); await handle.sync().catch(() => undefined); } finally { await handle.close(); }
        await rename(temporary, target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return {id, replaced: existing !== null, bytes: body.byteLength, files: others.length + 1};
    });
  }

  /** One dossier by id, validated; null when absent. An unreadable or mismatched file is `invalid`. */
  get(id: string): Promise<SongDossier | null> {
    if (!isDossierId(id)) return Promise.reject(new DossierFileError('bad-id', 'Invalid dossier id.'));
    return this.serialize(async () => {
      if (!await this.ensureDirectory(false)) return null;
      const target = this.pathOf(id);
      const info = await lstat(target).catch(enoent);
      if (!info) return null;
      if (info.isSymbolicLink() || !info.isFile()) throw new DossierFileError('unsafe', 'The dossier file is not a plain file.');
      if (info.size > DOSSIER_FILE_LIMITS.maxFileBytes) throw new DossierFileError('invalid', 'The stored dossier is too large.');
      const handle = await open(target, constants.O_RDONLY | NO_FOLLOW);
      try {
        if (!(await handle.stat()).isFile()) throw new DossierFileError('unsafe', 'The dossier file is not a plain file.');
        const text = await handle.readFile({encoding: 'utf8'});
        let dossier: SongDossier;
        try { dossier = parseSongDossier(JSON.parse(text)); } catch { throw new DossierFileError('invalid', 'The stored dossier is not valid.'); }
        if (dossierId(dossier.key) !== id) throw new DossierFileError('invalid', 'The stored dossier does not match its id.');
        return dossier;
      } finally { await handle.close(); }
    });
  }

  /** Cheap index from file names and sizes only (no dossier is parsed), newest first. */
  list(): Promise<{entries: DossierIndexEntry[]; files: number; bytes: number}> {
    return this.serialize(async () => {
      if (!await this.ensureDirectory(false)) return {entries: [], files: 0, bytes: 0};
      const files = (await this.files()).sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      return {files: files.length, bytes: files.reduce((sum, f) => sum + f.bytes, 0),
        entries: files.map(f => ({id: f.id, sha256: f.id.slice(0, 64), analysis: f.id.slice(65).split('_')[0]!, bytes: f.bytes, at: f.mtime.toISOString()}))};
    });
  }
}
