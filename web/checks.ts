import {decodeRecordings, loadBrowserPack, type LoadedBrowserPack} from '../src/browser-pack.js';
import type {AudioAsset} from '../src/pack-types.js';
import {planTransition, RecordedSource, requireAudio, WebAudioClock} from '../src/web-audio.js';
import {runHybridChecks} from './hybrid-checks.js';
import {runProceduralChecks} from './procedural-checks.js';

const runButton = document.getElementById('run-checks') as HTMLButtonElement;
const status = document.getElementById('check-status')!;
const output = document.getElementById('check-results')!;

interface Result { check: string; status: 'PASS' | 'FAIL'; evidence: unknown; }

/** Exercise the same source and plan used by the live player, with native rendering. */
async function renderTransition(loaded: LoadedBrowserPack, rate: number): Promise<unknown> {
  const context = new OfflineAudioContext(1, Math.round(rate * 24.5), rate);
  const clock = new WebAudioClock(context);
  const recordings = await decodeRecordings(loaded, context);
  const start = {at: clock.stamp(Math.round(rate / 4)), entryCueId: 'entry'};
  const plan = planTransition(loaded.pack, 's01-a-to-b', start, clock, true);
  const a = recordings.find(r => r.asset.id === plan.from.id)!;
  const b = recordings.find(r => r.asset.id === plan.to.id)!;
  const from = new RecordedSource(context, a, context.destination,
    {allowFixtures: true, fadeOutFrames: plan.overlapFrames});
  const to = new RecordedSource(context, b, context.destination,
    {allowFixtures: true, fadeInFrames: plan.overlapFrames});
  await Promise.all([from.prepare(clock), to.prepare(clock)]);
  from.scheduleStart(start);
  to.scheduleStart({at: plan.at, entryCueId: plan.route.entry_cue});
  from.transitionOut(plan.route.exit_cue, plan.at);
  const end = to.endFrame;
  const rendered = await context.startRendering();
  const actual = rendered.getChannelData(0), aData = a.buffer.getChannelData(0), bData = b.buffer.getChannelData(0);
  let maxError = 0, peak = 0, nonzero = 0;
  for (let frame = 0; frame < actual.length; frame++) {
    const mix = Math.max(0, Math.min(1, (frame - plan.at.frame) / plan.overlapFrames));
    const aSample = frame >= start.at.frame && frame < plan.end.frame ? aData[frame - start.at.frame] ?? 0 : 0;
    const bSample = frame >= plan.at.frame && frame < end ? bData[frame - plan.at.frame] ?? 0 : 0;
    const expected = aSample * (1 - mix) + bSample * mix;
    const sample = actual[frame]!;
    requireAudio(Number.isFinite(sample), 'Non-finite rendered sample.');
    maxError = Math.max(maxError, Math.abs(sample - expected));
    peak = Math.max(peak, Math.abs(sample));
    if (sample !== 0) nonzero++;
  }
  requireAudio(maxError < 0.000003, `Rendered start/offset/envelope differs from expected samples: ${maxError}`);
  requireAudio(peak > 0.01 && peak < 1 && nonzero > rate, 'Transition is silent, invalid or clipped.');
  requireAudio(plan.at.frame === start.at.frame + rate * 8 && plan.end.frame === start.at.frame + rate * 12,
    'Fixture cue schedule does not match authored 8/12 second boundaries.');
  const authoredEndFrame = start.at.frame + rate * 24;
  // The loader already allows one native resampler rounding frame at natural EOF.
  // Cue starts and the outgoing handoff remain exact; do not relax sample comparison.
  requireAudio(end === plan.at.frame + b.buffer.length && Math.abs(end - authoredEndFrame) <= 1,
    `Natural end differs from the decoded length or authored duration: ${end} vs ${authoredEndFrame}.`);
  from.release(); to.release();
  return {sampleRate: rate, frames: actual.length, startFrame: start.at.frame,
    bEntryFrame: plan.at.frame, handoffFrame: plan.end.frame, endFrame: end,
    decodedFrames: {a: a.buffer.length, b: b.buffer.length}, authoredEndFrame,
    naturalEndDeltaFrames: end - authoredEndFrame,
    comparedSamples: actual.length, maxAbsoluteSampleError: maxError, peak, nonzeroSamples: nonzero,
    tolerance: 0.000003, output: 'OfflineAudioContext; no device output'};
}

