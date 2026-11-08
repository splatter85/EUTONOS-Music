/** Offline measurement only: no playback, normalization or runtime dependencies. */
export interface WavAudio {
  readonly sample_rate: number;
  readonly channels: number;
  readonly frames: number;
  readonly format: 'pcm16' | 'pcm24' | 'pcm32' | 'float32';
  readonly samples: readonly Float64Array[];
  readonly positive_rail: number;
  readonly negative_rail: number;
}

export const MAX_ANALYSIS_BYTES = 64 * 1024 * 1024;

/** Deliberately bounded RIFF/WAVE decoder; pack validation still uses the existing loader. */
export function decodeWav(bytes: Uint8Array): WavAudio {
  const bad = (why: string): never => { throw new Error(`Unsupported or invalid WAV: ${why}`); };
  if (bytes.length < 44 || bytes.length > MAX_ANALYSIS_BYTES) bad('expected 44 bytes to 64 MiB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.length) {
    bad('little-endian RIFF/WAVE and exact RIFF length required');
  }
  let fmt: {code: number; bits: number; channels: number; rate: number; align: number} | undefined;
  let data: {start: number; size: number} | undefined;
  for (let at = 12; at < bytes.length;) {
    if (at + 8 > bytes.length) bad('truncated chunk header');
    const size = view.getUint32(at + 4, true), start = at + 8;
    const next = start + size + size % 2;
    if (next > bytes.length) bad('truncated chunk or missing padding');
    if (tag(at) === 'fmt ') {
      if (fmt || size < 16) bad('duplicate or short fmt chunk');
      const code = view.getUint16(start, true), bits = view.getUint16(start + 14, true);
      const channels = view.getUint16(start + 2, true), rate = view.getUint32(start + 4, true);
      const align = view.getUint16(start + 12, true);
      if (!((code === 1 && [16, 24, 32].includes(bits)) || (code === 3 && bits === 32))) {
        bad('supports PCM16/24/32 and IEEE float32; no compressed or extensible WAV');
      }
      if ((channels !== 1 && channels !== 2) || rate < 8000 || rate > 192000 ||
          align !== channels * bits / 8 || view.getUint32(start + 8, true) !== rate * align) {
        bad('expected consistent mono/stereo, 8–192 kHz, block alignment and byte rate');
      }
      fmt = {code, bits, channels, rate, align};
    } else if (tag(at) === 'data') {
      if (!fmt || data) bad('one data chunk must follow fmt');
      data = {start, size};
    }
    at = next;
  }
  if (!fmt || !data || data.size === 0 || data.size % fmt.align !== 0) {
    return bad('missing/empty data or partial sample frame');
  }
  const frames = data.size / fmt.align, step = fmt.bits / 8;
  const samples = Array.from({length: fmt.channels}, () => new Float64Array(frames));
  const scale = 2 ** (fmt.bits - 1);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < fmt.channels; channel++) {
      const at = data.start + frame * fmt.align + channel * step;
      let value: number;
      if (fmt.code === 3) value = view.getFloat32(at, true);
      else if (fmt.bits === 16) value = view.getInt16(at, true) / scale;
      else if (fmt.bits === 32) value = view.getInt32(at, true) / scale;
      else {
        const word = view.getUint8(at) | view.getUint8(at + 1) << 8 | view.getUint8(at + 2) << 16;
        value = ((word << 8) >> 8) / scale;
      }
      if (!Number.isFinite(value)) bad('non-finite float sample');
      samples[channel]![frame] = value;
    }
  }
  return {sample_rate: fmt.rate, channels: fmt.channels, frames,
    format: fmt.code === 3 ? 'float32' : `pcm${fmt.bits}` as WavAudio['format'], samples,
    positive_rail: fmt.code === 3 ? 1 : (scale - 1) / scale, negative_rail: -1};
}

const powerDb = (power: number): number | null => power > 0 ? 10 * Math.log10(power) : null;
const amplitudeDb = (value: number): number | null => value > 0 ? 20 * Math.log10(value) : null;
const energyLufs = (energy: number) => energy > 0 ? -0.691 + 10 * Math.log10(energy) : -Infinity;
type Coefficients = readonly [number, number, number, number, number];

class Biquad {
  private s1 = 0;
  private s2 = 0;
  constructor(private readonly c: Coefficients) {}
  next(x: number): number {
    const [b0, b1, b2, a1, a2] = this.c;
    const y = b0 * x + this.s1;
    this.s1 = b1 * x - a1 * y + this.s2;
    this.s2 = b2 * x - a2 * y;
    return y;
  }
}

