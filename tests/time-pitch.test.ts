import assert from 'node:assert/strict';
import test from 'node:test';
import {renderTimePitch, outputFrameAtSource, sourceFrameAtOutput, TIME_PITCH_LIMITS,
  type TimePitchPcm} from '../src/time-pitch.js';

const near = (actual: number, expected: number, tolerance: number): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
};
function tone(rate = 48000, seconds = 3, frequency = 440, amplitude = 0.4): TimePitchPcm {
  return {sampleRate: rate, channels: [Float32Array.from({length: Math.round(rate * seconds)},
    (_, frame) => amplitude * Math.sin(2 * Math.PI * frequency * frame / rate))]};
}
/** Frequency measured from positive zero-crossings; independent of the WSOLA implementation. */
function frequency(audio: Float32Array, rate: number): number {
  const crossing: number[] = [], margin = Math.round(rate * 0.2);
  for (let i = margin; i < audio.length - margin; i++) if (audio[i - 1]! <= 0 && audio[i]! > 0) {
    crossing.push(i - audio[i]! / (audio[i]! - audio[i - 1]!));
  }
  assert.ok(crossing.length > 5);
  return rate * (crossing.length - 1) / (crossing.at(-1)! - crossing[0]!);
}
function drums(bpm: number, beats = 16, rate = 48000): TimePitchPcm {
  const channel = new Float32Array(Math.round(beats * 60 / bpm * rate));
  for (let beat = 0; beat < beats; beat++) {
    const start = Math.round(beat * 60 / bpm * rate);
    for (let i = 0; i < Math.round(rate * 0.08) && start + i < channel.length; i++) {
      channel[start + i] = 0.5 * Math.sin(2 * Math.PI * 110 * i / rate) * Math.exp(-i / (rate * 0.012));
    }
  }
  return {sampleRate: rate, channels: [channel]};
}
function peaksNear(channel: Float32Array, rate: number, expected: readonly number[]): number[] {
  return expected.map(seconds => {
    const middle = Math.round(seconds * rate), radius = Math.round(rate * 0.04);
    let peak = 0, frame = middle;
    for (let i = Math.max(0, middle - radius); i <= Math.min(channel.length - 1, middle + radius); i++) {
      if (Math.abs(channel[i]!) > peak) { peak = Math.abs(channel[i]!); frame = i; }
    }
    assert.ok(peak > 0.1, 'Expected drum attack must survive processing.');
    return frame / rate;
  });
}
/** Least-squares beat period, so bounded onset jitter cannot masquerade as a systematic tempo change. */
function measuredBpm(times: readonly number[]): number {
  const meanX = (times.length - 1) / 2, meanY = times.reduce((sum, t) => sum + t, 0) / times.length;
  let numerator = 0, denominator = 0;
  times.forEach((time, index) => { numerator += (index - meanX) * (time - meanY); denominator += (index - meanX) ** 2; });
  return 60 / (numerator / denominator);
}

for (const ratio of [0.92, 118 / 120, 1, 124 / 120, 1.08]) {
  test(`tempo-only ${ratio} preserves 440 Hz and exact rounded duration`, () => {
    const input = tone(), result = renderTimePitch(input, {tempoRatio: ratio});
    assert.equal(result.audio.channels[0]!.length, Math.round(input.channels[0]!.length / ratio));
    near(frequency(result.audio.channels[0]!, input.sampleRate), 440, 0.5);
    assert.ok(result.metrics.maxSampleJump < 0.04, 'No added large discontinuity inside a continuous tone.');
    assert.equal(result.metrics.boundaryJump, 0);
    assert.ok(result.metrics.maxLocalOffsetFrames <= input.sampleRate * 0.01);
  });
}
for (const semitones of [-2, -1, 1, 2]) {
  test(`pitch-only ${semitones} semitones preserves duration and reaches its known frequency`, () => {
    const input = tone(), result = renderTimePitch(input, {tempoRatio: 1, pitchSemitones: semitones});
    const expected = 440 * 2 ** (semitones / 12);
    assert.equal(result.audio.channels[0]!.length, input.channels[0]!.length);
    assert.ok(Math.abs(1200 * Math.log2(frequency(result.audio.channels[0]!, input.sampleRate) / expected)) < 2,
      'Pitch error must stay within two cents for this pure-tone case.');
    assert.ok(result.metrics.maxSampleJump < 0.04);
    assert.equal(result.metrics.boundaryJump, 0);
  });
}

