/**
 * Transition engine increment 3, part 3: anytime render-and-check pair search (pair-search@1).
 *
 * The model-scored candidates are grouped into exit slots. The search fills the slot nearest in time first and
 * checks the top K candidates of each slot by rendering them offline and running the existing pre-check
 * (live-mix-precheck@1) on the real audio. The heavy work (time-stretch render, pre-check) runs in Workers
 * supplied through `check`; this coordinator only orders the work and keeps the table, yielding between steps.
 *
 * Rules (design 2.5): always a best-so-far answer; nearest slots first; stop at the budget, at K checked plans
 * per slot, or when the next candidates' model scores are far below the best checked one; never return a cut
 * while budget remains and an unrendered non-cut candidate exists; the final score is the model score plus the
 * evaluator penalty (passing is a floor, not the ranking); keep the prepared audio of the best one or two
 * candidates of the nearest slots so Next can schedule without rendering again; cancellable at any time.
 */
import type {TransitionEvaluation} from './mix-evaluator.js';
import type {CandidateSpec} from './engine-candidates.js';
import type {ModelScore} from './engine-model.js';

export const PAIR_SEARCH_VERSION = 'pair-search@1' as const;
/**
 * K and the budgets. K = 3 was confirmed from the timing measured on the owner's Windows PC, 2026-11-17 (see
 * docs/S21_TRANSITION_PLANNER.md, "Pair search"): 206 render-and-checks over three owner pairs (44.1 kHz stereo),
 * median 1.9 s, p90 4.3 s, max 6.9 s, almost all of it the pre-check (every rendered candidate was route-free on the
 * native B). A 60 s lead therefore fits about 30 checks at the median: K = 3 covers the nearest ~10 slots (the 8-bar
 * Next window and more), K = 5 would cover only ~6. Engineering values, not listened to.
 */
export const PAIR_SEARCH_LIMITS = Object.freeze({
  version: PAIR_SEARCH_VERSION,
  /** Checked (pass or warn) plans wanted per slot. */
  k: 3,
  /** Render-and-check attempts per slot before the slot is left as it is. */
  maxAttemptsPerSlot: 8,
  /** Whole-search time budget. */
  budgetMs: 180_000,
  /** A candidate this far below the best checked final score in its slot is not rendered. */
  farBelow: 0.6,
  /** Prepared audio kept for the best this-many candidates per slot ... */
  keepPerSlot: 2,
  /** ... of the nearest this-many future slots ... */
  keepSlots: 4,
  /** ... and at most this many heavy (rendered) buffers in all. */
  maxHeavy: 4,
  /** Evaluator penalties on the final score. */
  warnPenalty: 0.2, flagPenalty: 0.05,
});
export type CandidateStatus = 'modelled' | 'checked-pass' | 'checked-warn' | 'rejected';
export interface ScoredCandidate {
  readonly spec: CandidateSpec;
  readonly model: ModelScore;
  status: CandidateStatus;
  /** Model score plus evaluator penalty; null until checked. */
  final: number | null;
  evaluation?: TransitionEvaluation | null;
  reason?: string;
  /** Effect frame (native A) of the checked plan; a plan is usable only while this is still in the future. */
  effectFrame?: number;
  timing?: {readonly renderMs: number; readonly checkMs: number};
}
export interface PairPlanTable {
  readonly pair: {readonly fromId: string; readonly toId: string; readonly fromSha256: string; readonly toSha256: string;
    readonly versions: Readonly<Record<string, string>>};
  readonly slots: {readonly exitBar: number; readonly exitFrame: number; readonly ranked: ScoredCandidate[]}[];
  searched: {generated: number; modelScored: number; rendered: number; ms: number};
  complete: boolean;
}
export interface CheckOutcome<P> {
  /** `refused`: the planner could not build this exact candidate (no render was made; not counted as rendered). */
  readonly status: 'pass' | 'warn' | 'fail' | 'unavailable' | 'refused';
  readonly reason: string;
  readonly evaluation?: TransitionEvaluation | null;
  readonly prepared?: P;
  /** True when `prepared` holds a rendered buffer worth evicting (route-free plans reuse the native B). */
  readonly heavy?: boolean;
  readonly effectFrame?: number;
  readonly renderMs?: number; readonly checkMs?: number;
}
export interface SearchDeps<P> {
  check(candidate: ScoredCandidate, signal: AbortSignal): Promise<CheckOutcome<P>>;
  /** Earliest native A frame still usable for an effect; slots before it are stale and skipped. */
  earliestFrame(): number;
  now(): number;
  /** Yield to the event loop between steps (default: a macrotask). */
  pause?(): Promise<void>;
}
export interface SearchProgress {
  readonly state: 'running' | 'complete' | 'budget' | 'cancelled' | 'failed';
  readonly checkedPlans: number; readonly rendered: number; readonly slots: number;
  readonly medianCheckMs: number | null; readonly ms: number;
}

