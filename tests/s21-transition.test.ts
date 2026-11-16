// EMF-S21 Part A: tempo-gap policy, whole-song entry choice, LR4 split, EQ choreography timing,
// seeded explore records and the transition-safety@1 rejections. Engineering checks only: none of
// these establish how a handover sounds (listening NOT TESTED).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  emptyTransitionRatings, entrySkipCost, ENTRY_POLICY, exploreChoice, EXPLORE_BOUNDS, chooseChoreography, makeTransitionPlanRecord,
  meetTempo, rankEntries, rateTransition, replayOverrides, tempoGapPolicy, validateTransitionPlanRecord,
  validateTransitionRatingLog, type PairFeatures, type TransitionPlanRecord,
} from '../web/transition-policy.js';
import {
  CHOREOGRAPHY_LIMITS, choreographyPlan, EQ_SPLIT, magnitudeDb, smoothstep, ThreeBandSplitter, threeBandResponse,
  type ChoreographyParams,
} from '../web/eq-choreography.js';
import {SONG_ANALYSIS_WINDOW, SONG_MERGE_POLICY, songWindowStarts, type MixAnalysis} from '../src/mix-analysis.js';
import {chooseSetTransition, downbeatAt, planRouteFreeTransition, replanPreparedMix, routeFreeEntry, ROUTE_FREE_LATER_BARS, transitionSignature,
  type ReadyMixTransition, type SetBarGrid} from '../src/mix-transition.js';
import {analyzeMixAudio} from '../src/mix-analysis.js';
import {MEET_LIMITS, MIX_OVERLAP_BEATS, planAutomaticMix} from '../src/mix-planner.js';
import type {AudioAsset} from '../src/pack-types.js';
import {makeSetFixture} from './helpers/synthetic-set.js';
import {outputFrameAtSource, sourceFrameAtOutput, type TimePitchMapping} from '../src/time-pitch.js';
import {judgeSafety, measureSafety, TRANSITION_SAFETY_THRESHOLDS, type SafetyMeasurements, type TransitionRender,
  type TransitionSpec} from '../web/mix-evaluator.js';

const RATE = 48000;
const requestedGrid = (bpm: number, rate = 16000): SetBarGrid => ({source: 'requested', bpm, barFrames: 4 * 60 * rate / bpm, downbeats: [0]});
const lane = (points: readonly {frame: number; value: number}[], frame: number): number => {
  if (frame <= points[0]!.frame) return points[0]!.value;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (frame <= b.frame) return a.value + (b.value - a.value) * (frame - a.frame) / (b.frame - a.frame);
  }
  return points.at(-1)!.value;
};

test('tempo-gap table: bands, order and the clean cut always last', () => {
  const cases: [number, number, string, string][] = [
    [120, 123, 'normal', 'blend'], [120, 127, 'stretched', 'blend'], [120, 132, 'meet', 'meet-in-middle'],
    [120, 144, 'bridge', 'echo-out'], [90, 128, 'reset', 'brake'], [128, 120, 'stretched', 'blend'],
  ];
  for (const [a, b, band, firstRecipe] of cases) {
    const p = tempoGapPolicy(a, b);
    assert.equal(p.band, band, `${a}->${b}`); assert.equal(p.recipes[0], firstRecipe, `${a}->${b}`);
    assert.equal(p.recipes.at(-1), 'cut', 'a clean cut is only the last resort');
    assert.equal(p.recipes.filter(r => r === 'cut').length, 1);
  }
  // Band edges: 4%, 8%, 16% and 25% belong to the lower band.
  assert.equal(tempoGapPolicy(100, 104).band, 'normal'); assert.equal(tempoGapPolicy(100, 108).band, 'stretched');
  assert.equal(tempoGapPolicy(100, 116).band, 'meet'); assert.equal(tempoGapPolicy(100, 125).band, 'bridge');
  assert.equal(tempoGapPolicy(100, 125.1).band, 'reset');
  // Meet in the middle keeps each deck within 8% across the whole meet band.
  const meet = tempoGapPolicy(100, 116);
  assert.ok(meet.perDeckChange <= 0.08, String(meet.perDeckChange));
  assert.ok(Math.abs(meetTempo(100, 116) - meet.meetBpm) < 1e-9);
  assert.ok(meetTempo(100, 116, 0.35) < meet.meetBpm && meetTempo(100, 116, 0.65) > meet.meetBpm);
  // Rhythm recipes are gated on beat confidence only; echo/reset/cut survive.
  const weak = tempoGapPolicy(120, 123, {beatConfident: false});
  assert.deepEqual(weak.recipes, ['echo-out', 'echo-reset', 'cut']);
});

