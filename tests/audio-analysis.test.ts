import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeAudio, decodeWav} from '../src/audio-analysis.js';

type Encoding = 'pcm16' | 'pcm24' | 'pcm32' | 'float32';
type Signal = (frame: number, channel: number) => number;

/** Test-authored RIFF bytes; no audio files or production encoder are used. */
function wav(rate: number, seconds: number, signal: Signal,
  channels = 1, encoding: Encoding = 'pcm16'): Uint8Array {
  const frames = Math.round(rate * seconds);
  const bytesPerSample = encoding === 'pcm16' ? 2 : encoding === 'pcm24' ? 3 : 4;
  const size = frames * channels * bytesPerSample;
  const bytes = new Uint8Array(44 + size + size % 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE');
  tag(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, encoding === 'float32' ? 3 : 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  tag(36, 'data'); view.setUint32(40, size, true);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const offset = 44 + (frame * channels + channel) * bytesPerSample;
      const value = signal(frame, channel);
      if (encoding === 'float32') {
        view.setFloat32(offset, value, true);
      } else {
        const scale = 2 ** (bytesPerSample * 8 - 1);
        const integer = Math.max(-scale, Math.min(scale - 1, Math.round(value * scale)));
        if (bytesPerSample === 2) view.setInt16(offset, integer, true);
        else if (bytesPerSample === 4) view.setInt32(offset, integer, true);
        else {
          bytes[offset] = integer & 255;
          bytes[offset + 1] = (integer >> 8) & 255;
          bytes[offset + 2] = (integer >> 16) & 255;
        }
      }
    }
  }
  return bytes;
}

function sine(rate: number, frequency = 1000, amplitude = 0.1, phase = 0): Signal {
  return frame => amplitude * Math.sin(2 * Math.PI * frequency * frame / rate + phase);
}

function near(actual: number | null, expected: number, tolerance = 1e-6): void {
  assert.ok(actual !== null && Number.isFinite(actual), 'expected a finite measurement');
  assert.ok(Math.abs(actual - expected) <= tolerance,
    'expected ' + expected + ' +/- ' + tolerance + ', got ' + actual);
}

function finiteNumbers(value: unknown): void {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), 'JSON numbers must be finite');
  else if (Array.isArray(value)) value.forEach(finiteNumbers);
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(finiteNumbers);
}

// Golden loudness values use the analytical 1 kHz transfer-function magnitude
// for BS.1770 K-weighting, not output from the implementation being tested.
for (const [rate, expectedLufs] of [[44100, -23.00083820], [48000, -23.00359556],
  [96000, -23.02089875]] as const) {
  test('known-level mono 1 kHz sine at ' + rate + ' Hz has calibrated LUFS/RMS/peak', () => {
    const result = analyzeAudio(decodeWav(wav(rate, 2, sine(rate))));
    assert.equal(result.loudness.status, 'measured');
    near(result.loudness.integrated_lufs, expectedLufs, 0.03);
    near(result.rms_dbfs, -23.01029996, 0.005);
    near(result.sample_peak.dbfs, -20, 0.005);
    assert.equal(result.clipping.samples, 0);
    assert.equal(result.rms_windows.length, 2);
    assert.equal(result.loudness.blocks_total, 17);
    assert.equal(result.loudness.blocks_after_relative_gate, 17);
    assert.ok(result.true_peak.linear >= result.sample_peak.linear);
  });
}

