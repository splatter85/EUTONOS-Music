import {analyzeMixAudio, evidenceSpan, MIX_LEVEL_VERSION, SONG_ANALYSIS_WINDOW, type MixAnalysis, type MixPcm, type MixPointCandidate, type MixLevelEvidence} from './mix-analysis.js';
import {bassSwapAutomation, cleanCutAutomation, crossfadeAutomation, filterSweepAutomation, echoOutAutomation, type MixAutomation} from './mix-automation.js';
import {nativeRateInputAt, type NativeRateRamp} from './time-pitch.js';
import {choreographyPlan, type ChoreographyParams} from '../web/eq-choreography.js';
import {ENTRY_POLICY, entrySkipCost} from '../web/transition-policy.js';

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
export type MixRecipe = 'blend' | 'cut' | 'echo-out' | 'filter-sweep' | 'loudness-match' | 'tempo-ramp' | 'loop-extend' | 'brake' | 'meet-in-middle';
/** WSOLA-rendered B entries. S21 `meet-in-middle` also ramps A's native rate to the meeting tempo. */
export const isBeatmatchedRecipe = (recipe: string): boolean => ['blend', 'filter-sweep', 'loudness-match', 'loop-extend', 'meet-in-middle'].includes(recipe);
export const MIX_OVERLAP_BEATS = Object.freeze([4, 8, 16, 32, 64, 128] as const);
export type MixOverlapBeats = typeof MIX_OVERLAP_BEATS[number];
/** S21 meet-in-middle: each deck within about 8%; A reaches the meeting tempo over two native bars. */
export const MEET_LIMITS = Object.freeze({maxDeckChange: 0.08, rampBars: 2, returnBars: Object.freeze([4, 8] as const)});
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
  readonly overlapBeats?: MixOverlapBeats;
  /** S21: EQ choreography for blend-family plans; its bar count sets the overlap. */
  readonly choreography?: ChoreographyParams;
  /** S21: `limited` lets a weak or distant key through with a short, mid-limited choreography. */
  readonly harmonicMode?: 'strict' | 'limited';
  /** S21: apply the entry skip cost and earlier-cue tie rule (default true). */
  readonly entryPolicy?: boolean;
  /** S21: a style that intentionally skips B content waives the skip cost. */
  readonly styleAllowsSkip?: boolean;
  /** S21 replay/explore: exact B entry frame, or the rank among eligible entries. */
  readonly toEntryFrame?: number;
  readonly entryRank?: number;
  /** S21 meet-in-middle meeting tempo (default the geometric mean). */
  readonly meetBpm?: number;
  /** S21 tempo return of a stretched B: bars and curve (default 1 bar linear, the S18 behaviour). */
  readonly tempoReturn?: {readonly bars: number; readonly curve: 'linear' | 'smoothstep'};
  /** S21 Auto: allow echo-out on measured low density alone (labelled; content not confirmed). */
  readonly echoHeuristic?: boolean;
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
  readonly overlapFrames: number; readonly overlapBeats: MixOverlapBeats;
  readonly fromBpm: number; readonly toBpm: number;
  readonly tempoRatio: number; readonly pitchSemitones: number;
  readonly returnToOriginalTempo: boolean;
  readonly levelMatch?: LevelMatchPlan;
  /** S is a native A anchor; T=S+entryDelayFrames. No virtual value replaces fromExitFrame. */
  readonly entryDelayFrames?: number;
  readonly outgoingEffectSourceFrame?: number;
  readonly nativeRate?: {readonly outgoing: NativeRateRamp; readonly incoming?: NativeRateRamp; readonly pitchMoves: true};
  readonly loopExtension?: {readonly bars: 4 | 8; readonly startFrame: number; readonly endFrame: number; readonly frames: number};
  /** S21: the EQ choreography whose lanes are in `automation`. */
  readonly choreography?: {readonly params: ChoreographyParams; readonly description: string; readonly bassOwnershipFrame: number; readonly harmonicLimited: boolean};
  /** S21: entry selection evidence for the readout and plan record. */
  readonly entry?: {readonly rank: number; readonly skippedFraction: number; readonly skipCost: number; readonly candidates: number};
  /** S21: B tempo return ramp in output frames (absent = S18 one-bar linear). */
  readonly tempoReturn?: {readonly rampFrames: number; readonly curve: 'linear' | 'smoothstep'};
  /** S21 meet-in-middle: the shared meeting tempo. */
  readonly meet?: {readonly bpm: number; readonly fromRate: number; readonly toRatio: number};
  /** S21: echo allowed by measured low density only (content not confirmed). */
  readonly echoHeuristic?: boolean;
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
  if (plan.kind === 'fallback' || !options.recipe || options.recipe === 'auto' || options.recipe === 'blend' || options.recipe === 'meet-in-middle') return plan;
  if (options.recipe === 'filter-sweep') {
    // S21: filter-sweep keeps its S19 shape; EQ choreography band lanes are not layered onto it.
    const {choreography: _sweepChoreo, ...sweepBase} = plan; // the sweep keeps its own S19 lanes
    return {...sweepBase, recipe: 'filter-sweep', automation: filterSweepAutomation(plan.overlapFrames, plan.sampleRate)};
  }
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
    if (from.structure.downbeatConfidence < 0.65 || startFrame === undefined || startFrame < evidenceSpan(from).start ||
      grid.slice(index - bars, index).some((f, i) => Math.abs(grid[index - bars + i + 1]! - f - barFrames) > barFrames * 0.02) ||
      (from.vocalSpans ?? []).some(s => s.startFrame < endFrame && s.endFrame > startFrame)) return fallback('Loop needs a measured 4/8-bar interval outside supplied vocal spans.');
    const frames = endFrame - startFrame, normal = crossfadeAutomation(plan.overlapFrames, plan.sampleRate);
    const shift = (a: MixAutomation): MixAutomation => ({...a, durationFrames: frames + a.durationFrames,
      gain: [{frame: 0, value: 1}, ...a.gain.map(p => ({...p, frame: p.frame + frames}))],
      lowShelfDb: [{frame: 0, value: 0}, ...a.lowShelfDb.map(p => ({...p, frame: p.frame + frames}))],
      highPassHz: [{frame: 0, value: 0}, ...a.highPassHz.map(p => ({...p, frame: p.frame + frames}))],
      lowPassHz: [{frame: 0, value: plan.sampleRate / 2}, ...a.lowPassHz.map(p => ({...p, frame: p.frame + frames}))]});
    const {choreography: _loopChoreo, ...loopBase} = plan; // the loop keeps its own crossfade lanes
    return {...loopBase, recipe: 'loop-extend', entryDelayFrames: frames, outgoingEffectSourceFrame: endFrame,
      loopExtension: {bars, startFrame, endFrame, frames}, automation: {outgoing: shift(normal.outgoing), incoming: normal.incoming},
      reasons: [...plan.reasons, 'One finite measured loop buys added clock time before B. PCM periodicity, energy and seam validation still required; vocal-free content is not established.']};
  }
  if (options.recipe !== 'loudness-match') return fallback('Unsupported beatmatched style.');
  const valid = (a: MixAnalysis): boolean => !!a.level && a.level.version === MIX_LEVEL_VERSION && a.level.sampleRate === a.sampleRate &&
    Number.isSafeInteger(a.level.startFrame) && a.level.startFrame >= 0 && Number.isSafeInteger(a.level.frames) && a.level.frames > 0 &&
    a.level.startFrame + a.level.frames <= a.frames && a.level.lufs !== null && Number.isFinite(a.level.lufs) && a.level.lufs >= -70 && a.level.lufs <= 60 &&
    a.level.frames <= a.sampleRate * SONG_ANALYSIS_WINDOW.seconds && a.level.frames * a.level.channels <= 16_777_216 &&
    [...(a.analyzedWindow ? [a.analyzedWindow] : []), ...(a.analyzedWindows ?? [])].every((w, _i, all) => all.some(x =>
      a.level!.startFrame >= x.startFrame && a.level!.startFrame + a.level!.frames <= x.startFrame + x.frames)) &&
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
  const {choreography: _levelChoreo, ...levelBase} = plan; // level match keeps its own crossfade lanes
  return {...levelBase, recipe: 'loudness-match', levelMatch, automation: crossfadeAutomation(plan.overlapFrames, plan.sampleRate),
    reasons: [...plan.reasons, 'K-weighted levels describe their bounded stereo/mono windows, not whole-song loudness. B gain is constant and bounded by native sample peak and +12 dB; residual mismatch is reported.']};
}

