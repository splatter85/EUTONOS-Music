import {decodeRecordings, type LoadedBrowserPack} from '../src/browser-pack.js';
import {commitHybridHandoff, planHybridHandoff, type HybridBridgeExit, type HybridHandoffPlan} from '../src/hybrid-handoff.js';
import {compileS01Phrase, type ProceduralPlan} from '../src/phrase-plan.js';
import {decodeProceduralSamples, ProceduralSource} from '../src/procedural-source.js';
import {RecordedSource, requireAudio, WebAudioClock, type DecodedRecording} from '../src/web-audio.js';

const tolerance = 0.000003;

/** Authored S05 boundaries at 120 BPM, written out here rather than taken from the planner. */
interface Bounds { aStart: number; fromExit: number; bridgeFull: number; toStart: number; end: number; }
function authoredBounds(rate: number, exit: HybridBridgeExit): Bounds {
  const aStart = Math.round(rate / 4), fromExit = aStart + 8 * rate;
  const toStart = fromExit + (exit === 'phrase' ? 8 : 16) * rate;
  return {aStart, fromExit, bridgeFull: fromExit + 2 * rate, toStart, end: exit === 'phrase' ? toStart + 2 * rate : toStart};
}

interface Rendered {
  channels: Float32Array[];
  handoff: HybridHandoffPlan;
  phrase: ProceduralPlan;
  samples: DecodedRecording[];
  a: DecodedRecording;
  b: DecodedRecording;
  bounds: Bounds;
  allocatedNoteNodes: number;
  cancelledAtFrame: number | null;
}

/**
 * Render recording A → bridge → recording B with the live player's planner and commit.
 * 'separate' routes A, the bridge and B to three discrete output channels; 'mono' sums
 * them on one output exactly as the player does.
 */
async function render(loaded: LoadedBrowserPack, rate: number, phrase: ProceduralPlan, exit: HybridBridgeExit,
  layout: 'separate' | 'mono', seconds: number, cancel = false): Promise<Rendered> {
  const context = new OfflineAudioContext(layout === 'separate' ? 3 : 1, Math.round(rate * seconds), rate);
  const clock = new WebAudioClock(context);
  const recordings = await decodeRecordings(loaded, context);
  const samples = await decodeProceduralSamples(loaded, context, phrase);
  const bounds = authoredBounds(rate, exit);
  const start = {at: clock.stamp(bounds.aStart), entryCueId: 'entry'};
  const handoff = planHybridHandoff(loaded.pack, 's01-a-to-b', phrase, exit, start, clock, true);
  requireAudio(handoff.fromExit.frame === bounds.fromExit && handoff.bridgeFull.frame === bounds.bridgeFull &&
    handoff.toStart.frame === bounds.toStart && handoff.end.frame === bounds.end,
  'The hybrid plan differs from the authored 8 s exit, one-bar tail and phrase boundaries.');
  const a = recordings.find(item => item.asset.id === handoff.from.id)!;
  const b = recordings.find(item => item.asset.id === handoff.to.id)!;
  let outputs: AudioNode[];
  if (layout === 'separate') {
    context.destination.channelInterpretation = 'discrete';
    const merger = context.createChannelMerger(3);
    merger.connect(context.destination);
    outputs = [0, 1, 2].map(index => {
      const unity = context.createGain();
      unity.connect(merger, 0, index);
      return unity;
    });
  } else outputs = [context.destination, context.destination, context.destination];
  const from = new RecordedSource(context, a, outputs[0]!, {allowFixtures: true});
  const bridge = new ProceduralSource(context, phrase, samples, outputs[1]!, {allowFixtures: true, leadIn: handoff.leadIn});
  const to = new RecordedSource(context, b, outputs[2]!, {allowFixtures: true});
  await Promise.all([from.prepare(clock), bridge.prepare(clock), to.prepare(clock)]);
  from.scheduleStart(start);
  const naturalEnd = from.endFrame;
  commitHybridHandoff(handoff, from, bridge, to);
  requireAudio(from.endFrame === bounds.bridgeFull && bridge.endFrame === bounds.end &&
    to.endFrame === bounds.toStart + b.buffer.length, 'Committed source ends differ from the checked handoff plan.');
  const allocatedNoteNodes = bridge.resourceUsage.allocatedNoteNodes;
  let rendering: Promise<AudioBuffer>, cancelledAtFrame: number | null = null;
  if (cancel) {
    const suspension = context.suspend(2);
    rendering = context.startRendering();
    await suspension;
    cancelledAtFrame = clock.currentFrame;
    requireAudio(cancelledAtFrame > bounds.aStart && cancelledAtFrame < bounds.fromExit,
      'Cancellation did not occur while A played before the bridge.');
    // The player's pre-boundary cancellation: restore A, release the bridge and B.
    requireAudio(from.cancelTransition(), 'A refused a pre-bridge cancellation.');
    bridge.release(); to.release();
    requireAudio(from.endFrame === naturalEnd, 'Cancellation did not restore A\'s natural end.');
    await context.resume();
  } else rendering = context.startRendering();
  const rendered = await rendering;
  const channels = Array.from({length: rendered.numberOfChannels}, (_, index) => new Float32Array(rendered.getChannelData(index)));
  from.release(); bridge.release(); to.release();
  requireAudio(bridge.resourceUsage.liveNoteNodes === 0 && bridge.resourceUsage.liveMixBuses === 0,
    'Release retained bridge nodes.');
  return {channels, handoff, phrase, samples, a, b, bounds, allocatedNoteNodes, cancelledAtFrame};
}

