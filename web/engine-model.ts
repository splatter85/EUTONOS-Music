/**
 * Transition engine increment 3, part 2: stage-1 model score (engine-model@1).
 *
 * Arithmetic over the two song dossiers only; no audio is read. It uses the design 2.5 terms the dossier
 * (em.song-dossier.v1) actually supports. Section-level values stand in where the design asks for per-bar data,
 * and every such term is named as a proxy. Terms the dossier cannot support are listed in `absent` and contribute
 * nothing; no value is invented for them. Weights are engineering starting points, not calibrated and not
 * listened to.
 */
import {harmonicCompatibility, type TonalKey} from '../src/mix-planner.js';
import type {SongDossier} from './song-dossier.js';
import {exitSection, entrySection, type CandidateSpec} from './engine-candidates.js';

export const ENGINE_MODEL_VERSION = 'engine-model@1' as const;
/** Design 2.5 terms with no dossier data behind them yet (increment 4 adds per-bar loudness, low band, lead tiers). */
export const ABSENT_MODEL_TERMS: readonly string[] = Object.freeze([
  'energy-per-bar-loudness (dossier has section energy only; section proxy used)',
  'low-band-lowShare-kickOnsets (dossier has section low share only; section proxy used)',
  'lead-presence (dossier has section vocal share only; section proxy used)',
  'harmonic-local-chroma (dossier has the global key only)',
  'learned-prior (no learner snapshot yet; prior is 0)']);
export const MODEL_WEIGHTS = Object.freeze({
  structure: 1, energy: 0.6, lowClash: 0.8, leadOverlap: 0.6, harmonic: 0.5, tempoStrain: 1, gridTrust: 0.6, skip: 1, variety: 0.2, family: 1,
});
/** Base preference per family (engineering starting point; quality over speed, the last rung last). */
const FAMILY_BASE: Readonly<Record<string, number>> = Object.freeze({
  'blend': 0.6, 'dual-ramp': 0.5, 'meet-in-middle': 0.45, 'loudness-match': 0.4, 'filter-sweep': 0.4, 'loop-extend': 0.35,
  'echo-out': 0.3, 'tempo-ramp': 0.25, 'brake': 0.15,
  'fallback-crossfade': 0.4, 'fallback-filter-dissolve': 0.35, 'fallback-tone-dissolve': 0.33, 'fallback-echo-reset': 0.3,
  'fallback-layered-entry': 0.35, 'fallback-cut': 0,
});
/** Share of each song's low band left sounding together during the overlap, by family (lane rules). */
const LOW_SHARE: Readonly<Record<string, number>> = Object.freeze({
  'fallback-crossfade': 1, 'fallback-tone-dissolve': 0.5, 'fallback-filter-dissolve': 0.3, 'fallback-layered-entry': 0.2,
  'fallback-echo-reset': 0.1, 'fallback-cut': 0, analyzed: 0.4});
const LEAD_SHARE: Readonly<Record<string, number>> = Object.freeze({
  'fallback-crossfade': 1, 'fallback-tone-dissolve': 0.5, 'fallback-filter-dissolve': 0.5, 'fallback-layered-entry': 0.4,
  'fallback-echo-reset': 0.3, 'fallback-cut': 0, analyzed: 0.6});
/** How much harmony is sustained through the overlap, by family. */
const SUSTAIN: Readonly<Record<string, number>> = Object.freeze({
  'fallback-crossfade': 1, 'fallback-tone-dissolve': 0.5, 'fallback-filter-dissolve': 0.5, 'fallback-layered-entry': 0.5,
  'fallback-echo-reset': 0.2, 'fallback-cut': 0, analyzed: 1});

export interface ModelScore {
  readonly score: number;
  /** Weighted contributions; a term missing here was not computable for this pair (see `missing`). */
  readonly terms: Readonly<Record<string, number>>;
  readonly prior: number;
  /** Terms not computable for this pair (for example no sections in a dossier). */
  readonly missing: readonly string[];
  /** Design terms the dossier cannot support at all (always ABSENT_MODEL_TERMS): absent, never invented. */
  readonly absent: readonly string[];
}
export interface ModelContext {
  readonly from: SongDossier; readonly to: SongDossier;
  readonly sampleRate: number;
  readonly fromBarFrames: number; readonly toBarFrames: number;
  /** Family of the previous handover in this set (variety term), or null. */
  readonly previousFamily?: string | null;
}

const NOTES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const ALIASES: Readonly<Record<string, string>> = {Db: 'C#', 'D#': 'Eb', Gb: 'F#', 'G#': 'Ab', 'A#': 'Bb'};
/** Parses the dossier's global key ("A minor"); null when unknown or not confident. */
export function dossierKey(d: SongDossier): TonalKey | null {
  if (!d.tonal.key || d.tonal.status !== 'estimated' || d.tonal.confidence < 0.55) return null;
  const [note, mode] = d.tonal.key.split(' ');
  const tonic = NOTES.indexOf(ALIASES[note ?? ''] ?? note ?? '');
  return tonic >= 0 && (mode === 'major' || mode === 'minor') ? {tonic, mode} : null;
}
export const familyOf = (recipe: string): string => recipe.startsWith('fallback-layered-entry/') ? 'fallback-layered-entry' : recipe;
const round = (x: number): number => Math.round(x * 1e4) / 1e4;

