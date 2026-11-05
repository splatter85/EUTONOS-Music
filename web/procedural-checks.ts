import type {LoadedBrowserPack} from '../src/browser-pack.js';
import {compileS01Phrase, type ProceduralPlan} from '../src/phrase-plan.js';
import {decodeProceduralSamples, ProceduralSource} from '../src/procedural-source.js';
import {requireAudio, WebAudioClock, type DecodedRecording} from '../src/web-audio.js';

const tolerance = 0.000003;
type Mode = 'natural' | 'stop' | 'exit' | 'cancel' | 'release';
interface Rendered {
  pcm: Float32Array;
  evidence: Record<string, unknown>;
}

/** Independent oracle: add native decoded samples on the authored sample grid.
 * Do not import the source's frame conversion or envelope helpers. At 44.1 kHz,
 * round the absolute native endpoint, not a separately rounded note duration.
 */
function expectedSamples(plan: ProceduralPlan, samples: readonly DecodedRecording[], rate: number,
  frames: number, start: number, end: number, fadeIn: number, exit: number | null, fadeOut: number,
  released: boolean): {pcm: Float64Array; maximumVoices: number} {
  const pcm = new Float64Array(frames);
  const boundaries: {frame: number; delta: number}[] = [];
  requireAudio(plan.bpm === 120 && plan.durationQuarters === 32, 'Unexpected S01 phrase grid.');
  for (const event of plan.events) {
    const sample = samples.find(item => item.asset.id === event.sample.id && item.asset.revision === event.sample.revision);
    requireAudio(sample, 'Oracle cannot resolve the pinned sample.');
    const first = start + Math.round(event.atQuarters * rate / 2);
    const nativeEnd = event.atQuarters * sample.asset.file.sample_rate / 2 + sample.asset.file.frames;
    const last = Math.min(start + Math.round(nativeEnd * rate / sample.asset.file.sample_rate),
      first + sample.buffer.length, end);
    if (first < last) boundaries.push({frame: first, delta: 1}, {frame: last, delta: -1});
    if (released) continue;
    const data = sample.buffer.getChannelData(0);
    for (let frame = first; frame < last; frame++) pcm[frame] = pcm[frame]! + data[frame - first]! * event.gain;
  }
  let voices = 0, maximumVoices = 0;
  boundaries.sort((a, b) => a.frame - b.frame || a.delta - b.delta);
  for (const boundary of boundaries) { voices += boundary.delta; maximumVoices = Math.max(maximumVoices, voices); }
  for (let frame = start; frame < end; frame++) {
    const entryGain = fadeIn ? Math.min(1, (frame - start) / fadeIn) : 1;
    const exitGain = exit !== null && frame >= exit ? (fadeOut ? Math.max(0, 1 - (frame - exit) / fadeOut) : 0) : 1;
    pcm[frame] = pcm[frame]! * entryGain * exitGain;
  }
  requireAudio(maximumVoices <= 4, `Oracle observed ${maximumVoices} simultaneous notes.`);
  return {pcm, maximumVoices};
}