test('silence is represented explicitly without non-finite JSON numbers', () => {
  const result = analyzeAudio(decodeWav(wav(8000, 2, () => 0, 2)));
  assert.equal(result.loudness.status, 'below_absolute_gate');
  assert.equal(result.loudness.integrated_lufs, null);
  assert.equal(result.loudness.blocks_after_absolute_gate, 0);
  assert.equal(result.sample_peak.dbfs, null);
  assert.equal(result.true_peak.dbtp, null);
  assert.equal(result.rms_dbfs, null);
  assert.equal(result.energy.low_fraction, null);
  assert.equal(result.energy.mid_fraction, null);
  assert.equal(result.energy.high_fraction, null);
  assert.equal(result.energy.low + result.energy.mid + result.energy.high, 0);
  assert.equal(result.silence.frames, 16000);
  assert.equal(result.silence.start_seconds, 0);
  assert.equal(result.silence.end_seconds, 2);
  assert.equal(result.silence.duration_seconds, 2);
  assert.equal(result.clipping.samples, 0);
  finiteNumbers(result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('clipped square counts both PCM16 rails, samples and frames independently', () => {
  const result = analyzeAudio(decodeWav(wav(8000, 0.5,
    (frame, channel) => (Math.floor(frame / 8) + channel) % 2 ? -1 : 1, 2)));
  assert.equal(result.clipping.samples, 8000);
  assert.equal(result.clipping.frames, 4000);
  near(result.sample_peak.dbfs, 0);
  near(result.rms_dbfs, 0, 0.001);
  assert.equal(result.silence.frames, 0);
  assert.equal(result.silence.duration_seconds, 0);
});

test('anti-phase stereo sums channel energy without cancelling loudness, RMS or spectrum', () => {
  const rate = 48000;
  const tone = sine(rate);
  const mono = analyzeAudio(decodeWav(wav(rate, 1, tone)));
  const stereo = analyzeAudio(decodeWav(wav(rate, 1,
    (frame, channel) => tone(frame, 0) * (channel ? -1 : 1), 2)));
  near(stereo.loudness.integrated_lufs, mono.loudness.integrated_lufs! + 3.01029996, 0.001);
  near(stereo.rms_dbfs, mono.rms_dbfs!, 0.001);
  near(stereo.sample_peak.dbfs, mono.sample_peak.dbfs!, 0.001);
  assert.ok(stereo.energy.mid_fraction! > 0.999);
  assert.ok(stereo.silence.duration_seconds < 0.001);
});

test('absolute gate rejects a real but sub-gate float signal', () => {
  const rate = 48000;
  const result = analyzeAudio(decodeWav(wav(rate, 1, sine(rate, 1000, 1e-5), 1, 'float32')));
  assert.equal(result.loudness.status, 'below_absolute_gate');
  assert.equal(result.loudness.integrated_lufs, null);
  assert.equal(result.loudness.blocks_after_absolute_gate, 0);
  assert.ok(result.sample_peak.linear > 0);
});

test('relative gate excludes quiet programme blocks that pass the absolute gate', () => {
  const rate = 8000;
  const result = analyzeAudio(decodeWav(wav(rate, 6, frame => {
    const amplitude = frame < rate * 3 ? 0.1 : 0.001;
    return amplitude * Math.sin(2 * Math.PI * 1000 * frame / rate);
  }, 1, 'float32')));
  const loud = analyzeAudio(decodeWav(wav(rate, 3, sine(rate))));
  assert.equal(result.loudness.blocks_total, 57);
  assert.equal(result.loudness.blocks_after_absolute_gate, 57);
  assert.ok(result.loudness.blocks_after_relative_gate < 40);
  assert.ok(result.loudness.blocks_after_relative_gate >= 27);
  near(result.loudness.integrated_lufs, loud.loudness.integrated_lufs!, 0.3);
  assert.ok(result.loudness.relative_gate_lufs! < result.loudness.integrated_lufs! - 10);
});

test('less than 400 ms has no integrated loudness and does not pad a full block', () => {
  const result = analyzeAudio(decodeWav(wav(48000, 0.399, sine(48000))));
  assert.equal(result.loudness.status, 'too_short');
  assert.equal(result.loudness.integrated_lufs, null);
  assert.equal(result.loudness.blocks_total, 0);
  assert.equal(result.rms_windows.length, 1);
  near(result.rms_dbfs, -23.01029996, 0.005);
});

test('gating uses complete 400 ms blocks on a 100 ms hop', () => {
  const atBoundary = analyzeAudio(decodeWav(wav(8000, 0.4, sine(8000))));
  const beforeNext = analyzeAudio(decodeWav(wav(8000, 0.499875, sine(8000))));
  const atNext = analyzeAudio(decodeWav(wav(8000, 0.5, sine(8000))));
  assert.equal(atBoundary.loudness.blocks_total, 1);
  assert.equal(beforeNext.loudness.blocks_total, 1);
  assert.equal(atNext.loudness.blocks_total, 2);
});

test('one-second RMS windows retain an unpadded final partial window', () => {
  const rate = 8000;
  const result = analyzeAudio(decodeWav(wav(rate, 1.25,
    frame => (frame < rate ? 0.25 : 0.5) * (frame % 2 ? -1 : 1))));
  assert.equal(result.rms_windows.length, 2);
  const [first, last] = result.rms_windows;
  assert.equal(first!.start_seconds, 0);
  assert.equal(first!.end_seconds, 1);
  near(first!.rms, 0.25);
  assert.equal(last!.start_seconds, 1);
  assert.equal(last!.end_seconds, 1.25);
  near(last!.rms, 0.5);
  near(result.rms_dbfs, -10);
});

test('longest silence requires every channel below threshold and reports exact frame bounds', () => {
  const rate = 8000;
  const result = analyzeAudio(decodeWav(wav(rate, 0.6, (frame, channel) => {
    if (frame >= 1000 && frame < 3200) return 0;
    return channel === 0 ? 0 : 0.01;
  }, 2)));
  assert.equal(result.silence.threshold_dbfs, -60);
  assert.equal(result.silence.frames, 2200);
  near(result.silence.start_seconds, 1000 / rate);
  near(result.silence.end_seconds, 3200 / rate);
  near(result.silence.duration_seconds, 2200 / rate);
});

test('trailing silence is finalized and a frame exactly above threshold ends a run', () => {
  const rate = 8000;
  const result = analyzeAudio(decodeWav(wav(rate, 0.5,
    frame => frame < 1000 ? 0.002 : 0, 1, 'float32')));
  assert.equal(result.silence.frames, 3000);
  near(result.silence.start_seconds, 0.125);
  near(result.silence.end_seconds, 0.5);
  near(result.silence.duration_seconds, 0.375);
});

for (const [frequency, band] of [[100, 'low'], [1000, 'mid'], [6000, 'high']] as const) {
  test('a ' + frequency + ' Hz sine places its energy in the ' + band + ' band', () => {
    const result = analyzeAudio(decodeWav(wav(48000, 1, sine(48000, frequency, 0.25))));
    const fractions = [result.energy.low_fraction, result.energy.mid_fraction, result.energy.high_fraction];
    const selected = band === 'low' ? fractions[0] : band === 'mid' ? fractions[1] : fractions[2];
    assert.ok(selected! > 0.999, 'the isolated tone should dominate its defined band');
    near(fractions.reduce<number>((sum, fraction) => sum + fraction!, 0), 1);
    near(result.energy.low + result.energy.mid + result.energy.high, 0.25 ** 2 / 2, 2e-5);
  });
}

test('true peak detects the reconstructed peak missed by Fs/4 samples', () => {
  const rate = 48000;
  const result = analyzeAudio(decodeWav(wav(rate, 1, frame => {
    const seconds = frame / rate;
    const envelope = Math.min(1, seconds / 0.02, (1 - seconds) / 0.02);
    return 0.5 * envelope * Math.sin(Math.PI * frame / 2 + Math.PI / 4);
  }, 1, 'float32')));
  near(result.sample_peak.dbfs, -9.03089987, 0.001);
  assert.equal(result.true_peak.oversample, 4);
  // EBU Tech 3341 true-peak accuracy interval for a nominal -6.0206 dBTP tone.
  assert.ok(result.true_peak.dbtp! >= -6.4 && result.true_peak.dbtp! <= -5.8);
  assert.ok(result.true_peak.dbtp! - result.sample_peak.dbfs! > 2.5);
  assert.equal(result.clipping.samples, 0);
});

test('section analysis resets the filters and uses file-absolute RMS/silence timestamps', () => {
  const rate = 8000;
  const audio = decodeWav(wav(rate, 2,
    frame => frame < rate ? 0.1 * Math.sin(2 * Math.PI * 1000 * frame / rate) : 0));
  const result = analyzeAudio(audio, 1, 2);
  assert.equal(result.start_seconds, 1);
  assert.equal(result.end_seconds, 2);
  assert.equal(result.frames, rate);
  assert.equal(result.duration_seconds, 1);
  assert.equal(result.sample_peak.linear, 0);
  assert.equal(result.true_peak.linear, 0);
  assert.equal(result.loudness.integrated_lufs, null);
  assert.equal(result.silence.start_seconds, 1);
  assert.equal(result.silence.end_seconds, 2);
  assert.equal(result.rms_windows[0]!.start_seconds, 1);
  assert.equal(result.rms_windows[0]!.end_seconds, 2);
});

test('invalid section ranges fail instead of silently clipping or reversing the request', () => {
  const audio = decodeWav(wav(8000, 1, sine(8000)));
  for (const [start, end] of [[-1, 1], [0.5, 0.5], [0.8, 0.2], [0, 2],
    [NaN, 1], [0, Infinity]]) {
    assert.throws(() => analyzeAudio(audio, start, end));
  }
});

for (const encoding of ['pcm16', 'pcm24', 'pcm32', 'float32'] as const) {
  test(encoding + ' decoding preserves channel order, signed rails and rail-hit counts', () => {
    const audio = decodeWav(wav(8000, 0.01,
      (frame, channel) => frame < 20 ? (channel ? -1 : 1) : 0.25, 2, encoding));
    assert.equal(audio.format, encoding);
    assert.equal(audio.frames, 80);
    assert.equal(audio.channels, 2);
    assert.equal(audio.samples[0]![0], audio.positive_rail);
    assert.equal(audio.samples[1]![0], -1);
    near(audio.samples[0]![79]!, 0.25);
    const result = analyzeAudio(audio);
    assert.equal(result.clipping.samples, 40);
    assert.equal(result.clipping.frames, 20);
  });
}

test('float samples above full scale remain measurable and count as clipping', () => {
  const result = analyzeAudio(decodeWav(wav(8000, 0.01,
    frame => frame < 4 ? 1.25 : frame < 8 ? -1.5 : 0.25, 1, 'float32')));
  near(result.sample_peak.linear, 1.5);
  assert.ok(result.sample_peak.dbfs! > 0);
  assert.equal(result.clipping.samples, 8);
  assert.equal(result.clipping.frames, 8);
});

test('WAV decoding honors Uint8Array offsets and padded unknown RIFF chunks', () => {
  const original = wav(8000, 0.01, sine(8000));
  const wrapped = new Uint8Array(original.length + 13);
  wrapped.set(original, 7);
  const decoded = decodeWav(wrapped.subarray(7, 7 + original.length));
  assert.equal(decoded.frames, 80);
  const padded = new Uint8Array(original.length + 10);
  padded.set(original.subarray(0, 12));
  padded.set([74, 85, 78, 75, 1, 0, 0, 0, 42, 0], 12);
  padded.set(original.subarray(12), 22);
  new DataView(padded.buffer).setUint32(4, padded.length - 8, true);
  assert.deepEqual(decodeWav(padded).samples, decoded.samples);
});

test('corrupt, unsupported and non-finite WAV inputs are refused explicitly', () => {
  const original = wav(8000, 0.01, sine(8000));
  for (const offset of [0, 4, 8, 20, 22, 28, 32, 34, 40]) {
    const corrupt = original.slice();
    corrupt[offset] = corrupt[offset]! ^ 255;
    assert.throws(() => decodeWav(corrupt), 'corrupt byte offset ' + offset);
  }
  assert.throws(() => decodeWav(original.subarray(0, original.length - 1)));
  assert.throws(() => decodeWav(wav(8000, 0, () => 0)));
  assert.throws(() => decodeWav(wav(8000, 0.01, () => 0, 3)));
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => decodeWav(wav(8000, 0.01, () => value, 1, 'float32')));
  }
});

test('duplicate format or data chunks cannot silently override the first WAV payload', () => {
  const original = wav(8000, 0.01, sine(8000));
  for (const chunk of [original.subarray(12, 36), original.subarray(36)]) {
    const duplicate = new Uint8Array(original.length + chunk.length);
    duplicate.set(original);
    duplicate.set(chunk, original.length);
    new DataView(duplicate.buffer).setUint32(4, duplicate.length - 8, true);
    assert.throws(() => decodeWav(duplicate));
  }
});

for (const [frequency, expectedLufs] of [[100, -24.83479805], [10000, -19.65941773]] as const) {
  test('K-weighting frequency shape at ' + frequency + ' Hz matches an independent analytical reference', () => {
    const result = analyzeAudio(decodeWav(wav(48000, 2, sine(48000, frequency))));
    // Independently evaluated BS.1770-5 Tables 1-2 transfer function at 48 kHz;
    // 0.02 LU includes zero-state start transients and PCM16 quantization.
    near(result.loudness.integrated_lufs, expectedLufs, 0.02);
  });
}

test('FFT energy retains impulses at file and one-second window boundaries', () => {
  const rate = 48000;
  for (const impulseFrame of [0, rate]) {
    const result = analyzeAudio(decodeWav(wav(rate, 2,
      frame => frame === impulseFrame ? 0.5 : 0)));
    near(result.energy.low + result.energy.mid + result.energy.high, 0.25 / (2 * rate), 1e-12);
    assert.ok(result.energy.low_fraction !== null);
    assert.ok(result.energy.mid_fraction !== null);
    assert.ok(result.energy.high_fraction !== null);
    near(result.energy.low_fraction! + result.energy.mid_fraction! + result.energy.high_fraction!, 1);
  }
});
