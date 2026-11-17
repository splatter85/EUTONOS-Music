// EMF-S21 Part B: tempo ratio repair (2:1 and 3:2 traps), requested bar origin, one trusted grid for
// planner and judge, and the dual tempo ramp. Engineering checks only; listening is NOT TESTED.
import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, tempoRatioLabel, type MixPcm} from '../src/mix-analysis.js';
import {automaticMixCandidates, MIX_LIMITS, planAutomaticMix} from '../src/mix-planner.js';
import {chooseSetTransition, gridAlignedAnalysis, prepareOutgoingStretch, setBarGrid, transitionSignature} from '../src/mix-transition.js';
import {composeRampInStart, rampInInputAt, rampInOutputAt, renderTimePitch, type RampIn} from '../src/time-pitch.js';
import {evaluateTransition, MIX_EVALUATION_THRESHOLDS, planTransitionSpec} from '../web/mix-evaluator.js';
import {DUAL_RAMP_LIMITS, dualRampTempo, tempoGapPolicy} from '../web/transition-policy.js';
import {deckPositionAt} from '../web/deck-readout.js';
import type {AudioAsset} from '../src/pack-types.js';
import {makeSetFixture} from './helpers/synthetic-set.js';

const SR = 16000;
/**
 * A 128 BPM drum loop with a strong dotted-quarter layer (every 1.5 beats). Its autocorrelation peaks
 * at 85.33 BPM: the 3:2 trap that misread Turbo Storm and Midnight Orbit. Deterministic noise.
 */
function trap(beatWeight: number, dottedWeight: number, bpm = 128, seconds = 60): {pcm: MixPcm; origin: number} {
  const n = SR * seconds, x = new Float32Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  const hit = (t: number, amp: number, f: number, len: number) => {
    const s = Math.round(t * SR);
    for (let i = 0; i < len * SR && s + i < n; i++) x[s + i]! += amp * Math.exp(-i / (0.03 * SR)) * (0.6 * Math.sin(2 * Math.PI * f * i / SR) + 0.4 * rnd());
  };
  const beat = 60 / bpm, origin = 0.25;
  for (let k = 0; origin + k * beat < seconds; k++) hit(origin + k * beat, beatWeight * (k % 4 === 0 ? 1.3 : 1), 60, 0.12);
  for (let k = 0; origin + k * 1.5 * beat < seconds; k++) hit(origin + k * 1.5 * beat, dottedWeight, 180, 0.15);
  return {pcm: {sampleRate: SR, channels: [x]}, origin: Math.round(origin * SR)};
}
const fakeAsset = (id: string, bpm: number, frames: number, origin = 0) =>
  ({id, file: {sample_rate: SR, frames, sha256: id}, timing: {bpm, first_downbeat_frame: origin}}) as unknown as AudioAsset;
const song = (bpm: number, bars: number, tonic = 9) => makeSetFixture({id: 's', bpm, bars, tonic, mode: 'minor', transitionEvidence: true});
/** A full synthetic set song (drums, harmony, phrase cues) with the dotted 3:2 layer on top, bar origin at frame 0. */
function trapSong(bpm: number, bars: number, weight = 0.6): MixPcm {
  const pcm = song(bpm, bars), x = pcm.channels[0] as Float32Array, n = x.length;
  let seed = 1, peak = 0;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32) * 2 - 1;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  for (let k = 0; k * 1.5 * 60 / bpm * SR < n; k++) {
    const s = Math.round(k * 1.5 * 60 / bpm * SR);
    for (let i = 0; i < 0.15 * SR && s + i < n; i++) x[s + i]! += weight * peak * Math.exp(-i / (0.03 * SR)) * (0.6 * Math.sin(2 * Math.PI * 180 * i / SR) + 0.4 * rnd());
  }
  return pcm;
}

test('tempo ratio labels name the chosen:rival relation, including 3:2 and 2:3', () => {
  assert.equal(tempoRatioLabel(128, 128 / 1.5), '3:2');
  assert.equal(tempoRatioLabel(128 / 1.5, 128), '2:3');
  assert.equal(tempoRatioLabel(120, 60), '2:1');
  assert.equal(tempoRatioLabel(60, 120), '1:2');
  assert.equal(tempoRatioLabel(120, 90), '4:3');
  assert.equal(tempoRatioLabel(120, 101), null);
});