async function cancellation(loaded: LoadedBrowserPack): Promise<unknown> {
  const context = new OfflineAudioContext(1, 48000, 48000);
  const clock = new WebAudioClock(context);
  const recording = (await decodeRecordings(loaded, context))[0]!;
  const source = new RecordedSource(context, recording, context.destination, {allowFixtures: true});
  await source.prepare(clock);
  source.scheduleStart({at: clock.stamp(12000), entryCueId: 'entry'});
  clock.invalidate();
  let rejected = false;
  try { source.getValidExits(); } catch { rejected = true; }
  requireAudio(rejected, 'Stale source did not reject a new plan.');
  source.release(); source.release();
  const rendered = await context.startRendering();
  requireAudio(rendered.getChannelData(0).every(sample => sample === 0), 'A released future source produced audio.');
  return {sampleRate: 48000, renderedFrames: rendered.length, peak: 0, stalePlanRejected: true};
}

/** Cancel after A has really rendered, before B's entry, then compare all A bytes. */
async function restoreCancelledTransition(loaded: LoadedBrowserPack, rate: number): Promise<unknown> {
  const context = new OfflineAudioContext(1, Math.round(rate * 16.5), rate);
  const clock = new WebAudioClock(context);
  const recordings = await decodeRecordings(loaded, context);
  const start = {at: clock.stamp(Math.round(rate / 4)), entryCueId: 'entry'};
  const plan = planTransition(loaded.pack, 's01-a-to-b', start, clock, true);
  const recording = recordings.find(r => r.asset.id === plan.from.id)!;
  const from = new RecordedSource(context, recording, context.destination,
    {allowFixtures: true, fadeOutFrames: plan.overlapFrames});
  const to = new RecordedSource(context, recordings.find(r => r.asset.id === plan.to.id)!, context.destination,
    {allowFixtures: true, fadeInFrames: plan.overlapFrames});
  await Promise.all([from.prepare(clock), to.prepare(clock)]);
  from.scheduleStart(start);
  const originalEnd = from.endFrame;
  to.scheduleStart({at: plan.at, entryCueId: plan.route.entry_cue});
  from.transitionOut(plan.route.exit_cue, plan.at);
  const suspension = context.suspend(2);
  const rendering = context.startRendering();
  await suspension;
  const cancelledAt = clock.currentFrame;
  requireAudio(from.cancelTransition(), 'A refused a pre-boundary cancellation.');
  to.release();
  requireAudio(from.endFrame === originalEnd, 'Cancellation did not restore the natural end.');
  await context.resume();
  const output = (await rendering).getChannelData(0), data = recording.buffer.getChannelData(0);
  let maxError = 0, tailPeak = 0;
  for (let frame = 0; frame < output.length; frame++) {
    const expected = frame >= start.at.frame && frame < originalEnd ? data[frame - start.at.frame]! : 0;
    requireAudio(Number.isFinite(output[frame]), 'Cancelled transition produced a non-finite sample.');
    maxError = Math.max(maxError, Math.abs(output[frame]! - expected));
    if (frame >= plan.end.frame && frame < originalEnd) tailPeak = Math.max(tailPeak, Math.abs(output[frame]!));
  }
  requireAudio(maxError < 0.000003 && tailPeak > 0.01, 'A was altered or ended early after cancellation.');
  from.release();
  return {sampleRate: rate, cancelledAtFrame: cancelledAt, cancelledEntryFrame: plan.at.frame,
    restoredEndFrame: originalEnd, comparedSamples: output.length,
    maxAbsoluteSampleError: maxError, tailPeak, tolerance: 0.000003,
    output: 'OfflineAudioContext; cancelled B and restored full A compared sample by sample'};
}

