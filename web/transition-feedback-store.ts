/**
 * Browser-side cache and queue for transition feedback. The PC's ratings file (written only by the
 * phone relay) is the source of truth whenever the relay is reachable; localStorage is a cache plus
 * a queue for ratings the relay has not accepted yet. Throwaway browser profiles (npm run
 * phone:host) lose localStorage, so a queued rating that never reaches the relay is lost with it:
 * the UI says "queued" rather than "saved" until the relay confirms.
 */
import {emptyTransitionRatings, validateTransitionRatingLog} from './transition-policy.js';
import {feedbackFromLegacy, FEEDBACK_LIMITS, latestPerPlan, parseTransitionFeedback, type TransitionFeedback} from './transition-feedback.js';

export const FEEDBACK_CACHE_KEY = 'eutonos-music.transition-feedback.v1';
export const LEGACY_RATINGS_KEY = 'eutonos-music.transition-ratings.v1';
const CACHE_VERSION = 'em.transition-feedback-cache.v1';
export type RateOutcome = 'saved' | 'queued' | 'local';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface FeedbackStoreOptions {
  /** Relay origin and per-run token; either null means "no relay": the cache is browser-only. */
  readonly relay: string | null;
  readonly token: string | null;
  readonly storage?: KeyValueStorage | null;
  readonly fetch?: typeof fetch;
  readonly onChange?: () => void;
}
const keyOf = (entry: TransitionFeedback): string => `${entry.planId}|${entry.at}`;