test('3:2 trap: unhinted audio is ambiguous (refused); the requested tempo repairs it with honest confidence', () => {
  const {pcm, origin} = trap(0.5, 1);
  const raw = analyzeMixAudio(pcm);
  assert.ok(Math.abs(raw.tempo.bpm! - 85.333) < 0.1, String(raw.tempo.bpm));
  assert.ok(raw.tempo.ambiguity > MIX_LIMITS.tempoAmbiguity, 'a misread without evidence stays ambiguous, so the planner refuses it');
  assert.equal(raw.tempo.relation?.resolvedBy, 'unresolved');
  const hinted = analyzeMixAudio(pcm, {generationBpm: 128});
  assert.ok(Math.abs(hinted.tempo.bpm! - 128) < 0.1, String(hinted.tempo.bpm));
  assert.equal(hinted.tempo.relation?.ratio, '3:2');
  assert.equal(hinted.tempo.relation?.resolvedBy, 'requested-tempo');
  assert.ok(Math.abs(hinted.tempo.relation!.rivalBpm - 85.333) < 0.2);
  assert.ok(hinted.tempo.ambiguity <= 0.35 + 1e-9 && hinted.tempo.confidence >= MIX_LIMITS.tempoConfidence);
  assert.ok(hinted.limitations.some(l => /3:2/.test(l)), 'the repair is disclosed');
  // The requested bar origin only lends support where the measured beats agree with it.
  const placed = analyzeMixAudio(pcm, {generationBpm: 128, requestedDownbeatFrame: origin});
  assert.equal(placed.structure.downbeatSource, 'requested-origin');
  assert.ok(placed.structure.downbeatConfidence >= 0.65 && placed.beatGrid.confidence >= 0.65);
  assert.ok(Math.abs(placed.structure.downbeatFrames[0]! - origin) < 0.02 * SR, 'downbeats sit on the requested origin');
  const halfBeat = Math.round(origin + 30 / 128 * SR);
  const offGrid = analyzeMixAudio(pcm, {generationBpm: 128, requestedDownbeatFrame: halfBeat});
  assert.notEqual(offGrid.structure.downbeatSource, 'requested-origin', 'a requested origin off the measured beats is rejected');
});

test('3:2 trap: weak support for the requested tempo is not forced (ambiguity stays above the limit)', () => {
  const weak = analyzeMixAudio(trap(0.35, 1).pcm, {generationBpm: 128});
  assert.ok(Math.abs(weak.tempo.bpm! - 85.333) < 0.1 && weak.tempo.ambiguity > MIX_LIMITS.tempoAmbiguity);
});

test('2:3 repair: a requested 85.33 BPM chooses its supported layer over a stronger 128 BPM pulse', () => {
  const pcm = trap(1, 0.5).pcm;
  assert.ok(Math.abs(analyzeMixAudio(pcm).tempo.bpm! - 128) < 0.1);
  const hinted = analyzeMixAudio(pcm, {generationBpm: 128 / 1.5});
  assert.ok(Math.abs(hinted.tempo.bpm! - 85.333) < 0.1);
  assert.equal(hinted.tempo.relation?.ratio, '2:3');
  assert.equal(hinted.tempo.relation?.resolvedBy, 'requested-tempo');
});

