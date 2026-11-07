/** Node-only, single-directory snapshot storage. No writes occur on the audio clock.
 * Atomic rename protects normal process interruption. This is not a power-loss guarantee.
 * Existing/uncertain locks require inspection; they are never guessed stale or stolen. */
import {open, readFile, lstat, mkdir, realpath, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {LibraryStorage} from './library.js';
import {boundedPayload, LibraryError, MAX_LIBRARY_BYTES, requireLibrary} from './library-codec.js';

export class FileLibraryStorage implements LibraryStorage {
  private constructor(readonly directory: string) {}
  static async open(directory: string): Promise<FileLibraryStorage> {
    await mkdir(directory, {recursive: true});
    return new FileLibraryStorage(await realpath(directory));
  }
  async read(): Promise<string | null> {
    const path = join(this.directory, 'library.json');
    try {
      const info = await lstat(path);
      requireLibrary(info.isFile() && !info.isSymbolicLink() && info.nlink === 1,
        'library snapshot must be a regular unaliased file', 'storage');
      requireLibrary(info.size <= MAX_LIBRARY_BYTES, 'snapshot exceeds 2 MiB', 'limit');
      const bytes = await readFile(path);
      let raw: string;
      try { raw = new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
      catch { throw new LibraryError('invalid', 'snapshot is not valid UTF-8; original bytes retained'); }
      return boundedPayload(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async compareAndSwap(expected: string | null, next: string): Promise<boolean> {
    boundedPayload(next);
    if (expected !== null) boundedPayload(expected);
    const token = randomUUID(), lockPath = join(this.directory, 'library.lock');
    const temporary = join(this.directory, '.library-' + token + '.tmp');
    let lock;
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new LibraryError('storage', 'library writer lock exists; inspect it and re-read before recovery');
      }
      throw error;
    }
    let temporaryExists = false, committed = false;
    try {
      await lock.writeFile(token, 'utf8');
      if (await this.read() !== expected) return false;
      const file = await open(temporary, 'wx', 0o600);
      temporaryExists = true;
      try { await file.writeFile(next, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await rename(temporary, join(this.directory, 'library.json'));
      temporaryExists = false;
      committed = true;
      return true;
    } finally {
      // Only this operation's temporary file and lock may be cleaned up.
      try {
        try { if (temporaryExists) await unlink(temporary); }
        finally {
          await lock.close();
          const info = await lstat(lockPath);
          requireLibrary(info.isFile() && !info.isSymbolicLink() &&
            await readFile(lockPath, 'utf8') === token, 'writer lock ownership changed; inspect before recovery', 'storage');
          await unlink(lockPath);
        }
      } catch (error) {
        if (committed) throw new LibraryError('reconcile',
          'snapshot committed but writer cleanup failed; re-read the snapshot and inspect the lock before retrying');
        throw error;
      }
    }
  }
}