/** BS.1770 shelf + RLB; rate parameterization independently checked against libebur128. */
function kFilters(rate: number): readonly [Coefficients, Coefficients] {
  const k = Math.tan(Math.PI * 1681.974450955533 / rate), q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20), vb = vh ** 0.4996667741545416;
  const d = 1 + k / q + k * k;
  const shelf: Coefficients = [(vh + vb * k / q + k * k) / d,
    2 * (k * k - vh) / d, (vh - vb * k / q + k * k) / d,
    2 * (k * k - 1) / d, (1 - k / q + k * k) / d];
  const r = Math.tan(Math.PI * 38.13547087602444 / rate), rq = 0.5003270373238773;
  const rd = 1 + r / rq + r * r;
  // RLB numerator is intentionally NOT divided by rd (unlike a conventional high-pass).
  return [shelf, [1, -2, 1, 2 * (r * r - 1) / rd, (1 - r / rq + r * r) / rd]];
}

function loudness(samples: readonly Float64Array[], rate: number) {
  const frames = samples[0]!.length, block = Math.round(rate * 0.4), hop = Math.round(rate * 0.1);
  const empty = {integrated_lufs: null, blocks_total: 0, blocks_after_absolute_gate: 0,
    blocks_after_relative_gate: 0, relative_gate_lufs: null};
  if (frames < block) return {...empty, status: 'too_short' as const};
  const coefficients = kFilters(rate);
  const filters = samples.map(() => coefficients.map(c => new Biquad(c)));
  const ring = new Float64Array(block), blocks: number[] = [];
  let running = 0;
  for (let i = 0; i < frames; i++) {
    let energy = 0;
    for (let ch = 0; ch < samples.length; ch++) {
      const f = filters[ch]!;
      const y = f[1]!.next(f[0]!.next(samples[ch]![i]!));
      energy += y * y; // Mono/stereo weights are one each. Never downmix or average channels.
    }
    const slot = i % block;
    running += energy - ring[slot]!;
    ring[slot] = energy;
    if (i + 1 >= block && (i + 1 - block) % hop === 0) blocks.push(Math.max(0, running / block));
  }
  const absolute = blocks.filter(e => energyLufs(e) > -70);
  if (!absolute.length) return {...empty, blocks_total: blocks.length, status: 'below_absolute_gate' as const};
  const mean = (values: readonly number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const relativeGate = energyLufs(mean(absolute)) - 10;
  const gated = absolute.filter(e => energyLufs(e) > relativeGate);
  return {integrated_lufs: energyLufs(mean(gated)), status: 'measured' as const,
    blocks_total: blocks.length, blocks_after_absolute_gate: absolute.length,
    blocks_after_relative_gate: gated.length, relative_gate_lufs: relativeGate};
}

/** BS.1770-5 Annex 2, Table 1: each row here is one polyphase column. */
const TRUE_PEAK_PHASES: readonly (readonly number[])[] = [
  [0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875,
    0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125,
    0.014892578125, -0.00830078125],
  [-0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625,
    0.465087890625, 0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625,
    0.0330810546875, -0.0189208984375],
  [-0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125,
    0.77978515625, 0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125,
    0.029296875, -0.0291748046875],
  [-0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875,
    0.97216796875, 0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125,
    0.010986328125, 0.001708984375],
];

function truePeak(samples: readonly Float64Array[], samplePeak: number): number {
  let peak = samplePeak;
  for (const channel of samples) {
    // Zero-extend both boundaries and flush the complete FIR tail, including section boundaries.
    for (let n = 0; n < channel.length + 11; n++) {
      const first = Math.max(0, n - channel.length + 1), last = Math.min(11, n);
      for (const phase of TRUE_PEAK_PHASES) {
        let interpolated = 0;
        for (let k = first; k <= last; k++) interpolated += phase[k]! * channel[n - k]!;
        peak = Math.max(peak, Math.abs(interpolated));
      }
    }
  }
  return peak;
}

/** In-place radix-2 FFT; used only by the offline spectral energy split. */
function fft(real: Float64Array, imaginary: Float64Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const re = real[i]!, im = imaginary[i]!;
      real[i] = real[j]!; imaginary[i] = imaginary[j]!;
      real[j] = re; imaginary[j] = im;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = -2 * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let ur = 1, ui = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j, b = a + size / 2;
        const br = real[b]! * ur - imaginary[b]! * ui;
        const bi = real[b]! * ui + imaginary[b]! * ur;
        real[b] = real[a]! - br; imaginary[b] = imaginary[a]! - bi;
        real[a] = real[a]! + br; imaginary[a] = imaginary[a]! + bi;
        const next = ur * wr - ui * wi;
        ui = ur * wi + ui * wr; ur = next;
      }
    }
  }
}