export class FeedbackStore {
  private readonly entries = new Map<string, TransitionFeedback>();
  private readonly pending = new Set<string>();
  private readonly onFile = new Set<string>();
  private flushing: Promise<void> | null = null;
  /** The last problem talking to the relay, for the UI; empty when fine. */
  lastProblem = '';
  private readonly storage: KeyValueStorage | null;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: FeedbackStoreOptions) {
    this.storage = options.storage === undefined ? (() => { try { return localStorage; } catch { return null; } })() : options.storage;
    this.doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.load();
  }

  /** True when a relay and token exist, so ratings can reach the PC file. */
  get relayReady(): boolean { return this.options.relay !== null && this.options.token !== null; }
  get pendingCount(): number { return this.pending.size; }
  all(): TransitionFeedback[] { return latestPerPlan([...this.entries.values()]); }
  get(planId: string): TransitionFeedback | undefined { return this.entries.get(planId); }
  /** True when the relay has confirmed exactly this rating (plan id and time) is in the PC file. */
  isSaved(planId: string): boolean {
    const entry = this.entries.get(planId);
    return entry !== undefined && this.onFile.has(keyOf(entry));
  }

  private changed(): void { try { this.options.onChange?.(); } catch { /* rendering must not break rating */ } }
  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(FEEDBACK_CACHE_KEY, JSON.stringify({version: CACHE_VERSION, entries: this.all(), pending: [...this.pending], legacyMigrated: true}));
    } catch { /* storage blocked or full: the relay file is still the record */ }
  }
  private load(): void {
    if (!this.storage) return;
    let migrated = false;
    try {
      const raw = this.storage.getItem(FEEDBACK_CACHE_KEY);
      const cache = raw ? JSON.parse(raw) as {version?: unknown; entries?: unknown; pending?: unknown; legacyMigrated?: unknown} : null;
      if (cache?.version === CACHE_VERSION && Array.isArray(cache.entries)) {
        for (const value of cache.entries.slice(0, FEEDBACK_LIMITS.entries)) {
          try { const entry = parseTransitionFeedback(value); this.entries.set(entry.planId, entry); } catch { /* drop a bad cache entry */ }
        }
        if (Array.isArray(cache.pending)) for (const key of cache.pending) if (typeof key === 'string') this.pending.add(key);
        migrated = cache.legacyMigrated === true;
      }
    } catch { /* unreadable cache: start empty */ }
    if (!migrated) {
      // Older Love/Like/Dislike log: copy it into the new cache (kept in place) and queue it for the PC file.
      try {
        const raw = this.storage.getItem(LEGACY_RATINGS_KEY);
        const log = raw ? validateTransitionRatingLog(JSON.parse(raw)) : emptyTransitionRatings();
        for (const entry of feedbackFromLegacy(log)) {
          if (!this.entries.has(entry.planId)) { this.entries.set(entry.planId, entry); this.pending.add(keyOf(entry)); }
        }
      } catch { /* no usable legacy log */ }
    }
    this.prune();
    this.persist();
  }
  private prune(): void {
    const live = new Set([...this.entries.values()].map(keyOf));
    for (const key of [...this.pending]) if (!live.has(key)) this.pending.delete(key);
  }

  /** Stores the rating locally (replacing any earlier one for the plan), then tries to save it on the PC. */
  async rate(entry: TransitionFeedback): Promise<RateOutcome> {
    const checked = parseTransitionFeedback(entry);
    if (this.entries.size >= FEEDBACK_LIMITS.entries && !this.entries.has(checked.planId)) throw new Error('The local rating cache is full (500).');
    this.entries.set(checked.planId, checked);
    this.pending.add(keyOf(checked));
    this.prune();
    this.persist();
    this.changed();
    if (!this.relayReady) return 'local';
    await this.flush();
    return this.isSaved(checked.planId) ? 'saved' : 'queued';
  }

  private headers(): Record<string, string> { return {'Content-Type': 'application/json', 'X-Relay-Token': this.options.token ?? ''}; }

  /** Sends queued ratings in order. Network or relay trouble keeps them queued; a refused (400) one is dropped. */
  flush(): Promise<void> {
    if (!this.relayReady || this.pending.size === 0) return Promise.resolve();
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      for (const key of [...this.pending]) {
        const entry = [...this.entries.values()].find(e => keyOf(e) === key);
        if (!entry) { this.pending.delete(key); continue; }
        try {
          const response = await this.doFetch(`${this.options.relay}/api/dj/rating`, {method: 'POST', headers: this.headers(), body: JSON.stringify(entry),
            mode: 'cors', cache: 'no-store', credentials: 'omit'});
          if (response.ok) { this.pending.delete(key); this.onFile.add(key); this.lastProblem = ''; }
          else {
            const code = (await response.json().catch(() => ({})) as {error?: string}).error ?? String(response.status);
            if (response.status === 400) { this.pending.delete(key); this.lastProblem = `The PC refused a rating (${code}); it was not saved.`; }
            else { this.lastProblem = `The PC could not save the rating yet (${code}); it stays queued.`; break; }
          }
        } catch (error) {
          this.lastProblem = `Cannot reach the relay (${error instanceof Error ? error.message : String(error)}); the rating stays queued.`;
          break;
        }
      }
      this.persist();
      this.changed();
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  /** Reads the PC file back and merges it: the file wins unless a newer queued rating exists locally. */
  async sync(): Promise<void> {
    if (!this.relayReady) return;
    try {
      const response = await this.doFetch(`${this.options.relay}/api/dj/ratings`, {headers: {'X-Relay-Token': this.options.token ?? ''},
        mode: 'cors', cache: 'no-store', credentials: 'omit'});
      if (!response.ok) { this.lastProblem = `Could not read the PC ratings file (${response.status}).`; return; }
      const body = await response.json() as {entries?: unknown};
      if (!Array.isArray(body.entries)) return;
      for (const value of body.entries.slice(0, FEEDBACK_LIMITS.entries)) {
        let remote: TransitionFeedback;
        try { remote = parseTransitionFeedback(value); } catch { continue; }
        this.onFile.add(keyOf(remote));
        const local = this.entries.get(remote.planId);
        if (local && this.pending.has(keyOf(local)) && Date.parse(local.at) > Date.parse(remote.at)) continue;
        this.entries.set(remote.planId, remote);
      }
      this.prune();
      this.persist();
      this.changed();
    } catch (error) { this.lastProblem = `Cannot reach the relay (${error instanceof Error ? error.message : String(error)}).`; }
  }

  /** Call every few seconds: retries queued ratings. */
  async tick(): Promise<void> { await this.flush(); }
}
