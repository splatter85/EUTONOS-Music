/**
 * EMF-S21 Part B: whole-song section labels (`mix-structure@1`) from the existing bounded analysis.
 *
 * Inputs are only what `mix-analysis` already measures in its Worker: per-bar cue features (RMS,
 * low-band onsets, mid/high flux, harmonic energy) and the 0.25 s energy curve (RMS and the
 * below-180 Hz low band). No stems, no ML, no new audio pass. Labelling is O(bars) arithmetic on at
 * most `MIX_STRUCTURE_LIMITS.maxBars` merged bars, so it runs synchronously after the merge.
 *
 * Labels (intro / build / drop / breakdown / outro) are engineering heuristics from relative energy,
 * position and the slope into the next section. "drop" means "drop or high-energy section". A label
 * under `minConfidence` is withheld (label null, the heuristic guess kept for display). Deterministic;
 * nothing here was qualified by listening.
 */
import type {MixAnalysis, MixPointCandidate, CueEvidence} from '../src/mix-analysis.js';

export const MIX_STRUCTURE_VERSION = 'mix-structure@1' as const;
/** Engineering starting points, not calibrated values. */
export const MIX_STRUCTURE_LIMITS = Object.freeze({
  maxBars: 1024, maxSections: 32,
  /** Sections start on four-bar phrases (analysis downbeat index) and last at least this long, ends excepted. */
  minSectionBars: 8, edgeBars: 4,
  /** Smallest phrase novelty accepted as a section boundary. */
  minNovelty: 0.08,
  /** Below this energy spread between sections nothing is labelled (a flat song has no sections). */
  minContrast: 0.1,
  /** Relative section energy (0 = quietest section, 1 = loudest) for "high" and "low". */
  high: 0.66, low: 0.4,
  /** A label under this confidence is withheld. */
  minConfidence: 0.35,
});
export type SectionLabel = 'intro' | 'build' | 'drop' | 'breakdown' | 'outro';
export interface SongSection {
  readonly startFrame: number; readonly endFrame: number;
  /** Index of the first bar in `analysis.structure.downbeatFrames` (0-based), and the bar count. */
  readonly startBar: number; readonly bars: number;
  /** Null when the confidence is under `minConfidence`; `guess` keeps the heuristic's best label. */
  readonly label: SectionLabel | null; readonly guess: SectionLabel | null;
  /** Song-relative 0..1: blended energy, low band and a mid-band vocal/lead activity proxy. */
  readonly energy: number; readonly low: number; readonly vocal: number;
  readonly confidence: number;
}
export interface SongStructure {
  readonly version: typeof MIX_STRUCTURE_VERSION;
  /** True when the analysis covers only one bounded window (not the whole song). */
  readonly partial: boolean;
  readonly sections: readonly SongSection[];
  /** Median per-bar energy on the same 0..1 scale. */
  readonly medianEnergy: number;
  readonly limitations: readonly string[];
}
interface Bar {frame: number; endFrame: number; index: number; rms: number; low: number; density: number; vocal: number; e: number;}

const clamp = (n: number): number => Math.max(0, Math.min(1, n));
const mean = (xs: readonly number[]): number => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!;
}

function measureBars(analysis: MixAnalysis): Bar[] {
  const features = (analysis.cueFeatures ?? []).slice(0, MIX_STRUCTURE_LIMITS.maxBars);
  const index = new Map(analysis.structure.downbeatFrames.map((frame, i) => [frame, i]));
  const curve = analysis.energyCurve;
  let k = 0;
  const raw = features.map(f => {
    // Two-pointer walk: both lists are ordered by frame.
    while (k < curve.length && curve[k]!.endFrame <= f.frame) k++;
    let sum = 0, count = 0;
    for (let j = k; j < curve.length && curve[j]!.startFrame < f.endFrame; j++) { sum += curve[j]!.lowRms ** 2; count++; }
    return {f, low: count ? Math.sqrt(sum / count) : 0};
  });
  const scale = (pick: (x: typeof raw[number]) => number): number => Math.max(1e-12, percentile(raw.map(pick), 0.95));
  const sRms = scale(x => x.f.rms), sLow = scale(x => x.low), sOn = scale(x => x.f.lowOnsets),
    sMid = scale(x => x.f.midFlux), sHigh = scale(x => x.f.highFlux), sHarm = scale(x => x.f.harmonicEnergy);
  return raw.map(({f, low}) => {
    const rms = clamp(f.rms / sRms), lowN = clamp(low / sLow);
    const density = clamp((f.lowOnsets / sOn + f.midFlux / sMid + f.highFlux / sHigh) / 3);
    const vocal = clamp(0.5 * f.midFlux / sMid + 0.5 * f.harmonicEnergy / sHarm);
    return {frame: f.frame, endFrame: f.endFrame, index: index.get(f.frame) ?? -1, rms, low: lowN, density, vocal,
      e: 0.5 * rms + 0.3 * lowN + 0.2 * density};
  });
}

