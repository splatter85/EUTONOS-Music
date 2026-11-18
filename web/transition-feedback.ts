/**
 * Transition feedback, `em.transition-feedback.v1`: one owner rating of one transition plan.
 * Pure data (no DOM, no Node APIs) so the relay, the Studio page and the report script share it.
 * It embeds the S21 plan record unchanged and adds a rating, quick reason tags, a short text-only
 * note, which device rated and the pre-check summary the DJ showed. It stores song ids and
 * sha256 hashes only (inside the plan): no audio, no file paths, no personal data.
 * Feedback is evidence for analysis, not a listening qualification, and nothing learns from it.
 */
import {cleanFeedbackText, FEEDBACK_NOTE_MAX, isFeedbackRating, parseFeedbackTags, type FeedbackRating, type FeedbackTag} from './feedback-vocabulary.js';
import {isSettingsStamp, type SettingsStamp} from './dj-settings.js';
import {validateTransitionPlanRecord, type TransitionPlanRecord, type TransitionRatingLog} from './transition-policy.js';

export const TRANSITION_FEEDBACK = 'em.transition-feedback.v1' as const;
export const FEEDBACK_DEVICES = ['pc', 'phone'] as const;
export type FeedbackDevice = typeof FEEDBACK_DEVICES[number];
export const FEEDBACK_LIMITS = Object.freeze({reasonChars: 240, planJsonChars: 12_000, entries: 500, failedChecks: 50});
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** The DJ's own pre-check verdict for the plan at the time it was heard; null when none was available. */
export interface FeedbackMeasured {
  readonly status: 'pass' | 'warn' | 'fail' | 'unavailable';
  readonly reason: string;
  /** Number of failed pre-checks before a clean-cut fallback was reached; null when not a fallback. */
  readonly fallbackAfterFailedChecks: number | null;
}
export interface TransitionFeedback {
  readonly version: typeof TRANSITION_FEEDBACK;
  readonly planId: string;
  readonly plan: TransitionPlanRecord;
  readonly rating: FeedbackRating;
  readonly tags: readonly FeedbackTag[];
  readonly note: string;
  readonly device: FeedbackDevice;
  /** ISO time the rating was given. Re-rating the same plan later replaces the earlier rating. */
  readonly at: string;
  readonly measured: FeedbackMeasured | null;
  /**
   * OPTIONAL (added with the DJ booth settings; older ratings simply lack it): the settings stamp that was active when the
   * plan was made, copied from `plan.settings`. It is stored beside the plan so reports can group ratings by settings.
   */
  readonly settings?: SettingsStamp;
}

const REQUIRED_KEYS = ['version', 'planId', 'plan', 'rating', 'tags', 'note', 'device', 'at', 'measured'] as const;
const TOP_KEYS = [...REQUIRED_KEYS, 'settings'] as const;
const MEASURED_KEYS = ['status', 'reason', 'fallbackAfterFailedChecks'] as const;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const fail = (message: string): never => { throw new Error(`Invalid transition feedback: ${message}`); };

function parseMeasured(value: unknown): FeedbackMeasured | null {
  if (value === null) return null;
  if (!isRecord(value) || Object.keys(value).some(k => !(MEASURED_KEYS as readonly string[]).includes(k))) return fail('measured has unknown fields');
  if (!['pass', 'warn', 'fail', 'unavailable'].includes(value.status as string)) return fail('measured status');
  const checks = value.fallbackAfterFailedChecks;
  if (checks !== null && !(Number.isSafeInteger(checks) && (checks as number) >= 0 && (checks as number) <= FEEDBACK_LIMITS.failedChecks)) return fail('measured fallback count');
  if (typeof value.reason !== 'string') return fail('measured reason');
  return {status: value.status as FeedbackMeasured['status'], reason: cleanFeedbackText(value.reason, FEEDBACK_LIMITS.reasonChars),
    fallbackAfterFailedChecks: checks as number | null};
}

/**
 * Strict structure, sanitized text: unknown fields, unknown tags/ratings/devices, a bad time or a
 * plan that does not match its id are refused. Returns a fresh, bounded copy.
 */
