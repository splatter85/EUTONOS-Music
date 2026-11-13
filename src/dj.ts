import type {LoadedBrowserPack} from './browser-pack.js';
import {ControlContract, type CommandReceipt, type ControlRequest, type ControlSnapshot} from './control.js';
import {bridgeSeed, hybridPolicyForRoute, type HybridBridgeExit} from './hybrid-handoff.js';
import {eligibleForPlayback} from './pack.js';
import type {AudioAsset, MusicState, VersionRef} from './pack-types.js';
import {compilePhrase, type S01PhraseState} from './phrase-plan.js';
import type {ClockStamp} from './playable-source.js';
import {SmallPlayer, type PlayerSnapshot} from './player.js';
import type {MixPlannerOptions} from './mix-planner.js';

export type DjExecutionStatus = 'pending' | 'queued' | 'scheduled' | 'started' | 'completed'
  | 'applied' | 'cancelled' | 'superseded' | 'no-match' | 'blocked' | 'failed' | 'rejected';
export interface DjExecution {
  readonly status: DjExecutionStatus;
  readonly reason: string;
  readonly trackId: string | null;
}
export interface DjCommandResult {
  readonly receipt: CommandReceipt;
  readonly execution: DjExecution;
}
export interface DjPending {
  readonly kind: 'start' | 'transition';
  readonly source: VersionRef;
  readonly at: ClockStamp;
  readonly end: ClockStamp | null;
  readonly phase: 'scheduled' | 'started';
  readonly queueCommandId: string | null;
  readonly commandId: string;
  readonly state: MusicState | null;
}
export interface DjSnapshot {
  readonly control: ControlSnapshot;
  readonly player: PlayerSnapshot;
  readonly pending: DjPending | null;
  readonly last: DjCommandResult | null;
}
/** Existing authored modes plus opt-in analysis/prepared DSP. */
export type DjHandoff = 'direct' | 'hybrid' | 'mix';
export interface DjOptions {
  readonly handoff?: DjHandoff;
  readonly bridgeExit?: HybridBridgeExit;
  readonly mix?: MixPlannerOptions;
}
interface Plan extends DjPending { readonly commands: string[]; readonly bridgeNoted?: boolean; }
interface Attempt {
  readonly source: VersionRef; readonly commandId: string; readonly commands: string[];
  readonly queueCommandId: string | null; readonly state: MusicState | null; readonly generation: number;
  /** The requested state the bridge serves, or null when its performer does not support it. */
  readonly bridgeState: MusicState | null;
}
interface Selection { readonly asset: AudioAsset | null; readonly queueCommandId: string | null; readonly reason: string; }
const explanation = (error: unknown): string => error instanceof Error ? error.message : String(error);
/** The S04 performer supports explore and drive. For any other target the bridge plays
 * explore and reports no state rather than claiming the request. */
const bridgeStateFor = (requested: MusicState): S01PhraseState => requested === 'drive' ? 'drive' : 'explore';

/**
 * Session-local S03 DJ over the existing two-recording renderer. Commands decide
 * and schedule; snapshot only reconciles already scheduled clock events. No timer,
 * network service, persistence, automatic looping or speculative B→A route.
 * S05 adds an optional hybrid handoff: the same A → B route through a procedural bridge.
 */
export class DeterministicDj {
  private readonly control: ControlContract;
  private readonly recordings: readonly AudioAsset[];
  private readonly available: ReadonlySet<string>;
  private readonly operations = new Map<string, DjCommandResult>();
  private readonly requests = new Map<string, ControlRequest>();
  private readonly sourceStates = new Map<string, MusicState | null>();
  private lastId: string | null = null;
  private lastRejection: DjCommandResult | null = null;
  private startPlan: Plan | null = null;
  private transitionPlan: Plan | null = null;
  private startAttempt: Attempt | null = null;
  private transitionAttempt: Attempt | null = null;
  private startTask: Promise<void> | null = null;
  private startingId: string | null = null;
  private startingQueueCommandId: string | null = null;
  private preparing: string | null = null;
  private selectionEpoch = 0;
  private transportEpoch = 0;
  private closed = false;
  private handoff: DjHandoff;
  private readonly bridgeExit: HybridBridgeExit;
  private mixOptions: MixPlannerOptions;

