/** Plan-data automation for the opt-in mix path. No audio callback or new clock. */
export interface MixAutomationPoint {
  /** Relative output frame. The curve describes the segment ending at this point. */
  readonly frame: number;
  readonly value: number;
  readonly curve?: 'linear' | 'exponential';
}

export interface MixAutomation {
  readonly durationFrames: number;
  readonly gain: readonly MixAutomationPoint[];
  readonly lowShelfDb: readonly MixAutomationPoint[];
  readonly highPassHz: readonly MixAutomationPoint[];
  readonly lowPassHz: readonly MixAutomationPoint[];
}

const check = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
export const MIX_SHELF_HZ = 250;
/** Web Audio interprets low/high-pass Q in dB, unlike the conventional linear Q. */
export const MIX_FILTER_Q_DB = 20 * Math.log10(Math.SQRT1_2);

/** Engineering bounds, not listening results. Every lane has explicit endpoints. */
export function validateMixAutomation(plan: MixAutomation, sampleRate: number): void {
  check(Number.isInteger(sampleRate) && sampleRate >= 8000 && sampleRate <= 192000,
    'Mix automation needs an 8–192 kHz integer output rate.');
  check(plan && Number.isSafeInteger(plan.durationFrames) && plan.durationFrames >= 1 &&
    plan.durationFrames <= sampleRate * 120, 'Mix automation duration must be 1 frame to 120 seconds.');
  const lanes = [
    ['gain', plan.gain, 0, 1], ['lowShelfDb', plan.lowShelfDb, -24, 0],
    ['highPassHz', plan.highPassHz, 0, sampleRate / 2], ['lowPassHz', plan.lowPassHz, 0, sampleRate / 2],
  ] as const;
  for (const [name, points, min, max] of lanes) {
    check(Array.isArray(points) && points.length >= 2 && points.length <= 64,
      `${name} needs 2–64 automation points.`);
    check(points[0]!.frame === 0 && points.at(-1)!.frame === plan.durationFrames,
      `${name} must span frame zero through the exact duration.`);
    let previous: MixAutomationPoint | undefined;
    for (const point of points) {
      check(point && Number.isSafeInteger(point.frame) && point.frame >= 0 &&
        point.frame <= plan.durationFrames && (!previous || point.frame > previous.frame),
      `${name} frames must increase strictly inside the plan.`);
      check(Number.isFinite(point.value) && point.value >= min && point.value <= max,
        `${name} value is outside [${min}, ${max}].`);
      check(point.curve === undefined || point.curve === 'linear' || point.curve === 'exponential',
        `${name} has an unsupported interpolation.`);
      check(point.curve !== 'exponential' || !!previous && previous.value > 0 && point.value > 0,
        `${name} exponential ramps require positive endpoints.`);
      previous = point;
    }
  }
}

/** Piecewise linear/exponential value in the frame domain (also useful for diagnostics). */
export function mixCurveValue(points: readonly MixAutomationPoint[], frame: number): number {
  if (frame <= points[0]!.frame) return points[0]!.value;
  for (let index = 1; index < points.length; index++) {
    const left = points[index - 1]!, right = points[index]!;
    if (frame <= right.frame) {
      const t = (frame - left.frame) / (right.frame - left.frame);
      return right.curve === 'exponential' ? left.value * (right.value / left.value) ** t
        : left.value + (right.value - left.value) * t;
    }
  }
  return points.at(-1)!.value;
}

const lane = (frames: number, first: number, last = first): MixAutomationPoint[] =>
  [{frame: 0, value: first}, {frame: frames, value: last}];

/** Complementary gain and sequential bass ownership; attenuation cannot isolate stems. */
export function bassSwapAutomation(durationFrames: number, sampleRate: number):
  {outgoing: MixAutomation; incoming: MixAutomation} {
  check(Number.isSafeInteger(durationFrames) && durationFrames >= 10,
    'A bass swap needs at least ten output frames.');
  const cut = Math.floor(durationFrames * 0.4), swap = Math.floor(durationFrames * 0.5);
  const open = Math.floor(durationFrames * 0.6), nyquist = sampleRate / 2;
  const outgoing: MixAutomation = {durationFrames,
    gain: lane(durationFrames, 1, 0),
    lowShelfDb: [{frame: 0, value: 0}, {frame: cut, value: 0},
      {frame: swap, value: -24}, {frame: durationFrames, value: -24}],
    highPassHz: [{frame: 0, value: 0}, {frame: cut, value: 0},
      {frame: swap, value: 500}, {frame: durationFrames, value: 1000}],
    lowPassHz: lane(durationFrames, nyquist)};
  const incoming: MixAutomation = {durationFrames,
    gain: lane(durationFrames, 0, 1),
    lowShelfDb: [{frame: 0, value: -24}, {frame: swap, value: -24},
      {frame: open, value: 0}, {frame: durationFrames, value: 0}],
    highPassHz: [{frame: 0, value: 500}, {frame: swap, value: 500},
      {frame: open, value: 0}, {frame: durationFrames, value: 0}],
    lowPassHz: lane(durationFrames, nyquist)};
  validateMixAutomation(outgoing, sampleRate); validateMixAutomation(incoming, sampleRate);
  return {outgoing, incoming};
}

