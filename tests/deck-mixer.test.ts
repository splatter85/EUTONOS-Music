import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {loadBrowserPack, type LoadedBrowserPack} from '../src/browser-pack.js';
import {analyzeMixAudio, measureMixLevel, nativeSamplePeak} from '../src/mix-analysis.js';
import {bassSwapAutomation, type MixAutomation} from '../src/mix-automation.js';
import type {MixPreparationRuntime} from '../src/mix-transition.js';
import {SmallPlayer} from '../src/player.js';
import {renderFiniteLoop, renderTimePitch, type TimePitchMapping} from '../src/time-pitch.js';
import {DeckChannel, DeckMixer, filterCutoffs, type DeckControl} from '../web/deck-mixer.js';
import {deckPositionAt, type DeckPositionInput} from '../web/deck-readout.js';
import {ContextDouble, GainDouble, NodeDouble, ParameterDouble} from './audio-double.js';
import {buildSyntheticSet, decodePcm16, SYNTHETIC_SET} from './helpers/synthetic-set.js';

/** Evaluates the actual recorded AudioParam event list, not the mixer's diagnostic readback.
 * This is a deterministic scheduling double: no PCM, browser, device or listening claim. */
type Event = {kind: 'set' | 'linear' | 'exponential'; value: number; time: number};
class TimelineParameter extends ParameterDouble {
  private events: Event[] = [];
  override setValueAtTime(value: number, time: number): this {
    super.setValueAtTime(value, time); this.events.push({kind: 'set', value, time}); return this;
  }
  override linearRampToValueAtTime(value: number, time: number): this {
    super.linearRampToValueAtTime(value, time); this.events.push({kind: 'linear', value, time}); return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    assert.ok(value > 0, 'native exponential endpoint must be positive');
    this.events.push({kind: 'exponential', value, time}); return this;
  }
  override cancelScheduledValues(time: number): this {
    super.cancelScheduledValues(time); this.events = this.events.filter(event => event.time < time); return this;
  }
  valueAt(time: number): number {
    let previous = {time: 0, value: this.value};
    for (const event of [...this.events].sort((a, b) => a.time - b.time)) {
      if (event.time > time) {
        if (event.kind === 'set') return previous.value;
        const fraction = Math.max(0, (time - previous.time) / (event.time - previous.time));
        return event.kind === 'exponential'
          ? previous.value * (event.value / previous.value) ** fraction
          : previous.value + (event.value - previous.value) * fraction;
      }
      previous = event;
    }
    return previous.value;
  }
}
class TimelineGain extends GainDouble { override readonly gain = new TimelineParameter(); }
class Filter extends NodeDouble {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new TimelineParameter();
  readonly gain = new TimelineParameter();
  readonly Q = new TimelineParameter();
}
class DeckContext extends ContextDouble {
  readonly filters: Filter[] = [];
  override createGain(): GainNode {
    const gain = new TimelineGain(this.audio); this.gains.push(gain); return gain as unknown as GainNode;
  }
  createBiquadFilter(): BiquadFilterNode {
    const filter = new Filter(this.audio); this.filters.push(filter); return filter as unknown as BiquadFilterNode;
  }
}
const rate = 48000;
const near = (actual: number, expected: number, message = '', tolerance = 1e-8): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, message + ' actual=' + actual + ' expected=' + expected);
const time = (context: DeckContext, seconds: number): void => { context.currentTime = seconds; };
function setup() {
  const context = new DeckContext(rate), channel = new DeckChannel(context.audio, context.destination);
  const lifetime = context.gains.find(gain => gain.connections.includes(context.destination)) as TimelineGain;
  const fader = context.gains.find(gain => gain.connections.includes(lifetime as unknown as AudioNode)) as TimelineGain;
  assert.ok(lifetime && fader && lifetime !== fader);
  return {context, channel, lifetime: lifetime.gain, fader: fader.gain,
    low: context.filters[0]!.gain, hp: context.filters[3]!.frequency, lp: context.filters[4]!.frequency};
}
const plan = (): MixAutomation => ({durationFrames: 2 * rate,
  gain: [{frame: 0, value: 1}, {frame: 2 * rate, value: 0}],
  lowShelfDb: [{frame: 0, value: 0}, {frame: 2 * rate, value: -24}],
  highPassHz: [{frame: 0, value: 0}, {frame: 2 * rate, value: 1000}],
  lowPassHz: [{frame: 0, value: rate / 2}, {frame: 2 * rate, value: 100}]});

