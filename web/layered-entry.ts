/**
 * Layered (band-wise) entries, `layered-entry@1`. Pure plan data; no clock, no audio graph.
 *
 * Owner decision 2026-11-16: no instantaneous clean cut on any automatic path. Instead B comes in by
 * band on the LR4 three-band split (eq-choreography@1, 160 Hz / 3.5 kHz): one band (or two) first,
 * the rest over the following bars, while A is thinned band by band (equal-power, so the two songs'
 * matching bands never sit at full level together), a filter closes on A and, for some styles, A leaves
 * on a short echo tail. B stays at its own tempo; nothing here claims beat alignment between the songs.
 *
 * Every number is an engineering starting point, not a listening-qualified preference.
 */
import {EQ_BANDS, smoothstep, type BandLanes, type EqBand} from './eq-choreography.js';
import type {MixAutomation, MixAutomationPoint, MixEchoAutomation} from '../src/mix-automation.js';
import type {SectionLabel} from './mix-structure.js';
import {seededRandom} from './transition-policy.js';

export const LAYERED_ENTRY_VERSION = 'layered-entry@1' as const;
export const ENTRY_STYLES = Object.freeze(['bass-first', 'mid-first', 'high-first', 'drums-first'] as const);
export type EntryStyle = typeof ENTRY_STYLES[number];
export type LayeredBars = 2 | 4 | 8;
export const LAYERED_ENTRY_LIMITS = Object.freeze({
  /** Lengths in A's bars, longest first. The 2-bar entry is the ladder's last rung. */
  bars: Object.freeze([8, 4, 2] as const),
  /** Tempo gaps up to this use the long lengths (8, 4); above it the short ones (4, 2): two native grids drift. */
  nearGap: 0.08,
  /** Echo tail on A (bass-first and mid-first only, 4 bars or more): half-beat repeats, low send. */
  echo: Object.freeze({send: 0.2, feedback: 0.3, lowPassHz: 2500, repeats: 8}),
  /** Lane rule: the two songs' low bands are never both above this (dB of each song's own level). */
  lowOverlapMaxDb: -3,
  /** Lane rule: the low band's power sum (A^2 + B^2) never falls below this while B's low is still to come. */
  lowSumMinDb: -3.5,
  /** Measured: during the lead phase B's lead band(s) must sit this far above its other bands (relative to B native). */
  leadMarginDb: 6,
  /** Measured masking proxy: both songs' low band within this of their own native level at once fails. */
  maskingMaxDb: -1.5,
  /** Declared loudness dip bound (recipe-claims@2): band hand-overs keep the power sum, so tighter than an echo. */
  maxDipLu: 4,
});

/** Band crossing windows as fractions of the entry length. Lead bands cross first; A's bands leave in the same windows. */
const SCHEDULE: Readonly<Record<EntryStyle, {readonly lead: readonly EqBand[]; readonly windows: Readonly<Record<EqBand, readonly [number, number]>>}>> = Object.freeze({
  'bass-first': {lead: ['low'], windows: {low: [0, 0.5], mid: [0.5, 0.8], high: [0.6, 1]}},
  'mid-first': {lead: ['mid'], windows: {mid: [0, 0.5], low: [0.5, 0.75], high: [0.6, 1]}},
  'high-first': {lead: ['high'], windows: {high: [0, 0.5], low: [0.5, 0.75], mid: [0.6, 1]}},
  'drums-first': {lead: ['mid', 'high'], windows: {mid: [0, 0.5], high: [0, 0.5], low: [0.5, 0.85]}},
});
export const leadBands = (style: EntryStyle): readonly EqBand[] => SCHEDULE[style].lead;
/** A leaves on an echo tail only when its last band to go is the highs (an echo of A's bass would sit on B's). */
export const styleTakesEcho = (style: EntryStyle): boolean => style === 'bass-first' || style === 'mid-first';

