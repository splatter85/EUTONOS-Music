/** Synthetic-only qualification of the opt-in mix. Never writes or imports owner audio. */
import {sha256, validatePackFiles} from '../src/audio.js';
import type {LoadedBrowserPack} from '../src/browser-pack.js';
import {DeterministicDj} from '../src/dj.js';
import {analyzeMixAudio, type MixPcm} from '../src/mix-analysis.js';
import {analyzeMixPairInWorker, prepareTimePitch} from '../src/mix-prepare.js';
import {prepareMixTransition, type MixPreparationRuntime} from '../src/mix-transition.js';
import {validatePackManifest} from '../src/pack.js';
import type {AudioAsset} from '../src/pack-types.js';
import {SmallPlayer} from '../src/player.js';
import {renderTimePitch, type TimePitchOptions} from '../src/time-pitch.js';
import {RecordedSource, requireAudio, WebAudioClock, type DecodedRecording} from '../src/web-audio.js';
import {makeMixFixture} from '../tests/helpers/mix-fixtures.js';
import {runMixAutomationChecks} from './mix-automation-checks.js';

export interface MixCheckResult {readonly name: string; readonly status: 'PASS' | 'FAIL'; readonly evidence: unknown;}
type RecordCheck = (name: string, action: () => Promise<unknown>) => Promise<void>;

function differingBits(first: Float32Array, second: Float32Array): number {
  requireAudio(first.length === second.length, 'Repeated render lengths differ.');
  const a = new Uint32Array(first.buffer, first.byteOffset, first.length);
  const b = new Uint32Array(second.buffer, second.byteOffset, second.length);
  let count = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) count++;
  return count;
}
function assertInputPreserved(audio: MixPcm, before: readonly Float32Array[]): void {
  requireAudio(audio.channels.every((channel, i) => channel instanceof Float32Array &&
    channel.length === before[i]!.length && differingBits(channel, before[i]!) === 0),
  'Worker detached or changed caller-owned input PCM.');
}
async function mustReject(action: Promise<unknown>, message: RegExp): Promise<void> {
  let error: unknown;
  try { await action; } catch (caught) { error = caught; }
  requireAudio(error && message.test(String(error)), `Expected refusal matching ${message}; received ${String(error)}`);
}

async function workerContract(): Promise<unknown> {
  const audio = makeMixFixture({sampleRate: 16000, bpm: 124, bars: 4, stereo: 'antiphase'});
  const before = audio.channels.map(channel => new Float32Array(channel));
  const options: TimePitchOptions = {tempoRatio: 120 / 124, pitchSemitones: 1,
    returnToOriginal: {afterFrames: 48000, rampFrames: 16000}};
  const plain = renderTimePitch(audio, options), worker = await prepareTimePitch(audio, options);
  requireAudio(JSON.stringify(plain.mapping) === JSON.stringify(worker.mapping) &&
    JSON.stringify(plain.metrics) === JSON.stringify(worker.metrics), 'Worker/plain preparation metadata differs.');
  let differences = 0;
  plain.audio.channels.forEach((channel, i) => { differences += differingBits(channel, worker.audio.channels[i]!); });
  requireAudio(differences === 0, 'Worker/plain preparation sample bits differ.');
  assertInputPreserved(audio, before);
  const pair = await analyzeMixPairInWorker(audio, audio);
  const analysis = analyzeMixAudio(audio);
  requireAudio(JSON.stringify(pair.from) === JSON.stringify(analysis) &&
    JSON.stringify(pair.to) === JSON.stringify(analysis), 'Worker/plain analysis differs.');
  const already = new AbortController(); already.abort();
  await mustReject(prepareTimePitch(audio, options, already.signal), /cancelled/i);
  const active = new AbortController(), pending = prepareTimePitch(audio, options, active.signal);
  active.abort(); await mustReject(pending, /cancelled/i);
  const analyzing = new AbortController(), pendingAnalysis = analyzeMixPairInWorker(audio, audio, analyzing.signal);
  analyzing.abort(); await mustReject(pendingAnalysis, /cancelled/i);
  assertInputPreserved(audio, before);
  return {sampleRate: audio.sampleRate, channels: audio.channels.length, processor: worker.processor,
    comparedSampleBitPatterns: worker.mapping.outputFrames * worker.audio.channels.length,
    differingSampleBitPatterns: differences, inputPreserved: true, preAbortedRefused: true,
    activeRenderAborted: true, activeAnalysisAborted: true, analysisExactlyEqual: true,
    mapping: worker.mapping, metrics: worker.metrics};
}

