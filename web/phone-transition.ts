/**
 * Phone wording for a set handover. Pure: it reads the plan data the Studio "Why this handover"
 * readout already uses (the player's mix summary and the S21 plan record) and never invents
 * a second source of truth. Plan data from the clock and analysis, not listening evidence.
 */
import type {MixSnapshot} from '../src/player.js';
import type {TransitionInfo} from './phone-protocol.js';
import {tempoPercent} from './set-mode.js';

type Summary = NonNullable<MixSnapshot['summary']>;

const PLAIN: Readonly<Record<string, string>> = {
  blend: 'Smooth blend', cut: 'Clean cut', 'filter-sweep': 'Filter sweep', 'loudness-match': 'Loudness-matched blend',
  'tempo-ramp': 'Tempo ramp', 'loop-extend': 'Loop extension', brake: 'Brake',
  'meet-in-middle': 'Tempo meet in the middle', 'echo-out': 'Echo out',
  'fallback-crossfade': 'Plain crossfade (fallback)', 'fallback-cut': 'Clean cut (last resort)',
  'fallback-echo-reset': 'Echo reset (fallback)',
};
const CHOREO: Readonly<Record<string, string>> = {
  'tone-dissolve': 'Smooth blend', 'bass-swap-classic': 'Bass swap', 'highs-first': 'Highs-first blend', 'mid-carve': 'Mid-carve blend',
};

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Recipe in plain words; the EQ choreography refines a blend ("Bass swap", "Bass handover with 2-bar gap"). */
export function plainRecipe(recipe: string, choreography?: {readonly name: string; readonly gapBars?: number} | null): string {
  if (recipe === 'blend' && choreography) {
    if (choreography.name === 'bass-drop-handover') return `Bass handover with ${choreography.gapBars ?? 1}-bar gap`;
    return CHOREO[choreography.name] ?? PLAIN.blend!;
  }
  return PLAIN[recipe] ?? recipe;
}

export function phoneTransition(summary: Summary, fallbackAfterFailedPrecheck?: {readonly failedChecks: number}): TransitionInfo {
  const set = summary.set, record = set?.transition ?? null;
  const params = record?.choreography ?? null;
  const overlap = record?.overlapBars ?? params?.overlapBars ?? null;
  const fellBack = fallbackAfterFailedPrecheck
    ? `Fallback after ${fallbackAfterFailedPrecheck.failedChecks} failed pre-check(s)`
    : summary.recipe.startsWith('fallback') ? 'Fallback recipe' : '';
  return {
    recipe: plainRecipe(summary.recipe, params),
    overlap: overlap ? `${overlap} bars` : '',
    choreography: params?.name ?? '',
    tempo: set ? tempoPercent(set.tempoChange) : '',
    entry: set?.entry ? `enters at ${clock(set.entry.seconds)}` : '',
    fallback: fellBack,
  };
}