for (const ratio of [0.92, 1.08]) for (const semitones of [-2, 2]) {
  test(`combined accepted-range corner ${ratio}/${semitones} preserves independent pitch and length`, () => {
    const input = tone(), result = renderTimePitch(input, {tempoRatio: ratio, pitchSemitones: semitones});
    const expected = 440 * 2 ** (semitones / 12);
    assert.equal(result.audio.channels[0]!.length, Math.round(input.channels[0]!.length / ratio));
    assert.ok(Math.abs(1200 * Math.log2(frequency(result.audio.channels[0]!, input.sampleRate) / expected)) < 2);
    assert.ok(result.metrics.maxSampleJump < 0.04);
    assert.equal(result.metrics.boundaryJump, 0);
  });
}

for (const bpm of [118, 120, 124]) for (const semitones of [0, 2]) {
  test(`${bpm} BPM drums become 120 BPM with pitch ${semitones}, within 0.3 BPM and 20 ms`, () => {
    const input = drums(bpm), result = renderTimePitch(input, {tempoRatio: 120 / bpm, pitchSemitones: semitones});
    const expected = Array.from({length: 14}, (_, index) => (index + 1) * 0.5);
    const actual = peaksNear(result.audio.channels[0]!, input.sampleRate, expected);
    near(measuredBpm(actual), 120, 0.3);
    actual.forEach((time, index) => near(time, expected[index]!, 0.02));
    assert.equal(result.audio.channels[0]!.length, Math.round(input.channels[0]!.length / (120 / bpm)));
  });
}

for (const rate of [8000, 44100, 48000]) {
  test(`stereo remains exactly anti-phase at ${rate} Hz with independent time and pitch`, () => {
    const left = tone(rate, 1, 220).channels[0]!;
    const right = Float32Array.from(left, value => -value);
    const result = renderTimePitch({sampleRate: rate, channels: [left, right]}, {tempoRatio: 1.04, pitchSemitones: -2});
    const [a, b] = result.audio.channels;
    assert.ok(a!.some(value => Math.abs(value) > 0.2), 'No cancellation/downmix to silence.');
    for (let i = 0; i < a!.length; i++) near(a![i]! + b![i]!, 0, 0);
    assert.equal(left.byteLength, rate * 4);
  });
}

test('same PCM and plan produce identical output bits, metrics and mappings without mutating the input', () => {
  const input = drums(118, 8, 44100), original = Buffer.from(input.channels[0]!.buffer).toString('hex');
  const options = {tempoRatio: 120 / 118, pitchSemitones: -2};
  const first = renderTimePitch(input, options), second = renderTimePitch(input, options);
  assert.deepEqual(Buffer.from(first.audio.channels[0]!.buffer), Buffer.from(second.audio.channels[0]!.buffer));
  assert.deepEqual(first.mapping, second.mapping);
  assert.deepEqual(first.metrics, second.metrics);
  assert.equal(Buffer.from(input.channels[0]!.buffer).toString('hex'), original);
});

test('return-to-original maps the ramp analytically, is monotonic and has exact endpoints', () => {
  const input = tone(8000, 8), rate = input.sampleRate;
  for (const ratio of [0.92, 1.08]) {
    const result = renderTimePitch(input, {tempoRatio: ratio, returnToOriginal: {afterFrames: rate * 2, rampFrames: rate * 2}});
    const map = result.mapping;
    // Integral: ratio*2 seconds + ((ratio+1)/2)*2 seconds + the remaining native-speed audio.
    assert.equal(map.outputFrames, Math.round((8 - (ratio - 1) * 3) * rate));
    assert.equal(sourceFrameAtOutput(map, 0), 0);
    assert.equal(sourceFrameAtOutput(map, map.outputFrames), map.inputFrames);
    assert.equal(outputFrameAtSource(map, map.inputFrames), map.outputFrames);
    assert.equal(sourceFrameAtOutput(map, -1), 0);
    assert.equal(outputFrameAtSource(map, map.inputFrames + 1), map.outputFrames);
    near(sourceFrameAtOutput(map, 3 * rate), (2 * ratio + ratio + (1 - ratio) / 4) * rate, 1);
    let previous = -1;
    for (let i = 0; i <= map.inputFrames; i += 97) {
      const out = outputFrameAtSource(map, i);
      assert.ok(out >= previous);
      near(sourceFrameAtOutput(map, out), i, 1);
      previous = out;
    }
  }
});