export interface LayeredEntryInfo {
  readonly version: typeof LAYERED_ENTRY_VERSION;
  readonly style: EntryStyle;
  readonly bars: LayeredBars;
  readonly echoTail: boolean;
  /** Incoming (B) lane length: the whole band hand-over. */
  readonly durationFrames: number;
  /** Relative frame (from B's entry) where the lead phase ends and B's other bands begin to open. */
  readonly leadEndFrame: number;
  /** True for the degradation ladder's final rung (the shortest layered entry). */
  readonly lastRung?: boolean;
}
export interface LayeredEntryAutomation {
  readonly outgoing: MixAutomation; readonly incoming: MixAutomation; readonly info: LayeredEntryInfo;
}

const check = (ok: unknown, why: string): void => { if (!ok) throw new Error(why); };
const clamp = (v: number): number => Math.abs(v) < 1e-9 ? 0 : Math.abs(v - 1) < 1e-9 ? 1 : Math.max(0, Math.min(1, v));

/** Strictly increasing linear lane from frame 0 to `duration`. */
function lane(duration: number, segments: readonly {readonly frame: number; readonly value: number}[], first: number, clampValues = true): MixAutomationPoint[] {
  const points: MixAutomationPoint[] = [{frame: 0, value: clampValues ? clamp(first) : first}];
  for (const s of segments) {
    const f = Math.max(0, Math.min(duration, Math.round(s.frame))), v = clampValues ? clamp(s.value) : s.value, last = points.at(-1)!;
    if (f < last.frame) continue;
    if (f === last.frame) { if (f > 0) points[points.length - 1] = {frame: f, value: v}; continue; }
    points.push({frame: f, value: v});
  }
  if (points.at(-1)!.frame < duration) points.push({frame: duration, value: points.at(-1)!.value});
  return points;
}
/** Equal-power crossing over [a, b] (fractions of `d`), sampled in 8 steps; `rise` picks sin (B) or cos (A). */
function crossing(d: number, [a, b]: readonly [number, number], rise: boolean): {frame: number; value: number}[] {
  const out: {frame: number; value: number}[] = [{frame: a * d, value: rise ? 0 : 1}];
  for (let i = 1; i <= 8; i++) {
    const u = smoothstep(i / 8), angle = Math.PI / 2 * u;
    out.push({frame: (a + (b - a) * i / 8) * d, value: rise ? Math.sin(angle) : Math.cos(angle)});
  }
  return out;
}

/**
 * Lanes for one layered entry. Overlap starts at relative frame 0 (B's entry on A's downbeat) and lasts
 * `bars` of A's bars. With an echo tail the outgoing lanes run a further eight half-beat repeats after
 * A's dry signal closes (the deck keeps reading A, silent, for that time).
 */