export function parseTransitionFeedback(value: unknown): TransitionFeedback {
  if (!isRecord(value)) return fail('not an object');
  for (const key of Object.keys(value)) if (!(TOP_KEYS as readonly string[]).includes(key)) return fail(`unknown field "${key.slice(0, 40)}"`);
  for (const key of REQUIRED_KEYS) if (!(key in value)) return fail(`missing "${key}"`);
  if (value.version !== TRANSITION_FEEDBACK) return fail('version');
  if (!isFeedbackRating(value.rating)) return fail('rating');
  const tags = parseFeedbackTags(value.tags);
  if (!tags) return fail('tags');
  if (typeof value.note !== 'string') return fail('note');
  if (!(FEEDBACK_DEVICES as readonly string[]).includes(value.device as string)) return fail('device');
  if (typeof value.at !== 'string' || !ISO_TIME.test(value.at) || Number.isNaN(Date.parse(value.at))) return fail('time');
  if (JSON.stringify(value.plan ?? null).length > FEEDBACK_LIMITS.planJsonChars) return fail('plan is too large');
  let plan: TransitionPlanRecord;
  try { plan = validateTransitionPlanRecord(value.plan); } catch (error) { return fail(error instanceof Error ? error.message : 'plan'); }
  if (value.planId !== plan.id) return fail('planId does not match its plan');
  let settings: SettingsStamp | undefined;
  if (value.settings !== undefined) {
    if (!isSettingsStamp(value.settings)) return fail('settings stamp');
    if (!plan.settings || JSON.stringify(plan.settings) !== JSON.stringify(value.settings)) return fail('settings do not match the plan');
    settings = structuredClone(value.settings);
  }
  return {version: TRANSITION_FEEDBACK, planId: plan.id, plan: structuredClone(plan), rating: value.rating, tags,
    note: cleanFeedbackText(value.note, FEEDBACK_NOTE_MAX), device: value.device as FeedbackDevice, at: value.at, measured: parseMeasured(value.measured),
    ...(settings ? {settings} : {})};
}

export interface FeedbackInput {
  readonly plan: TransitionPlanRecord;
  readonly rating: FeedbackRating;
  readonly tags?: readonly string[];
  readonly note?: string;
  readonly device: FeedbackDevice;
  readonly at: string;
  readonly measured?: FeedbackMeasured | null;
}
export function makeTransitionFeedback(input: FeedbackInput): TransitionFeedback {
  return parseTransitionFeedback({version: TRANSITION_FEEDBACK, planId: input.plan.id, plan: input.plan, rating: input.rating,
    tags: input.tags ?? [], note: input.note ?? '', device: input.device, at: input.at, measured: input.measured ?? null,
    ...(input.plan.settings ? {settings: input.plan.settings} : {})});
}

/** An older em.transition-ratings.v1 entry (love/like/dislike only) as feedback with no tags or note. */
export function feedbackFromLegacy(log: TransitionRatingLog): TransitionFeedback[] {
  return log.entries.map(entry => makeTransitionFeedback({plan: entry.plan, rating: entry.rating, device: 'pc', at: entry.at}));
}

/** Latest rating per plan (by time; a tie keeps the later entry), oldest first. */
export function latestPerPlan(entries: readonly TransitionFeedback[]): TransitionFeedback[] {
  const latest = new Map<string, {entry: TransitionFeedback; index: number}>();
  entries.forEach((entry, index) => {
    const held = latest.get(entry.planId);
    if (!held || Date.parse(entry.at) >= Date.parse(held.entry.at)) latest.set(entry.planId, {entry, index});
  });
  return [...latest.values()].sort((a, b) => Date.parse(a.entry.at) - Date.parse(b.entry.at) || a.index - b.index).map(held => held.entry);
}

/** Parses a JSON-lines log; bad lines are counted and skipped, never trusted. */
export function parseFeedbackLines(text: string): {entries: TransitionFeedback[]; lines: number; skipped: number} {
  const entries: TransitionFeedback[] = [];
  let lines = 0, skipped = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    lines++;
    try { entries.push(parseTransitionFeedback(JSON.parse(line))); } catch { skipped++; }
  }
  return {entries, lines, skipped};
}
