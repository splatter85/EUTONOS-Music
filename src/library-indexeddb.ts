/** Browser-only atomic snapshot adapter. No localStorage fallback or surprise data reset. */
import type {LibraryStorage} from './library.js';
import {boundedPayload, LibraryError, requireLibrary, text} from './library-codec.js';

const storeName = 'snapshots', key = 'current';
function stored(value: unknown): string {
  requireLibrary(typeof value === 'string', 'stored snapshot is not text; original value retained');
  return boundedPayload(value);
}
export class IndexedDbLibraryStorage implements LibraryStorage {
  private closed = false;
  private constructor(private readonly database: IDBDatabase) {
    database.onversionchange = () => this.close();
  }
  static async open(name = 'eutonos-music-library',
    factory: IDBFactory | undefined = globalThis.indexedDB): Promise<IndexedDbLibraryStorage> {
    text(name, 128);
    requireLibrary(factory, 'IndexedDB is unavailable; persistence was not enabled', 'storage');
    return new Promise((resolve, reject) => {
      const request = factory.open(name, 1);
      let abandoned = false;
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onblocked = () => {
        abandoned = true;
        reject(new LibraryError('storage', 'database opening is blocked by another connection'));
      };
      request.onerror = () => reject(new LibraryError('storage', request.error?.message ?? 'database opening failed'));
      request.onsuccess = () => {
        if (abandoned) { request.result.close(); return; }
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.close();
          reject(new LibraryError('version', 'database does not contain the supported snapshot store'));
          return;
        }
        resolve(new IndexedDbLibraryStorage(request.result));
      };
    });
  }
  close(): void { this.closed = true; this.database.close(); }
  async read(): Promise<string | null> {
    requireLibrary(!this.closed, 'database connection is closed', 'storage');
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).openCursor(key);
      let value: string | null = null, failure: unknown;
      request.onsuccess = () => {
        try { value = request.result === null ? null : stored(request.result.value); }
        catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = () => reject(failure ??
        new LibraryError('storage', transaction.error?.message ?? 'snapshot read aborted'));
    });
  }
  async compareAndSwap(expected: string | null, next: string): Promise<boolean> {
    requireLibrary(!this.closed, 'database connection is closed', 'storage');
    boundedPayload(next);
    if (expected !== null) boundedPayload(expected);
    // No awaited crypto or asynchronous validation inside this transaction.
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName), request = store.openCursor(key);
      let matched = false, failure: unknown;
      request.onsuccess = () => {
        try {
          const current = request.result === null ? null : stored(request.result.value);
          if (current === expected) {
            matched = true;
            store.put(next, key);
          }
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(matched);
      transaction.onabort = () => reject(failure ??
        new LibraryError('storage', transaction.error?.message ?? 'snapshot write aborted'));
    });
  }
}