export function layeredEntryAutomation(style: EntryStyle, bars: LayeredBars, barFrames: number, bpm: number, sampleRate: number,
  options: {readonly echoTail?: boolean; readonly lastRung?: boolean} = {}): LayeredEntryAutomation {
  check(ENTRY_STYLES.includes(style), `Unknown layered entry style ${String(style)}.`);
  check(LAYERED_ENTRY_LIMITS.bars.includes(bars), 'Layered entries last 2, 4 or 8 bars.');
  check(Number.isFinite(barFrames) && barFrames >= sampleRate * 0.5 && barFrames <= sampleRate * 8, 'Invalid bar length for a layered entry.');
  const d = Math.round(bars * barFrames), nyquist = sampleRate / 2, plan = SCHEDULE[style];
  check(d <= sampleRate * 60, 'Layered entry exceeds its 60 s bound.');
  const echoTail = !!options.echoTail && styleTakesEcho(style) && bars >= 4;
  const delayFrames = Math.round(30 / Math.min(180, Math.max(60, bpm)) * sampleRate);
  const tail = echoTail ? delayFrames * LAYERED_ENTRY_LIMITS.echo.repeats : 0, out = d + tail;
  const bandsIn = {} as Record<EqBand, MixAutomationPoint[]>, bandsOut = {} as Record<EqBand, MixAutomationPoint[]>;
  for (const band of EQ_BANDS) {
    const w = plan.windows[band];
    bandsIn[band] = lane(d, crossing(d, w, true), 0);
    bandsOut[band] = lane(out, crossing(d, w, false), 1);
  }
  const lowWindow = plan.windows.low, midWindow = plan.windows.mid;
  // B: filter openings. A high-pass guards B's sub until its low band crosses; a low-pass on a bass-first entry
  // opens as B's mids arrive.
  const incoming: MixAutomation = {durationFrames: d,
    // The deck contract: an incoming mix starts at zero gain. A 10 ms de-click ramp; the band lanes do the entry.
    gain: [{frame: 0, value: 0}, {frame: Math.max(1, Math.round(sampleRate * 0.01)), value: 1}, {frame: d, value: 1}],
    lowShelfDb: [{frame: 0, value: 0}, {frame: d, value: 0}],
    highPassHz: lowWindow[0] > 0
      ? lane(d, [{frame: lowWindow[0] * d, value: 160}, {frame: (lowWindow[0] + lowWindow[1]) / 2 * d, value: 0}], 160, false)
      : [{frame: 0, value: 0}, {frame: d, value: 0}],
    lowPassHz: style === 'bass-first'
      ? lane(d, [{frame: midWindow[0] * d, value: Math.min(1000, nyquist)}, {frame: midWindow[1] * d, value: nyquist}], Math.min(1000, nyquist), false)
      : [{frame: 0, value: nyquist}, {frame: d, value: nyquist}],
    bands: bandsIn};
  // A: carved band by band (above), a low-pass closing over the last 40%, and the fader closing last.
  const fadeStart = Math.round(0.9 * d);
  const gain = lane(out, [{frame: fadeStart, value: 1}, {frame: d, value: 0}], 1);
  let echo: MixEchoAutomation | undefined;
  if (echoTail) {
    const sendOn = Math.round(0.75 * d), sendHold = Math.round(0.95 * d), fade = Math.max(1, Math.round(sampleRate * 0.02));
    echo = {delayFrames, feedback: LAYERED_ENTRY_LIMITS.echo.feedback, lowPassHz: Math.min(LAYERED_ENTRY_LIMITS.echo.lowPassHz, sampleRate * 0.45),
      handoverFrame: d,
      send: [{frame: 0, value: 0}, {frame: sendOn, value: 0}, {frame: Math.round(0.85 * d), value: LAYERED_ENTRY_LIMITS.echo.send},
        {frame: sendHold, value: LAYERED_ENTRY_LIMITS.echo.send}, {frame: d, value: 0}, {frame: out, value: 0}],
      wet: [{frame: 0, value: 0}, {frame: sendOn, value: 1}, {frame: out - fade, value: 1}, {frame: out, value: 0}]};
  }
  const outgoing: MixAutomation = {durationFrames: out, gain,
    lowShelfDb: [{frame: 0, value: 0}, {frame: out, value: 0}],
    highPassHz: [{frame: 0, value: 0}, {frame: out, value: 0}],
    lowPassHz: lane(out, [{frame: 0.6 * d, value: nyquist}, {frame: 0.8 * d, value: Math.min(8000, nyquist)}, {frame: d, value: Math.min(2500, nyquist)}], nyquist, false),
    bands: bandsOut, ...(echo ? {echo} : {})};
  const leadEndFrame = Math.round(Math.max(...plan.lead.map(b => plan.windows[b][1])) * d);
  const info: LayeredEntryInfo = {version: LAYERED_ENTRY_VERSION, style, bars, echoTail, durationFrames: d, leadEndFrame,
    ...(options.lastRung ? {lastRung: true} : {})};
  const lanes = checkLayeredLanes(outgoing, incoming, info);
  check(lanes.ok, `Layered entry lanes break their own claim: ${lanes.reason}`);
  return {outgoing, incoming, info};
}

function value(points: readonly MixAutomationPoint[], frame: number): number {
  if (frame <= points[0]!.frame) return points[0]!.value;
  for (let i = 1; i < points.length; i++) {
    const l = points[i - 1]!, r = points[i]!;
    if (frame <= r.frame) return l.value + (r.value - l.value) * (frame - l.frame) / (r.frame - l.frame);
  }
  return points.at(-1)!.value;
}
const toDb = (g: number): number => g <= 1e-6 ? -120 : 20 * Math.log10(g);

