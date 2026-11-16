/**
 * EMF-S21 Part A: transition planning policy. Pure, deterministic and seeded; no clock.
 *
 * - Tempo-gap table: which recipe families Auto tries, in order, for a tempo difference.
 * - Entry skip cost and the earlier-cue tie rule (no early-position bonus anywhere).
 * - EQ choreography choice from pair features and style.
 * - Seeded, bounded "explore" parameters.
 * - Versioned, replayable transition plan records and a transition rating log.
 * Every number here is an engineering starting point, not a listening-qualified preference.
 */
import {bassDropMinOverlap, CHOREOGRAPHY_LIMITS, CHOREOGRAPHY_VERSION, type ChoreographyName, type ChoreographyParams} from './eq-choreography.js';

export const TRANSITION_POLICY_VERSION = 'transition-policy@1' as const;

// ---------------------------------------------------------------------------------------------
// Tempo-gap table
// ---------------------------------------------------------------------------------------------
export type TempoBand = 'normal' | 'stretched' | 'meet' | 'bridge' | 'reset';
/** Recipes the set planner can try. `echo-reset` is the analysis-free bounded fallback. */
export type SetRecipe = 'blend' | 'loudness-match' | 'filter-sweep' | 'loop-extend' | 'meet-in-middle' |
  'tempo-ramp' | 'echo-out' | 'brake' | 'echo-reset' | 'cut';
export const TEMPO_GAP_BANDS: readonly {readonly band: TempoBand; readonly maxGap: number; readonly description: string}[] = Object.freeze([
  {band: 'normal', maxGap: 0.04, description: 'normal blend (B stretched up to 4%)'},
  {band: 'stretched', maxGap: 0.08, description: 'stretched blend (B stretched up to 8%)'},
  {band: 'meet', maxGap: 0.16, description: 'meet in the middle (both decks within about 8%) or a short FX handover'},
  {band: 'bridge', maxGap: 0.25, description: 'echo bridge or native ramp; no long beatmatched overlap'},
  {band: 'reset', maxGap: Infinity, description: 'brake, echo reset or structural reset'},
] as const);
/** Rhythm recipes need a confident beat grid; weak key only forbids sustained harmonic overlap. */
export const RHYTHM_RECIPES: readonly SetRecipe[] = Object.freeze(['blend', 'loudness-match', 'filter-sweep', 'loop-extend', 'meet-in-middle', 'tempo-ramp', 'brake']);
const BAND_ORDER: Readonly<Record<TempoBand, readonly SetRecipe[]>> = Object.freeze({
  normal: ['blend', 'loudness-match', 'filter-sweep', 'loop-extend', 'echo-out', 'echo-reset', 'cut'],
  stretched: ['blend', 'filter-sweep', 'loop-extend', 'echo-out', 'echo-reset', 'cut'],
  meet: ['meet-in-middle', 'echo-out', 'tempo-ramp', 'echo-reset', 'cut'],
  bridge: ['echo-out', 'tempo-ramp', 'brake', 'echo-reset', 'cut'],
  reset: ['brake', 'echo-out', 'echo-reset', 'cut'],
});
/** Symmetric gap: 100 -> 122 BPM is 22%. */
export function tempoGap(fromBpm: number, toBpm: number): number {
  if (!(fromBpm > 0) || !(toBpm > 0) || !Number.isFinite(fromBpm) || !Number.isFinite(toBpm)) throw new Error('Tempo gap needs two positive BPMs.');
  return Math.max(fromBpm, toBpm) / Math.min(fromBpm, toBpm) - 1;
}
export interface TempoGapDecision {
  readonly version: typeof TRANSITION_POLICY_VERSION;
  readonly fromBpm: number; readonly toBpm: number; readonly gap: number; readonly band: TempoBand;
  /** Geometric meeting tempo and each deck's change to reach it (meet band only is it used). */
  readonly meetBpm: number; readonly perDeckChange: number;
  readonly recipes: readonly SetRecipe[];
  readonly reasons: readonly string[];
}
/**
 * Ordered Auto recipe list for a tempo pair. A clean cut is always last: used only when every
 * other candidate is rejected (or chosen by the owner, which bypasses this list).
 */