test('3:2 trap end to end: repaired analyses give measured 128 grids and a judged, passing blend', () => {
  const pcm = trapSong(128, 48), origin = 0;
  assert.ok(Math.abs(analyzeMixAudio(pcm).tempo.bpm! - 85.333) < 0.1, 'the fixture reproduces the 3:2 misread without evidence');
  const opts = {generationBpm: 128, requestedDownbeatFrame: origin};
  const a = analyzeMixAudio(pcm, opts), b = analyzeMixAudio(pcm, opts), frames = pcm.channels[0]!.length;
  const asset = (id: string) => fakeAsset(id, 128, frames, origin);
  const gridA = setBarGrid(asset('a'), a, SR), gridB = setBarGrid(asset('b'), b, SR);
  assert.equal(gridA.source, 'measured'); assert.equal(gridB.source, 'measured');
  assert.ok(Math.abs(gridA.bpm - 128) < 0.1);
  const choice = chooseSetTransition({from: {asset: asset('a'), analysis: a, frames}, to: {asset: asset('b'), analysis: b, frames, channels: 1},
    sampleRate: SR, earliestFrame: 20 * SR, boundary: {bars: 4, anchorBar: 0}});
  assert.equal(choice.kind, 'analyzed', JSON.stringify(choice.kind === 'unavailable' ? choice : choice.notes));
  if (choice.kind !== 'analyzed') return;
  assert.equal(choice.plan.recipe, 'blend', 'equal tempos need no ramp');
  const evaluation = evaluateTransition(pcm, pcm, planTransitionSpec(choice.plan),
    {from: gridAlignedAnalysis(a, gridA)!, to: gridAlignedAnalysis(b, gridB)!});
  const phase = evaluation.measurements!.beatPhase;
  assert.equal(phase.judged, true);
  assert.ok(phase.maxError! < MIX_EVALUATION_THRESHOLDS.beatPhase.fail, String(phase.maxError));
  // The raw misread (no requested evidence) never yields a confident wrong grid: the set falls back to the
  // requested grid, rhythm recipes are not offered, and the judge labels (never fails) the phase.
  const rawA = analyzeMixAudio(pcm), rawB = analyzeMixAudio(pcm);
  const rawGrid = setBarGrid(asset('a'), rawA, SR);
  assert.equal(rawGrid.source, 'requested');
  const fallback = chooseSetTransition({from: {asset: asset('a'), analysis: rawA, frames}, to: {asset: asset('b'), analysis: rawB, frames, channels: 1},
    sampleRate: SR, earliestFrame: 20 * SR, boundary: {bars: 4, anchorBar: 0}});
  assert.notEqual(fallback.kind, 'analyzed', 'no beat-matched recipe on a requested grid');
  assert.equal(fallback.kind, 'route-free', 'the requested-grid fallback is the route-free echo reset or crossfade');
  if (fallback.kind !== 'route-free') return;
  const aligned = {from: gridAlignedAnalysis(rawA, fallback.fromGrid)!, to: gridAlignedAnalysis(rawB, fallback.toGrid)!};
  assert.equal(aligned.from.beatGrid.source, 'requested');
  assert.ok(Math.abs(aligned.from.tempo.bpm! - 128) < 1e-9, 'the judge sees the grid the planner used, not the raw 85.33');
  const judged = evaluateTransition(pcm, pcm, {recipe: fallback.plan.recipe === 'fallback-cut' ? 'cut' : 'echo-out',
    fromStartFrame: fallback.plan.fromExitFrame - fallback.plan.preRollFrames, preRollFrames: fallback.plan.preRollFrames,
    toEntryFrame: fallback.plan.toEntryFrame, tempoRatio: 1, automation: fallback.plan.automation}, aligned);
  assert.equal(judged.measurements!.beatPhase.judged, false);
  assert.match(judged.measurements!.beatPhase.reason!, /requested grid/);
  assert.ok(!judged.flags.some(f => f.metric === 'beatPhase'), 'an unjudged phase is never a beatPhase FAIL');
});

// Owner decision (B), 2026-11-16: per-deck bound 15% (was 8%); the clamp and reach examples move with it.
test('dual-ramp target: geometric mean clamped so each deck moves at most 15%', () => {
  const t = dualRampTempo(120, 127)!;
  assert.ok(Math.abs(t.bpm - Math.sqrt(120 * 127)) < 1e-9);
  assert.ok(Math.abs(t.fromRatio * 120 - t.bpm) < 1e-9 && Math.abs(t.toRatio * 127 - t.bpm) < 1e-9);
  const clamped = dualRampTempo(100, 134)!;
  assert.ok(Math.abs(clamped.bpm - 115) < 1e-9 && clamped.fromRatio <= DUAL_RAMP_LIMITS.maxRatio + 1e-12 && clamped.toRatio >= DUAL_RAMP_LIMITS.minRatio - 1e-12);
  assert.equal(dualRampTempo(100, 100.4), null, 'below 0.5% there is nothing to ramp');
  assert.equal(dualRampTempo(100, 136), null, 'beyond about 35.3% one deck would move more than 15%');
  assert.deepEqual(tempoGapPolicy(120, 127).recipes.slice(0, 2), ['dual-ramp', 'blend']);
  assert.ok(tempoGapPolicy(120, 144).recipes.includes('dual-ramp'), 'a 20% gap is within the 15% per-deck reach');
  assert.ok(!tempoGapPolicy(120, 170).recipes.includes('dual-ramp'));
  assert.ok(!tempoGapPolicy(120, 127, {beatConfident: false}).recipes.includes('dual-ramp'));
});