async function entryOffset(loaded: LoadedBrowserPack): Promise<unknown> {
  const rate = 44100;
  const context = new OfflineAudioContext(1, Math.round(rate * 8.5), rate);
  const clock = new WebAudioClock(context);
  const original = loaded.pack.assets[0]!;
  // Diagnostic-only buffer: a 1-second pickup and entry at quarter 16 (= 9 s).
  // This does not modify or promote the committed musical fixtures.
  const asset: AudioAsset = {...original, file: {...original.file, frames: 408000},
    timing: {...original.timing!, first_downbeat_frame: 24000},
    cues: [...original.cues, {id: 'middle', kind: 'entry', position_quarters: 16}]};
  const buffer = context.createBuffer(1, 17 * rate, rate);
  buffer.getChannelData(0)[9 * rate + 4] = 0.5;
  const source = new RecordedSource(context, {asset, buffer}, context.destination, {allowFixtures: true});
  await source.prepare(clock);
  const startFrame = Math.round(rate / 4);
  source.scheduleStart({at: clock.stamp(startFrame), entryCueId: 'middle'});
  const result = (await context.startRendering()).getChannelData(0);
  const nonzero = [...result.entries()].filter(([, value]) => value !== 0);
  requireAudio(nonzero.length === 1 && nonzero[0]![0] === startFrame + 4 && nonzero[0]![1] === 0.5,
    'Nonzero entry/pickup was not mapped to the output clock.');
  source.release();
  return {fileSampleRate: 24000, outputSampleRate: rate, pickupSeconds: 1,
    sourceEntrySeconds: 9, observedImpulseFrame: nonzero[0]![0], expectedImpulseFrame: startFrame + 4};
}

runButton.addEventListener('click', () => { void run(); });
async function run(): Promise<void> {
  runButton.disabled = true;
  status.textContent = 'Running native Web Audio checks…';
  const results: Result[] = [];
  const record = async (name: string, action: () => Promise<unknown>) => {
    try { results.push({check: name, status: 'PASS', evidence: await action()}); }
    catch (error) { results.push({check: name, status: 'FAIL', evidence: error instanceof Error ? error.message : String(error)}); }
    output.textContent = JSON.stringify({userAgent: navigator.userAgent, results}, null, 2);
  };
  try {
    const url = new URL('/fixtures/s01/manifest.json', window.location.href);
    const loaded = await loadBrowserPack(url, true);
    await record('Manifest, rights files and all six WAV hashes validated', async () =>
      ({pack: loaded.pack.id, revision: loaded.pack.revision, files: loaded.files.size}));
    await record('Fixture mode is explicit', async () => {
      let rejected = false;
      try { await loadBrowserPack(url); } catch (error) { rejected = /fixture mode/.test(String(error)); }
      requireAudio(rejected, 'Fixture playback was admitted without opt-in.');
      return {defaultModeRejectedFixtures: true};
    });
    await record('Native browser decoding of all six WAV files', async () => {
      const context = new OfflineAudioContext(1, 1, 48000);
      const files = [];
      for (const asset of loaded.pack.assets) {
        const buffer = await context.decodeAudioData(new Uint8Array(loaded.files.get(asset.file.path)!).buffer);
        requireAudio(buffer.sampleRate === 48000 && buffer.numberOfChannels === asset.file.channels &&
          buffer.length === asset.file.frames * 2, `Wrong native decode for ${asset.id}`);
        files.push({id: asset.id, sampleRate: buffer.sampleRate, frames: buffer.length});
      }
      return files;
    });
    await record('A → B native rendered samples at 48 kHz', () => renderTransition(loaded, 48000));
    await record('A → B native rendered samples at 44.1 kHz', () => renderTransition(loaded, 44100));
    await record('Release cancels future audio; stale generation rejected', () => cancellation(loaded));
    await record('Native render preserves pickup and nonzero entry offset', () => entryOffset(loaded));
    await record('Cancelling A → B restores full A at 48 kHz', () => restoreCancelledTransition(loaded, 48000));
    await record('Cancelling A → B restores full A at 44.1 kHz', () => restoreCancelledTransition(loaded, 44100));
    await runProceduralChecks(loaded, record);
    await runHybridChecks(loaded, record);
  } catch (error) {
    results.push({check: 'Load/check harness', status: 'FAIL', evidence: String(error)});
  }
  const failed = results.filter(r => r.status === 'FAIL').length;
  status.textContent = failed ? `${failed} failed · ${results.length - failed} passed.` : `${results.length} checks passed. No physical output or listening was tested.`;
  output.textContent = JSON.stringify({userAgent: navigator.userAgent, results,
    listening: 'NOT TESTED', physicalOutput: 'NOT TESTED'}, null, 2);
  runButton.disabled = false;
}
