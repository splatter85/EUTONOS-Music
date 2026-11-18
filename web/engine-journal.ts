/**
 * Transition engine increment 3, part 5: plan-record and journal additions (pair-search@1).
 *
 * `EngineRecord` is an optional `engine` field on em.transition-plan.v1. It is added compatibly: records made
 * before it have no field and keep their ids (the canonical form drops undefined fields). It records the ladder
 * rung, the badge, the pair plan table counts and timing, the chosen candidate's model terms and, in shadow
 * mode, what the search would have chosen while the existing path still drove playback. No audio, no paths.
 *
 * The decision journal is an in-memory, bounded list for the page (the relay journal file is unchanged).
 */
import type {LadderBadge, LadderRung} from './engine-ladder.js';

export const ENGINE_RECORD_VERSION = 'pair-search@1' as const;
export type PairSearchMode = 'off' | 'shadow' | 'live';
export const PAIR_SEARCH_MODES: readonly PairSearchMode[] = Object.freeze(['off', 'shadow', 'live']);
export interface EngineCandidateRecord {
  readonly key: string; readonly model: number; readonly final: number | null;
  readonly status: string; readonly terms?: Readonly<Record<string, number>>;
}
export interface EngineRecord {
  readonly version: typeof ENGINE_RECORD_VERSION;
  readonly mode: PairSearchMode;
  readonly rung: LadderRung;
  readonly badge: LadderBadge;
  /** Pair plan table state at the decision (null when no search ran for this pair). */
  readonly table: null | {readonly generated: number; readonly modelScored: number; readonly rendered: number;
    readonly checkedPlans: number; readonly slots: number; readonly ms: number; readonly complete: boolean;
    readonly medianCheckMs: number | null; readonly state: string};
  readonly candidate?: EngineCandidateRecord;
  readonly alternatives?: readonly EngineCandidateRecord[];
  /** Shadow mode: the search's would-be choice; the scheduled plan came from the existing path. */
  readonly shadow?: {readonly rung: LadderRung | null; readonly candidate: EngineCandidateRecord | null; readonly sameRecipe: boolean | null};
  /** Versions of the engine parts used. */
  readonly versions: Readonly<Record<string, string>>;
  readonly unsure: readonly string[];
}
const RUNGS: readonly string[] = ['L0', 'L1', 'L2', 'L3', 'L4'];
const BADGES: readonly string[] = ['checked', 'modelled', 'fallback'];
const isCandidate = (c: unknown): boolean => !!c && typeof c === 'object' && typeof (c as EngineCandidateRecord).key === 'string' &&
  (c as EngineCandidateRecord).key.length <= 120 && Number.isFinite((c as EngineCandidateRecord).model) &&
  ((c as EngineCandidateRecord).final === null || Number.isFinite((c as EngineCandidateRecord).final));
/** Shape check used by `validateTransitionPlanRecord` for the optional field. */
export function isEngineRecord(value: unknown): value is EngineRecord {
  const r = value as EngineRecord;
  return !!r && typeof r === 'object' && r.version === ENGINE_RECORD_VERSION && PAIR_SEARCH_MODES.includes(r.mode) &&
    RUNGS.includes(r.rung) && BADGES.includes(r.badge) && Array.isArray(r.unsure) && r.unsure.length <= 16 &&
    r.unsure.every(u => typeof u === 'string' && u.length <= 240) && !!r.versions && typeof r.versions === 'object' &&
    (r.table === null || !!r.table && typeof r.table === 'object' && [r.table.generated, r.table.modelScored, r.table.rendered, r.table.checkedPlans, r.table.slots, r.table.ms]
      .every(n => Number.isSafeInteger(n) && n >= 0) && typeof r.table.complete === 'boolean') &&
    (r.candidate === undefined || isCandidate(r.candidate)) &&
    (r.alternatives === undefined || Array.isArray(r.alternatives) && r.alternatives.length <= 4 && r.alternatives.every(isCandidate)) &&
    (r.shadow === undefined || !!r.shadow && (r.shadow.rung === null || RUNGS.includes(r.shadow.rung)) &&
      (r.shadow.candidate === null || isCandidate(r.shadow.candidate)));
}

export interface JournalEntry {
  readonly at: string; readonly fromId: string; readonly toId: string;
  readonly kind: 'search-started' | 'search-cancelled' | 'search-finished' | 'decision';
  readonly text: string;
  readonly engine?: EngineRecord;
}
/** Bounded in-memory decision journal (newest last). */
export class DecisionJournal {
  private readonly items: JournalEntry[] = [];
  constructor(readonly limit = 50) {}
  add(entry: JournalEntry): void {
    this.items.push(entry);
    if (this.items.length > this.limit) this.items.splice(0, this.items.length - this.limit);
  }
  entries(): readonly JournalEntry[] { return [...this.items]; }
}
