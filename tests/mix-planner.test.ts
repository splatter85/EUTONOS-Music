import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, type MixAnalysis} from '../src/mix-analysis.js';
import {camelotKey, harmonicCompatibility, planAutomaticMix, planMixFromAudio} from '../src/mix-planner.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';

const a = analyzeMixAudio(makeMixFixture({bpm: 120, tonic: 9}));
const b = analyzeMixAudio(makeMixFixture({bpm: 124, tonic: 9}));
function changed(base: MixAnalysis, patch: Partial<MixAnalysis>): MixAnalysis { return {...base, ...patch}; }

test('Camelot labels match known circle-of-fifths keys, including the wrap', () => {
  for (const [tonic, mode, expected] of [[0, 'major', '8B'], [9, 'minor', '8A'],
    [5, 'major', '7B'], [7, 'major', '9B'], [11, 'major', '1B'], [8, 'minor', '1A'],
    [6, 'major', '2B'], [1, 'minor', '12A']] as const) assert.equal(camelotKey({tonic, mode}), expected);
  assert.throws(() => camelotKey({tonic: NaN, mode: 'minor'}));
});
test('harmonic relation distinguishes relative keys, fifths and distant keys', () => {
  const key = {tonic: 9, mode: 'minor'} as const;
  assert.equal(harmonicCompatibility(key, key).relation, 'same-key');
  assert.equal(harmonicCompatibility(key, {tonic: 0, mode: 'major'}).relation, 'relative');
  assert.equal(harmonicCompatibility(key, {tonic: 4, mode: 'minor'}).relation, 'adjacent-fifth');
  assert.equal(harmonicCompatibility(key, {tonic: 10, mode: 'minor'}).relation, 'distant');
  assert.equal(harmonicCompatibility({tonic: 11, mode: 'major'}, {tonic: 4, mode: 'major'}).circleDistance, 1);
});
test('audio-derived 124-to-120 plan chooses future cues and preserves compatible pitch', () => {
  const decision = planAutomaticMix(a, b, {minimumFromFrame: a.sampleRate * 5});
  assert.equal(decision.kind, 'mix', decision.kind === 'fallback' ? decision.reason : '');
  if (decision.kind !== 'mix') return;
  assert.ok(Math.abs(decision.tempoRatio - 120 / 124) < 0.001);
  assert.equal(decision.pitchSemitones, 0);
  assert.ok(decision.fromExitFrame >= a.sampleRate * 5);
  assert.ok(decision.fromExitFrame + decision.overlapFrames < a.frames);
  assert.ok(decision.toEntryFrame + decision.overlapFrames * decision.tempoRatio < b.frames);
  assert.ok(a.mixOut.some(p => p.frame === decision.fromExitFrame));
  assert.ok(b.mixIn.some(p => p.frame === decision.toEntryFrame));
});
test('two generated recordings give identical proposals without authored metadata', () => {
  const from = makeMixFixture({bpm: 118}), to = makeMixFixture({bpm: 120});
  const first = planMixFromAudio(from, to), second = planMixFromAudio(from, to);
  assert.equal(first.kind, 'mix');
  assert.deepEqual(first, second);
});
test('pitch changes require an explicit option and stay within two semitones', () => {
  const other = changed(b, {key: {...b.key, tonic: 10, mode: 'minor', name: 'Bb minor'}});
  assert.equal(planAutomaticMix(a, other).kind, 'fallback');
  const decision = planAutomaticMix(a, other, {allowPitchShift: true});
  assert.equal(decision.kind, 'mix');
  if (decision.kind === 'mix') {
    assert.equal(decision.pitchSemitones, -1);
    assert.equal(decision.harmonic.relation, 'same-key');
  }
  const unchanged = planAutomaticMix(a, b, {allowPitchShift: true});
  assert.ok(unchanged.kind === 'mix' && unchanged.pitchSemitones === 0);
});
test('tempo-return request is explicit plan data', () => {
  const decision = planAutomaticMix(a, b, {returnToOriginalTempo: true, overlapBeats: 4});
  assert.ok(decision.kind === 'mix' && decision.returnToOriginalTempo && decision.overlapBeats === 4);
});
test('out-of-range tempo and explicit pitch requests choose authored fallback', () => {
  for (const bpm of [60, 180]) assert.equal(planAutomaticMix(a, changed(b, {tempo: {...b.tempo, bpm}})).kind, 'fallback');
  for (const shift of [-3, 3, NaN, Infinity, 0.5]) assert.equal(planAutomaticMix(a, b, {pitchSemitones: shift}).kind, 'fallback');
});
test('weak tempo, beat, key and structural evidence each independently refuse mixing', () => {
  for (const weak of [changed(a, {tempo: {...a.tempo, confidence: 0.1}}),
    changed(a, {beatGrid: {...a.beatGrid, confidence: 0.1}}),
    changed(a, {key: {...a.key, confidence: 0.1}}),
    changed(a, {structure: {...a.structure, phraseConfidence: 0.05}})]) {
    assert.equal(planAutomaticMix(weak, b).kind, 'fallback');
  }
});
test('tempo ambiguity independently refuses either deck without relaxing other thresholds', () => {
  // Isolate ambiguity: these baseline analyses already produce a successful mix.
  assert.equal(planAutomaticMix(a, b).kind, 'mix');
  for (const ambiguity of [0.500001, 1]) {
    const from = changed(a, {tempo: {...a.tempo, ambiguity}});
    const to = changed(b, {tempo: {...b.tempo, ambiguity}});
    for (const decision of [planAutomaticMix(from, b), planAutomaticMix(a, to)]) {
      assert.ok(decision.kind === 'fallback' && /ambiguous/.test(decision.reason));
    }
  }
  assert.equal(planAutomaticMix(changed(a, {tempo: {...a.tempo, ambiguity: 0.5}}), b).kind, 'mix');
  for (const ambiguity of [NaN, Infinity, -0.1, 1.1]) {
    assert.equal(planAutomaticMix(changed(a, {tempo: {...a.tempo, ambiguity}}), b).kind, 'fallback');
    assert.equal(planAutomaticMix(a, changed(b, {tempo: {...b.tempo, ambiguity}})).kind, 'fallback');
  }
});

test('unknown key, invalid estimates and unequal sample rates refuse mixing', () => {
  for (const invalid of [changed(a, {tempo: {...a.tempo, bpm: null}}),
    changed(a, {key: {...a.key, tonic: null, mode: null}}),
    changed(a, {tempo: {...a.tempo, confidence: NaN}}),
    changed(a, {sampleRate: 48000}), changed(a, {frames: -1})]) {
    assert.equal(planAutomaticMix(invalid, b).kind, 'fallback');
  }
});
test('no future or sufficiently long cue produces a reason, never a moved/dead schedule', () => {
  assert.equal(planAutomaticMix(a, b, {minimumFromFrame: a.frames}).kind, 'fallback');
  assert.equal(planAutomaticMix(changed(a, {mixOut: []}), b).kind, 'fallback');
  assert.equal(planAutomaticMix(a, changed(b, {mixIn: []})).kind, 'fallback');
  assert.equal(planAutomaticMix(a, b, {minimumFromFrame: -1}).kind, 'fallback');
});
test('silence and unsupported PCM return explanatory fallback decisions', () => {
  const empty = {sampleRate: 8000, channels: [new Float32Array(64000)]};
  const result = planMixFromAudio(empty, empty);
  assert.ok(result.kind === 'fallback' && result.reason.length > 0);
  assert.equal(planMixFromAudio({...empty, sampleRate: 1}, empty).kind, 'fallback');
});
