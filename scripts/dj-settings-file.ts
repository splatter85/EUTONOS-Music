/**
 * Durable, local-only store for the DJ booth settings: one small JSON file,
 * `<root>/local/dj-settings/settings.json` (the repo's git-ignored `/local/`). The phone relay is the only writer.
 * Same safety rules as the dossier and ratings files: directories are created one component at a time and
 * refused if any is a symlink or junction; an existing target that is not a plain file is refused; files are opened
 * with O_NOFOLLOW where the OS has it; a write goes to a temporary file in the same folder and is renamed over the
 * target, so a reader never sees half a file; a size cap applies. Errors carry a code and a fixed message, never a path.
 *
 * The file holds `{version, updatedAt, rev, settings}`. `rev` counts writes so a listener can tell a change happened.
 * A write is a partial merge over what is stored: unknown keys are ignored and one bad value rejects the whole write.
 */
import {constants} from 'node:fs';
import {lstat, mkdir, open, rename, unlink} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DJ_SETTINGS_ENVELOPE, defaultDjSettings, mergeDjSettings, parseDjSettings, type DjSettings} from '../web/dj-settings.js';

export const SETTINGS_DIR_SEGMENTS = ['local', 'dj-settings'] as const;
export const SETTINGS_FILE_NAME = 'settings.json';
export const SETTINGS_FILE_LIMITS = Object.freeze({maxFileBytes: 8 * 1024, maxRev: 1_000_000_000});
export const defaultSettingsRoot = fileURLToPath(new URL('../../', import.meta.url));

export type SettingsFileErrorCode = 'unsafe' | 'too-large' | 'invalid';
export class DjSettingsFileError extends Error {
  constructor(readonly code: SettingsFileErrorCode, message: string) { super(message); }
}
export interface DjSettingsDoc {
  readonly version: typeof DJ_SETTINGS_ENVELOPE;
  /** ISO time of the last write; `null` for the built-in defaults when nothing has ever been saved. */
  readonly updatedAt: string | null;
  readonly rev: number;
  readonly settings: DjSettings;
}
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
const enoent = (error: NodeJS.ErrnoException): null => { if (error.code === 'ENOENT') return null; throw error; };
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const defaultSettingsDoc = (): DjSettingsDoc => ({version: DJ_SETTINGS_ENVELOPE, updatedAt: null, rev: 0, settings: defaultDjSettings()});

/** Strict envelope check for a stored file; throws on anything unexpected. */
export function parseSettingsDoc(value: unknown): DjSettingsDoc {
  if (!isRecord(value) || value.version !== DJ_SETTINGS_ENVELOPE) throw new Error('envelope');
  if (Object.keys(value).some(k => !['version', 'updatedAt', 'rev', 'settings'].includes(k))) throw new Error('unknown field');
  const {updatedAt, rev} = value;
  if (updatedAt !== null && !(typeof updatedAt === 'string' && ISO_TIME.test(updatedAt) && !Number.isNaN(Date.parse(updatedAt)))) throw new Error('updatedAt');
  if (!Number.isSafeInteger(rev) || (rev as number) < 0 || (rev as number) > SETTINGS_FILE_LIMITS.maxRev) throw new Error('rev');
  return {version: DJ_SETTINGS_ENVELOPE, updatedAt: updatedAt as string | null, rev: rev as number, settings: parseDjSettings(value.settings)};
}

export class DjSettingsFile {
  private queue: Promise<unknown> = Promise.resolve();
  readonly directory: string;

  constructor(readonly root: string = defaultSettingsRoot) {
    this.directory = join(resolve(root), ...SETTINGS_DIR_SEGMENTS);
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private async ensureDirectory(create: boolean): Promise<boolean> {
    let current = resolve(this.root);
    for (const segment of SETTINGS_DIR_SEGMENTS) {
      current = join(current, segment);
      let info = await lstat(current).catch(enoent);
      if (!info) {
        if (!create) return false;
        await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
        info = await lstat(current);
      }
      if (info.isSymbolicLink() || !info.isDirectory()) throw new DjSettingsFileError('unsafe', `${segment} is not a plain directory.`);
    }
    return true;
  }
  private get target(): string { return join(this.directory, SETTINGS_FILE_NAME); }

  private async readStored(): Promise<DjSettingsDoc | null> {
    if (!await this.ensureDirectory(false)) return null;
    const info = await lstat(this.target).catch(enoent);
    if (!info) return null;
    if (info.isSymbolicLink() || !info.isFile()) throw new DjSettingsFileError('unsafe', 'The settings file is not a plain file.');
    if (info.size > SETTINGS_FILE_LIMITS.maxFileBytes) throw new DjSettingsFileError('too-large', 'The stored settings file is too large.');
    const handle = await open(this.target, constants.O_RDONLY | NO_FOLLOW);
    try {
      if (!(await handle.stat()).isFile()) throw new DjSettingsFileError('unsafe', 'The settings file is not a plain file.');
      const text = await handle.readFile({encoding: 'utf8'});
      try { return parseSettingsDoc(JSON.parse(text)); } catch { throw new DjSettingsFileError('invalid', 'The stored settings are not valid.'); }
    } finally { await handle.close(); }
  }

  /** The stored settings, or the built-in defaults (all DJ decides) when nothing was saved. */
  read(): Promise<DjSettingsDoc> {
    return this.serialize(async () => (await this.readStored()) ?? defaultSettingsDoc());
  }

  /**
   * Merges `patch` over the stored settings and writes atomically. `patch` may be a full or partial settings object;
   * unknown keys are ignored and a bad value rejects the whole write (nothing is changed). `reset` replaces the stored
   * settings with the defaults instead.
   */
  write(patch: unknown, now: Date = new Date(), reset = false): Promise<DjSettingsDoc> {
    let probe: DjSettings;
    try { probe = reset ? defaultDjSettings() : mergeDjSettings(defaultDjSettings(), patch); }
    catch (error) { return Promise.reject(new DjSettingsFileError('invalid', error instanceof Error ? error.message.slice(0, 160) : 'Invalid settings')); }
    return this.serialize(async () => {
      await this.ensureDirectory(true);
      let current: DjSettingsDoc | null = null;
      try { current = await this.readStored(); } catch (error) {
        // A damaged file is replaced by a valid write; an unsafe one is never touched.
        if (!(error instanceof DjSettingsFileError) || error.code === 'unsafe') throw error;
      }
      let settings: DjSettings;
      try { settings = reset ? probe : mergeDjSettings(current?.settings ?? defaultDjSettings(), patch); }
      catch (error) { throw new DjSettingsFileError('invalid', error instanceof Error ? error.message.slice(0, 160) : 'Invalid settings'); }
      const doc: DjSettingsDoc = {version: DJ_SETTINGS_ENVELOPE, updatedAt: now.toISOString(), rev: Math.min(SETTINGS_FILE_LIMITS.maxRev, (current?.rev ?? 0) + 1), settings};
      const body = Buffer.from(JSON.stringify(doc) + '\n');
      if (body.byteLength > SETTINGS_FILE_LIMITS.maxFileBytes) throw new DjSettingsFileError('too-large', 'The settings are too large.');
      const existing = await lstat(this.target).catch(enoent);
      if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new DjSettingsFileError('unsafe', 'The settings file is not a plain file.');
      const temporary = join(this.directory, `tmp-${randomBytes(8).toString('hex')}.part`);
      try {
        const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, 0o600);
        try { await handle.writeFile(body); await handle.sync().catch(() => undefined); } finally { await handle.close(); }
        await rename(temporary, this.target);
      } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
      return doc;
    });
  }
}