export function tempoGapPolicy(fromBpm: number, toBpm: number, evidence: {readonly beatConfident: boolean} = {beatConfident: true}): TempoGapDecision {
  const gap = tempoGap(fromBpm, toBpm);
  // A tiny tolerance keeps exact band edges (100 -> 104 BPM is 4%) in the lower band despite rounding.
  const band = TEMPO_GAP_BANDS.find(b => gap <= b.maxGap + 1e-9)!.band;
  const meetBpm = Math.sqrt(fromBpm * toBpm), perDeckChange = Math.sqrt(1 + gap) - 1;
  const reasons = [`Tempo gap ${(gap * 100).toFixed(1)}% (${fromBpm.toFixed(1)} -> ${toBpm.toFixed(1)} BPM): ${TEMPO_GAP_BANDS.find(b => b.band === band)!.description}.`];
  let recipes = [...BAND_ORDER[band]];
  if (band === 'meet') reasons.push(`Meeting tempo ${meetBpm.toFixed(1)} BPM needs ${(perDeckChange * 100).toFixed(1)}% per deck.`);
  if (band === 'bridge') reasons.push(`Meeting would need ${(perDeckChange * 100).toFixed(1)}% per deck (>8%), so this is a bridge, not a long overlap.`);
  if (!evidence.beatConfident) {
    recipes = recipes.filter(r => !RHYTHM_RECIPES.includes(r));
    reasons.push('Beat grid confidence is weak: rhythm-locked recipes are skipped.');
  }
  return {version: TRANSITION_POLICY_VERSION, fromBpm, toBpm, gap, band, meetBpm, perDeckChange, recipes, reasons};
}

// ---------------------------------------------------------------------------------------------
// Entry selection: skip cost and the earlier-cue tie rule
// ---------------------------------------------------------------------------------------------
export const ENTRY_POLICY = Object.freeze({
  version: 'entry-skip@1' as const,
  /** Skipping up to this fraction of B is free. */
  freeSkip: 0.25,
  /** Score units lost per unit of song fraction skipped beyond `freeSkip`. */
  skipCostPerFraction: 0.8,
  /** Score window (0..1 scale, i.e. about 10 points of 100) inside which the earlier entry wins. */
  tieWindow: 0.1,
});
/** Explicit cost of skipping B content. `styleAllowsSkip` (e.g. a DJ-edit style) waives it. */
export function entrySkipCost(entryFrame: number, songFrames: number, styleAllowsSkip = false): number {
  if (!Number.isFinite(entryFrame) || !Number.isFinite(songFrames) || songFrames <= 0 || entryFrame < 0) throw new Error('Invalid entry for skip cost.');
  if (styleAllowsSkip) return 0;
  return Math.max(0, entryFrame / songFrames - ENTRY_POLICY.freeSkip) * ENTRY_POLICY.skipCostPerFraction;
}
export interface RankedEntry<T> {readonly item: T; readonly frame: number; readonly score: number; readonly adjusted: number; readonly rank: number;}
/**
 * Ranks candidates by score minus skip cost; then, among those within `tieWindow` of the best,
 * the earliest entry wins. Position itself earns no bonus: a later phrase with a clearly better
 * score is chosen over the song start.
 */
export function rankEntries<T>(items: readonly T[], at: (item: T) => {frame: number; score: number}, songFrames: number,
  styleAllowsSkip = false): RankedEntry<T>[] {
  const scored = items.map(item => { const {frame, score} = at(item);
    return {item, frame, score, adjusted: score - entrySkipCost(frame, songFrames, styleAllowsSkip)}; });
  if (!scored.length) return [];
  const best = Math.max(...scored.map(s => s.adjusted));
  const near = scored.filter(s => s.adjusted >= best - ENTRY_POLICY.tieWindow).sort((a, b) => a.frame - b.frame || b.adjusted - a.adjusted);
  const rest = scored.filter(s => s.adjusted < best - ENTRY_POLICY.tieWindow).sort((a, b) => b.adjusted - a.adjusted || a.frame - b.frame);
  return [...near, ...rest].map((s, rank) => ({...s, rank}));
}

