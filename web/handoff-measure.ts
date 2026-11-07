/**
 * EMF-S09 native offline measurement of A → procedural bridge → B for an imported pack, using the
 * live player's planner, sources and commit. It works for any pack whose route has a code-defined
 * hybrid policy: the S06 mock pack in the portable gate, and the owner-local real-FL pack in
 * `check:fl`. Boundaries are recomputed here from the cues, tempo and policy constants, not taken
 * from the planner. Levels, gaps and boundary jumps are engineering measurements of rendered
 * samples. They are not physical output, and nobody listened.
 */
import {decodeRecordings, loadBrowserPack, type LoadedBrowserPack} from '../src/browser-pack.js';
import {commitHybridHandoff, hybridPolicyForRoute, planHybridHandoff, type HybridBridgeExit} from '../src/hybrid-handoff.js';
import {compilePhrase, type S01PhraseState} from '../src/phrase-plan.js';
import {decodeProceduralSamples, ProceduralSource} from '../src/procedural-source.js';
import {RecordedSource, requireAudio, WebAudioClock} from '../src/web-audio.js';

/** A window quieter than this (dBFS RMS over 10 ms) counts as silent. */
const SILENT_DB = -60;
/** A silent run longer than one bar at 120 BPM inside the handoff is a gap, not a rest. */
const MAX_GAP_SECONDS = 2;

export interface HandoffCase { readonly rate: number; readonly seed: number; readonly state: S01PhraseState; readonly exit: HybridBridgeExit }
const db = (x: number) => x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity;

function stats(channels: readonly Float32Array[], from: number, to: number) {
  let sum = 0, peak = 0, n = 0, clipped = 0;
  for (const data of channels) {
    for (let f = Math.max(0, from); f < Math.min(to, data.length); f++) {
      const v = data[f]!;
      requireAudio(Number.isFinite(v), 'Non-finite rendered sample.');
      sum += v * v; n++; peak = Math.max(peak, Math.abs(v));
      if (Math.abs(v) >= 1) clipped++;
    }
  }
  return {rmsDb: db(Math.sqrt(sum / Math.max(1, n))), peakDb: db(peak), peak, clipped};
}
function energyOutside(channels: readonly Float32Array[], from: number, to: number): number {
  let peak = 0;
  for (const data of channels) for (let f = 0; f < data.length; f++) if (f < from || f >= to) peak = Math.max(peak, Math.abs(data[f]!));
  return peak;
}
/** Longest run of consecutive silent 10 ms windows between two frames, in seconds. */
function longestGap(channels: readonly Float32Array[], from: number, to: number, rate: number): {seconds: number; atSeconds: number | null} {
  const w = Math.round(rate / 100);
  let run = 0, best = 0, bestAt: number | null = null, start = from;
  for (let f = from; f + w <= to; f += w) {
    if (stats(channels, f, f + w).rmsDb < SILENT_DB) { if (!run) start = f; run += w; if (run > best) { best = run; bestAt = start; } }
    else run = 0;
  }
  return {seconds: best / rate, atSeconds: bestAt === null ? null : bestAt / rate};
}

