/**
 * S18 set mode for the Studio DJ Booth: pure decisions and display text, kept free of the DOM
 * so Node tests cover them. Auto never runs on a timer: the page calls `autoDecision` from its
 * snapshot tick and only acts on the returned decision through the DJ's own requests.
 */
import type {MixSnapshot} from '../src/player.js';

/** Bars per automatic move. */
export const AUTO_BARS = [16, 32, 64] as const;
export type AutoBars = typeof AUTO_BARS[number];
/** Bars for a manual Next (phrase-aligned to the outgoing song's grid). */
export const NEXT_BARS = [4, 8] as const;
export type NextBars = typeof NEXT_BARS[number];

export interface AutoInput {
  readonly enabled: boolean;
  readonly loop: boolean;
  readonly playerState: string;
  readonly transition: 'none' | 'scheduled' | 'mixing' | 'complete';
  /** The DJ has an outstanding Next (preparing or scheduled). */
  readonly armed: boolean;
  /** The DJ has a pending start or transition plan. */
  readonly pending: boolean;
  /** Identity of the playing song's entry (`SongEntries.observe`), or null while more than one plays. */
  readonly voiceKey: string | null;
  /** The voice Auto already acted on, if any. */
  readonly handledKey: string | null;
  readonly queueLength: number;
}
export type AutoDecision =
  | {readonly kind: 'idle'; readonly reason: string}
  | {readonly kind: 'wait'; readonly reason: string}
  /** Re-queue the whole set (loop on, queue empty); the next tick then moves on. */
  | {readonly kind: 'requeue'; readonly reason: string}
  /** Send one Next for this voice, anchored to where the song entered, N bars later. */
  | {readonly kind: 'next'; readonly voiceKey: string; readonly reason: string}
  /** The queue is empty and loop is off: the playing song finishes and the set stops. */
  | {readonly kind: 'finish'; readonly reason: string};

/**
 * One Auto step per playing song. Auto acts only when exactly one song is playing, nothing is
 * pending or armed and this song has not been handled, so a failed or cancelled step is not
 * retried for the same song (the owner can press Next).
 */
export function autoDecision(input: AutoInput): AutoDecision {
  if (!input.enabled) return {kind: 'idle', reason: 'Auto is off.'};
  if (input.playerState !== 'playing') return {kind: 'idle', reason: 'Auto waits for playback.'};
  if (input.armed || input.pending || input.transition === 'scheduled' || input.transition === 'mixing') {
    return {kind: 'wait', reason: 'A transition is already on its way.'};
  }
  if (input.voiceKey === null) return {kind: 'wait', reason: 'Waiting for the handover to settle.'};
  if (input.voiceKey === input.handledKey) return {kind: 'wait', reason: 'Auto already moved on from this song.'};
  if (input.queueLength === 0) {
    return input.loop ? {kind: 'requeue', reason: 'End of the set: looping back to the start.'}
      : {kind: 'finish', reason: 'End of the set: this song plays out and the set stops.'};
  }
  return {kind: 'next', voiceKey: input.voiceKey, reason: 'Auto: next song is scheduled.'};
}

/**
 * Counts song entries so Auto acts once per song *entry*: the key is the asset ID plus an entry
 * number, so pause/resume (which may re-stamp the voice) never re-triggers Auto, while the same
 * song entering again later (loop, or Stop then Play) gets a fresh step.
 */
export class SongEntries {
  private last: string | null = null;
  private count = 0;
  /** `ids`: the player's voice asset IDs; `active`: loading/scheduled/playing/paused. */
  observe(ids: readonly string[], active: boolean): string | null {
    if (!active) { this.last = null; return null; }
    if (ids.length !== 1) return null;
    const id = ids[0]!;
    if (id !== this.last) { this.last = id; this.count++; }
    return `${id}#${this.count}`;
  }
}

/** Target index for moving queue entry `index` by `delta`, or null when it cannot move. */
export function moveTarget(index: number, delta: -1 | 1, length: number): number | null {
  const to = index + delta;
  return Number.isInteger(index) && index >= 0 && index < length && to >= 0 && to < length ? to : null;
}