export interface LayeredLaneCheck {
  readonly ok: boolean; readonly reason: string;
  /** Highest min(A low, B low) over the entry, dB of each song's own level (gain x band). */
  readonly lowOverlapDb: number;
  /** Lowest low-band power sum before B's low is fully open, dB. */
  readonly lowSumMinDb: number;
  /** B's lead band(s) reach half level before any other B band passes 0.1. */
  readonly leadFirst: boolean;
}
/**
 * Lane-level claim check (no audio): the masking rule (never both lows near full), low-band continuity
 * and the per-band order the style names. Sampled at 256 points plus every lane point.
 */
export function checkLayeredLanes(outgoing: MixAutomation, incoming: MixAutomation, info: LayeredEntryInfo): LayeredLaneCheck {
  const d = info.durationFrames, a = outgoing.bands, b = incoming.bands;
  if (!a || !b) return {ok: false, reason: 'a layered entry needs band lanes on both decks', lowOverlapDb: 0, lowSumMinDb: -120, leadFirst: false};
  const frames = new Set<number>();
  for (let i = 0; i <= 256; i++) frames.add(Math.round(d * i / 256));
  for (const lanes of [a, b]) for (const band of EQ_BANDS) for (const p of lanes[band]) if (p.frame <= d) frames.add(p.frame);
  let overlap = -Infinity, sum = Infinity;
  const lead = leadBands(info.style), others = EQ_BANDS.filter(x => !lead.includes(x));
  let leadAt = Infinity, otherAt = Infinity;
  for (const f of [...frames].sort((x, y) => x - y)) {
    const aLow = value(outgoing.gain, f) * value(a.low, f), bLow = value(incoming.gain, f) * value(b.low, f);
    overlap = Math.max(overlap, toDb(Math.min(aLow, bLow)));
    if (bLow < 1 - 1e-9 && aLow > 1e-6) sum = Math.min(sum, 10 * Math.log10(Math.max(1e-12, aLow * aLow + bLow * bLow)));
    if (leadAt === Infinity && lead.every(x => value(b[x], f) >= 0.5)) leadAt = f;
    if (otherAt === Infinity && others.some(x => value(b[x], f) > 0.1)) otherAt = f;
  }
  if (sum === Infinity) sum = 0;
  const leadFirst = leadAt < otherAt;
  const L = LAYERED_ENTRY_LIMITS;
  const reason = overlap > L.lowOverlapMaxDb + 0.05 ? `both low bands at ${overlap.toFixed(1)} dB at once (limit ${L.lowOverlapMaxDb} dB)`
    : sum < L.lowSumMinDb ? `low band power falls to ${sum.toFixed(1)} dB during the hand-over (limit ${L.lowSumMinDb} dB)`
      : !leadFirst ? `B's ${lead.join('+')} band does not lead` : 'ok';
  return {ok: reason === 'ok', reason, lowOverlapDb: overlap, lowSumMinDb: sum, leadFirst};
}

// ---------------------------------------------------------------------------------------------
// Choice by section (mix-structure@1) and seeded explore
// ---------------------------------------------------------------------------------------------
/** Default order when the sections say nothing: highs first swaps the bass latest (least masking risk). */
const DEFAULT_ORDER: readonly EntryStyle[] = Object.freeze(['high-first', 'bass-first', 'drums-first', 'mid-first']);
export interface EntryStyleChoice {readonly styles: readonly EntryStyle[]; readonly reason: string; readonly structural: boolean;}
/**
 * Preferred style order for a pair from heuristic section labels. Rules (first match leads; the rest follow
 * in the default order): B enters at a drop → highs first (the drop's bass lands after its top end);
 * A leaves a breakdown or outro → bass first (A is thin; B's bass grounds the mix under it); B enters at an
 * intro → drums first; B enters at a build → mid first; A leaves a drop → highs first (its bass stays until last).
 */