/** True when the evidence does not cover the whole song (one bounded window of a longer song). */
function partialCoverage(a: MixAnalysis): boolean {
  const w = a.analyzedWindows?.length ? {start: Math.min(...a.analyzedWindows.map(x => x.startFrame)),
    end: Math.max(...a.analyzedWindows.map(x => x.startFrame + x.frames))}
    : a.analyzedWindow ? {start: a.analyzedWindow.startFrame, end: a.analyzedWindow.startFrame + a.analyzedWindow.frames} : {start: 0, end: a.frames};
  return w.start > 0 || w.end < a.frames;
}
/** Phrase novelty at bar position i: energy step plus feature distance between the 4 bars on each side. */
function novelty(bars: readonly Bar[], i: number): number {
  const left = bars.slice(i - 4, i), right = bars.slice(i, i + 4);
  const m = (xs: readonly Bar[], key: 'e' | 'rms' | 'low' | 'density' | 'vocal') => mean(xs.map(b => b[key]));
  const step = Math.abs(m(right, 'e') - m(left, 'e'));
  const distance = mean((['rms', 'low', 'density', 'vocal'] as const).map(key => Math.abs(m(right, key) - m(left, key))));
  return 0.6 * step + 0.4 * distance;
}

/**
 * Section labels for one analysis. Null when there are too few complete bars (fewer than 16) or the
 * analysis has no per-bar features. Merged whole-song analyses give whole-song sections; a single
 * window gives a `partial` structure for that window only.
 */
export function labelSongStructure(analysis: MixAnalysis | null): SongStructure | null {
  if (!analysis?.cueFeatures?.length || analysis.cueFeatures.length < 16) return null;
  const bars = measureBars(analysis);
  const L = MIX_STRUCTURE_LIMITS;
  // Candidate boundaries: four-bar phrases on the analysis downbeat index, with 4 measured bars each side
  // that are contiguous (no merge gap inside the comparison).
  const contiguous = (from: number, to: number): boolean => {
    for (let j = from + 1; j < to; j++) if (bars[j]!.frame !== bars[j - 1]!.endFrame) return false;
    return true;
  };
  const candidates: {i: number; n: number}[] = [];
  for (let i = L.edgeBars; i <= bars.length - L.edgeBars; i++) {
    if (bars[i]!.index < 0 || bars[i]!.index % 4 !== 0 || !contiguous(i - 4, i + 4)) continue;
    candidates.push({i, n: novelty(bars, i)});
  }
  candidates.sort((a, b) => b.n - a.n || a.i - b.i);
  const cuts: {i: number; n: number}[] = [];
  for (const c of candidates) {
    if (c.n < L.minNovelty || cuts.length >= L.maxSections - 1) break;
    if (cuts.some(x => Math.abs(x.i - c.i) < L.minSectionBars)) continue;
    cuts.push(c);
  }
  // Merge gaps longer than a bar are also hard section edges (nothing is claimed across missing bars).
  cuts.sort((a, b) => a.i - b.i);
  const edges = [0, ...cuts.map(c => c.i), bars.length];
  const strength = (i: number): number => cuts.find(c => c.i === i)?.n ?? 0;
  const raw = edges.slice(0, -1).map((start, k) => {
    const end = edges[k + 1]!, span = bars.slice(start, end), half = Math.max(1, Math.floor(span.length / 2));
    return {start, end, e: mean(span.map(b => b.e)), low: mean(span.map(b => b.low)), vocal: mean(span.map(b => b.vocal)),
      slope: mean(span.slice(half).map(b => b.e)) - mean(span.slice(0, half).map(b => b.e)),
      edge: mean([start > 0 ? strength(start) : null, end < bars.length ? strength(end) : null].filter((x): x is number => x !== null))};
  });
  const lo = Math.min(...raw.map(s => s.e)), hi = Math.max(...raw.map(s => s.e)), contrast = hi - lo;
  const rel = (e: number): number => contrast > 1e-9 ? (e - lo) / contrast : 0.5;
  const isHigh = (k: number): boolean => raw[k] !== undefined && rel(raw[k]!.e) >= L.high;
  const downbeat = clamp(analysis.structure.downbeatConfidence);
  const sections: SongSection[] = raw.map((s, k) => {
    const r = rel(s.e), last = k === raw.length - 1;
    const highBefore = raw.slice(0, k).some((_, j) => isHigh(j)), highAfter = raw.slice(k + 1).some((_, j) => isHigh(k + 1 + j));
    let guess: SectionLabel | null = null, margin = 0;
    if (r >= L.high) { guess = 'drop'; margin = (r - L.high) / (1 - L.high); }
    else if (r < L.low) {
      margin = (L.low - r) / L.low;
      guess = k === 0 || !highBefore ? 'intro' : last || !highAfter ? 'outro' : 'breakdown';
    } else {
      // Middle energy: rising into a high section is a build; otherwise it is only a weak guess.
      margin = 0.25;
      if (isHigh(k + 1) && s.slope >= 0) { guess = 'build'; margin = Math.min(1, 0.4 + 4 * s.slope); }
      else if (k === 0) guess = 'intro';
      else if (last) guess = 'outro';
      else if (highBefore && highAfter) guess = 'breakdown';
    }
    const contrastWeight = Math.min(1, contrast / 0.3);
    const edgeWeight = 0.6 + 0.4 * Math.min(1, s.edge / 0.2);
    const confidence = guess ? clamp((0.45 + 0.55 * margin) * contrastWeight * edgeWeight * (0.5 + 0.5 * downbeat)) : 0;
    const label = contrast >= L.minContrast && confidence >= L.minConfidence ? guess : null;
    const first = bars[s.start]!, end = bars[s.end - 1]!;
    return {startFrame: first.frame, endFrame: end.endFrame, startBar: Math.max(0, first.index), bars: s.end - s.start,
      label, guess, energy: clamp(s.e), low: clamp(s.low), vocal: clamp(s.vocal), confidence};
  });
  return {version: MIX_STRUCTURE_VERSION, partial: partialCoverage(analysis), sections,
    medianEnergy: percentile(bars.map(b => b.e), 0.5),
    limitations: [
      'Section labels are energy/position heuristics (no stems, no ML); "drop" means drop or high-energy section.',
      'Vocal clash uses a mid-band activity proxy unless vocal spans are supplied; it is not vocal detection.',
      ...(contrast < L.minContrast ? ['Section energies are too similar to label; every section is unlabeled.'] : []),
      'Not qualified by listening.']};
}

