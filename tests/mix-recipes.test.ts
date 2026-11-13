import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, type MixAnalysis, type MixPointCandidate} from '../src/mix-analysis.js';
import {automaticMixCandidates, planAutomaticMix, type MixPlannerOptions} from '../src/mix-planner.js';
import {bindEchoReturn, cleanCutAutomation, createMixAutomationGraph, echoOutAutomation,
  mixCurveValue, validateMixAutomation} from '../src/mix-automation.js';
import {SmallPlayer} from '../src/player.js';
import {prepareMixTransition, type MixPreparationRuntime} from '../src/mix-transition.js';
import {ContextDouble, NodeDouble, ParameterDouble, deferred, fixturePack} from './audio-double.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';

const rate = 16000;
const base = analyzeMixAudio(makeMixFixture({sampleRate: rate}));
function evidence(frames: number, exits = [4, 8]): MixAnalysis {
  const cue = (seconds: number): MixPointCandidate => ({frame: seconds * rate, seconds,
    confidence: 0.9, score: 1 - seconds / 100, reasons: ['Controlled recipe eligibility fixture.'],
    evidence: {kind: seconds === 0 ? 'track-start' : 'boundary', boundary: 0.9, period: 0.9,
      salience: 0.9, interference: 0.1, windowEndFrame: Math.min(frames, (seconds + 1) * rate),
      chroma: Array(12).fill(0)}});
  return {...base, frames, tempo: {...base.tempo, bpm: 120, confidence: 0.9, ambiguity: 0},
    beatGrid: {...base.beatGrid, confidence: 0.9},
    key: {...base.key, tonic: null, mode: null, confidence: 0},
    structure: {...base.structure, downbeatConfidence: 0.9, phraseConfidence: 0.5,
      downbeatFrames: [0, 2, 4, 8, 10].map(s => s * rate)},
    mixOut: exits.map(cue), mixIn: [cue(0), cue(2)]};
}
const a = evidence(16 * rate), b = {...a, tempo: {...a.tempo, bpm: 170}};
const echo: MixPlannerOptions = {recipe: 'echo-out', echoContentConfirmed: true};
test('good timing and unknown/distant key admit native cut/echo with a bounded deterministic shortlist', () => {
  for (const options of [{}, {recipe: 'cut'}, echo] as const) {
    const plan = planAutomaticMix(a, b, options);
    assert.equal(plan.kind, 'mix');
    if (plan.kind !== 'mix') return;
    assert.equal(plan.recipe, options.recipe ?? 'cut');
    assert.equal(plan.tempoRatio, 1); assert.equal(plan.pitchSemitones, 0);
    assert.equal(plan.harmonic.relation, 'unknown'); assert.equal(plan.harmonic.circleDistance, null);
  }
  const plans = automaticMixCandidates(a, b, {echoContentConfirmed: true});
  assert.ok(plans.length > 1 && plans.length <= 6);
  assert.deepEqual(plans, automaticMixCandidates(a, b, {echoContentConfirmed: true}));
  assert.ok(plans.some(p => p.recipe === 'cut') && plans.some(p => p.recipe === 'echo-out'));
  const distant = {...b, key: {...base.key, tonic: 10, confidence: 0.9}};
  const known = {...a, key: {...base.key, tonic: 9, confidence: 0.9}};
  const plan = planAutomaticMix(known, distant);
  assert.ok(plan.kind === 'mix' && plan.recipe === 'cut' && plan.harmonic.relation === 'distant');
});
test('new recipes retain timing, strong cue, option and content refusals', () => {
  for (const options of [{recipe: 'echo-out'}, {...echo, pitchSemitones: 1},
    {...echo, returnToOriginalTempo: true}, {recipe: 'cut', pitchSemitones: 1},
    {recipe: 'other'}, {recipe: 'cut', pitchSemitones: NaN}] as MixPlannerOptions[]) {
    assert.equal(planAutomaticMix(a, b, options).kind, 'fallback');
  }
  for (const patch of [
    {tempo: {...a.tempo, ambiguity: 0.8}}, {beatGrid: {...a.beatGrid, confidence: 0.1}},
    {structure: {...a.structure, downbeatConfidence: 0.2}},
    {mixIn: a.mixIn.map(c => ({...c, evidence: {...c.evidence!, salience: 0.1}}))},
  ]) assert.equal(planAutomaticMix(a, {...b, ...patch}, {recipe: 'cut'}).kind, 'fallback');
  assert.equal(planAutomaticMix({...a, mixOut: a.mixOut.map(c =>
    ({...c, evidence: {...c.evidence!, interference: 0.8}}))}, b, echo).kind, 'fallback');
  assert.equal(planAutomaticMix(a, {...b, vocalSpans: [{startFrame: 0, endFrame: b.frames}]}, echo).kind, 'fallback');
});
test('echo S/T/E reserves original A and prepared native B through E and minimum refers to S', () => {
  const plan = planAutomaticMix(a, b, {...echo, minimumFromFrame: 4 * rate});
  assert.ok(plan.kind === 'mix' && plan.recipe === 'echo-out');
  if (plan.kind !== 'mix') return;
  assert.equal(plan.fromExitFrame, 8 * rate);
  assert.equal(plan.preRollFrames, rate); assert.equal(plan.overlapFrames, 4 * rate);
  assert.equal(plan.automation.outgoing.durationFrames, 5 * rate);
  assert.equal(plan.fromExitFrame - plan.preRollFrames, 7 * rate);
  assert.equal(plan.automation.outgoing.echo!.handoverFrame, rate);
  const only = {...a, mixOut: [a.mixOut[0]!], frames: 8 * rate - 1};
  assert.equal(planAutomaticMix(only, b, echo).kind, 'fallback');
  assert.equal(planAutomaticMix(a, {...b, frames: 4 * rate - 1, mixIn: [b.mixIn[0]!]}, echo).kind, 'fallback');
});
test('cut complementarity, echo finite feedback/decay and Nyquist bounds', () => {
  for (const sampleRate of [8000, 44100, 48000]) {
    for (const ms of [5, 10, 20]) {
      const cut = cleanCutAutomation(sampleRate, ms);
      for (let f = 0; f <= cut.outgoing.durationFrames; f++) {
        assert.ok(Math.abs(mixCurveValue(cut.outgoing.gain, f) + mixCurveValue(cut.incoming.gain, f) - 1) < 1e-12);
      }
    }
    const plan = echoOutAutomation(120, sampleRate).outgoing;
    assert.ok(plan.echo!.lowPassHz <= sampleRate * 0.45);
    for (const feedback of [NaN, -1, 0.9, 1, 1.1]) assert.throws(() =>
      validateMixAutomation({...plan, echo: {...plan.echo!, feedback}}, sampleRate));
  }
  for (const ms of [0, 4.9, 20.1, NaN]) assert.throws(() => cleanCutAutomation(rate, ms));
});
class Filter extends NodeDouble {
  type: BiquadFilterType = 'lowpass'; frequency = new ParameterDouble();
  Q = new ParameterDouble(); gain = new ParameterDouble();
}
class Delay extends NodeDouble { delayTime = new ParameterDouble(); }
function buffer(frames: number, channels: number, sampleRate: number): AudioBuffer {
  const data = Array.from({length: channels}, () => new Float32Array(frames));
  return {sampleRate, length: frames, duration: frames / sampleRate, numberOfChannels: channels,
    getChannelData: (i: number) => data[i]!, copyToChannel: (c: Float32Array, i: number) => data[i]!.set(c)} as AudioBuffer;
}
class Context extends ContextDouble {
  filters: Filter[] = []; delays: Delay[] = [];
  constructor() { super(rate); }
  createBiquadFilter(): BiquadFilterNode {
    const n = new Filter(this.audio); this.filters.push(n); return n as unknown as BiquadFilterNode;
  }
  createDelay(): DelayNode { const n = new Delay(this.audio); this.delays.push(n); return n as unknown as DelayNode; }
  createBuffer(channels: number, frames: number, r: number) { return buffer(frames, channels, r); }
  override async decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const shape = await super.decodeAudioData(bytes), result = buffer(shape.length, shape.numberOfChannels, rate);
    for (let c = 0; c < result.numberOfChannels; c++) result.getChannelData(c).fill(0.1);
    return result;
  }
}
function released(c: Context, start = 0) {
  assert.ok([...c.filters, ...c.delays, ...c.gains.slice(start)].every(n => n.connections.length === 0));
}
test('echo binding refuses missing/wrong context/channel return before mutation; consumed binding cannot leak', () => {
  const c = new Context(), input = c.createBufferSource(), outer = c.createGain();
  input.connect(outer); const plan = echoOutAutomation(120, rate).outgoing;
  assert.throws(() => createMixAutomationGraph(c.audio, input, outer, rate, plan), /bound master/);
  assert.equal(c.gains.length, 1);
  bindEchoReturn(plan, new Context().destination);
  assert.throws(() => createMixAutomationGraph(c.audio, input, outer, rate, plan), /owner context/);
  bindEchoReturn(plan, outer);
  assert.throws(() => createMixAutomationGraph(c.audio, input, outer, rate, plan), /channel gain/);
  bindEchoReturn(plan, c.destination);
  assert.throws(() => bindEchoReturn(plan, c.destination), /already bound/);
  const graph = createMixAutomationGraph(c.audio, input, outer, rate, plan);
  assert.ok(c.gains.some(g => g.connections.includes(c.destination)));
  graph.restore(); graph.restore();
  assert.deepEqual(c.sources[0]!.connections, [outer]); released(c, 1);
  assert.throws(() => createMixAutomationGraph(c.audio, input, outer, rate, plan), /bound master/);
});
test('echo partial connect and allocation failures release every node and restore the exact original A route', () => {
  for (const failure of ['connect', 'allocate']) {
    const c = new Context(), input = c.createBufferSource(), outer = c.createGain();
    input.connect(outer); const plan = echoOutAutomation(120, rate).outgoing;
    bindEchoReturn(plan, c.destination);
    if (failure === 'connect') {
      const n = c.sources[0]!, original = n.connect.bind(n); let calls = 0;
      n.connect = target => { if (++calls === 3) throw Error('injected connect'); return original(target); };
    } else c.createDelay = () => { throw Error('injected allocate'); };
    assert.throws(() => createMixAutomationGraph(c.audio, input, outer, rate, plan), /injected/);
    assert.deepEqual(c.sources[0]!.connections, [outer]); released(c, 1);
  }
});
function runtime(exits = [4, 8]): MixPreparationRuntime {
  return {analyze: async (from, to) => ({from: evidence(from.channels[0]!.length, exits),
    to: evidence(to.channels[0]!.length)}), render: async () => { throw Error('Native recipes must not render B'); }};
}
async function setup(r = runtime()) {
  const loaded = await fixturePack(), context = new Context();
  const player = new SmallPlayer(context.audio, loaded, loaded.pack.routes[0]!.id, r);
  await player.play('a'); context.advance(0.2);
  return {context, player};
}
test('actual scheduleMix echo preserves B identity/mapping at T, owns graph through E, cancels only before S', async () => {
  const {context, player} = await setup(), original = player.snapshot().voices[0]!;
  await player.scheduleMix(echo);
  const s = player.snapshot(), summary = s.mix!.summary!;
  assert.equal(summary.recipe, 'echo-out'); assert.equal(summary.processor, 'native-pcm@1');
  assert.equal(s.transitionAt!.frame - s.mix!.earliestEffect!.frame, rate);
  assert.equal(s.transitionEnd!.frame - s.transitionAt!.frame, 4 * rate);
  assert.equal(s.voices[0]!.endFrame, s.transitionEnd!.frame);
  assert.deepEqual(context.sources[1]!.starts, [{when: s.transitionAt!.frame / rate, offset: 0}]);
  assert.ok(context.sources[1]!.buffer!.getChannelData(0).every(v => v === Math.fround(0.1)));
  assert.equal(player.cancelPendingTransition(), true);
  assert.deepEqual(player.snapshot().voices[0], original);
  assert.equal(context.delays[0]!.connections.length, 0);
  await player.scheduleMix(echo);
  const again = player.snapshot();
  context.advance((again.mix!.earliestEffect!.frame + 1) / rate - context.currentTime);
  assert.equal(player.cancelPendingTransition(), false);
  assert.equal(player.snapshot().next, player.pair.to.id);
  assert.ok(!player.snapshot().now.includes(player.pair.to.id));
  context.advance((again.transitionAt!.frame + 1) / rate - context.currentTime);
  assert.ok(player.snapshot().now.includes(player.pair.to.id));
  player.stop(); released(context, 1); // The existing player master remains connected and gated.
  assert.equal(player.snapshot().mix, null);
});
test('late echo replan uses S and preserves native B frame/transform without rendering', async () => {
  const entered = deferred(), gate = deferred(), r = runtime();
  const {context, player} = await setup({...r, analyze: async (...args) => {
    entered.release(); await gate.promise; return r.analyze(...args);
  }});
  const options = {...echo}, pending = player.scheduleMix(options);
  await entered.promise; options.recipe = 'cut'; options.echoContentConfirmed = false;
  context.advance(4); gate.release(); await pending;
  const s = player.snapshot();
  assert.equal(s.mix!.summary!.recipe, 'echo-out');
  assert.equal(s.mix!.summary!.fromExitFrame, 8 * rate);
  assert.equal(s.mix!.summary!.toEntryFrame, 0);
  assert.equal(s.mix!.summary!.tempoRatio, 1);
  assert.ok(s.mix!.earliestEffect!.frame >= player.clock.currentFrame + rate / 10);
  player.stop();
});
for (const action of ['stop', 'pause', 'supersede'] as const) test('late echo analysis after ' + action + ' cannot commit', async () => {
  const entered = deferred(), gate = deferred(), r = runtime();
  const {context, player} = await setup({...r, analyze: async (...args) => {
    entered.release(); await gate.promise; return r.analyze(...args);
  }});
  const task = player.scheduleMix(echo); await entered.promise;
  if (action === 'stop') player.stop();
  else if (action === 'pause') await player.pause();
  else await player.play('b');
  gate.release(); await task;
  assert.equal(player.snapshot().mix, null); assert.equal(context.delays.length, 0);
  player.stop();
});
test('failed outgoing native stop restores A and releases incoming echo commit before authored fallback', async () => {
  const {context, player} = await setup();
  const original = [...context.sources[0]!.connections], stop = context.sources[0]!.stop.bind(context.sources[0]!);
  context.sources[0]!.stop = () => { throw Error('injected stop'); };
  await player.scheduleMix(echo);
  assert.equal(player.snapshot().mix?.phase, 'unavailable');
  assert.deepEqual(context.sources[0]!.connections, original);
  assert.ok(context.delays.every(d => d.connections.length === 0));
  assert.ok(context.sources.slice(1).every(s => s.connections.length === 0));
  context.sources[0]!.stop = stop; player.stop();
});