test('ramp-in time map: smoothstep speed, exact integral and inverse', () => {
  const ramp: RampIn = {rampFrames: 20000, curve: 'smoothstep'}, r = 1.05;
  assert.ok(Math.abs(rampInInputAt(20000, r, ramp) - 20000 * (1 + r) / 2) < 1e-6);
  assert.ok(Math.abs(rampInInputAt(30000, r, ramp) - (20000 * (1 + r) / 2 + 10000 * r)) < 1e-6);
  const speed = (t: number) => rampInInputAt(t + 0.5, r, ramp) - rampInInputAt(t - 0.5, r, ramp);
  assert.ok(Math.abs(speed(1) - 1) < 1e-4 && Math.abs(speed(19999) - r) < 1e-4 && Math.abs(speed(10000) - (1 + r) / 2) < 1e-4);
  for (const out of [0, 1234, 19999, 20000, 33333]) assert.ok(Math.abs(rampInOutputAt(rampInInputAt(out, r, ramp), r, ramp) - out) < 1e-3);
  const position = deckPositionAt({frame: 1000 + 20000, start: 0, offset: 0, nativeFrames: 1e6, mapping: null, entryRate: null,
    motion: {at: 1000, sourceFrame: 5000, stretch: {tempoRatio: r, rampIn: ramp}}});
  assert.ok(Math.abs(position.sourceFrame - (5000 + 20000 * (1 + r) / 2)) < 1e-6 && Math.abs(position.speed - r) < 1e-9);
  assert.equal(position.pitchMode, 'independent');
});

test('dual-ramp plan: A eases over 4 native bars, B enters on that downbeat, both run at the shared tempo, pitch kept', () => {
  const a = song(120, 56), b = song(127, 56), analysis = {from: analyzeMixAudio(a), to: analyzeMixAudio(b)};
  const target = dualRampTempo(analysis.from.tempo.bpm!, analysis.to.tempo.bpm!)!;
  const plan = planAutomaticMix(analysis.from, analysis.to, {recipe: 'dual-ramp', returnToOriginalTempo: true,
    tempoReturn: {bars: 4, curve: 'smoothstep'}, minimumFromFrame: 10 * SR});
  assert.equal(plan.kind, 'mix', plan.kind === 'fallback' ? plan.reason : '');
  if (plan.kind !== 'mix') return;
  assert.equal(plan.recipe, 'dual-ramp'); assert.equal(plan.pitchSemitones, 0);
  const d = plan.dualRamp!, s = plan.outgoingStretch!, beat = 60 * SR / plan.fromBpm;
  assert.ok(Math.abs(d.bpm - target.bpm) < 1e-9 && Math.abs(plan.tempoRatio - target.toRatio) < 1e-9);
  assert.equal(plan.entryDelayFrames, d.rampFrames); assert.equal(s.rampIn.rampFrames, d.rampFrames);
  assert.equal(s.sourceStartFrame, plan.fromExitFrame); assert.equal(plan.outgoingEffectSourceFrame, plan.fromExitFrame);
  // B enters exactly where A has played 16 native beats (4 bars), so T is A's downbeat.
  assert.ok(Math.abs(rampInInputAt(d.rampFrames, s.tempoRatio, s.rampIn) - 16 * beat) < 1.5, 'T is four native bars after S');
  assert.equal(plan.automation.outgoing.durationFrames, d.rampFrames + plan.overlapFrames);
  assert.ok(s.inputFrames >= rampInInputAt(d.rampFrames + plan.overlapFrames, s.tempoRatio, s.rampIn));
  assert.equal(plan.tempoReturn?.curve, 'smoothstep');
  // Auto: the dual ramp is a first-class candidate, ahead of the blend for a stretched gap.
  assert.equal(automaticMixCandidates(analysis.from, analysis.to, {minimumFromFrame: 10 * SR})[0]?.recipe, 'dual-ramp');
  // Planner and judge share the measured grid: the beat phase is judged and lands within the frozen thresholds.
  const evaluation = evaluateTransition(a, b, planTransitionSpec(plan), analysis);
  const phase = evaluation.measurements!.beatPhase;
  assert.equal(phase.judged, true, phase.reason);
  assert.ok(phase.beats >= 8 && phase.maxError! < MIX_EVALUATION_THRESHOLDS.beatPhase.warn, JSON.stringify(phase));
});