/** Canonical PCM16 WAV generated wholly in memory, for actual browser decoding/hash validation. */
function wav(audio: MixPcm): Uint8Array {
  const frames = audio.channels[0]!.length, channels = audio.channels.length, bytes = new Uint8Array(44 + frames * channels * 2);
  const data = new DataView(bytes.buffer), tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };
  tag(0, 'RIFF'); data.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, channels, true);
  data.setUint32(24, audio.sampleRate, true); data.setUint32(28, audio.sampleRate * channels * 2, true);
  data.setUint16(32, channels * 2, true); data.setUint16(34, 16, true); tag(36, 'data');
  data.setUint32(40, bytes.length - 44, true);
  for (let frame = 0; frame < frames; frame++) for (let channel = 0; channel < channels; channel++) {
    data.setInt16(44 + (frame * channels + channel) * 2,
      Math.max(-32768, Math.min(32767, Math.round(audio.channels[channel]![frame]! * 32768))), true);
  }
  return bytes;
}

async function nativeRecording(context: BaseAudioContext, template: AudioAsset, pcm: MixPcm,
  id: string, bpm: number, key: string): Promise<DecodedRecording> {
  const bytes = wav(pcm), buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
  return {buffer, asset: {...template, id, title: id, key, harmony_pitch_classes: null,
    file: {...template.file, path: `audio/${id}.wav`, sample_rate: pcm.sampleRate,
      channels: pcm.channels.length as 1 | 2, frames: pcm.channels[0]!.length,
      bytes: bytes.length, sha256: await sha256(bytes)},
    timing: {...template.timing!, bpm, bars: 8, phrase_bars: 4, first_downbeat_frame: 0}}};
}

interface PreparedCase {readonly aBpm: number; readonly bBpm: number; readonly aTonic: number;
  readonly bTonic: number; readonly mode: 'major' | 'minor'; readonly shift: number; readonly returnTempo: boolean;
  readonly strongerAccents: boolean;}
const preparedCases: readonly PreparedCase[] = [
  {aBpm: 120, bBpm: 118, aTonic: 9, bTonic: 9, mode: 'minor', shift: 0, returnTempo: false, strongerAccents: false},
  {aBpm: 118, bBpm: 124, aTonic: 0, bTonic: 2, mode: 'major', shift: -2, returnTempo: true, strongerAccents: true},
];

function preparedFixture(rate: number, bpm: number, tonic: number, spec: PreparedCase): MixPcm {
  const options = {sampleRate: rate, bpm, tonic, mode: spec.mode};
  if (!spec.strongerAccents) return makeMixFixture(options);
  // Known stronger-accent positive fixture. The original major-key balance is
  // retained below as a real low-confidence fallback case, not forced through.
  const drums = makeMixFixture({...options, chords: false});
  const chords = makeMixFixture({...options, drums: false});
  return {sampleRate: rate, channels: [Float32Array.from(drums.channels[0]!,
    (sample, i) => 1.5 * sample + 0.65 * chords.channels[0]![i]!)]};
}