test('entry choice: no early bias, a later phrase beyond 60 s wins, ties prefer the earlier cue, skip cost above 25%', () => {
  const frames = 240 * RATE;
  const at = (seconds: number, score: number) => ({frame: Math.round(seconds * RATE), score});
  // A clearly better phrase at 75 s beats the song start: position earns nothing.
  let ranked = rankEntries([at(0, 0.6), at(75, 0.85)], x => x, frames);
  assert.equal(ranked[0]!.frame, 75 * RATE);
  // Within about 10 points the earlier cue wins.
  ranked = rankEntries([at(75, 0.85), at(5, 0.78)], x => x, frames);
  assert.equal(ranked[0]!.frame, 5 * RATE);
  assert.equal(ENTRY_POLICY.tieWindow, 0.1);
  // Skipping more than 25% of B costs score; a DJ-edit style may waive it.
  assert.equal(entrySkipCost(0.25 * frames, frames), 0);
  assert.ok(Math.abs(entrySkipCost(0.75 * frames, frames) - 0.5 * ENTRY_POLICY.skipCostPerFraction) < 1e-12);
  ranked = rankEntries([at(0, 0.6), at(180, 0.95)], x => x, frames);
  assert.equal(ranked[0]!.frame, 0, '75% skipped costs 0.4: the start wins');
  ranked = rankEntries([at(0, 0.6), at(180, 0.95)], x => x, frames, true);
  assert.equal(ranked[0]!.frame, 180 * RATE, 'style asks for skipping');
  // The route-free path uses the same rule on a merged whole-song analysis.
  const song = {mixIn: [{frame: 0, score: 0.55}, {frame: 96 * RATE, score: 0.9, evidence: {kind: 'boundary'}}],
    structure: {phraseFrames: [0, 96 * RATE]}} as unknown as MixAnalysis;
  assert.equal(routeFreeEntry(song, frames), 96 * RATE);
});

test('whole-song windows cover the song in bounded 60 s windows, the last aligned to the end', () => {
  const size = SONG_ANALYSIS_WINDOW.seconds * RATE;
  assert.deepEqual(songWindowStarts(30 * RATE, RATE), [0]);
  for (const seconds of [61, 180, 300, 900]) {
    const frames = seconds * RATE, starts = songWindowStarts(frames, RATE);
    assert.ok(starts.length <= SONG_MERGE_POLICY.maxWindows, String(starts.length));
    assert.equal(starts[0], 0); assert.equal(starts.at(-1), frames - size, 'last window ends at the song end');
    if (seconds <= 500) for (let i = 1; i < starts.length; i++) assert.ok(starts[i]! - starts[i - 1]! <= size, 'no gap between windows');
  }
});

test('LR4 three-band split sums flat (160 Hz / 3.5 kHz) and each band crosses at -6 dB', () => {
  assert.equal(EQ_SPLIT.lowMidHz, 160); assert.equal(EQ_SPLIT.midHighHz, 3500);
  for (let hz = 20; hz <= 20000; hz *= 1.05) {
    const db = magnitudeDb(threeBandResponse(hz, RATE));
    assert.ok(Math.abs(db) < 0.01, `${hz.toFixed(0)} Hz: ${db} dB`);
  }
  const low = magnitudeDb(threeBandResponse(160, RATE, {low: 1, mid: 0, high: 0}));
  const high = magnitudeDb(threeBandResponse(3500, RATE, {low: 0, mid: 0, high: 1}));
  assert.ok(Math.abs(low + 6.02) < 0.3 && Math.abs(high + 6.02) < 0.3, `${low} ${high}`);
  // The time-domain splitter (used by the offline evaluator) also reconstructs a signal at unity gains.
  const split = new ThreeBandSplitter(RATE), impulse: number[] = [];
  for (let n = 0; n < 8192; n++) { const [l, m, h] = split.next(n === 0 ? 1 : 0); impulse.push(l + m + h); }
  let energy = 0; for (const v of impulse) energy += v * v;
  assert.ok(Math.abs(energy - 1) < 1e-3, 'all-pass: unit impulse energy preserved ' + energy);
});

