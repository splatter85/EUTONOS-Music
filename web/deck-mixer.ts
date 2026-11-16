/**
 * S20 set mixer. The existing SmallPlayer owns this graph and its audio clock.
 * Controls replace recipe lanes; no timer, new transport or audio source is introduced.
 */
import {BAND_BYPASS_SECONDS, createThreeBandSplit, MIX_FILTER_Q_DB, MIX_SHELF_HZ, mixCurveValue, validateMixAutomation,
  type MixAutomation, type MixAutomationGraph, type MixAutomationOwner, type MixAutomationPoint} from '../src/mix-automation.js';

export type DeckId = 'a' | 'b';
export type DeckControl = 'low' | 'mid' | 'high' | 'filter';
export interface ControlValue {readonly owner: 'dj' | 'you'; readonly value: number;}
export interface ChannelControls {
  readonly low: ControlValue; readonly mid: ControlValue; readonly high: ControlValue;
  readonly filter: ControlValue; readonly highPassHz: number; readonly lowPassHz: number;
  readonly gain: number;
}
const check = (ok: unknown, why: string): void => { if (!ok) throw new Error(why); };
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const frameNow = (context: BaseAudioContext): number => Math.ceil(context.currentTime * context.sampleRate);

/** Keeps a mathematical readback as well as native AudioParam scheduling, including slews. */
class Lane {
  private automatic: {at: number; points: readonly MixAutomationPoint[]} | null = null;
  private manual: number | null = null;
  private slew: {at: number; end: number; from: number; to: number} | null = null;
  constructor(private readonly context: BaseAudioContext, readonly parameter: AudioParam, readonly neutral: number) {
    parameter.value = neutral;
  }
  get owner(): 'dj' | 'you' { return this.manual === null ? 'dj' : 'you'; }
  manualValue(): number | null { return this.manual; }
  private autoValue(frame: number): number {
    return !this.automatic || frame < this.automatic.at ? this.neutral
      : mixCurveValue(this.automatic.points, frame - this.automatic.at);
  }
  value(frame = frameNow(this.context)): number {
    const s = this.slew;
    if (s && frame < s.end) return s.from + (s.to - s.from) * clamp((frame - s.at) / (s.end - s.at), 0, 1);
    return this.manual ?? this.autoValue(frame);
  }
  automaticState(): {at: number; points: readonly MixAutomationPoint[]} | null { return this.automatic; }
  setAutomatic(points: readonly MixAutomationPoint[] | null, at = 0): void {
    const before = this.value();
    this.automatic = points ? {points: points.map(p => ({...p})), at} : null;
    if (this.manual === null) this.schedule(before, false);
  }
  take(value: number): void {
    const before = this.value(); this.manual = value; this.schedule(before, true);
  }
  giveBack(): void {
    if (this.manual === null) return;
    const before = this.value(); this.manual = null; this.schedule(before, true);
  }
  private schedule(before: number, smooth: boolean): void {
    const now = frameNow(this.context), rate = this.context.sampleRate, p = this.parameter;
    p.cancelScheduledValues(now / rate);
    const end = smooth ? now + Math.max(1, Math.round(rate * 0.02)) : now;
    const target = this.manual ?? this.autoValue(end);
    p.setValueAtTime(smooth ? before : target, now / rate);
    this.slew = smooth ? {at: now, end, from: before, to: target} : null;
    if (smooth) p.linearRampToValueAtTime(target, end / rate);
    if (this.manual !== null || !this.automatic) return;
    const {points, at} = this.automatic;
    for (const [i, point] of points.entries()) {
      const frame = at + point.frame;
      if (frame <= end) continue;
      // First point is a boundary, not a ramp from "now" to a future mix start.
      if (i === 0) p.setValueAtTime(point.value, frame / rate);
      else if (point.curve === 'exponential') p.exponentialRampToValueAtTime(point.value, frame / rate);
      else p.linearRampToValueAtTime(point.value, frame / rate);
    }
  }
}

/** Direct-to-split handover at the start of band automation and back after its end. */
function bandRoute(duration: number, rate: number): {direct: MixAutomationPoint[]; split: MixAutomationPoint[]} {
  const fade = Math.max(1, Math.round(rate * BAND_BYPASS_SECONDS)), on = Math.min(fade, duration);
  const frames = [0, on, duration, duration + fade];
  return {direct: frames.map((frame, i) => ({frame, value: i === 0 || i === 3 ? 1 : 0})),
    split: frames.map((frame, i) => ({frame, value: i === 0 || i === 3 ? 0 : 1}))};
}

