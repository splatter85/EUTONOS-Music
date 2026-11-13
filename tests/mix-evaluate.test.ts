import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, type MixPcm} from '../src/mix-analysis.js';
import {cleanCutAutomation, echoOutAutomation, type MixAutomation, type MixAutomationPoint} from '../src/mix-automation.js';
import {chooseEvaluatedMix, evaluateTransition, MIX_EVALUATION_THRESHOLDS, planEvaluatedMixFromAudio,
  type TransitionEvaluation, type TransitionSpec} from '../src/mix-evaluate.js';
import type {AutomaticMixPlan} from '../src/mix-planner.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';

const rate = 16000, seconds = 14;
/** Deterministic uniform noise (LCG), independent per seed. */
function noise(seed: number, amplitude = 0.1): MixPcm {
  let state = seed >>> 0;
  const channel = Float32Array.from({length: rate * seconds}, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return amplitude * (state / 2 ** 31 - 1);
  });
  return {sampleRate: rate, channels: [channel, Float32Array.from(channel)]};
}
function tone(hz: number, amplitude: number): MixPcm {
  const channel = Float32Array.from({length: rate * seconds}, (_, n) => amplitude * Math.cos(2 * Math.PI * hz * n / rate));
  return {sampleRate: rate, channels: [channel, Float32Array.from(channel)]};
}
const flat = (frames: number, value: number) => [{frame: 0, value}, {frame: frames, value}];
function automation(frames: number, gain: MixAutomationPoint[]): MixAutomation {
  return {durationFrames: frames, gain, lowShelfDb: flat(frames, 0), highPassHz: flat(frames, 0),
    lowPassHz: flat(frames, rate / 2)};
}
function curve(frames: number, f: (x: number) => number): MixAutomationPoint[] {
  return Array.from({length: 33}, (_, i) => ({frame: Math.round(i * frames / 32), value: f(i / 32)}));
}
const overlap = 4 * rate, start = 5 * rate;
function blend(outgoing: MixAutomationPoint[], incoming: MixAutomationPoint[]): TransitionSpec {
  return {recipe: 'blend', fromStartFrame: start, preRollFrames: 0, toEntryFrame: 2 * rate, tempoRatio: 1,
    automation: {outgoing: automation(overlap, outgoing), incoming: automation(overlap, incoming)}};
}
const flagged = (e: TransitionEvaluation, metric: string) => e.flags.find(f => f.metric === metric);
const equalPower = blend(curve(overlap, x => Math.cos(Math.PI * x / 2)), curve(overlap, x => Math.sin(Math.PI * x / 2)));

test('thresholds are versioned and labelled experimental', () => {
  assert.equal(MIX_EVALUATION_THRESHOLDS.version, 'mix-evaluation-thresholds@1');
  assert.match(MIX_EVALUATION_THRESHOLDS.status, /experimental/);
  assert.ok(Object.isFrozen(MIX_EVALUATION_THRESHOLDS));
});

test('fixture: equal-power crossfade of uncorrelated material passes', () => {
  const e = evaluateTransition(noise(1), noise(2), equalPower);
  assert.equal(e.verdict, 'pass', JSON.stringify(e.flags));
  const m = e.measurements!;
  assert.ok(Math.abs(m.loudness.shortTermMaxUpLu!) < 0.5 && Math.abs(m.loudness.momentaryMaxDownLu!) < 0.6,
    JSON.stringify(m.loudness));
  // Two uncorrelated equal halves sum to about +3.01 dB over either one.
  assert.ok(m.lowBuildUp.maxDb! > 2.5 && m.lowBuildUp.maxDb! < 3.5, String(m.lowBuildUp.maxDb));
  assert.equal(m.silenceGapMs, 0);
  assert.ok(m.truePeakDbtp! < -10);
  assert.ok(Math.abs(m.stereoCorrelation! - 1) < 1e-9);
  assert.equal(e.bSource, 'native');
});

test('fixture: both tracks at full gain flag a loudness bump of about +3 LU', () => {
  const e = evaluateTransition(noise(1), noise(2),
    blend([{frame: 0, value: 1}, {frame: overlap - 1, value: 1}, {frame: overlap, value: 0}], flat(overlap, 1)));
  const m = e.measurements!;
  assert.ok(m.loudness.shortTermMaxUpLu! > 2.7 && m.loudness.shortTermMaxUpLu! < 3.3, JSON.stringify(m.loudness));
  assert.ok(flagged(e, 'loudness'), JSON.stringify(e.flags));
  assert.notEqual(e.verdict, 'pass');
});

