/**
 * Bar grid for editing tools (Music Studio snap-to-bars, EMS-S03).
 *
 * It reuses the DJ analysis (`analyzeMixAudio`) for the tempo hypothesis and downbeat phase,
 * then fine-tunes one constant-tempo grid against an onset envelope of the whole file.
 * The fine-tuning matters because the DJ grid is coarse: a 124 BPM generated song can read
 * as 125.0 BPM, which drifts by more than half a second over 78 seconds.
 *
 * The output contract (`eutonos.bar-grid.v1`) is what callers depend on. Internals may be
 * replaced by better analysis (EMF-S15) as long as the contract holds.
 *
 * Constant tempo and a fixed meter are assumptions, suited to generated music with a
 * requested BPM. Confidence values are engineering evidence, not calibrated probabilities.
 */
import {analyzeMixAudio, MIX_ANALYSIS_LIMITS, MIX_ANALYSIS_VERSION, type MixPcm} from './mix-analysis.js';

export const BAR_GRID_PROFILE = 'eutonos.bar-grid.v1' as const;
export const BAR_GRID_LIMITS = Object.freeze({
  maxSeconds: 1200, minBpm: 40, maxBpm: 220, searchFraction: 0.03,
  minDownbeatConfidence: 0.15, beatsPerBar: [2, 3, 4, 6, 7] as readonly number[],
});

export interface BarGridOptions {
  /** The tempo the music was requested at, if known. Used as the centre of the fine search. */
  readonly bpmHint?: number | null;
  readonly beatsPerBar?: number;
}

export interface BarGrid {
  readonly profile: typeof BAR_GRID_PROFILE;
  readonly analysis_version: typeof MIX_ANALYSIS_VERSION;
  readonly seconds: number;
  readonly sample_rate: number;
  readonly tempo: {
    readonly bpm: number;
    readonly analysis_bpm: number | null;
    readonly hint_bpm: number | null;
    readonly source: 'hint-refined' | 'analysis-refined';
    readonly confidence: number;
    readonly fit: number;
  };
  readonly beats_per_bar: number;
  readonly first_beat: number;
  readonly beat_seconds: number;
  readonly downbeat: {
    readonly confidence: number;
    readonly source: 'analysis' | 'first-beat';
    readonly offset_beats: number;
  };
  readonly beats: readonly number[];
  readonly bars: readonly number[];
  readonly warnings: readonly string[];
}

const HOP_SECONDS = 0.005;
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Half-wave-rectified log-energy rise per 5 ms hop (a simple onset strength). */
function onsetEnvelope(input: MixPcm, frames: number): {env: Float64Array; hop: number} {
  const hop = Math.max(1, Math.round(input.sampleRate * HOP_SECONDS));
  const win = hop * 4, count = Math.max(0, Math.floor((frames - win) / hop) + 1);
  const energy = new Float64Array(count);
  for (let k = 0; k < count; k++) {
    let sum = 0;
    const start = k * hop;
    for (const ch of input.channels) for (let i = start; i < start + win; i++) sum += ch[i]! * ch[i]!;
    energy[k] = Math.log10(sum / (win * input.channels.length) + 1e-10);
  }
  const env = new Float64Array(count);
  for (let k = 1; k < count; k++) env[k] = Math.max(0, energy[k]! - energy[k - 1]!);
  // Remove a slow local mean so loud sections do not dominate the fit.
  const radius = Math.round(0.5 / HOP_SECONDS), out = new Float64Array(count);
  let acc = 0;
  for (let k = 0; k < Math.min(count, radius); k++) acc += env[k]!;
  for (let k = 0; k < count; k++) {
    const add = k + radius, drop = k - radius - 1;
    if (add < count) acc += env[add]!;
    if (drop >= 0) acc -= env[drop]!;
    const n = Math.min(count - 1, k + radius) - Math.max(0, k - radius) + 1;
    out[k] = Math.max(0, env[k]! - acc / n);
  }
  return {env: out, hop};
}