  constructor(private readonly renderer: SmallPlayer, private readonly loaded: LoadedBrowserPack,
    initialState: MusicState = 'explore', options: DjOptions = {}) {
    this.handoff = options.handoff ?? 'direct';
    this.bridgeExit = options.bridgeExit ?? 'phrase';
    this.mixOptions = {...options.mix};
    if (!['direct', 'hybrid', 'mix'].includes(this.handoff) || !['phrase', 'end'].includes(this.bridgeExit)) {
      throw new Error('Unsupported handoff option.');
    }
    this.recordings = loaded.pack.assets.filter(a => a.source_kind === 'recording')
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const supported = new Set([renderer.pair.from.id, renderer.pair.to.id]);
    this.available = new Set(this.recordings.filter(a => supported.has(a.id)
      && loaded.files.has(a.file.path) && eligibleForPlayback(a, loaded.allowFixtures)).map(a => a.id));
    const genres = [...new Set(this.recordings.flatMap(a => [...a.genres]))].sort();
    this.control = new ControlContract({
      tracks: this.recordings.map(a => ({id: a.id, available: this.available.has(a.id)})),
      genres: genres.map(id => ({id, available: this.recordings.some(a => a.genres.includes(id) && this.available.has(a.id))})),
    }, renderer.clock.engineGeneration, initialState);
  }

  /** Exact retries reconcile the existing operation; they never repeat its effect. */
  request(request: ControlRequest, ownership: Promise<void> = Promise.resolve()): Promise<DjCommandResult> {
    // A gate supplied by a caller must be observed even for a refused/no-match Play.
    void ownership.catch(() => undefined);
    this.sync();
    const receipt = this.control.accept(request);
    if (receipt.status === 'rejected' && receipt.code === 'id-conflict') {
      const conflict: DjCommandResult = {receipt, execution: {status: 'rejected', reason: receipt.code, trackId: null}};
      this.lastRejection = conflict;
      return Promise.resolve(structuredClone(conflict));
    }
    this.lastId = request.commandId;
    this.lastRejection = null;
    const prior = this.operations.get(request.commandId);
    if (prior) return Promise.resolve(structuredClone(prior));
    this.requests.set(request.commandId, structuredClone(request));
    this.operations.set(request.commandId, {receipt, execution: {
      status: receipt.status === 'accepted' ? 'pending' : 'rejected',
      reason: receipt.status === 'accepted' ? 'Accepted; execution pending.' : receipt.code, trackId: null,
    }});
    if (receipt.status === 'rejected') return Promise.resolve(this.result(request.commandId));
    if (this.closed) {
      this.outcome(request.commandId, 'failed', 'Session closed. Reload to create a new session.');
      return Promise.resolve(this.result(request.commandId));
    }
    // execute enters synchronously, so Play's context.resume remains in the gesture.
    return this.execute(request, ownership).catch(error => {
      if (this.operations.get(request.commandId)?.execution.status === 'pending') {
        this.outcome(request.commandId, 'failed', explanation(error));
      }
    }).then(() => { this.sync(); return this.result(request.commandId); });
  }

  operation(commandId: string): DjCommandResult | null {
    this.sync();
    const result = this.operations.get(commandId);
    return result ? structuredClone(result) : null;
  }

  snapshot(): DjSnapshot {
    const player = this.sync();
    const plan = this.transitionPlan ?? this.startPlan;
    const pending: DjPending | null = plan ? {
      kind: plan.kind, source: plan.source, at: plan.at, end: plan.end, phase: plan.phase,
      queueCommandId: plan.queueCommandId, commandId: plan.commandId, state: plan.state,
    } : null;
    return structuredClone({control: this.control.snapshot(), player, pending,
      last: this.lastRejection ?? (this.lastId ? this.operations.get(this.lastId) ?? null : null)});
  }

  setVolume(value: number): void { this.renderer.setVolume(value); }

