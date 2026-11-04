import type { MusicState, VersionRef } from './pack-types.js';
import type { ClockStamp } from './playable-source.js';

export const CONTROL_VERSION = 'em.control.v0' as const;
/** Manual queue bound; command receipts persist for the caller-owned session. */
export const CONTROL_LIMITS = Object.freeze({ queue: 32 });

interface RequestBase {
  readonly schemaVersion: typeof CONTROL_VERSION;
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly source: 'manual' | 'automation';
}
export type TransportAction = 'play' | 'pause' | 'stop' | 'mute' | 'unmute';
export type ControlRequest = RequestBase & (
  | { readonly type: 'setState'; readonly state: MusicState }
  | { readonly type: 'requestGenre'; readonly genreId: string }
  | { readonly type: 'queueTrack'; readonly trackId: string }
  | { readonly type: 'nextSong' }
  | { readonly type: 'hold'; readonly enabled: boolean }
  | { readonly type: 'transport'; readonly action: TransportAction }
);

/** Entries are already validated and eligible for this session by the caller.
 * Fixture-only assets require caller opt-in; this class is not an eligibility gate.
 */
export interface ControlCatalog {
  readonly tracks: readonly { readonly id: string; readonly available: boolean }[];
  readonly genres: readonly { readonly id: string; readonly available: boolean }[];
}
export interface RequestedState {
  readonly state: MusicState;
  readonly genreId: string | null;
  readonly hold: boolean;
  readonly transport: 'playing' | 'paused' | 'stopped';
  readonly muted: boolean;
  readonly nextRequests: number;
}
export interface QueueEntry {
  readonly commandId: string;
  readonly trackId: string;
}
export interface PreparedPlan {
  readonly forRevision: number;
  readonly source: VersionRef;
  readonly at: ClockStamp;
}
export interface AudibleState {
  readonly source: VersionRef | null;
  readonly state: MusicState;
  readonly transport: 'playing' | 'paused' | 'stopped';
  readonly muted: boolean;
  readonly at: ClockStamp;
}
export interface ControlSnapshot {
  readonly revision: number;
  readonly engineGeneration: number;
  readonly requested: RequestedState;
  readonly queue: readonly QueueEntry[];
  readonly planned: PreparedPlan | null;
  readonly audible: AudibleState | null;
}
export type RejectionCode = 'invalid-request' | 'id-conflict' | 'stale-revision'
  | 'manual-only' | 'held' | 'missing-track' | 'unavailable-track'
  | 'missing-genre' | 'unavailable-genre' | 'queue-full';
export type CommandReceipt =
  | { readonly commandId: string; readonly status: 'accepted'; readonly revision: number;
      readonly execution: 'pending'; readonly urgency: 'immediate' | 'musical-boundary' }
  | { readonly commandId: string; readonly status: 'rejected'; readonly revision: number;
      readonly code: RejectionCode };

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
const states: readonly MusicState[] = ['browse', 'explore', 'drive', 'surge', 'afterglow'];
const actions: readonly TransportAction[] = ['play', 'pause', 'stop', 'mute', 'unmute'];
function validRequest(request: ControlRequest): boolean {
  if (request.schemaVersion !== CONTROL_VERSION || typeof request.commandId !== 'string'
    || !request.commandId.trim() || request.commandId.length > 128
    || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0
    || !['manual', 'automation'].includes(request.source)) return false;
  switch (request.type) {
    case 'setState': return states.includes(request.state);
    case 'requestGenre': return typeof request.genreId === 'string' && request.genreId.length > 0;
    case 'queueTrack': return typeof request.trackId === 'string' && request.trackId.length > 0;
    case 'hold': return typeof request.enabled === 'boolean';
    case 'transport': return actions.includes(request.action);
    case 'nextSong': return true;
    default: return false;
  }
}
function catalogMap(entries: ControlCatalog['tracks']): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const entry of entries) {
    if (!entry.id || result.has(entry.id) || typeof entry.available !== 'boolean') {
      throw new Error('Catalog identifiers must be nonempty and unique.');
    }
    result.set(entry.id, entry.available);
  }
  return result;
}

/**
 * Pure in-memory acceptance/queue harness, not the DJ or an audio renderer.
 * Rejections and acceptances are retained for the caller-owned session lifetime,
 * with no eviction or arbitrary receipt limit that could block manual Stop/Mute.
 * The caller disposes of a session when finished; history does not survive restart.
 * Only explicitly reported renderer evidence changes audible state. There is no
 * server, expiry, durable deduplication, clock advancement or automatic execution.
 *
 * S01 Hold policy: freeze state and genre targets for manual and automated
 * requests. Queue, Next, transport and selection within the held target remain
 * available. Only manual Hold release is allowed; rejected intent is not resumed.
 */
export class ControlContract {
  private readonly tracks: Map<string, boolean>;
  private readonly genres: Map<string, boolean>;
  private readonly receipts = new Map<string, { body: string; receipt: CommandReceipt }>();
  private revision = 0;
  private requested: RequestedState = {
    state: 'browse', genreId: null, hold: false, transport: 'stopped', muted: false, nextRequests: 0,
  };
  private queue: QueueEntry[] = [];
  private planned: PreparedPlan | null = null;
  private audible: AudibleState | null = null;