function sampleAt(env: Float64Array, position: number): number {
  const i = Math.floor(position);
  if (i < 0 || i + 1 >= env.length) return 0;
  const f = position - i;
  return env[i]! * (1 - f) + env[i + 1]! * f;
}

/** Best (period, phase) in hops for a constant grid, searching periods around `centreBpm`. */
function fitGrid(env: Float64Array, hop: number, sampleRate: number, centreBpm: number) {
  const hopsPerSecond = sampleRate / hop;
  const score = (period: number, phase: number) => {
    const beats = Math.floor((env.length - phase) / period);
    if (beats < 4) return 0;
    let sum = 0;
    for (let b = 0; b < beats; b++) sum += sampleAt(env, phase + b * period);
    return sum / beats;
  };
  // Coarse pass over the whole search range, then a fine pass around the best candidate.
  const lo = centreBpm * (1 - BAR_GRID_LIMITS.searchFraction), hi = centreBpm * (1 + BAR_GRID_LIMITS.searchFraction);
  let best = {score: -1, bpm: centreBpm, phase: 0}, total = 0, n = 0;
  for (let bpm = lo; bpm <= hi + 1e-9; bpm += 0.05) {
    const period = (60 / bpm) * hopsPerSecond;
    for (let phase = 0; phase < period; phase += 1) {
      const s = score(period, phase);
      total += s; n++;
      if (s > best.score) best = {score: s, bpm, phase};
    }
  }
  const coarse = best;
  for (let bpm = coarse.bpm - 0.1; bpm <= coarse.bpm + 0.1 + 1e-9; bpm += 0.005) {
    const period = (60 / bpm) * hopsPerSecond;
    for (let phase = Math.max(0, coarse.phase - 6); phase <= coarse.phase + 6; phase += 0.25) {
      const s = score(period, phase);
      if (s > best.score) best = {score: s, bpm, phase};
    }
  }
  return {score: best.score, period: (60 / best.bpm) * hopsPerSecond, phase: best.phase, mean: n ? total / n : 0};
}