interface RoleSpan { notes: number; first: number; last: number; }
interface Oracle { a: Float64Array; p: Float64Array; b: Float64Array; roles: Record<string, RoleSpan>; leadInRoles: string[]; tailRoles: string[]; }

/**
 * Independent oracle. It does not import the source's frame, role-window or envelope
 * helpers: the one-bar percussion lead-in and tail and both linear fades are written here.
 */
function oracle(rendered: Rendered, frames: number): Oracle {
  const {phrase, samples, a: recordingA, b: recordingB, bounds} = rendered;
  const rate = recordingA.buffer.sampleRate;
  requireAudio(phrase.bpm === 120 && phrase.durationQuarters === 32, 'Unexpected S01 phrase grid.');
  const a = new Float64Array(frames), p = new Float64Array(frames), b = new Float64Array(frames);
  const aData = recordingA.buffer.getChannelData(0), bData = recordingB.buffer.getChannelData(0);
  const aFade = bounds.bridgeFull - bounds.fromExit;
  for (let frame = bounds.aStart; frame < Math.min(frames, bounds.bridgeFull, bounds.aStart + aData.length); frame++) {
    const gain = frame < bounds.fromExit ? 1 : 1 - (frame - bounds.fromExit) / aFade;
    a[frame] = aData[frame - bounds.aStart]! * gain;
  }
  for (let frame = bounds.toStart; frame < Math.min(frames, bounds.toStart + bData.length); frame++) b[frame] = bData[frame - bounds.toStart]!;
  const roles: Record<string, RoleSpan> = {};
  const leadInRoles = new Set<string>(), tailRoles = new Set<string>();
  const naturalEnd = bounds.fromExit + 16 * rate, tail = bounds.end - bounds.toStart;
  for (const event of phrase.events) {
    const percussion = event.role === 'percussion';
    if (event.atQuarters < 4 && !percussion) continue; // never allocated during A's tail bar
    const sample = samples.find(item => item.asset.id === event.sample.id && item.asset.revision === event.sample.revision);
    requireAudio(sample, 'Oracle cannot resolve the pinned sample.');
    const first = bounds.fromExit + Math.round(event.atQuarters * rate / 2);
    const nativeEnd = event.atQuarters * sample.asset.file.sample_rate / 2 + sample.asset.file.frames;
    let last = Math.min(bounds.fromExit + Math.round(nativeEnd * rate / sample.asset.file.sample_rate),
      first + sample.buffer.length, naturalEnd);
    if (percussion) {
      if (first >= bounds.end) continue; // cancelled after the bridge tail
      last = Math.min(last, bounds.end);
    } else {
      if (first >= bounds.toStart) continue; // B owns these roles from its entry
      requireAudio(last <= bounds.toStart, `A ${event.role} note would still sound under B.`);
    }
    if (first >= last) continue;
    const span = roles[event.role] ??= {notes: 0, first, last};
    span.notes++; span.first = Math.min(span.first, first); span.last = Math.max(span.last, last);
    if (first < bounds.bridgeFull) leadInRoles.add(event.role);
    if (last > bounds.toStart) tailRoles.add(event.role);
    const data = sample.buffer.getChannelData(0);
    for (let frame = first; frame < Math.min(last, frames); frame++) {
      const gain = frame < bounds.toStart ? 1 : tail ? 1 - (frame - bounds.toStart) / tail : 0;
      p[frame] = p[frame]! + data[frame - first]! * event.gain * gain;
    }
  }
  return {a, p, b, roles, leadInRoles: [...leadInRoles].sort(), tailRoles: [...tailRoles].sort()};
}