// ---------------------------------------------------------------------------------------------
// Choreography choice
// ---------------------------------------------------------------------------------------------
export type TransitionStyle = 'smooth' | 'energetic' | 'dj-edit';
export interface PairFeatures {
  /** 0..1 relative four-bar interference/density at A's exit and B's entry (unknown -> 0.5). */
  readonly densityA: number; readonly densityB: number;
  /** Harmonic compatibility score 0..1, or null when either key is not confident. */
  readonly harmonic: number | null;
  readonly bpm: number;
  /** Longest overlap the bounded render/check allows, in seconds. */
  readonly maxOverlapSeconds: number;
  readonly style?: TransitionStyle;
}
export interface ChoreographyChoice {readonly params: ChoreographyParams; readonly reasons: readonly string[]; readonly harmonicLimited: boolean;}
const unit = (n: number, fallback = 0.5): number => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
/** Largest allowed bar count (8/16/32, or 4 when even 8 bars exceed the budget) that fits. */
export function fitOverlapBars(preferred: number, bpm: number, maxSeconds: number): number {
  const bar = 240 / bpm, options = [32, 16, 8, 4].filter(b => b <= preferred && b * bar <= maxSeconds);
  return options[0] ?? 4;
}
/**
 * Picks by features and style, not always the smoothest. Weak/unknown harmony limits sustained
 * mid overlap (mid-carve or a bass-drop gap); dense pairs get short handovers; sparse entries
 * can dissolve over long phrases.
 */
export function chooseChoreography(f: PairFeatures): ChoreographyChoice {
  const a = unit(f.densityA), b = unit(f.densityB), dense = Math.max(a, b), style = f.style ?? 'smooth';
  const harmonicLimited = f.harmonic === null || f.harmonic < 0.85;
  const reasons: string[] = [];
  let name: ChoreographyName, bars: number;
  if (harmonicLimited) {
    // Measured against mix-evaluation-thresholds@1 on synthetic pairs a bass gap fails loudness/flux/low build-up
    // while mid-carve passes or warns, so weak harmony alone no longer selects the gap (dense or energetic still does).
    name = dense > 0.7 || style === 'energetic' ? 'bass-drop-handover' : 'mid-carve';
    bars = 8;
    reasons.push(f.harmonic === null ? 'Key evidence is weak, so sustained harmonic overlap is avoided.'
      : 'Keys are not closely related, so only one song carries the mids at a time.');
  } else if (style === 'energetic' || dense > 0.7) {
    name = 'bass-drop-handover'; bars = 8;
    reasons.push('Both sections are dense: a short handover with a bass gap avoids mud.');
  } else if (b < 0.35) {
    name = a < 0.35 ? 'tone-dissolve' : 'highs-first'; bars = 32;
    reasons.push('B enters sparsely: its tones can dissolve in over a long phrase.');
  } else if (f.harmonic !== null && f.harmonic >= 0.99 && dense < 0.55) {
    name = 'bass-swap-classic'; bars = 16;
    reasons.push('Same key and moderate density: a classic bass swap.');
  } else {
    name = 'tone-dissolve'; bars = dense > 0.55 ? 8 : 16;
    reasons.push('Compatible keys: B dissolves in under A with a bass ownership swap on a phrase downbeat.');
  }
  const fitted = fitOverlapBars(bars, f.bpm, f.maxOverlapSeconds);
  if (fitted < bars) reasons.push(`Overlap shortened to ${fitted} bars to fit the bounded render and safety check.`);
  const overlapBars = name === 'bass-drop-handover' ? Math.max(8, fitted) : fitted;
  const params: ChoreographyParams = name === 'bass-drop-handover'
    ? {name, overlapBars, swapMs: CHOREOGRAPHY_LIMITS.swapMs.default, gapBars: dense > 0.7 ? 1 : 2,
      ...(harmonicLimited ? {silentBands: ['low', 'mid'] as const} : {})}
    : {name, overlapBars, swapMs: CHOREOGRAPHY_LIMITS.swapMs.default};
  return {params, reasons, harmonicLimited};
}

// ---------------------------------------------------------------------------------------------
// Seeded explore mode
// ---------------------------------------------------------------------------------------------
export const EXPLORE_BOUNDS = Object.freeze({
  version: 'explore-bounds@1' as const,
  overlapBars: Object.freeze([8, 16, 32] as const),
  gapBars: Object.freeze([1, 2, 4] as const),
  swapMs: Object.freeze({min: 200, max: 600}),
  /** Entry chosen uniformly among the top N ranked candidates. */
  entryTop: 3,
  /** Meeting point as a fraction of the log-tempo distance from A to B. */
  meetFraction: Object.freeze({min: 0.35, max: 0.65}),
});
/** mulberry32: tiny, deterministic, seedable. Not cryptographic. */
export function seededRandom(seed: number): () => number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Explore seed must be an integer 0..4294967295.');
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
export interface ExploreChoice {
  readonly seed: number;
  readonly choreography: ChoreographyParams;
  readonly entryIndex: number;
  readonly echoTail: boolean;
  readonly meetFraction: number;
}
/**
 * Bounded, reproducible variation. Harmony gating still applies: with weak/unknown harmony only
 * mid-carve and bass-drop-handover are eligible. The overlap never exceeds the render budget.
 */