export function filterCutoffs(value: number, rate: number): {highPassHz: number; lowPassHz: number} {
  check(Number.isFinite(value) && value >= -1 && value <= 1, 'Filter must be between -1 and 1.');
  const nyquist = rate / 2, high = Math.min(8000, nyquist * 0.8);
  return {highPassHz: value <= 0 ? 0 : 20 * ((high / 20 + 1) ** value - 1),
    lowPassHz: value >= 0 ? nyquist : nyquist * (80 / nyquist) ** -value};
}
function filterPosition(hp: number, lp: number, rate: number): number {
  if (hp > 0) return clamp(Math.log(hp / 20 + 1) / Math.log(Math.min(8000, rate * 0.4) / 20 + 1), 0, 1);
  return lp >= rate / 2 ? 0 : -clamp(Math.log(Math.max(1, lp) / (rate / 2)) / Math.log(80 / (rate / 2)), 0, 1);
}

/** One persistent physical deck. A retired source's handle cannot clear a newer schedule. */
export class DeckChannel implements MixAutomationOwner {
  readonly input: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly fader: GainNode;
  private readonly lifetime: GainNode;
  private voiceToken = 0;
  private readonly lanes: {gain: Lane; low: Lane; mid: Lane; high: Lane; hp: Lane; lp: Lane};
  /** S21: DJ-owned LR4 band gains (neutral 1) and the deck's own echo send/return (neutral 0). */
  private readonly bandLanes: {low: Lane; mid: Lane; high: Lane};
  /** S21: the split is all-pass in phase, so it is only in the path while band lanes are scheduled. */
  private readonly routeLanes: {direct: Lane; split: Lane};
  private echo: {send: Lane; wet: Lane; delay: DelayNode; feedback: GainNode; loop: BiquadFilterNode} | null = null;
  private scope: AnalyserNode | null = null;
  private token = 0;
  private released = false;
  constructor(private readonly context: BaseAudioContext, private readonly destination: AudioNode) {
    check(destination.context === context, 'Deck output must use the owner context.');
    const own = <T extends AudioNode>(node: T): T => { this.nodes.push(node); return node; };
    this.input = own(context.createGain());
    const low = own(context.createBiquadFilter()), mid = own(context.createBiquadFilter()), high = own(context.createBiquadFilter());
    const hp = own(context.createBiquadFilter()), lp = own(context.createBiquadFilter());
    this.fader = own(context.createGain());
    this.lifetime = own(context.createGain()); this.lifetime.gain.value = 0;
    low.type = 'lowshelf'; low.frequency.value = MIX_SHELF_HZ;
    mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.7;
    high.type = 'highshelf'; high.frequency.value = Math.min(4000, context.sampleRate * 0.4);
    hp.type = 'highpass'; hp.Q.value = MIX_FILTER_Q_DB;
    lp.type = 'lowpass'; lp.Q.value = MIX_FILTER_Q_DB;
    this.lanes = {gain: new Lane(context, this.fader.gain, 1), low: new Lane(context, low.gain, 0),
      mid: new Lane(context, mid.gain, 0), high: new Lane(context, high.gain, 0),
      hp: new Lane(context, hp.frequency, 0), lp: new Lane(context, lp.frequency, context.sampleRate / 2)};
    // The LR4 split sums flat at unity (eq-choreography@1), after the manual EQ. Its phase is
    // all-pass, so a direct path carries the deck except while a choreography is scheduled.
    const splitOut = own(context.createGain()), direct = own(context.createGain());
    const split = createThreeBandSplit(context, splitOut);
    this.nodes.push(...split.nodes);
    this.routeLanes = {direct: new Lane(context, direct.gain, 1), split: new Lane(context, splitOut.gain, 0)};
    splitOut.connect(this.fader); direct.connect(this.fader);
    this.bandLanes = {low: new Lane(context, split.gains.low.gain, 1), mid: new Lane(context, split.gains.mid.gain, 1),
      high: new Lane(context, split.gains.high.gain, 1)};
    this.input.connect(low); low.connect(mid); mid.connect(high); high.connect(hp);
    hp.connect(lp); lp.connect(split.input); lp.connect(direct); this.fader.connect(this.lifetime); this.lifetime.connect(destination);
  }
  /** Echo send is taken from the deck input (as in the original owner graph) and returns to the
   * owner output directly, so its tail outlives this deck's lifetime gain and fader. Lazy. */
  private echoNodes(): NonNullable<DeckChannel['echo']> {
    if (this.echo) return this.echo;
    const context = this.context, own = <T extends AudioNode>(node: T): T => { this.nodes.push(node); return node; };
    const send = own(context.createGain()), delay = own(context.createDelay(2)), loop = own(context.createBiquadFilter());
    const feedback = own(context.createGain()), wet = own(context.createGain());
    loop.type = 'lowpass'; loop.Q.value = MIX_FILTER_Q_DB; loop.frequency.value = Math.min(5000, context.sampleRate * 0.45);
    feedback.gain.value = 0;
    this.input.connect(send); send.connect(delay); delay.connect(loop); loop.connect(feedback); feedback.connect(delay);
    delay.connect(wet); wet.connect(this.destination);
    this.echo = {send: new Lane(context, send.gain, 0), wet: new Lane(context, wet.gain, 0), delay, feedback, loop};
    return this.echo;
  }
  /** A per-voice lease keeps late cleanup from closing a newer song on this deck. */
  createOwner(): MixAutomationOwner & {setLifetime(start: number, end: number): void; releaseSource(): void} {
    const token = ++this.voiceToken;
    const current = (): boolean => !this.released && token === this.voiceToken;
    const silence = (): void => {
      const now = this.context.currentTime;
      this.lifetime.gain.cancelScheduledValues(now); this.lifetime.gain.setValueAtTime(0, now);
    };
    silence();
    return {
      schedule: (plan, at) => { check(current(), 'Stale deck voice.'); return this.schedule(plan, at); },
      setLifetime: (start, end) => {
        check(current() && Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start, 'Invalid deck lifetime.');
        const now = frameNow(this.context), rate = this.context.sampleRate, gain = this.lifetime.gain;
        gain.cancelScheduledValues(now / rate);
        gain.setValueAtTime(now >= start && now < end ? 1 : 0, now / rate);
        if (start > now) gain.setValueAtTime(1, start / rate);
        if (end > now) gain.setValueAtTime(0, end / rate);
      },
      releaseSource: () => { if (current()) { silence(); this.voiceToken++; } },
    };
  }
  schedule(plan: MixAutomation, atFrame: number): MixAutomationGraph {
    check(!this.released, 'Deck mixer is closed.');
    validateMixAutomation(plan, this.context.sampleRate);
    check(Number.isSafeInteger(atFrame) && atFrame >= frameNow(this.context), 'Deck automation needs a future owner-clock frame.');
    if (plan.echo) this.echoNodes();
    const lanes = this.scheduledLanes();
    const route = plan.bands ? bandRoute(plan.durationFrames, this.context.sampleRate) : null;
    const points = [plan.gain, plan.lowShelfDb, plan.highPassHz, plan.lowPassHz,
      plan.bands?.low ?? null, plan.bands?.mid ?? null, plan.bands?.high ?? null, route?.direct ?? null, route?.split ?? null,
      plan.echo?.send ?? null, plan.echo?.wet ?? null];
    if (plan.echo && this.echo) {
      const rate = this.context.sampleRate, at = atFrame / rate;
      this.echo.delay.delayTime.setValueAtTime(plan.echo.delayFrames / rate, at);
      this.echo.feedback.gain.setValueAtTime(plan.echo.feedback, at);
      this.echo.loop.frequency.setValueAtTime(plan.echo.lowPassHz, at);
    }
    const previous = lanes.map(lane => lane.automaticState());
    try { lanes.forEach((lane, i) => lane.setAutomatic(points[i] ?? null, atFrame)); }
    catch (error) {
      // A failed native parameter call must not leave a partial future exit on A.
      // Keep the previous handle valid until the entire replacement has succeeded.
      lanes.forEach((lane, i) => {
        try { lane.setAutomatic(previous[i]?.points ?? null, previous[i]?.at ?? 0); }
        catch { /* Preserve the first failure; the source owner still releases prepared B. */ }
      });
      throw error;
    }
    const token = ++this.token;
    let disposed = false;
    const reset = (): void => {
      if (disposed) return;
      disposed = true;
      if (this.released || token !== this.token) return;
      for (const lane of this.scheduledLanes()) lane.setAutomatic(null);
    };
    return {restore: reset, release: reset};
  }
  private scheduledLanes(): Lane[] {
    return [this.lanes.gain, this.lanes.low, this.lanes.hp, this.lanes.lp, this.bandLanes.low, this.bandLanes.mid,
      this.bandLanes.high, this.routeLanes.direct, this.routeLanes.split, ...(this.echo ? [this.echo.send, this.echo.wet] : [])];
  }
  /** S21 readback of the DJ-owned band gains (linear) for display and tests. */
  bandSnapshot(): {low: number; mid: number; high: number} {
    const frame = frameNow(this.context);
    return {low: this.bandLanes.low.value(frame), mid: this.bandLanes.mid.value(frame), high: this.bandLanes.high.value(frame)};
  }
  take(control: DeckControl, value: number): void {
    check(!this.released, 'Deck mixer is closed.');
    check(['low', 'mid', 'high', 'filter'].includes(control), 'Unknown deck control.');
    if (control === 'filter') {
      const {highPassHz, lowPassHz} = filterCutoffs(value, this.context.sampleRate);
      this.changeFilter(() => { this.lanes.hp.take(highPassHz); this.lanes.lp.take(lowPassHz); });
    } else {
      check(Number.isFinite(value) && value >= -24 && value <= 6, 'EQ must be between -24 and +6 dB.');
      this.lanes[control].take(value);
    }
  }
  /** A filter gesture owns two native lanes; a partial refusal cannot silently split ownership. */
  private changeFilter(change: () => void): void {
    const lanes = [this.lanes.hp, this.lanes.lp];
    const prior = lanes.map(lane => lane.manualValue());
    try { change(); }
    catch (error) {
      for (const [i, lane] of lanes.entries()) {
        try { if (prior[i] === null) lane.giveBack(); else lane.take(prior[i]!); }
        catch { /* Preserve the original native failure. */ }
      }
      throw error;
    }
  }
  giveBack(control: DeckControl): void {
    check(!this.released, 'Deck mixer is closed.');
    check(['low', 'mid', 'high', 'filter'].includes(control), 'Unknown deck control.');
    if (control === 'filter') this.changeFilter(() => { this.lanes.hp.giveBack(); this.lanes.lp.giveBack(); });
    else this.lanes[control].giveBack();
  }
  setFader(value: number | null): void {
    check(!this.released, 'Deck mixer is closed.');
    check(value === null || Number.isFinite(value) && value >= 0 && value <= 1, 'Deck fader must be between 0 and 1.');
    if (value === null) this.lanes.gain.giveBack(); else this.lanes.gain.take(value);
  }
  snapshot(): ChannelControls {
    const frame = frameNow(this.context), value = (lane: Lane): ControlValue => ({owner: lane.owner, value: lane.value(frame)});
    const hp = this.lanes.hp.value(frame), lp = this.lanes.lp.value(frame);
    return {low: value(this.lanes.low), mid: value(this.lanes.mid), high: value(this.lanes.high),
      filter: {owner: this.lanes.hp.owner, value: filterPosition(hp, lp, this.context.sampleRate)},
      highPassHz: hp, lowPassHz: lp, gain: this.lanes.gain.value(frame)};
  }
  /** An observational tap only; display sampling never schedules music. */
  waveform(target: Float32Array<ArrayBuffer>): void {
    check(!this.released, 'Deck mixer is closed.');
    if (!this.scope) {
      this.scope = this.context.createAnalyser(); this.scope.fftSize = 1024;
      this.scope.smoothingTimeConstant = 0;
      this.lifetime.connect(this.scope);
    }
    this.scope.getFloatTimeDomainData(target);
  }
  release(): void {
    if (this.released) return;
    this.released = true; this.token++;
    this.scope?.disconnect(); this.scope = null;
    for (const node of this.nodes) node.disconnect();
  }
}
export class DeckMixer {
  readonly a: DeckChannel;
  readonly b: DeckChannel;
  private manualCrossfader: number | null = null;
  constructor(context: BaseAudioContext, output: AudioNode) {
    this.a = new DeckChannel(context, output); this.b = new DeckChannel(context, output);
  }
  /** The two physical faders form one user control and must roll back together. */
  private changeCrossfader(value: number | null): void {
    const previous = this.manualCrossfader;
    const apply = (position: number | null): void => {
      this.a.setFader(position === null ? null : position === 1 ? 0 : Math.cos(position * Math.PI / 2));
      this.b.setFader(position === null ? null : position === 0 ? 0 : Math.sin(position * Math.PI / 2));
    };
    try { apply(value); this.manualCrossfader = value; }
    catch (error) {
      try { apply(previous); } catch { /* Preserve the original native failure. */ }
      this.manualCrossfader = previous;
      throw error;
    }
  }
  setCrossfader(value: number): void {
    check(Number.isFinite(value) && value >= 0 && value <= 1, 'Crossfader must be between 0 and 1.');
    this.changeCrossfader(value);
  }
  returnCrossfader(): void { this.changeCrossfader(null); }
  snapshot(active: readonly DeckId[]): {a: ChannelControls; b: ChannelControls; crossfader: ControlValue} {
    const a = this.a.snapshot(), b = this.b.snapshot();
    const ga = active.includes('a') ? a.gain : 0, gb = active.includes('b') ? b.gain : 0;
    return {a, b, crossfader: {owner: this.manualCrossfader === null ? 'dj' : 'you',
      value: this.manualCrossfader ?? (ga || gb ? Math.atan2(gb, ga) * 2 / Math.PI : 0.5)}};
  }
  release(): void { this.a.release(); this.b.release(); }
}
