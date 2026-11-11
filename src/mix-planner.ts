import {analyzeMixAudio, type MixAnalysis, type MixPcm, type MixPointCandidate} from './mix-analysis.js';
import {bassSwapAutomation, type MixAutomation} from './mix-automation.js';

/** Engineering choices, not listening-qualified ranges or calibrated probabilities. */
export const MIX_PLANNER_VERSION = 'automatic-mix@1' as const;
export const MIX_LIMITS = Object.freeze({tempoRatioMin: 0.92, tempoRatioMax: 1.08,
  pitchSemitones: 2, tempoConfidence: 0.65, beatConfidence: 0.6,
  keyConfidence: 0.55, cueConfidence: 0.35, phraseConfidence: 0.2});

export interface TonalKey { readonly tonic: number; readonly mode: 'major' | 'minor'; }
export interface HarmonicCompatibility {
  readonly fromCamelot: string; readonly toCamelot: string;
  readonly circleDistance: number; readonly score: number;
  readonly relation: 'same-key' | 'relative' | 'adjacent-fifth' | 'distant';
}
export interface MixPlannerOptions {
  /** Original A buffer frame. This bound includes the caller's preparation allowance. */
  readonly minimumFromFrame?: number;
  readonly overlapBeats?: 4 | 8 | 16;
  /** Pitch changes are disabled unless explicitly selected. */
  readonly allowPitchShift?: boolean;
  /** An explicit requested shift is still subject to range and harmonic checks. */
  readonly pitchSemitones?: number;
  readonly returnToOriginalTempo?: boolean;
}
export interface AutomaticMixPlan {
  readonly kind: 'mix'; readonly version: typeof MIX_PLANNER_VERSION;
  readonly sampleRate: number;
  readonly fromFrames: number; readonly toFrames: number;
  readonly fromExitFrame: number; readonly toEntryFrame: number;
  readonly overlapFrames: number; readonly overlapBeats: 4 | 8 | 16;
  readonly fromBpm: number; readonly toBpm: number;
  readonly tempoRatio: number; readonly pitchSemitones: number;
  readonly returnToOriginalTempo: boolean;
  readonly confidence: number;
  readonly evidence: {readonly tempo: number; readonly beat: number; readonly key: number;
    readonly cue: number; readonly phrase: number};
  readonly harmonic: HarmonicCompatibility;
  readonly automation: {readonly outgoing: MixAutomation; readonly incoming: MixAutomation};
  readonly reasons: readonly string[];
}
export interface MixFallback {
  readonly kind: 'fallback'; readonly version: typeof MIX_PLANNER_VERSION;
  readonly reason: string;
}
export type MixDecision = AutomaticMixPlan | MixFallback;

const mod12 = (n: number): number => ((n % 12) + 12) % 12;
function checkKey(key: TonalKey): void {
  if (!Number.isInteger(key.tonic) || key.tonic < 0 || key.tonic > 11 ||
    (key.mode !== 'major' && key.mode !== 'minor')) throw new Error('Invalid tonal key.');
}
function wheelNumber(key: TonalKey): number {
  const relativeMajor = mod12(key.tonic + (key.mode === 'minor' ? 3 : 0));
  return mod12(relativeMajor * 7 + 7) + 1;
}
/** Camelot labels are a circle-of-fifths indexing convention, not semitone counts. */
export function camelotKey(key: TonalKey): string {
  checkKey(key);
  return `${wheelNumber(key)}${key.mode === 'minor' ? 'A' : 'B'}`;
}
export function harmonicCompatibility(from: TonalKey, to: TonalKey): HarmonicCompatibility {
  checkKey(from); checkKey(to);
  const d = Math.abs(wheelNumber(from) - wheelNumber(to)), circleDistance = Math.min(d, 12 - d);
  const sameMode = from.mode === to.mode;
  const relation = circleDistance === 0 ? sameMode ? 'same-key' : 'relative'
    : circleDistance === 1 && sameMode ? 'adjacent-fifth' : 'distant';
  const score = relation === 'same-key' ? 1 : relation === 'relative' ? 0.95
    : relation === 'adjacent-fifth' ? 0.85 : Math.max(0, 0.45 - 0.07 * circleDistance);
  return {fromCamelot: camelotKey(from), toCamelot: camelotKey(to), circleDistance, score, relation};
}
const shifted = (key: TonalKey, semitones: number): TonalKey =>
  ({tonic: mod12(key.tonic + semitones), mode: key.mode});
