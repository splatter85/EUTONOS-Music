/**
 * Transition engine increment 3, part 1: candidate generation (engine-candidates@1).
 *
 * A candidate is one point in the handover space: exit bar of A, entry of B, recipe and length. Exits are every
 * phrase boundary (each 4th bar on A's own bar count) and every section end or analysed exit cue of A, from the
 * earliest feasible bar to the end of A. Entries are B's section starts, analysed entry cues and its first
 * downbeat, each with the existing entry skip cost (entry-skip, transition-policy@3). Hard constraints prune first:
 * audio must exist for the whole plan, a time-stretch stays within the owner's 15% limit, a beat-locked candidate
 * needs trusted grids on both songs, and a clean cut is generated only when the owner chose one.
 *
 * Inputs are the two song dossiers (em.song-dossier.v1) plus the bar grids the planner will use (built from the
 * same analyses), so bar numbers agree with `chooseSetTransition`. Nothing here reads audio.
 */
import {downbeatAt, barAtOrAfter, routeFreeLengths, type SetBarGrid} from '../src/mix-transition.js';
import {ENTRY_STYLES, LAYERED_ENTRY_LIMITS} from './layered-entry.js';
import {dualRampTempo, entrySkipCost, fnv1a, RHYTHM_RECIPES, tempoGapPolicy, type SetRecipe} from './transition-policy.js';
import type {SongDossier, DossierSection} from './song-dossier.js';

export const ENGINE_CANDIDATES_VERSION = 'engine-candidates@1' as const;
export const CANDIDATE_LIMITS = Object.freeze({
  /** Owner decision 2026-11-16: no time-stretch beyond 15% per deck. */
  maxStretch: 0.15,
  /** A phrase is 4 bars on A's own bar count (the 'song' boundary anchor). */
  phraseBars: 4,
  /** B entries kept per pair after ranking (earliest always kept). */
  maxEntries: 4,
  /** Section ends and cues snap to a bar within this fraction of a bar. */
  snapBars: 1 / 8,
  /** Upper bound on exits (a 10-minute song at 180 BPM has 450 bars; every phrase is ~112 exits). */
  maxExits: 160,
});
export type CandidateKind = 'analyzed' | 'route-free' | 'cut';
export type SectionLabel = DossierSection['label'];
export interface CandidateSpec {
  /** `c-` + FNV-1a of `key`. */
  readonly id: string;
  /** Readable canonical identity: recipe, exit bar, entry bar, length, last rung. */
  readonly key: string;
  readonly kind: CandidateKind;
  /** Policy recipe (analyzed), route-free recipe, or `fallback-layered-entry/<style>`. */
  readonly recipe: string;
  readonly exit: {readonly bar: number; readonly frame: number; readonly section: SectionLabel; readonly sectionEnd: boolean;
    readonly phrase: boolean; readonly cue: number | null};
  /** Analyzed candidates leave B's entry to the planner (null bar and frame). */
  readonly entry: {readonly bar: number | null; readonly frame: number | null; readonly section: SectionLabel;
    readonly sectionStart: boolean; readonly skipCost: number};
  /** Overlap in A bars (0 for the echo reset, whose tail is set by tempo; null when the planner chooses it). */
  readonly overlapBars: number | null;
  readonly lastRung: boolean;
  readonly tempo: {readonly strategy: 'native' | 'stretch-b' | 'meet' | 'dual-ramp' | 'native-rate'; readonly stretch: number};
  /** True when the candidate claims beat alignment between the songs. */
  readonly beatLock: boolean;
}
export interface CandidateContext {
  readonly from: {readonly dossier: SongDossier; readonly grid: SetBarGrid; readonly frames: number};
  readonly to: {readonly dossier: SongDossier; readonly grid: SetBarGrid; readonly frames: number};
  readonly sampleRate: number;
  /** Earliest native A frame for any audible effect. */
  readonly earliestFrame: number;
  /** Optional last exit frame considered (default: the end of A). */
  readonly latestFrame?: number;
  /** Owner chose a clean cut for this request; otherwise none is ever generated. */
  readonly allowCut?: boolean;
}
export interface CandidateSet {
  readonly version: typeof ENGINE_CANDIDATES_VERSION;
  readonly candidates: readonly CandidateSpec[];
  readonly exits: number; readonly entries: number;
  readonly pruned: Readonly<Record<string, number>>;
  readonly beatConfident: boolean;
}

/** Same evidence rule as the planner: both grids measured and every grid confidence at least 0.65. */
export function dossierBeatConfident(a: SongDossier, b: SongDossier, ga: SetBarGrid, gb: SetBarGrid): boolean {
  return ga.source === 'measured' && gb.source === 'measured' && [a, b].every(d =>
    d.tempo.confidence >= 0.65 && d.grid.beatConfidence >= 0.65 && d.grid.downbeatConfidence >= 0.65);
}

const sectionFrames = (s: DossierSection, rate: number) => ({start: Math.round(s.startSeconds * rate), end: Math.round(s.endSeconds * rate)});

