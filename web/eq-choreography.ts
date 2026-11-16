/**
 * EMF-S21 Part A: three-band EQ choreography. Plan data and pure DSP math only; no clock.
 *
 * The split is a Linkwitz-Riley 4th-order (LR4) three-band crossover built from cascaded
 * second-order Butterworth biquads (Q = 1/sqrt(2)). Band paths:
 *   low  = AP(f2) * LP(f1)^2      (all-pass compensation at f2 keeps the sum phase-coherent)
 *   mid  = HP(f1)^2 * LP(f2)^2
 *   high = HP(f1)^2 * HP(f2)^2
 * LP^2 + HP^2 at one frequency equals a 2nd-order all-pass with the same Q, and the bilinear
 * transform preserves that identity, so the unity-gain sum is AP(f1) * AP(f2): flat magnitude.
 * Choreographies are named starting vocabularies, not listening-qualified results.
 */
import type {MixAutomationPoint} from '../src/mix-automation.js';

export const EQ_SPLIT = Object.freeze({version: 'lr4-three-band@1' as const, lowMidHz: 160, midHighHz: 3500, q: Math.SQRT1_2});
export type EqBand = 'low' | 'mid' | 'high';
export const EQ_BANDS: readonly EqBand[] = Object.freeze(['low', 'mid', 'high'] as const);
/** [b0, b1, b2, a1, a2], a0 normalized to 1 (Audio EQ Cookbook forms, linear Q). */
export type BiquadCoefficients = readonly [number, number, number, number, number];