test('rendered drums return from 124 to 120 BPM after the requested smooth ramp', () => {
  const input = drums(120, 32), rate = input.sampleRate, ratio = 124 / 120;
  const result = renderTimePitch(input, {tempoRatio: ratio,
    returnToOriginal: {afterFrames: rate * 4, rampFrames: rate * 2}});
  const early = Array.from({length: 6}, (_, index) => (index + 1) * 60 / 124);
  // A constant-rate difference of (ratio-1)*(4+2/2) seconds accumulates before native speed resumes.
  const late = Array.from({length: 10}, (_, index) => (index + 16) * 0.5 - (ratio - 1) * 5);
  near(measuredBpm(peaksNear(result.audio.channels[0]!, rate, early)), 124, 0.3);
  near(measuredBpm(peaksNear(result.audio.channels[0]!, rate, late)), 120, 0.3);
  assert.equal(result.metrics.boundaryJump, 0);
});

test('peak control applies one reported channel gain and retains explicit zero outer boundaries', () => {
  const input = tone(48000, 1, 440, 1.5), result = renderTimePitch(input, {tempoRatio: 0.96, pitchSemitones: 2});
  assert.ok(result.metrics.gainApplied < 1);
  assert.ok(result.metrics.outputPeak <= TIME_PITCH_LIMITS.peakCeiling + 1e-7);
  assert.equal(result.metrics.edgeFadeFrames, 240);
  assert.equal(result.metrics.boundaryJump, 0);
  assert.equal(result.audio.channels[0]![0], 0);
  assert.equal(Math.abs(result.audio.channels[0]!.at(-1)!), 0);
});

test('silence stays finite, zero and the requested length', () => {
  const input = {sampleRate: 8000, channels: [new Float64Array(8000)]};
  const result = renderTimePitch(input, {tempoRatio: 0.92, pitchSemitones: -2});
  assert.ok(result.audio.channels[0]!.every(value => value === 0));
  assert.equal(result.metrics.outputPeak, 0);
  assert.equal(result.metrics.gainApplied, 1);
  assert.equal(result.mapping.outputFrames, Math.round(8000 / 0.92));
});

test('pitch-up resampling attenuates energy that would otherwise alias across Nyquist', () => {
  const input = tone(48000, 1, 48000 * 0.49), result = renderTimePitch(input, {tempoRatio: 1, pitchSemitones: 2});
  const channel = result.audio.channels[0]!;
  let power = 0;
  for (let i = 12000; i < 36000; i++) power += channel[i]! ** 2;
  assert.ok(Math.sqrt(power / 24000) < 0.003, 'Out-of-band content should be attenuated, not folded back at full level.');
});

test('ranges, malformed audio and impossible returns are refused before rendering', () => {
  const input = tone(8000, 1);
  for (const tempoRatio of [0.919, 1.081, 0, -1, NaN, Infinity]) {
    assert.throws(() => renderTimePitch(input, {tempoRatio}), /Tempo ratio/);
  }
  for (const pitchSemitones of [-2.001, 2.001, NaN, Infinity]) {
    assert.throws(() => renderTimePitch(input, {tempoRatio: 1, pitchSemitones}), /Pitch shift/);
  }
  for (const channels of [[], [new Float32Array(0)], [new Float32Array(1)],
    [new Float32Array(100), new Float32Array(99)], [new Float32Array(100), new Float32Array(100), new Float32Array(100)]]) {
    assert.throws(() => renderTimePitch({sampleRate: 8000, channels}, {tempoRatio: 1}));
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    const channel = new Float64Array(100); channel[20] = value;
    assert.throws(() => renderTimePitch({sampleRate: 8000, channels: [channel]}, {tempoRatio: 1}), /non-finite/);
  }
  for (const back of [{afterFrames: -1, rampFrames: 1000}, {afterFrames: 1000, rampFrames: 0},
    {afterFrames: 7000, rampFrames: 4000}, {afterFrames: Infinity, rampFrames: 1000}]) {
    assert.throws(() => renderTimePitch(input, {tempoRatio: 1.04, returnToOriginal: back}), /Return-to-original/);
  }
  assert.throws(() => renderTimePitch({...input, sampleRate: 0}, {tempoRatio: 1}));
  assert.throws(() => renderTimePitch({...input, sampleRate: 8000.1}, {tempoRatio: 1}));
});