  /** Applies to later selections only. A committed transition keeps its original kind. */
  setHandoff(mode: DjHandoff): void {
    if (mode !== 'direct' && mode !== 'hybrid' && mode !== 'mix') throw new Error('Unsupported handoff option.');
    this.handoff = mode;
  }
  get handoffMode(): DjHandoff { return this.handoff; }
  /** Options apply to the next selection; prepared/committed audio keeps its plan. */
  setMixOptions(options: MixPlannerOptions): void { this.mixOptions = {...options}; }

  async dispose(): Promise<void> {
    this.sync();
    this.cancelWork('Session closed.');
    this.closed = true;
    await this.renderer.dispose();
    this.sync();
  }

  private async execute(request: ControlRequest, ownership: Promise<void>): Promise<void> {
    switch (request.type) {
      case 'transport': {
        if (request.action === 'stop') {
          this.cancelWork('Stopped; unstarted queue entries are retained.');
          this.renderer.stop();
          this.outcome(request.commandId, 'applied', 'Stopped. Unstarted queue entries are retained.');
        } else if (request.action === 'pause') {
          ++this.transportEpoch;
          if (this.startingId) this.outcome(this.startingId, 'cancelled', 'Paused before start committed.');
          this.startTask = null;
          this.invalidatePreparation('Paused before preparation completed.');
          const task = this.renderer.pause();
          await task;
          this.outcome(request.commandId, 'applied', 'Output gated and the audio clock paused.');
        } else if (request.action === 'mute' || request.action === 'unmute') {
          this.renderer.setMuted(request.action === 'mute');
          this.outcome(request.commandId, 'applied', request.action === 'mute' ? 'Output muted.' : 'Output unmuted.');
        } else await this.play(request.commandId, ownership);
        break;
      }
      case 'hold':
        this.outcome(request.commandId, 'applied', request.enabled
          ? 'State and genre are held. Queue, Next and transport remain available.'
          : 'Hold released. Rejected targets are not replayed.');
        break;
      case 'cancelNext': {
        this.invalidatePreparation('Pending selection cancelled.');
        if (!this.cancelFuture('cancelled', 'Pending selection cancelled; queue entries retained.')) {
          this.outcome(request.commandId, 'blocked', 'The transition has started. It will finish; Stop remains immediate.');
        } else this.outcome(request.commandId, 'applied', 'Future selection cancelled. Queue entries retained; use Next or Play to request again.');
        break;
      }
      case 'cancelQueue': {
        this.sync();
        const priorStatus = this.operations.get(request.queueCommandId)?.execution.status;
        if (priorStatus === 'started' || priorStatus === 'completed') {
          this.outcome(request.commandId, 'blocked', 'The queued entry has already started; it cannot be removed as a future entry.');
          break;
        }
        const playback = this.renderer.snapshot(), earliest = playback.mix?.earliestEffect;
        const mixEntered = earliest !== undefined && earliest.engineGeneration === playback.engineGeneration &&
          playback.currentFrame >= earliest.frame;
        if (this.transitionPlan?.queueCommandId === request.queueCommandId &&
          (this.bridgeEntered(playback) || mixEntered)) {
          this.outcome(request.commandId, 'blocked', mixEntered
            ? 'The mix prelude has entered, so B will still follow; the entry is no longer listed. Stop remains immediate.'
            : 'The procedural bridge has entered, so B will still follow; the entry is no longer listed. Stop remains immediate.');
          break;
        }
        this.outcome(request.queueCommandId, 'cancelled', 'Removed from the manual queue.');
        const reserved = [this.startPlan, this.transitionPlan].find(p => p?.queueCommandId === request.queueCommandId);
        if (reserved?.kind === 'start' || this.startTask && this.startingQueueCommandId === request.queueCommandId) {
          this.cancelWork('Queued start removed.');
          this.renderer.stop();
        } else if (reserved) {
          this.invalidatePreparation('Queued transition removed.');
          if (!this.cancelTransition('cancelled', 'Queued transition removed.')) {
            this.sync();
            this.outcome(request.commandId, 'blocked', 'The entry crossed its start boundary during cancellation. The handoff will finish.');
            break;
          }
        } else this.invalidatePreparation('Queue changed before preparation completed.');
        this.outcome(request.commandId, 'applied', 'Queue entry removed. Use Next or Play to schedule the remaining head.');
        break;
      }
      case 'setState': case 'requestGenre': case 'queueTrack': case 'nextSong':
        await this.select(request.commandId);
        break;
    }
  }