async function renderPrepared(template: AudioAsset, rate: number, spec: PreparedCase) {
  const context = new OfflineAudioContext(1, rate * 34, rate), clock = new WebAudioClock(context);
  const a = await nativeRecording(context, template,
    preparedFixture(rate, spec.aBpm, spec.aTonic, spec),
    'mix-prepared-a', spec.aBpm, `${spec.aTonic} ${spec.mode}`);
  const b = await nativeRecording(context, template,
    preparedFixture(rate, spec.bBpm, spec.bTonic, spec),
    'mix-prepared-b', spec.bBpm, `${spec.bTonic} ${spec.mode}`);
  const prepared = await prepareMixTransition(context, a, b, {minimumFromFrame: rate * 4,
    allowPitchShift: spec.shift !== 0, returnToOriginalTempo: spec.returnTempo});
  requireAudio(prepared.kind === 'ready', prepared.kind === 'fallback' ? prepared.reason : 'Mix was not ready.');
  requireAudio(Math.abs(prepared.plan.fromBpm - spec.aBpm) <= 0.25 &&
    Math.abs(prepared.plan.toBpm - spec.bBpm) <= 0.25, 'Prepared plan lost known synthetic BPMs.');
  requireAudio(prepared.plan.pitchSemitones === spec.shift &&
    (prepared.processed.mapping.returnToOriginal !== null) === spec.returnTempo,
  'Prepared plan did not apply the selected independent pitch/tempo-return policy.');
  const from = new RecordedSource(context, a, context.destination, {allowFixtures: true});
  const to = new RecordedSource(context, prepared.incoming, context.destination, {allowFixtures: true});
  await Promise.all([from.prepare(clock), to.prepare(clock)]);
  const startFrame = Math.round(rate / 8), at = clock.stamp(startFrame + prepared.plan.fromExitFrame);
  from.scheduleStart({at: clock.stamp(startFrame), entryCueId: 'entry'});
  to.scheduleMixStart(at, prepared.entryFrame, prepared.plan.automation.incoming);
  from.transitionMixOut(at, prepared.plan.fromExitFrame, prepared.plan.automation.outgoing);
  const fromEndFrame = from.endFrame, toEndFrame = to.endFrame;
  requireAudio(fromEndFrame === at.frame + prepared.plan.overlapFrames &&
    toEndFrame === at.frame + prepared.incoming.buffer.length - prepared.entryFrame,
  'Prepared sources do not agree with exact plan timing.');
  const output = new Float32Array((await context.startRendering()).getChannelData(0));
  let peak = 0, beforeError = 0;
  for (let frame = 0; frame < output.length; frame++) {
    requireAudio(Number.isFinite(output[frame]), 'Prepared native transition contains nonfinite audio.');
    peak = Math.max(peak, Math.abs(output[frame]!));
    if (frame < at.frame) beforeError = Math.max(beforeError,
      Math.abs(output[frame]! - (frame >= startFrame ? a.buffer.getChannelData(0)[frame - startFrame]! : 0)));
  }
  requireAudio(peak > 0.01 && peak < 1 && beforeError < 0.000003, 'Prepared transition headroom or unaltered A check failed.');
  requireAudio(output.subarray(toEndFrame).every(value => value === 0), 'Audio outlived prepared B EOF.');
  from.release(); to.release();
  return {output, evidence: {sampleRate: rate, groundTruth: spec, detectedBpm: {a: prepared.plan.fromBpm, b: prepared.plan.toBpm},
    harmonic: prepared.plan.harmonic, tempoRatio: prepared.plan.tempoRatio, pitchSemitones: prepared.plan.pitchSemitones,
    confidence: prepared.plan.confidence, processor: prepared.processed.processor,
    startFrame, mixEntryFrame: at.frame, fromEndFrame, toEndFrame, incomingEntryFrame: prepared.entryFrame,
    peak, beforeBoundaryMaxError: beforeError, preparedMetrics: prepared.processed.metrics,
    mapping: prepared.processed.mapping}, plan: prepared.plan};
}

