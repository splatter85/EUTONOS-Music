/**
 * Browser side of the song dossiers: where they are kept, and the background scheduler that analyses
 * songs BEFORE they are played.
 *
 * Lookup order is the page's IndexedDB first, then the PC's relay store (`local/song-dossiers/`).
 * `npm run phone:host` opens the DJ in a throwaway browser profile, so IndexedDB is empty on every
 * run; the relay file store is what survives. A saved dossier goes to both. A relay that is down or
 * refuses never blocks anything: the dossier stays in memory and IndexedDB and is retried later.
 *
 * The scheduler analyses one song at a time, in priority order (now playing, next, queue order,
 * the rest), never while a handover is being prepared or mixed, and never blocks Play or Next: it
 * only calls the injected `analyse`, which the page backs with the EXISTING analysis workers and
 * cache. A dossier made under an older analysis version is treated as missing and re-analysed lazily.
 *
 * Honest limit: a dossier is the compact persisted record, not the planner's full analysis. The
 * planner still reads the analysis cache, which the scheduler warms by analysing. "Next ready" means
 * a current dossier exists AND the planner's cache holds the song.
 */
import {dossierId, isCurrentFor, parseSongDossier, SONG_DOSSIER_ANALYSIS, currentKey, type DossierIdentity, type SongDossier} from './song-dossier.js';