const isCut = (c: ScoredCandidate): boolean => c.spec.kind === 'cut';
const checked = (c: ScoredCandidate): boolean => c.status === 'checked-pass' || c.status === 'checked-warn';
const defaultPause = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

/** Groups candidates into slots by exit bar (ascending) and ranks each slot by model score (cuts last). */
export function buildTable(pair: PairPlanTable['pair'], scored: readonly {spec: CandidateSpec; model: ModelScore}[], generated: number): PairPlanTable {
  const bySlot = new Map<number, ScoredCandidate[]>();
  for (const s of scored) {
    const list = bySlot.get(s.spec.exit.bar) ?? [];
    list.push({spec: s.spec, model: s.model, status: 'modelled', final: null});
    bySlot.set(s.spec.exit.bar, list);
  }
  const slots = [...bySlot.entries()].sort((a, b) => a[0] - b[0]).map(([exitBar, ranked]) => ({exitBar, exitFrame: ranked[0]!.spec.exit.frame,
    ranked: ranked.sort((x, y) => Number(isCut(x)) - Number(isCut(y)) || y.model.score - x.model.score || x.spec.key.localeCompare(y.spec.key))}));
  return {pair, slots, searched: {generated, modelScored: scored.length, rendered: 0, ms: 0}, complete: false};
}

export class PairSearch<P> {
  readonly table: PairPlanTable;
  private readonly controller = new AbortController();
  private readonly prepared = new Map<string, {prepared: P; heavy: boolean}>();
  private readonly times: number[] = [];
  private started = 0;
  private stateValue: SearchProgress['state'] = 'running';
  private attempts = new Map<number, number>();
  private running: Promise<void> | null = null;

  constructor(table: PairPlanTable, private readonly deps: SearchDeps<P>, readonly limits: typeof PAIR_SEARCH_LIMITS = PAIR_SEARCH_LIMITS) {
    this.table = table;
  }
  get signal(): AbortSignal { return this.controller.signal; }
  get state(): SearchProgress['state'] { return this.stateValue; }
  /** True while the time budget has not run out (and the search was not cancelled). */
  get budgetRemains(): boolean { return this.stateValue === 'running' || this.stateValue === 'complete'; }

  /** Starts once; later calls return the same run. Never rejects (a failure ends the run as `failed`). */
  start(): Promise<void> {
    this.running ??= this.run().catch(() => { if (this.stateValue === 'running') this.stateValue = this.controller.signal.aborted ? 'cancelled' : 'failed'; });
    return this.running;
  }
  /** Stops the work but keeps the table and the kept audio (the handover is being committed from them). */
  halt(): void {
    if (this.stateValue === 'running') this.stateValue = 'cancelled';
    this.controller.abort();
  }
  /** Stops the work and drops the kept audio (the pair changed). */
  cancel(): void {
    this.halt();
    this.prepared.clear();
  }
  preparedFor(id: string): P | null { return this.prepared.get(id)?.prepared ?? null; }

  progress(): SearchProgress {
    const sorted = [...this.times].sort((a, b) => a - b);
    return {state: this.stateValue, checkedPlans: this.table.slots.reduce((n, s) => n + s.ranked.filter(checked).length, 0),
      rendered: this.table.searched.rendered, slots: this.table.slots.length,
      medianCheckMs: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null, ms: this.table.searched.ms};
  }
  /** Render-and-check times so far (ms), in order. */
  timings(): readonly number[] { return [...this.times]; }

  /** True when this slot still has an unrendered non-cut candidate the search could check. */
  private unrenderedNonCut(slot: PairPlanTable['slots'][number]): boolean {
    return slot.ranked.some(c => c.status === 'modelled' && !isCut(c));
  }
  /**
   * Best usable candidate of one slot: checked ones by final score. A cut is never returned while the budget
   * remains and an unrendered non-cut candidate exists in that slot.
   */
  bestIn(slot: PairPlanTable['slots'][number], earliestFrame: number): ScoredCandidate | null {
    const ok = slot.ranked.filter(c => checked(c) && (c.effectFrame ?? slot.exitFrame) >= earliestFrame &&
      !(isCut(c) && this.budgetRemains && this.unrenderedNonCut(slot)));
    return ok.sort((x, y) => (y.final ?? -Infinity) - (x.final ?? -Infinity) || x.spec.exit.bar - y.spec.exit.bar)[0] ?? null;
  }