export function exploreChoice(seed: number, f: PairFeatures, entryCandidates: number): ExploreChoice {
  const random = seededRandom(seed), pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const limited = f.harmonic === null || f.harmonic < 0.85;
  const names: readonly ChoreographyName[] = limited ? ['mid-carve', 'bass-drop-handover']
    : ['tone-dissolve', 'bass-drop-handover', 'bass-swap-classic', 'highs-first', 'mid-carve'];
  const name = pick(names);
  const bars = fitOverlapBars(pick(EXPLORE_BOUNDS.overlapBars), f.bpm, f.maxOverlapSeconds);
  const swapMs = Math.round(EXPLORE_BOUNDS.swapMs.min + random() * (EXPLORE_BOUNDS.swapMs.max - EXPLORE_BOUNDS.swapMs.min));
  const gapBars = pick(EXPLORE_BOUNDS.gapBars);
  const echoTail = random() < 0.5;
  const entryIndex = entryCandidates > 0 ? Math.floor(random() * Math.min(EXPLORE_BOUNDS.entryTop, entryCandidates)) : 0;
  const meetFraction = EXPLORE_BOUNDS.meetFraction.min + random() * (EXPLORE_BOUNDS.meetFraction.max - EXPLORE_BOUNDS.meetFraction.min);
  let choreography: ChoreographyParams;
  if (name === 'bass-drop-handover') {
    // The planner only accepts 8/16/32-bar overlaps (4 beats per bar in MIX_OVERLAP_BEATS), so a 4-bar gap
    // (12-bar minimum) rounds up to 16. If that exceeds the render budget, use the largest gap that fits.
    const barSeconds = 240 / f.bpm, valid = (n: number): number => [8, 16, 32].find(v => v >= n) ?? 32;
    const gaps = ([4, 2, 1] as const).filter(g => g <= gapBars);
    const fit = gaps.find(g => valid(bassDropMinOverlap(g)) * barSeconds <= f.maxOverlapSeconds) ?? 1;
    const overlapBars = valid(Math.max(bassDropMinOverlap(fit), bars));
    choreography = {name, overlapBars, swapMs, gapBars: fit, echoTail, ...(limited ? {silentBands: ['low', 'mid'] as const} : {})};
  } else choreography = {name, overlapBars: bars, swapMs};
  return {seed, choreography, entryIndex, echoTail: name === 'bass-drop-handover' && echoTail, meetFraction};
}
/** Meeting tempo at `fraction` of the log distance; 0.5 is the geometric mean. */
export function meetTempo(fromBpm: number, toBpm: number, fraction = 0.5): number {
  return fromBpm * (toBpm / fromBpm) ** fraction;
}