test('deck automatic lanes preserve scheduled boundaries and execute the actual parameter curves', () => {
  const {context, channel, fader, low, hp, lp} = setup();
  channel.schedule(plan(), rate);
  near(fader.valueAt(0.5), 1); near(low.valueAt(0.5), 0); near(hp.valueAt(0.5), 0);
  for (const seconds of [1, 1.5, 2, 2.5, 3]) {
    time(context, seconds);
    const fraction = (seconds - 1) / 2, snapshot = channel.snapshot();
    near(fader.valueAt(seconds), 1 - fraction); near(snapshot.gain, fader.valueAt(seconds));
    near(low.valueAt(seconds), -24 * fraction); near(snapshot.low.value, low.valueAt(seconds));
    near(hp.valueAt(seconds), 1000 * fraction); near(snapshot.highPassHz, hp.valueAt(seconds));
    near(lp.valueAt(seconds), rate / 2 + (100 - rate / 2) * fraction);
    assert.equal(snapshot.low.owner, 'dj'); assert.equal(snapshot.filter.owner, 'dj');
  }
});

test('manual controls taken before a later plan remain owned and are not overwritten by its events', () => {
  const {context, channel, fader, low, hp, lp} = setup();
  channel.take('low', -9); channel.take('filter', -0.6); channel.setFader(0.3);
  time(context, 0.1);
  channel.schedule(plan(), 2 * rate);
  const cutoffs = filterCutoffs(-0.6, rate);
  for (const seconds of [1, 2, 3, 4, 5]) {
    time(context, seconds); const snapshot = channel.snapshot();
    near(fader.valueAt(seconds), 0.3); near(low.valueAt(seconds), -9);
    near(hp.valueAt(seconds), cutoffs.highPassHz); near(lp.valueAt(seconds), cutoffs.lowPassHz);
    assert.equal(snapshot.low.owner, 'you'); assert.equal(snapshot.filter.owner, 'you');
    assert.equal(snapshot.mid.owner, 'dj'); assert.equal(snapshot.high.owner, 'dj');
  }
});

test('manual takeover in a ramp and repeated gestures preserve the current native parameter value', () => {
  const {context, channel, fader} = setup();
  channel.schedule(plan(), rate);
  time(context, 2); near(fader.valueAt(2), 0.5);
  channel.setFader(0.2); near(fader.valueAt(2), 0.5);
  time(context, 2.01); near(fader.valueAt(2.01), 0.35); near(channel.snapshot().gain, 0.35);
  channel.setFader(0.8); near(fader.valueAt(2.01), 0.35);
  near(fader.valueAt(2.02), 0.575); near(fader.valueAt(2.03), 0.8);
  time(context, 4); near(channel.snapshot().gain, 0.8); near(fader.valueAt(4), 0.8);
});

test('explicit handback joins the current automatic curve rather than replaying its beginning', () => {
  const {context, channel, low} = setup();
  channel.schedule(plan(), rate);
  time(context, 1.5); channel.take('low', 6);
  time(context, 2); near(low.valueAt(2), 6); channel.giveBack('low');
  near(low.valueAt(2), 6);
  near(low.valueAt(2.02), -12.24); near(low.valueAt(2.5), -18); near(low.valueAt(3), -24);
  time(context, 2.5); assert.equal(channel.snapshot().low.owner, 'dj'); near(channel.snapshot().low.value, -18);
});

