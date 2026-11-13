import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, type MixPcm, type TempoEstimate} from '../src/mix-analysis.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';

interface Pattern {
  bpm: number;
  kicks?: 'all' | 'alternate' | 'missing' | 'dnb' | 'one' | 'rare';
  beatCount?: number;
  kickAccent?: boolean;
  snare?: 'backbeat' | 'half' | 'none';
  snareGain?: number;
  hats?: 'beat' | 'double' | 'none';
  introBars?: number;
  tonalIntro?: boolean;
  jitterSeconds?: number;
}
function drumPattern({bpm, kicks = 'all', beatCount = 32, kickAccent = true,
  snare = 'backbeat', snareGain = 1, hats = 'beat', introBars = 0,
  tonalIntro = false, jitterSeconds = 0}: Pattern): MixPcm {
  const sampleRate = 8000, beats = beatCount, period = 60 / bpm;
  const channel = new Float32Array(Math.ceil((beats + 1) * period * sampleRate));
  const add = (time: number, length: number, sound: (t: number) => number) => {
    const start = Math.round(time * sampleRate);
    for (let i = 0; i < Math.round(length * sampleRate) && start + i < channel.length; i++) {
      channel[start + i] = channel[start + i]! + sound(i / sampleRate);
    }
  };
  if (tonalIntro) for (let i = 0; i < Math.round(introBars * 4 * period * sampleRate); i++) {
    const t = i / sampleRate;
    channel[i] = 0.08 * Math.sin(2 * Math.PI * 220 * t) +
      0.04 * Math.sin(2 * Math.PI * 330 * t);
  }
  for (let beat = introBars * 4; beat < beats; beat++) {
    const at = 0.137 + beat * period + (beat % 3 - 1) * jitterSeconds;
    const mainKick = kicks === 'all' || kicks === 'alternate' && beat % 2 === 0 ||
      kicks === 'missing' && beat % 7 !== 3 ||
      (kicks === 'dnb' || kicks === 'one') && beat % 4 === 0 ||
      kicks === 'rare' && beat % 8 === 0;
    if (mainKick) {
      const gain = kickAccent && beat % 4 === 0 ? 1 : 0.72;
      add(at, 0.11, t => gain * 0.55 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-37 * t));
    }
    if (kicks === 'dnb' && beat % 4 === 2) add(at + period / 2, 0.11,
      t => 0.4 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-37 * t));
    if (snare === 'backbeat' && beat % 4 % 2 === 1 || snare === 'half' && beat % 4 === 2) {
      add(at, 0.07, t => snareGain * 0.32 * (Math.sin(2 * Math.PI * 790 * t) +
        0.5 * Math.sin(2 * Math.PI * 1680 * t)) * Math.exp(-65 * t));
    }
    if (hats !== 'none') {
      add(at, 0.035, t => 0.07 * Math.sin(2 * Math.PI * 3100 * t) * Math.exp(-125 * t));
      if (hats === 'double') add(at + period / 2, 0.035,
        t => 0.07 * Math.sin(2 * Math.PI * 3100 * t) * Math.exp(-125 * t));
    }
  }
  return {sampleRate, channels: [channel]};
}
function hasTempo(tempo: TempoEstimate, bpm: number): boolean {
  return tempo.candidates.some(c => Math.abs(c.bpm - bpm) < 0.6);
}
function assertRanked(tempo: TempoEstimate): void {
  for (let i = 0; i < tempo.candidates.length; i++) {
    const c = tempo.candidates[i]!;
    for (const n of Object.values(c)) assert.ok(Number.isFinite(n));
    assert.ok(c.bpm >= 60 && c.bpm <= 180);
    assert.ok(c.gridCoverage >= 0 && c.gridCoverage <= 1);
    assert.ok(c.lowPeriodicity >= 0 && c.lowPeriodicity <= 1);
    if (i) assert.ok(tempo.candidates[i - 1]!.strength >= c.strength);
  }
  assert.ok(tempo.ambiguity >= 0 && tempo.ambiguity <= 1);
}

for (const pattern of [
  {bpm: 60}, {bpm: 80}, {bpm: 87, snare: 'half', hats: 'double'}, {bpm: 100},
  {bpm: 120, kicks: 'missing', introBars: 2}, {bpm: 140, hats: 'double'},
  {bpm: 160}, {bpm: 174, snare: 'backbeat', hats: 'double'},
] as const) {
  test('generated rhythm ranks unambiguous ' + pattern.bpm + ' BPM', () => {
    const result = analyzeMixAudio(drumPattern(pattern));
    assertRanked(result.tempo);
    assert.ok(hasTempo(result.tempo, pattern.bpm), 'true tempo must be among candidates');
    assert.ok(result.tempo.bpm !== null && Math.abs(result.tempo.bpm - pattern.bpm) < 0.6,
      'octave selection: ' + JSON.stringify(result.tempo.candidates.slice(0, 3)));
    assert.ok(result.tempo.ambiguity <= 0.5, 'unambiguous pattern should pass tempo gate');
    assert.ok(result.beatGrid.confidence > 0.55);
  });
}

test('supported octave relatives are retained beside nearby peaks', () => {
  const tempo = analyzeMixAudio(drumPattern({bpm: 120})).tempo;
  assert.ok(hasTempo(tempo, 120) && hasTempo(tempo, 60));
  const fast = analyzeMixAudio(drumPattern({bpm: 87, hats: 'double'})).tempo;
  assert.ok(hasTempo(fast, 87) && hasTempo(fast, 174));
});

