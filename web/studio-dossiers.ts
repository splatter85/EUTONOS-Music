/**
 * Studio set page wiring for the song dossiers (kept out of studio.ts so that file only gains a few
 * hook calls). It builds the scheduler's real dependencies:
 *  - songs: the set's eligible recordings, each with its dossier identity (audio hash plus hints);
 *  - order: now playing, next (queue head), queue order, then the rest of the catalogue;
 *  - busy: a handover is being prepared or mixed, or a Next is pending;
 *  - analyse: decode one song into a throwaway context at the PLAYER's sample rate (so the analysis
 *    cache key matches what the planner will ask for), run the existing whole-song analysis through
 *    `PersistentSetAnalysisCache` (same Workers, same cache), build the dossier and release the audio.
 * Nothing here chooses a transition or touches the player's own decode cache.
 */
import {decodeRecording, type LoadedBrowserPack} from '../src/browser-pack.js';
import type {SmallPlayer} from '../src/player.js';
import type {DeterministicDj} from '../src/dj.js';
import type {AudioAsset} from '../src/pack-types.js';
import {browserMixPreparation} from '../src/mix-transition.js';
import type {PersistentSetAnalysisCache} from './set-analysis-cache.js';
import {buildSongDossier, identityOfAsset} from './song-dossier.js';
import {DossierScheduler, DossierStore, IndexedDbDossierLocal, RelayDossierRemote, type AnalyseResult, type SchedulerOrder, type SchedulerSong} from './song-dossier-store.js';

export interface StudioDossierOptions {
  readonly loaded: () => LoadedBrowserPack | null;
  readonly player: () => SmallPlayer | null;
  readonly dj: () => DeterministicDj | null;
  readonly cache: PersistentSetAnalysisCache;
  /** Relay origin and per-run token; a null token means no PC store (IndexedDB only). */
  readonly relay: string;
  readonly token: string | null;
  readonly onChange: () => void;
}
const ACTIVE = ['loading', 'scheduled', 'playing', 'paused'];

export class StudioDossiers {
  readonly store: DossierStore;
  readonly scheduler: DossierScheduler;
  constructor(private readonly options: StudioDossierOptions) {
    const local = typeof indexedDB === 'undefined' ? null : new IndexedDbDossierLocal();
    this.store = new DossierStore(local, options.token ? new RelayDossierRemote(options.relay, options.token) : null);
    this.scheduler = new DossierScheduler({
      store: this.store,
      analyse: song => this.analyse(song),
      songs: () => this.songs(),
      order: () => this.order(),
      busy: () => this.busy(),
      planWarm: song => this.warm(song),
      onChange: options.onChange,
    });
  }
  private assets(): AudioAsset[] { return this.options.loaded()?.pack.assets.filter(a => a.source_kind === 'recording') ?? []; }
  private songs(): SchedulerSong[] { return this.assets().map(a => ({id: a.id, identity: identityOfAsset(a)})); }
  private order(): SchedulerOrder {
    const snap = this.options.dj()?.snapshot();
    const queue = (snap?.control.queue ?? []).map(q => q.trackId);
    const player = snap?.player;
    const now = player && ACTIVE.includes(player.state) ? player.now.at(-1) ?? null : null;
    return {nowPlaying: now, next: queue[0] ?? null, queue: queue.slice(1)};
  }
  /** Never while a handover is prepared or mixed, or Next is waiting: those own the CPU and the Workers. */
  private busy(): boolean {
    const snap = this.options.dj()?.snapshot();
    if (!snap) return false;
    const phase = snap.player.mix?.phase;
    return phase === 'preparing' || phase === 'prelude' || phase === 'mixing' || snap.player.transition === 'mixing' || snap.pending !== null;
  }
  private rate(): number | null { return this.options.player()?.clock.sampleRate ?? null; }
  /** True when the planner's cache already holds the finished whole-song analysis (so Next will not analyse it again). */
  private warm(song: SchedulerSong): boolean {
    const rate = this.rate(), asset = this.assets().find(a => a.id === song.id);
    return rate !== null && asset !== undefined && this.options.cache.settledSong(asset, rate) !== null;
  }
  private async analyse(song: SchedulerSong): Promise<AnalyseResult> {
    const loaded = this.options.loaded(), rate = this.rate(), asset = this.assets().find(a => a.id === song.id);
    if (!loaded || !asset) return {ok: false, reason: 'The set is not loaded.'};
    if (rate === null) return {ok: false, reason: 'The player is not ready yet.'};
    // A throwaway decode context at the player's rate; the buffer is released when this function returns.
    const context = new OfflineAudioContext(asset.file.channels, 1, rate);
    const recording = await decodeRecording(loaded, context, asset);
    const started = performance.now();
    const result = await this.options.cache.analyzeSong(recording, browserMixPreparation);
    if (!result.ok) return {ok: false, reason: result.reason};
    const channels = asset.file.channels === 1 ? 1 : 2;
    return {ok: true, dossier: buildSongDossier(result.analysis, {identity: song.identity, channels,
      analysisMs: performance.now() - started, at: new Date().toISOString()})};
  }

  start(): void { this.scheduler.start(); }
  /** Called when Next or a set-next reorder names a song: it becomes the next job. */
  promote(id: string | null): void { if (id) this.scheduler.promote(id); }
  /** Plain progress line for the page and the phone ("Analysed 7/9 · next ready"). */
  text(): string { return this.scheduler.progress().text; }
}