test('tone-dissolve: B lows near -18 dB, equal-power smoothstep swap ending 20 ms before the downbeat', () => {
  const bar = Math.round(4 * 60 / 126 * RATE);
  for (const swapMs of [100, 380, 750]) for (const overlapBars of [8, 16, 32]) {
    const plan = choreographyPlan({name: 'tone-dissolve', overlapBars, swapMs}, bar, RATE);
    const downbeat = plan.bassOwnershipFrame, end = downbeat - Math.round(RATE * CHOREOGRAPHY_LIMITS.swapLeadMs / 1000);
    const start = end - Math.round(RATE * swapMs / 1000);
    assert.equal(downbeat % bar, 0, 'ownership on a downbeat'); assert.equal(plan.durationFrames, overlapBars * bar);
    const bLow = plan.incoming.bands.low, aLow = plan.outgoing.bands.low;
    assert.ok(Math.abs(20 * Math.log10(lane(bLow, 0)) - CHOREOGRAPHY_LIMITS.incomingLowDb) < 0.01, 'B lows start at -18 dB');
    assert.ok(Math.abs(20 * Math.log10(lane(bLow, start)) + 18) < 0.01, 'still -18 dB at the swap start');
    assert.equal(lane(bLow, end), 1, 'B owns the bass 20 ms before the downbeat'); assert.ok(lane(aLow, end) < 0.13);
    const mid = Math.round((start + end) / 2);
    const power = lane(aLow, mid) ** 2 + lane(bLow, mid) ** 2;
    assert.ok(Math.abs(power - 1) < 0.02, `equal power at the swap midpoint: ${power}`);
    assert.ok(Math.abs(smoothstep(0.5) - 0.5) < 1e-12);
  }
  assert.throws(() => choreographyPlan({name: 'tone-dissolve', overlapBars: 16, swapMs: 99}, bar, RATE), /100..750/);
  assert.throws(() => choreographyPlan({name: 'tone-dissolve', overlapBars: 16, swapMs: 751}, bar, RATE), /100..750/);
});

test('bass-drop-handover: a declared 1, 2 or 4 bar bass gap ending on the phrase downbeat', () => {
  const bar = Math.round(4 * 60 / 128 * RATE);
  for (const gapBars of [1, 2, 4] as const) {
    const plan = choreographyPlan({name: 'bass-drop-handover', overlapBars: 16, swapMs: 380, gapBars}, bar, RATE);
    const bassIn = (gapBars === 4 ? 8 : 4) * bar, kill = bassIn - gapBars * bar;
    assert.deepEqual(plan.declaredGaps, [{band: 'low', startFrame: kill, endFrame: bassIn}]);
    assert.equal(plan.bassOwnershipFrame, bassIn);
    assert.equal(lane(plan.outgoing.bands.low, kill), 0, 'A bass is gone at the bar line');
    assert.equal(lane(plan.outgoing.bands.low, kill - Math.round(RATE * 0.013)), 1, 'held until the 12 ms kill ramp');
    for (const f of [0, kill, Math.round((kill + bassIn) / 2), bassIn]) assert.equal(lane(plan.incoming.bands.low, f), 0, 'no B bass before the downbeat');
    assert.equal(lane(plan.incoming.bands.low, bassIn + Math.round(RATE * 0.012)), 1);
    assert.ok(lane(plan.outgoing.bands.high, (kill + bassIn) / 2) === 1, 'highs keep the groove through the gap');
  }
  assert.throws(() => choreographyPlan({name: 'bass-drop-handover', overlapBars: 16, swapMs: 380, gapBars: 3 as 1}, bar, RATE), /1, 2 or 4/);
  // The other choreographies build valid lanes too.
  for (const name of ['bass-swap-classic', 'highs-first', 'mid-carve'] as const) {
    const plan = choreographyPlan({name, overlapBars: 16, swapMs: 380}, bar, RATE);
    assert.equal(plan.declaredGaps.length, 0); assert.ok(plan.description.length > 10);
  }
});