/** Section of A that ends at `frame` (within tolerance), else the one containing the bar before it. */
export function exitSection(d: SongDossier, frame: number, tol: number, rate: number): {label: SectionLabel; end: boolean; section: DossierSection | null} {
  for (const s of d.sections) if (Math.abs(sectionFrames(s, rate).end - frame) <= tol) return {label: s.label, end: true, section: s};
  const inside = d.sections.find(s => { const f = sectionFrames(s, rate); return f.start <= frame - 1 && frame - 1 < f.end; }) ?? null;
  return {label: inside?.label ?? null, end: false, section: inside};
}
/** Section of B that starts at `frame` (within tolerance), else the one containing it. */
export function entrySection(d: SongDossier, frame: number, tol: number, rate: number): {label: SectionLabel; start: boolean; section: DossierSection | null} {
  for (const s of d.sections) if (Math.abs(sectionFrames(s, rate).start - frame) <= tol) return {label: s.label, start: true, section: s};
  const inside = d.sections.find(s => { const f = sectionFrames(s, rate); return f.start <= frame && frame < f.end; }) ?? null;
  return {label: inside?.label ?? null, start: false, section: inside};
}

function stretchFor(recipe: string, fromBpm: number, toBpm: number): CandidateSpec['tempo'] {
  const gap = Math.abs(fromBpm / toBpm - 1);
  if (['blend', 'loudness-match', 'filter-sweep', 'loop-extend'].includes(recipe)) return {strategy: 'stretch-b', stretch: gap};
  if (recipe === 'meet-in-middle') {
    const g = Math.max(fromBpm, toBpm) / Math.min(fromBpm, toBpm) - 1;
    return {strategy: 'meet', stretch: Math.sqrt(1 + g) - 1};
  }
  if (recipe === 'dual-ramp') {
    const d = dualRampTempo(fromBpm, toBpm);
    return {strategy: 'dual-ramp', stretch: d ? Math.max(Math.abs(d.fromRatio - 1), Math.abs(d.toRatio - 1)) : Infinity};
  }
  if (recipe === 'tempo-ramp' || recipe === 'brake') return {strategy: 'native-rate', stretch: 0};
  return {strategy: 'native', stretch: 0};
}

