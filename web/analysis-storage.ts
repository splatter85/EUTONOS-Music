/** Disposable derived analysis records, separate from the owner's music library. */
export interface StoredAnalysis {
  readonly key: string;
  readonly identity: string;
  readonly payload: string;
  readonly digest: string;
  readonly usedAt: number;
}
export interface AnalysisStorage {
  read(key: string): Promise<unknown>;
  latest(identity: string): Promise<unknown>;
  write(record: StoredAnalysis): Promise<void>;
  remove(key: string, expected?: unknown): Promise<void>;
}
export const ANALYSIS_RECORD_BYTES = 1_048_576;
export const ANALYSIS_STORE_BYTES = 16 * ANALYSIS_RECORD_BYTES;
export const ANALYSIS_STORE_ENTRIES = 64;
export const ANALYSIS_DB = 'eutonos-set-analysis-v1';
const STORE = 'analyses';
const validHeader = (v: unknown): v is StoredAnalysis => {
  if (!v || typeof v !== 'object') return false;
  const r = v as StoredAnalysis;
  return typeof r.key === 'string' && r.key.length <= 512 && typeof r.identity === 'string' && r.identity.length <= 512 &&
    typeof r.payload === 'string' && r.payload.length <= ANALYSIS_RECORD_BYTES && typeof r.digest === 'string' &&
    /^[a-f0-9]{64}$/.test(r.digest) && Number.isFinite(r.usedAt);
};

/** Storage deadlines protect preparation from blocked IDB; they never schedule music. */
export class IndexedDbAnalysisStorage implements AnalysisStorage {
  private opening: Promise<IDBDatabase> | null = null;
  private disabled = false;
  constructor(private readonly factory: IDBFactory = indexedDB, private readonly name = ANALYSIS_DB) {}
  private open(): Promise<IDBDatabase> {
    if (this.disabled) return Promise.reject(new Error('Analysis storage is unavailable.'));
    if (this.opening) return this.opening;
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      let done = false;
      const request = this.factory.open(this.name, 1);
      const fail = (reason: string): void => {
        if (done) return;
        done = true; clearTimeout(timer); this.disabled = true; reject(new Error(reason));
      };
      const timer = setTimeout(() => fail('Analysis storage did not open in time.'), 500);
      request.onupgradeneeded = () => {
        if (done) { request.transaction?.abort(); return; }
        const store = request.result.createObjectStore(STORE, {keyPath: 'key'});
        store.createIndex('identity', 'identity', {unique: false});
      };
      request.onblocked = () => fail('Analysis storage upgrade is blocked.');
      request.onerror = () => fail('Analysis storage could not open.');
      request.onsuccess = () => {
        const db = request.result;
        if (done) { db.close(); return; }
        done = true; clearTimeout(timer);
        db.onversionchange = () => { db.close(); this.opening = null; };
        resolve(db);
      };
    }).catch(error => { this.opening = null; throw error; });
    return this.opening;
  }
  private async transaction<T>(body: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction;
      try { transaction = db.transaction(STORE, 'readwrite'); } catch (error) { reject(error); return; }
      let value: T, assigned = false, done = false;
      const fail = (): void => {
        if (done) return;
        done = true; clearTimeout(timer); reject(new Error('Analysis storage transaction failed.'));
      };
      const timer = setTimeout(() => { try { transaction.abort(); } catch { /* already closed */ } fail(); }, 500);
      transaction.onabort = fail; transaction.onerror = fail;
      transaction.oncomplete = () => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (assigned) resolve(value); else reject(new Error('Analysis storage returned no result.'));
      };
      try { body(transaction.objectStore(STORE), result => { value = result; assigned = true; }); }
      catch (error) { try { transaction.abort(); } catch { /* closed */ } fail(); }
    });
  }
  read(key: string): Promise<unknown> {
    return this.transaction((store, result) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const value: unknown = request.result;
        if (validHeader(value)) store.put({...value, usedAt: Date.now()});
        result(value);
      };
    });
  }
  latest(identity: string): Promise<unknown> {
    return this.transaction((store, result) => {
      const request = store.index('identity').getAll(identity, ANALYSIS_STORE_ENTRIES);
      request.onsuccess = () => {
        const values = (request.result as unknown[]).filter(validHeader);
        const value = values.sort((a, b) => b.usedAt - a.usedAt)[0];
        if (value) store.put({...value, usedAt: Date.now()});
        result(value);
      };
    });
  }
  write(record: StoredAnalysis): Promise<void> {
    if (!validHeader(record) || new TextEncoder().encode(record.payload).byteLength > ANALYSIS_RECORD_BYTES)
      return Promise.reject(new Error('Analysis cache record is too large or invalid.'));
    return this.transaction((store, result) => {
      store.put(record);
      const rows: {key: IDBValidKey; bytes: number; usedAt: number}[] = [];
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (entry) {
          const value: unknown = entry.value;
          if (!validHeader(value)) entry.delete();
          else rows.push({key: entry.primaryKey, bytes: value.payload.length * 2 + 2048, usedAt: value.usedAt});
          entry.continue(); return;
        }
        rows.sort((a, b) => a.usedAt - b.usedAt);
        let bytes = rows.reduce((sum, row) => sum + row.bytes, 0), count = rows.length;
        for (const row of rows) {
          if (count <= ANALYSIS_STORE_ENTRIES && bytes <= ANALYSIS_STORE_BYTES) break;
          store.delete(row.key); bytes -= row.bytes; count--;
        }
        result(undefined);
      };
    });
  }
  remove(key: string, expected?: unknown): Promise<void> {
    return this.transaction((store, result) => {
      if (expected === undefined) store.delete(key);
      else {
        const read = store.get(key);
        read.onsuccess = () => {
          const current = read.result as Partial<StoredAnalysis> | undefined, prior = expected as Partial<StoredAnalysis> | null;
          if (current && prior && current.key === prior.key && current.identity === prior.identity &&
            current.payload === prior.payload && current.digest === prior.digest) store.delete(key);
        };
      }
      result(undefined);
    });
  }
}