  private nextWork(earliest: number): {slot: PairPlanTable['slots'][number]; candidate: ScoredCandidate} | null {
    for (const slot of this.table.slots) {
      if (slot.exitFrame < earliest) continue;
      const done = slot.ranked.filter(checked);
      if (done.length >= this.limits.k || (this.attempts.get(slot.exitBar) ?? 0) >= this.limits.maxAttemptsPerSlot) continue;
      const best = Math.max(...done.map(c => c.final ?? -Infinity));
      // Non-cut candidates first; a cut only when no unrendered non-cut candidate is left in the slot.
      const next = slot.ranked.find(c => c.status === 'modelled' && !isCut(c)) ?? slot.ranked.find(c => c.status === 'modelled');
      if (!next) continue;
      if (done.length && next.model.score < best - this.limits.farBelow) continue;
      return {slot, candidate: next};
    }
    return null;
  }

  private keep(candidate: ScoredCandidate, outcome: CheckOutcome<P>): void {
    if (outcome.prepared === undefined) return;
    this.prepared.set(candidate.spec.id, {prepared: outcome.prepared, heavy: !!outcome.heavy});
    // Keep the best `keepPerSlot` of the nearest `keepSlots` future slots, then cap the heavy buffers.
    const earliest = this.deps.earliestFrame();
    const near = this.table.slots.filter(s => s.exitFrame >= earliest).slice(0, this.limits.keepSlots);
    const wanted = new Set<string>();
    for (const s of near) for (const c of s.ranked.filter(checked).sort((x, y) => (y.final ?? 0) - (x.final ?? 0)).slice(0, this.limits.keepPerSlot)) wanted.add(c.spec.id);
    // Light entries (route-free plans on the native B, plus their report) are small and always kept.
    for (const [id, v] of [...this.prepared.entries()]) if (!v.heavy) wanted.add(id);
    for (const id of [...this.prepared.keys()]) if (!wanted.has(id)) this.prepared.delete(id);
    const heavy = [...this.prepared.entries()].filter(([, v]) => v.heavy).map(([id]) => id);
    // Nearest future slots first; slots already passed are evicted first.
    const order = (id: string): number => { const s = this.table.slots.find(x => x.ranked.some(c => c.spec.id === id)); return !s || s.exitFrame < earliest ? Number.MAX_SAFE_INTEGER : s.exitFrame; };
    heavy.sort((x, y) => order(x) - order(y));
    for (const id of heavy.slice(this.limits.maxHeavy)) this.prepared.delete(id);
  }

  private async run(): Promise<void> {
    this.started = this.deps.now();
    const pause = this.deps.pause ?? defaultPause;
    const signal = this.controller.signal;
    for (;;) {
      if (signal.aborted) { this.stateValue = 'cancelled'; return; }
      this.table.searched.ms = Math.round(this.deps.now() - this.started);
      if (this.table.searched.ms >= this.limits.budgetMs) { this.stateValue = 'budget'; return; }
      const work = this.nextWork(this.deps.earliestFrame());
      if (!work) { this.table.complete = true; this.stateValue = 'complete'; return; }
      const {slot, candidate} = work;
      this.attempts.set(slot.exitBar, (this.attempts.get(slot.exitBar) ?? 0) + 1);
      const t0 = this.deps.now();
      let outcome: CheckOutcome<P>;
      try { outcome = await this.deps.check(candidate, signal); }
      catch (error) {
        if (signal.aborted) { this.stateValue = 'cancelled'; return; }
        outcome = {status: 'unavailable', reason: error instanceof Error ? error.message : String(error)};
      }
      if (signal.aborted) { this.stateValue = 'cancelled'; return; }
      if (outcome.status === 'refused') {
        // Planner refusal: no audio was rendered; it does not use up a slot attempt.
        this.attempts.set(slot.exitBar, (this.attempts.get(slot.exitBar) ?? 1) - 1);
      } else {
        this.table.searched.rendered++;
        this.times.push(Math.round(this.deps.now() - t0));
      }
      candidate.reason = outcome.reason;
      if (outcome.evaluation !== undefined) candidate.evaluation = outcome.evaluation;
      if (outcome.effectFrame !== undefined) candidate.effectFrame = outcome.effectFrame;
      if (outcome.renderMs !== undefined || outcome.checkMs !== undefined) candidate.timing = {renderMs: outcome.renderMs ?? 0, checkMs: outcome.checkMs ?? 0};
      if (outcome.status === 'pass' || outcome.status === 'warn') {
        candidate.status = outcome.status === 'pass' ? 'checked-pass' : 'checked-warn';
        const flags = outcome.evaluation?.flags.length ?? 0;
        candidate.final = Math.round((candidate.model.score - (outcome.status === 'warn' ? this.limits.warnPenalty : 0) - flags * this.limits.flagPenalty) * 1e4) / 1e4;
        this.keep(candidate, outcome);
      } else candidate.status = 'rejected';
      await pause();
    }
  }
}