test('filter handback resumes an exponential remainder on the owner clock', () => {
  const {context, channel, hp} = setup();
  const exponential = {...plan(), highPassHz: [{frame: 0, value: 100},
    {frame: 2 * rate, value: 1600, curve: 'exponential' as const}]};
  channel.schedule(exponential, rate);
  near(hp.valueAt(2), 400);
  time(context, 1.5); channel.take('filter', 0.7);
  time(context, 2); const manual = hp.valueAt(2); channel.giveBack('filter');
  near(hp.valueAt(2), manual);
  near(hp.valueAt(2.02), 100 * 16 ** 0.51);
  near(hp.valueAt(2.5), 800); near(hp.valueAt(3), 1600);
  time(context, 2.5); near(channel.snapshot().highPassHz, 800);
  assert.equal(channel.snapshot().filter.owner, 'dj');
});

test('handback before a future boundary holds neutral until that boundary', () => {
  const {context, channel, fader, hp} = setup();
  const incoming = bassSwapAutomation(rate, rate).incoming;
  channel.setFader(0.2); channel.take('filter', 0.5);
  time(context, 1); channel.schedule(incoming, 5 * rate);
  time(context, 2); channel.setFader(null); channel.giveBack('filter');
  near(fader.valueAt(2.1), 1); near(fader.valueAt(4.99), 1); near(hp.valueAt(4.99), 0);
  near(fader.valueAt(5), 0); near(hp.valueAt(5), 500);
  near(fader.valueAt(5.5), 0.5); near(hp.valueAt(5.5), 0);
});

test('handback after the curve end restores its endpoint and leaves other controls manual', () => {
  const {context, channel, fader, low} = setup();
  channel.schedule(plan(), rate); channel.setFader(0.8); channel.take('low', -4);
  time(context, 4); channel.setFader(null);
  near(fader.valueAt(4.02), 0); near(low.valueAt(5), -4);
  assert.equal(channel.snapshot().low.owner, 'you');
});

test('a retired automation handle cannot reset a newer automatic schedule', () => {
  const {context, channel, low} = setup();
  const old = channel.schedule(plan(), rate);
  time(context, 0.5);
  const replacement = {...plan(), lowShelfDb: [{frame: 0, value: -12}, {frame: 2 * rate, value: 0}]};
  channel.schedule(replacement, 2 * rate);
  const calls = low.calls.length;
  old.restore(); old.release();
  assert.equal(low.calls.length, calls, 'stale handle must not touch the new AudioParam schedule');
  near(low.valueAt(3), -6); time(context, 3); near(channel.snapshot().low.value, -6);
});

test('voice lifetime gating remains independent of a manually open fader', () => {
  const {context, channel, lifetime, fader} = setup();
  const owner = channel.createOwner();
  owner.setLifetime(rate, 3 * rate); channel.setFader(1);
  near(lifetime.valueAt(0.5), 0); near(lifetime.valueAt(2), 1); near(lifetime.valueAt(3), 0);
  near(fader.valueAt(4), 1, 'manual fader cannot extend a source lifetime');
  time(context, 2); owner.releaseSource();
  near(lifetime.valueAt(2), 0); near(lifetime.valueAt(2.5), 0); near(fader.valueAt(2.5), 1);
});

test('late cleanup from an old voice cannot close a newer voice on the same physical deck', () => {
  const {context, channel, lifetime} = setup();
  const old = channel.createOwner(); old.setLifetime(rate, 3 * rate);
  time(context, 0.5);
  const next = channel.createOwner(); next.setLifetime(2 * rate, 6 * rate);
  const calls = lifetime.calls.length; old.releaseSource();
  assert.equal(lifetime.calls.length, calls);
  near(lifetime.valueAt(1), 0); near(lifetime.valueAt(4), 1); near(lifetime.valueAt(6), 0);
  assert.throws(() => old.schedule(plan(), 2 * rate), /stale/i);
  assert.throws(() => old.setLifetime(rate, 7 * rate), /invalid/i);
});