test('choreography is chosen from pair features and style, not always the smoothest', () => {
  const base: PairFeatures = {densityA: 0.5, densityB: 0.5, harmonic: 0.9, bpm: 126, maxOverlapSeconds: 26};
  assert.equal(chooseChoreography({...base, harmonic: null}).params.name, 'mid-carve');
  assert.ok(chooseChoreography({...base, harmonic: null}).harmonicLimited);
  assert.equal(chooseChoreography({...base, harmonic: 0.5, densityA: 0.8}).params.name, 'bass-drop-handover');
  assert.equal(chooseChoreography({...base, densityA: 0.8, densityB: 0.8}).params.name, 'bass-drop-handover');
  assert.equal(chooseChoreography({...base, style: 'energetic'}).params.name, 'bass-drop-handover');
  assert.equal(chooseChoreography({...base, densityA: 0.2, densityB: 0.2}).params.name, 'tone-dissolve');
  assert.equal(chooseChoreography({...base, densityA: 0.5, densityB: 0.2}).params.name, 'highs-first');
  assert.equal(chooseChoreography({...base, harmonic: 1, densityA: 0.4, densityB: 0.4}).params.name, 'bass-swap-classic');
  // The bounded render budget shortens long dissolves.
  const short = chooseChoreography({...base, densityA: 0.2, densityB: 0.2, maxOverlapSeconds: 20});
  assert.ok(short.params.overlapBars * 240 / 126 <= 20 && short.reasons.some(r => /shortened/.test(r)));
});

test('route-free safety net: echo reset ends on the downbeat; a clean cut only when no echo fits', () => {
  const rate = 16000, frames = 60 * rate, exit = 16 * 4 * 60 * rate / 90;
  const echo = planRouteFreeTransition({grid: requestedGrid(90), frames}, {grid: requestedGrid(128), frames}, exit, rate);
  assert.ok(echo.kind === 'route-free' && echo.recipe === 'fallback-echo-reset');
  assert.equal(echo.fromExitFrame, exit);
  const hp = echo.automation.outgoing.highPassHz!;
  assert.ok(hp.at(-1)!.value >= 400 && hp[0]!.value <= 20, 'A is high-passed during the pre-roll');
  assert.ok(echo.automation.incoming.gain[0]!.value === 0);
  const noCut = planRouteFreeTransition({grid: requestedGrid(90), frames}, {grid: requestedGrid(128), frames}, exit, rate,
    {exclude: ['fallback-echo-reset'], allowCut: false});
  assert.equal(noCut.kind, 'unavailable');
});

test('smoothstep tempo return keeps the linear frame total and maps monotonically', () => {
  const lin: TimePitchMapping = {inputFrames: 0, outputFrames: 0, tempoRatio: 0.95, pitchSemitones: 0,
    returnToOriginal: {afterFrames: 48000, rampFrames: 96000, curve: 'linear'}};
  const ss: TimePitchMapping = {...lin, returnToOriginal: {...lin.returnToOriginal!, curve: 'smoothstep'}};
  const big = {...lin, inputFrames: 10 ** 7, outputFrames: 10 ** 7}, bigS = {...ss, inputFrames: 10 ** 7, outputFrames: 10 ** 7};
  assert.equal(sourceFrameAtOutput(bigS, 48000 + 96000), sourceFrameAtOutput(big, 48000 + 96000), 'same total at the ramp end');
  assert.equal(sourceFrameAtOutput(bigS, 400000), sourceFrameAtOutput(big, 400000));
  let previous = -1;
  for (let out = 0; out <= 200000; out += 997) {
    const input = sourceFrameAtOutput(bigS, out);
    assert.ok(input >= previous, 'monotonic'); previous = input;
    assert.ok(Math.abs(outputFrameAtSource(bigS, input) - out) <= 1, 'inverse round trip');
  }
});

