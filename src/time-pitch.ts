/** Original bounded WSOLA implementation. No third-party source or runtime package.
 * Research, tradeoffs and licensing are recorded in docs/DJ_TRANSITIONS.md.
 * Runs during preparation only: never call it from an audio callback.
 */
export const TIME_PITCH_PROCESSOR = 'eutonos-wsola@1' as const;
export const TIME_PITCH_LIMITS = Object.freeze({minTempoRatio: 0.92, maxTempoRatio: 1.08,
  maxPitchSemitones: 2, maxSeconds: 180, maxSamples: 12_000_000, peakCeiling: 10 ** (-1 / 20)});
export interface TimePitchPcm {
  readonly sampleRate: number;
  readonly channels: readonly (Float32Array | Float64Array)[];
}
export interface TimePitchOptions {
  /** B's output tempo / original tempo. 1.04 makes a 100 BPM recording 104 BPM. */
  readonly tempoRatio: number;
  readonly pitchSemitones?: number;
  /** Output-frame positions. Ramp the tempo ratio linearly back to 1. */
  readonly returnToOriginal?: {readonly afterFrames: number; readonly rampFrames: number};
}
export interface TimePitchMapping {
  readonly inputFrames: number;
  readonly outputFrames: number;
  readonly tempoRatio: number;
  readonly pitchSemitones: number;
  readonly returnToOriginal: {readonly afterFrames: number; readonly rampFrames: number} | null;
}
export interface PreparedTimePitch {
  readonly processor: typeof TIME_PITCH_PROCESSOR;
  readonly audio: {readonly sampleRate: number; readonly channels: readonly Float32Array[]};
  readonly mapping: TimePitchMapping;
  readonly metrics: {
    readonly inputPeak: number; readonly outputPeak: number; readonly gainApplied: number;
    readonly boundaryJump: number; readonly maxSampleJump: number; readonly edgeFadeFrames: number;
    readonly maxLocalOffsetFrames: number; readonly inputFrames: number; readonly outputFrames: number;
  };
}
const check = (condition: unknown, reason: string): void => { if (!condition) throw new Error(reason); };
const finite = (x: number): boolean => Number.isFinite(x);

/** Nominal input position for an output position, before rounding/clamping. */
function rawInputAt(output: number, ratio: number, back: TimePitchMapping['returnToOriginal']): number {
  if (!back || output <= back.afterFrames) return output * ratio;
  const t = output - back.afterFrames, ramp = back.rampFrames;
  if (t < ramp) return ratio * back.afterFrames + ratio * t + (1 - ratio) * t * t / (2 * ramp);
  return ratio * back.afterFrames + (ratio + 1) * ramp / 2 + t - ramp;
}

/** Inverse of the monotonic mapping; the stable quadratic form avoids cancellation. */
function rawOutputAt(input: number, ratio: number, back: TimePitchMapping['returnToOriginal']): number {
  if (!back || input <= ratio * back.afterFrames) return input / ratio;
  const remaining = input - ratio * back.afterFrames;
  const rampInput = (ratio + 1) * back.rampFrames / 2;
  if (remaining >= rampInput) return back.afterFrames + back.rampFrames + remaining - rampInput;
  const c = (1 - ratio) / (2 * back.rampFrames);
  const t = ratio === 1 ? remaining : 2 * remaining / (ratio + Math.sqrt(ratio * ratio + 4 * c * remaining));
  return back.afterFrames + t;
}

/** Nominal cue mapping is exact at endpoints. The +/-10 ms source search is not a universal transient-error bound. */
export function sourceFrameAtOutput(mapping: TimePitchMapping, outputFrame: number): number {
  check(finite(outputFrame), 'Output frame must be finite.');
  if (outputFrame <= 0) return 0;
  if (outputFrame >= mapping.outputFrames) return mapping.inputFrames;
  return Math.min(mapping.inputFrames, Math.max(0,
    Math.round(rawInputAt(outputFrame, mapping.tempoRatio, mapping.returnToOriginal))));
}
export function outputFrameAtSource(mapping: TimePitchMapping, inputFrame: number): number {
  check(finite(inputFrame), 'Source frame must be finite.');
  if (inputFrame <= 0) return 0;
  if (inputFrame >= mapping.inputFrames) return mapping.outputFrames;
  return Math.min(mapping.outputFrames, Math.max(0,
    Math.round(rawOutputAt(inputFrame, mapping.tempoRatio, mapping.returnToOriginal))));
}

