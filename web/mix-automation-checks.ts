import {bassSwapAutomation, sweepAutomation, type MixAutomation} from '../src/mix-automation.js';
import type {LoadedBrowserPack} from '../src/browser-pack.js';
import type {AudioAsset} from '../src/pack-types.js';
import {RecordedSource, requireAudio, WebAudioClock, type DecodedRecording} from '../src/web-audio.js';

type RecordCheck = (name: string, action: () => Promise<unknown>) => Promise<void>;
const tolerance = 0.000003;

/** In-memory tones only. The eligible fixture metadata supplies permission, never audio. */
function tones(context: BaseAudioContext, template: AudioAsset, id: string,
  seconds: number, frequencies: readonly number[]): DecodedRecording {
  const rate = context.sampleRate, frames = Math.round(seconds * rate);
  const buffer = context.createBuffer(1, frames, rate), data = buffer.getChannelData(0);
  for (let frame = 0; frame < frames; frame++) {
    data[frame] = frequencies.reduce((sum, frequency) => sum + 0.15 * Math.sin(2 * Math.PI * frequency * frame / rate), 0);
  }
  return {buffer, asset: {...template, id, file: {...template.file, channels: 1,
    sample_rate: rate, frames, bytes: 44 + frames * 2},
    timing: {...template.timing!, first_downbeat_frame: 0}}};
}

function amplitude(data: Float32Array, rate: number, hz: number, startSeconds: number, seconds: number): number {
  const start = Math.round(startSeconds * rate), count = Math.round(seconds * rate);
  let real = 0, imaginary = 0;
  for (let frame = 0; frame < count; frame++) {
    const angle = 2 * Math.PI * hz * frame / rate, sample = data[start + frame]!;
    real += sample * Math.cos(angle); imaginary += sample * Math.sin(angle);
  }
  return 2 * Math.hypot(real, imaginary) / count;
}

const lane = (frames: number, value: number) => [{frame: 0, value}, {frame: frames, value}];
function fadeEntrance(plan: MixAutomation, rate: number): MixAutomation {
  return {...plan, gain: [{frame: 0, value: 0}, {frame: Math.round(rate * 0.01), value: 1},
    {frame: plan.durationFrames, value: 1}]};
}

async function filterResponse(template: AudioAsset, rate: number): Promise<unknown> {
  const duration = Math.round(rate * 1.5), results = [];
  for (const kind of ['highpass', 'lowpass', 'lowshelf'] as const) {
    const context = new OfflineAudioContext(1, Math.round(rate * 2.5), rate);
    const clock = new WebAudioClock(context), recording = tones(context, template, 'mix-tone-response', 2, [50, 2000]);
    const plan: MixAutomation = fadeEntrance({durationFrames: duration, gain: lane(duration, 1),
      lowShelfDb: lane(duration, kind === 'lowshelf' ? -24 : 0),
      highPassHz: lane(duration, kind === 'highpass' ? 500 : 0),
      lowPassHz: lane(duration, kind === 'lowpass' ? 500 : rate / 2)}, rate);
    const source = new RecordedSource(context, recording, context.destination, {allowFixtures: true});
    await source.prepare(clock); source.scheduleMixStart(clock.stamp(Math.round(rate / 8)), 0, plan);
    const rendered = (await context.startRendering()).getChannelData(0);
    const lowRatio = amplitude(rendered, rate, 50, 0.5, 1) / 0.15;
    const highRatio = amplitude(rendered, rate, 2000, 0.5, 1) / 0.15;
    if (kind === 'highpass') requireAudio(lowRatio < 0.02 && highRatio > 0.98 && highRatio < 1.01,
      `HP response failed: ${lowRatio}/${highRatio}`);
    if (kind === 'lowpass') requireAudio(lowRatio > 0.98 && lowRatio < 1.01 && highRatio < 0.08,
      `LP response failed: ${lowRatio}/${highRatio}`);
    if (kind === 'lowshelf') requireAudio(lowRatio < 0.08 && highRatio > 0.95 && highRatio < 1.01,
      `Shelf response failed: ${lowRatio}/${highRatio}`);
    requireAudio(rendered.every(Number.isFinite), 'Filter response contains nonfinite samples.');
    results.push({kind, low50HzRatio: lowRatio, high2000HzRatio: highRatio});
    source.release();
  }
  return {sampleRate: rate, inputToneAmplitude: 0.15, measuredSteadyStateSeconds: [0.5, 1.5], results,
    output: 'Native OfflineAudioContext; no physical output'};
}

interface SwapResult { output: Float32Array; beforeError: number; entryError: number; peak: number; }
async function renderSwap(template: AudioAsset, rate: number): Promise<SwapResult> {
  const context = new OfflineAudioContext(1, Math.round(rate * 5.5), rate), clock = new WebAudioClock(context);
  const a = tones(context, template, 'mix-tone-a', 4, [50, 1000]);
  const b = tones(context, template, 'mix-tone-b', 4, [80, 2000]);
  const from = new RecordedSource(context, a, context.destination, {allowFixtures: true});
  const to = new RecordedSource(context, b, context.destination, {allowFixtures: true});
  await Promise.all([from.prepare(clock), to.prepare(clock)]);
  const start = Math.round(rate / 4), at = start + rate, offset = Math.round(rate / 8);
  const automation = bassSwapAutomation(rate, rate);
  from.scheduleStart({at: clock.stamp(start), entryCueId: 'entry'});
  to.scheduleMixStart(clock.stamp(at), offset, automation.incoming);
  from.transitionMixOut(clock.stamp(at), rate, automation.outgoing);
  const output = new Float32Array((await context.startRendering()).getChannelData(0));
  const input = a.buffer.getChannelData(0);
  let beforeError = 0, peak = 0;
  for (let frame = 0; frame < output.length; frame++) {
    requireAudio(Number.isFinite(output[frame]), 'Bass swap produced a nonfinite sample.');
    peak = Math.max(peak, Math.abs(output[frame]!));
    if (frame < at) beforeError = Math.max(beforeError,
      Math.abs(output[frame]! - (frame >= start ? input[frame - start]! : 0)));
  }
  const entryError = Math.abs(output[at]! - input[rate]!);
  requireAudio(beforeError < tolerance && entryError < tolerance,
    `Opt-in graph changed A before/at the neutral boundary: ${beforeError}/${entryError}`);
  requireAudio(peak > 0.1 && peak < 1, 'Bass swap output is silent or clipped.');
  requireAudio(from.endFrame === at + rate && to.endFrame === at + b.buffer.length - offset,
    'Mix sources did not retain exact entry/end frames.');
  requireAudio(output.subarray(to.endFrame).every(sample => sample === 0),
    'Native filter tail outlived prepared B EOF.');
  from.release(); to.release();
  return {output, beforeError, entryError, peak};
}

