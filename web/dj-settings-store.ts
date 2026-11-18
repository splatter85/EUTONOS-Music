/**
 * Browser-side holder of the DJ booth settings, used by the Studio set page and the phone page.
 * The PC file (written only by the phone relay) is the source of truth whenever the relay is reachable;
 * localStorage is a per-browser cache. The newest `updatedAt` wins: a local change that the relay has not confirmed yet is
 * pushed on the next sync, and a newer change made on the other device (phone or Studio) is adopted. Changes apply locally
 * and synchronously, so the booth reacts at once even when the relay is away.
 */
import {defaultDjSettings, mergeDjSettings, parseDjSettings, type DjSettings} from './dj-settings.js';

export const SETTINGS_CACHE_KEY = 'eutonos-music.dj-settings.v1';
const CACHE_VERSION = 'em.dj-settings-cache.v1';
export type SettingsSaveOutcome = 'saved' | 'queued' | 'local';
export interface KeyValueStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface DjSettingsStoreOptions {
  /** Full URL of the settings endpoint (`<relay>/api/dj/settings` on the Studio, `/api/settings` on the phone); null = browser only. */
  readonly endpoint: string | null;
  /** Relay token for the DJ endpoint; null on the phone's same-origin endpoint. */
  readonly token?: string | null;
  readonly storage?: KeyValueStorage | null;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly onChange?: () => void;
}
interface Doc { readonly updatedAt: string | null; readonly rev: number; readonly settings: DjSettings }
const time = (iso: string | null): number => iso === null ? -Infinity : Date.parse(iso);