/** Standalone sweep data; gain is neutral and callers may replace its explicit curve. */
export function sweepAutomation(durationFrames: number, sampleRate: number,
  kind: 'highpass' | 'lowpass', direction: 'open' | 'close'): MixAutomation {
  check((kind === 'highpass' || kind === 'lowpass') && (direction === 'open' || direction === 'close'),
    'Unknown filter sweep.');
  const nyquist = sampleRate / 2;
  const high = Math.min(6000, nyquist * 0.8), low = 80;
  const frequencies = kind === 'highpass' ? [high, 0] : [low, nyquist];
  if (direction === 'close') frequencies.reverse();
  const plan: MixAutomation = {durationFrames, gain: lane(durationFrames, 1),
    lowShelfDb: lane(durationFrames, 0), highPassHz: kind === 'highpass'
      ? lane(durationFrames, frequencies[0]!, frequencies[1]!) : lane(durationFrames, 0),
    lowPassHz: kind === 'lowpass' ? lane(durationFrames, frequencies[0]!, frequencies[1]!)
      : lane(durationFrames, nyquist)};
  validateMixAutomation(plan, sampleRate);
  return plan;
}

export interface MixAutomationGraph {
  /** Before the mix starts, reconnect the original unfiltered path exactly. */
  restore(): void;
  /** Release all opt-in nodes without reconnecting a dead source. */
  release(): void;
}

function scheduleCurve(parameter: AudioParam, points: readonly MixAutomationPoint[],
  atFrame: number, rate: number): void {
  parameter.setValueAtTime(points[0]!.value, atFrame / rate);
  for (const point of points.slice(1)) {
    const time = (atFrame + point.frame) / rate;
    if (point.curve === 'exponential') parameter.exponentialRampToValueAtTime(point.value, time);
    else parameter.linearRampToValueAtTime(point.value, time);
  }
}

/**
 * Only call for an explicitly requested mix. The source initially owns the sole direct
 * input→output connection. A dry path preserves that signal until the exact future
 * boundary; the filter path is muted before it. No timer alters this graph later.
 * Browser filtering follows W3C Web Audio §1.13; no third-party DSP code is imported.
 */
export function createMixAutomationGraph(context: BaseAudioContext, input: AudioNode,
  output: AudioNode, atFrame: number, plan: MixAutomation): MixAutomationGraph {
  validateMixAutomation(plan, context.sampleRate);
  check(input.context === context && output.context === context, 'Mix nodes need the owner context.');
  check(Number.isSafeInteger(atFrame) && atFrame >= Math.ceil(context.currentTime * context.sampleRate),
    'Mix automation must begin on a future audio-clock frame.');
  const dry = context.createGain(), wet = context.createGain();
  const shelf = context.createBiquadFilter(), hp = context.createBiquadFilter(), lp = context.createBiquadFilter();
  const nodes: AudioNode[] = [dry, wet, shelf, hp, lp];
  let disposed = false, connected = false;
  const cleanup = (restore: boolean): void => {
    if (disposed) return;
    disposed = true;
    if (connected) {
      input.disconnect();
      if (restore) input.connect(output);
    }
    for (const node of nodes) node.disconnect();
  };
  try {
    dry.gain.value = 1; wet.gain.value = 0;
    shelf.type = 'lowshelf'; shelf.frequency.value = MIX_SHELF_HZ; shelf.gain.value = 0;
    hp.type = 'highpass'; hp.frequency.value = 0; hp.Q.value = MIX_FILTER_Q_DB;
    lp.type = 'lowpass'; lp.frequency.value = context.sampleRate / 2; lp.Q.value = MIX_FILTER_Q_DB;
    dry.gain.setValueAtTime(0, atFrame / context.sampleRate);
    scheduleCurve(wet.gain, plan.gain, atFrame, context.sampleRate);
    scheduleCurve(shelf.gain, plan.lowShelfDb, atFrame, context.sampleRate);
    scheduleCurve(hp.frequency, plan.highPassHz, atFrame, context.sampleRate);
    scheduleCurve(lp.frequency, plan.lowPassHz, atFrame, context.sampleRate);
    dry.connect(output); shelf.connect(hp); hp.connect(lp); lp.connect(wet); wet.connect(output);
    // All graph changes are one synchronous operation before the scheduled boundary.
    input.disconnect(); connected = true; input.connect(dry); input.connect(shelf);
  } catch (error) { cleanup(true); throw error; }
  return {restore: () => cleanup(true), release: () => cleanup(false)};
}
