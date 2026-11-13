/** Plan-data automation for the opt-in mix path. No audio callback or new clock. */
export interface MixAutomationPoint {
  /** Relative output frame. The curve describes the segment ending at this point. */
  readonly frame: number;
  readonly value: number;
  readonly curve?: 'linear' | 'exponential';
}

/** Opt-in echo send/return, owned and released by the existing source graph. */
export interface MixEchoAutomation {
  readonly delayFrames: number;
  readonly feedback: number;
  readonly lowPassHz: number;
  /** B's entry relative to this graph's start; A dry/send must be zero from here. */
  readonly handoverFrame: number;
  readonly send: readonly MixAutomationPoint[];
  readonly wet: readonly MixAutomationPoint[];
}

export interface MixAutomation {
  readonly durationFrames: number;
  readonly echo?: MixEchoAutomation;
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
  if (plan.echo) {
    const echo = plan.echo;
    check(Number.isSafeInteger(echo.delayFrames) && echo.delayFrames >= 128 && echo.delayFrames <= sampleRate * 2,
      'Echo delay must be 128 frames through two seconds.');
    check(Number.isFinite(echo.feedback) && echo.feedback >= 0 && echo.feedback <= 0.45,
      'Echo feedback must be 0 through 0.45 (experimental bounded-tail policy).');
    check(Number.isFinite(echo.lowPassHz) && echo.lowPassHz >= 100 && echo.lowPassHz <= sampleRate * 0.45,
      'Echo feedback low-pass cutoff is outside the supported band.');
    check(Number.isSafeInteger(echo.handoverFrame) && echo.handoverFrame > 0 && echo.handoverFrame < plan.durationFrames,
      'Echo needs a positive pre-roll and a bounded tail.');
    // Reuse the same lane validation, without recursively carrying echo metadata.
    validateMixAutomation({durationFrames: plan.durationFrames, gain: echo.send,
      lowShelfDb: plan.lowShelfDb, highPassHz: plan.highPassHz, lowPassHz: plan.lowPassHz}, sampleRate);
    validateMixAutomation({durationFrames: plan.durationFrames, gain: echo.wet,
      lowShelfDb: plan.lowShelfDb, highPassHz: plan.highPassHz, lowPassHz: plan.lowPassHz}, sampleRate);
    check(echo.send[0]!.value === 0 && echo.send.at(-1)!.value === 0 && echo.wet.at(-1)!.value === 0,
      'Echo send begins/ends silent and its wet return ends silent.');
    check(mixCurveValue(plan.gain, echo.handoverFrame) === 0 && mixCurveValue(echo.send, echo.handoverFrame) === 0 &&
      plan.gain.filter(p => p.frame >= echo.handoverFrame).every(p => p.value === 0) &&
      echo.send.filter(p => p.frame >= echo.handoverFrame).every(p => p.value === 0),
      'A dry gain and echo send must remain closed after B enters.');
    const repeats = Math.floor((plan.durationFrames - echo.handoverFrame) / echo.delayFrames);
    check(repeats >= 1 && Math.pow(echo.feedback, repeats) <= 1e-4,
      'Echo tail budget does not allow the feedback to decay by 80 dB.');
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

// Runtime destinations never enter serializable plans or worker messages.
const echoReturns = new WeakMap<MixAutomation, AudioNode>();
/** Bind a fresh outgoing automation to the existing owner master. One graph consumes it. */
export function bindEchoReturn(plan: MixAutomation, master: AudioNode): void {
  check(!!plan.echo, 'Only an echo plan accepts a return binding.');
  check(!echoReturns.has(plan), 'Echo return is already bound.');
  echoReturns.set(plan, master);
}
export function unbindEchoReturn(plan: MixAutomation): void { echoReturns.delete(plan); }

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
  const master = echoReturns.get(plan);
  // Consume even a refused binding; callers must use a fresh plan for another commit.
  echoReturns.delete(plan);
  validateMixAutomation(plan, context.sampleRate);
  check(!plan.echo || master && master.context === context && master !== output,
    'Echo needs a bound master return in the owner context, outside A channel gain.');
  check(input.context === context && output.context === context, 'Mix nodes need the owner context.');
  check(Number.isSafeInteger(atFrame) && atFrame >= Math.ceil(context.currentTime * context.sampleRate),
    'Mix automation must begin on a future audio-clock frame.');
  const nodes: AudioNode[] = [];
  const own = <T extends AudioNode>(node: T): T => { nodes.push(node); return node; };
  let disposed = false, connected = false;
  let echoSend: GainNode | null = null;
  const cleanup = (restore: boolean): void => {
    if (disposed) return;
    disposed = true;
    try {
      if (connected) input.disconnect();
    } finally {
      for (const node of nodes) node.disconnect();
      if (connected && restore) input.connect(output);
    }
  };
  try {
    const dry = own(context.createGain()), wet = own(context.createGain());
    const shelf = own(context.createBiquadFilter()), hp = own(context.createBiquadFilter());
    const lp = own(context.createBiquadFilter());
    if (plan.echo) {
      const echo = plan.echo;
      echoSend = context.createGain(); nodes.push(echoSend);
      const delay = context.createDelay(Math.max(1, echo.delayFrames / context.sampleRate)); nodes.push(delay);
      const loopFilter = context.createBiquadFilter(); nodes.push(loopFilter);
      const feedback = context.createGain(); nodes.push(feedback);
      const echoReturn = context.createGain(); nodes.push(echoReturn);
      echoSend.gain.value = 0; echoReturn.gain.value = 0;
      delay.delayTime.value = echo.delayFrames / context.sampleRate;
      feedback.gain.value = echo.feedback;
      loopFilter.type = 'lowpass'; loopFilter.frequency.value = echo.lowPassHz; loopFilter.Q.value = MIX_FILTER_Q_DB;
      scheduleCurve(echoSend.gain, echo.send, atFrame, context.sampleRate);
      scheduleCurve(echoReturn.gain, echo.wet, atFrame, context.sampleRate);
      echoSend.connect(delay); delay.connect(loopFilter); loopFilter.connect(feedback); feedback.connect(delay);
      // This return bypasses A's automated dry/fader gain. The owner source lives through the tail.
      delay.connect(echoReturn); echoReturn.connect(master!);
    }
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
    if (echoSend) input.connect(echoSend);
  } catch (error) { cleanup(true); throw error; }
  return {restore: () => cleanup(true), release: () => cleanup(false)};
}

/** Brief complementary cut: parameter limits are engineering choices, not listening results. */
export function cleanCutAutomation(sampleRate: number, milliseconds = 10):
  {outgoing: MixAutomation; incoming: MixAutomation} {
  check(Number.isFinite(milliseconds) && milliseconds >= 5 && milliseconds <= 20,
    'A clean-cut ramp must be between 5 and 20 milliseconds.');
  const durationFrames = Math.max(1, Math.round(sampleRate * milliseconds / 1000));
  const neutral = {durationFrames, lowShelfDb: lane(durationFrames, 0), highPassHz: lane(durationFrames, 0),
    lowPassHz: lane(durationFrames, sampleRate / 2)};
  const outgoing: MixAutomation = {...neutral, gain: lane(durationFrames, 1, 0)};
  const incoming: MixAutomation = {...neutral, gain: lane(durationFrames, 0, 1)};
  validateMixAutomation(outgoing, sampleRate); validateMixAutomation(incoming, sampleRate);
  return {outgoing, incoming};
}

/** Two-beat send pre-roll, 150 ms dry exit, half-beat repeats and a two-bar tail.
 * The recorded source must retain enough original duration for the entire graph.
 * Cancel/Stop/release then use its existing MixAutomationGraph lifecycle unchanged.
 */
export function echoOutAutomation(bpm: number, sampleRate: number):
  {outgoing: MixAutomation; incoming: MixAutomation; preRollFrames: number; tailFrames: number} {
  check(Number.isFinite(bpm) && bpm >= 60 && bpm <= 180, 'Echo needs a supported reliable tempo.');
  const beatFrames = sampleRate * 60 / bpm;
  const preRollFrames = Math.round(2 * beatFrames), tailFrames = Math.round(8 * beatFrames);
  const durationFrames = preRollFrames + tailFrames, dryFade = Math.round(sampleRate * 0.15);
  const sendFade = Math.max(1, Math.round(sampleRate * 0.01)), tailFade = Math.max(1, Math.round(sampleRate * 0.02));
  const neutral = {durationFrames, lowShelfDb: lane(durationFrames, 0), highPassHz: lane(durationFrames, 0),
    lowPassHz: lane(durationFrames, sampleRate / 2)};
  const outgoing: MixAutomation = {...neutral,
    gain: [{frame:0,value:1},{frame:preRollFrames-dryFade,value:1},
      {frame:preRollFrames,value:0},{frame:durationFrames,value:0}],
    echo: {delayFrames:Math.round(beatFrames/2), feedback:0.3, lowPassHz:Math.min(5000,sampleRate*0.45),
      handoverFrame:preRollFrames,
      send:[{frame:0,value:0},{frame:sendFade,value:0.25},{frame:preRollFrames-sendFade,value:0.25},
        {frame:preRollFrames,value:0},{frame:durationFrames,value:0}],
      wet:[{frame:0,value:0},{frame:sendFade,value:1},{frame:durationFrames-tailFade,value:1},
        {frame:durationFrames,value:0}]}};
  const incoming: MixAutomation = {durationFrames:tailFrames, lowShelfDb:lane(tailFrames,0),
    highPassHz:lane(tailFrames,0), lowPassHz:lane(tailFrames,sampleRate/2),
    gain:[{frame:0,value:0},{frame:sendFade,value:1},{frame:tailFrames,value:1}]};
  validateMixAutomation(outgoing,sampleRate); validateMixAutomation(incoming,sampleRate);
  return {outgoing,incoming,preRollFrames,tailFrames};
}