test('manual lane ownership survives cancellation, lease release and a new source lease', () => {
  const {context, channel, low, hp} = setup();
  channel.take('low', -7); channel.take('mid', 3); channel.take('filter', 0.3);
  const first = channel.createOwner(); first.setLifetime(rate, 5 * rate);
  const handle = first.schedule(plan(), 2 * rate);
  time(context, 0.5); handle.restore(); first.releaseSource();
  const second = channel.createOwner(); second.setLifetime(rate, 8 * rate);
  second.schedule(plan(), 3 * rate);
  time(context, 4); near(low.valueAt(4), -7); near(hp.valueAt(4), filterCutoffs(0.3, rate).highPassHz);
  for (const name of ['low', 'mid', 'filter'] as const) assert.equal(channel.snapshot()[name].owner, 'you');
  channel.giveBack('mid'); assert.equal(channel.snapshot().mid.owner, 'dj');
  assert.equal(channel.snapshot().low.owner, 'you'); assert.equal(channel.snapshot().filter.owner, 'you');
});

test('crossfader replaces both automatic gain lanes and hands each back to its current trajectory', () => {
  const context = new DeckContext(rate), mixer = new DeckMixer(context.audio, context.destination);
  const pair = bassSwapAutomation(2 * rate, rate);
  mixer.a.schedule(pair.outgoing, rate); mixer.b.schedule(pair.incoming, rate);
  time(context, 2); mixer.setCrossfader(0.25);
  time(context, 2.1);
  let snap = mixer.snapshot(['a', 'b']);
  near(snap.a.gain, Math.cos(Math.PI / 8)); near(snap.b.gain, Math.sin(Math.PI / 8));
  assert.deepEqual(snap.crossfader, {owner: 'you', value: 0.25});
  mixer.returnCrossfader(); time(context, 2.5); snap = mixer.snapshot(['a', 'b']);
  near(snap.a.gain, 0.25); near(snap.b.gain, 0.75); assert.equal(snap.crossfader.owner, 'dj');
  near(mixer.snapshot(['b']).crossfader.value, 1, 'an empty deck does not bias automatic display');
});

test('filter take and handback restore both lanes when the second native parameter refuses', () => {
  const {context, channel, hp, lp} = setup();
  const original = lp.setValueAtTime.bind(lp);
  const refuseOnce = (): void => {
    let armed = true;
    lp.setValueAtTime = ((value: number, at: number) => {
      if (armed) { armed = false; throw new Error('injected LP parameter failure'); }
      return original(value, at);
    }) as typeof lp.setValueAtTime;
  };
  refuseOnce();
  assert.throws(() => channel.take('filter', 0.5), /injected LP parameter failure/);
  time(context, 0.1);
  assert.equal(channel.snapshot().filter.owner, 'dj');
  near(hp.valueAt(0.1), 0); near(lp.valueAt(0.1), rate / 2);
  channel.take('filter', -0.5);
  time(context, 0.2);
  const previous = channel.snapshot();
  refuseOnce();
  assert.throws(() => channel.giveBack('filter'), /injected LP parameter failure/);
  time(context, 0.3);
  assert.equal(channel.snapshot().filter.owner, 'you');
  near(channel.snapshot().filter.value, previous.filter.value);
  near(hp.valueAt(0.3), previous.highPassHz);
  near(lp.valueAt(0.3), previous.lowPassHz);
});

test('crossfader take and handback preserve prior ownership after a partial native failure', () => {
  const context = new DeckContext(rate), mixer = new DeckMixer(context.audio, context.destination);
  const bFader = context.gains[4] as TimelineGain;
  assert.ok(bFader, 'B fader is the second deck bus');
  const original = bFader.gain.setValueAtTime.bind(bFader.gain);
  const refuseOnce = (): void => {
    let armed = true;
    bFader.gain.setValueAtTime = ((value: number, at: number) => {
      if (armed) { armed = false; throw new Error('injected B fader failure'); }
      return original(value, at);
    }) as typeof bFader.gain.setValueAtTime;
  };
  refuseOnce();
  assert.throws(() => mixer.setCrossfader(0.75), /injected B fader failure/);
  time(context, 0.1);
  assert.equal(mixer.snapshot(['a', 'b']).crossfader.owner, 'dj');
  near(mixer.snapshot(['a', 'b']).a.gain, 1);
  near(mixer.snapshot(['a', 'b']).b.gain, 1);
  mixer.setCrossfader(0.3);
  time(context, 0.2);
  refuseOnce();
  assert.throws(() => mixer.returnCrossfader(), /injected B fader failure/);
  time(context, 0.3);
  const snap = mixer.snapshot(['a', 'b']);
  assert.deepEqual(snap.crossfader, {owner: 'you', value: 0.3});
  near(snap.a.gain, Math.cos(0.3 * Math.PI / 2));
  near(snap.b.gain, Math.sin(0.3 * Math.PI / 2));
});