function validatedMapping(audio: TimePitchPcm, options: TimePitchOptions): TimePitchMapping {
  check(Number.isInteger(audio.sampleRate) && audio.sampleRate >= 8000 && audio.sampleRate <= 192000,
    'Prepare supports integer sample rates from 8 to 192 kHz.');
  check(audio.channels.length === 1 || audio.channels.length === 2, 'Prepare supports mono or stereo PCM.');
  const length = audio.channels[0]?.length ?? 0;
  check(Number.isSafeInteger(length) && length >= 32 && audio.channels.every(c =>
    (c instanceof Float32Array || c instanceof Float64Array) && c.length === length),
  'Prepare needs equally sized Float32/Float64 channels with at least 32 frames.');
  check(length / audio.sampleRate <= TIME_PITCH_LIMITS.maxSeconds &&
    length * audio.channels.length <= TIME_PITCH_LIMITS.maxSamples, 'Prepare input exceeds the bounded PCM budget.');
  const ratio = options.tempoRatio, pitch = options.pitchSemitones ?? 0;
  check(finite(ratio) && ratio >= TIME_PITCH_LIMITS.minTempoRatio && ratio <= TIME_PITCH_LIMITS.maxTempoRatio,
    'Tempo ratio must be between 0.92 and 1.08 (engineering bounds).');
  check(finite(pitch) && Math.abs(pitch) <= TIME_PITCH_LIMITS.maxPitchSemitones,
    'Pitch shift must be within +/-2 semitones (engineering bounds).');
  const back = options.returnToOriginal ? {...options.returnToOriginal} : null;
  if (back) check(Number.isSafeInteger(back.afterFrames) && back.afterFrames >= 0 &&
    Number.isSafeInteger(back.rampFrames) && back.rampFrames >= Math.round(audio.sampleRate * 0.02) &&
    back.afterFrames * ratio < length && back.rampFrames <= length / TIME_PITCH_LIMITS.minTempoRatio &&
    rawInputAt(back.afterFrames + back.rampFrames, ratio, back) <= length,
  'Return-to-original needs output-frame timing, a ramp of at least 20 ms, and enough audio to finish.');
  const outputFrames = Math.max(1, Math.round(rawOutputAt(length, ratio, back)));
  check(outputFrames * audio.channels.length <= TIME_PITCH_LIMITS.maxSamples / TIME_PITCH_LIMITS.minTempoRatio,
    'Prepare output exceeds the bounded PCM budget.');
  return {inputFrames: length, outputFrames, tempoRatio: ratio, pitchSemitones: pitch, returnToOriginal: back};
}

/** Stereo-linked WSOLA: one position search uses channel-energy sums, never a cancelling downmix. */
function stretch(audio: TimePitchPcm, mapping: TimePitchMapping, pitchFactor: number) {
  const rate = audio.sampleRate, channels = audio.channels, length = mapping.inputFrames;
  const count = Math.ceil(mapping.outputFrames * pitchFactor);
  const hop = Math.max(16, Math.round(rate * 0.02)), windowSize = hop * 2;
  const search = Math.round(rate * 0.01), probeStep = Math.max(1, Math.floor(hop / 128));
  const output = channels.map(() => new Float64Array(count));
  const weights = new Float64Array(count), window = new Float64Array(windowSize);
  for (let i = 0; i < windowSize; i++) window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / windowSize);
  let previous = 0, maxOffset = 0;
  for (let at = 0; at < count; at += hop) {
    const nominal = Math.min(length - 1, Math.round(rawInputAt(at / pitchFactor,
      mapping.tempoRatio, mapping.returnToOriginal)));
    let selected = nominal;
    if (at > 0) {
      const low = Math.max(0, previous, nominal - search), high = Math.min(length - 1, nominal + search);
      let referenceEnergy = 0;
      for (const channel of channels) for (let j = 0; j < hop; j += probeStep) {
        const sample = channel[previous + hop + j] ?? 0;
        referenceEnergy += sample * sample;
      }
      if (referenceEnergy > 1e-16) {
        let best = -Infinity;
        const inspect = (candidate: number): void => {
          if (candidate < low || candidate > high) return;
          let dot = 0, energy = 0;
          for (const channel of channels) for (let j = 0; j < hop; j += probeStep) {
            const x = channel[candidate + j] ?? 0, ref = channel[previous + hop + j] ?? 0;
            dot += x * ref; energy += x * x;
          }
          const similarity = energy > 1e-16 ? dot / Math.sqrt(energy * referenceEnergy) : -1;
          const score = similarity - Math.abs(candidate - nominal) / Math.max(1, search) * 1e-6;
          if (score > best + 1e-12 || Math.abs(score - best) <= 1e-12 &&
            (Math.abs(candidate - nominal) < Math.abs(selected - nominal) ||
            Math.abs(candidate - nominal) === Math.abs(selected - nominal) && candidate < selected)) {
            best = score; selected = candidate;
          }
        };
        inspect(nominal);
        let step = Math.max(1, Math.round(rate * 0.0005));
        for (let candidate = low; candidate <= high; candidate += step) inspect(candidate);
        inspect(high);
        while (step > 1) {
          const radius = step, center = selected;
          step = Math.max(1, Math.floor(step / 4));
          for (let candidate = center - radius; candidate <= center + radius; candidate += step) inspect(candidate);
        }
      }
    }
    maxOffset = Math.max(maxOffset, Math.abs(selected - nominal));
    const end = Math.min(windowSize, count - at);
    for (let j = 0; j < end; j++) {
      const w = window[j]!;
      weights[at + j] = weights[at + j]! + w;
      for (let channel = 0; channel < channels.length; channel++) {
        output[channel]![at + j] = output[channel]![at + j]! + (channels[channel]![selected + j] ?? 0) * w;
      }
    }
    previous = selected;
  }
  for (const channel of output) for (let i = 0; i < count; i++) {
    channel[i] = weights[i]! > 1e-12 ? channel[i]! / weights[i]! : 0;
  }
  return {channels: output, maxOffset};
}