  private async play(commandId: string, ownership: Promise<void>): Promise<void> {
    const state = this.sync();
    if (this.startTask || ['loading', 'scheduled', 'playing'].includes(state.state)) {
      this.outcome(commandId, 'applied', 'Playback is already running or preparing; no duplicate start.');
      return;
    }
    const epoch = ++this.transportEpoch;
    if (state.state === 'paused' && state.voices.length) {
      await this.renderer.resume(ownership);
      if (epoch === this.transportEpoch) this.outcome(commandId, 'applied', 'Resumed the existing audio timeline.');
      else this.outcome(commandId, 'cancelled', 'Resume was superseded by a newer transport request.');
      return;
    }
    const selection = this.choose(null);
    if (!selection.asset) { this.outcome(commandId, 'no-match', selection.reason); return; }
    this.invalidatePreparation('A new Play owns preparation.');
    this.sourceStates.clear();
    const asset = selection.asset;
    const target = this.boundState(asset);
    const task = this.renderer.play(asset.id === this.renderer.pair.from.id ? 'a' : 'b', ownership);
    this.startTask = task;
    this.startingId = commandId;
    this.startingQueueCommandId = selection.queueCommandId;
    this.startAttempt = {source: {id: asset.id, revision: asset.revision}, commandId, commands: [commandId],
      queueCommandId: selection.queueCommandId, state: target, generation: this.renderer.clock.engineGeneration,
      bridgeState: null};
    try {
      await task;
      const actual = this.sync();
      if (epoch !== this.transportEpoch) {
        if (this.operations.get(commandId)?.execution.status === 'pending') this.outcome(commandId, 'cancelled', 'Start was cancelled before it could commit.');
        return;
      }
      const voice = actual.voices.find(v => v.source.id === asset.id);
      if (!voice) { this.outcome(commandId, 'cancelled', 'No source was scheduled.'); return; }
    } finally {
      if (this.startTask === task) this.startTask = null;
      if (this.startingId === commandId) { this.startingId = null; this.startingQueueCommandId = null; }
      if (this.startAttempt?.commandId === commandId) this.startAttempt = null;
    }
  }

