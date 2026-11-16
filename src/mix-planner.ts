import {analyzeMixAudio, MIX_LEVEL_VERSION, SONG_ANALYSIS_WINDOW, type MixAnalysis, type MixPcm, type MixPointCandidate, type MixLevelEvidence} from './mix-analysis.js';
import {bassSwapAutomation, cleanCutAutomation, crossfadeAutomation, filterSweepAutomation, echoOutAutomation, type MixAutomation} from './mix-automation.js';
import {nativeRateInputAt, type NativeRateRamp} from './time-pitch.js';

/** Engineering choices, not listening-qualified ranges or calibrated probabilities. */
export const MIX_PLANNER_VERSION = 'automatic-mix@1' as const;
export const MIX_LIMITS = Object.freeze({tempoRatioMin: 0.92, tempoRatioMax: 1.08,
  pitchSemitones: 2, tempoConfidence: 0.65, beatConfidence: 0.6, tempoAmbiguity: 0.5,
  keyConfidence: 0.55, cueConfidence: 0.35, phraseConfidence: 0.2});

export interface TonalKey { readonly tonic: number; readonly mode: 'major' | 'minor'; }
export interface HarmonicCompatibility {
  readonly fromCamelot: string; readonly toCamelot: string;
  readonly circleDistance: number | null; readonly score: number;
  readonly relation: 'same-key' | 'relative' | 'adjacent-fifth' | 'distant' | 'unknown';
}
export type MixRecipe = 'blend' | 'cut' | 'echo-out' | 'filter-sweep' | 'loudness-match' | 'tempo-ramp' | 'loop-extend' | 'brake';
export const isBeatmatchedRecipe = (recipe: string): boolean => ['blend', 'filter-sweep', 'loudness-match', 'loop-extend'].includes(recipe);
export const isSmoothRecipe = (recipe: string): boolean => isBeatmatchedRecipe(recipe) || recipe === 'tempo-ramp';
export const LEVEL_MATCH_LIMITS = Object.freeze({maxGain: 4, samplePeakCeiling: 10 ** (-1 / 20)});
export interface LevelMatchPlan {
  readonly from: MixLevelEvidence; readonly to: MixLevelEvidence;
  readonly fromGain: number; readonly toGain: number;
  readonly rawDeltaLu: number; readonly beforeDeltaLu: number; readonly matchedDeltaLu: number;
  readonly nativeSamplePeak: number; readonly maxGain: number; readonly samplePeakCeiling: number;
  readonly fromNativeSamplePeak: number; readonly incomingPeakBudget: number;
  readonly renderGainApplied?: number;
}
export const MIX_CANDIDATE_LIMIT = 6;
export interface MixPlannerOptions {
  readonly recipe?: MixRecipe | 'auto';
  /** Explicit content evidence: A has a sparse, clean, dry prelude; B has no prominent vocal. Never inferred from RMS. */
  readonly echoContentConfirmed?: boolean;
  /** Original A buffer frame. This bound includes the caller's preparation allowance. */
  readonly minimumFromFrame?: number;
  readonly overlapBeats?: 4 | 8 | 16;
  /** Pitch changes are disabled unless explicitly selected. */
  readonly allowPitchShift?: boolean;
  /** An explicit requested shift is still subject to range and harmonic checks. */
  readonly pitchSemitones?: number;
  readonly returnToOriginalTempo?: boolean;
  /** Captured current A gain, never a proposed change to an already-audible source. */
  readonly fromLevelGain?: number;
  readonly loopBars?: 4 | 8;
}
export interface AutomaticMixPlan {
  readonly kind: 'mix'; readonly version: typeof MIX_PLANNER_VERSION;
  readonly recipe: MixRecipe;
  /** A source frames before B entry T; outgoing graph starts at S = T - preRollFrames. */
  readonly preRollFrames: number;
  readonly echoContentConfirmed?: boolean;
  readonly sampleRate: number;
  readonly fromFrames: number; readonly toFrames: number;
  readonly fromExitFrame: number; readonly toEntryFrame: number;
  readonly overlapFrames: number; readonly overlapBeats: 4 | 8 | 16;
  readonly fromBpm: number; readonly toBpm: number;
  readonly tempoRatio: number; readonly pitchSemitones: number;
  readonly returnToOriginalTempo: boolean;
  readonly levelMatch?: LevelMatchPlan;
  /** S is a native A anchor; T=S+entryDelayFrames. No virtual value replaces fromExitFrame. */
  readonly entryDelayFrames?: number;
  readonly outgoingEffectSourceFrame?: number;
  readonly nativeRate?: {readonly outgoing: NativeRateRamp; readonly incoming?: NativeRateRamp; readonly pitchMoves: true};
  readonly loopExtension?: {readonly bars: 4 | 8; readonly startFrame: number; readonly endFrame: number; readonly frames: number};
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
const nativeMotionPeak = (a: MixAnalysis, gain = 1): boolean => !!a.nativePeak && a.nativePeak.version === 'native-sample-peak@1' &&
  a.nativePeak.frames === a.frames && Number.isFinite(a.nativePeak.value) && a.nativePeak.value >= 0 &&
  a.nativePeak.value * gain <= LEVEL_MATCH_LIMITS.samplePeakCeiling + 1e-7;

/** Final prepared headroom may further constrain B, without changing A or hiding the residual. */
export function withPreparedLevelGain(plan: AutomaticMixPlan, gain: number): AutomaticMixPlan {
  if (!plan.levelMatch) return plan;
  if (!Number.isFinite(gain) || gain <= 0 || gain > plan.levelMatch.toGain) throw new Error('Invalid prepared level gain.');
  const level = plan.levelMatch;
  return {...plan, levelMatch: {...level, toGain: gain,
    matchedDeltaLu: level.to.lufs! + 20 * Math.log10(gain) - level.from.lufs! - 20 * Math.log10(level.fromGain)}};
}

function styledBlend(from: MixAnalysis, to: MixAnalysis, options: MixPlannerOptions): MixDecision {
  const plan = planBlend(from, to, options);
  if (plan.kind === 'fallback' || !options.recipe || options.recipe === 'auto' || options.recipe === 'blend') return plan;
  if (options.recipe === 'filter-sweep') return {...plan, recipe: 'filter-sweep', automation: filterSweepAutomation(plan.overlapFrames, plan.sampleRate)};
  if (options.recipe === 'tempo-ramp') {
    if (!nativeMotionPeak(from, options.fromLevelGain ?? 1) || !nativeMotionPeak(to)) return fallback('Native rate motion needs finite full-source effective sample-peak evidence.');
    if (plan.pitchSemitones !== 0) return fallback('Native tempo ramp moves pitch; an independent pitch shift is unsupported.');
    const frames = Math.round(2 * plan.overlapBeats * 60 * plan.sampleRate / (plan.fromBpm + plan.toBpm));
    const outgoing = {start: 1, end: plan.toBpm / plan.fromBpm, frames}, incoming = {start: plan.tempoRatio, end: 1, frames};
    if (plan.fromExitFrame + nativeRateInputAt(outgoing, frames) >= from.frames ||
      plan.toEntryFrame + nativeRateInputAt(incoming, frames) >= to.frames) return fallback('Native ramp lacks source audio for its integrated beat count.');
    return {...plan, recipe: 'tempo-ramp', overlapFrames: frames, nativeRate: {outgoing, incoming, pitchMoves: true},
      returnToOriginalTempo: true, automation: crossfadeAutomation(frames, plan.sampleRate),
      reasons: [...plan.reasons, 'Native playback-rate ramps share an integrated changing beat grid; pitch moves. Browser k-rate integration is nominal, not a per-sample warp guarantee.']};
  }
  if (options.recipe === 'loop-extend') {
    const bars = options.loopBars ?? 4, grid = from.structure.downbeatFrames, index = grid.indexOf(plan.fromExitFrame);
    const startFrame = grid[index - bars], endFrame = plan.fromExitFrame;
    const barFrames = 4 * 60 * from.sampleRate / plan.fromBpm;
    if (from.structure.downbeatConfidence < 0.65 || startFrame === undefined || startFrame < (from.analyzedWindow?.startFrame ?? 0) ||
      grid.slice(index - bars, index).some((f, i) => Math.abs(grid[index - bars + i + 1]! - f - barFrames) > barFrames * 0.02) ||
      (from.vocalSpans ?? []).some(s => s.startFrame < endFrame && s.endFrame > startFrame)) return fallback('Loop needs a measured 4/8-bar interval outside supplied vocal spans.');
    const frames = endFrame - startFrame, normal = crossfadeAutomation(plan.overlapFrames, plan.sampleRate);
    const shift = (a: MixAutomation): MixAutomation => ({...a, durationFrames: frames + a.durationFrames,
      gain: [{frame: 0, value: 1}, ...a.gain.map(p => ({...p, frame: p.frame + frames}))],
      lowShelfDb: [{frame: 0, value: 0}, ...a.lowShelfDb.map(p => ({...p, frame: p.frame + frames}))],
      highPassHz: [{frame: 0, value: 0}, ...a.highPassHz.map(p => ({...p, frame: p.frame + frames}))],
      lowPassHz: [{frame: 0, value: plan.sampleRate / 2}, ...a.lowPassHz.map(p => ({...p, frame: p.frame + frames}))]});
    return {...plan, recipe: 'loop-extend', entryDelayFrames: frames, outgoingEffectSourceFrame: endFrame,
      loopExtension: {bars, startFrame, endFrame, frames}, automation: {outgoing: shift(normal.outgoing), incoming: normal.incoming},
      reasons: [...plan.reasons, 'One finite measured loop buys added clock time before B. PCM periodicity, energy and seam validation still required; vocal-free content is not established.']};
  }
  if (options.recipe !== 'loudness-match') return fallback('Unsupported beatmatched style.');
  const valid = (a: MixAnalysis): boolean => !!a.level && a.level.version === MIX_LEVEL_VERSION && a.level.sampleRate === a.sampleRate &&
    Number.isSafeInteger(a.level.startFrame) && a.level.startFrame >= 0 && Number.isSafeInteger(a.level.frames) && a.level.frames > 0 &&
    a.level.startFrame + a.level.frames <= a.frames && a.level.lufs !== null && Number.isFinite(a.level.lufs) && a.level.lufs >= -70 && a.level.lufs <= 60 &&
    a.level.frames <= a.sampleRate * SONG_ANALYSIS_WINDOW.seconds && a.level.frames * a.level.channels <= 16_777_216 &&
    (!a.analyzedWindow || a.level.startFrame >= a.analyzedWindow.startFrame &&
      a.level.startFrame + a.level.frames <= a.analyzedWindow.startFrame + a.analyzedWindow.frames) &&
    Number.isFinite(a.level.samplePeak) && a.level.samplePeak >= 0 && a.level.samplePeak <= 16 &&
    [1, 2].includes(a.level.channels) && !!a.nativePeak && a.nativePeak.version === 'native-sample-peak@1' && a.nativePeak.frames === a.frames &&
    Number.isFinite(a.nativePeak.value) && a.nativePeak.value > 0 && a.nativePeak.value <= 16 && a.nativePeak.value + 1e-7 >= a.level.samplePeak;
  if (!valid(from) || !valid(to)) return fallback('Level match needs measured bounded K-weighted levels and a full native sample-peak scan; silent/unknown levels refuse.');
  const fromGain = options.fromLevelGain ?? 1;
  const target = from.level!.lufs! + 20 * Math.log10(fromGain);
  const availablePower = LEVEL_MATCH_LIMITS.samplePeakCeiling ** 2 - (from.nativePeak!.value * fromGain) ** 2;
  if (availablePower <= 0) return fallback('A already consumes the loudness-match combined sample-peak ceiling; its audible gain is preserved.');
  const incomingPeakBudget = Math.sqrt(availablePower);
  const gain = Math.min(LEVEL_MATCH_LIMITS.maxGain, 10 ** ((target - to.level!.lufs!) / 20), incomingPeakBudget / to.nativePeak!.value);
  const levelMatch: LevelMatchPlan = {from: {...from.level!}, to: {...to.level!}, fromGain, toGain: gain,
    rawDeltaLu: to.level!.lufs! - from.level!.lufs!, beforeDeltaLu: to.level!.lufs! - target,
    matchedDeltaLu: to.level!.lufs! + 20 * Math.log10(gain) - target,
    nativeSamplePeak: to.nativePeak!.value, fromNativeSamplePeak: from.nativePeak!.value, incomingPeakBudget, ...LEVEL_MATCH_LIMITS};
  return {...plan, recipe: 'loudness-match', levelMatch, automation: crossfadeAutomation(plan.overlapFrames, plan.sampleRate),
    reasons: [...plan.reasons, 'K-weighted levels describe their bounded stereo/mono windows, not whole-song loudness. B gain is constant and bounded by native sample peak and +12 dB; residual mismatch is reported.']};
}

/** Validate derived data before it can become a native playback schedule. */
function validAnalysis(a: MixAnalysis, unknownKey = false): boolean {
  const window = a.analyzedWindow;
  const evidenceEnd = window ? window.startFrame + window.frames : a.frames;
  return Number.isSafeInteger(a.sampleRate) && a.sampleRate >= 8000 && a.sampleRate <= 192000 &&
    Number.isSafeInteger(a.frames) && a.frames > 0 &&
    (!a.level || Number.isFinite(a.level.samplePeak) && a.level.samplePeak >= 0 && a.level.samplePeak <= 16) &&
    (window ? window.policy === SONG_ANALYSIS_WINDOW.policy && Number.isSafeInteger(window.startFrame) && window.startFrame >= 0 &&
      Number.isSafeInteger(window.frames) && window.frames > 0 && evidenceEnd <= a.frames &&
      window.frames <= a.sampleRate * SONG_ANALYSIS_WINDOW.seconds && window.frames <= 16_777_216 : a.frames <= a.sampleRate * 180) &&
    a.tempo.bpm !== null && Number.isFinite(a.tempo.bpm) && a.tempo.bpm >= 60 && a.tempo.bpm <= 180 &&
    [a.tempo.confidence, a.tempo.ambiguity, a.beatGrid.confidence, a.key.confidence,
      a.structure.phraseConfidence].every(unit) &&
    ((a.key.tonic !== null && Number.isInteger(a.key.tonic) && a.key.tonic >= 0 && a.key.tonic < 12 &&
    (a.key.mode === 'major' || a.key.mode === 'minor')) ||
      unknownKey && a.key.tonic === null && a.key.mode === null) &&
    a.structure.assumed === true && a.structure.meter[0] === 4 && a.structure.meter[1] === 4 &&
    [...a.mixIn, ...a.mixOut].every(c => Number.isSafeInteger(c.frame) && c.frame >= (window?.startFrame ?? 0) && c.frame < evidenceEnd &&
      unit(c.score) && unit(c.confidence) && (!c.evidence ||
        ['boundary', 'low-interference', 'track-start'].includes(c.evidence.kind) &&
        [c.evidence.boundary, c.evidence.period, c.evidence.salience, c.evidence.interference].every(unit) &&
        Number.isSafeInteger(c.evidence.windowEndFrame) && c.evidence.windowEndFrame > c.frame &&
        c.evidence.windowEndFrame <= evidenceEnd && c.evidence.chroma.length === 12 &&
        c.evidence.chroma.every(unit))) &&
    (a.vocalSpans ?? []).every(s => Number.isSafeInteger(s.startFrame) && Number.isSafeInteger(s.endFrame) &&
      s.startFrame >= 0 && s.endFrame > s.startFrame && s.endFrame <= evidenceEnd);
}
function eligibleCues(cues: readonly MixPointCandidate[], low: number, high: number,
  spans: MixAnalysis['vocalSpans'] = []): MixPointCandidate[] {
  return cues.filter(c => c.frame >= low && c.frame <= high && c.confidence >= MIX_LIMITS.cueConfidence &&
    !spans.some(span => c.frame >= span.startFrame && c.frame < span.endFrame))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence || a.frame - b.frame);
}