test('invalid manual inputs are rejected before they change AudioParam schedules', () => {
  const {context, channel, fader, low} = setup();
  for (const invalid of [NaN, Infinity, -Infinity, -1, 1.01]) {
    const before = fader.calls.length; assert.throws(() => channel.setFader(invalid));
    assert.equal(fader.calls.length, before);
  }
  for (const invalid of [NaN, Infinity, -24.01, 6.01]) {
    const before = low.calls.length; assert.throws(() => channel.take('low', invalid)); assert.equal(low.calls.length, before);
  }
  for (const invalid of [NaN, Infinity, -1.01, 1.01]) assert.throws(() => channel.take('filter', invalid));
  assert.throws(() => channel.take('unknown' as DeckControl, 0));
  assert.throws(() => channel.giveBack('unknown' as DeckControl));
  time(context, 1); assert.throws(() => channel.schedule(plan(), 0));
  const owner = channel.createOwner();
  assert.throws(() => owner.setLifetime(2, 1)); assert.throws(() => owner.setLifetime(0.5, 100));
  channel.release(); assert.throws(() => channel.take('low', 0)); assert.throws(() => channel.setFader(0.5));
});

const position = (overrides: Partial<DeckPositionInput> = {}): DeckPositionInput => ({
  frame: 1000, start: 100, offset: 300, nativeFrames: 10000, mapping: null, entryRate: null, ...overrides,
});
test('deck position uses each native entry offset and clamps before start and after EOF', () => {
  assert.deepEqual(deckPositionAt(position()), {sourceFrame: 1200, speed: 1, pitchSemitones: 0, pitchMode: 'original'});
  assert.equal(deckPositionAt(position({frame: 50})).sourceFrame, 300);
  assert.equal(deckPositionAt(position({frame: 20000})).sourceFrame, 10000);
});

test('processed entry maps source coordinates and joins native PCM without moving the displayed playhead', () => {
  const mapping: TimePitchMapping = {inputFrames: 10000, outputFrames: 9880, tempoRatio: 1.08,
    pitchSemitones: 1.5, returnToOriginal: {afterFrames: 1000, rampFrames: 1000}};
  const base = position({start: 100, offset: 0, mapping, sourceStartFrame: 2000,
    nativeJoin: {sourceFrame: 4120, outputFrame: 2000}});
  const inRamp = deckPositionAt({...base, frame: 1600});
  assert.equal(inRamp.sourceFrame, 3610); near(inRamp.speed, 1.04);
  assert.equal(inRamp.pitchSemitones, 1.5); assert.equal(inRamp.pitchMode, 'independent');
  const before = deckPositionAt({...base, frame: 2099});
  const join = deckPositionAt({...base, frame: 2100});
  const after = deckPositionAt({...base, frame: 2101});
  assert.equal(before.sourceFrame, 4119);
  assert.deepEqual(join, {sourceFrame: 4120, speed: 1, pitchSemitones: 0, pitchMode: 'original'});
  assert.equal(after.sourceFrame, 4121);
});

test('native-rate entry readout integrates its ramp and distinguishes rate-linked pitch from native playback', () => {
  const base = position({start: 100, offset: 300, entryRate: {start: 1.2, end: 1, frames: 1000}});
  const during = deckPositionAt({...base, frame: 600});
  near(during.sourceFrame, 875); near(during.speed, 1.1);
  near(during.pitchSemitones, 12 * Math.log2(1.1)); assert.equal(during.pitchMode, 'rate-linked');
  const after = deckPositionAt({...base, frame: 1600});
  near(after.sourceFrame, 1900); near(after.speed, 1); near(after.pitchSemitones, 0);
  assert.equal(after.pitchMode, 'original');
});