/** Render one case four times (A only, bridge only, B only, the mix) with the same plan and commit. */
async function render(loaded: LoadedBrowserPack, c: HandoffCase) {
  const route = loaded.pack.routes[0];
  requireAudio(route, 'The pack has no route.');
  const policy = hybridPolicyForRoute(route);
  requireAudio(policy, `No hybrid policy covers ${route.id}@${route.revision}.`);
  const phrase = compilePhrase(loaded.pack, {recipe: policy.recipe, seed: c.seed, state: c.state, allowFixtures: true});
  const from = loaded.pack.assets.find(a => a.id === route.from.id && a.revision === route.from.revision)!;
  const to = loaded.pack.assets.find(a => a.id === route.to.id && a.revision === route.to.revision)!;
  const bpm = from.timing!.bpm, frames = (quarters: number) => Math.round(quarters * 60 / bpm * c.rate);
  const exitCue = from.cues.find(cue => cue.id === route.exit_cue)!, entryCue = to.cues.find(cue => cue.id === route.entry_cue)!;
  // Independent boundaries: A starts a quarter second in; the bridge enters on A's exit cue; A fades over
  // the policy lead-in; B enters on the chosen bridge exit; the bridge tail lasts at most the policy tail.
  const aStart = Math.round(c.rate / 4), fromExit = aStart + frames(exitCue.position_quarters);
  const exitQuarters = c.exit === 'phrase' ? phrase.exitQuarters[0] : phrase.exitQuarters[1];
  const bounds = {aStart, fromExit, bridgeFull: fromExit + frames(policy.leadIn.quarters), toStart: fromExit + frames(exitQuarters),
    end: fromExit + frames(exitQuarters + Math.min(policy.tail.quarters, phrase.durationQuarters - exitQuarters))};
  const bodyAfterEntry = frames(to.timing!.bars * 4 - entryCue.position_quarters);
  const length = bounds.toStart + Math.min(bodyAfterEntry, frames(8)) + Math.round(c.rate / 2);

  const pass = async (solo: 'a' | 'p' | 'b' | 'mix') => {
    const context = new OfflineAudioContext(2, length, c.rate);
    const clock = new WebAudioClock(context);
    const recordings = await decodeRecordings(loaded, context);
    const samples = await decodeProceduralSamples(loaded, context, phrase);
    const start = {at: clock.stamp(bounds.aStart), entryCueId: 'entry'};
    const plan = planHybridHandoff(loaded.pack, route.id, phrase, c.exit, start, clock, true);
    requireAudio(plan.policy.id === policy.id && plan.fromExit.frame === bounds.fromExit && plan.bridgeFull.frame === bounds.bridgeFull &&
      plan.toStart.frame === bounds.toStart && plan.end.frame === bounds.end,
    `Planner boundaries ${JSON.stringify([plan.fromExit.frame, plan.bridgeFull.frame, plan.toStart.frame, plan.end.frame])} differ from ${JSON.stringify(bounds)}.`);
    const muted = context.createGain(); muted.gain.value = 0; muted.connect(context.destination);
    const out = (who: 'a' | 'p' | 'b') => solo === 'mix' || solo === who ? context.destination : muted;
    const a = new RecordedSource(context, recordings.find(r => r.asset.id === from.id)!, out('a'), {allowFixtures: true});
    const bridge = new ProceduralSource(context, phrase, samples, out('p'), {allowFixtures: true, leadIn: plan.leadIn});
    const b = new RecordedSource(context, recordings.find(r => r.asset.id === to.id)!, out('b'), {allowFixtures: true});
    await Promise.all([a.prepare(clock), bridge.prepare(clock), b.prepare(clock)]);
    a.scheduleStart(start);
    commitHybridHandoff(plan, a, bridge, b);
    const rendered = await context.startRendering();
    a.release(); bridge.release(); b.release();
    requireAudio(bridge.resourceUsage.liveNoteNodes === 0 && bridge.resourceUsage.liveMixBuses === 0, 'Release retained bridge nodes.');
    return [new Float32Array(rendered.getChannelData(0)), new Float32Array(rendered.getChannelData(1))];
  };
  return {route, policy, phrase, bounds, a: await pass('a'), p: await pass('p'), b: await pass('b'), mix: await pass('mix')};
}