test('seeded explore: same seed, same plan; bounded; weak harmony limits the choreography', () => {
  const features: PairFeatures = {densityA: 0.4, densityB: 0.4, harmonic: 0.95, bpm: 124, maxOverlapSeconds: 60};
  assert.deepEqual(exploreChoice(42, features, 5), exploreChoice(42, features, 5));
  const seen = new Set<string>();
  for (let seed = 0; seed < 200; seed++) {
    const c = exploreChoice(seed, features, 5);
    seen.add(c.choreography.name);
    assert.ok(c.choreography.swapMs >= EXPLORE_BOUNDS.swapMs.min && c.choreography.swapMs <= EXPLORE_BOUNDS.swapMs.max);
    assert.ok(c.entryIndex >= 0 && c.entryIndex < EXPLORE_BOUNDS.entryTop);
    assert.ok(c.meetFraction >= EXPLORE_BOUNDS.meetFraction.min && c.meetFraction <= EXPLORE_BOUNDS.meetFraction.max);
    choreographyPlan(c.choreography, Math.round(240 / 124 * RATE), RATE);
    const weak = exploreChoice(seed, {...features, harmonic: null}, 5);
    assert.ok(['mid-carve', 'bass-drop-handover'].includes(weak.choreography.name));
  }
  assert.equal(seen.size, 5, 'all five choreographies are reachable');
  assert.throws(() => exploreChoice(-1, features, 1), /seed/);
});

function record(overrides: Partial<Omit<TransitionPlanRecord, 'id' | 'version'>> = {}): TransitionPlanRecord {
  const choreography: ChoreographyParams = {name: 'tone-dissolve', overlapBars: 16, swapMs: 380};
  return makeTransitionPlanRecord({mode: 'explore', seed: 7,
    versions: {policy: 'transition-policy@1', planner: 'p', analysis: 'a', choreography: 'eq-choreography@1', safety: 'transition-safety@1'},
    from: {id: 'a', sha256: 'aa', bpm: 124, exitFrame: 480000, exitBar: 33},
    to: {id: 'b', sha256: 'bb', bpm: 126, entryFrame: 96000, entrySeconds: 2, skippedFraction: 0.01, entryRank: 0},
    sampleRate: RATE, tempo: {gap: 126 / 124 - 1, band: 'normal', meetBpm: null}, recipe: 'blend', choreography,
    overlapBars: 16, why: ['test'], rejected: [], ...overrides});
}

test('plan records are versioned and replayable; ratings stay attached to the exact plan', () => {
  const r = record();
  assert.equal(r.version, 'em.transition-plan.v1');
  assert.equal(record().id, r.id, 'same content, same id');
  assert.notEqual(record({seed: 8}).id, r.id);
  assert.equal(validateTransitionPlanRecord(JSON.parse(JSON.stringify(r))).id, r.id);
  assert.throws(() => validateTransitionPlanRecord({...r, to: {...r.to, entryFrame: 1}}), /does not match/);
  const replay = replayOverrides(r);
  assert.equal(replay.toEntryFrame, 96000); assert.deepEqual(replay.choreography, r.choreography);
  let log = rateTransition(emptyTransitionRatings(), r, 'love', '2026-11-16T00:00:00Z');
  log = rateTransition(log, r, 'like', '2026-11-16T00:01:00Z');
  assert.equal(log.entries.length, 1, 're-rating the same plan replaces its rating');
  assert.equal(log.entries[0]!.rating, 'like'); assert.equal(log.entries[0]!.plan.id, r.id);
  assert.equal(validateTransitionRatingLog(JSON.parse(JSON.stringify(log))).entries.length, 1);
  const detached = {...log, entries: [{...log.entries[0]!, planId: record({seed: 9}).id}]};
  assert.throws(() => validateTransitionRatingLog(detached), /detached/);
});