function bandEnergy(samples: readonly Float64Array[], rate: number) {
  const frames = samples[0]!.length;
  const energy = [0, 0, 0];
  for (let start = 0; start < frames; start += rate) {
    const count = Math.min(rate, frames - start);
    let size = 1;
    while (size < count) size *= 2;
    for (const channel of samples) {
      const real = new Float64Array(size), imaginary = new Float64Array(size);
      // Rectangular windows retain boundary transients and partition all raw signal energy.
      for (let i = 0; i < count; i++) real[i] = channel[start + i]!;
      fft(real, imaginary);
      for (let k = 0; k <= Math.floor(size / 2); k++) {
        const frequency = k * rate / size;
        const band = frequency < 250 ? 0 : frequency < 4000 ? 1 : 2;
        const oneSided = k === 0 || (size > 1 && k === size / 2) ? 1 : 2;
        energy[band] = energy[band]! + oneSided * (real[k]! ** 2 + imaginary[k]! ** 2) /
          (size * frames * samples.length);
      }
    }
  }
  const [low, mid, high] = energy as [number, number, number], total = low + mid + high;
  return {low, mid, high, low_fraction: total > 0 ? low / total : null,
    mid_fraction: total > 0 ? mid / total : null, high_fraction: total > 0 ? high / total : null};
}

/** Measure [start,end) as a standalone clip: nearest sample boundaries, fresh filters, no borrowed tail. */
export function analyzeAudio(audio: WavAudio, startSeconds = 0,
  endSeconds = audio.frames / audio.sample_rate) {
  const rate = audio.sample_rate, duration = audio.frames / rate;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
      startSeconds < 0 || endSeconds > duration || startSeconds >= endSeconds) {
    throw new Error(`Section must satisfy 0 <= start < end <= ${duration} seconds`);
  }
  const start = Math.round(startSeconds * rate), end = Math.round(endSeconds * rate), frames = end - start;
  if (frames < 1) throw new Error('Section contains no complete sample frame after rounding');
  const samples = audio.samples.map(channel => channel.subarray(start, end));
  let peak = 0, sumSquares = 0, windowSquares = 0, clippingSamples = 0, clippingFrames = 0;
  let silenceRun = 0, silenceFrames = 0, silenceEnd = 0, windowStart = 0;
  const rmsWindows: {start_seconds: number; end_seconds: number; rms: number; dbfs: number | null}[] = [];
  for (let i = 0; i < frames; i++) {
    let framePeak = 0, frameClipped = false;
    for (const channel of samples) {
      const x = channel[i]!;
      framePeak = Math.max(framePeak, Math.abs(x));
      sumSquares += x * x; windowSquares += x * x;
      if (x >= audio.positive_rail || x <= audio.negative_rail) { clippingSamples++; frameClipped = true; }
    }
    peak = Math.max(peak, framePeak);
    if (frameClipped) clippingFrames++;
    silenceRun = framePeak < 0.001 ? silenceRun + 1 : 0;
    if (silenceRun > silenceFrames) { silenceFrames = silenceRun; silenceEnd = i + 1; }
    if (i + 1 - windowStart === rate || i + 1 === frames) {
      const power = windowSquares / ((i + 1 - windowStart) * samples.length);
      rmsWindows.push({start_seconds: (start + windowStart) / rate, end_seconds: (start + i + 1) / rate,
        rms: Math.sqrt(power), dbfs: powerDb(power)});
      windowSquares = 0; windowStart = i + 1;
    }
  }
  const interpolated = truePeak(samples, peak);
  return {start_seconds: start / rate, end_seconds: end / rate, frames, duration_seconds: frames / rate,
    loudness: loudness(samples, rate), sample_peak: {linear: peak, dbfs: amplitudeDb(peak)},
    true_peak: {linear: interpolated, dbtp: amplitudeDb(interpolated), oversample: 4 as const,
      method: 'BS.1770-5 Annex 2 4x FIR estimate; zero-extended boundaries; sample-peak floor'},
    rms_dbfs: powerDb(sumSquares / (frames * samples.length)), rms_windows: rmsWindows,
    energy: bandEnergy(samples, rate),
    silence: {threshold_dbfs: -60 as const, frames: silenceFrames,
      start_seconds: silenceFrames ? (start + silenceEnd - silenceFrames) / rate : null,
      end_seconds: silenceFrames ? (start + silenceEnd) / rate : null, duration_seconds: silenceFrames / rate},
    clipping: {samples: clippingSamples, frames: clippingFrames}};
}

export type AudioAnalysis = ReturnType<typeof analyzeAudio>;
