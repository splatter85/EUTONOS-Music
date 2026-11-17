/**
 * Shared, dependency-free vocabulary for transition feedback. Served to the phone page, imported
 * by the relay and the Studio page. Plain data: ratings, quick reason tags and the note limit.
 */
export const FEEDBACK_RATINGS = ['love', 'like', 'ok', 'dislike'] as const;
export type FeedbackRating = typeof FEEDBACK_RATINGS[number];
export const FEEDBACK_RATING_LABELS: Readonly<Record<FeedbackRating, string>> = Object.freeze({love: 'Love', like: 'Like', ok: 'OK', dislike: 'Dislike'});

/**
 * Quick reasons. POSITIVE_TAGS lists the positive ones; every other tag is a complaint. Owner decisions 2026-11-16
 * appended two layered-entry tags at the end (existing tags and their order are unchanged, so saved ratings stay valid).
 */
export const FEEDBACK_TAGS = ['too-abrupt', 'too-long', 'too-short', 'clashing-beat', 'clashing-key', 'bass-clash', 'vocals-clash', 'boring',
  'bad-entry-spot', 'wrong-energy', 'tempo-change-audible', 'volume-jump', 'great-bass-handover', 'great-blend', 'great-surprise', 'layered-entry-too-thin', 'great-layered-entry'] as const;
export type FeedbackTag = typeof FEEDBACK_TAGS[number];
export const FEEDBACK_TAG_LABELS: Readonly<Record<FeedbackTag, string>> = Object.freeze({
  'too-abrupt': 'Too abrupt', 'too-long': 'Too long', 'too-short': 'Too short', 'clashing-beat': 'Clashing beat',
  'clashing-key': 'Clashing key/harmony', 'bass-clash': 'Bass clash or muddy', 'vocals-clash': 'Vocals clash', boring: 'Boring',
  'bad-entry-spot': 'Entered at a bad spot', 'wrong-energy': 'Wrong energy', 'tempo-change-audible': 'Tempo change audible',
  'volume-jump': 'Volume jump', 'great-bass-handover': 'Great bass handover', 'great-blend': 'Great blend', 'great-surprise': 'Great surprise',
  'layered-entry-too-thin': 'Layered entry too thin', 'great-layered-entry': 'Great layered entry',
});
export const POSITIVE_TAGS: readonly FeedbackTag[] = Object.freeze(['great-bass-handover', 'great-blend', 'great-surprise', 'great-layered-entry'] as const);
export const FEEDBACK_NOTE_MAX = 200;
export const FEEDBACK_PLAN_ID = /^tp-[0-9a-f]{8}$/;

export function isFeedbackRating(value: unknown): value is FeedbackRating {
  return typeof value === 'string' && (FEEDBACK_RATINGS as readonly string[]).includes(value);
}
/** Known tags only, unique, in order; null when anything is unknown or the list is too long. */
export function parseFeedbackTags(value: unknown): FeedbackTag[] | null {
  if (!Array.isArray(value) || value.length > FEEDBACK_TAGS.length) return null;
  const tags: FeedbackTag[] = [];
  for (const tag of value) {
    if (typeof tag !== 'string' || !(FEEDBACK_TAGS as readonly string[]).includes(tag)) return null;
    if (!tags.includes(tag as FeedbackTag)) tags.push(tag as FeedbackTag);
  }
  return tags;
}
/** Text only: control characters become spaces, ends are trimmed, length is capped. */
export function cleanFeedbackText(value: string, max: number): string {
  const clean = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() : clean;
}