const okSafety: SafetyMeasurements = {samplePeak: 0.8, truePeakDbtp: -2, lowRiseDb: 1, bassHoleDb: -3, bassHoleJudged: true, declaredGapFrames: 0};
test('transition-safety@1 rejects clipping, true peak above -1 dBTP, a low rise over +3 dB and a bass hole', () => {
  assert.equal(TRANSITION_SAFETY_THRESHOLDS.version, 'transition-safety@1');
  assert.equal(judgeSafety(okSafety).verdict, 'pass');
  const flags = (m: Partial<SafetyMeasurements>) => judgeSafety({...okSafety, ...m}).flags.map(f => f.metric);
  assert.deepEqual(flags({samplePeak: 1.01}), ['clipping']);
  assert.deepEqual(flags({truePeakDbtp: -0.9}), ['truePeakCeiling']);
  assert.deepEqual(flags({truePeakDbtp: -1}), []);
  assert.deepEqual(flags({lowRiseDb: 3.2}), ['lowRise']);
  assert.deepEqual(flags({bassHoleDb: -16}), ['bassHole']);
  assert.deepEqual(flags({bassHoleDb: -16, bassHoleJudged: false}), [], 'unjudged recipes (cuts, echoes) never fail on bass holes');
});

/** A synthetic render: A and B are 60 Hz tones; the mix is shaped per case. */
function render(seconds: number, mixLow: (t: number) => number, opts: {aOff?: number} = {}): TransitionRender {
  const rate = 8000, n = seconds * rate, tone = (i: number) => Math.sin(2 * Math.PI * 60 * i / rate);
  const ch = (f: (i: number) => number) => [Float64Array.from({length: n}, (_, i) => f(i))];
  const aOff = opts.aOff ?? 0.5;
  const a = ch(i => i / n < aOff ? 0.5 * tone(i) : 0), b = ch(i => 0.5 * tone(i));
  return {sampleRate: rate, S: 0, T: 0, E: n, mix: ch(i => mixLow(i / n) * tone(i)), aOut: a, bOut: b, aNative: a, bNative: b, bSource: 'native'};
}
const spec = (recipe: string, gaps: {band: 'low'; startFrame: number; endFrame: number}[] = []) =>
  ({recipe, automation: {outgoing: {}, incoming: {declaredGaps: gaps}}}) as unknown as TransitionSpec;

test('safety measurement: low-band rise and bass hole are sustained 250 ms checks; declared gaps are exempt', () => {
  // Doubled low end in the middle second: about +6 dB over the louder native source.
  const rise = measureSafety(render(4, t => t > 0.4 && t < 0.6 ? 1 : 0.5), spec('blend'), -3);
  assert.ok(rise.lowRiseDb! > 5, String(rise.lowRiseDb)); assert.equal(judgeSafety(rise).verdict, 'fail');
  // A 100 ms spike is shorter than the 250 ms window and is averaged down.
  const spike = measureSafety(render(4, t => t > 0.5 && t < 0.525 ? 1 : 0.5), spec('blend'), -3);
  assert.ok(spike.lowRiseDb! < 3, String(spike.lowRiseDb));
  // A one-second bass hole fails a smooth recipe...
  const holeRender = render(4, t => t > 0.4 && t < 0.65 ? 0.01 : 0.5);
  const hole = measureSafety(holeRender, spec('blend'), -3);
  assert.ok(hole.bassHoleDb! < -15, String(hole.bassHoleDb)); assert.ok(judgeSafety(hole).flags.some(f => f.metric === 'bassHole'));
  // ...is exempt when declared by the choreography...
  const n = holeRender.mix[0]!.length;
  const declared = measureSafety(holeRender, spec('blend', [{band: 'low', startFrame: Math.round(0.38 * n), endFrame: Math.round(0.67 * n)}]), -3);
  assert.ok(declared.bassHoleDb === null || declared.bassHoleDb > -15, String(declared.bassHoleDb));
  assert.ok(declared.declaredGapFrames > 0); assert.equal(judgeSafety(declared).verdict, 'pass');
  // ...and is not judged for a cut.
  const cut = measureSafety(holeRender, spec('cut'), -3);
  assert.equal(cut.bassHoleJudged, false); assert.equal(cut.bassHoleDb, null);
  // Clipping is measured from the rendered samples.
  assert.equal(judgeSafety(measureSafety(render(2, () => 1.2), spec('cut'), 0.5)).flags.map(f => f.metric).sort().join(), 'clipping,lowRise,truePeakCeiling');
});