test('outgoing tempo-ramp and brake readout use committed effect time and source position', () => {
  const motion = {at: 1000, sourceFrame: 4000, rate: {start: 1, end: 1.2, frames: 1000}};
  const ramp = deckPositionAt(position({frame: 1500, motion}));
  near(ramp.sourceFrame, 4525); near(ramp.speed, 1.1);
  near(ramp.pitchSemitones, 12 * Math.log2(1.1)); assert.equal(ramp.pitchMode, 'rate-linked');
  const brake = deckPositionAt(position({frame: 1500,
    motion: {...motion, rate: {start: 1, end: 0.05, frames: 1000}}}));
  near(brake.sourceFrame, 4381.25); near(brake.speed, 0.525);
  near(brake.pitchSemitones, 12 * Math.log2(0.525)); assert.equal(brake.pitchMode, 'rate-linked');
});

test('finite-loop display repeats the bounded interval once then advances into the native tail', () => {
  const base = position({motion: {at: 1000, sourceFrame: 4000, loopFrames: 800}});
  assert.equal(deckPositionAt({...base, frame: 1000}).sourceFrame, 3200);
  assert.equal(deckPositionAt({...base, frame: 1400}).sourceFrame, 3600);
  assert.equal(deckPositionAt({...base, frame: 1800}).sourceFrame, 4000);
  assert.equal(deckPositionAt({...base, frame: 2200}).sourceFrame, 4400, 'finite repetition must not wrap forever');
  assert.deepEqual(deckPositionAt({...base, frame: 1800}),
    {sourceFrame: 4000, speed: 1, pitchSemitones: 0, pitchMode: 'original'});
});

function audioBuffer(sampleRate: number, channels: Float32Array[]): AudioBuffer {
  return {sampleRate, length: channels[0]!.length, duration: channels[0]!.length / sampleRate,
    numberOfChannels: channels.length, getChannelData: (index: number) => channels[index]!,
    copyToChannel: (source: Float32Array, index: number) => { channels[index]!.set(source); }} as AudioBuffer;
}
/** Generates and decodes only redistributable test PCM, never owner audio. */
class SetContext extends DeckContext {
  constructor() { super(16000); }
  createBuffer(count: number, frames: number, sampleRate: number): AudioBuffer {
    return audioBuffer(sampleRate, Array.from({length: count}, () => new Float32Array(frames)));
  }
  override async decodeAudioData(input: ArrayBuffer): Promise<AudioBuffer> {
    const pcm = decodePcm16(new Uint8Array(input)); assert.equal(pcm.sampleRate, this.sampleRate);
    return audioBuffer(this.sampleRate, pcm.channels);
  }
}
const runtime: MixPreparationRuntime = {
  analyze: async (from, to) => ({from: analyzeMixAudio(from), to: analyzeMixAudio(to)}),
  analyzeOne: async (audio, _signal, options, levelAudio) =>
    ({...analyzeMixAudio(audio, options), level: measureMixLevel(levelAudio ?? audio)}),
  scanPeak: async audio => nativeSamplePeak(audio),
  render: async (audio, options) => renderTimePitch(audio, options),
  renderLoop: async (audio, loop, tail, bars, gain) => renderFiniteLoop(audio, loop, tail, bars, gain),
};
async function loadSet(set: Awaited<ReturnType<typeof buildSyntheticSet>>): Promise<LoadedBrowserPack> {
  const fetcher = (async (input: string | URL | Request) => {
    const path = decodeURIComponent(new URL(String(input)).pathname).slice(1).split('/');
    return new Response(new Uint8Array(await readFile(join(set.out, ...path))));
  }) as typeof fetch;
  return loadBrowserPack(new URL('http://localhost/pack/manifest.json'), false, fetcher, {allowUnreviewed: true, set: true});
}