/** Stage-1 score of one candidate. Higher is better; comparable only within one pair and model version. */
export function modelScore(c: CandidateSpec, ctx: ModelContext): ModelScore {
  const family = familyOf(c.recipe);
  const group = c.kind === 'analyzed' ? 'analyzed' : family;
  const terms: Record<string, number> = {}, missing: string[] = [];
  const W = MODEL_WEIGHTS;
  const bars = c.overlapBars ?? (c.kind === 'analyzed' ? 8 : 0);
  const overlap = Math.min(1, bars / 8);
  // Structural fit: exit at a section end, entry at a section start, phrase alignment.
  let structure = (c.exit.sectionEnd ? 0.4 : 0) + (c.exit.phrase ? 0.15 : 0) + (c.exit.bar % 8 === 0 ? 0.05 : 0) + (c.exit.cue !== null ? 0.1 : 0);
  structure += c.entry.frame === null ? 0.15 : (c.entry.sectionStart ? 0.3 : 0) + (c.entry.bar !== null && c.entry.bar % 4 === 0 ? 0.05 : 0);
  terms.structure = W.structure * structure;
  // Section proxies (energy, low band, vocal) at the exit and entry.
  const tolA = Math.round(ctx.fromBarFrames / 8), tolB = Math.round(ctx.toBarFrames / 8);
  const a = exitSection(ctx.from, c.exit.frame, tolA, ctx.sampleRate).section;
  const b = c.entry.frame === null ? ctx.to.sections[0] ?? null : entrySection(ctx.to, c.entry.frame, tolB, ctx.sampleRate).section;
  if (a && b) {
    terms.energySectionProxy = W.energy * -Math.abs(a.energy - b.energy);
    terms.lowClashSectionProxy = W.lowClash * -(a.low * b.low * overlap * (LOW_SHARE[group] ?? 0.5));
    let lead = a.vocal * b.vocal * overlap * (LEAD_SHARE[group] ?? 0.5);
    // An A exit with a lead line removes echo tails (design 2.5): echo reset and the echo-tailed layered styles.
    const echoTail = family === 'fallback-echo-reset' || family === 'fallback-layered-entry' && bars >= 4 &&
      (c.recipe.endsWith('/bass-first') || c.recipe.endsWith('/mid-first')) || c.recipe === 'echo-out';
    if (echoTail) lead += 0.3 * a.vocal;
    terms.leadOverlapSectionProxy = W.leadOverlap * -lead;
  } else missing.push('section proxies (no sections in at least one dossier)');
  // Harmonic fit from the global keys only, weighted by how much harmony the overlap sustains.
  const ka = dossierKey(ctx.from), kb = dossierKey(ctx.to);
  if (ka && kb) terms.harmonicGlobalKey = W.harmonic * (harmonicCompatibility(ka, kb).score - 0.6) * overlap * (SUSTAIN[group] ?? 0.5);
  else missing.push('harmonic (global key unknown or not confident)');
  // Tempo strain: stretch per deck against the 15% limit; unaligned beats drift during a long native overlap.
  const gap = ctx.from.tempo.bpm && ctx.to.tempo.bpm ? Math.abs(ctx.to.tempo.bpm / ctx.from.tempo.bpm - 1) : 0;
  terms.tempoStrain = W.tempoStrain * -(c.tempo.stretch / 0.15 * 0.5 + (c.beatLock ? 0 : Math.min(0.4, gap * bars * 0.5)));
  // Grid trust: a beat-locked claim is worth its weakest grid confidence; others only need A's bar timing.
  const conf = (d: SongDossier): number => Math.min(d.tempo.confidence, d.grid.beatConfidence, d.grid.downbeatConfidence);
  terms.gridTrust = W.gridTrust * (c.beatLock ? conf(ctx.from) * conf(ctx.to) - 0.5 : 0.2 * (ctx.from.grid.downbeatConfidence - 0.5));
  // Existing entry skip cost (transition-policy@3); analyzed entries are the planner's own, costed there.
  if (c.entry.frame !== null) terms.skip = W.skip * -c.entry.skipCost;
  // Variety: a small penalty for repeating the previous handover's family.
  if (ctx.previousFamily && ctx.previousFamily === family) terms.variety = -W.variety;
  // Family base preference, a mild bonus for longer overlaps, and the last rung last.
  terms.family = W.family * ((FAMILY_BASE[family] ?? 0.2) + (bars >= 2 ? 0.05 * Math.log2(bars) : 0) - (c.lastRung ? 0.3 : 0));
  for (const k of Object.keys(terms)) terms[k] = round(terms[k]!);
  const score = round(Object.values(terms).reduce((x, y) => x + y, 0));
  return {score, terms, prior: 0, missing, absent: ABSENT_MODEL_TERMS};
}