// ---------------------------------------------------------------------------------------------
// Review fixes (findings 1, 3, 4, 6, 7)
// ---------------------------------------------------------------------------------------------
const SR = 16000;
const fakeAsset = (id: string, bpm: number, frames: number) =>
  ({id, file: {sample_rate: SR, frames, sha256: id}, timing: {bpm, first_downbeat_frame: 0}}) as unknown as AudioAsset;
const song = (bpm: number, bars: number, tonic = 9) => makeSetFixture({id: 's', bpm, bars, tonic, mode: 'minor', transitionEvidence: true});

test('finding 1: a rejected parameterisation excludes itself, not its recipe family', () => {
  const a = song(120, 56), b = song(124, 56), analysis = {from: analyzeMixAudio(a), to: analyzeMixAudio(b)};
  const input = (exclude: string[]) => ({from: {asset: fakeAsset('a', 120, a.channels[0]!.length), analysis: analysis.from, frames: a.channels[0]!.length},
    to: {asset: fakeAsset('b', 124, b.channels[0]!.length), analysis: analysis.to, frames: b.channels[0]!.length, channels: 1},
    sampleRate: SR, earliestFrame: 30 * SR, boundary: {bars: 4, anchorBar: 0}, exclude});
  const seen: string[] = [], blends: string[] = [];
  const exclude: string[] = [];
  for (let i = 0; i < 4; i++) {
    const choice = chooseSetTransition(input(exclude));
    if (choice.kind === 'unavailable') break;
    const sig = transitionSignature(choice.plan, choice.exitBar);
    assert.ok(!seen.includes(sig), `attempt ${i} repeated ${sig}`);
    seen.push(sig); exclude.push(sig);
    if (choice.plan.recipe === 'blend') blends.push(sig);
  }
  assert.ok(blends.length >= 2, `a second blend parameterisation is tried before leaving the family: ${seen.join(' , ')}`);
});

test('finding 3: explore never emits an overlap the planner refuses (a 4-bar gap needs 16 bars, not 12)', () => {
  const features: PairFeatures = {densityA: 0.4, densityB: 0.4, harmonic: 0.95, bpm: 124, maxOverlapSeconds: 60};
  let drops = 0, fours = 0;
  for (let seed = 0; seed < 400; seed++) for (const harmonic of [0.95, null]) {
    const c = exploreChoice(seed, {...features, harmonic}, 5).choreography;
    assert.ok((MIX_OVERLAP_BEATS as readonly number[]).includes(c.overlapBars * 4), `seed ${seed}: ${c.name} ${c.overlapBars} bars`);
    if (c.name === 'bass-drop-handover') { drops++; if (c.gapBars === 4) { fours++; assert.ok(c.overlapBars >= 16); } }
    choreographyPlan(c, Math.round(240 / 124 * RATE), RATE);
  }
  assert.ok(drops > 0 && fours > 0, 'bass drops with a 4-bar gap are still reachable');
  // Under a tight render budget the gap shrinks instead of the overlap overflowing it.
  for (let seed = 0; seed < 200; seed++) {
    const c = exploreChoice(seed, {...features, harmonic: null, maxOverlapSeconds: 17}, 5).choreography;
    if (c.name === 'bass-drop-handover') assert.ok(c.overlapBars * 240 / 124 <= 17 + 1e-9 && c.gapBars !== 4, `${c.overlapBars} ${c.gapBars}`);
  }
});