const fallback = (reason: string): MixFallback => ({kind: 'fallback', version: MIX_PLANNER_VERSION, reason});
const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

/** Validate derived data before it can become a native playback schedule. */
function validAnalysis(a: MixAnalysis): boolean {
  return Number.isSafeInteger(a.sampleRate) && a.sampleRate >= 8000 && a.sampleRate <= 192000 &&
    Number.isSafeInteger(a.frames) && a.frames > 0 && a.frames <= a.sampleRate * 180 &&
    a.tempo.bpm !== null && Number.isFinite(a.tempo.bpm) && a.tempo.bpm >= 60 && a.tempo.bpm <= 180 &&
    [a.tempo.confidence, a.beatGrid.confidence, a.key.confidence, a.structure.phraseConfidence].every(unit) &&
    a.key.tonic !== null && Number.isInteger(a.key.tonic) && a.key.tonic >= 0 && a.key.tonic < 12 &&
    (a.key.mode === 'major' || a.key.mode === 'minor') &&
    a.structure.assumed === true && a.structure.meter[0] === 4 && a.structure.meter[1] === 4 &&
    [...a.mixIn, ...a.mixOut].every(c => Number.isSafeInteger(c.frame) && c.frame >= 0 && c.frame < a.frames &&
      unit(c.score) && unit(c.confidence));
}
function eligibleCues(cues: readonly MixPointCandidate[], low: number, high: number): MixPointCandidate[] {
  return cues.filter(c => c.frame >= low && c.frame <= high && c.confidence >= MIX_LIMITS.cueConfidence)
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.frame - b.frame);
}

/**
 * Pure proposal from two audio-derived analyses. No clock, media effects or fallback scheduling.
 * The player binds original identities and checks its exact clock again after processing B.
 */