test('fixture: both bass lines at full gain fail the low-band check at about +6 dB', () => {
  const e = evaluateTransition(tone(55, 0.2), tone(55, 0.2),
    {...blend([{frame: 0, value: 1}, {frame: overlap - 1, value: 1}, {frame: overlap, value: 0}], flat(overlap, 1)),
      toEntryFrame: start});
  const m = e.measurements!;
  assert.ok(m.lowBuildUp.maxDb! > 5.8 && m.lowBuildUp.maxDb! < 6.2, String(m.lowBuildUp.maxDb));
  assert.equal(m.lowBuildUp.band, '25-60 Hz');
  assert.equal(flagged(e, 'lowBuildUp')?.level, 'fail');
  assert.equal(e.verdict, 'fail');
});

test('fixture: both tracks at zero gain fail as a dip and a silence gap', () => {
  const e = evaluateTransition(noise(1), noise(2),
    blend([{frame: 0, value: 1}, {frame: 1, value: 0}, {frame: overlap, value: 0}],
      [{frame: 0, value: 0}, {frame: overlap - 1, value: 0}, {frame: overlap, value: 1}]));
  const m = e.measurements!;
  assert.ok(m.silenceGapMs >= 3900 && m.silenceGapMs <= 4000, String(m.silenceGapMs));
  assert.equal(m.loudness.momentaryMaxDownLu, -60);
  assert.equal(flagged(e, 'silenceGap')?.level, 'fail');
  assert.equal(flagged(e, 'loudness')?.level, 'fail');
});

test('fixture: a sample discontinuity in a smooth blend flags sample jump and flux', () => {
  const e = evaluateTransition(tone(220, 0.3), noise(2, 0.005),
    blend([{frame: 0, value: 1}, {frame: 1, value: 0}, {frame: overlap, value: 0}], curve(overlap, x => x)));
  const m = e.measurements!;
  assert.ok(m.sampleJumpRatio! > MIX_EVALUATION_THRESHOLDS.sampleJumpRatio.fail, String(m.sampleJumpRatio));
  assert.equal(flagged(e, 'sampleJump')?.level, 'fail');
  assert.equal(e.verdict, 'fail');
});

test('fixture: an intentional cut passes for its recipe; the same render judged as a blend flags flux', () => {
  const cut = cleanCutAutomation(rate);
  const spec: TransitionSpec = {recipe: 'cut', fromStartFrame: start, preRollFrames: 0, toEntryFrame: 2 * rate,
    tempoRatio: 1, automation: cut};
  const a = tone(220, 0.05), b = noise(2, 0.2);
  const asCut = evaluateTransition(a, b, spec);
  assert.ok(!flagged(asCut, 'boundaryFlux') && !flagged(asCut, 'sampleJump'), JSON.stringify(asCut.flags));
  assert.equal(asCut.measurements!.boundaryFlux.judged, false);
  const asBlend = evaluateTransition(a, b, {...spec, recipe: 'blend'});
  assert.ok(asBlend.measurements!.boundaryFlux.excessDb! > MIX_EVALUATION_THRESHOLDS.boundaryFluxDb.warn,
    String(asBlend.measurements!.boundaryFlux.excessDb));
  assert.ok(flagged(asBlend, 'boundaryFlux'));
  // The loudness change is the cut itself, so equal-level material is used for the pass case.
  const equal = evaluateTransition(noise(1), noise(2), spec);
  assert.equal(equal.verdict, 'pass', JSON.stringify(equal.flags));
});

test('fixture: an intentional echo-out passes for its recipe and its tail is rendered', () => {
  const echo = echoOutAutomation(120, rate);
  const spec: TransitionSpec = {recipe: 'echo-out', fromStartFrame: start - echo.preRollFrames,
    preRollFrames: echo.preRollFrames, toEntryFrame: 2 * rate, tempoRatio: 1, automation: echo};
  const e = evaluateTransition(noise(1), noise(2), spec);
  assert.equal(e.verdict, 'pass', JSON.stringify(e.flags));
  assert.equal(e.measurements!.silenceGapMs, 0);
});