test('finding 4: route-free tries a later bar before settling for a clean cut', () => {
  // 120 -> 160 BPM has no crossfade. The requested bar sits exactly on the earliest effect frame, so the echo
  // reset (which needs its pre-roll before the exit) fits only on a later bar.
  const grid = requestedGrid(120, SR), frames = 200 * SR;
  const earliestFrame = Math.round(downbeatAt(grid, 4));
  const choice = chooseSetTransition({from: {asset: fakeAsset('a', 120, frames), analysis: null, frames},
    to: {asset: fakeAsset('b', 160, frames), analysis: null, frames, channels: 1}, sampleRate: SR, earliestFrame, boundary: {bars: 4, anchorBar: 0}});
  if (choice.kind !== 'route-free') assert.fail(choice.kind);
  assert.equal(choice.plan.recipe, 'fallback-echo-reset', 'not the clean cut');
  assert.ok(choice.exitBar > 4 && choice.exitBar <= 4 + ROUTE_FREE_LATER_BARS, String(choice.exitBar));
  assert.ok(choice.notes.some(n => /pre-roll/.test(n)));
});

test('finding 6: replanning a prepared mix keeps its choreography, meeting tempo and tempo return', () => {
  const a = song(100, 56), b = song(116, 56), analysis = {from: analyzeMixAudio(a), to: analyzeMixAudio(b)};
  const choreography: ChoreographyParams = {name: 'mid-carve', overlapBars: 8, swapMs: 380};
  const plan = planAutomaticMix(analysis.from, analysis.to, {recipe: 'meet-in-middle', harmonicMode: 'limited', choreography, meetBpm: 107.5,
    minimumFromFrame: 4 * SR, returnToOriginalTempo: true, tempoReturn: {bars: 4, curve: 'smoothstep'}});
  if (plan.kind !== 'mix') assert.fail(plan.reason);
  const ready = {kind: 'ready', plan, analysis} as unknown as ReadyMixTransition;
  const later = replanPreparedMix(ready, plan.fromExitFrame);
  if (later.kind !== 'mix') assert.fail(later.reason);
  assert.equal(later.recipe, 'meet-in-middle');
  assert.ok(Math.abs(later.meet!.bpm - 107.5) < 1e-9, String(later.meet?.bpm));
  assert.deepEqual(later.choreography!.params, choreography);
  assert.equal(later.overlapFrames, plan.overlapFrames);
  assert.equal(later.tempoReturn!.rampFrames, plan.tempoReturn!.rampFrames);
  assert.equal(later.tempoReturn!.curve, 'smoothstep');
  assert.ok(later.fromExitFrame >= plan.fromExitFrame);
});

test('finding 7: meet in the middle checks A\'s moved key, not its original key', () => {
  // Same key on both songs. A ramps 100 -> ~108 BPM (about +1.3 semitones), so the overlap is no longer same-key.
  const a = song(100, 56), b = song(116, 56), analysis = {from: analyzeMixAudio(a), to: analyzeMixAudio(b)};
  const base = {recipe: 'meet-in-middle' as const, harmonicMode: 'limited' as const, minimumFromFrame: 4 * SR, returnToOriginalTempo: true,
    tempoReturn: {bars: 4, curve: 'smoothstep' as const}};
  const plain = planAutomaticMix(analysis.from, analysis.to, base);
  assert.equal(plain.kind, 'fallback');
  assert.match(plain.kind === 'fallback' ? plain.reason : '', /weak or distant key needs a mid-limited choreography/);
  const carved = planAutomaticMix(analysis.from, analysis.to, {...base, choreography: {name: 'mid-carve', overlapBars: 8, swapMs: 380}});
  if (carved.kind !== 'mix') assert.fail(carved.reason);
  assert.ok(carved.reasons.some(r => /key check uses A shifted by 1/.test(r)), carved.reasons.join(' | '));
  assert.ok(carved.harmonic.score < 0.85);
  // A meeting point inside the detune tolerance (about 3% = 0.5 semitone is the worst case) cannot claim a relation either.
  assert.ok(MEET_LIMITS.maxDetuneSemitones <= 0.4);
});