const check = (ok: unknown, why: string): void => { if (!ok) throw new Error(why); };
function normalized(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): BiquadCoefficients {
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function prewarp(rate: number, hz: number, q: number): {cos: number; alpha: number} {
  check(Number.isFinite(rate) && rate >= 8000 && Number.isFinite(hz) && hz > 0 && hz < rate / 2 && q > 0, 'Invalid biquad design.');
  const w = 2 * Math.PI * hz / rate;
  return {cos: Math.cos(w), alpha: Math.sin(w) / (2 * q)};
}
export function lowPassCoefficients(rate: number, hz: number, q = EQ_SPLIT.q): BiquadCoefficients {
  const {cos, alpha} = prewarp(rate, hz, q);
  return normalized((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}
export function highPassCoefficients(rate: number, hz: number, q = EQ_SPLIT.q): BiquadCoefficients {
  const {cos, alpha} = prewarp(rate, hz, q);
  return normalized((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}
export function allPassCoefficients(rate: number, hz: number, q = EQ_SPLIT.q): BiquadCoefficients {
  const {cos, alpha} = prewarp(rate, hz, q);
  return normalized(1 - alpha, -2 * cos, 1 + alpha, 1 + alpha, -2 * cos, 1 - alpha);
}
interface Complex {readonly re: number; readonly im: number;}
const mul = (a: Complex, b: Complex): Complex => ({re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re});
/** Complex frequency response H(e^jw) of one biquad. */
export function biquadResponse(c: BiquadCoefficients, hz: number, rate: number): Complex {
  const w = 2 * Math.PI * hz / rate, z1 = {re: Math.cos(-w), im: Math.sin(-w)}, z2 = {re: Math.cos(-2 * w), im: Math.sin(-2 * w)};
  const num = {re: c[0] + c[1] * z1.re + c[2] * z2.re, im: c[1] * z1.im + c[2] * z2.im};
  const den = {re: 1 + c[3] * z1.re + c[4] * z2.re, im: c[3] * z1.im + c[4] * z2.im};
  const d = den.re * den.re + den.im * den.im;
  return {re: (num.re * den.re + num.im * den.im) / d, im: (num.im * den.re - num.re * den.im) / d};
}
/** The cascade for each band path, in processing order. */
export function bandPaths(rate: number, lowMidHz = EQ_SPLIT.lowMidHz, midHighHz = EQ_SPLIT.midHighHz): Record<EqBand, readonly BiquadCoefficients[]> {
  check(lowMidHz < midHighHz && midHighHz < rate / 2, 'Crossover frequencies must increase below Nyquist.');
  const lp1 = lowPassCoefficients(rate, lowMidHz), hp1 = highPassCoefficients(rate, lowMidHz);
  const lp2 = lowPassCoefficients(rate, midHighHz), hp2 = highPassCoefficients(rate, midHighHz);
  return {low: [lp1, lp1, allPassCoefficients(rate, midHighHz)], mid: [hp1, hp1, lp2, lp2], high: [hp1, hp1, hp2, hp2]};
}
/** Complex sum of the three weighted band paths at one frequency. */
export function threeBandResponse(hz: number, rate: number, gains: Readonly<Record<EqBand, number>> = {low: 1, mid: 1, high: 1}): Complex {
  const paths = bandPaths(rate);
  let re = 0, im = 0;
  for (const band of EQ_BANDS) {
    const h = paths[band].reduce<Complex>((acc, c) => mul(acc, biquadResponse(c, hz, rate)), {re: 1, im: 0});
    re += gains[band] * h.re; im += gains[band] * h.im;
  }
  return {re, im};
}
export const magnitudeDb = (h: Complex): number => 20 * Math.log10(Math.hypot(h.re, h.im));

class Section {
  private s1 = 0; private s2 = 0;
  constructor(private readonly c: BiquadCoefficients) {}
  next(x: number): number {
    const [b0, b1, b2, a1, a2] = this.c, y = b0 * x + this.s1;
    this.s1 = b1 * x - a1 * y + this.s2; this.s2 = b2 * x - a2 * y;
    return y;
  }
}
/** Per-channel offline splitter mirroring the browser graph (transposed direct form II). */
export class ThreeBandSplitter {
  private readonly paths: Record<EqBand, Section[]>;
  constructor(rate: number) {
    const design = bandPaths(rate);
    this.paths = {low: design.low.map(c => new Section(c)), mid: design.mid.map(c => new Section(c)), high: design.high.map(c => new Section(c))};
  }
  next(x: number): [number, number, number] {
    const run = (sections: Section[]): number => sections.reduce((y, s) => s.next(y), x);
    return [run(this.paths.low), run(this.paths.mid), run(this.paths.high)];
  }
}

/** Linear per-band gain lanes [0, 1]; 0 is a full band kill. Relative frames, like other lanes. */
export interface BandLanes {readonly low: readonly MixAutomationPoint[]; readonly mid: readonly MixAutomationPoint[]; readonly high: readonly MixAutomationPoint[];}
/** A declared, intentional EQ silence (relative to the owning automation's frame zero). */
export interface BandGap {readonly band: EqBand; readonly startFrame: number; readonly endFrame: number;}

export type ChoreographyName = 'tone-dissolve' | 'bass-drop-handover' | 'bass-swap-classic' | 'highs-first' | 'mid-carve';
export const CHOREOGRAPHIES: readonly ChoreographyName[] = Object.freeze(['tone-dissolve', 'bass-drop-handover', 'bass-swap-classic', 'highs-first', 'mid-carve'] as const);
export const CHOREOGRAPHY_VERSION = 'eq-choreography@1' as const;
export const CHOREOGRAPHY_LIMITS = Object.freeze({
  overlapBars: Object.freeze([8, 16, 32] as const), swapMs: Object.freeze({min: 100, max: 750, default: 380}),
  swapLeadMs: 20, gapBars: Object.freeze([1, 2, 4] as const), incomingLowDb: -18, incomingMidHighDb: -12,
});
export interface ChoreographyParams {
  readonly name: ChoreographyName;
  /** Total overlap in bars (shared-tempo bars). */
  readonly overlapBars: number;
  /** Bass ownership swap duration (tone-dissolve, bass-swap-classic, highs-first, mid-carve). */
  readonly swapMs: number;
  /** bass-drop-handover: whole bars of EQ silence between A's bass kill and B's bass entry. */
  readonly gapBars?: 1 | 2 | 4;
  /** bass-drop-handover: bands silent on both decks during the gap; `low` is always included. */
  readonly silentBands?: readonly EqBand[];
  /** bass-drop-handover: optional short echo tail on A after it closes (needs an echo-capable owner). */
  readonly echoTail?: boolean;
}
export interface ChoreographyPlan {
  readonly version: typeof CHOREOGRAPHY_VERSION;
  readonly params: ChoreographyParams;
  readonly durationFrames: number;
  readonly outgoing: {readonly gain: readonly MixAutomationPoint[]; readonly bands: BandLanes};
  readonly incoming: {readonly gain: readonly MixAutomationPoint[]; readonly bands: BandLanes};
  /** Declared EQ-silence gaps, relative to the shared overlap start. */
  readonly declaredGaps: readonly BandGap[];
  /** Downbeat (relative frame) where B owns the bass. */
  readonly bassOwnershipFrame: number;
  readonly description: string;
}

const dbToGain = (db: number): number => db <= -80 ? 0 : 10 ** (db / 20);
export const smoothstep = (u: number): number => { const t = Math.max(0, Math.min(1, u)); return t * t * (3 - 2 * t); };
// Snap rounding residue (cos(pi/2) ~ 6e-17) so a full fade ends at exact zero gain.
const clampGain = (v: number): number => Math.abs(v) < 1e-9 ? 0 : Math.abs(v - 1) < 1e-9 ? 1 : Math.max(0, Math.min(1, v));

/** Builds a strictly increasing lane; samples `fn` on [a, b] with `steps` segments. */
class LaneBuilder {
  private readonly points: MixAutomationPoint[] = [];
  constructor(private readonly duration: number, first: number) { this.points.push({frame: 0, value: clampGain(first)}); }
  private push(frame: number, value: number): void {
    const f = Math.max(0, Math.min(this.duration, Math.round(frame)));
    const last = this.points.at(-1)!;
    if (f <= last.frame) { if (f === last.frame && f > 0) this.points[this.points.length - 1] = {frame: f, value: clampGain(value)}; return; }
    this.points.push({frame: f, value: clampGain(value)});
  }
  hold(frame: number): this { this.push(frame, this.points.at(-1)!.value); return this; }
  to(frame: number, value: number): this { this.push(frame, value); return this; }
  curve(a: number, b: number, fn: (u: number) => number, steps = 8): this {
    this.hold(a);
    for (let i = 1; i <= steps; i++) this.push(a + (b - a) * i / steps, fn(i / steps));
    return this;
  }
  done(): MixAutomationPoint[] { this.hold(this.duration); return this.points; }
}

function checkParams(p: ChoreographyParams): void {
  check(CHOREOGRAPHIES.includes(p.name), `Unknown EQ choreography ${String(p.name)}.`);
  check(Number.isInteger(p.overlapBars) && p.overlapBars >= 1 && p.overlapBars <= 32, 'Choreography overlap must be 1..32 bars.');
  check(Number.isFinite(p.swapMs) && p.swapMs >= CHOREOGRAPHY_LIMITS.swapMs.min && p.swapMs <= CHOREOGRAPHY_LIMITS.swapMs.max, 'Bass swap must last 100..750 ms.');
  if (p.name === 'bass-drop-handover') {
    check(p.gapBars !== undefined && CHOREOGRAPHY_LIMITS.gapBars.includes(p.gapBars), 'Bass-drop gap must be 1, 2 or 4 bars.');
    check(p.overlapBars >= bassDropEntryBars(p.gapBars ?? 1) + 4 && p.overlapBars % 4 === 0, 'Bass-drop overlap must hold the phrase, the gap and an exit.');
    check(!p.silentBands || p.silentBands.every(b => EQ_BANDS.includes(b)) && p.silentBands.includes('low') && !p.silentBands.includes('high'),
      'Bass-drop silent bands must include low and keep the highs (the groove continues).');
  } else check(p.gapBars === undefined && !p.silentBands && !p.echoTail, 'Only bass-drop-handover takes gap parameters.');
}

/** Bar where B's bass lands in a bass-drop handover: 4, or 8 for a 4-bar gap (so A's bass is heard first). */
export const bassDropEntryBars = (gapBars: number): number => gapBars >= 4 ? 8 : 4;
/** Smallest bass-drop overlap: the entry phrase, the gap and a 4-bar exit. */
export const bassDropMinOverlap = (gapBars: number): number => bassDropEntryBars(gapBars) + 4;

/** Equal-power bass ownership swap on a smoothstep, ending `lead` frames before the downbeat. */
function swapWindow(downbeat: number, p: ChoreographyParams, rate: number): {start: number; end: number} {
  const end = downbeat - Math.round(rate * CHOREOGRAPHY_LIMITS.swapLeadMs / 1000);
  return {start: end - Math.round(rate * p.swapMs / 1000), end};
}

/**
 * Pure lanes for one choreography. `barFrames` is one shared-tempo bar in output frames.
 * Overlap starts at relative frame 0 (B's entry) and lasts `overlapBars` bars.
 */
export function choreographyPlan(params: ChoreographyParams, barFrames: number, sampleRate: number): ChoreographyPlan {
  checkParams(params);
  check(Number.isFinite(barFrames) && barFrames >= sampleRate * 0.5 && barFrames <= sampleRate * 8, 'Invalid bar length for choreography.');
  const p = params, D = Math.round(p.overlapBars * barFrames), bar = (n: number): number => Math.round(n * barFrames);
  check(D <= sampleRate * 120, 'Choreography exceeds the 120 s automation bound.');
  const lowIn = dbToGain(CHOREOGRAPHY_LIMITS.incomingLowDb), mh = dbToGain(CHOREOGRAPHY_LIMITS.incomingMidHighDb);
  const dbCurve = (fromDb: number, toDb: number) => (u: number) => dbToGain(fromDb + (toDb - fromDb) * smoothstep(u));
  const cos = (u: number) => Math.cos(Math.PI / 2 * smoothstep(u)), sin = (u: number) => Math.sin(Math.PI / 2 * smoothstep(u));
  // Fader lanes shared by the continuous choreographies: B in over the first quarter, A out over the last quarter.
  const fadeIn = new LaneBuilder(D, 0).curve(0, Math.max(bar(1), Math.round(D / 4)), u => Math.sin(Math.PI / 2 * u)).done();
  const fadeOut = new LaneBuilder(D, 1).curve(Math.min(D - bar(1), Math.round(3 * D / 4)), D, u => Math.cos(Math.PI / 2 * u)).done();
  let outgoing: BandLanes, incoming: BandLanes, ownership: number, gaps: BandGap[] = [], description: string;
  let gainOut = fadeOut, gainIn = fadeIn;
  if (p.name === 'bass-drop-handover') {
    const gap = p.gapBars!, entryBars = bassDropEntryBars(gap), bassIn = bar(entryBars), kill = bassIn - bar(gap);
    const killRamp = Math.round(sampleRate * 0.012);
    const silent = new Set<EqBand>(p.silentBands ?? ['low']);
    const exitStart = bassIn + bar(Math.max(1, (p.overlapBars - entryBars) / 2));
    // A: bass held, then killed on the bar boundary (a 12 ms ramp ending at the boundary).
    const aLow = new LaneBuilder(D, 1).hold(Math.max(0, kill - killRamp)).to(kill, 0).done();
    const aMid = silent.has('mid')
      ? new LaneBuilder(D, 1).hold(Math.max(0, kill - killRamp)).to(kill, 0.25).hold(exitStart).curve(exitStart, D, () => 0.25).done()
      : new LaneBuilder(D, 1).curve(exitStart, D, dbCurve(0, -24)).done();
    const aHigh = new LaneBuilder(D, 1).curve(exitStart, D, dbCurve(0, -24)).done();
    // B: bass absent until the phrase downbeat, then a 12 ms entry; mids/highs rise before the gap.
    const bLow = new LaneBuilder(D, 0).hold(bassIn).to(bassIn + killRamp, 1).done();
    const bMid = silent.has('mid')
      ? new LaneBuilder(D, mh).curve(0, kill, dbCurve(CHOREOGRAPHY_LIMITS.incomingMidHighDb, -6)).to(kill + killRamp, 0.25).hold(bassIn).to(bassIn + killRamp, 1).done()
      : new LaneBuilder(D, mh).curve(0, bassIn, dbCurve(CHOREOGRAPHY_LIMITS.incomingMidHighDb, 0)).done();
    const bHigh = new LaneBuilder(D, mh).curve(0, Math.max(killRamp, kill), dbCurve(CHOREOGRAPHY_LIMITS.incomingMidHighDb, 0)).done();
    outgoing = {low: aLow, mid: aMid, high: aHigh}; incoming = {low: bLow, mid: bMid, high: bHigh};
    gainIn = new LaneBuilder(D, 0).curve(0, Math.max(killRamp * 2, Math.min(kill, bar(2))), u => Math.sin(Math.PI / 2 * u)).done();
    gainOut = new LaneBuilder(D, 1).curve(exitStart, D, u => Math.cos(Math.PI / 2 * u)).done();
    ownership = bassIn;
    gaps = [...silent].map(band => ({band, startFrame: kill, endFrame: bassIn}));
    description = `A's bass drops on a bar line; ${gap} bar${gap > 1 ? 's' : ''} without bass${silent.has('mid') ? ' (mids thinned)' : ''}, then B's bass lands on the phrase downbeat.`;
  } else {
    const swapAt = p.name === 'highs-first' ? bar(Math.max(1, Math.round(3 * p.overlapBars / 4))) : bar(Math.max(1, Math.round(p.overlapBars / 2)));
    const sw = swapWindow(swapAt, p, sampleRate);
    check(sw.start > 0, 'Bass swap does not fit before its downbeat.');
    const startLowIn = p.name === 'bass-swap-classic' ? dbToGain(-24) : lowIn;
    const bLow = new LaneBuilder(D, startLowIn).curve(sw.start, sw.end, u => Math.max(startLowIn, sin(u))).done();
    const aLow = new LaneBuilder(D, 1).curve(sw.start, sw.end, u => Math.max(startLowIn, cos(u))).curve(sw.end, D, dbCurve(20 * Math.log10(startLowIn), -80), 4).done();
    if (p.name === 'tone-dissolve') {
      incoming = {low: bLow, mid: new LaneBuilder(D, mh).curve(0, swapAt, dbCurve(-12, 0)).done(),
        high: new LaneBuilder(D, mh).curve(0, Math.round(swapAt * 0.75), dbCurve(-12, 0)).done()};
      outgoing = {low: aLow, mid: new LaneBuilder(D, 1).curve(swapAt, D, dbCurve(0, -12)).done(),
        high: new LaneBuilder(D, 1).curve(Math.round(D / 4), D, dbCurve(0, -12)).done()};
      description = 'Tones dissolve: B enters thin with lows near -18 dB, rising gradually while A\'s highs and mids recede; bass ownership swaps on a phrase downbeat.';
    } else if (p.name === 'bass-swap-classic') {
      incoming = {low: bLow, mid: new LaneBuilder(D, 1).done(), high: new LaneBuilder(D, 1).done()};
      outgoing = {low: aLow, mid: new LaneBuilder(D, 1).done(), high: new LaneBuilder(D, 1).done()};
      description = 'Classic bass swap: B\'s bass held near -24 dB, then swapped with A\'s on a phrase downbeat.';
    } else if (p.name === 'highs-first') {
      incoming = {low: bLow, mid: new LaneBuilder(D, mh).curve(Math.round(swapAt / 3), swapAt, dbCurve(-12, 0)).done(),
        high: new LaneBuilder(D, mh).curve(0, Math.round(swapAt / 3), dbCurve(-12, 0)).done()};
      outgoing = {low: aLow, mid: new LaneBuilder(D, 1).curve(swapAt, D, dbCurve(0, -12)).done(),
        high: new LaneBuilder(D, 1).curve(0, Math.round(swapAt / 3), dbCurve(0, -9)).done()};
      description = 'Highs first: B\'s hats arrive first, then its mids, and the bass swaps late.';
    } else {
      // mid-carve: never both mid ranges at full (limits sustained harmonic overlap).
      const carve = dbToGain(-15);
      incoming = {low: bLow, mid: new LaneBuilder(D, carve).curve(sw.start, sw.end, u => Math.max(carve, sin(u))).done(),
        high: new LaneBuilder(D, mh).curve(0, swapAt, dbCurve(-12, 0)).done()};
      outgoing = {low: aLow, mid: new LaneBuilder(D, 1).curve(sw.start, sw.end, u => Math.max(carve, cos(u))).done(),
        high: new LaneBuilder(D, 1).curve(swapAt, D, dbCurve(0, -12)).done()};
      description = 'Mid carve: only one song\'s mids are full at a time; mids and bass swap together on a phrase downbeat.';
    }
    ownership = swapAt;
  }
  return {version: CHOREOGRAPHY_VERSION, params: {...p, ...(p.silentBands ? {silentBands: [...p.silentBands]} : {})}, durationFrames: D,
    outgoing: {gain: gainOut, bands: outgoing}, incoming: {gain: gainIn, bands: incoming},
    declaredGaps: gaps, bassOwnershipFrame: ownership, description};
}

/** Validate band lanes against a lane duration (used by mix automation validation). */
export function validateBandLanes(bands: BandLanes, durationFrames: number): void {
  for (const band of EQ_BANDS) {
    const points = bands[band];
    check(Array.isArray(points) && points.length >= 2 && points.length <= 64, `${band} band needs 2–64 points.`);
    check(points[0]!.frame === 0 && points.at(-1)!.frame === durationFrames, `${band} band must span the exact duration.`);
    let previous = -1;
    for (const point of points) {
      check(Number.isSafeInteger(point.frame) && point.frame > previous && point.frame <= durationFrames, `${band} band frames must increase.`);
      check(Number.isFinite(point.value) && point.value >= 0 && point.value <= 1, `${band} band gain is outside [0, 1].`);
      check(point.curve === undefined || point.curve === 'linear', `${band} band lanes are linear.`);
      previous = point.frame;
    }
  }
}
export function validateBandGaps(gaps: readonly BandGap[], durationFrames: number): void {
  check(Array.isArray(gaps) && gaps.length <= 3, 'At most three declared band gaps.');
  for (const gap of gaps) check(EQ_BANDS.includes(gap.band) && Number.isSafeInteger(gap.startFrame) && Number.isSafeInteger(gap.endFrame) &&
    gap.startFrame >= 0 && gap.endFrame > gap.startFrame && gap.endFrame <= durationFrames, 'Invalid declared EQ-silence gap.');
}
