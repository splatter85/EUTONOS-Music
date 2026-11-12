import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, MIX_ANALYSIS_VERSION, type MixAnalysis} from '../src/mix-analysis.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';

function assertBounded(result: MixAnalysis): void {
  const visit = (value: unknown): void => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), 'every report number is finite');
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(result);
  assert.ok(result.tempo.confidence >= 0 && result.tempo.confidence <= 1);
  assert.ok(result.key.confidence >= 0 && result.key.confidence <= 1);
  assert.equal(result.structure.assumed, true);
  assert.ok(result.structure.phraseConfidence <= 0.5, 'four-bar origin is only a hypothesis');
  for (const points of [result.mixIn, result.mixOut]) for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    assert.ok(p.frame >= 0 && p.frame < result.frames);
    assert.ok(p.confidence >= 0 && p.confidence <= 1);
    if (i) assert.ok(points[i - 1]!.score >= p.score, 'rank is deterministic descending score');
  }
}
for (const bpm of [118, 120, 124]) for (const [tonic, mode] of [[9, 'minor'], [0, 'major'], [2, 'minor']] as const) {
  test('synthetic ground truth ' + bpm + ' BPM / tonic ' + tonic + ' ' + mode, () => {
    const offsetSeconds = 0.173;
    const pcm = makeMixFixture({bpm, tonic, mode, offsetSeconds});
    const result = analyzeMixAudio(pcm);
    assertBounded(result);
    assert.ok(result.tempo.bpm !== null);
    assert.ok(Math.abs(result.tempo.bpm - bpm) <= 0.25, 'tempo tolerance 0.25 BPM; detected ' + result.tempo.bpm);
    assert.ok(result.tempo.confidence >= 0.55, 'rhythmic evidence exceeds engineering threshold');
    // Independent ground truth: each interior drum attack, including the last,
    // must have a grid line within 25 ms. This detects cumulative grid drift.
    for (let beat = 1; beat < 31; beat++) {
      const expected = offsetSeconds + beat * 60 / bpm;
      const error = Math.min(...result.beatGrid.frames.map(frame => Math.abs(frame / pcm.sampleRate - expected)));
      assert.ok(error <= 0.025, 'beat ' + beat + ' error ' + error + ' exceeds 25 ms');
    }
    assert.equal(result.key.tonic, tonic);
    assert.equal(result.key.mode, mode);
    assert.ok(result.key.confidence > 0.4);
    assert.ok(result.structure.downbeatConfidence > 0.1);
    for (let bar = 1; bar < 8; bar++) {
      const expected = offsetSeconds + bar * 4 * 60 / bpm;
      const error = Math.min(...result.structure.downbeatFrames.map(frame => Math.abs(frame / pcm.sampleRate - expected)));
      assert.ok(error <= 0.025, 'accented downbeat ' + bar + ' error ' + error + ' exceeds 25 ms');
    }
    assert.ok(result.mixIn.length > 0 && result.mixOut.length > 0);
    assert.equal(result.version, MIX_ANALYSIS_VERSION);
  });
}
for (const sampleRate of [8000, 44100, 48000]) {
  test('tempo and key retain meaning at ' + sampleRate + ' Hz', () => {
    const pcm = makeMixFixture({sampleRate, bpm: 124, offsetSeconds: 0.131});
    const result = analyzeMixAudio(pcm);
    assert.ok(result.tempo.bpm !== null && Math.abs(result.tempo.bpm - 124) <= 0.25);
    assert.equal(result.key.name, 'A minor');
    assertBounded(result);
  });
}
test('silence has no invented tempo, key, beat grid or mix points', () => {
  const result = analyzeMixAudio({sampleRate: 8000, channels: [new Float32Array(80000)]});
  assert.equal(result.tempo.bpm, null);
  assert.equal(result.tempo.confidence, 0);
  assert.equal(result.key.name, null);
  assert.equal(result.key.confidence, 0);
  assert.deepEqual(result.beatGrid.frames, []);
  assert.deepEqual(result.mixIn, []);
  assert.deepEqual(result.mixOut, []);
  assert.ok(result.energyCurve.every(e => e.rms === 0 && e.dbfs === null));
  assertBounded(result);
});
test('short sample cannot pretend to establish a tempo', () => {
  const pcm = makeMixFixture({bars: 1, bpm: 120});
  const result = analyzeMixAudio(pcm);
  assert.equal(result.tempo.bpm, null);
  assert.equal(result.tempo.status, 'insufficient-rhythm');
  assertBounded(result);
});
test('single sustained pitch does not determine major/minor key', () => {
  const sampleRate = 8000;
  const channel = Float32Array.from({length: sampleRate * 8}, (_, i) => 0.2 * Math.sin(2 * Math.PI * 440 * i / sampleRate));
  const result = analyzeMixAudio({sampleRate, channels: [channel]});
  assert.equal(result.key.name, null);
  assert.equal(result.key.status, 'ambiguous');
  assert.equal(result.tempo.bpm, null);
});
test('opposite-polarity stereo does not cancel rhythm or tonal evidence', () => {
  const mono = analyzeMixAudio(makeMixFixture({bpm: 118}));
  const stereo = analyzeMixAudio(makeMixFixture({bpm: 118, stereo: 'antiphase'}));
  assert.deepEqual(stereo.tempo, mono.tempo);
  assert.deepEqual(stereo.beatGrid, mono.beatGrid);
  assert.equal(stereo.key.name, mono.key.name);
  assert.ok(Math.abs(stereo.key.confidence - mono.key.confidence) < 1e-12);
  assert.deepEqual(stereo.energyCurve, mono.energyCurve);
});
test('same input produces exactly the same report and never mutates input PCM', () => {
  const pcm = makeMixFixture({bpm: 124, bars: 4});
  const before = pcm.channels[0]!.slice();
  assert.deepEqual(analyzeMixAudio(pcm), analyzeMixAudio(pcm));
  assert.deepEqual(pcm.channels[0], before);
});
test('equal beat accents leave downbeat and phrase origin uncertain', () => {
  const result = analyzeMixAudio(makeMixFixture({chords: false, accents: false}));
  assert.ok(result.tempo.bpm !== null && Math.abs(result.tempo.bpm - 120) < 0.25);
  assert.ok(result.structure.downbeatConfidence < 0.1);
  assert.ok(result.structure.phraseConfidence < 0.05);
});
test('energy curve accounts for every original frame exactly once', () => {
  const pcm = makeMixFixture({bars: 1, offsetSeconds: 0.123});
  const result = analyzeMixAudio(pcm), frames = pcm.channels[0]!.length;
  let end = 0, measured = 0, actual = 0;
  for (const e of result.energyCurve) {
    assert.equal(e.startFrame, end);
    measured += e.rms * e.rms * (e.endFrame - e.startFrame);
    end = e.endFrame;
  }
  for (const value of pcm.channels[0]!) actual += value * value;
  assert.equal(end, frames);
  assert.ok(Math.abs(measured - actual) < 1e-8);
});
test('refuses invalid PCM shapes, non-finite values, excessive range and rates', () => {
  const valid = new Float32Array(80);
  for (const input of [
    {sampleRate: 7999, channels: [valid]},
    {sampleRate: 8000.5, channels: [valid]},
    {sampleRate: 8000, channels: []},
    {sampleRate: 8000, channels: [valid, valid, valid]},
    {sampleRate: 8000, channels: [valid, new Float32Array(81)]},
    {sampleRate: 8000, channels: [new Float32Array(0)]},
    {sampleRate: 8000, channels: [Float32Array.of(NaN)]},
    {sampleRate: 8000, channels: [Float64Array.of(Infinity)]},
    {sampleRate: 8000, channels: [Float64Array.of(1e308)]},
    {sampleRate: 8000, channels: [new Float32Array(8000 * 181)]},
  ]) assert.throws(() => analyzeMixAudio(input), /Mix analysis/);
});

for (const bpm of [100, 150]) test('held-out ' + bpm + ' BPM resists the 120-BPM prior', () => {
  const offsetSeconds = 0.219, pcm = makeMixFixture({bpm, tonic: 7, mode: 'major', offsetSeconds});
  const result = analyzeMixAudio(pcm);
  assert.ok(result.tempo.bpm !== null && Math.abs(result.tempo.bpm - bpm) <= 0.25,
    'held-out tempo detected ' + result.tempo.bpm);
  for (let beat = 1; beat < 31; beat++) {
    const expected = offsetSeconds + beat * 60 / bpm;
    assert.ok(Math.min(...result.beatGrid.frames.map(frame => Math.abs(frame / pcm.sampleRate - expected))) <= 0.025);
  }
  assert.equal(result.key.name, 'G major');
  assertBounded(result);
});