async function pairedPrepared(template: AudioAsset, rate: number, spec: PreparedCase): Promise<unknown> {
  let conservativeFallback: unknown = null;
  if (spec.strongerAccents) {
    const context = new OfflineAudioContext(1, 1, rate);
    const a = await nativeRecording(context, template,
      makeMixFixture({sampleRate: rate, bpm: spec.aBpm, tonic: spec.aTonic, mode: spec.mode}),
      'mix-weak-a', spec.aBpm, 'C major');
    const b = await nativeRecording(context, template,
      makeMixFixture({sampleRate: rate, bpm: spec.bBpm, tonic: spec.bTonic, mode: spec.mode}),
      'mix-weak-b', spec.bBpm, 'D major');
    let observed: unknown;
    const decision = await prepareMixTransition(context, a, b, {allowPitchShift: true}, undefined, {
      analyze: async (from, to, signal) => {
        const result = await analyzeMixPairInWorker(from, to, signal);
        observed = {fromBpm: result.from.tempo.bpm, toBpm: result.to.tempo.bpm,
          fromKey: result.from.key.name, toKey: result.to.key.name,
          fromPhraseConfidence: result.from.structure.phraseConfidence,
          toPhraseConfidence: result.to.structure.phraseConfidence};
        return result;
      },
      render: async () => { throw new Error('Low-confidence major-key fixture must fall back before rendering.'); },
    });
    requireAudio(decision.kind === 'fallback' && /confidence/i.test(decision.reason),
      'Original weak-accent major-key fixture did not conservatively fall back.');
    conservativeFallback = {decision, observed};
  }
  const a = await renderPrepared(template, rate, spec), b = await renderPrepared(template, rate, spec);
  requireAudio(JSON.stringify(a.plan) === JSON.stringify(b.plan), 'Same PCM changed the automatic mix plan.');
  const differences = differingBits(a.output, b.output);
  requireAudio(differences === 0, `Prepared native replay changed ${differences} sample bit patterns.`);
  return {...a.evidence, conservativeFallback, comparedSampleBitPatterns: a.output.length, differingSampleBitPatterns: differences};
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return {promise, release};
}
async function deadline<T>(promise: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Test deadline exceeded: ${description}`)), 30000);
    })]);
  } finally { clearTimeout(timer); }
}
async function waitUntil(predicate: () => boolean, description: string): Promise<void> {
  const end = performance.now() + 30000;
  while (performance.now() < end) {
    if (predicate()) return;
    await new Promise<void>(resolve => { setTimeout(resolve, 25); });
  }
  throw new Error(`Test deadline exceeded: ${description}`);
}

/** Repeated original one-bar triad: truthfully constant 120 BPM/A-minor harmony for v0 routes. */
async function generatedPack(template: LoadedBrowserPack): Promise<LoadedBrowserPack> {
  const rate = 24000, bar = makeMixFixture({sampleRate: rate, bars: 1}), mono = bar.channels[0]!;
  const files = new Map<string, Uint8Array>(), assets: AudioAsset[] = [];
  for (const [index, id] of ['mix-browser-a', 'mix-browser-b'].entries()) {
    const channel = new Float32Array(mono.length * 8);
    for (let i = 0; i < channel.length; i++) channel[i] = mono[i % mono.length]! * (index ? 0.8 : 1);
    const bytes = wav({sampleRate: rate, channels: [channel]}), path = `audio/${id}.wav`;
    files.set(path, bytes);
    assets.push({...template.pack.assets.find(a => a.source_kind === 'recording')!, id, title: id,
      file: {path, sha256: await sha256(bytes), bytes: bytes.length, format: 'pcm16-wav',
        sample_rate: rate, channels: 1, frames: channel.length}, key: 'A minor', harmony_pitch_classes: [0, 4, 9],
      timing: {bpm: 120, meter: [4, 4], bars: 8, phrase_bars: 4, first_downbeat_frame: 0},
      cues: [{id: 'entry', kind: 'entry', position_quarters: 0}, {id: 'exit', kind: 'exit', position_quarters: 16},
        {id: 'end', kind: 'exit', position_quarters: 32}]});
  }
  const pack = validatePackManifest({schema_version: 'em.audio-pack.v0', id: 'mix-browser-pack', revision: 1,
    assets, palettes: [], recipes: [], routes: [{id: 'mix-browser-a-to-b', revision: 1,
      from: {id: assets[0]!.id, revision: assets[0]!.revision}, to: {id: assets[1]!.id, revision: assets[1]!.revision},
      exit_cue: 'exit', entry_cue: 'entry', overlap_quarters: 8, review: 'fixture-only'}]});
  await validatePackFiles(pack, async path => files.get(path)!);
  return {pack, files, allowFixtures: true};
}

/** Native player/worker path with a bounded test gate between analysis and rendering. */
async function liveDj(template: LoadedBrowserPack): Promise<unknown> {
  const loaded = await generatedPack(template), context = new AudioContext({sampleRate: 48000});
  let renderingGate = gate(), enteredRender = gate(), renderCalls = 0;
  const runtime: MixPreparationRuntime = {analyze: analyzeMixPairInWorker,
    render: async (audio, options, signal) => {
      renderCalls++; enteredRender.release(); await renderingGate.promise;
      return prepareTimePitch(audio, options, signal);
    }};
  const player = new SmallPlayer(context, loaded, loaded.pack.routes[0]!.id, runtime);
  const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix'});
  let serial = 0, pending: Promise<unknown> | null = null;
  let lifecycle: Record<string, unknown>;
  const base = () => ({schemaVersion: 'em.control.v0' as const, source: 'manual' as const,
    commandId: `mix-browser-${++serial}`, expectedRevision: dj.snapshot().control.revision});
  try {
    await dj.request({...base(), type: 'transport', action: 'play'});
    const naturalEnd = player.snapshot().voices[0]!.endFrame;
    pending = dj.request({...base(), type: 'queueTrack', trackId: loaded.pack.assets[1]!.id});
    void pending.catch(() => undefined);
    await deadline(enteredRender.promise, 'enter first native render');
    const preparing = dj.snapshot();
    requireAudio(preparing.player.mix?.phase === 'preparing' && preparing.player.voices.length === 1 &&
      preparing.player.transition === 'none' && preparing.control.planned?.source.id !== loaded.pack.assets[1]!.id &&
      preparing.control.audible?.source?.id !== loaded.pack.assets[1]!.id,
    'B was offered/prepared/audible before its processed audio was ready.');
    renderingGate.release(); await deadline(pending, 'commit prepared native mix'); pending = null;
    const scheduled = dj.snapshot();
    requireAudio(scheduled.player.mix?.phase === 'scheduled' && scheduled.player.mix.summary?.processor === 'eutonos-wsola@1' &&
      scheduled.player.voices.length === 2 && scheduled.control.planned?.source.id === loaded.pack.assets[1]!.id &&
      scheduled.control.audible?.source?.id !== loaded.pack.assets[1]!.id &&
      scheduled.control.queue.length === 1, 'Ready native mix failed to retain separate prepared/FIFO state.');
    await dj.request({...base(), type: 'cancelNext'});
    const cancelled = dj.snapshot();
    requireAudio(cancelled.player.voices.length === 1 && cancelled.player.voices[0]!.endFrame === naturalEnd &&
      cancelled.player.transition === 'none' && cancelled.player.mix === null && cancelled.control.queue.length === 1,
    'Pre-boundary cancel failed to restore A/retain the unstarted queue head.');
    renderingGate = gate(); enteredRender = gate();
    pending = dj.request({...base(), type: 'nextSong'}); void pending.catch(() => undefined);
    await deadline(enteredRender.promise, 'enter second native render');
    await dj.request({...base(), type: 'transport', action: 'stop'});
    renderingGate.release(); await deadline(pending, 'settle stopped preparation'); pending = null;
    const stopped = dj.snapshot();
    requireAudio(stopped.player.state === 'idle' && stopped.player.voices.length === 0 && stopped.player.mix === null &&
      stopped.control.queue.length === 1, 'Late preparation resurrected audio or consumed an unstarted queue entry.');
    await validatePackFiles(loaded.pack, async path => loaded.files.get(path)!);
    lifecycle = {sampleRate: context.sampleRate, defaultVolume: scheduled.player.volume, renderCalls,
      onePlaybackOwner: true, preparingHadOnlyA: true, preparedWasNotAudible: true,
      cancelledBeforeEntry: true, restoredAEndFrame: naturalEnd, stopInvalidatedPreparation: true,
      queuePreserved: true, inputWavHashesPreserved: true, scheduledSummary: scheduled.player.mix.summary,
      testSeam: 'Promise gate delays render start; analysis/render use actual browser Workers',
      output: 'Headless native AudioContext; physical output and listening NOT TESTED'};
  } finally {
    renderingGate.release(); await dj.dispose(); await pending?.catch(() => undefined);
  }
  return {...lifecycle, audibleHandoff: await liveAudibleHandoff(loaded)};
}

/** Observe the native owner clock crossing entry and completion without changing its time. */
async function liveAudibleHandoff(loaded: LoadedBrowserPack): Promise<unknown> {
  const context = new AudioContext({sampleRate: 48000});
  const player = new SmallPlayer(context, loaded, loaded.pack.routes[0]!.id);
  const dj = new DeterministicDj(player, loaded, 'explore', {handoff: 'mix'});
  const aId = loaded.pack.assets[0]!.id, bId = loaded.pack.assets[1]!.id;
  let serial = 0;
  const base = () => ({schemaVersion: 'em.control.v0' as const, source: 'manual' as const,
    commandId: `mix-audible-${++serial}`, expectedRevision: dj.snapshot().control.revision});
  try {
    await dj.request({...base(), type: 'transport', action: 'play'});
    await dj.request({...base(), type: 'queueTrack', trackId: bId});
    const scheduled = dj.snapshot(), entry = scheduled.player.transitionAt, end = scheduled.player.transitionEnd;
    requireAudio(entry && end && scheduled.player.mix?.phase === 'scheduled' &&
      scheduled.player.currentFrame < entry.frame && scheduled.control.queue.length === 1 &&
      scheduled.control.planned?.source.id === bId && scheduled.control.audible?.source?.id !== bId,
    'Actual worker preparation failed to schedule a distinct future audible handoff.');
    requireAudio(scheduled.player.voices.every(voice => voice.start.engineGeneration === entry.engineGeneration),
      'Prepared sources do not share the owner audio-clock generation.');
    await waitUntil(() => dj.snapshot().player.mix?.phase === 'mixing', 'native clock reaching mix entry');
    const entered = dj.snapshot();
    requireAudio(entered.player.currentFrame >= entry.frame && entered.control.queue.length === 0 &&
      entered.control.audible?.source?.id === bId && entered.player.now.includes(aId) && entered.player.now.includes(bId),
    'Native mix entry failed to report B audible and consume exactly the reserved FIFO head.');
    await dj.request({...base(), type: 'cancelNext'});
    const refused = dj.snapshot();
    requireAudio(refused.player.transitionAt?.frame === entry.frame && refused.player.mix?.phase === 'mixing' &&
      refused.player.voices.length === 2 && refused.control.queue.length === 0,
    'Cancellation after mix entry altered the committed native transition.');
    await waitUntil(() => dj.snapshot().player.mix?.phase === 'complete', 'native clock reaching mix completion');
    const completed = dj.snapshot();
    requireAudio(completed.player.currentFrame >= end.frame && completed.player.now.length === 1 &&
      completed.player.now[0] === bId && completed.control.audible?.source?.id === bId &&
      completed.control.planned === null && completed.control.queue.length === 0,
    'Native mix completion failed to retire A and retain only audible B.');
    return {sampleRate: context.sampleRate, engineGeneration: entry.engineGeneration,
      entryFrame: entry.frame, observedEntryFrame: entered.player.currentFrame,
      endFrame: end.frame, observedEndFrame: completed.player.currentFrame,
      preparedBeforeAudible: true, queueConsumedAtEntry: true, cancellationRefusedAfterEntry: true,
      onlyBAudibleAfterCompletion: true, clock: 'Unmodified native AudioContext currentTime',
      output: 'Renderer-clock audibility only; physical output and listening NOT TESTED'};
  } finally { await dj.dispose(); }
}

export async function runMixChecks(loaded: LoadedBrowserPack): Promise<readonly MixCheckResult[]> {
  const results: MixCheckResult[] = [], record: RecordCheck = async (name, action) => {
    try { results.push({name, status: 'PASS', evidence: await action()}); }
    catch (error) { results.push({name, status: 'FAIL', evidence: error instanceof Error ? error.stack ?? error.message : String(error)}); }
  };
  await runMixAutomationChecks(loaded, record);
  await record('Actual worker/plain DSP bit parity, analysis parity, input ownership and abort', workerContract);
  const template = loaded.pack.assets.find(asset => asset.source_kind === 'recording')!;
  for (const rate of [44100, 48000]) for (const spec of preparedCases) {
    await record(`Prepared ${spec.bBpm}→${spec.aBpm} BPM / ${spec.shift} semitones native paired replay at ${rate} Hz`,
      () => pairedPrepared(template, rate, spec));
  }
  await record('Native SmallPlayer/DJ ready-only mix, cancellation, Stop and FIFO retention', () => liveDj(loaded));
  for (const rate of [44100, 48000]) {
    await record(`Native clean cut paired replay/cancellation at ${rate} Hz`, () => pairedRecipe(rate, 'cut', false));
    for (const pulse of [false, true]) await record(`Native echo ${pulse ? 'pulse' : 'tone'} paired tail/master/cancellation at ${rate} Hz`,
      () => pairedRecipe(rate, 'echo-out', pulse));
  }
  await record('Actual native echo DJ S/T/E, FIFO, Hold, Pause and cancellation', () => liveEchoDj(loaded));
  return results;
}

import {analyzeAudio} from '../src/audio-analysis.js';
import {bindEchoReturn, cleanCutAutomation, createMixAutomationGraph, echoOutAutomation} from '../src/mix-automation.js';
import type {MixAnalysis, MixPointCandidate} from '../src/mix-analysis.js';

/** Isolated native output captures A and B separately; summed samples check combined headroom. */
async function recipeRender(rate: number, recipe: 'cut' | 'echo-out', pulse: boolean, cancel = false) {
  const context = new OfflineAudioContext(2, rate * 10, rate);
  const merger = context.createChannelMerger(2); merger.connect(context.destination);
  const master = context.createGain(); master.connect(merger, 0, 0);
  const outer = context.createGain(); outer.connect(master);
  const bMaster = context.createGain(); bMaster.connect(merger, 0, 1);
  const a = context.createBufferSource(), b = context.createBufferSource();
  const aBuffer = context.createBuffer(1, rate * 10, rate), bBuffer = context.createBuffer(1, rate * 10, rate);
  const raw = aBuffer.getChannelData(0), rawB = bBuffer.getChannelData(0);
  for (let f = 0; f < raw.length; f++) {
    raw[f] = recipe === 'cut' ? 0.1 : pulse
      ? (f % Math.round(rate / 2) < rate / 50 ? 0.12 * Math.cos(f * 0.07) : 0)
      : 0.12 * Math.sin(2 * Math.PI * 440 * f / rate);
    rawB[f] = recipe === 'cut' ? 0.1 : 0.08 + 0.02 * f / rawB.length;
  }
  a.buffer = aBuffer; b.buffer = bBuffer; a.connect(outer); b.connect(bMaster);
  const automation = recipe === 'echo-out' ? echoOutAutomation(120, rate) : cleanCutAutomation(rate);
  const T = 3 * rate, pre = recipe === 'echo-out' ? rate : 0, S = T - pre;
  const E = T + automation.incoming.durationFrames, entry = rate / 2;
  if (recipe === 'echo-out') bindEchoReturn(automation.outgoing, master);
  const outgoing = createMixAutomationGraph(context, a, outer, S, automation.outgoing);
  const incoming = createMixAutomationGraph(context, b, bMaster, T, automation.incoming);
  a.start(0); a.stop(cancel ? raw.length / rate : E / rate);
  if (cancel) { outgoing.restore(); incoming.release(); }
  else {
    b.start(T / rate, entry / rate);
    // Prove the echo return survives the actual outer A fader reaching zero.
    outer.gain.setValueAtTime(0, (recipe === 'echo-out' ? T : E) / rate);
  }
  const rendered = await context.startRendering();
  const left = new Float32Array(rendered.getChannelData(0)), right = new Float32Array(rendered.getChannelData(1));
  let peak = 0, beforeError = 0, tailPeak = 0, lastTailPeak = 0, boundaryJump = 0;
  for (let f = 0; f < left.length; f++) {
    requireAudio(Number.isFinite(left[f]) && Number.isFinite(right[f]), 'Nonfinite recipe samples.');
    peak = Math.max(peak, Math.abs(left[f]! + right[f]!));
    if (f < S || cancel) beforeError = Math.max(beforeError, Math.abs(left[f]! - raw[f]!));
    if (f > T + rate / 100 && f < E) tailPeak = Math.max(tailPeak, Math.abs(left[f]!));
    if (f > E - rate / 4 && f < E) lastTailPeak = Math.max(lastTailPeak, Math.abs(left[f]!));
    if (f > T - 5 && f < E + 5 && f > 0) boundaryJump = Math.max(boundaryJump,
      Math.abs(left[f]! + right[f]! - left[f - 1]! - right[f - 1]!));
  }
  requireAudio(beforeError === 0, 'A changed before S or cancellation did not restore exact sample bits.');
  requireAudio(peak < 0.3, 'Generated recipe exceeded its declared sample-headroom budget.');
  requireAudio(right.subarray(0, T + 1).every(v => v === 0), 'B produced audio before its exact T entrance.');
  if (!cancel) {
    const fade = Math.round(rate * 0.01), probe = Math.round(fade / 2);
    requireAudio(Math.abs(right[T + probe]! - rawB[entry + probe]! * probe / fade) < 0.00001,
      'B source offset/start or small fade is not sample aligned.');
    requireAudio(left.subarray(E).every(v => v === 0), 'A echo/filter audio escaped the exact E gate.');
    if (recipe === 'echo-out') requireAudio(tailPeak > 0.001 && lastTailPeak < 0.001,
      'Echo did not survive outer fade or decay below -60 dBFS inside its budget.');
    else requireAudio(boundaryJump < 0.00001, 'Complementary native cut created a discontinuity.');
  }
  const sum = Float64Array.from(left, (v, i) => v + right[i]!);
  const measured = analyzeAudio({sample_rate: rate, channels: 1, frames: sum.length,
    format: 'float32', samples: [sum], positive_rail: 1, negative_rail: -1});
  requireAudio(measured.true_peak.linear <= 10 ** (-1 / 20), 'Generated recipe exceeded -1 dBTP.');
  outgoing.release(); incoming.release();
  return {left, right, evidence: {rate, recipe, pulse, S, T, E, entry,
    peak, truePeak: measured.true_peak, beforeError, tailPeak, lastTailPeak, boundaryJump, cancellation: cancel,
    bAtExactFrame: true, outerAFaderZeroAtT: recipe === 'echo-out'}};
}
async function pairedRecipe(rate: number, recipe: 'cut' | 'echo-out', pulse: boolean) {
  const first = await recipeRender(rate, recipe, pulse), second = await recipeRender(rate, recipe, pulse);
  const differences = differingBits(first.left, second.left) + differingBits(first.right, second.right);
  requireAudio(differences === 0, 'Native recipe replay changed sample bits.');
  const cancelled = await recipeRender(rate, recipe, pulse, true);
  return {...first.evidence, differingSampleBitPatterns: differences, independentRenders: 2,
    exactCancellationRestore: cancelled.evidence.beforeError === 0};
}

/** Controlled known synthetic cues isolate live scheduling from detector qualification. */
function recipeEvidence(analysis: MixAnalysis): MixAnalysis {
  const rate = analysis.sampleRate;
  const cue = (seconds: number): MixPointCandidate => ({frame: seconds * rate, seconds, score: 1 - seconds / 100,
    confidence: 0.9, reasons: ['Known generated recipe timing; not a detector result.'],
    evidence: {kind: seconds ? 'boundary' : 'track-start', boundary: 0.9, period: 0.9, salience: 0.9,
      interference: 0.1, windowEndFrame: (seconds + 1) * rate, chroma: Array(12).fill(0)}});
  return {...analysis, tempo: {...analysis.tempo, bpm: 120, confidence: 0.9, ambiguity: 0},
    beatGrid: {...analysis.beatGrid, confidence: 0.9},
    structure: {...analysis.structure, downbeatConfidence: 0.9, phraseConfidence: 0.5,
      downbeatFrames: [0, 2, 4, 8].map(s => s * rate)},
    key: {...analysis.key, tonic: null, mode: null, confidence: 0}, mixOut: [cue(4), cue(8)], mixIn: [cue(0), cue(2)]};
}
async function liveEchoDj(template: LoadedBrowserPack): Promise<unknown> {
  const loaded = await generatedPack(template), context = new AudioContext({sampleRate: 48000});
  const runtime: MixPreparationRuntime = {analyze: async (...args) => {
    const pair = await analyzeMixPairInWorker(...args);
    return {from: recipeEvidence(pair.from), to: recipeEvidence(pair.to)};
  }, render: async () => { throw Error('Echo must preserve native B, not invoke WSOLA.'); }};
  const player = new SmallPlayer(context, loaded, loaded.pack.routes[0]!.id, runtime);
  const dj = new DeterministicDj(player, loaded, 'explore',
    {handoff: 'mix', mix: {recipe: 'echo-out', echoContentConfirmed: true}});
  let serial = 0;
  const base = () => ({schemaVersion: 'em.control.v0' as const, source: 'manual' as const,
    commandId: 'echo-live-' + ++serial, expectedRevision: dj.snapshot().control.revision});
  try {
    await dj.request({...base(), type: 'hold', enabled: true});
    await dj.request({...base(), type: 'transport', action: 'play'});
    const original = player.snapshot().voices[0]!;
    const head = {...base(), type: 'queueTrack' as const, trackId: player.pair.to.id};
    await dj.request(head);
    await dj.request({...base(), type: 'queueTrack', trackId: player.pair.from.id});
    const scheduled = player.snapshot();
    requireAudio(scheduled.mix?.summary?.recipe === 'echo-out' &&
      scheduled.mix.summary.processor === 'native-pcm@1', 'Actual live echo was not scheduled.');
    const cancel = await dj.request({...base(), type: 'cancelNext'});
    requireAudio(cancel.execution.status === 'applied' && player.snapshot().voices[0]!.endFrame === original.endFrame &&
      player.snapshot().mix === null, 'Native pre-S cancellation did not restore A.');
    await dj.request({...base(), type: 'nextSong'});
    const committed = player.snapshot(), S = committed.mix!.earliestEffect!.frame;
    const T = committed.transitionAt!.frame, E = committed.transitionEnd!.frame;
    requireAudio(T - S === context.sampleRate && E - T === 4 * context.sampleRate &&
      committed.voices[1]!.start.frame === T, 'Native S/T/E or B start differs from recipe.');
    await waitUntil(() => player.clock.currentFrame >= S, 'native echo prelude');
    await player.pause();
    const pausedFrame = player.clock.currentFrame;
    await new Promise<void>(resolve => setTimeout(resolve, 80));
    requireAudio(player.clock.currentFrame === pausedFrame && player.snapshot().state === 'paused',
      'Pause failed to stop the owner clock.');
    await player.resume();
    const prelude = dj.snapshot();
    requireAudio(prelude.player.currentFrame < T && !prelude.player.now.includes(player.pair.to.id) &&
      dj.operation(head.commandId)?.execution.status === 'scheduled', 'B was marked started during echo prelude.');
    const held = await dj.request({...base(), source: 'automation', type: 'setState', state: 'drive'});
    requireAudio(held.execution.reason === 'held', 'Echo prelude bypassed Hold.');
    const blocked = await dj.request({...base(), type: 'cancelQueue', queueCommandId: head.commandId});
    requireAudio(blocked.execution.status === 'blocked' && dj.operation(head.commandId)?.execution.status === 'scheduled' &&
      player.snapshot().voices.length === 2 && player.snapshot().transitionAt!.frame === T,
      'Prelude cancellation falsely cancelled the reserved B operation.');
    const tailQueue = dj.snapshot().control.queue.map(q => q.commandId);
    requireAudio(tailQueue.length === 1, 'cancelQueue acceptance changed existing list semantics.');
    await waitUntil(() => player.clock.currentFrame >= T, 'native echo B entry');
    const entered = dj.snapshot();
    requireAudio(entered.control.audible?.source?.id === player.pair.to.id &&
      dj.operation(head.commandId)?.execution.status === 'started' &&
      JSON.stringify(entered.control.queue.map(q => q.commandId)) === JSON.stringify(tailQueue),
      'Native echo entry changed provenance or tail FIFO.');
    requireAudio((await dj.request({...base(), type: 'cancelNext'})).execution.status === 'blocked',
      'Native post-T cancellation changed committed echo.');
    await waitUntil(() => player.clock.currentFrame >= E, 'native echo tail end');
    const ended = dj.snapshot();
    requireAudio(ended.player.now.length === 1 && ended.player.now[0] === player.pair.to.id,
      'A did not retire at E.');
    await dj.request({...base(), type: 'transport', action: 'stop'});
    requireAudio(player.snapshot().voices.length === 0 && player.snapshot().mix === null, 'Stop retained echo voices.');
    return {rate: context.sampleRate, S, T, E, processor: committed.mix!.summary!.processor,
      actualNativeEcho: true, nativeClock: true, beforeSCancelled: true, preludeCancelBlocked: true,
      bStartedOnlyAtT: true, pauseFreezesClock: true, holdPreserved: true, tailFifoPreserved: true,
      stopReleased: true, evidence: 'Controlled generated cue evidence; no detector/listening claim.'};
  } finally { await dj.dispose(); }
}