  constructor(catalog: ControlCatalog, readonly engineGeneration: number) {
    if (!Number.isSafeInteger(engineGeneration) || engineGeneration < 0) throw new Error('Invalid engine generation.');
    this.tracks = catalogMap(catalog.tracks);
    this.genres = catalogMap(catalog.genres);
  }

  snapshot(): ControlSnapshot {
    return structuredClone({ revision: this.revision, engineGeneration: this.engineGeneration,
      requested: this.requested, queue: this.queue, planned: this.planned, audible: this.audible });
  }

  accept(request: ControlRequest): CommandReceipt {
    const body = canonical(request);
    const prior = this.receipts.get(request.commandId);
    // An exact retry must still succeed after the session has advanced.
    if (prior) return structuredClone(prior.body === body ? prior.receipt : this.reject(request, 'id-conflict'));
    const error = this.check(request);
    let receipt: CommandReceipt;
    if (error) receipt = this.reject(request, error);
    else {
      switch (request.type) {
        case 'setState': this.requested = { ...this.requested, state: request.state }; break;
        case 'requestGenre': this.requested = { ...this.requested, genreId: request.genreId }; break;
        case 'queueTrack': this.queue.push({ commandId: request.commandId, trackId: request.trackId }); break;
        case 'nextSong': this.requested = { ...this.requested, nextRequests: this.requested.nextRequests + 1 }; break;
        case 'hold': this.requested = { ...this.requested, hold: request.enabled }; break;
        case 'transport': {
          const action = request.action;
          this.requested = action === 'mute' || action === 'unmute'
            ? { ...this.requested, muted: action === 'mute' }
            : { ...this.requested, transport: action === 'play' ? 'playing' : action === 'pause' ? 'paused' : 'stopped' };
          break;
        }
      }
      this.revision += 1;
      this.planned = null;
      receipt = { commandId: request.commandId, status: 'accepted', revision: this.revision,
        execution: 'pending', urgency: request.type === 'transport' ? 'immediate' : 'musical-boundary' };
    }
    this.receipts.set(request.commandId, { body, receipt: structuredClone(receipt) });
    return receipt;
  }

  /** Selection precedence only; leaves the FIFO untouched until the caller commits it. */
  peekNext(automatedCandidate: string | null = null): string | null {
    const manual = this.queue[0];
    if (manual) return manual.trackId;
    return automatedCandidate !== null && this.tracks.get(automatedCandidate) === true ? automatedCandidate : null;
  }

  /** Caller acknowledges the FIFO head only after scheduling/execution ownership is established. */
  acknowledgeQueueHead(commandId: string, expectedRevision: number): void {
    if (expectedRevision !== this.revision) throw new Error('stale-revision');
    if (this.queue[0]?.commandId !== commandId) throw new Error('not-queue-head');
    this.queue.shift();
    this.revision += 1;
    this.planned = null;
  }

  /** Explicit owner-supplied plan; this does not choose or schedule any audio. */
  reportPrepared(plan: PreparedPlan): void {
    if (plan.forRevision !== this.revision) throw new Error('stale-revision');
    this.checkStamp(plan.at);
    this.planned = structuredClone(plan);
  }

  /** Only a renderer may call this with observed evidence; acceptance never calls it. */
  reportAudible(state: AudibleState): void {
    this.checkStamp(state.at);
    if (this.audible && state.at.frame < this.audible.at.frame) throw new Error('stale-audible-frame');
    this.audible = structuredClone(state);
  }

  private checkStamp(at: ClockStamp): void {
    if (at.engineGeneration !== this.engineGeneration) throw new Error('stale-generation');
    if (!Number.isSafeInteger(at.frame) || at.frame < 0) throw new Error('invalid-frame');
  }
  private reject(request: ControlRequest, code: RejectionCode): CommandReceipt {
    return { commandId: request.commandId, status: 'rejected', revision: this.revision, code };
  }
  private check(request: ControlRequest): RejectionCode | null {
    if (!validRequest(request)) return 'invalid-request';
    if (request.expectedRevision !== this.revision) return 'stale-revision';
    if (request.source !== 'manual' && ['hold', 'transport', 'queueTrack', 'nextSong'].includes(request.type)) return 'manual-only';
    if (this.requested.hold && (request.type === 'setState' || request.type === 'requestGenre')) return 'held';
    if (request.type === 'queueTrack') {
      if (!this.tracks.has(request.trackId)) return 'missing-track';
      if (!this.tracks.get(request.trackId)) return 'unavailable-track';
      if (this.queue.length >= CONTROL_LIMITS.queue) return 'queue-full';
    }
    if (request.type === 'requestGenre') {
      if (!this.genres.has(request.genreId)) return 'missing-genre';
      if (!this.genres.get(request.genreId)) return 'unavailable-genre';
    }
    return null;
  }
}