  private async select(commandId: string): Promise<void> {
    this.invalidatePreparation('A newer request superseded selection preparation.');
    const epoch = this.selectionEpoch;
    this.preparing = commandId;
    if (this.startTask) await this.startTask.catch(() => undefined);
    if (epoch !== this.selectionEpoch) return;
    const state = this.sync();
    if (this.transitionPlan?.phase === 'started' || this.bridgeEntered(state)) {
      this.outcome(commandId, 'blocked', 'The transition has started. The new target is retained; request Next after it finishes.');
      this.preparing = null;
      return;
    }
    const current = ['idle', 'ended', 'closed'].includes(state.state) ? null
      : state.now.at(-1) ?? state.voices[0]?.source.id ?? null;
    const choice = this.choose(current);
    const waiting = this.waitsBehindHead(commandId, choice);
    const requestedState = this.control.snapshot().requested.state;
    if (this.transitionPlan && choice.asset?.id === this.transitionPlan.source.id
      && choice.queueCommandId === this.transitionPlan.queueCommandId
      && (!state.handoff || state.handoff.bridge.state === bridgeStateFor(requestedState))) {
      // Hold/mute or another compatible request never restart an existing mix.
      if (!waiting) {
        const target = this.control.snapshot().requested;
        const retained = this.transitionPlan.commands.filter(id => {
          const previous = this.requests.get(id)!;
          const superseded = previous.type === 'setState' && previous.state !== target.state
            || previous.type === 'requestGenre' && previous.genreId !== target.genreId;
          if (superseded) this.outcome(id, 'superseded', 'A newer target replaced this unstarted target.', choice.asset!.id);
          return !superseded;
        });
        this.transitionPlan = {...this.transitionPlan, commands: retained, state: this.boundState(choice.asset)};
        this.sourceStates.set(choice.asset.id, this.transitionPlan.state);
        if (state.handoff) {
          const played = state.handoff.bridge.state;
          this.sourceStates.set(state.handoff.bridge.recipe.id, requestedState === played ? played : null);
        }
        this.transitionPlan.commands.push(commandId);
        this.outcome(commandId, 'scheduled', 'The existing checked transition already serves this request.', choice.asset.id);
      }
      this.preparing = null;
      return;
    }
    if (!this.cancelTransition('superseded', 'A newer selection replaced the future handoff.')) {
      this.outcome(commandId, 'blocked', 'The transition has started; it will finish.');
      this.preparing = null;
      return;
    }
    if (!choice.asset) {
      if (!waiting) this.outcome(commandId, 'no-match', choice.reason);
      this.preparing = null;
      return;
    }
    if (!current) {
      if (!waiting) this.outcome(commandId, 'queued', 'Selected for the next explicit Play; no audio has started.', choice.asset.id);
      this.preparing = null;
      return;
    }
    try {
      const requested = this.control.snapshot().requested.state;
      const bridgeState = bridgeStateFor(requested);
      this.transitionAttempt = {source: {id: choice.asset.id, revision: choice.asset.revision},
        commandId, commands: waiting ? [] : [commandId], queueCommandId: choice.queueCommandId,
        state: this.boundState(choice.asset), generation: this.renderer.clock.engineGeneration,
        bridgeState: requested === bridgeState ? requested : null};
      if (this.handoff === 'hybrid') {
        // The seed derives from the command ID, so a recorded command replays the same bridge.
        const policy = hybridPolicyForRoute(this.renderer.pair.route);
        if (!policy) throw new Error(`No hybrid handoff policy covers route ${this.renderer.pair.route.id}.`);
        const bridge = compilePhrase(this.loaded.pack,
          {seed: bridgeSeed(commandId), state: bridgeState, recipe: policy.recipe, allowFixtures: this.loaded.allowFixtures});
        await this.renderer.scheduleHybrid(bridge, this.bridgeExit);
      } else if (this.handoff === 'mix') await this.renderer.scheduleMix({...this.mixOptions});
      else await this.renderer.scheduleAB();
      this.sync(); // native start may have crossed before this continuation ran
      if (epoch !== this.selectionEpoch) return;
      if (this.transitionAttempt?.commandId === commandId) {
        this.transitionAttempt = null;
        this.outcome(commandId, 'cancelled', 'The transition was not committed.');
      }
    } catch (error) {
      if (epoch === this.selectionEpoch && !waiting) this.outcome(commandId, 'no-match',
        `${explanation(error)} Current audio is unchanged and queued entries are retained.`, choice.asset.id);
    } finally {
      if (this.preparing === commandId) this.preparing = null;
      if (this.transitionAttempt?.commandId === commandId) this.transitionAttempt = null;
    }
  }

  private choose(current: string | null): Selection {
    const snapshot = this.control.snapshot();
    // A scheduled initial Play reserves its head until the audio clock reaches it.
    const head = snapshot.queue.find(q => q.commandId !== this.startPlan?.queueCommandId);
    const candidates = head ? this.recordings.filter(a => a.id === head.trackId)
      : this.recordings.filter(a => a.id !== current && a.states.includes(snapshot.requested.state)
        && (snapshot.requested.genreId === null || a.genres.includes(snapshot.requested.genreId)));
    const eligible = candidates.filter(a => this.available.has(a.id));
    const asset = eligible.find(a => current === null || current === this.renderer.pair.from.id && a.id === this.renderer.pair.to.id);
    const reason = head
      ? `Manual queue head ${head.trackId} has no checked route from ${current ?? 'the stopped player'}. Remove it or Stop and Play it explicitly.`
      : `No eligible ${current ? 'different ' : ''}recording and checked route match ${snapshot.requested.state}${snapshot.requested.genreId ? ` / ${snapshot.requested.genreId}` : ''}. Current audio may finish naturally; no substitute or loop is invented.`;
    return {asset: asset ?? null, queueCommandId: head?.commandId ?? null, reason};
  }

  private boundState(asset: AudioAsset): MusicState | null {
    const requested = this.control.snapshot().requested.state;
    return asset.states.includes(requested) ? requested : null;
  }