const RECIPE_LABEL: Readonly<Record<string, string>> = {
  blend: 'Beatmatched blend', cut: 'Cut on the beat',
  'filter-sweep': 'Filter sweep', 'loudness-match': 'Loudness match',
  'tempo-ramp': 'Tempo ramp (pitch moves)', 'loop-extend': 'Loop extension', 'brake': 'Brake (pitch drops)',
  'fallback-crossfade': 'Plain crossfade (not beatmatched)', 'fallback-cut': 'Clean cut on the bar (last resort)',
  'meet-in-middle': 'Meet in the middle (both tempos move)', 'echo-out': 'Echo out',
  'fallback-echo-reset': 'Filtered echo reset (not beatmatched)',
};
export function recipeLabel(recipe: string): string { return RECIPE_LABEL[recipe] ?? recipe; }

/** Tempo change in percent, signed, one decimal ("+4.9%", "0.0%"). */
export function tempoPercent(ratio: number): string {
  const value = (ratio - 1) * 100, rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${(Object.is(rounded, -0) ? 0 : rounded).toFixed(1)}%`;
}

/**
 * Plain description of a set handover plan: recipe, the bar it lands on and the tempo change.
 * This is plan data from the audio clock and analysis, never listening evidence.
 */
export function describeSetMix(summary: NonNullable<MixSnapshot['summary']>): string {
  const set = summary.set;
  const level = summary.levelMatch;
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
  const label = recipeLabel(summary.recipe) + (level ? ` · B level ${signed(20 * Math.log10(level.toGain))} dB · remaining difference ${signed(level.matchedDeltaLu)} LU (measured windows)` : '')
    + (summary.loopExtension ? ` · adds ${summary.loopExtension.bars} repeated A bars before B enters` : '')
    + (summary.recipe === 'brake' ? ` · A slows before B enters` : '');
  if (!set) return label;
  const step = set.anchor === 'entry' ? `Auto every ${set.boundaryBars} bars` : `${set.boundaryBars}-bar boundary`;
  const grids = set.fromGrid === 'measured' && set.toGrid === 'measured' ? 'measured beat grids'
    : `grids: ${set.fromGrid} → ${set.toGrid}`;
  return `${label} · ${summary.entryDelayFrames ? 'A effect starts' : 'leaves'} on bar ${set.exitBar} of the outgoing song (${step})`
    + ` · tempo change ${tempoPercent(set.tempoChange)} · ${grids}`;
}

/** Seconds as m:ss for the readout. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * S21 Studio readout: recipe, EQ choreography, where B enters and why. Plan data from the policy,
 * planner and analysis; it is never listening evidence.
 */
export function transitionReadout(summary: NonNullable<MixSnapshot['summary']>): {
  readonly recipe: string; readonly choreography: string; readonly entry: string; readonly why: readonly string[];
  readonly planId: string | null; readonly mode: string;
} {
  const set = summary.set, record = set?.transition ?? null;
  const band = record ? ` · tempo gap ${(record.tempo.gap * 100).toFixed(1)}% (${record.tempo.band})` +
    (record.tempo.meetBpm !== null ? ` · meet at ${record.tempo.meetBpm.toFixed(1)} BPM` : '') : '';
  const entry = set?.entry
    ? `B enters at ${clock(set.entry.seconds)} (${Math.round(set.entry.fraction * 100)}% in${set.entry.rank !== null ? `, candidate #${set.entry.rank + 1}` : ''})`
    : 'B entry: not recorded';
  return {recipe: recipeLabel(summary.recipe) + band,
    choreography: set?.choreography ?? 'No EQ choreography (this recipe uses its own automation)',
    entry, why: [...(set?.why ?? []), ...(record?.rejected ?? []).map(r => `${recipeLabel(r.recipe)} not used: ${r.reason}`)],
    planId: record?.id ?? null,
    mode: record ? (record.mode === 'explore' ? `explore (seed ${record.seed})` : record.mode) : 'not recorded'};
}