function maxError(actual: Float32Array, expected: (frame: number) => number): number {
  let error = 0;
  for (let frame = 0; frame < actual.length; frame++) {
    requireAudio(Number.isFinite(actual[frame]), 'Non-finite rendered sample.');
    error = Math.max(error, Math.abs(actual[frame]! - expected(frame)));
  }
  return error;
}
const silent = (data: Float32Array, from: number, to = data.length): boolean => data.subarray(from, to).every(value => value === 0);

/** Separated sources: each matches its oracle, ownership never overlaps, the mix has headroom. */
async function separated(loaded: LoadedBrowserPack, rate: number, phrase: ProceduralPlan): Promise<{evidence: unknown; rendered: Rendered}> {
  const rendered = await render(loaded, rate, phrase, 'phrase', 'separate', 32.5);
  const [a, p, b] = rendered.channels as [Float32Array, Float32Array, Float32Array];
  const {bounds} = rendered, frames = a.length;
  const expected = oracle(rendered, frames);
  const errors = {a: maxError(a, f => expected.a[f]!), bridge: maxError(p, f => expected.p[f]!), b: maxError(b, f => expected.b[f]!)};
  requireAudio(Math.max(errors.a, errors.bridge, errors.b) < tolerance,
    `A source differs from its independent oracle: ${JSON.stringify(errors)}`);
  requireAudio(silent(a, 0, bounds.aStart) && silent(a, bounds.bridgeFull), 'A sounded outside its start and one-bar tail.');
  requireAudio(silent(p, 0, bounds.fromExit) && silent(p, bounds.end), 'The bridge sounded outside its exit-to-tail window.');
  const bEnd = bounds.toStart + rendered.b.buffer.length;
  requireAudio(silent(b, 0, bounds.toStart) && silent(b, bEnd) && Math.abs(bEnd - (bounds.toStart + 16 * rate)) <= 1,
    'B sounded before its entry cue or past its natural end.');
  const bass = expected.roles.bass;
  requireAudio(bass && bass.first >= bounds.bridgeFull && bass.last <= bounds.toStart,
    'The bridge bass is not confined between A\'s silence and B\'s entry.');
  requireAudio(JSON.stringify(expected.leadInRoles) === '["percussion"]' && JSON.stringify(expected.tailRoles) === '["percussion"]',
    'Only percussion may overlap a recording.');
  let leadInNonzero = 0, tailNonzero = 0, maximumSources = 0, peak = 0, mixPeak = 0;
  for (let frame = 0; frame < frames; frame++) {
    const sources = Number(a[frame] !== 0) + Number(p[frame] !== 0) + Number(b[frame] !== 0);
    maximumSources = Math.max(maximumSources, sources);
    if (p[frame] !== 0 && frame >= bounds.fromExit && frame < bounds.bridgeFull) leadInNonzero++;
    if (p[frame] !== 0 && frame >= bounds.toStart && frame < bounds.end) tailNonzero++;
    peak = Math.max(peak, Math.abs(a[frame]!), Math.abs(p[frame]!), Math.abs(b[frame]!));
    mixPeak = Math.max(mixPeak, Math.abs(a[frame]! + p[frame]! + b[frame]!));
  }
  requireAudio(maximumSources <= 2, 'Three sources sounded at once.');
  requireAudio(leadInNonzero > 0 && tailNonzero > 0, 'The percussion lead-in or tail is silent.');
  requireAudio(peak > 0.01 && mixPeak < 1, 'The handoff is silent or its summed mix clips.');
  return {rendered, evidence: {sampleRate: rate, seed: phrase.seed, state: phrase.state, exit: 'phrase', frames,
    boundaries: bounds, bNaturalEndFrame: bEnd, allocatedNoteNodes: rendered.allocatedNoteNodes, eventCount: phrase.events.length,
    roleSpans: expected.roles, leadInRoles: expected.leadInRoles, tailRoles: expected.tailRoles,
    leadInNonzeroBridgeSamples: leadInNonzero, tailNonzeroBridgeSamples: tailNonzero, maximumSimultaneousSources: maximumSources,
    maxAbsoluteSampleError: errors, peak, summedMixPeak: mixPeak, tolerance,
    output: 'OfflineAudioContext; A, bridge and B on three discrete channels; no device output'}};
}