/** Section containing `frame` (the last section whose start is at or before it). */
export function sectionAt(structure: SongStructure | null, frame: number): SongSection | null {
  if (!structure) return null;
  let found: SongSection | null = null;
  for (const s of structure.sections) if (s.startFrame <= frame && frame < s.endFrame) found = s;
  return found;
}
/** Section whose start lies within `tolerance` frames of `frame`. */
export function sectionStartingAt(structure: SongStructure | null, frame: number, tolerance: number): SongSection | null {
  return structure?.sections.find(s => Math.abs(s.startFrame - frame) <= tolerance) ?? null;
}
/** Section that ends within `tolerance` frames of `frame`. */
export function sectionEndingAt(structure: SongStructure | null, frame: number, tolerance: number): SongSection | null {
  return structure?.sections.find(s => Math.abs(s.endFrame - frame) <= tolerance) ?? null;
}
export const labelText = (s: SongSection | null): string => !s ? 'unanalysed part' : s.label ?? 'unlabeled section';

/** Engineering weights for the pair term added to the planner's pair score. Not calibrated. */
export const STRUCTURE_PAIR_WEIGHTS = Object.freeze({
  exitLow: 0.15, exitAtEnd: 0.05, midBuild: 0.2, entryStart: 0.08, energyMatch: 0.35, barEnergyMatch: 0.15,
  bassClash: 0.1, vocalClash: 0.08, entryOutro: 0.3,
});
export interface StructurePairTerm {
  readonly score: number;
  readonly exit: SongSection | null; readonly entry: SongSection | null;
  readonly energyMatch: number | null;
  /** Heuristic 0..1 estimates from section low-band energy and the vocal proxy (or spans). */
  readonly bassClash: number; readonly vocalClash: number;
}
function spanOverlaps(spans: MixAnalysis['vocalSpans'], start: number, end: number): boolean {
  return (spans ?? []).some(s => s.startFrame < end && s.endFrame > start);
}