export async function measureHandoff(loaded: LoadedBrowserPack, c: HandoffCase) {
  const {route, policy, phrase, bounds, a, p, b, mix} = await render(loaded, c);
  // Ownership, exact: A is silent from the end of its fade, B before its entry, the bridge outside its window.
  const aAfter = energyOutside(a, 0, bounds.bridgeFull), pOutside = energyOutside(p, bounds.fromExit, bounds.end);
  const bBefore = energyOutside(b, bounds.toStart, Number.MAX_SAFE_INTEGER);
  requireAudio(aAfter === 0 && pOutside === 0 && bBefore === 0,
    `A source sounds outside its window (A after fade ${aAfter}, bridge outside ${pOutside}, B before entry ${bBefore}).`);
  const s = (x: number) => Math.round(x / c.rate * 1000) / 1000;
  const segments = {
    aAlone: stats(mix, bounds.aStart, bounds.fromExit), leadIn: stats(mix, bounds.fromExit, bounds.bridgeFull),
    bridge: stats(mix, bounds.bridgeFull, bounds.toStart), tail: stats(mix, bounds.toStart, bounds.end),
    bAlone: stats(mix, bounds.end, mix[0]!.length),
  };
  const quarter = Math.round(c.rate / 4);
  const jump = (at: number) => { const before = stats(mix, at - quarter, at).rmsDb, after = stats(mix, at, at + quarter).rmsDb;
    return {beforeDb: before, afterDb: after, deltaDb: Number.isFinite(before) && Number.isFinite(after) ? Math.round((after - before) * 10) / 10 : null}; };
  const boundaries = {bridgeEnters: jump(bounds.fromExit), aSilent: jump(bounds.bridgeFull), bEnters: jump(bounds.toStart), bridgeEnds: jump(bounds.end)};
  const gap = longestGap(mix, bounds.aStart, bounds.end + quarter * 4, c.rate);
  const clipped = Object.values(segments).reduce((n, x) => n + x.clipped, 0);
  requireAudio(clipped === 0, `${clipped} mixed samples reach full scale.`);
  requireAudio(gap.seconds <= MAX_GAP_SECONDS, `A ${gap.seconds} s silent gap at ${gap.atSeconds} s exceeds ${MAX_GAP_SECONDS} s.`);
  requireAudio(segments.aAlone.rmsDb > SILENT_DB && segments.bridge.rmsDb > SILENT_DB && segments.bAlone.rmsDb > SILENT_DB,
    'A segment of the handoff is silent.');
  return {pack: `${loaded.pack.id}@${loaded.pack.revision}`, route: `${route.id}@${route.revision}`, policy: `${policy.id}@${policy.revision}`,
    recipe: `${phrase.recipe.id}@${phrase.recipe.revision}`, case: c, sampleEvents: phrase.events.length,
    secondsOnClock: {aStart: s(bounds.aStart), bridgeEnters: s(bounds.fromExit), aSilent: s(bounds.bridgeFull), bEnters: s(bounds.toStart), bridgeEnds: s(bounds.end)},
    ownership: {aAfterFadePeak: aAfter, bridgeOutsideWindowPeak: pOutside, bBeforeEntryPeak: bBefore},
    segments, boundaries, longestSilentRun: gap, silentBelowDbfs: SILENT_DB,
    output: 'OfflineAudioContext stereo; no device output; listening NOT TESTED'};
}

/** The cases each imported pack is measured with. */
export const HANDOFF_CASES: readonly HandoffCase[] = [
  {rate: 48000, seed: 1, state: 'explore', exit: 'phrase'},
  {rate: 44100, seed: 1, state: 'explore', exit: 'phrase'},
  {rate: 48000, seed: 2, state: 'drive', exit: 'end'},
];

/** Loads a pack by URL (fixture mode) and measures every case; used by `check:fl` through page evaluation. */
export async function measurePack(manifestPath: string) {
  const loaded = await loadBrowserPack(new URL(manifestPath, window.location.href), true);
  const results = [];
  for (const c of HANDOFF_CASES) {
    try { results.push({status: 'PASS', ...(await measureHandoff(loaded, c))}); }
    catch (error) { results.push({status: 'FAIL', case: c, error: error instanceof Error ? error.message : String(error)}); }
  }
  return {pack: `${loaded.pack.id}@${loaded.pack.revision}`, producer: loaded.pack.assets[0]?.rights.origin ?? null, results};
}