  private waitsBehindHead(commandId: string, choice: Selection): boolean {
    const queued = this.control.snapshot().queue.find(q => q.commandId === commandId);
    if (queued && choice.queueCommandId !== commandId) {
      this.outcome(commandId, 'queued', 'Waiting behind the earlier manual queue entry.', queued.trackId);
      return true;
    }
    const target = this.control.snapshot().requested;
    if (choice.queueCommandId && choice.asset && (!choice.asset.states.includes(target.state)
      || target.genreId !== null && !choice.asset.genres.includes(target.genreId))) {
      this.outcome(commandId, 'blocked', 'The manual queue takes priority; the requested target remains unmet.', choice.asset.id);
      return true;
    }
    return false;
  }

  private invalidatePreparation(reason: string): void {
    ++this.selectionEpoch;
    if (this.preparing) {
      const id = this.preparing;
      if (this.control.snapshot().queue.some(q => q.commandId === id)) this.outcome(id, 'queued', reason);
      else this.outcome(id, 'superseded', reason);
      this.preparing = null;
    }
    // Separate transition token; never invalidates a concurrent initial Play.
    this.renderer.cancelTransitionPreparation();
  }

  private cancelTransition(status: 'cancelled' | 'superseded', reason: string): boolean {
    if (!this.transitionPlan && this.renderer.snapshot().transition === 'complete') return true;
    if (!this.renderer.cancelPendingTransition()) return false;
    if (this.transitionPlan) this.updatePlan(this.transitionPlan, status, reason);
    this.transitionAttempt = null;
    this.transitionPlan = null;
    this.control.clearPrepared();
    return true;
  }

  private cancelFuture(status: 'cancelled' | 'superseded', reason: string): boolean {
    const playback = this.renderer.snapshot(), earliest = playback.mix?.earliestEffect;
    if (earliest !== undefined && earliest.engineGeneration === playback.engineGeneration &&
      playback.currentFrame >= earliest.frame && playback.transition !== 'complete') return false;
    const hadTransition = this.transitionPlan !== null || this.renderer.snapshot().transition === 'scheduled';
    if (!this.cancelTransition(status, reason)) return false;
    if (!hadTransition && (this.startPlan || this.startAttempt)) {
      ++this.transportEpoch;
      if (this.startingId) this.outcome(this.startingId, status, reason);
      this.startTask = null;
      if (this.startPlan) this.updatePlan(this.startPlan, status, reason);
      this.startPlan = null;
      this.startAttempt = null;
      this.renderer.stop();
    }
    return true;
  }

  private cancelWork(reason: string): void {
    ++this.transportEpoch;
    if (this.startingId) this.outcome(this.startingId, 'cancelled', reason);
    this.startTask = null;
    this.invalidatePreparation(reason);
    for (const plan of [this.startPlan, this.transitionPlan]) if (plan) this.updatePlan(plan, 'cancelled', reason);
    this.startPlan = null;
    this.transitionPlan = null;
    this.startAttempt = null;
    this.transitionAttempt = null;
    this.control.clearPrepared();
  }