test('cut and echo prepare an exact owned native B copy at a nonzero entry; no WSOLA receipt', async () => {
  const loaded = await fixturePack(), c = new Context(), aBuffer = buffer(16 * rate, 1, rate);
  const bBuffer = buffer(16 * rate, 1, rate);
  bBuffer.getChannelData(0).set(Float32Array.from({length: 16 * rate}, (_, i) => 0.1 * i / (16 * rate)));
  const from = {asset: loaded.pack.assets[0]!, buffer: aBuffer}, to = {asset: loaded.pack.assets[1]!, buffer: bBuffer};
  const r = runtime();
  const actual: MixPreparationRuntime = {...r, analyze: async (...args) => {
    const pair = await r.analyze(...args);
    return {...pair, to: {...pair.to, mixIn: pair.to.mixIn.filter(cue => cue.frame === 2 * rate)}};
  }};
  for (const recipe of ['cut', 'echo-out'] as const) {
    const result = await prepareMixTransition(c.audio, from, to, {recipe, echoContentConfirmed: true}, undefined, actual);
    assert.ok(result.kind === 'ready');
    if (result.kind !== 'ready') return;
    assert.equal(result.entryFrame, 2 * rate);
    assert.equal(result.incoming.processed, undefined);
    assert.equal(result.processed.processor, 'native-pcm@1');
    assert.equal(result.processed.metrics, null);
    assert.notEqual(result.incoming.buffer, bBuffer);
    assert.deepEqual(result.incoming.buffer.getChannelData(0), bBuffer.getChannelData(0));
    assert.equal(result.processed.mapping.tempoRatio, 1);
    assert.equal(result.processed.mapping.pitchSemitones, 0);
  }
});
test('failure while connecting echo return leaves A untouched and releases all allocated echo nodes', () => {
  const c = new Context(), input = c.createBufferSource(), outer = c.createGain();
  input.connect(outer);
  const create = c.createGain.bind(c);
  c.createGain = () => {
    const node = create(), connect = node.connect.bind(node);
    node.connect = ((target: AudioNode) => {
      if (target === c.destination) throw Error('injected return connection');
      return connect(target);
    }) as typeof node.connect;
    return node;
  };
  const plan = echoOutAutomation(120, rate).outgoing; bindEchoReturn(plan, c.destination);
  assert.throws(() => createMixAutomationGraph(c.audio, input, outer, rate, plan), /injected return/);
  assert.deepEqual(c.sources[0]!.connections, [outer]); released(c, 1);
});
