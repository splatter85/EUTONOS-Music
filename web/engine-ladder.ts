/**
 * Transition engine increment 3, part 4: the ladder under the owner's no-cut rule (engine-ladder@1).
 *
 *  L0  best checked plan from the pair plan table, for an exit inside the wait window (owner decision D: Next
 *      may wait up to 8 bars past the requested boundary). Badge "checked".
 *  L1  best modelled candidate in the window, given one pre-check now. Badge "checked" when it passes.
 *  L2  the existing pre-checked policy ladder (beat-matched recipes, crossfade, echo reset, the safe filter and
 *      tone dissolves, layered entries). Badge "fallback".
 *  L3  the shortest safe layered entry (2-bar last rung), still pre-checked. Badge "fallback".
 *  L4  a clean cut, only when the owner chose a cut for this request. Never chosen automatically.
 *
 * L0/L1 selection is pure and lives here; the player materialises the plan, and L2/L3 are the existing
 * `scheduleMixTo` candidate loop, labelled after the fact.
 */
import {EXPLORE_MENU_POLICY, exploreMenuDraw, type ExploreMenuRecord} from './transition-policy.js';
import type {PairSearch, ScoredCandidate} from './engine-search.js';
import {familyOf} from './engine-model.js';

export const ENGINE_LADDER_VERSION = 'engine-ladder@1' as const;
export type LadderRung = 'L0' | 'L1' | 'L2' | 'L3' | 'L4';
export type LadderBadge = 'checked' | 'modelled' | 'fallback';
export const RUNG_TEXT: Readonly<Record<LadderRung, string>> = Object.freeze({
  L0: 'L0 checked plan from the pair search',
  L1: 'L1 best modelled candidate, checked now',
  L2: 'L2 policy ladder (safe dissolve or another passing style)',
  L3: 'L3 shortest safe layered entry',
  L4: 'L4 clean cut chosen by the owner',
});
export interface LadderWindow {
  /** Earliest native A frame an effect may start at (now plus the preparation allowance). */
  readonly earliestFrame: number;
  /** First requested boundary bar and the last bar Next may wait for. */
  readonly firstBar: number; readonly lastBar: number;
  /** Explore seed: L0 then draws among the best checked plan of each family (explore-menu@1, logged). */
  readonly explore?: {readonly seed: number} | null;
  /** Extra eligibility (for example: prepared audio still bound to the same voice). */
  readonly eligible?: (candidate: ScoredCandidate) => boolean;
}
export interface LadderPick {
  readonly rung: 'L0' | 'L1';
  readonly candidate: ScoredCandidate;
  readonly alternatives: readonly ScoredCandidate[];
  readonly menu?: ExploreMenuRecord;
}

const inWindow = (c: ScoredCandidate, w: LadderWindow): boolean =>
  c.spec.exit.bar <= w.lastBar && (c.effectFrame ?? c.spec.exit.frame) >= w.earliestFrame && (w.eligible?.(c) ?? true);

/** L0: the best checked plan inside the window (explore: a seeded draw among each family's best). */
export function pickChecked<P>(search: PairSearch<P>, w: LadderWindow): LadderPick | null {
  const best: ScoredCandidate[] = [];
  for (const slot of search.table.slots) {
    if (slot.exitBar > w.lastBar) break;
    const b = search.bestIn(slot, w.earliestFrame);
    if (b && inWindow(b, w)) best.push(b);
    // Explore wants each family's best, not only the slot's best.
    if (w.explore) for (const c of slot.ranked) if (c !== b && (c.status === 'checked-pass' || c.status === 'checked-warn') && c.spec.kind !== 'cut' && inWindow(c, w)) best.push(c);
  }
  if (!best.length) return null;
  const ranked = best.sort((x, y) => (y.final ?? -Infinity) - (x.final ?? -Infinity) || x.spec.exit.bar - y.spec.exit.bar);
  if (!w.explore) return {rung: 'L0', candidate: ranked[0]!, alternatives: ranked.slice(1, 4)};
  const perFamily: ScoredCandidate[] = [];
  for (const c of ranked) if (!perFamily.some(p => familyKey(p) === familyKey(c))) perFamily.push(c);
  const keys = perFamily.map(familyKey).slice(0, EXPLORE_MENU_POLICY.maxAlternatives);
  const draw = exploreMenuDraw(w.explore.seed, 0, keys);
  const picked = perFamily[draw.index]!;
  return {rung: 'L0', candidate: picked, alternatives: perFamily.filter(p => p !== picked).slice(0, 3),
    menu: {policy: EXPLORE_MENU_POLICY.version, seed: w.explore.seed, attempt: 0, chosen: keys[draw.index]!,
      alternatives: keys.map((key, i) => ({key, weight: draw.weights[i]!}))}};
}
/** Layered entries are drawn per style, as in explore-menu@1; other recipes per family. */
const familyKey = (c: ScoredCandidate): string => c.spec.recipe.startsWith('fallback-layered-entry/') ? c.spec.recipe : familyOf(c.spec.recipe);

/** L1: the best modelled (unchecked) non-cut candidate inside the window, for one pre-check now. */
export function pickModelled<P>(search: PairSearch<P>, w: LadderWindow, skip: ReadonlySet<string> = new Set()): ScoredCandidate | null {
  let best: ScoredCandidate | null = null;
  for (const slot of search.table.slots) {
    if (slot.exitBar > w.lastBar) break;
    for (const c of slot.ranked) {
      if (c.status !== 'modelled' || c.spec.kind === 'cut' || skip.has(c.spec.id) || !inWindow(c, w)) continue;
      if (!best || c.model.score > best.model.score) best = c;
    }
  }
  return best;
}