/**
 * Structural pair term for leaving A at `outFrame` and entering B at `intoFrame`:
 * - exit: A playing through an outro/breakdown earns a bonus; leaving inside a build (not at its end) is penalised;
 * - entry: a B section start earns a bonus, and B's section energy should match A's exit section;
 * - heuristics: bass clash (both low bands high) and vocal clash (both vocal proxies high, or both in vocal spans).
 * With no structure for a song only the parts that do not need it apply (zero when neither has one).
 */
export function structurePairTerm(from: {readonly analysis: MixAnalysis | null; readonly structure: SongStructure | null},
  to: {readonly analysis: MixAnalysis | null; readonly structure: SongStructure | null},
  outFrame: number, intoFrame: number, overlapFrames: number, barFrames: number): StructurePairTerm {
  const W = STRUCTURE_PAIR_WEIGHTS, tol = Math.max(1, Math.round(barFrames / 8));
  const exit = sectionAt(from.structure, outFrame), entry = sectionAt(to.structure, intoFrame);
  const ending = sectionEndingAt(from.structure, outFrame, tol);
  const quiet = (s: SongSection | null): boolean => s?.label === 'outro' || s?.label === 'breakdown';
  let score = 0;
  if (exit) {
    // A quiet section either carries the overlap (exit inside it) or has just ended at the exit downbeat.
    if (quiet(exit) || quiet(ending)) score += W.exitLow;
    const atEnd = Math.abs(exit.startFrame - outFrame) <= tol || Math.abs(exit.endFrame - outFrame) <= tol;
    if (atEnd) score += W.exitAtEnd;
    // Leaving mid-build: the build resolves into its drop after A has gone.
    if (exit.label === 'build' && !atEnd && exit.endFrame - outFrame > 2 * barFrames) score -= W.midBuild;
  }
  const startsSection = !!sectionStartingAt(to.structure, intoFrame, tol);
  // Entering B in its outro would leave B almost over; it never earns the entry bonus and is penalised.
  if (entry?.label === 'outro') score -= W.entryOutro;
  else if (startsSection && entry?.label) score += W.entryStart;
  let energyMatch: number | null = null;
  if (exit && entry) {
    energyMatch = 1 - Math.abs(exit.energy - entry.energy);
    score += (startsSection ? W.energyMatch : W.barEnergyMatch) * energyMatch;
  }
  const bassClash = exit && entry ? clamp((exit.low - 0.6) / 0.4) * clamp((entry.low - 0.6) / 0.4) : 0;
  const spansKnown = !!from.analysis?.vocalSpans && !!to.analysis?.vocalSpans;
  const vocalClash = spansKnown
    ? (spanOverlaps(from.analysis!.vocalSpans, outFrame, outFrame + overlapFrames) &&
      spanOverlaps(to.analysis!.vocalSpans, intoFrame, intoFrame + overlapFrames) ? 1 : 0)
    : exit && entry ? clamp((exit.vocal - 0.6) / 0.4) * clamp((entry.vocal - 0.6) / 0.4) : 0;
  score -= W.bassClash * bassClash + W.vocalClash * vocalClash;
  return {score, exit, entry, energyMatch, bassClash, vocalClash};
}

/**
 * Cue candidates synthesised at labelled section starts that the windowed cue finder did not keep.
 * Evidence comes from the same four complete measured bars the cue finder uses; the boundary strength
 * is the section's novelty edge. Existing cues are never replaced or rescored.
 */