async function replayAndSweeps(template: AudioAsset, rate: number): Promise<unknown> {
  const first = await renderSwap(template, rate), replay = await renderSwap(template, rate);
  const left = new Uint32Array(first.output.buffer), right = new Uint32Array(replay.output.buffer);
  let differingBits = 0;
  for (let frame = 0; frame < left.length; frame++) if (left[frame] !== right[frame]) differingBits++;
  requireAudio(differingBits === 0, `Repeated native swap differs in ${differingBits} sample bit patterns.`);
  const sweeps = [];
  for (const kind of ['highpass', 'lowpass'] as const) {
    const context = new OfflineAudioContext(1, rate * 3, rate), clock = new WebAudioClock(context);
    const recording = tones(context, template, 'mix-sweep', 2.5, [50, 2000]);
    const source = new RecordedSource(context, recording, context.destination, {allowFixtures: true});
    const plan = fadeEntrance(sweepAutomation(rate * 2, rate, kind, 'open'), rate);
    await source.prepare(clock); source.scheduleMixStart(clock.stamp(Math.round(rate / 8)), 0, plan);
    const output = (await context.startRendering()).getChannelData(0);
    let peak = 0;
    for (const sample of output) { requireAudio(Number.isFinite(sample), 'Sweep became nonfinite.'); peak = Math.max(peak, Math.abs(sample)); }
    requireAudio(peak > 0.1 && peak < 1, 'Sweep is silent or clipped.');
    sweeps.push({kind, peak}); source.release();
  }
  return {sampleRate: rate, comparedSampleBitPatterns: left.length, differingSampleBitPatterns: differingBits,
    beforeBoundaryMaxError: first.beforeError, entryBoundaryError: first.entryError,
    summedSwapPeak: first.peak, sweeps, tolerance, output: 'Native OfflineAudioContext; no physical output'};
}

async function cancelMix(template: AudioAsset, rate: number): Promise<unknown> {
  const context = new OfflineAudioContext(1, Math.round(rate * 4.5), rate), clock = new WebAudioClock(context);
  const recording = tones(context, template, 'mix-cancel', 4, [50, 2000]);
  const source = new RecordedSource(context, recording, context.destination, {allowFixtures: true});
  await source.prepare(clock);
  const start = Math.round(rate / 4), at = start + Math.round(rate * 1.5);
  source.scheduleStart({at: clock.stamp(start), entryCueId: 'entry'});
  const originalEnd = source.endFrame;
  source.transitionMixOut(clock.stamp(at), Math.round(rate * 1.5), bassSwapAutomation(rate, rate).outgoing);
  const suspended = context.suspend(1), rendering = context.startRendering();
  await suspended; const cancelledAtFrame = clock.currentFrame;
  requireAudio(source.cancelTransition() && source.endFrame === originalEnd, 'Cancellation did not restore A.');
  await context.resume();
  const output = (await rendering).getChannelData(0), input = recording.buffer.getChannelData(0);
  const outputBits = new Uint32Array(output.buffer, output.byteOffset, output.length);
  const inputBits = new Uint32Array(input.buffer, input.byteOffset, input.length);
  let maxError = 0, differentSamples = 0;
  for (let frame = 0; frame < output.length; frame++) {
    const expected = frame >= start && frame < originalEnd ? input[frame - start]! : 0;
    const expectedBits = frame >= start && frame < originalEnd ? inputBits[frame - start]! : 0;
    if (outputBits[frame] !== expectedBits) differentSamples++;
    maxError = Math.max(maxError, Math.abs(output[frame]! - expected));
  }
  requireAudio(differentSamples === 0, `Cancellation changed ${differentSamples} A samples; max error ${maxError}.`);
  source.release();
  return {sampleRate: rate, cancelledAtFrame, plannedEntryFrame: at, restoredEndFrame: originalEnd,
    comparedSamples: output.length, differentSamples, maxError,
    output: 'Native OfflineAudioContext; exact original A samples after cancelled filter automation'};
}

/** New groups only; existing authored-route/native checks are unchanged. */
export async function runMixAutomationChecks(loaded: LoadedBrowserPack, record: RecordCheck): Promise<void> {
  const template = loaded.pack.assets.find(asset => asset.source_kind === 'recording')!;
  for (const rate of [48000, 44100]) {
    await record(`DJ mix native HP/LP/shelf response at ${rate} Hz`, () => filterResponse(template, rate));
    await record(`DJ mix native bass swap, sweeps and exact replay at ${rate} Hz`, () => replayAndSweeps(template, rate));
    await record(`DJ mix cancellation restores exact A at ${rate} Hz`, () => cancelMix(template, rate));
  }
}