test('set chooser: stretched gap leads with the dual ramp; an owner blend continues to it; measured grids required', () => {
  const a = song(120, 56), b = song(127, 56), analysis = {from: analyzeMixAudio(a), to: analyzeMixAudio(b)};
  const frames = (x: MixPcm) => x.channels[0]!.length;
  const input = (options = {}, toAnalysis = analysis.to) => ({from: {asset: fakeAsset('a', 120, frames(a)), analysis: analysis.from, frames: frames(a)},
    to: {asset: fakeAsset('b', 127, frames(b)), analysis: toAnalysis, frames: frames(b), channels: 1},
    sampleRate: SR, earliestFrame: 30 * SR, boundary: {bars: 4, anchorBar: 0}, options});
  const auto = chooseSetTransition(input());
  assert.ok(auto.kind === 'analyzed' && auto.plan.recipe === 'dual-ramp', JSON.stringify(auto.kind === 'unavailable' ? auto : auto.rejected));
  assert.ok(auto.kind === 'analyzed' && auto.plan.tempoReturn?.curve === 'smoothstep');
  const owner = chooseSetTransition(input({recipe: 'blend'}));
  assert.ok(owner.kind === 'analyzed' && owner.plan.recipe === 'blend');
  // Every blend parameterisation excluded: the owner chain continues to the dual ramp, not a cut.
  const exclude: string[] = [];
  let next: ReturnType<typeof chooseSetTransition> = owner;
  for (let i = 0; i < 8 && next.kind === 'analyzed' && next.plan.recipe === 'blend'; i++) {
    exclude.push(transitionSignature(next.plan, next.exitBar));
    next = chooseSetTransition({...input({recipe: 'blend'}), exclude});
  }
  assert.ok(next.kind === 'analyzed' && next.plan.recipe === 'dual-ramp', JSON.stringify(next.kind === 'unavailable' ? next : next.plan.recipe));
  // A weak B downbeat makes B's grid the requested one: no rhythm recipe is planned on the raw analysis.
  const weakB = {...analysis.to, structure: {...analysis.to.structure, downbeatConfidence: 0.1}};
  const weak = chooseSetTransition(input({}, weakB));
  assert.ok(weak.kind !== 'analyzed' || !['dual-ramp', 'blend', 'meet-in-middle'].includes(weak.plan.recipe));
});

test('outgoing stretch buffer: native start, A keeps its own level, exact automation length', async () => {
  const a = song(120, 56), b = song(127, 56), analysis = {from: analyzeMixAudio(a), to: analyzeMixAudio(b)};
  const plan = planAutomaticMix(analysis.from, analysis.to, {recipe: 'dual-ramp', returnToOriginalTempo: true, minimumFromFrame: 10 * SR});
  assert.equal(plan.kind, 'mix'); if (plan.kind !== 'mix') return;
  const channel = a.channels[0] as Float32Array;
  const buffer = {sampleRate: SR, length: channel.length, numberOfChannels: 1, duration: channel.length / SR,
    getChannelData: () => channel} as unknown as AudioBuffer;
  const made: Float32Array[] = [];
  const context = {sampleRate: SR, createBuffer: (count: number, length: number, rate: number) => {
    const data = Array.from({length: count}, () => new Float32Array(length)); made.push(...data);
    return {sampleRate: rate, length, numberOfChannels: count, getChannelData: (i: number) => data[i]!,
      copyToChannel: (src: Float32Array, i: number) => data[i]!.set(src)} as unknown as AudioBuffer;
  }} as unknown as BaseAudioContext;
  const runtime = {analyze: async () => { throw new Error('unused'); }, render: async (audio: MixPcm, options: Parameters<typeof renderTimePitch>[1]) => renderTimePitch(audio, options)};
  const out = await prepareOutgoingStretch(context, {asset: fakeAsset('a', 120, channel.length), buffer} as never, plan, 1, undefined, runtime);
  assert.equal(out.length, plan.automation.outgoing.durationFrames);
  const data = out.getChannelData(0), S = plan.fromExitFrame;
  assert.equal(data[0], channel[S], 'the splice starts on the exact native sample');
  let native = 0, stretched = 0;
  for (let i = 0; i < 4 * SR; i++) { native += channel[S + i]! ** 2; stretched += data[i]! ** 2; }
  assert.ok(Math.abs(10 * Math.log10(stretched / native)) < 1, 'level held within 1 dB over the first seconds');
  // The composed buffer is the processor output with its common attenuation undone.
  const native2 = [channel.subarray(S, S + plan.outgoingStretch!.inputFrames)];
  const ready = renderTimePitch({sampleRate: SR, channels: native2}, {tempoRatio: plan.outgoingStretch!.tempoRatio, pitchSemitones: 0, rampIn: plan.outgoingStretch!.rampIn});
  assert.deepEqual(composeRampInStart(native2, ready, out.length)[0], data);
});
