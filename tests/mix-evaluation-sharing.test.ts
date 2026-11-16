import test from 'node:test';
import assert from 'node:assert/strict';
import * as legacy from '../src/mix-evaluate.js';
import * as shared from '../web/mix-evaluator.js';
import {crossfadeAutomation, type MixAutomation} from '../src/mix-automation.js';
import {MIX_LEVEL_VERSION, type MixPcm} from '../src/mix-analysis.js';
import {LEVEL_MATCH_LIMITS, type LevelMatchPlan} from '../src/mix-planner.js';
import {renderFiniteLoop} from '../src/time-pitch.js';
import type {TransitionRender, TransitionSpec} from '../web/mix-evaluator.js';

const rate = 8000, overlap = rate, frames = rate * 10;
function tone(hz: number, gain: number): MixPcm {
  return {sampleRate: rate, channels: [
    Float32Array.from({length: frames}, (_, frame) => gain * Math.cos(2 * Math.PI * hz * frame / rate)),
  ]};
}
// Four half-second bars repeat the same phase, satisfying the real finite-loop periodicity guard.
const from = tone(136, 0.125), to = tone(223, 0.0625);
const spec: TransitionSpec = {
  recipe: 'blend', fromStartFrame: 4 * rate, preRollFrames: 0, toEntryFrame: rate,
  tempoRatio: 1, automation: crossfadeAutomation(overlap, rate),
};
function levelMatch(fromGain: number, toGain: number): LevelMatchPlan {
  const fromLevel = {version: MIX_LEVEL_VERSION, sampleRate: rate, startFrame: 0,
    frames, channels: 1 as const, lufs: -18, samplePeak: 0.125};
  const toLevel = {...fromLevel, lufs: -24, samplePeak: 0.0625};
  return {from: fromLevel, to: toLevel, fromGain, toGain, rawDeltaLu: -6,
    beforeDeltaLu: -6 - 20 * Math.log10(fromGain),
    matchedDeltaLu: -6 + 20 * Math.log10(toGain / fromGain),
    fromNativeSamplePeak: fromLevel.samplePeak, nativeSamplePeak: toLevel.samplePeak,
    incomingPeakBudget: Math.sqrt(LEVEL_MATCH_LIMITS.samplePeakCeiling ** 2 - (fromLevel.samplePeak * fromGain) ** 2),
    ...LEVEL_MATCH_LIMITS};
}

function assertGainsOnce(plain: TransitionRender, actual: TransitionRender, fromGain: number, toGain: number): void {
  assert.deepEqual([actual.S, actual.T, actual.E, actual.sampleRate, actual.bSource],
    [plain.S, plain.T, plain.E, plain.sampleRate, plain.bSource]);
  let greatestError = 0;
  for (let channel = 0; channel < plain.mix.length; channel++) {
    for (let frame = 0; frame < plain.mix[channel]!.length; frame++) {
      for (const [field, gain] of [
        ['aOut', fromGain], ['aNative', fromGain], ['bOut', toGain], ['bNative', toGain],
      ] as const) {
        greatestError = Math.max(greatestError,
          Math.abs(actual[field][channel]![frame]! - plain[field][channel]![frame]! * gain));
      }
      greatestError = Math.max(greatestError, Math.abs(actual.mix[channel]![frame]! -
        (plain.aOut[channel]![frame]! * fromGain + plain.bOut[channel]![frame]! * toGain)));
    }
  }
  assert.equal(greatestError, 0, 'rendered sources, references and sum apply each captured gain exactly once');
}

test('Node compatibility exports are the same evaluator objects served to the browser worker', () => {
  assert.deepEqual(Object.keys(legacy).sort(), Object.keys(shared).sort());
  assert.equal(legacy.MIX_EVALUATOR_VERSION, 'transition-evaluator@1');
  assert.equal(legacy.MIX_EVALUATION_THRESHOLDS, shared.MIX_EVALUATION_THRESHOLDS);
  assert.equal(legacy.renderTransition, shared.renderTransition);
  assert.equal(legacy.measureTransition, shared.measureTransition);
  assert.equal(legacy.judgeTransition, shared.judgeTransition);
  assert.equal(legacy.evaluateTransition, shared.evaluateTransition);
  assert.equal(legacy.planTransitionSpec, shared.planTransitionSpec);
  assert.equal(legacy.chooseEvaluatedMix, shared.chooseEvaluatedMix);
  assert.equal(legacy.planEvaluatedMixFromAudio, shared.planEvaluatedMixFromAudio);
});