// ---------------------------------------------------------------------------------------------
// Versioned plan record and transition ratings
// ---------------------------------------------------------------------------------------------
export const TRANSITION_PLAN_RECORD = 'em.transition-plan.v1' as const;
export const TRANSITION_RATINGS = 'em.transition-ratings.v1' as const;
export interface TransitionPlanRecord {
  readonly version: typeof TRANSITION_PLAN_RECORD;
  /** FNV-1a of the canonical record without `id`; the same plan always has the same id. */
  readonly id: string;
  readonly mode: 'auto' | 'explore' | 'manual';
  readonly seed: number | null;
  readonly versions: {readonly policy: string; readonly planner: string; readonly analysis: string;
    readonly choreography: typeof CHOREOGRAPHY_VERSION; readonly safety: string};
  readonly from: {readonly id: string; readonly sha256: string; readonly bpm: number; readonly exitFrame: number; readonly exitBar: number};
  readonly to: {readonly id: string; readonly sha256: string; readonly bpm: number; readonly entryFrame: number;
    readonly entrySeconds: number; readonly skippedFraction: number; readonly entryRank: number | null};
  readonly sampleRate: number;
  readonly tempo: {readonly gap: number; readonly band: TempoBand; readonly meetBpm: number | null};
  readonly recipe: SetRecipe | 'fallback-crossfade' | 'fallback-cut' | 'fallback-echo-reset';
  readonly choreography: ChoreographyParams | null;
  readonly overlapBars: number | null;
  readonly why: readonly string[];
  readonly rejected: readonly {readonly recipe: string; readonly reason: string}[];
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([x], [y]) => x < y ? -1 : x > y ? 1 : 0);
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export function makeTransitionPlanRecord(record: Omit<TransitionPlanRecord, 'id' | 'version'>): TransitionPlanRecord {
  const body = {...record, version: TRANSITION_PLAN_RECORD};
  return {...body, id: `tp-${fnv1a(canonical(body))}`};
}
export function validateTransitionPlanRecord(value: unknown): TransitionPlanRecord {
  const r = value as TransitionPlanRecord;
  const ok = !!r && typeof r === 'object' && r.version === TRANSITION_PLAN_RECORD && typeof r.id === 'string' &&
    ['auto', 'explore', 'manual'].includes(r.mode) && (r.seed === null || Number.isSafeInteger(r.seed)) &&
    !!r.from && !!r.to && typeof r.from.sha256 === 'string' && typeof r.to.sha256 === 'string' &&
    Number.isSafeInteger(r.to.entryFrame) && r.to.entryFrame >= 0 && Number.isSafeInteger(r.from.exitFrame) &&
    Number.isInteger(r.sampleRate) && Array.isArray(r.why) && Array.isArray(r.rejected) && typeof r.recipe === 'string';
  if (!ok) throw new Error('Invalid transition plan record.');
  const {id, ...rest} = r;
  if (`tp-${fnv1a(canonical(rest))}` !== id) throw new Error('Transition plan record id does not match its content.');
  return r;
}
/** Planner overrides that reproduce a recorded plan exactly (same analysis versions required). */
export function replayOverrides(record: TransitionPlanRecord): {readonly recipe: TransitionPlanRecord['recipe'];
  readonly toEntryFrame: number; readonly fromExitFrame: number; readonly choreography: ChoreographyParams | null; readonly meetBpm: number | null} {
  validateTransitionPlanRecord(record);
  return {recipe: record.recipe, toEntryFrame: record.to.entryFrame, fromExitFrame: record.from.exitFrame,
    choreography: record.choreography ? structuredClone(record.choreography) as ChoreographyParams : null, meetBpm: record.tempo.meetBpm};
}
export type TransitionRating = 'love' | 'like' | 'dislike';
export interface TransitionRatingLog {
  readonly version: typeof TRANSITION_RATINGS;
  readonly entries: readonly {readonly planId: string; readonly rating: TransitionRating; readonly at: string; readonly plan: TransitionPlanRecord}[];
}
export const emptyTransitionRatings = (): TransitionRatingLog => ({version: TRANSITION_RATINGS, entries: []});
/** The rating stays attached to the exact plan heard; re-rating the same plan replaces its rating. */
export function rateTransition(log: TransitionRatingLog, plan: TransitionPlanRecord, rating: TransitionRating, at: string): TransitionRatingLog {
  validateTransitionPlanRecord(plan);
  if (!['love', 'like', 'dislike'].includes(rating)) throw new Error('Unknown transition rating.');
  if (Number.isNaN(Date.parse(at))) throw new Error('Rating time must be an ISO date.');
  const entries = log.entries.filter(e => e.planId !== plan.id);
  if (entries.length >= 500) throw new Error('Transition rating log is full (500); export it first.');
  return {version: TRANSITION_RATINGS, entries: [...entries, {planId: plan.id, rating, at, plan: structuredClone(plan)}]};
}
export function validateTransitionRatingLog(value: unknown): TransitionRatingLog {
  const log = value as TransitionRatingLog;
  if (!log || log.version !== TRANSITION_RATINGS || !Array.isArray(log.entries) || log.entries.length > 500) throw new Error('Invalid transition rating log.');
  for (const e of log.entries) {
    if (!['love', 'like', 'dislike'].includes(e.rating) || Number.isNaN(Date.parse(e.at))) throw new Error('Invalid transition rating entry.');
    if (validateTransitionPlanRecord(e.plan).id !== e.planId) throw new Error('A rating is detached from its plan.');
  }
  return log;
}