for (const bpm of [87, 174]) test('syncopated DnB ' + bpm + ' keeps the true tempo candidate', () => {
  const tempo = analyzeMixAudio(drumPattern({bpm, kicks: 'dnb', hats: 'double'})).tempo;
  assertRanked(tempo);
  assert.ok(hasTempo(tempo, bpm));
  if (tempo.ambiguity <= 0.5) assert.ok(tempo.bpm !== null && Math.abs(tempo.bpm - bpm) < 0.6);
});

test('weak alternate kicks and backbeat still retain the meter candidate', () => {
  const tempo = analyzeMixAudio(drumPattern({bpm: 120, kicks: 'alternate',
    snare: 'backbeat', hats: 'double'})).tempo;
  assert.ok(hasTempo(tempo, 120));
  if (tempo.ambiguity <= 0.5) assert.ok(tempo.bpm !== null && Math.abs(tempo.bpm - 120) < 0.6);
});

test('sparse syncopation exposes an octave rival and reduces confidence', () => {
  const ambiguous = analyzeMixAudio(drumPattern({bpm: 87, kicks: 'dnb', hats: 'double'}));
  const clear = analyzeMixAudio(drumPattern({bpm: 87, snare: 'half', hats: 'double'}));
  assert.ok(hasTempo(ambiguous.tempo, 87) && hasTempo(ambiguous.tempo, 174));
  assert.ok(ambiguous.tempo.ambiguity > 0.5);
  assert.ok(ambiguous.tempo.ambiguity > clear.tempo.ambiguity);
  assert.ok(ambiguous.tempo.confidence < clear.tempo.confidence);
});

test('low attack locates bar one when snare is louder', () => {
  const pcm = drumPattern({bpm: 120, snareGain: 1.8});
  const result = analyzeMixAudio(pcm);
  const expected = 0.137 + 4 * 60 / 120;
  assert.ok(result.structure.downbeatFrames.some(f =>
    Math.abs(f / pcm.sampleRate - expected) < 0.03));
  assert.ok(result.structure.downbeatConfidence > 0.1);
});

test('equal kick accents leave downbeat phase uncertain', () => {
  const result = analyzeMixAudio(drumPattern({bpm: 120, kickAccent: false, snare: 'none'}));
  assert.ok(result.structure.downbeatConfidence < 0.15);
});

test('tonal drumless intro does not claim an early downbeat', () => {
  const result = analyzeMixAudio(drumPattern({bpm: 120, introBars: 2, tonalIntro: true}));
  assert.ok(result.tempo.bpm !== null && Math.abs(result.tempo.bpm - 120) < 0.6);
  assert.ok(result.structure.downbeatFrames.every(f => f / result.sampleRate >= 3.9));
});

test('timing jitter increases final-grid residual and lowers beat confidence', () => {
  const rigid = analyzeMixAudio(drumPattern({bpm: 120}));
  const jitter = analyzeMixAudio(drumPattern({bpm: 120, jitterSeconds: 0.015}));
  assert.ok(jitter.beatGrid.maxFitErrorSeconds !== null &&
    rigid.beatGrid.maxFitErrorSeconds !== null &&
    jitter.beatGrid.maxFitErrorSeconds > rigid.beatGrid.maxFitErrorSeconds + 0.005);
  assert.ok(jitter.beatGrid.confidence < rigid.beatGrid.confidence);
});

test('generation hint is soft and a wrong octave cannot erase strong audio evidence', () => {
  const pcm = drumPattern({bpm: 120});
  const measured = analyzeMixAudio(pcm, {generationBpm: 60});
  assert.ok(measured.tempo.bpm !== null && Math.abs(measured.tempo.bpm - 120) < 0.6);
  assert.ok(measured.tempo.candidates.some(c => c.hintSupport > 0.9));
  assert.throws(() => analyzeMixAudio(pcm, {generationBpm: NaN}), /Mix analysis/);
});

test('requested 124 BPM does not override a measured 125 BPM render', () => {
  const pcm = makeMixFixture({bpm: 125, sampleRate: 16000});
  const options = {generationBpm: 124};
  const report = analyzeMixAudio(pcm, options);
  assert.ok(report.tempo.bpm !== null && Math.abs(report.tempo.bpm - 125) < 0.25);
  assert.deepEqual(report, analyzeMixAudio(pcm, options));
});

test('weak major balance stays below phrase gate while stronger accents pass', () => {
  const options = {sampleRate: 44100, bpm: 124, tonic: 2, mode: 'major' as const};
  const weak = analyzeMixAudio(makeMixFixture(options));
  const drums = makeMixFixture({...options, chords: false});
  const chords = makeMixFixture({...options, drums: false});
  const strong = analyzeMixAudio({sampleRate: options.sampleRate, channels: [
    Float32Array.from(drums.channels[0]!, (sample, i) =>
      1.5 * sample + 0.65 * chords.channels[0]![i]!),
  ]});
  assert.ok(weak.structure.phraseConfidence < 0.2);
  assert.ok(strong.structure.phraseConfidence >= 0.2);
  assert.ok(strong.structure.downbeatConfidence > weak.structure.downbeatConfidence);
});

test('one low attack per bar cannot establish a supported downbeat sequence', () => {
  const result = analyzeMixAudio(drumPattern({bpm: 120, kicks: 'rare', beatCount: 64, snare: 'none'}));
  assert.equal(result.tempo.status, 'estimated');
  assert.ok(result.beatGrid.frames.length > 0);
  assert.deepEqual(result.structure.downbeatFrames, []);
  assert.equal(result.structure.downbeatConfidence, 0);
  assert.equal(result.structure.phraseConfidence, 0);
});