async function render(loaded: LoadedBrowserPack, plan: ProceduralPlan, rate: number,
  mode: Mode = 'natural', fadeIn = 0): Promise<Rendered> {
  const context = new OfflineAudioContext(1, Math.round(rate * 16.5), rate);
  const clock = new WebAudioClock(context);
  const samples = await decodeProceduralSamples(loaded, context, plan);
  requireAudio(samples.length === 4 && samples.every(sample => sample.buffer.sampleRate === rate && sample.buffer.numberOfChannels === 1),
    'The four original samples were not decoded in the rendering context.');
  const start = Math.round(rate / 4), naturalEnd = start + rate * 16;
  const fadeOut = Math.round(rate / 4);
  const source = new ProceduralSource(context, plan, samples, context.destination,
    {allowFixtures: true, fadeInFrames: fadeIn, fadeOutFrames: fadeOut});
  await source.prepare(clock);
  source.scheduleStart({at: clock.stamp(start), entryCueId: 'entry'});
  const exits = source.getValidExits();
  requireAudio(exits.length === 2 && exits[0]!.offsetFrames === rate * 8 && exits[1]!.offsetFrames === rate * 16,
    'Declared phrase exits differ from 16 and 32 quarters.');
  requireAudio(source.endFrame === naturalEnd, 'Finite phrase end differs from 32 quarters.');
  const allocated = source.resourceUsage;
  requireAudio(allocated.allocatedNoteNodes === plan.events.length && allocated.liveNoteNodes === plan.events.length &&
    allocated.allocatedNoteNodes <= 256 && allocated.sampleValues <= 1024 * 1024, 'Native allocation budget was exceeded.');
  let expectedEnd = naturalEnd, exit: number | null = null, cancelledAt: number | null = null, staleRejected = false;
  let rendering: Promise<AudioBuffer>;
  if (mode === 'stop') {
    expectedEnd = start + Math.round(rate * 2.125);
    source.stop(clock.stamp(expectedEnd));
  } else if (mode === 'exit' || mode === 'cancel') {
    exit = start + exits[0]!.offsetFrames;
    source.transitionOut(exits[0]!.cueId, clock.stamp(exit));
    expectedEnd = exit + fadeOut;
  } else if (mode === 'release') {
    clock.invalidate();
    try { source.getValidExits(); } catch { staleRejected = true; }
    requireAudio(staleRejected, 'A stale procedural source accepted new planning.');
    source.release(); source.release();
  }
  if (mode === 'cancel') {
    const suspension = context.suspend(2);
    rendering = context.startRendering();
    await suspension;
    cancelledAt = clock.currentFrame;
    requireAudio(cancelledAt > start && cancelledAt < exit!, 'Cancellation did not occur during active audio before the exit.');
    requireAudio(source.cancelTransition(), 'Pre-boundary procedural cancellation was refused.');
    expectedEnd = naturalEnd; exit = null;
    await context.resume();
  } else rendering = context.startRendering();
  requireAudio(source.endFrame === expectedEnd, 'Source end does not match the requested stop/exit/cancellation.');
  const rendered = await rendering, actual = rendered.getChannelData(0);
  const oracle = expectedSamples(plan, samples, rate, actual.length, start, expectedEnd, fadeIn, exit, fadeOut, mode === 'release');
  let maxError = 0, peak = 0, nonzero = 0;
  for (let frame = 0; frame < actual.length; frame++) {
    const sample = actual[frame]!;
    requireAudio(Number.isFinite(sample), 'Non-finite procedural PCM.');
    maxError = Math.max(maxError, Math.abs(sample - oracle.pcm[frame]!));
    peak = Math.max(peak, Math.abs(sample));
    if (sample !== 0) nonzero++;
  }
  requireAudio(maxError < tolerance, `Procedural PCM differs from independent sample sum: ${maxError}`);
  requireAudio(actual.subarray(0, start).every(value => value === 0) && actual.subarray(expectedEnd).every(value => value === 0),
    'Audio escaped the declared head/tail boundaries.');
  requireAudio(mode === 'release' ? nonzero === 0 : peak > 0.01 && peak < 1 && nonzero > rate,
    'Procedural render is silent, clipped, or a released source produced audio.');
  source.release(); source.release();
  requireAudio(source.resourceUsage.liveNoteNodes === 0 && source.resourceUsage.sampleValues === 0,
    'Release retained procedural nodes or samples.');
  return {pcm: actual, evidence: {sampleRate: rate, seed: plan.seed, state: plan.state, mode,
    frames: actual.length, startFrame: start, endFrame: expectedEnd, exitFrame: exit, fadeInFrames: fadeIn,
    fadeOutFrames: exit === null ? 0 : fadeOut, cancelledAtFrame: cancelledAt, staleGenerationRejected: staleRejected,
    eventCount: plan.events.length, allocatedNoteNodes: allocated.allocatedNoteNodes,
    maximumVoices: oracle.maximumVoices, sampleValues: allocated.sampleValues,
    decodedSamples: samples.map(sample => ({id: sample.asset.id, revision: sample.asset.revision,
      nativeFrames: sample.asset.file.frames, decodedFrames: sample.buffer.length, sampleRate: sample.buffer.sampleRate})),
    comparedSamples: actual.length, maxAbsoluteSampleError: maxError, peak, nonzeroSamples: nonzero,
    headAndTailSilent: true, releasedLiveNodes: source.resourceUsage.liveNoteNodes, tolerance,
    output: 'OfflineAudioContext; no device output'}};
}

/** Six grouped S04 checks, appended to the nine unchanged recorded-source checks. */
export async function runProceduralChecks(loaded: LoadedBrowserPack,
  record: (name: string, action: () => Promise<unknown>) => Promise<void>): Promise<void> {
  for (const rate of [48000, 44100]) {
    const plan = compileS01Phrase(loaded.pack, {seed: 1, state: 'explore', allowFixtures: true});
    let baseline: Rendered | undefined;
    await record(`S04 independent native sample sum, finite boundaries and budgets at ${rate} Hz`, async () => {
      baseline = await render(loaded, plan, rate);
      return baseline.evidence;
    });
    await record(`S04 exact seed replay and representative/held-out diversity at ${rate} Hz`, async () => {
      baseline ??= await render(loaded, plan, rate);
      const replayPlan = compileS01Phrase(loaded.pack, {seed: 1, state: 'explore', allowFixtures: true});
      requireAudio(JSON.stringify(plan) === JSON.stringify(replayPlan), 'The same seed changed its immutable plan.');
      const replay = await render(loaded, replayPlan, rate);
      requireAudio(baseline.pcm.length === replay.pcm.length && baseline.pcm.every((value, index) => value === replay.pcm[index]),
        'Same-browser seed replay was not sample-exact.');
      const variations = [];
      for (const seed of [2, 0xdeadbeef]) {
        const variationPlan = compileS01Phrase(loaded.pack, {seed, state: 'explore', allowFixtures: true});
        requireAudio(JSON.stringify(plan.events) !== JSON.stringify(variationPlan.events), 'Distinct seed repeated the event sequence.');
        const variation = await render(loaded, variationPlan, rate);
        let differentSamples = 0;
        for (let frame = 0; frame < baseline.pcm.length; frame++) if (baseline.pcm[frame] !== variation.pcm[frame]) differentSamples++;
        requireAudio(differentSamples > rate, 'Distinct seed did not materially change native PCM.');
        variations.push({seed, heldOut: seed === 0xdeadbeef, differentSamples, render: variation.evidence});
      }
      return {sampleRate: rate, replayExact: true, replayComparedSamples: baseline.pcm.length,
        replayMaxAbsoluteSampleError: 0, replay: replay.evidence, variations};
    });
    await record(`S04 native entry/exit envelopes, stop, cancellation and stale release at ${rate} Hz`, async () => {
      const drive = compileS01Phrase(loaded.pack, {seed: 0x12345678, state: 'drive', allowFixtures: true});
      const cases = [];
      for (const mode of ['stop', 'exit', 'cancel', 'release'] as const) {
        cases.push((await render(loaded, drive, rate, mode, Math.round(rate / 100))).evidence);
      }
      return {sampleRate: rate, cases};
    });
  }
}