export class DjSettingsStore {
  private settings: DjSettings = defaultDjSettings();
  private updatedAt: string | null = null;
  private rev = 0;
  /** True when the local copy has not been confirmed by the PC file yet. */
  private dirty = false;
  private saved = false;
  private busy: Promise<void> | null = null;
  /** Counts local changes, so a change made while a save is in flight is never marked as saved. */
  private seq = 0;
  lastProblem = '';
  private readonly storage: KeyValueStorage | null;
  private readonly doFetch: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly options: DjSettingsStoreOptions) {
    this.storage = options.storage === undefined ? (() => { try { return localStorage; } catch { return null; } })() : options.storage;
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => new Date());
    this.load();
  }

  get relayReady(): boolean { return this.options.endpoint !== null && (this.options.token === undefined || this.options.token !== null); }
  get(): DjSettings { return this.settings; }
  get updated(): string | null { return this.updatedAt; }
  /** True when the PC file holds exactly the current settings. */
  get isSaved(): boolean { return this.saved && !this.dirty; }
  get pending(): boolean { return this.dirty; }

  private changed(): void { try { this.options.onChange?.(); } catch { /* rendering must not break the settings */ } }
  private persist(): void {
    if (!this.storage) return;
    try { this.storage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({version: CACHE_VERSION, updatedAt: this.updatedAt, rev: this.rev, dirty: this.dirty, settings: this.settings})); }
    catch { /* storage blocked or full: the PC file is still the record */ }
  }
  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(SETTINGS_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) as Record<string, unknown> : null;
      if (cache && cache.version === CACHE_VERSION) {
        this.settings = parseDjSettings(cache.settings);
        this.updatedAt = typeof cache.updatedAt === 'string' && !Number.isNaN(Date.parse(cache.updatedAt)) ? cache.updatedAt : null;
        this.rev = Number.isSafeInteger(cache.rev) ? cache.rev as number : 0;
        this.dirty = cache.dirty === true;
      }
    } catch { this.settings = defaultDjSettings(); this.updatedAt = null; this.rev = 0; this.dirty = false; }
  }

  /** Applies a partial change (throws on a bad value, changing nothing), then tries to save it on the PC. */
  async update(patch: unknown): Promise<SettingsSaveOutcome> { return this.commit(mergeDjSettings(this.settings, patch)); }
  /** Restores the safe defaults (every setting back to DJ decides). */
  async reset(): Promise<SettingsSaveOutcome> { return this.commit(defaultDjSettings()); }

  private async commit(next: DjSettings): Promise<SettingsSaveOutcome> {
    this.settings = next; this.updatedAt = this.now().toISOString(); this.dirty = true; this.saved = false; this.seq++;
    this.persist(); this.changed();
    if (!this.relayReady) return 'local';
    await this.push();
    return this.isSaved ? 'saved' : 'queued';
  }

  private headers(): Record<string, string> {
    return {'Content-Type': 'application/json', ...(this.options.token ? {'X-Relay-Token': this.options.token} : {})};
  }
  private get init(): RequestInit { return this.options.token ? {mode: 'cors', cache: 'no-store', credentials: 'omit'} : {cache: 'no-store'}; }

  private adopt(doc: Doc, confirmed: boolean): void {
    this.settings = doc.settings; this.updatedAt = doc.updatedAt; this.rev = doc.rev;
    if (confirmed) { this.dirty = false; this.saved = true; }
    this.persist(); this.changed();
  }
  private async readDoc(response: Response): Promise<Doc | null> {
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return null;
    try {
      const updatedAt = typeof body.updatedAt === 'string' && !Number.isNaN(Date.parse(body.updatedAt)) ? body.updatedAt : null;
      return {updatedAt, rev: Number.isSafeInteger(body.rev) ? body.rev as number : 0, settings: parseDjSettings(body.settings)};
    } catch { return null; }
  }

  /** Sends the whole current settings (a full object is a valid merge); the PC answer becomes the local copy. */
  private push(): Promise<void> {
    if (this.busy) return this.busy;
    const run = (async () => {
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const sent = this.seq;
          const response = await this.doFetch(this.options.endpoint!, {...this.init, method: 'POST', headers: this.headers(),
            body: JSON.stringify(this.settings)});
          if (response.ok) {
            this.lastProblem = '';
            if (sent !== this.seq) continue; // changed while saving: send the newer copy
            const doc = await this.readDoc(response);
            if (doc) this.adopt({...doc, settings: this.settings}, true); else { this.dirty = false; this.saved = true; this.persist(); this.changed(); }
          } else {
            const code = (await response.json().catch(() => ({})) as {error?: string}).error ?? String(response.status);
            this.lastProblem = response.status === 400 ? `The PC refused the settings (${code}).` : `The PC could not save the settings yet (${code}); they stay local.`;
          }
          break;
        }
      } catch (error) { this.lastProblem = `Cannot reach the relay (${error instanceof Error ? error.message : String(error)}); the settings stay local.`; }
      this.changed();
    })().finally(() => { this.busy = null; });
    this.busy = run;
    return run;
  }

  /** Reads the PC file: pushes a newer local change, otherwise adopts a changed or newer remote copy. */
  async sync(): Promise<void> {
    if (!this.relayReady) return;
    if (this.busy) { await this.busy; }
    try {
      const response = await this.doFetch(this.options.endpoint!, {...this.init, headers: this.options.token ? {'X-Relay-Token': this.options.token} : {}});
      if (!response.ok) { this.lastProblem = `Could not read the PC settings (${response.status}).`; return; }
      const doc = await this.readDoc(response);
      if (!doc) { this.lastProblem = 'The PC settings were not readable.'; return; }
      this.lastProblem = '';
      if (this.dirty || time(this.updatedAt) > time(doc.updatedAt)) { this.dirty = true; await this.push(); return; }
      const differs = doc.rev !== this.rev || doc.updatedAt !== this.updatedAt || JSON.stringify(doc.settings) !== JSON.stringify(this.settings);
      this.saved = true;
      if (differs) this.adopt(doc, true); else { this.persist(); this.changed(); }
    } catch (error) { this.lastProblem = `Cannot reach the relay (${error instanceof Error ? error.message : String(error)}).`; }
  }

  /** Call every few seconds: retries an unsaved change and picks up a change made on the other device. */
  tick(): Promise<void> { return this.sync(); }
}