/** The mixed output replays bitwise, equals the channel sum, and the end exit and cancellation match oracles. */
async function mixed(loaded: LoadedBrowserPack, rate: number, phrase: ProceduralPlan, reference: Rendered | undefined): Promise<unknown> {
  const first = await render(loaded, rate, phrase, 'phrase', 'mono', 32.5);
  const replayPlan = compileS01Phrase(loaded.pack, {seed: phrase.seed, state: phrase.state, allowFixtures: true});
  requireAudio(JSON.stringify(replayPlan) === JSON.stringify(phrase), 'The same seed changed its immutable plan.');
  const replay = await render(loaded, rate, replayPlan, 'phrase', 'mono', 32.5);
  const mono = first.channels[0]!, again = replay.channels[0]!;
  let differentSamples = 0;
  for (let frame = 0; frame < Math.max(mono.length, again.length); frame++) if (mono[frame] !== again[frame]) differentSamples++;
  requireAudio(mono.length === again.length && differentSamples === 0, `Same-seed handoff replay differs in ${differentSamples} samples.`);
  reference ??= (await separated(loaded, rate, phrase)).rendered;
  const [a, p, b] = reference.channels as [Float32Array, Float32Array, Float32Array];
  const sumError = maxError(mono, frame => a[frame]! + p[frame]! + b[frame]!);
  requireAudio(sumError < tolerance, `The mixed output differs from the separated sources: ${sumError}`);

  const drive = compileS01Phrase(loaded.pack, {seed: 0x9e3779b9, state: 'drive', allowFixtures: true});
  const ending = await render(loaded, rate, drive, 'end', 'mono', 26.5);
  const endOracle = oracle(ending, ending.channels[0]!.length);
  const endError = maxError(ending.channels[0]!, frame => endOracle.a[frame]! + endOracle.p[frame]! + endOracle.b[frame]!);
  requireAudio(endError < tolerance, `The end-exit handoff differs from its oracle: ${endError}`);
  requireAudio(ending.handoff.tail.quarters === 0 && ending.bounds.end === ending.bounds.toStart &&
    JSON.stringify(endOracle.tailRoles) === '[]', 'The end exit left a bridge tail under B.');
  let endPeak = 0;
  for (const sample of ending.channels[0]!) endPeak = Math.max(endPeak, Math.abs(sample));
  requireAudio(endPeak > 0.01 && endPeak < 1, `The end-exit mix peak is outside (0.01, 1): ${endPeak}`);

  const cancelled = await render(loaded, rate, phrase, 'phrase', 'mono', 16.5, true);
  const aData = cancelled.a.buffer.getChannelData(0), aStart = cancelled.bounds.aStart;
  const cancelError = maxError(cancelled.channels[0]!, frame =>
    frame >= aStart && frame < aStart + aData.length ? aData[frame - aStart]! : 0);
  let tailPeak = 0;
  for (let frame = cancelled.bounds.bridgeFull; frame < aStart + aData.length; frame++) {
    tailPeak = Math.max(tailPeak, Math.abs(cancelled.channels[0]![frame]!));
  }
  requireAudio(cancelError < tolerance && tailPeak > 0.01, 'Cancelling before the bridge did not restore the full, unmixed A.');
  return {sampleRate: rate, replay: {seed: phrase.seed, state: phrase.state, comparedSamples: mono.length, bitwiseEqual: true},
    mixedVersusSeparatedMaxError: sumError,
    endExit: {seed: drive.seed, state: drive.state, boundaries: ending.bounds, tailQuarters: 0, maxAbsoluteSampleError: endError,
      peak: endPeak, roleSpans: endOracle.roles},
    cancellation: {cancelledAtFrame: cancelled.cancelledAtFrame, bridgeEntryFrame: cancelled.bounds.fromExit,
      restoredEndFrame: aStart + aData.length, maxAbsoluteSampleError: cancelError, restoredTailPeak: tailPeak},
    tolerance, output: 'OfflineAudioContext; mono mix as the player sums it; no device output'};
}

/** Four grouped S05 checks, appended after the recorded-source and S04 checks. */
export async function runHybridChecks(loaded: LoadedBrowserPack,
  record: (name: string, action: () => Promise<unknown>) => Promise<void>): Promise<void> {
  for (const rate of [48000, 44100]) {
    const phrase = compileS01Phrase(loaded.pack, {seed: 5, state: 'explore', allowFixtures: true});
    let reference: Rendered | undefined;
    await record(`S05 A → bridge → B separated sources, role ownership and headroom at ${rate} Hz`, async () => {
      const result = await separated(loaded, rate, phrase);
      reference = result.rendered;
      return result.evidence;
    });
    await record(`S05 mixed replay, end exit and pre-bridge cancellation at ${rate} Hz`,
      () => mixed(loaded, rate, phrase, reference));
  }
}