test('mix-evaluation-thresholds@1 retains its complete frozen numeric snapshot', () => {
  assert.deepEqual(shared.MIX_EVALUATION_THRESHOLDS, {
    version: 'mix-evaluation-thresholds@1',
    status: 'experimental: engineering starting points, not calibrated against listening',
    truePeakDbtp: {warn: -1, fail: 0},
    loudnessLu: {warn: 1, fail: 3},
    lowBuildUpDb: {warn: 3.5, fail: 5.5},
    beatPhase: {warn: 0.05, fail: 0.10},
    boundaryFluxDb: {warn: 6, fail: 12},
    sampleJumpRatio: {warn: 4, fail: 8},
    silenceGapMs: {warn: 50, fail: 250},
    stereoCorrelation: {warn: -0.5},
    contextSeconds: 3,
  });
  assert.ok(Object.isFrozen(shared.MIX_EVALUATION_THRESHOLDS));
  for (const value of Object.values(shared.MIX_EVALUATION_THRESHOLDS)) {
    if (typeof value === 'object') assert.ok(Object.isFrozen(value));
  }
});

test('the legacy default and level-match gain paths remain unchanged without an override', () => {
  const plain = shared.renderTransition(from, to, spec);
  assert.deepEqual(shared.renderTransition(from, to, {...spec, fixedGains: {from: 1, to: 1}}), plain);
  assert.equal(plain.aNative[0]![plain.S], from.channels[0]![spec.fromStartFrame]);
  assert.equal(plain.bNative[0]![plain.T], to.channels[0]![spec.toEntryFrame]);
  const middle = overlap / 2;
  assert.ok(Math.abs(plain.aOut[0]![plain.S + middle]! -
    from.channels[0]![spec.fromStartFrame + middle]! * Math.SQRT1_2) < 1e-12);
  const matchedSpec = {...spec, levelMatch: levelMatch(0.75, 0.5)};
  const matched = shared.renderTransition(from, to, matchedSpec);
  assertGainsOnce(plain, matched, 0.75, 0.5);
  assert.deepEqual(shared.renderTransition(from, to, {...matchedSpec, fixedGains: {from: 0.75, to: 0.5}}), matched);
});

test('persistent source gains apply once even when the selected recipe has no levelMatch', () => {
  const plain = shared.renderTransition(from, to, spec);
  const actual = shared.renderTransition(from, to, {...spec, fixedGains: {from: 0.5, to: 0.25}});
  assertGainsOnce(plain, actual, 0.5, 0.25);
  // The captured source gain is authoritative; no gain is multiplied in from plan metadata.
  const override = shared.renderTransition(from, to, {...spec,
    levelMatch: levelMatch(2, 3), fixedGains: {from: 0.5, to: 0.25}});
  assert.deepEqual(override, actual);
});

function finiteLoopSpec(): TransitionSpec {
  const loopFrames = 2 * rate, normal = crossfadeAutomation(overlap, rate);
  const outgoing: MixAutomation = {
    durationFrames: loopFrames + overlap,
    gain: [{frame: 0, value: 1}, ...normal.outgoing.gain.map(point => ({...point, frame: point.frame + loopFrames}))],
    lowShelfDb: [{frame: 0, value: 0}, {frame: loopFrames + overlap, value: 0}],
    highPassHz: [{frame: 0, value: 0}, {frame: loopFrames + overlap, value: 0}],
    lowPassHz: [{frame: 0, value: rate / 2}, {frame: loopFrames + overlap, value: rate / 2}],
  };
  const loop: TransitionSpec = {...spec, recipe: 'loop-extend', entryDelayFrames: loopFrames,
    loopExtension: {bars: 4, startFrame: spec.fromStartFrame - loopFrames,
      endFrame: spec.fromStartFrame, frames: loopFrames},
    automation: {outgoing, incoming: normal.incoming}};
  return loop;
}

