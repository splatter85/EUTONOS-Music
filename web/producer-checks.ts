/**
 * EMF-S06 native offline checks for a pack imported from the MOCK FL producer. The pack is
 * generated before the checks run (scripts/mock-fl-producer.ts); no FL Studio is involved.
 * Each output channel is compared with an independent per-channel sum of decoded samples.
 */
import {decodeRecordings, loadBrowserPack, type LoadedBrowserPack} from '../src/browser-pack.js';
import {compilePhrase, compileS01Phrase} from '../src/phrase-plan.js';
import {decodeProceduralSamples, ProceduralSource} from '../src/procedural-source.js';
import {planTransition, RecordedSource, requireAudio, WebAudioClock} from '../src/web-audio.js';

const tolerance = 0.000003;
const RECIPE = {id: 's06-mock-recipe', revision: 1};
export const MOCK_PACK_PATH = '/generated/s06-mock-fl/pack/manifest.json';

function measure(actual: Float32Array, expected: Float64Array) {
  let maxError = 0, peak = 0, nonzero = 0;
  for (let frame = 0; frame < actual.length; frame++) {
    const sample = actual[frame]!;
    requireAudio(Number.isFinite(sample), 'Non-finite rendered sample.');
    maxError = Math.max(maxError, Math.abs(sample - expected[frame]!));
    peak = Math.max(peak, Math.abs(sample));
    if (sample !== 0) nonzero++;
  }
  return {maxError, peak, nonzero};
}

async function renderPhrase(mock: LoadedBrowserPack, s01: LoadedBrowserPack, rate: number) {
  const plan = compilePhrase(mock.pack, {recipe: RECIPE, seed: 1, state: 'explore', allowFixtures: true});
  const base = compileS01Phrase(s01.pack, {seed: 1, state: 'explore', allowFixtures: true});
  requireAudio(plan.events.length === base.events.length && plan.events.every((event, i) => {
    const other = base.events[i]!;
    return event.role === other.role && event.atQuarters === other.atQuarters && event.gain === other.gain;
  }), 'The mock palette changed the performer events.');
  const context = new OfflineAudioContext(2, Math.round(rate * 16.5), rate);
  const clock = new WebAudioClock(context);
  const samples = await decodeProceduralSamples(mock, context, plan);
  requireAudio(samples.length === 4 && samples.every(s => s.buffer.sampleRate === rate && s.buffer.numberOfChannels === 2),
    'The four mock one-shots were not decoded as stereo in the rendering context.');
  const start = Math.round(rate / 4), end = start + rate * 16;
  const source = new ProceduralSource(context, plan, samples, context.destination, {allowFixtures: true});
  await source.prepare(clock);
  source.scheduleStart({at: clock.stamp(start), entryCueId: 'entry'});
  requireAudio(source.endFrame === end, 'Finite phrase end differs from 32 quarters.');
  const rendered = await context.startRendering();
  const channels = [];
  for (let channel = 0; channel < 2; channel++) {
    const expected = new Float64Array(rendered.length);
    for (const event of plan.events) {
      const sample = samples.find(s => s.asset.id === event.sample.id && s.asset.revision === event.sample.revision);
      requireAudio(sample, 'Oracle cannot resolve the bound sample.');
      const native = sample.asset.file.sample_rate;
      const first = start + Math.round(event.atQuarters * rate / 2);
      // The authored grid places the onset on a whole native frame, then the sample's own frames follow.
      const nativeEnd = Math.round(event.atQuarters * native / 2) + sample.asset.file.frames;
      const last = Math.min(start + Math.round(nativeEnd * rate / native), first + sample.buffer.length, end);
      const data = sample.buffer.getChannelData(channel);
      for (let frame = first; frame < last; frame++) expected[frame] = expected[frame]! + data[frame - first]! * event.gain;
    }
    const actual = rendered.getChannelData(channel), result = measure(actual, expected);
    requireAudio(result.maxError < tolerance, `Channel ${channel} differs from the independent sample sum: ${result.maxError}`);
    requireAudio(result.peak > 0.01 && result.peak < 1 && result.nonzero > rate, `Channel ${channel} is silent or clipped.`);
    requireAudio(actual.subarray(0, start).every(v => v === 0) && actual.subarray(end).every(v => v === 0),
      'Audio escaped the declared head/tail boundaries.');
    channels.push({channel, comparedSamples: actual.length, maxAbsoluteSampleError: result.maxError, peak: result.peak, nonzeroSamples: result.nonzero});
  }
  const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
  let channelsDiffer = 0;
  for (let frame = 0; frame < left.length; frame++) if (left[frame] !== right[frame]) channelsDiffer++;
  requireAudio(channelsDiffer > rate, 'Stereo samples collapsed to identical channels.');
  source.release();
  return {sampleRate: rate, pack: mock.pack.id, recipe: RECIPE, seed: plan.seed, state: plan.state,
    eventCount: plan.events.length, eventsMatchS01Performer: true, startFrame: start, endFrame: end, channels,
    framesWhereChannelsDiffer: channelsDiffer, tolerance, producer: 'MOCK FL (no FL Studio)', output: 'OfflineAudioContext; no device output'};
}

