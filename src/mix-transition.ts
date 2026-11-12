import {analyzeMixPairInWorker, prepareTimePitch} from './mix-prepare.js';
import type {MixAnalysis, MixPcm} from './mix-analysis.js';
import {planAutomaticMix, type AutomaticMixPlan, type MixPlannerOptions} from './mix-planner.js';
import {outputFrameAtSource, type PreparedTimePitch, type TimePitchOptions} from './time-pitch.js';
import type {DecodedRecording} from './web-audio.js';

export interface MixPreparationRuntime {
  analyze(from: MixPcm, to: MixPcm, signal?: AbortSignal): Promise<{from: MixAnalysis; to: MixAnalysis}>;
  render(audio: MixPcm, options: TimePitchOptions, signal?: AbortSignal): Promise<PreparedTimePitch>;
}
export const browserMixPreparation: MixPreparationRuntime = {
  analyze: analyzeMixPairInWorker,
  render: prepareTimePitch,
};
export interface ReadyMixTransition {
  readonly kind: 'ready'; readonly plan: AutomaticMixPlan;
  readonly incoming: DecodedRecording; readonly entryFrame: number;
  readonly processed: PreparedTimePitch;
}
export type PreparedMixDecision = ReadyMixTransition | {readonly kind: 'fallback'; readonly reason: string};

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Mix preparation cancelled.');
}
function pcm(recording: DecodedRecording): MixPcm {
  return {sampleRate: recording.buffer.sampleRate,
    channels: Array.from({length: recording.buffer.numberOfChannels}, (_, i) => recording.buffer.getChannelData(i))};
}

/**
 * Preparation only: the browser's heavy analysis and rendering run in disposable workers.
 * This function never starts a source or changes the owner clock. A ready result binds the
 * original asset identity to a separate processed buffer; no manifest cue is rewritten.
 */
export async function prepareMixTransition(context: BaseAudioContext, from: DecodedRecording,
  to: DecodedRecording, options: MixPlannerOptions = {}, signal?: AbortSignal,
  runtime: MixPreparationRuntime = browserMixPreparation): Promise<PreparedMixDecision> {
  checkAbort(signal);
  const a = pcm(from), b = pcm(to);
  const analysis = await runtime.analyze(a, b, signal);
  checkAbort(signal);
  if (analysis.from.frames !== from.buffer.length || analysis.to.frames !== to.buffer.length ||
    analysis.from.sampleRate !== context.sampleRate || analysis.to.sampleRate !== context.sampleRate) {
    throw new Error('Analysis does not match the prepared recording frames/sample rate.');
  }
  const plan = planAutomaticMix(analysis.from, analysis.to, options);
  if (plan.kind === 'fallback') return plan;
  const returnToOriginal = plan.returnToOriginalTempo ? {
    afterFrames: Math.round(plan.toEntryFrame / plan.tempoRatio) + plan.overlapFrames,
    rampFrames: Math.round(4 * 60 * plan.sampleRate / plan.fromBpm),
  } : undefined;
  const renderOptions: TimePitchOptions = {tempoRatio: plan.tempoRatio, pitchSemitones: plan.pitchSemitones,
    ...(returnToOriginal ? {returnToOriginal} : {})};
  const processed = await runtime.render(b, renderOptions, signal);
  checkAbort(signal);
  if (processed.processor !== 'eutonos-wsola@1' || processed.audio.sampleRate !== context.sampleRate ||
    processed.audio.channels.length !== to.buffer.numberOfChannels ||
    processed.mapping.inputFrames !== to.buffer.length ||
    !Number.isSafeInteger(processed.mapping.outputFrames) || processed.mapping.outputFrames < 1 ||
    processed.audio.channels.some(c => !(c instanceof Float32Array) || c.length !== processed.mapping.outputFrames)) {
    throw new Error('Prepared mix audio does not match the source or processor contract.');
  }
  const actualReturn = processed.mapping.returnToOriginal;
  if (processed.mapping.tempoRatio !== renderOptions.tempoRatio ||
      processed.mapping.pitchSemitones !== renderOptions.pitchSemitones ||
      (returnToOriginal ? !actualReturn || actualReturn.afterFrames !== returnToOriginal.afterFrames ||
        actualReturn.rampFrames !== returnToOriginal.rampFrames : actualReturn !== null)) {
    throw new Error('Prepared mix transformation does not match the selected plan.');
  }
  const ratio = plan.tempoRatio;
  const expectedFrames = returnToOriginal
    ? Math.round(returnToOriginal.afterFrames + returnToOriginal.rampFrames +
      (to.buffer.length - ratio * returnToOriginal.afterFrames) - (ratio + 1) * returnToOriginal.rampFrames / 2)
    : Math.round(to.buffer.length / ratio);
  if (processed.mapping.outputFrames !== expectedFrames) {
    throw new Error('Prepared mix length does not match the selected time map.');
  }
  // Independent boundary validation before allocating native playback nodes.
  for (const channel of processed.audio.channels) for (const value of channel) {
    if (!Number.isFinite(value) || Math.abs(value) > 0.891251) throw new Error('Prepared mix audio failed peak/finite validation.');
  }
  const entryFrame = outputFrameAtSource(processed.mapping, plan.toEntryFrame);
  if (!Number.isSafeInteger(entryFrame) || entryFrame < 0 ||
      entryFrame + plan.overlapFrames > processed.mapping.outputFrames) {
    throw new Error('Processed entry/overlap exceeds the prepared audio.');
  }
  const buffer = context.createBuffer(processed.audio.channels.length, processed.mapping.outputFrames, context.sampleRate);
  processed.audio.channels.forEach((channel, i) => buffer.copyToChannel(new Float32Array(channel), i));
  checkAbort(signal);
  return {kind: 'ready', plan, entryFrame, processed,
    incoming: {asset: to.asset, buffer, processed: {sourceFrames: to.buffer.length,
      outputFrames: buffer.length, algorithm: processed.processor}}};
}