export function preferredEntryStyles(exit: SectionLabel | null, entry: SectionLabel | null): EntryStyleChoice {
  const lead = (style: EntryStyle, reason: string): EntryStyleChoice =>
    ({styles: [style, ...DEFAULT_ORDER.filter(s => s !== style)], reason, structural: true});
  if (entry === 'drop') return lead('high-first', 'B enters at a drop: its highs first, the drop\'s bass after');
  if (exit === 'breakdown' || exit === 'outro') return lead('bass-first', `A leaves its ${exit}: B's bass first, under A`);
  if (entry === 'intro') return lead('drums-first', 'B enters at its intro: drums and top first');
  if (entry === 'build') return lead('mid-first', 'B enters at a build: its mids first');
  if (exit === 'drop') return lead('high-first', 'A leaves a drop: B\'s highs first, A\'s bass stays until late');
  return {styles: [...DEFAULT_ORDER], reason: 'no section rule applies: default order (highs first)', structural: false};
}
/** Seeded explore: a deterministic permutation of the styles (the pre-check then keeps the first that passes). */
export function exploreEntryStyles(seed: number, styles: readonly EntryStyle[]): EntryStyle[] {
  const random = seededRandom((seed ^ 0x2c1b3c6d) >>> 0), out = [...styles];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------
const LEAD_WORDS: Readonly<Record<EntryStyle, string>> = Object.freeze({
  'bass-first': 'bass', 'mid-first': 'mids (vocal and lead band)', 'high-first': 'highs (hats and air)', 'drums-first': 'drums and top (mids and highs)'});
export const ENTRY_STYLE_LABELS: Readonly<Record<EntryStyle, string>> = Object.freeze({
  'bass-first': 'Bass-first layered entry', 'mid-first': 'Mid-first layered entry', 'high-first': 'Highs-first layered entry',
  'drums-first': 'Drums-first layered entry'});
/** "the bass of Hazy Harbor comes in under Night Drive for 2 bars, then the rest over 2 more; A leaves on an echo" */
export function layeredSentence(info: Pick<LayeredEntryInfo, 'style' | 'bars' | 'echoTail' | 'durationFrames' | 'leadEndFrame'>,
  fromTitle = 'the playing song', toTitle = 'the next song'): string {
  const leadBars = Math.max(1, Math.round(info.bars * info.leadEndFrame / Math.max(1, info.durationFrames)));
  const rest = info.bars - leadBars;
  return `the ${LEAD_WORDS[info.style]} of ${toTitle} come${info.style === 'bass-first' ? 's' : ''} in under ${fromTitle} for ${leadBars} bar${leadBars === 1 ? '' : 's'}, ` +
    `then the rest${rest > 0 ? ` over ${rest} more` : ''} while ${fromTitle} thins out${info.echoTail ? ' and leaves on an echo tail' : ''}`;
}
/** The same sentence from a recorded entry style (plan record), using the style's own lead window. */
export function entryStyleSentence(entry: {readonly style: EntryStyle; readonly bars: number | null; readonly echoTail: boolean},
  fromTitle?: string, toTitle?: string): string {
  const plan = SCHEDULE[entry.style];
  if (!plan) return '';
  const lead = Math.max(...plan.lead.map(b => plan.windows[b][1]));
  const bars = (entry.bars ?? 4) as LayeredBars;
  return layeredSentence({style: entry.style, bars, echoTail: entry.echoTail, durationFrames: 1000, leadEndFrame: Math.round(lead * 1000)}, fromTitle, toTitle);
}
/** Label for a recipe key `fallback-layered-entry/<style>` (retry signatures), or null. */
export function layeredKeyLabel(key: string): string | null {
  const base = key.split(':')[0]!, style = base.startsWith('fallback-layered-entry/') ? base.slice('fallback-layered-entry/'.length) as EntryStyle : null;
  return style && style in ENTRY_STYLE_LABELS ? ENTRY_STYLE_LABELS[style] : null;
}
/** Entry style named by an analyzed EQ choreography (beat-matched plans), or null when it is not band-led. */
export function choreographyEntryStyle(name: string | null | undefined): EntryStyle | null {
  return name === 'highs-first' ? 'high-first' : name === 'mid-carve' ? 'mid-first'
    : name === 'bass-swap-classic' || name === 'bass-drop-handover' ? 'bass-first' : null;
}