/** Every candidate for one pair, pruned by the hard constraints. Deterministic for the same inputs. */
export function generateCandidates(ctx: CandidateContext): CandidateSet {
  const {from, to, sampleRate: rate} = ctx;
  const ga = from.grid, gb = to.grid;
  const tolA = Math.round(ga.barFrames * CANDIDATE_LIMITS.snapBars), tolB = Math.round(gb.barFrames * CANDIDATE_LIMITS.snapBars);
  const pruned: Record<string, number> = {};
  const prune = (why: string): void => { pruned[why] = (pruned[why] ?? 0) + 1; };
  const beatConfident = dossierBeatConfident(from.dossier, to.dossier, ga, gb);
  const policy = tempoGapPolicy(ga.bpm, gb.bpm, {beatConfident});
  const gap = Math.abs(gb.bpm / ga.bpm - 1);
  // ---- exits: phrase boundaries, section ends and analysed exit cues, earliest feasible bar to the end.
  const latest = Math.min(ctx.latestFrame ?? from.frames, from.frames - Math.round(2 * ga.barFrames));
  const firstBar = barAtOrAfter(ga, Math.max(0, ctx.earliestFrame));
  const sectionEnds = new Set<number>(), cueAt = new Map<number, number>();
  for (const s of from.dossier.sections) {
    const end = Math.round(s.endSeconds * rate), bar = barAtOrAfter(ga, end - tolA);
    if (Math.abs(downbeatAt(ga, bar) - end) <= tolA) sectionEnds.add(bar);
  }
  for (const c of from.dossier.cues.exits) {
    const f = Math.round(c.seconds * rate), bar = barAtOrAfter(ga, f - tolA);
    if (Math.abs(downbeatAt(ga, bar) - f) <= tolA) cueAt.set(bar, Math.max(cueAt.get(bar) ?? -Infinity, c.score));
  }
  const exits: CandidateSpec['exit'][] = [];
  for (let bar = firstBar; exits.length < CANDIDATE_LIMITS.maxExits; bar++) {
    const frame = downbeatAt(ga, bar);
    if (frame > latest) break;
    const phrase = bar % CANDIDATE_LIMITS.phraseBars === 0;
    if (!phrase && !sectionEnds.has(bar) && !cueAt.has(bar)) continue;
    const s = exitSection(from.dossier, frame, tolA, rate);
    exits.push({bar, frame, section: s.label, sectionEnd: sectionEnds.has(bar) || s.end, phrase, cue: cueAt.get(bar) ?? null});
  }
  // ---- entries: B's first downbeat, section starts and analysed entry cues, ranked with the skip cost.
  const pool = new Map<number, {frame: number; score: number}>();
  const add = (frame: number, score: number): void => {
    const bar = barAtOrAfter(gb, frame - tolB), snapped = downbeatAt(gb, bar);
    if (Math.abs(snapped - frame) > tolB || snapped < 0 || snapped >= to.frames - Math.round(2 * gb.barFrames)) return;
    const had = pool.get(bar);
    if (!had || had.score < score) pool.set(bar, {frame: snapped, score});
  };
  add(gb.downbeats[0]!, 0.5);
  for (const s of to.dossier.sections) if (s.label) add(Math.round(s.startSeconds * rate), 0.4 + 0.2 * s.confidence);
  for (const c of to.dossier.cues.entries) add(Math.round(c.seconds * rate), Math.max(0, Math.min(1, c.score)));
  const ranked = [...pool.entries()].map(([bar, e]) => ({bar, ...e, adjusted: e.score - entrySkipCost(e.frame, to.frames)}))
    .sort((x, y) => y.adjusted - x.adjusted || x.frame - y.frame);
  const earliest = [...pool.entries()].sort((x, y) => x[1].frame - y[1].frame)[0];
  const keep = ranked.slice(0, CANDIDATE_LIMITS.maxEntries);
  if (earliest && !keep.some(e => e.bar === earliest[0])) keep[keep.length - 1] = ranked.find(e => e.bar === earliest[0])!;
  const entries: CandidateSpec['entry'][] = keep.sort((x, y) => x.frame - y.frame).map(e => {
    const s = entrySection(to.dossier, e.frame, tolB, rate);
    return {bar: e.bar, frame: e.frame, section: s.label, sectionStart: s.start, skipCost: entrySkipCost(e.frame, to.frames)};
  });
  // ---- families
  const out: CandidateSpec[] = [];
  const make = (kind: CandidateKind, recipe: string, exit: CandidateSpec['exit'], entry: CandidateSpec['entry'],
    overlapBars: number | null, lastRung: boolean): void => {
    const tempo = stretchFor(recipe, ga.bpm, gb.bpm);
    if (tempo.stretch > CANDIDATE_LIMITS.maxStretch + 1e-9) { prune('stretch beyond 15%'); return; }
    const beatLock = kind === 'analyzed' && (RHYTHM_RECIPES as readonly string[]).includes(recipe);
    if (beatLock && !beatConfident) { prune('beat lock without trusted grids'); return; }
    // Audio for the whole plan: A for the overlap plus one bar of tail, B for the overlap (route-free, known entry).
    const bars = overlapBars ?? 0;
    if (exit.frame + Math.round((bars + 1) * ga.barFrames) > from.frames) { prune('A has too little audio left'); return; }
    if (entry.frame !== null && entry.frame + Math.round(Math.max(bars, 1) * gb.barFrames) > to.frames) { prune('B has too little audio after the entry'); return; }
    if (recipe === 'fallback-echo-reset' && exit.frame - Math.round(ga.barFrames / 2) < ctx.earliestFrame) { prune('echo pre-roll before the earliest frame'); return; }
    const key = `${recipe}|x${exit.bar}|e${entry.bar ?? 'auto'}|b${overlapBars ?? 'auto'}${lastRung ? '|last' : ''}`;
    out.push({id: `c-${fnv1a(key)}`, key, kind, recipe, exit, entry, overlapBars, lastRung, tempo, beatLock});
  };
  const plannerEntry: CandidateSpec['entry'] = {bar: null, frame: null, section: null, sectionStart: false, skipCost: 0};
  const analyzed = policy.recipes.filter((r: SetRecipe) => r !== 'echo-reset' && r !== 'cut');
  const layeredLength = gap <= LAYERED_ENTRY_LIMITS.nearGap ? 8 : 4;
  for (const exit of exits) {
    // Analyzed recipes need an analysed A cue or a section end on that bar; the planner chooses B's entry.
    if (exit.cue !== null || exit.sectionEnd) for (const recipe of analyzed) make('analyzed', recipe, exit, plannerEntry, null, false);
    for (const entry of entries) {
      for (const bars of routeFreeLengths('fallback-crossfade', ga.bpm, gb.bpm)) make('route-free', 'fallback-crossfade', exit, entry, bars, false);
      make('route-free', 'fallback-echo-reset', exit, entry, 0, false);
      for (const recipe of ['fallback-filter-dissolve', 'fallback-tone-dissolve'])
        for (const bars of routeFreeLengths(recipe, ga.bpm, gb.bpm)) make('route-free', recipe, exit, entry, bars, false);
      for (const style of ENTRY_STYLES) {
        make('route-free', `fallback-layered-entry/${style}`, exit, entry, layeredLength, false);
        make('route-free', `fallback-layered-entry/${style}`, exit, entry, 2, true);
      }
      if (ctx.allowCut) make('cut', 'fallback-cut', exit, entry, 0, false);
    }
  }
  return {version: ENGINE_CANDIDATES_VERSION, candidates: out, exits: exits.length, entries: entries.length, pruned, beatConfident};
}