export interface DossierLocal {
  get(id: string): Promise<SongDossier | null>;
  put(dossier: SongDossier): Promise<void>;
}
export interface DossierRemote {
  /** null when the relay has none; throws when it cannot be reached or refuses. */
  get(id: string): Promise<SongDossier | null>;
  /** Resolves when the relay stored it; throws otherwise. */
  put(dossier: SongDossier): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// IndexedDB (one record per song; disposable like the analysis cache)
// ---------------------------------------------------------------------------------------------
export const DOSSIER_DB = 'eutonos-song-dossiers-v1';
export const DOSSIER_DB_ENTRIES = 512;
const STORE = 'dossiers';
interface Row {id: string; payload: string; usedAt: number}

export class IndexedDbDossierLocal implements DossierLocal {
  private opening: Promise<IDBDatabase> | null = null;
  private disabled = false;
  constructor(private readonly factory: IDBFactory = indexedDB, private readonly name = DOSSIER_DB) {}
  private open(): Promise<IDBDatabase> {
    if (this.disabled) return Promise.reject(new Error('Dossier storage is unavailable.'));
    if (this.opening) return this.opening;
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      let done = false;
      const request = this.factory.open(this.name, 1);
      const fail = (reason: string): void => { if (done) return; done = true; clearTimeout(timer); this.disabled = true; reject(new Error(reason)); };
      const timer = setTimeout(() => fail('Dossier storage did not open in time.'), 500);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE, {keyPath: 'id'}); };
      request.onblocked = () => fail('Dossier storage upgrade is blocked.');
      request.onerror = () => fail('Dossier storage could not open.');
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
      const fail = (): void => { if (done) return; done = true; clearTimeout(timer); reject(new Error('Dossier storage transaction failed.')); };
      const timer = setTimeout(() => { try { transaction.abort(); } catch { /* closed */ } fail(); }, 1000);
      transaction.onabort = fail; transaction.onerror = fail;
      transaction.oncomplete = () => { if (done) return; done = true; clearTimeout(timer); if (assigned) resolve(value); else reject(new Error('No result.')); };
      try { body(transaction.objectStore(STORE), result => { value = result; assigned = true; }); }
      catch { try { transaction.abort(); } catch { /* closed */ } fail(); }
    });
  }
  async get(id: string): Promise<SongDossier | null> {
    const row = await this.transaction<Row | undefined>((store, result) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const value = request.result as Row | undefined;
        if (value && typeof value.payload === 'string') store.put({...value, usedAt: Date.now()});
        result(value);
      };
    });
    if (!row || typeof row.payload !== 'string') return null;
    try {
      const dossier = parseSongDossier(JSON.parse(row.payload));
      if (dossierId(dossier.key) === id) return dossier;
    } catch { /* fall through: a bad record is removed */ }
    void this.transaction<void>((store, result) => { store.delete(id); result(undefined); }).catch(() => undefined);
    return null;
  }
  async put(dossier: SongDossier): Promise<void> {
    const row: Row = {id: dossierId(dossier.key), payload: JSON.stringify(parseSongDossier(dossier)), usedAt: Date.now()};
    await this.transaction<void>((store, result) => {
      store.put(row);
      const rows: {key: IDBValidKey; usedAt: number}[] = [];
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (entry) { rows.push({key: entry.primaryKey, usedAt: (entry.value as Row).usedAt}); entry.continue(); return; }
        rows.sort((a, b) => a.usedAt - b.usedAt);
        for (const old of rows.slice(0, Math.max(0, rows.length - DOSSIER_DB_ENTRIES))) store.delete(old.key);
        result(undefined);
      };
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Relay client
// ---------------------------------------------------------------------------------------------
export class RelayDossierRemote implements DossierRemote {
  constructor(private readonly relay: string, private readonly token: string, private readonly doFetch: typeof fetch = (input, init) => fetch(input, init)) {}
  private headers(): Record<string, string> { return {'Content-Type': 'application/json', 'X-Relay-Token': this.token}; }
  async get(id: string): Promise<SongDossier | null> {
    const response = await this.doFetch(`${this.relay}/api/dj/dossiers?key=${encodeURIComponent(id)}`, {headers: this.headers(), mode: 'cors', cache: 'no-store', credentials: 'omit'});
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`relay answered ${response.status}`);
    const dossier = parseSongDossier(await response.json());
    if (dossierId(dossier.key) !== id) throw new Error('relay returned a different dossier');
    return dossier;
  }
  async put(dossier: SongDossier): Promise<void> {
    const response = await this.doFetch(`${this.relay}/api/dj/dossier`, {method: 'POST', headers: this.headers(), body: JSON.stringify(dossier), mode: 'cors', cache: 'no-store', credentials: 'omit'});
    if (!response.ok) throw new Error(`relay answered ${response.status}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Store: memory, IndexedDB, relay
// ---------------------------------------------------------------------------------------------
export class DossierStore {
  private readonly memory = new Map<string, SongDossier>();
  private readonly unsynced = new Map<string, SongDossier>();
  /** True after the last relay call failed; cleared by the next success. The dossiers are still kept locally. */
  relayDown = false;
  constructor(private readonly local: DossierLocal | null, private readonly remote: DossierRemote | null,
    private readonly analysis: string = SONG_DOSSIER_ANALYSIS) {}
  get hasRemote(): boolean { return this.remote !== null; }
  get unsyncedCount(): number { return this.unsynced.size; }

  /** The CURRENT-version dossier for a song, or null. Never throws: storage trouble is a miss. */
  async lookup(identity: DossierIdentity): Promise<SongDossier | null> {
    const id = dossierId(currentKey(identity, this.analysis));
    const known = this.memory.get(id);
    if (known) return known;
    if (this.local) {
      const hit = await this.local.get(id).catch(() => null);
      if (hit && isCurrentFor(hit, identity, this.analysis)) { this.memory.set(id, hit); return hit; }
    }
    if (this.remote) {
      try {
        const hit = await this.remote.get(id);
        this.relayDown = false;
        if (hit && isCurrentFor(hit, identity, this.analysis)) {
          this.memory.set(id, hit);
          await this.local?.put(hit).catch(() => undefined);
          return hit;
        }
      } catch { this.relayDown = true; }
    }
    return null;
  }
  /** Keeps it in memory and IndexedDB, then sends it to the PC; a failed send queues it for `flush`. */
  async save(dossier: SongDossier): Promise<void> {
    const checked = parseSongDossier(dossier), id = dossierId(checked.key);
    this.memory.set(id, checked);
    await this.local?.put(checked).catch(() => undefined);
    if (!this.remote) return;
    try { await this.remote.put(checked); this.relayDown = false; this.unsynced.delete(id); }
    catch { this.relayDown = true; this.unsynced.set(id, checked); }
  }
  /** Retries dossiers the relay has not accepted. Returns how many are still waiting. */
  async flush(): Promise<number> {
    if (!this.remote) return this.unsynced.size;
    for (const [id, dossier] of [...this.unsynced]) {
      try { await this.remote.put(dossier); this.relayDown = false; this.unsynced.delete(id); } catch { this.relayDown = true; break; }
    }
    return this.unsynced.size;
  }
}

// ---------------------------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------------------------
export interface SchedulerSong {readonly id: string; readonly identity: DossierIdentity}
export type AnalyseResult = {readonly ok: true; readonly dossier: SongDossier} | {readonly ok: false; readonly reason: string};
export interface SchedulerOrder {
  readonly nowPlaying: string | null;
  /** The song Next would play (the queue head), or null. */
  readonly next: string | null;
  /** Remaining queue, in order. Songs not listed anywhere follow in catalogue order. */
  readonly queue: readonly string[];
}
export interface SchedulerDeps {
  readonly store: Pick<DossierStore, 'lookup' | 'save' | 'relayDown'>;
  /** Decode (if needed), analyse with the existing workers and return the built dossier. The caller owns timing and memory release. */
  analyse(song: SchedulerSong): Promise<AnalyseResult>;
  songs(): readonly SchedulerSong[];
  order(): SchedulerOrder;
  /** True while a handover is being prepared or mixed, or the player is otherwise not to be disturbed. */
  busy(): boolean;
  /** True when the planner's analysis cache already holds this song. Absent: a current dossier is enough. */
  planWarm?(song: SchedulerSong): boolean;
  onChange?(): void;
  /** Analysis tag the dossiers must carry; defaults to the current one. */
  readonly analysis?: string;
  /** Milliseconds a failed song waits before it is tried again. */
  readonly failureBackoffMs?: number;
  readonly now?: () => number;
  readonly wait?: (ms: number) => Promise<void>;
  readonly idleMs?: number;
  readonly busyMs?: number;
}
export interface SchedulerProgress {
  readonly total: number;
  /** Songs with a current dossier. */
  readonly analysed: number;
  readonly failed: number;
  readonly analysing: string | null;
  /** null when no next song is known. */
  readonly nextReady: boolean | null;
  readonly paused: boolean;
  readonly relayDown: boolean;
  readonly text: string;
}
export type StepResult = 'analysed' | 'failed' | 'busy' | 'idle';
/** `warmedAt`: when this song was last analysed in this session; a cold planner cache is only retried after `WARM_RETRY_MS`. */
interface State {dossier: SongDossier | null; looked: boolean; failedAt: number | null; reason: string; warmedAt: number | null}
const WARM_RETRY_MS = 30_000;

export class DossierScheduler {
  private readonly states = new Map<string, State>();
  private current: string | null = null;
  private promoted: string | null = null;
  private running = false;
  private stopped = true;
  private paused = false;
  private readonly analysisTag: string;
  constructor(private readonly deps: SchedulerDeps) { this.analysisTag = deps.analysis ?? SONG_DOSSIER_ANALYSIS; }

  private state(song: SchedulerSong): State {
    let state = this.states.get(song.id);
    if (!state) { state = {dossier: null, looked: false, failedAt: null, reason: '', warmedAt: null}; this.states.set(song.id, state); }
    return state;
  }
  private changed(): void { try { this.deps.onChange?.(); } catch { /* rendering must not break analysis */ } }

  /** Makes this song the next job (a song needed now); never refuses and never waits for the current job. */
  promote(id: string): void { this.promoted = id; }

  /** Songs in priority order: promoted, now playing, next, queue, then the rest of the catalogue. */
  priority(): SchedulerSong[] {
    const songs = this.deps.songs(), byId = new Map(songs.map(s => [s.id, s]));
    const order = this.deps.order();
    const ids: string[] = [];
    for (const id of [this.promoted, order.nowPlaying, order.next, ...order.queue, ...songs.map(s => s.id)]) {
      if (id && byId.has(id) && !ids.includes(id)) ids.push(id);
    }
    return ids.map(id => byId.get(id)!);
  }
  private ready(song: SchedulerSong, state: State): boolean {
    return state.dossier !== null && isCurrentFor(state.dossier, song.identity, this.analysisTag);
  }
  /** A song needs work when it has no current dossier, or it is the next song and the planner's cache is cold. */
  private needsWork(song: SchedulerSong, state: State, isNext: boolean): boolean {
    if (!this.ready(song, state)) return true;
    if (!isNext || this.deps.planWarm === undefined || this.deps.planWarm(song)) return false;
    return state.warmedAt === null || (this.deps.now ?? Date.now)() - state.warmedAt >= WARM_RETRY_MS;
  }

  /** Looks up every song not yet looked up (memory, IndexedDB, then relay). Cheap; no audio. */
  async lookupAll(): Promise<void> {
    for (const song of this.priority()) {
      const state = this.state(song);
      if (state.looked) continue;
      state.looked = true;
      const found = await this.deps.store.lookup(song.identity).catch(() => null);
      if (found && isCurrentFor(found, song.identity, this.analysisTag)) state.dossier = found;
      this.changed();
    }
  }

  /** One scheduling step: at most one song is analysed. Never analyses while `busy()`. */
  async step(): Promise<StepResult> {
    if (this.stepping) return 'busy'; // one song at a time, even if a caller overlaps steps
    this.stepping = true;
    try { return await this.stepOnce(); } finally { this.stepping = false; }
  }
  private stepping = false;
  private async stepOnce(): Promise<StepResult> {
    await this.lookupAll();
    if (this.deps.busy()) { this.paused = true; this.changed(); return 'busy'; }
    this.paused = false;
    const order = this.deps.order(), now = (this.deps.now ?? Date.now)(), backoff = this.deps.failureBackoffMs ?? 60_000;
    for (const song of this.priority()) {
      const state = this.state(song);
      if (!this.needsWork(song, state, song.id === order.next)) continue;
      if (state.failedAt !== null && now - state.failedAt < backoff) continue;
      this.current = song.id; this.changed();
      let result: AnalyseResult;
      try { result = await this.deps.analyse(song); }
      catch (error) { result = {ok: false, reason: error instanceof Error ? error.message : String(error)}; }
      this.current = null;
      if (this.promoted === song.id) this.promoted = null;
      if (!result.ok) { state.failedAt = now; state.reason = result.reason.slice(0, 240); this.changed(); return 'failed'; }
      if (isCurrentFor(result.dossier, song.identity, this.analysisTag)) {
        state.dossier = result.dossier; state.failedAt = null; state.reason = ''; state.warmedAt = now;
        await this.deps.store.save(result.dossier).catch(() => undefined);
      } else { state.failedAt = now; state.reason = 'The analysis returned a dossier for a different key.'; this.changed(); return 'failed'; }
      this.changed();
      return 'analysed';
    }
    return 'idle';
  }

  /** Runs `step` until stopped, waiting while busy or idle. Re-checks the catalogue each pass, so added songs are picked up. */
  start(): void {
    if (this.running) return;
    this.running = true; this.stopped = false;
    const wait = this.deps.wait ?? (ms => new Promise<void>(resolve => { setTimeout(resolve, ms); }));
    void (async () => {
      try {
        while (!this.stopped) {
          const result = await this.step().catch(() => 'failed' as StepResult);
          if (result === 'busy') await wait(this.deps.busyMs ?? 1000);
          else if (result === 'idle' || result === 'failed') await wait(this.deps.idleMs ?? 2000);
        }
      } finally { this.running = false; }
    })();
  }
  stop(): void { this.stopped = true; }

  progress(): SchedulerProgress {
    const songs = this.deps.songs(), order = this.deps.order();
    let analysed = 0, failed = 0;
    for (const song of songs) {
      const state = this.state(song);
      if (this.ready(song, state)) analysed++; else if (state.failedAt !== null) failed++;
    }
    const nextSong = order.next ? songs.find(s => s.id === order.next) ?? null : null;
    const nextReady = nextSong ? this.ready(nextSong, this.state(nextSong)) && (this.deps.planWarm === undefined || this.deps.planWarm(nextSong)) : null;
    const total = songs.length;
    const relayDown = this.deps.store.relayDown;
    const text = total === 0 ? '' : `Analysed ${analysed}/${total}` +
      (nextReady === null ? '' : nextReady ? ' · next ready' : ' · next not ready yet') +
      (this.current !== null ? ' · analysing…' : this.paused ? ' · paused during handover' : '') +
      (failed ? ` · ${failed} could not be analysed` : '') + (relayDown ? ' · PC store not reachable' : '');
    return {total, analysed, failed, analysing: this.current, nextReady, paused: this.paused, relayDown, text};
  }
}
