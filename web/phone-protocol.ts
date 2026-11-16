/**
 * S17 phone-listening protocol shared by the relay (Node), the DJ page and the phone page.
 * Pure data validation only: commands are a strict allowlist and DJ status is copied into a
 * fixed, bounded shape. Nothing here is executable recipe or agent instruction.
 */

import {cleanFeedbackText, FEEDBACK_NOTE_MAX, FEEDBACK_PLAN_ID, isFeedbackRating, parseFeedbackTags, type FeedbackRating,
  type FeedbackTag} from './feedback-vocabulary.js';

export const HANDOFF_MODES = ['direct', 'hybrid', 'mix'] as const;
export type PhoneHandoffMode = typeof HANDOFF_MODES[number];

export type PhoneCommand =
  | {readonly command: 'play'}
  | {readonly command: 'stop'}
  | {readonly command: 'next'}
  | {readonly command: 'hold'; readonly enabled?: boolean}
  | {readonly command: 'handoff'; readonly mode: PhoneHandoffMode}
  /** S18: toggle (or set) Auto on the Studio set page; other pages ignore it. */
  | {readonly command: 'auto'; readonly enabled?: boolean}
  /** Phone UX: make this queued song the next one (Studio set page only; checked against its queue). */
  | {readonly command: 'set-next'; readonly songId: string}
  /**
   * Rate the LAST COMPLETED transition (Studio set page only). The DJ page owns the plan record; the
   * phone sends only the rating, optional reason tags and note. `planId` (optional) is the plan the phone
   * was showing: if the last transition has changed since, the DJ page refuses instead of rating the wrong one.
   */
  | {readonly command: 'rate'; readonly rating: FeedbackRating; readonly tags: readonly FeedbackTag[]; readonly note?: string; readonly planId?: string};

/** A song id as it may cross the relay: short, printable, no path separators. */
export const SONG_ID_PATTERN = /^[A-Za-z0-9._:-]{1,120}$/;

/** A relayed command carries the relay's monotonically increasing id. */
export type RelayedCommand = PhoneCommand & {readonly id: number};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

/** Returns a fresh, allowlisted command or null; unknown fields are refused, not dropped. */
export function parseControlCommand(value: unknown): PhoneCommand | null {
  if (!isRecord(value)) return null;
  switch (value.command) {
    case 'play': case 'stop': case 'next':
      return onlyKeys(value, ['command']) ? {command: value.command} : null;
    case 'hold': case 'auto':
      if (!onlyKeys(value, ['command', 'enabled'])) return null;
      if (value.enabled === undefined) return {command: value.command};
      return typeof value.enabled === 'boolean' ? {command: value.command, enabled: value.enabled} : null;
    case 'handoff':
      if (!onlyKeys(value, ['command', 'mode'])) return null;
      return typeof value.mode === 'string' && (HANDOFF_MODES as readonly string[]).includes(value.mode)
        ? {command: 'handoff', mode: value.mode as PhoneHandoffMode} : null;
    case 'set-next':
      if (!onlyKeys(value, ['command', 'songId'])) return null;
      return typeof value.songId === 'string' && SONG_ID_PATTERN.test(value.songId)
        ? {command: 'set-next', songId: value.songId} : null;
    case 'rate': {
      if (!onlyKeys(value, ['command', 'rating', 'tags', 'note', 'planId'])) return null;
      if (!isFeedbackRating(value.rating)) return null;
      const tags = value.tags === undefined ? [] : parseFeedbackTags(value.tags);
      if (!tags) return null;
      if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > FEEDBACK_NOTE_MAX)) return null;
      if (value.planId !== undefined && (typeof value.planId !== 'string' || !FEEDBACK_PLAN_ID.test(value.planId))) return null;
      const note = typeof value.note === 'string' ? cleanFeedbackText(value.note, FEEDBACK_NOTE_MAX) : '';
      return {command: 'rate', rating: value.rating, tags, ...(note ? {note} : {}),
        ...(typeof value.planId === 'string' ? {planId: value.planId} : {})};
    }
    default:
      return null;
  }
}