test('a finite loop validates its effective peak without multiplying the persistent gain twice', () => {
  const loop = finiteLoopSpec(), loopFrames = loop.entryDelayFrames!;
  const plain = shared.renderTransition(from, to, loop);
  const actual = shared.renderTransition(from, to, {...loop, fixedGains: {from: 0.5, to: 0.25}});
  assert.equal(actual.T - actual.S, loopFrames);
  assert.ok(actual.aOut[0]!.subarray(actual.S, actual.T).some(value => value !== 0));
  assertGainsOnce(plain, actual, 0.5, 0.25);
});

test('invalid or incomplete captured gains refuse before render allocation', () => {
  const bad: unknown[] = [
    {from: 0, to: 1}, {from: -1, to: 1}, {from: 4.01, to: 1}, {from: NaN, to: 1},
    {from: 1, to: Infinity}, {from: 1, to: 0}, {from: 1}, {to: 1}, {},
  ];
  for (const fixedGains of bad) {
    assert.throws(() => shared.renderTransition(from, to,
      {...spec, fixedGains: fixedGains as NonNullable<TransitionSpec['fixedGains']>}), /fixed evaluation level gain/);
  }
});

test('supplied outgoing loop uses actual prepared PCM, matches the default path and rejects invalid receipts', () => {
  const loop: TransitionSpec = {...finiteLoopSpec(), fixedGains: {from: 0.5, to: 0.25}};
  const interval = loop.loopExtension!;
  const outgoingLoop = renderFiniteLoop({sampleRate: rate, channels: from.channels.map(channel =>
    channel.subarray(interval.startFrame, interval.endFrame + overlap))},
  interval.frames, overlap, interval.bars, loop.fixedGains!.from).audio;
  const prepared = {audio: to, entryFrame: loop.toEntryFrame};
  const baseline = shared.renderTransition(from, to, loop, prepared);
  const actual = shared.renderTransition(from, to, loop, {...prepared, outgoingLoop});
  assert.deepEqual(actual, baseline, 'a supplied canonical loop preserves the previous renderer output');
  const changed = new Float32Array(outgoingLoop.channels[0]!);
  changed[1000] = changed[1000]! * 0.5;
  const observed = shared.renderTransition(from, to, loop, {...prepared,
    outgoingLoop: {sampleRate: rate, channels: [changed]}});
  assert.equal(observed.aOut[0]![observed.S + 1000], changed[1000]! * loop.fixedGains!.from);
  assert.notEqual(observed.aOut[0]![observed.S + 1000], baseline.aOut[0]![baseline.S + 1000],
    'the evaluator must inspect supplied loop samples instead of silently rebuilding them');
  assert.throws(() => shared.renderTransition(from, to, spec, {...prepared, outgoingLoop}), /Unexpected prepared outgoing loop/);
  const invalid: MixPcm[] = [
    {...outgoingLoop, sampleRate: rate + 1},
    {...outgoingLoop, channels: []},
    {...outgoingLoop, channels: [outgoingLoop.channels[0]!, outgoingLoop.channels[0]!] },
    {...outgoingLoop, channels: [outgoingLoop.channels[0]!.subarray(1)]},
    {...outgoingLoop, channels: [new Int16Array(outgoingLoop.channels[0]!.length) as unknown as Float32Array]},
  ];
  for (const sample of [NaN, Infinity, -Infinity, 2]) {
    const channel = new Float32Array(outgoingLoop.channels[0]!); channel[1000] = sample;
    invalid.push({sampleRate: rate, channels: [channel]});
  }
  for (const value of invalid) {
    assert.throws(() => shared.renderTransition(from, to, loop, {...prepared, outgoingLoop: value}), /Prepared outgoing loop/);
  }
});