/** Windowed-sinc resampling is ONLY the pitch stage, after compensating time-stretch. */
function pitchResample(input: readonly Float64Array[], count: number, factor: number): Float32Array[] {
  if (factor === 1) return input.map(channel => Float32Array.from(channel.subarray(0, count)));
  const radius = 24, cutoff = 0.94 * Math.min(1, 1 / factor);
  const output = input.map(() => new Float32Array(count));
  const coefficients = new Float64Array(radius * 2);
  for (let frame = 0; frame < count; frame++) {
    const position = frame * factor, first = Math.floor(position) - radius + 1;
    let sum = 0;
    for (let k = 0; k < coefficients.length; k++) {
      const delta = first + k - position, x = Math.PI * cutoff * delta;
      const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x;
      const weight = Math.abs(delta) < radius ? 0.5 + 0.5 * Math.cos(Math.PI * delta / radius) : 0;
      coefficients[k] = cutoff * sinc * weight;
      sum += coefficients[k]!;
    }
    for (let channel = 0; channel < input.length; channel++) {
      let sample = 0;
      for (let k = 0; k < coefficients.length; k++) sample += (input[channel]![first + k] ?? 0) * coefficients[k]!;
      output[channel]![frame] = sum ? sample / sum : 0;
    }
  }
  return output;
}

/** Render a new PCM copy. The input is neither changed nor detached. */
export function renderTimePitch(audio: TimePitchPcm, options: TimePitchOptions): PreparedTimePitch {
  const mapping = validatedMapping(audio, options);
  let inputPeak = 0;
  for (const channel of audio.channels) for (const sample of channel) {
    check(finite(sample) && Math.abs(sample) <= 16, 'Prepare refuses non-finite PCM or magnitude above 16.');
    inputPeak = Math.max(inputPeak, Math.abs(sample));
  }
  const factor = 2 ** (mapping.pitchSemitones / 12);
  const unchanged = mapping.tempoRatio === 1 && factor === 1;
  const stretched = unchanged ? null : stretch(audio, mapping, factor);
  const channels = unchanged ? audio.channels.map(channel => Float32Array.from(channel))
    : pitchResample(stretched!.channels, mapping.outputFrames, factor);
  const edgeFadeFrames = Math.min(Math.round(audio.sampleRate * 0.005), Math.floor(mapping.outputFrames / 2));
  let peak = 0;
  for (const channel of channels) for (let i = 0; i < channel.length; i++) {
    const distance = Math.min(i, channel.length - 1 - i);
    if (distance < edgeFadeFrames) channel[i] = channel[i]! * (0.5 - 0.5 * Math.cos(Math.PI * distance / edgeFadeFrames));
    check(finite(channel[i]!), 'Prepare produced non-finite PCM.');
    peak = Math.max(peak, Math.abs(channel[i]!));
  }
  // A deterministic common-channel attenuation preserves balance; no compression/limiting is hidden.
  const gainApplied = peak > TIME_PITCH_LIMITS.peakCeiling ? TIME_PITCH_LIMITS.peakCeiling / peak : 1;
  let outputPeak = 0, maxSampleJump = 0, boundaryJump = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      if (gainApplied !== 1) channel[i] = channel[i]! * gainApplied;
      outputPeak = Math.max(outputPeak, Math.abs(channel[i]!));
      if (i) maxSampleJump = Math.max(maxSampleJump, Math.abs(channel[i]! - channel[i - 1]!));
    }
    boundaryJump = Math.max(boundaryJump, Math.abs(channel[0]!), Math.abs(channel[channel.length - 1]!));
  }
  return {processor: TIME_PITCH_PROCESSOR, audio: {sampleRate: audio.sampleRate, channels}, mapping,
    metrics: {inputPeak, outputPeak, gainApplied, boundaryJump, maxSampleJump, edgeFadeFrames,
      maxLocalOffsetFrames: stretched?.maxOffset ?? 0, inputFrames: mapping.inputFrames, outputFrames: mapping.outputFrames}};
}