/**
 * Pure proposal from two audio-derived analyses. No clock, media effects or fallback scheduling.
 * The player binds original identities and checks its exact clock again after processing B.
 */
function planBlend(from: MixAnalysis, to: MixAnalysis,
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
  // A precise grid at the wrong metrical level can still have high beat confidence.
  if (Math.max(from.tempo.ambiguity, to.tempo.ambiguity) > MIX_LIMITS.tempoAmbiguity) {
    return fallback('Tempo hypotheses are ambiguous despite grid confidence; retain the authored route.');
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
  if (tempoRatio < (options.recipe === 'tempo-ramp' ? 0.8 : MIX_LIMITS.tempoRatioMin) ||
    tempoRatio > (options.recipe === 'tempo-ramp' ? 1.25 : MIX_LIMITS.tempoRatioMax)) {
    return fallback(options.recipe === 'tempo-ramp' ? 'Native ramp ratio must stay within 0.8..1.25.' : 'Tempo match is outside the engineering limit of +/-8%.');
  }
  if (options.recipe === 'tempo-ramp' && tempoRatio >= 0.92 && tempoRatio <= 1.08) return fallback('Native ramp is for changes beyond static comfort (0.92..1.08); use a pitch-preserving blend here.');
  const a: TonalKey = {tonic: from.key.tonic!, mode: from.key.mode!};
  const b: TonalKey = {tonic: to.key.tonic!, mode: to.key.mode!};
  let pitchSemitones = options.pitchSemitones ?? 0;
  const relativePitch = 12 * Math.log2(tempoRatio), nativeShift = Math.round(relativePitch);
  if (options.recipe === 'tempo-ramp' && (pitchSemitones !== 0 || Math.abs(relativePitch - nativeShift) > 0.2)) return fallback('Native ramp needs relative detune within 0.2 semitone of a supported shifted key; independent pitch shifts are unsupported.');
  let harmonic = harmonicCompatibility(a, shifted(b, options.recipe === 'tempo-ramp' ? nativeShift : pitchSemitones));
  // Preserve the original key whenever it already has a supported relation.
  if (options.recipe !== 'tempo-ramp' && options.pitchSemitones === undefined && options.allowPitchShift && harmonic.score < 0.85) {
    const alternatives = [-2, -1, 1, 2].map(shift => ({shift, harmonic: harmonicCompatibility(a, shifted(b, shift))}))
      .sort((x, y) => (y.harmonic.score - Math.abs(y.shift) * 0.03) -
        (x.harmonic.score - Math.abs(x.shift) * 0.03) || Math.abs(x.shift) - Math.abs(y.shift) || x.shift - y.shift);
    const best = alternatives[0]!;
    if (best.harmonic.score > harmonic.score) { pitchSemitones = best.shift; harmonic = best.harmonic; }
  }
  if (harmonic.score < 0.85) return fallback('No supported harmonic relation within the selected pitch-shift policy.');
  const overlapFrames = Math.round(overlapBeats * 60 * from.sampleRate / fromBpm);
  const outgoing = eligibleCues(from.mixOut, minimum, from.frames - overlapFrames - 1, from.vocalSpans);
  // A four-beat linear tempo return consumes the mean of its endpoint rates.
  // Reserve that actual source budget plus one native B beat before ranking cues.
  const returnFrames = options.returnToOriginalTempo ? Math.round(4 * 60 * from.sampleRate / fromBpm) : 0;
  const tailSourceFrames = returnFrames * (tempoRatio + 1) / 2 + to.sampleRate * 60 / toBpm;
  const incoming = eligibleCues(to.mixIn, 0,
    to.frames - Math.ceil(overlapFrames * tempoRatio + tailSourceFrames) - 2, to.vocalSpans);
  if (!outgoing.length || !incoming.length) return fallback('No confident future mix points have enough audio for the overlap.');
  const candidates = outgoing.flatMap(out => incoming.map(into => {
    const eo = from.energyCurve.find(e => out.frame >= e.startFrame && out.frame < e.endFrame)?.rms ?? 0;
    const ei = to.energyCurve.find(e => into.frame >= e.startFrame && into.frame < e.endFrame)?.rms ?? 0;
    const mismatch = Math.abs(eo - ei) / Math.max(1e-8, eo + ei);
    const left = out.evidence, right = into.evidence;
    // Pair costs depend on both windows; standalone cue ranks cannot express them.
    const densityMismatch = left && right ? Math.abs(left.interference - right.interference) : 0;
    const tonalDistance = left && right ? left.chroma.reduce((sum, value, i) =>
      sum + Math.abs(value - right.chroma[(i - pitchSemitones + 12) % 12]!), 0) / 2 : 0;
    const alignedBoundaries = left && right ? Math.min(left.boundary, right.boundary) : 0;
    return {out, into, score: out.score + into.score - 0.15 * mismatch -
      0.15 * densityMismatch - 0.1 * tonalDistance + 0.15 * alignedBoundaries};
  })).sort((x, y) => y.score - x.score || x.out.frame - y.out.frame || x.into.frame - y.into.frame);
  const choice = candidates[0]!, cue = Math.min(choice.out.confidence, choice.into.confidence);
  return {kind: 'mix', recipe: 'blend', preRollFrames: 0, version: MIX_PLANNER_VERSION, sampleRate: from.sampleRate,
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

/** New recipes require explicit strong grid/cue evidence, independent of global harmony. */
function alternatePlans(from: MixAnalysis, to: MixAnalysis, options: MixPlannerOptions,
  recipe: 'cut' | 'echo-out' | 'brake'): AutomaticMixPlan[] {
  if (!validAnalysis(from, true) || !validAnalysis(to, true) || from.sampleRate !== to.sampleRate ||
      [from, to].some(a => a.tempo.confidence < MIX_LIMITS.tempoConfidence ||
        a.tempo.ambiguity > MIX_LIMITS.tempoAmbiguity || a.beatGrid.confidence < MIX_LIMITS.beatConfidence ||
        a.structure.phraseConfidence < MIX_LIMITS.phraseConfidence ||
        !unit(a.structure.downbeatConfidence) || a.structure.downbeatConfidence < 0.65)) return [];
  // These recipes preserve B's native mapping. Never silently discard a requested transform.
  if (options.pitchSemitones && options.pitchSemitones !== 0 || options.returnToOriginalTempo) return [];
  if (recipe === 'echo-out' && options.echoContentConfirmed !== true) return [];
  const rate = from.sampleRate, fromBpm = from.tempo.bpm!, toBpm = to.tempo.bpm!;
  const automation = recipe === 'echo-out' ? echoOutAutomation(fromBpm, rate) : cleanCutAutomation(rate);
  const preRollFrames = recipe === 'echo-out' ? echoOutAutomation(fromBpm, rate).preRollFrames : 0;
  const overlapFrames = automation.incoming.durationFrames;
  const minimum = (options.minimumFromFrame ?? 0) + preRollFrames;
  const strong = (a: MixAnalysis, c: MixPointCandidate, incoming: boolean): boolean => {
    const e = c.evidence;
    return !!e && c.confidence >= (recipe === 'brake' ? MIX_LIMITS.cueConfidence : 0.65) && a.structure.downbeatFrames.includes(c.frame) &&
      (incoming ? e.salience >= 0.65 && (e.boundary >= 0.6 || e.kind === 'track-start')
        : e.boundary >= 0.6) &&
      (recipe !== 'echo-out' || incoming || e.interference <= 0.35);
  };
  const outgoing = eligibleCues(from.mixOut, minimum, from.frames - overlapFrames, from.vocalSpans)
    .filter(c => strong(from, c, false) && (recipe !== 'echo-out' ||
      !(from.vocalSpans ?? []).some(s => s.startFrame < c.frame && s.endFrame > c.frame - preRollFrames))).slice(0, 3);
  const incoming = eligibleCues(to.mixIn, 0, to.frames - overlapFrames, to.vocalSpans)
    .filter(c => strong(to, c, true) && !(to.vocalSpans ?? []).some(s =>
      s.startFrame < c.frame + overlapFrames && s.endFrame > c.frame)).slice(0, 3);
  const knownKey = [from, to].every(a => a.key.confidence >= MIX_LIMITS.keyConfidence && a.key.tonic !== null);
  const harmonic: HarmonicCompatibility = knownKey ? harmonicCompatibility(
    {tonic: from.key.tonic!, mode: from.key.mode!}, {tonic: to.key.tonic!, mode: to.key.mode!}) :
    {fromCamelot: 'unknown', toCamelot: 'unknown', circleDistance: null, score: 0, relation: 'unknown'};
  return outgoing.flatMap(out => incoming.map(into => ({out, into})))
    .sort((a, b) => (b.out.score + b.into.score) - (a.out.score + a.into.score) ||
      a.out.frame - b.out.frame || a.into.frame - b.into.frame).slice(0, 2).map(({out, into}) => {
      const evidence = {tempo: Math.min(from.tempo.confidence, to.tempo.confidence),
        beat: Math.min(from.beatGrid.confidence, to.beatGrid.confidence),
        key: Math.min(from.key.confidence, to.key.confidence),
        phrase: Math.min(from.structure.phraseConfidence, to.structure.phraseConfidence),
        cue: Math.min(out.confidence, into.confidence)};
      return {kind: 'mix', version: MIX_PLANNER_VERSION, recipe, preRollFrames,
        ...(recipe === 'echo-out' ? {echoContentConfirmed: true} : {}),
        sampleRate: rate, fromFrames: from.frames, toFrames: to.frames,
        fromExitFrame: out.frame, toEntryFrame: into.frame, overlapFrames,
        overlapBeats: options.overlapBeats ?? 8, fromBpm, toBpm, tempoRatio: 1, pitchSemitones: 0,
        returnToOriginalTempo: false, harmonic, evidence,
        confidence: Math.min(evidence.tempo, evidence.beat, evidence.phrase, evidence.cue),
        automation: recipe === 'echo-out' ? echoOutAutomation(fromBpm, rate) : cleanCutAutomation(rate),
        reasons: ['Strong downbeat/cue evidence; native B entry, no key or tempo match required.',
          recipe === 'echo-out' ? 'Two-beat prelude; dry A and send close at T; two-bar owned tail. Content confirmation required; low density is not vocal detection.'
            : 'Strong standalone B cue; complementary 10 ms cut.',
          'Finite deterministic proposals only; rendered-quality evaluation and listening are not established.']};
    });
}
function validOptions(options: MixPlannerOptions): boolean {
  return (options.recipe === undefined || ['auto', 'blend', 'cut', 'echo-out', 'filter-sweep', 'loudness-match', 'tempo-ramp', 'loop-extend', 'brake'].includes(options.recipe)) &&
    (options.loopBars === undefined || [4, 8].includes(options.loopBars)) &&
    (options.fromLevelGain === undefined || Number.isFinite(options.fromLevelGain) && options.fromLevelGain > 0 && options.fromLevelGain <= LEVEL_MATCH_LIMITS.maxGain) &&
    (options.echoContentConfirmed === undefined || typeof options.echoContentConfirmed === 'boolean') &&
    (options.allowPitchShift === undefined || typeof options.allowPitchShift === 'boolean') &&
    (options.returnToOriginalTempo === undefined || typeof options.returnToOriginalTempo === 'boolean') &&
    Number.isSafeInteger(options.minimumFromFrame ?? 0) && (options.minimumFromFrame ?? 0) >= 0 &&
    [4, 8, 16].includes(options.overlapBeats ?? 8) &&
    (options.pitchSemitones === undefined || Number.isInteger(options.pitchSemitones) &&
      Math.abs(options.pitchSemitones) <= MIX_LIMITS.pitchSemitones);
}
/** At most five proposals (one blend, two echoes, two cuts); no evaluated-quality claim. */
export function automaticMixCandidates(from: MixAnalysis, to: MixAnalysis,
  options: MixPlannerOptions = {}): readonly AutomaticMixPlan[] {
  if (!validOptions(options)) return [];
  const recipes = options.recipe && options.recipe !== 'auto' ? [options.recipe] : ['blend', 'echo-out', 'cut'] as const;
  const plans: AutomaticMixPlan[] = [];
  for (const recipe of recipes) {
    if (recipe === 'brake') {
      const bases = alternatePlans(from, to, {...options, returnToOriginalTempo: false}, 'brake');
      for (const base of bases) {
        if (!nativeMotionPeak(from, options.fromLevelGain ?? 1) || !nativeMotionPeak(to)) continue;
        if (base.fromBpm / base.toBpm >= 0.8 && base.fromBpm / base.toBpm <= 1.25) continue;
        const frames = Math.round(Math.min(0.35, 30 / base.fromBpm) * base.sampleRate), handover = frames - Math.round(base.sampleRate * 0.02);
        const ramp = {start: 1, end: 0.05, frames};
        if (base.fromExitFrame + nativeRateInputAt(ramp, frames) >= from.frames) continue;
        const open = crossfadeAutomation(frames, base.sampleRate).outgoing;
        plans.push({...base, recipe: 'brake', preRollFrames: 0, entryDelayFrames: handover,
          outgoingEffectSourceFrame: base.fromExitFrame, overlapFrames: frames - handover,
          nativeRate: {outgoing: ramp, pitchMoves: true},
          automation: {outgoing: {...open, gain: [{frame: 0, value: 1}, {frame: handover - Math.round(base.sampleRate * 0.02), value: 1}, {frame: handover, value: 0.15}, {frame: frames, value: 0}]},
            incoming: crossfadeAutomation(frames - handover, base.sampleRate).incoming},
          reasons: ['Short finite native slowdown with pitch drop and gain fade; B enters on its measured downbeat before A closes. Shared-grid beat phase is unjudged.']});
      }
    } else if (isBeatmatchedRecipe(recipe) || recipe === 'tempo-ramp') {
      const blend = styledBlend(from, to, options);
      if (blend.kind === 'mix') plans.push(blend);
    } else if (recipe === 'cut' || recipe === 'echo-out') plans.push(...alternatePlans(from, to, options, recipe));
  }
  return plans.slice(0, MIX_CANDIDATE_LIMIT);
}
export function planAutomaticMix(from: MixAnalysis, to: MixAnalysis,
  options: MixPlannerOptions = {}): MixDecision {
  if (!validOptions(options)) return fallback('Invalid or unsupported mix recipe/options.');
  const candidates = automaticMixCandidates(from, to, options);
  if (candidates.length) return candidates[0]!;
  const blend = styledBlend(from, to, options);
  return blend.kind === 'fallback' ? blend : fallback('Selected recipe preconditions are not established.');
}

/** Plain Node/browser function: two recordings in, a deterministic proposal out. */
export function planMixFromAudio(from: MixPcm, to: MixPcm, options: MixPlannerOptions = {}): MixDecision {
  try { return planAutomaticMix(analyzeMixAudio(from), analyzeMixAudio(to), options); }
  catch (error) { return fallback(`Analysis unavailable: ${error instanceof Error ? error.message : String(error)}`); }
}