test('echo-out between different tempos is judged on its entry beat only', () => {
  const from = makeMixFixture({bpm: 120, tonic: 9}), to = makeMixFixture({bpm: 126, tonic: 9});
  const analysis = {from: analyzeMixAudio(from), to: analyzeMixAudio(to)};
  const echo = echoOutAutomation(120, from.sampleRate);
  const aBeats = analysis.from.beatGrid.frames, bBeats = analysis.to.beatGrid.frames;
  const exit = aBeats[Math.floor(aBeats.length / 3)]!, entry = bBeats[4]!;
  const e = evaluateTransition(from, to, {recipe: 'echo-out', fromStartFrame: exit - echo.preRollFrames,
    preRollFrames: echo.preRollFrames, toEntryFrame: entry, tempoRatio: 1, automation: echo}, analysis);
  assert.ok(!flagged(e, 'beatPhase'), JSON.stringify(e.measurements?.beatPhase));
  assert.ok(e.measurements!.beatPhase.beats <= 2, JSON.stringify(e.measurements!.beatPhase));
});

test('fixture: echo feedback above 1 fails before rendering', () => {
  const echo = echoOutAutomation(120, rate);
  const runaway: MixAutomation = {...echo.outgoing, echo: {...echo.outgoing.echo!, feedback: 1.1}};
  const e = evaluateTransition(noise(1), noise(2), {recipe: 'echo-out', fromStartFrame: start - echo.preRollFrames,
    preRollFrames: echo.preRollFrames, toEntryFrame: 2 * rate, tempoRatio: 1,
    automation: {outgoing: runaway, incoming: echo.incoming}});
  assert.equal(e.verdict, 'fail');
  assert.equal(e.flags[0]!.metric, 'automation');
  assert.equal(e.measurements, null);
});

test('evaluation is deterministic', () => {
  assert.deepEqual(evaluateTransition(noise(1), noise(2), equalPower), evaluateTransition(noise(1), noise(2), equalPower));
});

function asPlan(spec: TransitionSpec, label: string): AutomaticMixPlan {
  return {kind: 'mix', version: 'automatic-mix@1', recipe: spec.recipe, preRollFrames: spec.preRollFrames,
    sampleRate: rate, fromFrames: rate * seconds, toFrames: rate * seconds,
    fromExitFrame: spec.fromStartFrame + spec.preRollFrames, toEntryFrame: spec.toEntryFrame,
    overlapFrames: spec.automation.incoming.durationFrames, overlapBeats: 8, fromBpm: 120, toBpm: 120,
    tempoRatio: 1, pitchSemitones: 0, returnToOriginalTempo: false,
    harmonic: {fromCamelot: '8A', toCamelot: '8A', circleDistance: 0, score: 1, relation: 'same-key'},
    evidence: {tempo: 1, beat: 1, key: 1, phrase: 1, cue: 1}, confidence: 1, automation: spec.automation,
    reasons: [label]} as AutomaticMixPlan;
}

test('chooser keeps the best passing candidate, or falls back when all fail', () => {
  const bad = asPlan(blend([{frame: 0, value: 1}, {frame: 1, value: 0}, {frame: overlap, value: 0}],
    [{frame: 0, value: 0}, {frame: overlap - 1, value: 0}, {frame: overlap, value: 1}]), 'dip');
  const good = asPlan(equalPower, 'equal power');
  const chosen = chooseEvaluatedMix(noise(1), noise(2), [bad, good]);
  assert.equal(chosen.kind, 'mix');
  assert.equal(chosen.kind === 'mix' && chosen.plan.reasons[0], 'equal power');
  assert.equal(chosen.evaluations.length, 2);
  const none = chooseEvaluatedMix(noise(1), noise(2), [bad]);
  assert.equal(none.kind, 'fallback');
  assert.equal(chooseEvaluatedMix(noise(1), noise(2), []).kind, 'fallback');
});

test('analysis-to-evaluation pipeline on generated fixtures reports a decision and its cost', () => {
  const from = makeMixFixture({bpm: 120, tonic: 9}), to = makeMixFixture({bpm: 120, tonic: 9});
  const started = performance.now();
  const decision = planEvaluatedMixFromAudio(from, to);
  const elapsed = performance.now() - started;
  assert.ok(decision.evaluations.length >= 1, 'the generated pair yields at least one proposal');
  for (const e of decision.evaluations) {
    assert.ok(e.measurements !== null);
    assert.ok(e.measurements!.beatPhase.maxError === null || e.measurements!.beatPhase.maxError < 0.5);
  }
  assert.deepEqual(planEvaluatedMixFromAudio(from, to), decision);
  // Cost note for the handoff (preparation budget is 30 s per job); not a performance gate.
  console.log(`mix-evaluate cost: ${decision.evaluations.length} candidate(s), ${elapsed.toFixed(0)} ms ` +
    `including analysis; decision ${decision.kind}` + (decision.kind === 'mix' ? ` (${decision.plan.recipe}, ` +
    `${decision.evaluation.verdict})` : ''));
});