  private sync(): PlayerSnapshot {
    const player = this.renderer.snapshot();
    this.control.adoptEngineGeneration(player.engineGeneration);
    // Retain reservation identity before awaits. Native schedules are authoritative
    // even if promise observation is delayed past their entry or handoff boundary.
    if (this.startAttempt?.generation === player.engineGeneration) {
      const attempt = this.startAttempt;
      const voice = player.voices.find(v => v.source.id === attempt.source.id && v.source.revision === attempt.source.revision);
      if (voice) {
        this.startPlan = {...attempt, kind: 'start', at: voice.start, end: null, phase: 'scheduled'};
        this.sourceStates.set(attempt.source.id, attempt.state);
        this.updatePlan(this.startPlan, 'scheduled', 'Prepared and scheduled; waiting for the audio clock.');
        this.startAttempt = null;
        if (this.startingId === attempt.commandId) { this.startingId = null; this.startingQueueCommandId = null; }
      }
    }
    if (this.transitionAttempt?.generation === player.engineGeneration && player.transitionAt && player.transitionEnd) {
      const attempt = this.transitionAttempt;
      // A hybrid's B enters at the bridge exit, not at A's exit cue. The queue head and
      // B's start are reconciled at B's own entry, as in S03.
      const at = player.handoff ? player.handoff.toStart : player.transitionAt;
      this.transitionPlan = {...attempt, kind: 'transition', at, end: player.transitionEnd, phase: 'scheduled'};
      this.sourceStates.set(attempt.source.id, attempt.state);
      if (player.handoff) this.sourceStates.set(player.handoff.bridge.recipe.id, attempt.bridgeState);
      this.updatePlan(this.transitionPlan, 'scheduled', player.handoff
        ? 'Scheduled the checked A → procedural bridge → B handoff; not started yet.'
        : player.mix ? player.mix.reason
        : 'Scheduled at the checked A → B cue; not started yet.');
      this.transitionAttempt = null;
      if (this.preparing === attempt.commandId) this.preparing = null;
    }
    for (const key of ['startPlan', 'transitionPlan'] as const) {
      let plan = this[key];
      if (!plan) continue;
      if (plan.at.engineGeneration !== player.engineGeneration) {
        this.updatePlan(plan, 'cancelled', 'The renderer generation changed.');
        this[key] = null;
        continue;
      }
      if (key === 'transitionPlan' && plan.phase === 'scheduled' && !plan.bridgeNoted && this.bridgeEntered(player)) {
        plan = {...plan, bridgeNoted: true};
        this[key] = plan;
        this.updatePlan(plan, 'scheduled', 'The procedural bridge has entered; B enters at the bridge exit. It can no longer be cancelled; Stop remains immediate.');
      }
      if (plan.phase === 'scheduled' && player.currentFrame >= plan.at.frame) {
        if (plan.queueCommandId) {
          const control = this.control.snapshot();
          if (control.queue[0]?.commandId === plan.queueCommandId) this.control.acknowledgeQueueHead(plan.queueCommandId, control.revision);
        }
        plan = {...plan, phase: 'started'};
        this[key] = plan;
        this.updatePlan(plan, 'started', 'The renderer clock reached the scheduled entry. Device output is not measured.');
      }
      if (plan.phase === 'started' && (plan.kind === 'start' || player.currentFrame >= plan.end!.frame)) {
        this.updatePlan(plan, 'completed', plan.kind === 'start' ? 'Playback start confirmed by the renderer clock.' : 'The renderer clock reached the handoff end.');
        this[key] = null;
      }
    }
    const prepared = this.transitionPlan ?? this.startPlan;
    if (prepared) this.control.reportPrepared({forRevision: this.control.snapshot().revision, source: prepared.source, at: prepared.at});
    else this.control.clearPrepared();
    const sources = player.voices.filter(v => player.now.includes(v.source.id)).map(v => v.source);
    const primary = sources.at(-1) ?? null;
    this.control.reportAudible({source: primary, sources, state: primary ? this.sourceStates.get(primary.id) ?? null : null,
      transport: player.state === 'paused' ? 'paused' : player.state === 'playing' && player.contextState === 'running' ? 'playing' : 'stopped',
      muted: player.muted, at: {engineGeneration: player.engineGeneration, frame: player.currentFrame}});
    return player;
  }

  /** True once a scheduled hybrid's bridge has entered: the handoff can no longer be cancelled. */
  private bridgeEntered(player: PlayerSnapshot): boolean {
    return this.transitionPlan !== null && player.handoff !== null && player.handoff.phase !== 'scheduled';
  }

  private updatePlan(plan: Plan, status: DjExecutionStatus, reason: string): void {
    for (const id of new Set([...plan.commands, ...(plan.queueCommandId ? [plan.queueCommandId] : [])])) {
      this.outcome(id, status, reason, plan.source.id);
    }
  }
  private outcome(commandId: string, status: DjExecutionStatus, reason: string, trackId: string | null = null): void {
    const operation = this.operations.get(commandId);
    if (operation) this.operations.set(commandId, {...operation, execution: {status, reason, trackId}});
  }
  private result(commandId: string): DjCommandResult { return structuredClone(this.operations.get(commandId)!); }
}