test('set player keeps physical deck identity and manual ownership through cancellation, settlement, pause and Stop', async () => {
  const set = await buildSyntheticSet();
  let player: SmallPlayer | undefined;
  try {
    const loaded = await loadSet(set), context = new SetContext();
    player = new SmallPlayer(context.audio, loaded, null, runtime);
    const [s128a, s122, s90, s128b] = SYNTHETIC_SET.map(song => set.idFor(song.id));
    player.setDeckControl('a', 'low', -8); player.setDeckControl('b', 'mid', 3); player.setCrossfader(0.2);
    await player.playAsset(s90!); context.advance(0.5);
    const master = context.gains[0] as TimelineGain;
    const stream = player.createStreamTap();
    assert.equal(player.createStreamTap(), stream); assert.equal(context.streamTaps.length, 1);
    assert.deepEqual(master.connections, [context.destination, context.streamTaps[0]]);
    let decks = player.deckSnapshot()!;
    assert.equal(decks.a.assetId, s90); assert.equal(decks.b.assetId, null);
    const owners = (): void => {
      const current = player!.deckSnapshot()!;
      assert.equal(current.a.controls.low.owner, 'you'); assert.equal(current.b.controls.mid.owner, 'you');
      assert.deepEqual(current.crossfader, {owner: 'you', value: 0.2});
    };
    await player.scheduleMixTo(s128a!, {bars: 4, anchor: 'song'});
    decks = player.deckSnapshot()!; assert.equal(decks.b.assetId, s128a); owners();
    assert.equal(player.cancelPendingTransition(), true, 'same cancellation seam used by queue reorder');
    decks = player.deckSnapshot()!; assert.equal(decks.a.assetId, s90); assert.equal(decks.b.assetId, null); owners();

    await player.scheduleMixTo(s128a!, {bars: 4, anchor: 'song'});
    const scheduled = player.snapshot();
    context.advance((scheduled.transitionEnd!.frame - player.clock.currentFrame) / context.sampleRate + 0.01);
    assert.equal(player.snapshot().voices.length, 1);
    decks = player.deckSnapshot()!;
    assert.equal(decks.a.assetId, null); assert.equal(decks.b.assetId, s128a, 'settled B keeps physical deck B'); owners();
    await player.scheduleMixTo(s122!, {bars: 4, anchor: 'song'});
    decks = player.deckSnapshot()!;
    assert.equal(decks.a.assetId, s122, 'following incoming song uses the now-free A deck');
    assert.equal(decks.b.assetId, s128a);
    assert.equal(player.cancelPendingTransition(), true); owners();

    const sources = context.sources.length;
    await player.pause(); const frozen = player.clock.currentFrame;
    context.advance(10); assert.equal(player.clock.currentFrame, frozen); owners();
    await player.resume(); assert.equal(context.sources.length, sources, 'resume keeps the existing source timeline'); owners();
    player.setMuted(true); player.setDeckControl('a', 'high', 6);
    near(master.gain.valueAt(context.currentTime), 0, 'deck controls cannot bypass master mute');
    assert.deepEqual(master.connections, [context.destination, context.streamTaps[0]]);
    player.setMuted(false); near(master.gain.valueAt(context.currentTime), 0.65);

    player.stop(); near(master.gain.valueAt(context.currentTime), 0); owners();
    assert.equal(player.deckSnapshot()!.a.assetId, null); assert.equal(player.deckSnapshot()!.b.assetId, null);
    await player.playAsset(s128b!); context.advance(0.2); owners();
    decks = player.deckSnapshot()!; assert.equal(decks.a.assetId, s128b); assert.equal(decks.b.assetId, null);
    near(decks.a.controls.low.value, -8); near(decks.b.controls.mid.value, 3);
    await player.dispose();
    assert.equal(context.closeCalls, 1); assert.deepEqual(context.streamTaps[0]!.stoppedTracks, [0]);
    assert.equal(master.connections.length, 0);
  } finally {
    await player?.dispose();
    await set.cleanup();
  }
});