export function planAutomaticMix(from: MixAnalysis, to: MixAnalysis,
  options: MixPlannerOptions = {}): MixDecision {
  const minimum = options.minimumFromFrame ?? 0, overlapBeats = options.overlapBeats ?? 8;
  if (!Number.isSafeInteger(minimum) || minimum < 0 || ![4, 8, 16].includes(overlapBeats)) {
    return fallback('Invalid mix window or overlap; retain the authored route.');
  }
  if (options.pitchSemitones !== undefined && (!Number.isInteger(options.pitchSemitones) ||
    Math.abs(options.pitchSemitones) > MIX_LIMITS.pitchSemitones)) {
    return fallback('Requested pitch shift is outside the engineering limit of +/-2 semitones.');
  }
  if (!validAnalysis(from) || !validAnalysis(to) || from.sampleRate !== to.sampleRate) {
    return fallback('Insufficient or unsupported tempo/key analysis, or unequal analysis sample rates.');
  }
  const evidence = {tempo: Math.min(from.tempo.confidence, to.tempo.confidence),
    beat: Math.min(from.beatGrid.confidence, to.beatGrid.confidence),
    key: Math.min(from.key.confidence, to.key.confidence),
    phrase: Math.min(from.structure.phraseConfidence, to.structure.phraseConfidence)};
  if (evidence.tempo < MIX_LIMITS.tempoConfidence || evidence.beat < MIX_LIMITS.beatConfidence ||
      evidence.key < MIX_LIMITS.keyConfidence || evidence.phrase < MIX_LIMITS.phraseConfidence) {
    return fallback('Audio analysis confidence is below the versioned mix thresholds.');
  }
  const fromBpm = from.tempo.bpm!, toBpm = to.tempo.bpm!, tempoRatio = fromBpm / toBpm;
  if (tempoRatio < MIX_LIMITS.tempoRatioMin || tempoRatio > MIX_LIMITS.tempoRatioMax) {
    return fallback('Tempo match is outside the engineering limit of +/-8%.');
  }
  const a: TonalKey = {tonic: from.key.tonic!, mode: from.key.mode!};
  const b: TonalKey = {tonic: to.key.tonic!, mode: to.key.mode!};
  let pitchSemitones = options.pitchSemitones ?? 0;
  let harmonic = harmonicCompatibility(a, shifted(b, pitchSemitones));
  // Preserve the original key whenever it already has a supported relation.
  if (options.pitchSemitones === undefined && options.allowPitchShift && harmonic.score < 0.85) {
    const alternatives = [-2, -1, 1, 2].map(shift => ({shift, harmonic: harmonicCompatibility(a, shifted(b, shift))}))
      .sort((x, y) => (y.harmonic.score - Math.abs(y.shift) * 0.03) -
        (x.harmonic.score - Math.abs(x.shift) * 0.03) || Math.abs(x.shift) - Math.abs(y.shift) || x.shift - y.shift);
    const best = alternatives[0]!;
    if (best.harmonic.score > harmonic.score) { pitchSemitones = best.shift; harmonic = best.harmonic; }
  }
  if (harmonic.score < 0.85) return fallback('No supported harmonic relation within the selected pitch-shift policy.');
  const overlapFrames = Math.round(overlapBeats * 60 * from.sampleRate / fromBpm);
  const outgoing = eligibleCues(from.mixOut, minimum, from.frames - overlapFrames - 1);
  // A four-beat linear tempo return consumes the mean of its endpoint rates.
  // Reserve that actual source budget plus one native B beat before ranking cues.
  const returnFrames = options.returnToOriginalTempo ? Math.round(4 * 60 * from.sampleRate / fromBpm) : 0;
  const tailSourceFrames = returnFrames * (tempoRatio + 1) / 2 + to.sampleRate * 60 / toBpm;
  const incoming = eligibleCues(to.mixIn, 0,
    to.frames - Math.ceil(overlapFrames * tempoRatio + tailSourceFrames) - 2);
  if (!outgoing.length || !incoming.length) return fallback('No confident future mix points have enough audio for the overlap.');
  const candidates = outgoing.flatMap(out => incoming.map(into => {
    const eo = from.energyCurve.find(e => out.frame >= e.startFrame && out.frame < e.endFrame)?.rms ?? 0;
    const ei = to.energyCurve.find(e => into.frame >= e.startFrame && into.frame < e.endFrame)?.rms ?? 0;
    const mismatch = Math.abs(eo - ei) / Math.max(1e-8, eo + ei);
    return {out, into, score: out.score + into.score - 0.15 * mismatch};
  })).sort((x, y) => y.score - x.score || x.out.frame - y.out.frame || x.into.frame - y.into.frame);
  const choice = candidates[0]!, cue = Math.min(choice.out.confidence, choice.into.confidence);
  return {kind: 'mix', version: MIX_PLANNER_VERSION, sampleRate: from.sampleRate,
    fromFrames: from.frames, toFrames: to.frames, fromExitFrame: choice.out.frame, toEntryFrame: choice.into.frame,
    overlapFrames, overlapBeats, fromBpm, toBpm, tempoRatio, pitchSemitones,
    returnToOriginalTempo: options.returnToOriginalTempo ?? false,
    confidence: Math.min(evidence.tempo, evidence.beat, evidence.key, cue, evidence.phrase), evidence: {...evidence, cue},
    harmonic, automation: bassSwapAutomation(overlapFrames, from.sampleRate),
    reasons: ['Audio-derived cue and beat hypotheses; 4/4 and four-bar phrasing are assumed.',
      `Harmonic candidate: ${harmonic.fromCamelot} -> ${harmonic.toCamelot} (${harmonic.relation}).`,
      'Bass attenuation and complementary gain curves are scheduled on the existing clock.',
      'Global key does not prove local chord/vocal compatibility. Listening is untested.']};
}

/** Plain Node/browser function: two recordings in, a deterministic proposal out. */
export function planMixFromAudio(from: MixPcm, to: MixPcm, options: MixPlannerOptions = {}): MixDecision {
  try { return planAutomaticMix(analyzeMixAudio(from), analyzeMixAudio(to), options); }
  catch (error) { return fallback(`Analysis unavailable: ${error instanceof Error ? error.message : String(error)}`); }
}