/** Builds the bar grid. Throws on input outside the documented limits. */
export function barGrid(input: MixPcm, options: BarGridOptions = {}): BarGrid {
  const {sampleRate, channels} = input;
  const frames = channels[0]?.length ?? 0;
  if (!channels.length || channels.some(ch => ch.length !== frames)) throw new Error('channels must be non-empty and equal length');
  if (!Number.isFinite(sampleRate) || sampleRate < MIX_ANALYSIS_LIMITS.minSampleRate || sampleRate > MIX_ANALYSIS_LIMITS.maxSampleRate) {
    throw new Error(`sample rate must be ${MIX_ANALYSIS_LIMITS.minSampleRate}-${MIX_ANALYSIS_LIMITS.maxSampleRate} Hz`);
  }
  const seconds = frames / sampleRate;
  if (seconds < 4) throw new Error('audio must be at least 4 seconds long');
  if (seconds > BAR_GRID_LIMITS.maxSeconds) throw new Error(`audio must be at most ${BAR_GRID_LIMITS.maxSeconds} seconds long`);
  const beatsPerBar = options.beatsPerBar ?? 4;
  if (!BAR_GRID_LIMITS.beatsPerBar.includes(beatsPerBar)) throw new Error(`beats per bar must be one of ${BAR_GRID_LIMITS.beatsPerBar.join(', ')}`);
  const hint = options.bpmHint ?? null;
  if (hint !== null && !(Number.isFinite(hint) && hint >= BAR_GRID_LIMITS.minBpm && hint <= BAR_GRID_LIMITS.maxBpm)) {
    throw new Error(`bpm hint must be ${BAR_GRID_LIMITS.minBpm}-${BAR_GRID_LIMITS.maxBpm}`);
  }
  const warnings: string[] = [];

  // The DJ analysis is bounded to 180 s; analyse the opening and extend the fitted grid.
  const analysedFrames = Math.min(frames, Math.floor(MIX_ANALYSIS_LIMITS.maxSeconds * sampleRate),
    Math.floor(MIX_ANALYSIS_LIMITS.maxChannelSamples / channels.length));
  if (analysedFrames < frames) warnings.push(`Tempo and downbeat analysis used the first ${round4(analysedFrames / sampleRate)} s; the grid is extended at constant tempo.`);
  const analysis = analyzeMixAudio({sampleRate, channels: channels.map(ch => ch.subarray(0, analysedFrames))});
  const analysisBpm = analysis.tempo.bpm;

  let centre = hint ?? analysisBpm;
  if (centre === null) throw new Error('no tempo found: pass a bpm hint');
  if (hint !== null && analysisBpm !== null) {
    const ratio = analysisBpm / hint;
    if (Math.abs(ratio - 1) > BAR_GRID_LIMITS.searchFraction) {
      warnings.push(`The analysis tempo (${round4(analysisBpm)} BPM) differs from the hint (${hint} BPM) by more than ${BAR_GRID_LIMITS.searchFraction * 100}%; the grid follows the hint.`);
    }
  }
  const {env, hop} = onsetEnvelope(input, frames);
  const fit = fitGrid(env, hop, sampleRate, centre);
  const beatSeconds = fit.period * hop / sampleRate;
  let firstBeat = fit.phase * hop / sampleRate + (hop * 2) / sampleRate; // centre of the 4-hop window
  while (firstBeat - beatSeconds >= -0.02) firstBeat -= beatSeconds;
  if (firstBeat < 0) firstBeat = Math.max(0, firstBeat);
  const beats: number[] = [];
  for (let t = firstBeat; t < seconds; t += beatSeconds) beats.push(round4(t));

  // Downbeat phase: vote with the analysis downbeats that fall in the first 30 s.
  let offset = 0, source: 'analysis' | 'first-beat' = 'first-beat';
  const downbeatConfidence = analysis.structure.downbeatConfidence;
  const early = analysis.structure.downbeatFrames.map(f => f / sampleRate).filter(t => t < 30);
  // The DJ analysis assumes 4/4 downbeats, so its vote only means something for 4 beats per bar.
  if (beatsPerBar === 4 && downbeatConfidence >= BAR_GRID_LIMITS.minDownbeatConfidence && early.length) {
    const votes = new Array<number>(beatsPerBar).fill(0);
    for (const t of early) {
      const index = Math.round((t - firstBeat) / beatSeconds);
      votes[((index % beatsPerBar) + beatsPerBar) % beatsPerBar]! += 1;
    }
    offset = votes.indexOf(Math.max(...votes));
    source = 'analysis';
  } else if (beatsPerBar !== 4) {
    warnings.push(`Downbeats are only detected for 4 beats per bar; with ${beatsPerBar}, bar 1 starts on the first detected beat.`);
  } else {
    warnings.push('Downbeat confidence is low; bar 1 starts on the first detected beat.');
  }
  const bars = beats.filter((_, i) => i >= offset && (i - offset) % beatsPerBar === 0);
  const fitRatio = fit.mean > 0 ? fit.score / fit.mean : 0;
  if (fitRatio < 1.5) warnings.push('The beat grid fits the onsets weakly; check bar lines by ear.');

  return {
    profile: BAR_GRID_PROFILE, analysis_version: MIX_ANALYSIS_VERSION,
    seconds: round4(seconds), sample_rate: sampleRate,
    tempo: {
      bpm: round4(60 / beatSeconds), analysis_bpm: analysisBpm === null ? null : round4(analysisBpm), hint_bpm: hint,
      source: hint !== null ? 'hint-refined' : 'analysis-refined',
      confidence: round4(analysis.tempo.confidence), fit: round4(fitRatio),
    },
    beats_per_bar: beatsPerBar, first_beat: round4(firstBeat), beat_seconds: round4(beatSeconds),
    downbeat: {confidence: round4(downbeatConfidence), source, offset_beats: offset},
    beats, bars, warnings,
  };
}