/** Validate derived data before it can become a native playback schedule. */
function validAnalysis(a: MixAnalysis, unknownKey = false): boolean {
  const window = a.analyzedWindow, merged = a.analyzedWindows;
  const span = evidenceSpan(a), evidenceEnd = span.end;
  const boundedWindow = (w: NonNullable<MixAnalysis['analyzedWindow']>): boolean => w.policy === SONG_ANALYSIS_WINDOW.policy &&
    Number.isSafeInteger(w.startFrame) && w.startFrame >= 0 && Number.isSafeInteger(w.frames) && w.frames > 0 &&
    w.startFrame + w.frames <= a.frames && w.frames <= a.sampleRate * SONG_ANALYSIS_WINDOW.seconds && w.frames <= 16_777_216;
  return Number.isSafeInteger(a.sampleRate) && a.sampleRate >= 8000 && a.sampleRate <= 192000 &&
    Number.isSafeInteger(a.frames) && a.frames > 0 &&
    (!a.level || Number.isFinite(a.level.samplePeak) && a.level.samplePeak >= 0 && a.level.samplePeak <= 16) &&
    (merged ? !window && merged.length >= 1 && merged.length <= 12 && merged.every(boundedWindow) &&
      merged.every((w, i) => i === 0 || w.startFrame > merged[i - 1]!.startFrame && w.startFrame <= merged[i - 1]!.startFrame + merged[i - 1]!.frames)
      : window ? boundedWindow(window) : a.frames <= a.sampleRate * 180) &&
    a.tempo.bpm !== null && Number.isFinite(a.tempo.bpm) && a.tempo.bpm >= 60 && a.tempo.bpm <= 180 &&
    [a.tempo.confidence, a.tempo.ambiguity, a.beatGrid.confidence, a.key.confidence,
      a.structure.phraseConfidence].every(unit) &&
    ((a.key.tonic !== null && Number.isInteger(a.key.tonic) && a.key.tonic >= 0 && a.key.tonic < 12 &&
    (a.key.mode === 'major' || a.key.mode === 'minor')) ||
      unknownKey && a.key.tonic === null && a.key.mode === null) &&
    a.structure.assumed === true && a.structure.meter[0] === 4 && a.structure.meter[1] === 4 &&
    [...a.mixIn, ...a.mixOut].every(c => Number.isSafeInteger(c.frame) && c.frame >= span.start && c.frame < evidenceEnd &&
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
  const minimum = options.minimumFromFrame ?? 0;
  const overlapBeats: MixOverlapBeats = options.choreography
    ? Math.min(128, Math.max(4, options.choreography.overlapBars * 4)) as MixOverlapBeats : options.overlapBeats ?? 8;
  if (!Number.isSafeInteger(minimum) || minimum < 0 || !(MIX_OVERLAP_BEATS as readonly number[]).includes(overlapBeats) ||
    options.choreography && !(MIX_OVERLAP_BEATS as readonly number[]).includes(options.choreography.overlapBars * 4)) {
    return fallback('Invalid mix window or overlap; retain the authored route.');
  }
  if (options.pitchSemitones !== undefined && (!Number.isInteger(options.pitchSemitones) ||
    Math.abs(options.pitchSemitones) > MIX_LIMITS.pitchSemitones)) {
    return fallback('Requested pitch shift is outside the engineering limit of +/-2 semitones.');
  }
  const limitedHarmony = options.harmonicMode === 'limited';
  if (!validAnalysis(from, limitedHarmony) || !validAnalysis(to, limitedHarmony) || from.sampleRate !== to.sampleRate) {
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
  // S21: rhythm recipes gate on the beat grid; a weak key only limits sustained harmonic overlap.
  if (evidence.tempo < MIX_LIMITS.tempoConfidence || evidence.beat < MIX_LIMITS.beatConfidence ||
      !limitedHarmony && evidence.key < MIX_LIMITS.keyConfidence || evidence.phrase < MIX_LIMITS.phraseConfidence) {
    return fallback('Audio analysis confidence is below the versioned mix thresholds.');
  }
  const fromBpm = from.tempo.bpm!, toBpm = to.tempo.bpm!;
  const meet = options.recipe === 'meet-in-middle';
  const meetBpm = meet ? options.meetBpm ?? Math.sqrt(fromBpm * toBpm) : fromBpm;
  if (meet && (!Number.isFinite(meetBpm) || meetBpm < Math.min(fromBpm, toBpm) || meetBpm > Math.max(fromBpm, toBpm) ||
    Math.abs(meetBpm / fromBpm - 1) > MEET_LIMITS.maxDeckChange + 1e-9 || Math.abs(meetBpm / toBpm - 1) > MEET_LIMITS.maxDeckChange + 1e-9)) {
    return fallback('Meet-in-the-middle needs each deck within 8% of the meeting tempo.');
  }
  if (meet && Math.abs(fromBpm / toBpm - 1) <= 0.08) return fallback('Meet-in-the-middle is for gaps beyond the 8% stretched blend.');
  // B's output/original tempo: A's tempo for a normal blend, the meeting tempo for meet-in-middle.
  const tempoRatio = meetBpm / toBpm;
  if (meet) { /* range checked above */ } else if (tempoRatio < (options.recipe === 'tempo-ramp' ? 0.8 : MIX_LIMITS.tempoRatioMin) ||
    tempoRatio > (options.recipe === 'tempo-ramp' ? 1.25 : MIX_LIMITS.tempoRatioMax)) {
    return fallback(options.recipe === 'tempo-ramp' ? 'Native ramp ratio must stay within 0.8..1.25.' : 'Tempo match is outside the engineering limit of +/-8%.');
  }
  if (options.recipe === 'tempo-ramp' && tempoRatio >= 0.92 && tempoRatio <= 1.08) return fallback('Native ramp is for changes beyond static comfort (0.92..1.08); use a pitch-preserving blend here.');
  const keysKnown = from.key.tonic !== null && to.key.tonic !== null && evidence.key >= MIX_LIMITS.keyConfidence;
  const a: TonalKey = {tonic: from.key.tonic ?? 0, mode: from.key.mode ?? 'major'};
  const b: TonalKey = {tonic: to.key.tonic ?? 0, mode: to.key.mode ?? 'major'};
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
  if (!keysKnown) harmonic = {fromCamelot: 'unknown', toCamelot: 'unknown', circleDistance: null, score: 0, relation: 'unknown'};
  const harmonicLimited = !keysKnown || harmonic.score < 0.85;
  if (harmonicLimited && !limitedHarmony) return fallback('No supported harmonic relation within the selected pitch-shift policy.');
  if (harmonicLimited && options.choreography && !['mid-carve', 'bass-drop-handover'].includes(options.choreography.name)) {
    return fallback('A weak or distant key allows only a mid-carve or bass-drop handover (no sustained harmonic overlap).');
  }
  if (harmonicLimited && !options.choreography) return fallback('A weak or distant key needs a mid-limited choreography.');
  // Shared tempo during the overlap: A's own for a blend, the meeting tempo for meet-in-middle.
  const sharedBpm = meet ? meetBpm : fromBpm;
  const overlapFrames = Math.round(overlapBeats * 60 * from.sampleRate / sharedBpm);
  const fromRate = meetBpm / fromBpm;
  const rampFrames = meet ? Math.round(MEET_LIMITS.rampBars * 4 * 60 * from.sampleRate / fromBpm * 2 / (1 + fromRate)) : 0;
  const aNeeds = meet ? Math.ceil(nativeRateInputAt({start: 1, end: fromRate, frames: rampFrames}, rampFrames + overlapFrames)) : overlapFrames;
  const outgoing = eligibleCues(from.mixOut, minimum, from.frames - aNeeds - 1, from.vocalSpans);
  // A tempo return (linear or smoothstep) consumes the mean of its endpoint rates.
  // Reserve that actual source budget plus one native B beat before ranking cues.
  const returnBars = options.tempoReturn?.bars ?? 1;
  const returnFrames = options.returnToOriginalTempo ? Math.round(returnBars * 4 * 60 * from.sampleRate / sharedBpm) : 0;
  const tailSourceFrames = returnFrames * (tempoRatio + 1) / 2 + to.sampleRate * 60 / toBpm;
  let incoming = eligibleCues(to.mixIn, 0,
    to.frames - Math.ceil(overlapFrames * tempoRatio + tailSourceFrames) - 2, to.vocalSpans);
  if (options.toEntryFrame !== undefined) incoming = incoming.filter(c => c.frame === options.toEntryFrame);
  if (!outgoing.length || !incoming.length) return fallback('No confident future mix points have enough audio for the overlap.');
  const entryPolicy = options.entryPolicy !== false;
  const pairs = outgoing.flatMap(out => incoming.map(into => {
    const eo = from.energyCurve.find(e => out.frame >= e.startFrame && out.frame < e.endFrame)?.rms ?? 0;
    const ei = to.energyCurve.find(e => into.frame >= e.startFrame && into.frame < e.endFrame)?.rms ?? 0;
    const mismatch = Math.abs(eo - ei) / Math.max(1e-8, eo + ei);
    const left = out.evidence, right = into.evidence;
    // Pair costs depend on both windows; standalone cue ranks cannot express them.
    const densityMismatch = left && right ? Math.abs(left.interference - right.interference) : 0;
    const tonalDistance = left && right ? left.chroma.reduce((sum, value, i) =>
      sum + Math.abs(value - right.chroma[(i - pitchSemitones + 12) % 12]!), 0) / 2 : 0;
    const alignedBoundaries = left && right ? Math.min(left.boundary, right.boundary) : 0;
    const raw = out.score + into.score - 0.15 * mismatch - 0.15 * densityMismatch - 0.1 * tonalDistance + 0.15 * alignedBoundaries;
    const skip = entryPolicy ? entrySkipCost(into.frame, to.frames, options.styleAllowsSkip) : 0;
    return {out, into, raw, skip, score: raw - skip};
  }));
  const best = Math.max(...pairs.map(p => p.score));
  // S21 tie rule: within about 10 points of the best, the earlier B entry wins.
  const near = (p: typeof pairs[number]): boolean => entryPolicy && p.score >= best - ENTRY_POLICY.tieWindow;
  const candidates = pairs.sort((x, y) => Number(near(y)) - Number(near(x)) ||
    (near(x) && near(y) ? x.into.frame - y.into.frame : 0) || y.score - x.score || x.out.frame - y.out.frame || x.into.frame - y.into.frame);
  const entries = [...new Set(candidates.map(c => c.into.frame))];
  const rank = Math.max(0, Math.min(entries.length - 1, options.entryRank ?? 0));
  const choice = candidates.find(c => c.into.frame === entries[rank])!, cue = Math.min(choice.out.confidence, choice.into.confidence);
  let automation = bassSwapAutomation(overlapFrames, from.sampleRate);
  let choreography: AutomaticMixPlan['choreography'];
  if (options.choreography) {
    const barFrames = 4 * 60 * from.sampleRate / sharedBpm;
    const plan = choreographyPlan(options.choreography, barFrames, from.sampleRate);
    if (plan.durationFrames !== overlapFrames) return fallback('Choreography length does not match the overlap.');
    const neutral = (d: number) => ({durationFrames: d, lowShelfDb: [{frame: 0, value: 0}, {frame: d, value: 0}],
      highPassHz: [{frame: 0, value: 0}, {frame: d, value: 0}], lowPassHz: [{frame: 0, value: from.sampleRate / 2}, {frame: d, value: from.sampleRate / 2}]});
    automation = {outgoing: {...neutral(overlapFrames), gain: plan.outgoing.gain, bands: plan.outgoing.bands},
      incoming: {...neutral(overlapFrames), gain: plan.incoming.gain, bands: plan.incoming.bands,
        ...(plan.declaredGaps.length ? {declaredGaps: plan.declaredGaps} : {})}};
    choreography = {params: plan.params, description: plan.description, bassOwnershipFrame: plan.bassOwnershipFrame, harmonicLimited};
  }
  const entryCount = entries.length;
  let result: AutomaticMixPlan = {kind: 'mix', recipe: 'blend', preRollFrames: 0, version: MIX_PLANNER_VERSION, sampleRate: from.sampleRate,
    fromFrames: from.frames, toFrames: to.frames, fromExitFrame: choice.out.frame, toEntryFrame: choice.into.frame,
    overlapFrames, overlapBeats, fromBpm, toBpm, tempoRatio, pitchSemitones,
    returnToOriginalTempo: options.returnToOriginalTempo ?? false,
    confidence: Math.min(evidence.tempo, evidence.beat, harmonicLimited ? 1 : evidence.key, cue, evidence.phrase), evidence: {...evidence, cue},
    harmonic, automation,
    ...(choreography ? {choreography} : {}),
    entry: {rank, skippedFraction: choice.into.frame / to.frames, skipCost: choice.skip, candidates: entryCount},
    ...(options.returnToOriginalTempo && options.tempoReturn ? {tempoReturn: {rampFrames: returnFrames, curve: options.tempoReturn.curve}} : {}),
    reasons: ['Audio-derived cue and beat hypotheses; 4/4 and four-bar phrasing are assumed.',
      keysKnown ? `Harmonic candidate: ${harmonic.fromCamelot} -> ${harmonic.toCamelot} (${harmonic.relation}).` : 'Key evidence is weak; harmonic overlap is limited by the choreography.',
      choreography ? `EQ choreography ${choreography.params.name} over ${choreography.params.overlapBars} bars.` : 'Bass attenuation and complementary gain curves are scheduled on the existing clock.',
      `B enters at ${(choice.into.frame / to.sampleRate).toFixed(1)} s (${Math.round(100 * choice.into.frame / to.frames)}% into the song; skip cost ${choice.skip.toFixed(2)}).`,
      'Global key does not prove local chord/vocal compatibility. Listening is untested.']};
  if (meet) {
    // A ramps to the meeting tempo over two native bars, then B enters on A's next downbeat.
    const ramp: NativeRateRamp = {start: 1, end: fromRate, frames: rampFrames};
    const shift = (lanes: MixAutomation): MixAutomation => {
      const move = (pts: MixAutomation['gain'], first: number) => [{frame: 0, value: first}, ...pts.map(p => ({...p, frame: p.frame + rampFrames}))];
      return {...lanes, durationFrames: rampFrames + lanes.durationFrames, gain: move(lanes.gain, lanes.gain[0]!.value),
        lowShelfDb: move(lanes.lowShelfDb, 0), highPassHz: move(lanes.highPassHz, 0), lowPassHz: move(lanes.lowPassHz, from.sampleRate / 2),
        ...(lanes.bands ? {bands: {low: move(lanes.bands.low, lanes.bands.low[0]!.value), mid: move(lanes.bands.mid, lanes.bands.mid[0]!.value),
          high: move(lanes.bands.high, lanes.bands.high[0]!.value)}} : {})};
    };
    result = {...result, recipe: 'meet-in-middle', entryDelayFrames: rampFrames, outgoingEffectSourceFrame: choice.out.frame,
      nativeRate: {outgoing: ramp, pitchMoves: true},
      meet: {bpm: meetBpm, fromRate, toRatio: tempoRatio},
      automation: {outgoing: shift(automation.outgoing), incoming: automation.incoming},
      reasons: [...result.reasons, `Both decks meet at ${meetBpm.toFixed(1)} BPM: A's native rate ramps ${((fromRate - 1) * 100).toFixed(1)}% over two bars (its pitch moves), B is time-stretched ${((tempoRatio - 1) * 100).toFixed(1)}% and returns to its own tempo afterwards.`]};
  }
  return result;
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
  const heuristicEcho = recipe === 'echo-out' && options.echoContentConfirmed !== true && options.echoHeuristic === true;
  if (recipe === 'echo-out' && options.echoContentConfirmed !== true && !heuristicEcho) return [];
  const rate = from.sampleRate, fromBpm = from.tempo.bpm!, toBpm = to.tempo.bpm!;
  const automation = recipe === 'echo-out' ? echoOutAutomation(fromBpm, rate) : cleanCutAutomation(rate);
  const preRollFrames = recipe === 'echo-out' ? echoOutAutomation(fromBpm, rate).preRollFrames : 0;
  const overlapFrames = automation.incoming.durationFrames;
  const minimum = (options.minimumFromFrame ?? 0) + preRollFrames;
  const strong = (a: MixAnalysis, c: MixPointCandidate, incoming: boolean): boolean => {
    const e = c.evidence;
    // S21 heuristic echo: measured low density at A's exit and a phrase-aligned B downbeat suffice;
    // the B entry need not be a strong boundary because A's echo, not an overlap, carries it.
    if (heuristicEcho) return !!e && c.confidence >= MIX_LIMITS.cueConfidence && a.structure.downbeatFrames.includes(c.frame) &&
      (incoming ? e.salience >= 0.4 && a.structure.phraseFrames.includes(c.frame) : e.interference <= 0.5);
    return !!e && c.confidence >= (recipe === 'brake' ? MIX_LIMITS.cueConfidence : 0.65) && a.structure.downbeatFrames.includes(c.frame) &&
      (incoming ? e.salience >= 0.65 && (e.boundary >= 0.6 || e.kind === 'track-start')
        : e.boundary >= 0.6) &&
      (recipe !== 'echo-out' || incoming || e.interference <= 0.35);
  };
  const outgoing = eligibleCues(from.mixOut, minimum, from.frames - overlapFrames, from.vocalSpans)
    .filter(c => strong(from, c, false) && (recipe !== 'echo-out' ||
      !(from.vocalSpans ?? []).some(s => s.startFrame < c.frame && s.endFrame > c.frame - preRollFrames))).slice(0, 3);
  const incomingAll = eligibleCues(to.mixIn, 0, to.frames - overlapFrames, to.vocalSpans)
    .filter(c => strong(to, c, true) && !(to.vocalSpans ?? []).some(s =>
      s.startFrame < c.frame + overlapFrames && s.endFrame > c.frame) &&
      (options.toEntryFrame === undefined || c.frame === options.toEntryFrame));
  // S21: skip cost and the earlier-entry tie rule also order native-entry recipes.
  const adjusted = (c: MixPointCandidate): number => c.score - (options.entryPolicy === false ? 0 : entrySkipCost(c.frame, to.frames, options.styleAllowsSkip));
  const topIn = incomingAll.length ? Math.max(...incomingAll.map(adjusted)) : 0;
  const incoming = [...incomingAll].sort((x, y) => {
    const nx = options.entryPolicy !== false && adjusted(x) >= topIn - ENTRY_POLICY.tieWindow, ny = options.entryPolicy !== false && adjusted(y) >= topIn - ENTRY_POLICY.tieWindow;
    return Number(ny) - Number(nx) || (nx && ny ? x.frame - y.frame : adjusted(y) - adjusted(x)) || x.frame - y.frame;
  }).slice(0, 3);
  const knownKey = [from, to].every(a => a.key.confidence >= MIX_LIMITS.keyConfidence && a.key.tonic !== null);
  const harmonic: HarmonicCompatibility = knownKey ? harmonicCompatibility(
    {tonic: from.key.tonic!, mode: from.key.mode!}, {tonic: to.key.tonic!, mode: to.key.mode!}) :
    {fromCamelot: 'unknown', toCamelot: 'unknown', circleDistance: null, score: 0, relation: 'unknown'};
  return outgoing.flatMap(out => incoming.map((into, entryOrder) => ({out, into, entryOrder})))
    .sort((a, b) => a.entryOrder - b.entryOrder || b.out.score - a.out.score ||
      a.out.frame - b.out.frame || a.into.frame - b.into.frame).slice(0, 2).map(({out, into}) => {
      const evidence = {tempo: Math.min(from.tempo.confidence, to.tempo.confidence),
        beat: Math.min(from.beatGrid.confidence, to.beatGrid.confidence),
        key: Math.min(from.key.confidence, to.key.confidence),
        phrase: Math.min(from.structure.phraseConfidence, to.structure.phraseConfidence),
        cue: Math.min(out.confidence, into.confidence)};
      return {kind: 'mix', version: MIX_PLANNER_VERSION, recipe, preRollFrames,
        ...(recipe === 'echo-out' ? {echoContentConfirmed: !heuristicEcho} : {}),
        ...(heuristicEcho ? {echoHeuristic: true} : {}),
        entry: {rank: incoming.indexOf(into), skippedFraction: into.frame / to.frames,
          skipCost: options.entryPolicy === false ? 0 : entrySkipCost(into.frame, to.frames, options.styleAllowsSkip), candidates: incoming.length},
        sampleRate: rate, fromFrames: from.frames, toFrames: to.frames,
        fromExitFrame: out.frame, toEntryFrame: into.frame, overlapFrames,
        overlapBeats: Math.min(16, options.overlapBeats ?? 8) as MixOverlapBeats, fromBpm, toBpm, tempoRatio: 1, pitchSemitones: 0,
        returnToOriginalTempo: false, harmonic, evidence,
        confidence: Math.min(evidence.tempo, evidence.beat, evidence.phrase, evidence.cue),
        automation: recipe === 'echo-out' ? echoOutAutomation(fromBpm, rate) : cleanCutAutomation(rate),
        reasons: ['Strong downbeat/cue evidence; native B entry, no key or tempo match required.',
          recipe === 'echo-out' ? (heuristicEcho ? 'Two-beat prelude; dry A and send close at T; two-bar owned tail. Allowed by measured low density only: content is NOT confirmed and low density is not vocal detection.'
            : 'Two-beat prelude; dry A and send close at T; two-bar owned tail. Content confirmation required; low density is not vocal detection.')
            : 'Strong standalone B cue; complementary 10 ms cut.',
          'Finite deterministic proposals only; rendered-quality evaluation and listening are not established.']};
    });
}
function validOptions(options: MixPlannerOptions): boolean {
  return (options.recipe === undefined || ['auto', 'blend', 'cut', 'echo-out', 'filter-sweep', 'loudness-match', 'tempo-ramp', 'loop-extend', 'brake', 'meet-in-middle'].includes(options.recipe)) &&
    (options.toEntryFrame === undefined || Number.isSafeInteger(options.toEntryFrame) && options.toEntryFrame >= 0) &&
    (options.entryRank === undefined || Number.isSafeInteger(options.entryRank) && options.entryRank >= 0 && options.entryRank < 8) &&
    (options.tempoReturn === undefined || Number.isInteger(options.tempoReturn.bars) && options.tempoReturn.bars >= 1 && options.tempoReturn.bars <= 8 &&
      ['linear', 'smoothstep'].includes(options.tempoReturn.curve)) &&
    (options.harmonicMode === undefined || ['strict', 'limited'].includes(options.harmonicMode)) &&
    (options.loopBars === undefined || [4, 8].includes(options.loopBars)) &&
    (options.fromLevelGain === undefined || Number.isFinite(options.fromLevelGain) && options.fromLevelGain > 0 && options.fromLevelGain <= LEVEL_MATCH_LIMITS.maxGain) &&
    (options.echoContentConfirmed === undefined || typeof options.echoContentConfirmed === 'boolean') &&
    (options.allowPitchShift === undefined || typeof options.allowPitchShift === 'boolean') &&
    (options.returnToOriginalTempo === undefined || typeof options.returnToOriginalTempo === 'boolean') &&
    Number.isSafeInteger(options.minimumFromFrame ?? 0) && (options.minimumFromFrame ?? 0) >= 0 &&
    (MIX_OVERLAP_BEATS as readonly number[]).includes(options.overlapBeats ?? 8) &&
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
        // S21: brake is a reset for gaps of 16% and more (previously only beyond 0.8..1.25).
        if (Math.max(base.fromBpm, base.toBpm) / Math.min(base.fromBpm, base.toBpm) < 1.16) continue;
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