async function renderRoute(mock: LoadedBrowserPack, rate: number) {
  const recordingsLength = mock.pack.assets.filter(a => a.source_kind === 'recording')
    .reduce((max, a) => Math.max(max, a.file.frames / a.file.sample_rate), 0);
  const context = new OfflineAudioContext(2, Math.ceil(rate * (8.5 + recordingsLength)), rate);
  const clock = new WebAudioClock(context);
  const recordings = await decodeRecordings(mock, context);
  const start = {at: clock.stamp(Math.round(rate / 4)), entryCueId: 'entry'};
  const plan = planTransition(mock.pack, 's06-a-to-b', start, clock, true);
  const a = recordings.find(r => r.asset.id === plan.from.id)!, b = recordings.find(r => r.asset.id === plan.to.id)!;
  requireAudio(a.buffer.numberOfChannels === 2 && b.buffer.numberOfChannels === 2, 'Mock recordings were not decoded as stereo.');
  const from = new RecordedSource(context, a, context.destination, {allowFixtures: true, fadeOutFrames: plan.overlapFrames});
  const to = new RecordedSource(context, b, context.destination, {allowFixtures: true, fadeInFrames: plan.overlapFrames});
  await Promise.all([from.prepare(clock), to.prepare(clock)]);
  from.scheduleStart(start);
  to.scheduleStart({at: plan.at, entryCueId: plan.route.entry_cue});
  from.transitionOut(plan.route.exit_cue, plan.at);
  const end = to.endFrame;
  requireAudio(plan.at.frame === start.at.frame + rate * 8 && plan.end.frame === start.at.frame + rate * 12,
    'Mock cue schedule does not match the authored 8/12 second boundaries.');
  requireAudio(end === plan.at.frame + b.buffer.length, 'B does not end at its decoded length.');
  const rendered = await context.startRendering();
  const channels = [];
  for (let channel = 0; channel < 2; channel++) {
    const actual = rendered.getChannelData(channel), expected = new Float64Array(actual.length);
    const aData = a.buffer.getChannelData(channel), bData = b.buffer.getChannelData(channel);
    for (let frame = 0; frame < actual.length; frame++) {
      const mix = Math.max(0, Math.min(1, (frame - plan.at.frame) / plan.overlapFrames));
      const aSample = frame >= start.at.frame && frame < plan.end.frame ? aData[frame - start.at.frame] ?? 0 : 0;
      const bSample = frame >= plan.at.frame && frame < end ? bData[frame - plan.at.frame] ?? 0 : 0;
      expected[frame] = aSample * (1 - mix) + bSample * mix;
    }
    const result = measure(actual, expected);
    requireAudio(result.maxError < tolerance, `Channel ${channel} A → B differs from the expected samples: ${result.maxError}`);
    requireAudio(result.peak > 0.01 && result.peak < 1 && result.nonzero > rate, `Channel ${channel} A → B is silent or clipped.`);
    channels.push({channel, comparedSamples: actual.length, maxAbsoluteSampleError: result.maxError, peak: result.peak, nonzeroSamples: result.nonzero});
  }
  from.release(); to.release();
  return {sampleRate: rate, route: plan.route.id, startFrame: start.at.frame, bEntryFrame: plan.at.frame, handoffFrame: plan.end.frame,
    endFrame: end, decodedFrames: {a: a.buffer.length, b: b.buffer.length}, channels, tolerance,
    producer: 'MOCK FL (no FL Studio)', output: 'OfflineAudioContext; no device output'};
}

/** Four grouped S06 checks, appended after the S05 groups. */
export async function runProducerChecks(s01: LoadedBrowserPack,
  record: (name: string, action: () => Promise<unknown>) => Promise<void>): Promise<void> {
  const url = new URL(MOCK_PACK_PATH, window.location.href);
  let mock: LoadedBrowserPack | undefined;
  const loaded = async () => (mock ??= await loadBrowserPack(url, true));
  await record('S06 imported mock-FL pack: browser validation, fixture opt-in and native stereo decode', async () => {
    const pack = await loaded();
    let rejected = false;
    try { await loadBrowserPack(url); } catch (error) { rejected = /fixture mode/.test(String(error)); }
    requireAudio(rejected, 'Imported fixture audio was admitted without opt-in.');
    const context = new OfflineAudioContext(2, 1, 48000), files = [];
    for (const asset of pack.pack.assets) {
      const buffer = await context.decodeAudioData(new Uint8Array(pack.files.get(asset.file.path)!).buffer);
      requireAudio(buffer.sampleRate === 48000 && buffer.numberOfChannels === 2 &&
        Math.abs(buffer.length - Math.round(asset.file.frames * 48000 / asset.file.sample_rate)) <= 1, `Wrong native decode for ${asset.id}`);
      files.push({id: asset.id, nativeRate: asset.file.sample_rate, channels: buffer.numberOfChannels, frames: buffer.length});
    }
    return {pack: pack.pack.id, revision: pack.pack.revision, files, defaultModeRejectedFixtures: true, producer: 'MOCK FL (no FL Studio)'};
  });
  await record('S06 mock palette through the unchanged S04 performer: native stereo sample sum at 48 kHz',
    async () => renderPhrase(await loaded(), s01, 48000));
  await record('S06 mock palette through the unchanged S04 performer: native stereo sample sum at 44.1 kHz',
    async () => renderPhrase(await loaded(), s01, 44100));
  await record('S06 mock recordings A → B over the authored route: native stereo samples at 48 kHz',
    async () => renderRoute(await loaded(), 48000));
}