export interface DjStatus {
  readonly state: string;
  readonly now: string;
  readonly next: string;
  readonly detail: string;
  readonly status: string;
  readonly requested: string;
  readonly execution: string;
  readonly lastCommand: string;
  readonly hold: boolean;
  readonly handoff: PhoneHandoffMode | null;
  readonly canPlay: boolean;
  readonly canStop: boolean;
  readonly canNext: boolean;
  readonly canHold: boolean;
  readonly canHandoff: boolean;
  /** S18 Studio set page: Auto is on / can be toggled. False on pages without set mode. */
  readonly auto: boolean;
  readonly canAuto: boolean;
  /**
   * Phone UX fields, all optional so an older DJ page (which never sends them) still works.
   * `queue` is the upcoming songs in order (bounded, sanitized); `nextStatus` says whether the
   * next song is prepared; `canSetNext` is true only on pages that honour `set-next`.
   */
  readonly queue?: readonly QueueItem[];
  readonly nextStatus?: string;
  readonly canSetNext?: boolean;
  /** The upcoming handover and the last one played, in plain words (Studio set page only). */
  readonly transitionNext?: TransitionInfo | null;
  readonly transitionLast?: TransitionInfo | null;
}
/** Plain-word handover summary; every field is a bounded string, empty when unknown. */
export interface TransitionInfo {
  readonly recipe: string; readonly overlap: string; readonly choreography: string;
  readonly tempo: string; readonly entry: string; readonly fallback: string;
  /** Optional rating context (transitionLast only): the plan id, its current rating and whether it is saved on the PC file. */
  readonly planId?: string; readonly rated?: FeedbackRating; readonly ratedSaved?: boolean;
}
const transitionFields = ['recipe', 'overlap', 'choreography', 'tempo', 'entry', 'fallback'] as const;
export function sanitizeTransition(value: unknown): TransitionInfo | null {
  if (!isRecord(value)) return null;
  const result: Record<string, string> = {};
  for (const field of transitionFields) result[field] = text(value[field]);
  if (!result.recipe) return null;
  const extra: Record<string, unknown> = {};
  if (typeof value.planId === 'string' && FEEDBACK_PLAN_ID.test(value.planId)) extra.planId = value.planId;
  if (isFeedbackRating(value.rated)) { extra.rated = value.rated; if (value.ratedSaved === true) extra.ratedSaved = true; }
  return {...result, ...extra} as unknown as TransitionInfo;
}
export interface QueueItem { readonly id: string; readonly title: string }
export const QUEUE_LIMIT = 16;

export const STATUS_TEXT_LIMIT = 240;
const textFields = ['state', 'now', 'next', 'detail', 'status', 'requested', 'execution', 'lastCommand', 'nextStatus'] as const;
const flagFields = ['hold', 'canPlay', 'canStop', 'canNext', 'canHold', 'canHandoff', 'auto', 'canAuto', 'canSetNext'] as const;

function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Control characters are display noise at best; strip them and bound the length.
  const clean = value.replace(/[\x00-\x1f\x7f]/g, ' ');
  return clean.length > STATUS_TEXT_LIMIT ? `${clean.slice(0, STATUS_TEXT_LIMIT - 1)}…` : clean;
}

/** At most QUEUE_LIMIT entries; an entry needs a valid id (no paths) and keeps a bounded title. */
export function sanitizeQueue(value: unknown): QueueItem[] {
  if (!Array.isArray(value)) return [];
  const items: QueueItem[] = [];
  for (const entry of value) {
    if (items.length >= QUEUE_LIMIT) break;
    if (!isRecord(entry) || typeof entry.id !== 'string' || !SONG_ID_PATTERN.test(entry.id)) continue;
    const title = text(entry.title);
    items.push({id: entry.id, title: title || entry.id});
  }
  return items;
}

/** Copies only known fields with bounded strings and strict booleans; null for non-objects. */
export function sanitizeDjStatus(value: unknown): DjStatus | null {
  if (!isRecord(value)) return null;
  const result: Record<string, unknown> = {};
  for (const field of textFields) result[field] = text(value[field]);
  for (const field of flagFields) result[field] = value[field] === true;
  result.handoff = typeof value.handoff === 'string' && (HANDOFF_MODES as readonly string[]).includes(value.handoff)
    ? value.handoff : null;
  result.queue = sanitizeQueue(value.queue);
  result.transitionNext = sanitizeTransition(value.transitionNext);
  result.transitionLast = sanitizeTransition(value.transitionLast);
  return result as unknown as DjStatus;
}

/** What GET /api/status returns to the phone. */
export interface RelayStatus {
  readonly dj: {readonly connected: boolean; readonly ageMs: number | null; readonly status: DjStatus | null};
  readonly stream: {
    readonly ingesting: boolean;
    readonly listeners: number;
    readonly encoder: 'idle' | 'running' | 'error';
    readonly chunksIn: number;
    readonly bytesOut: number;
    readonly sessions: number;
    readonly lastError: string | null;
  };
  readonly delayNote: string;
}
