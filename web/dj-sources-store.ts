/**
 * Browser-side holder of the DJ song sources view, used by the Studio set page and the phone page.
 * The relay (PC) is the truth: it owns the ticks, the folder allow-list, the scan and the ratings. This store only
 * asks and tells. localStorage keeps the ticks as a per-browser cache so the boxes show at once and a tick made while the
 * relay is away is sent when it is back (the newest change wins, like the booth settings). It never holds a folder path
 * in storage; folder paths come from the PC on the Studio page only.
 */
import {isSourceId, type RateAction, type SourcesView} from './dj-sources.js';

export const SOURCES_CACHE_KEY = 'eutonos-music.dj-sources.v1';
const CACHE_VERSION = 'em.dj-sources-cache.v1';
export interface KeyValueStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface DjSourcesStoreOptions {
  /** `<relay>/api/dj/sources` on the Studio page, `/api/sources` on the phone page. */
  readonly endpoint: string;
  /** Relay token for the DJ endpoint; null on the phone's same-origin endpoint. */
  readonly token?: string | null;
  readonly storage?: KeyValueStorage | null;
  readonly fetch?: typeof fetch;
  readonly onChange?: () => void;
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Light shape check of the relay's answer (the relay is ours, but a wrong page or proxy must not break rendering). */
export function parseSourcesView(value: unknown): SourcesView | null {
  if (!isRecord(value) || value.version !== 'em.dj-sources.v1') return null;
  if (!Array.isArray(value.sources) || !Array.isArray(value.songs) || !Array.isArray(value.folders) || !Array.isArray(value.disliked)) return null;
  if (!isRecord(value.pool) || !isRecord(value.ticks)) return null;
  return value as unknown as SourcesView;
}

export class DjSourcesStore {
  private current: SourcesView | null = null;
  /** Ticks chosen here that the PC has not confirmed yet. */
  private pending: Record<string, boolean> = {};
  private queue: Promise<unknown> = Promise.resolve();
  lastProblem = '';
  /** True after the last request reached the relay. */
  reachable = false;
  private readonly storage: KeyValueStorage | null;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: DjSourcesStoreOptions) {
    this.storage = options.storage === undefined ? (() => { try { return localStorage; } catch { return null; } })() : options.storage;
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.loadCache();
  }

  get view(): SourcesView | null { return this.current; }
  /** The ticks to show: the PC's, with any change not confirmed yet laid over them. */
  ticks(): Readonly<Record<string, boolean>> { return {...(this.current?.ticks ?? {}), ...this.pending}; }
  get hasPending(): boolean { return Object.keys(this.pending).length > 0; }

  private changed(): void { try { this.options.onChange?.(); } catch { /* rendering must not break the store */ } }
  private persist(): void {
    if (!this.storage) return;
    try { this.storage.setItem(SOURCES_CACHE_KEY, JSON.stringify({version: CACHE_VERSION, pending: this.pending, ticks: this.current?.ticks ?? {}})); }
    catch { /* storage blocked or full: the PC is still the record */ }
  }
  private loadCache(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(SOURCES_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) as Record<string, unknown> : null;
      if (cache && cache.version === CACHE_VERSION && isRecord(cache.pending)) {
        for (const [id, on] of Object.entries(cache.pending)) if (isSourceId(id) && typeof on === 'boolean') this.pending[id] = on;
      }
    } catch { this.pending = {}; }
  }

  private headers(json: boolean): Record<string, string> {
    return {...(json ? {'Content-Type': 'application/json'} : {}), ...(this.options.token ? {'X-Relay-Token': this.options.token} : {})};
  }
  private get init(): RequestInit { return this.options.token ? {mode: 'cors', cache: 'no-store', credentials: 'omit'} : {cache: 'no-store'}; }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private adopt(view: SourcesView): void { this.current = view; this.reachable = true; this.persist(); this.changed(); }
  private async problemOf(response: Response): Promise<string> {
    const body = await response.json().catch(() => ({})) as {error?: string; detail?: string};
    return body.detail ?? body.error ?? `The PC answered ${response.status}.`;
  }

  /** Reads the PC's view (sending any tick that was made while it was away first). Never throws. */
  refresh(): Promise<void> {
    return this.serialize(async () => {
      try {
        if (this.hasPending) {
          const sent = {...this.pending};
          const response = await this.doFetch(this.options.endpoint, {...this.init, method: 'POST', headers: this.headers(true), body: JSON.stringify({ticks: sent})});
          if (response.ok) {
            for (const [id, on] of Object.entries(sent)) if (this.pending[id] === on) delete this.pending[id];
            const view = parseSourcesView(await response.json().catch(() => null));
            if (view) { this.lastProblem = ''; this.adopt(view); return; }
          } else { this.lastProblem = await this.problemOf(response); this.reachable = true; if (response.status === 400) this.pending = {}; this.persist(); this.changed(); return; }
        }
        const response = await this.doFetch(this.options.endpoint, {...this.init, headers: this.headers(false)});
        if (!response.ok) { this.lastProblem = await this.problemOf(response); this.reachable = true; this.changed(); return; }
        const view = parseSourcesView(await response.json().catch(() => null));
        if (!view) { this.lastProblem = 'The PC answer was not readable.'; this.changed(); return; }
        this.lastProblem = '';
        this.adopt(view);
      } catch (error) {
        this.reachable = false;
        this.lastProblem = `Cannot reach the PC relay (${error instanceof Error ? error.message : String(error)}).`;
        this.changed();
      }
    });
  }

  /** POSTs exactly one change. Returns true when the PC applied it; otherwise `lastProblem` says why (never a path). */
  private change(body: Record<string, unknown>): Promise<boolean> {
    return this.serialize(async () => {
      try {
        const response = await this.doFetch(this.options.endpoint, {...this.init, method: 'POST', headers: this.headers(true), body: JSON.stringify(body)});
        this.reachable = true;
        if (!response.ok) { this.lastProblem = await this.problemOf(response); this.changed(); return false; }
        const view = parseSourcesView(await response.json().catch(() => null));
        this.lastProblem = '';
        if (view) this.adopt(view); else this.changed();
        return true;
      } catch (error) {
        this.reachable = false;
        this.lastProblem = `Cannot reach the PC relay (${error instanceof Error ? error.message : String(error)}).`;
        this.changed();
        return false;
      }
    });
  }

  /** Ticks or unticks a source. If the PC cannot be reached the choice is kept here and sent later. */
  async setTick(id: string, on: boolean): Promise<boolean> {
    if (!isSourceId(id)) return false;
    this.pending[id] = on; this.persist(); this.changed();
    const ok = await this.change({ticks: {[id]: on}});
    if (ok) { if (this.pending[id] === on) delete this.pending[id]; this.persist(); this.changed(); }
    else if (this.reachable) { delete this.pending[id]; this.persist(); this.changed(); } // refused by the PC: do not retry a refused tick
    return ok;
  }
  addFolder(path: string): Promise<boolean> { return this.change({addFolder: path}); }
  removeFolder(id: string): Promise<boolean> { return this.change({removeFolder: id}); }
  rescan(): Promise<boolean> { return this.change({rescan: true}); }
  /** `null` clears the rating (pressing the same rating again). */
  rate(assetId: string, action: RateAction): Promise<boolean> { return this.change({rate: {assetId, action}}); }
}