export function structuralCues(analysis: MixAnalysis, structure: SongStructure | null, incoming: boolean,
  filter: (s: SongSection) => boolean = () => true): MixPointCandidate[] {
  if (!structure || !analysis.cueFeatures?.length) return [];
  const bars = analysis.cueFeatures, existing = incoming ? analysis.mixIn : analysis.mixOut;
  const barFrames = bars.length > 1 ? (bars.at(-1)!.endFrame - bars[0]!.frame) / bars.length : analysis.sampleRate * 2;
  const maxima = (['rms', 'harmonicEnergy', 'lowOnsets'] as const).map(key => Math.max(1e-20, ...bars.map(b => b[key])));
  const phrases = new Set(analysis.structure.phraseFrames);
  const out: MixPointCandidate[] = [];
  const conf = Math.min(analysis.beatGrid.confidence, analysis.structure.downbeatConfidence);
  for (const s of structure.sections) {
    if (!s.label || !filter(s)) continue;
    if (incoming && s.label === 'outro') continue; // never offer B's outro as an entry
    const target = incoming ? s.startFrame : s.endFrame;
    if (existing.some(c => Math.abs(c.frame - target) <= barFrames / 8)) continue;
    // Snap to this analysis's own measured bar (a windowed analysis has its own downbeat frames).
    let i = -1;
    for (let j = 0; j < bars.length; j++) {
      if (Math.abs(bars[j]!.frame - target) <= barFrames / 8 && (i < 0 || Math.abs(bars[j]!.frame - target) < Math.abs(bars[i]!.frame - target))) i = j;
    }
    if (i < 0) continue;
    const frame = bars[i]!.frame;
    if (out.some(c => c.frame === frame)) continue;
    const window = bars.slice(i, i + 4);
    if (window.length !== 4 || window.some((b, n) => n > 0 && window[n - 1]!.endFrame !== b.frame)) continue;
    const salience = mean(window.map(b => 0.5 * b.rms / maxima[0]! + 0.25 * b.harmonicEnergy / maxima[1]! + 0.25 * b.lowOnsets / maxima[2]!));
    const interference = mean(window.map(b => b.rms / maxima[0]!));
    const chroma = Array.from({length: 12}, (_, pc) => mean(window.map(b => b.chroma[pc]!)));
    const boundary = clamp(0.4 + s.confidence * 0.4);
    const evidence: CueEvidence = {kind: 'boundary', boundary, period: clamp(0.5 * conf), salience: clamp(salience),
      windowEndFrame: window.at(-1)!.endFrame, interference: clamp(interference), chroma};
    const score = clamp(0.45 * boundary + 0.1 * conf + 0.2 * (incoming ? salience : 1 - interference) +
      0.15 * (incoming ? (phrases.has(frame) ? 1 : 0.4) : frame / analysis.frames));
    out.push({frame, seconds: frame / analysis.sampleRate, score, confidence: Math.min(conf, 0.5 + s.confidence / 2), evidence,
      reasons: [`${MIX_STRUCTURE_VERSION} ${s.label} section ${incoming ? 'start' : 'end'} (confidence ${s.confidence.toFixed(2)})`,
        'complete four-bar source window', 'section label is an energy heuristic, not verified structure']});
  }
  return out;
}

/** Compact per-song structure text, e.g. "intro 1-16 · drop 17-48 (0.81) · breakdown 49-64". Bars are 1-based analysis bars. */
export function describeStructure(structure: SongStructure | null, limit = 8): string {
  if (!structure) return 'structure: not analysed';
  const parts = structure.sections.slice(0, limit).map(s =>
    `${s.label ?? 'unlabeled'} ${s.startBar + 1}-${s.startBar + s.bars}${s.label ? ` (${s.confidence.toFixed(2)})` : ''}`);
  return `${structure.partial ? 'partial ' : ''}structure: ${parts.join(' · ')}${structure.sections.length > limit ? ' · …' : ''}`;
}

/** Part B readout data: section labels at A's exit and B's entry, with 1-based grid bars. */
export interface HandoverStructure {
  readonly version: typeof MIX_STRUCTURE_VERSION;
  readonly exit: {readonly bar: number; readonly label: string | null; readonly at: 'end' | 'in'; readonly analysed: boolean; readonly partial: boolean};
  readonly entry: {readonly bar: number; readonly label: string | null; readonly ordinal: number | null; readonly sectionStart: boolean; readonly analysed: boolean};
}
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'] as const;
/** "leaves at the end of the breakdown at bar 33, enters at its first drop (bar 17)"; `title` names B when known. */
export function handoverSentence(h: HandoverStructure, title?: string): string {
  const exit = !h.exit.analysed ? `leaves at bar ${h.exit.bar} (no structure analysis for A)`
    : !h.exit.label ? `leaves at bar ${h.exit.bar} (section unlabeled)`
      : `leaves ${h.exit.at === 'end' ? 'at the end of' : 'in'} the ${h.exit.label} at bar ${h.exit.bar}`;
  const who = title ? `enters ${title}` : 'enters';
  const entry = !h.entry.analysed ? `${who} at bar ${h.entry.bar} (no structure analysis for B)`
    : !h.entry.label ? `${who} at bar ${h.entry.bar} (section unlabeled)`
      : h.entry.sectionStart ? `${who} at its ${h.entry.ordinal && h.entry.ordinal <= ORDINALS.length ? `${ORDINALS[h.entry.ordinal - 1]} ` : ''}${h.entry.label} (bar ${h.entry.bar})`
        : `${who} in its ${h.entry.label} (bar ${h.entry.bar})`;
  return `${exit}${h.exit.partial ? ' (A structure from one window)' : ''}, ${entry}`;
}

