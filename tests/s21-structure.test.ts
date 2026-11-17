// EMF-S21 Part B: whole-song structure labels (mix-structure@1), structure-aware exits and entries,
// the tempo-agnostic dissolves before any clean cut, the cut gate, recipe claims and the readout text.
// Synthetic, original fixtures only. Engineering checks: none of this establishes how a handover sounds
// (listening NOT TESTED).
import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, type MixAnalysis, type MixPcm} from '../src/mix-analysis.js';
import {cleanCutAutomation} from '../src/mix-automation.js';
import {chooseSetTransition, downbeatAt, gridAlignedAnalysis, planRouteFreeTransition, routeFreeSignature, ROUTE_FREE_RETRY, setTransitionRecord,
  transitionSignature, type SetBarGrid, type SetTransitionChoice} from '../src/mix-transition.js';
import type {AudioAsset} from '../src/pack-types.js';
import type {DecodedRecording} from '../src/web-audio.js';
import {evaluateTransition, judgeTransition, recipeClaims, MIX_EVALUATION_THRESHOLDS, RECIPE_CLAIM_LIMITS, RECIPE_CLAIMS_VERSION,
  type TransitionMeasurements} from '../web/mix-evaluator.js';
import {makePrecheckWindow, PRECHECK_LIMITS, routeFreeJudgedAs, type PrecheckWindow} from '../web/mix-precheck-data.js';
import {handoverSentence, labelSongStructure, MIX_STRUCTURE_VERSION, structurePairTerm, type HandoverStructure,
  type SongSection, type SongStructure} from '../web/mix-structure.js';
import {validateTransitionPlanRecord} from '../web/transition-policy.js';
import {triedFirst} from '../web/set-mode.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';
import {makeSetFixture} from './helpers/synthetic-set.js';

const SR = 16000;
const fakeAsset = (id: string, bpm: number, frames: number) =>
  ({id, file: {sample_rate: SR, frames, sha256: id}, timing: {bpm, first_downbeat_frame: 0}}) as unknown as AudioAsset;
const requestedGrid = (bpm: number): SetBarGrid => ({source: 'requested', bpm, barFrames: 4 * 60 * SR / bpm, downbeats: [0]});

/** Original sectioned song: drums and chords at per-section levels (intro, build, drop, breakdown, drop, outro). */
const PLAN: readonly [bars: number, drums: number, chords: number][] = [[16, 0.25, 0.35], [8, 0.6, 0.6], [16, 1, 1], [8, 0.25, 0.35], [8, 1, 1], [8, 0.2, 0.3]];
function structuredSong(bpm: number): MixPcm {
  const bars = PLAN.reduce((n, p) => n + p[0], 0);
  const drums = makeMixFixture({bpm, bars, sampleRate: SR, chords: false}).channels[0]!;
  const chords = makeMixFixture({bpm, bars, sampleRate: SR, drums: false}).channels[0]!;
  const barFrames = 4 * 60 * SR / bpm, out = new Float32Array(drums.length);
  const levels: [number, number][] = PLAN.flatMap(([n, d, c]) => Array.from({length: n}, () => [d, c] as [number, number]));
  for (let i = 0; i < out.length; i++) {
    const [d, c] = levels[Math.min(levels.length - 1, Math.floor(i / barFrames))]!;
    out[i] = drums[i]! * d + chords[i]! * c;
  }
  return {sampleRate: SR, channels: [out]};
}
const section = (startBar: number, bars: number, label: SongSection['label'], energy: number, barFrames: number): SongSection =>
  ({startFrame: Math.round(startBar * barFrames), endFrame: Math.round((startBar + bars) * barFrames), startBar, bars, label, guess: label,
    energy, low: energy, vocal: 0.2, confidence: label ? 0.8 : 0.1});
const structureOf = (sections: SongSection[], medianEnergy = 0.5): SongStructure =>
  ({version: MIX_STRUCTURE_VERSION, partial: false, sections, medianEnergy, limitations: []});

let analysed: {pcm: MixPcm; analysis: MixAnalysis; structure: SongStructure} | null = null;
function analysedSong() {
  if (!analysed) {
    const pcm = structuredSong(120), analysis = analyzeMixAudio(pcm);
    analysed = {pcm, analysis, structure: labelSongStructure(analysis)!};
  }
  return analysed;
}

test('mix-structure@1 labels a synthetic structured song on phrase boundaries, deterministically', () => {
  const {analysis, structure} = analysedSong();
  assert.equal(structure.version, MIX_STRUCTURE_VERSION);
  assert.equal(structure.partial, false);
  const at = (bar: number) => structure.sections.find(s => s.startBar <= bar && bar < s.startBar + s.bars)!;
  // Every section starts on a four-bar phrase of the analysis downbeat index.
  for (const s of structure.sections) assert.equal(s.startBar % 4, 0, JSON.stringify(s));
  assert.equal(at(28).label, 'drop', JSON.stringify(structure.sections.map(s => [s.startBar, s.label, s.guess])));
  assert.equal(at(4).label ?? at(4).guess, 'intro');
  assert.equal(at(44).label ?? at(44).guess, 'breakdown');
  assert.equal(at(60).label ?? at(60).guess, 'outro');
  assert.ok(at(28).energy > at(44).energy && at(28).energy > at(4).energy);
  for (const s of structure.sections) assert.ok(s.confidence >= 0 && s.confidence <= 1 && (s.label === null || s.confidence >= 0.35));
  // Same input, same output (no randomness, no clock).
  assert.deepEqual(labelSongStructure(analysis), structure);
  assert.deepEqual(labelSongStructure(analyzeMixAudio(structuredSong(120))), structure);
});

test('a flat song gets no labels; too few bars gets no structure', () => {
  const flat = analyzeMixAudio(makeMixFixture({bpm: 120, bars: 32, sampleRate: SR}));
  const structure = labelSongStructure(flat);
  assert.ok(structure === null || structure.sections.every(s => s.label === null), JSON.stringify(structure?.sections));
  assert.equal(labelSongStructure(analyzeMixAudio(makeMixFixture({bpm: 120, bars: 8, sampleRate: SR}))), null);
  assert.equal(labelSongStructure(null), null);
});

test('pair term: quiet exits and section-start entries with matched energy score higher; mid-build exits and B outros lose', () => {
  const bf = 4 * 60 * SR / 120;
  const a = structureOf([section(0, 16, 'drop', 0.9, bf), section(16, 8, 'build', 0.6, bf), section(24, 8, 'breakdown', 0.3, bf), section(32, 8, 'outro', 0.2, bf)]);
  const b = structureOf([section(0, 8, 'intro', 0.3, bf), section(8, 16, 'drop', 0.9, bf), section(24, 8, 'outro', 0.2, bf)]);
  const term = (outBar: number, inBar: number) => structurePairTerm({analysis: null, structure: a}, {analysis: null, structure: b},
    Math.round(outBar * bf), Math.round(inBar * bf), 2 * bf, bf).score;
  assert.ok(term(32, 0) > term(20, 0), 'leaving at the end of the breakdown beats leaving mid-build');
  assert.ok(term(32, 0) > term(32, 8), 'a quiet exit matches B\'s quiet intro better than its drop');
  assert.ok(term(8, 8) > term(8, 0), 'a high exit matches B\'s drop');
  assert.ok(term(32, 24) < term(32, 0), 'B\'s outro is never a good entry');
});

test('Part B exits: the end of a quiet A section between the requested boundaries is tried first', () => {
  const bf = 4 * 60 * SR / 120, frames = 200 * SR;
  const fromStructure = structureOf([section(0, 6, 'drop', 0.9, bf), section(6, 10, 'breakdown', 0.3, bf), section(16, 16, 'drop', 0.9, bf)]);
  const input = {from: {asset: fakeAsset('a', 120, frames), analysis: null, frames, structure: structureOf([section(0, 4, 'drop', 0.9, bf), section(4, 2, 'breakdown', 0.3, bf), section(6, 26, 'drop', 0.9, bf)])},
    to: {asset: fakeAsset('b', 150, frames), analysis: null, frames, channels: 1}, sampleRate: SR,
    earliestFrame: Math.round(downbeatAt(requestedGrid(120), 3)), boundary: {bars: 4, anchorBar: 0}};
  // A breakdown ending on bar 6 (between boundary bars 4 and 8) is the exit; it was not requested directly.
  const choice = chooseSetTransition(input);
  assert.ok(choice.kind === 'route-free', choice.kind);
  assert.equal(choice.exitBar, 6, JSON.stringify(choice.notes));
  assert.ok(choice.notes.some(n => /ends a quiet A section/.test(n)));
  assert.equal(choice.structure?.exit.label, 'breakdown');
  // Without a quiet section end in the window, the requested boundary stays.
  const plain = chooseSetTransition({...input, from: {...input.from, structure: fromStructure}});
  assert.ok(plain.kind === 'route-free' && plain.exitBar === 4, plain.kind);
});

test('+22% gap on a requested A grid: echo reset, then every dissolve length, then the gated cut, each listed in rejected[]', () => {
  // The live case: A on its requested grid at about 81.8 BPM, B measured at 100 BPM (+22.3%).
  const b = structuredSong(100), bAnalysis = analyzeMixAudio(b), aFrames = 180 * SR, bFrames = b.channels[0]!.length;
  const input = (exclude: string[]) => ({from: {asset: fakeAsset('a', 81.77, aFrames), analysis: null, frames: aFrames},
    to: {asset: fakeAsset('hazy', 100, bFrames), analysis: bAnalysis, frames: bFrames, channels: 1}, sampleRate: SR,
    earliestFrame: Math.round(downbeatAt(requestedGrid(81.77), 7)), boundary: {bars: 4, anchorBar: 0}, exclude});
  const exclude: string[] = [], tried: string[] = [];
  let choice: SetTransitionChoice = chooseSetTransition(input(exclude));
  // Emulates the player: every candidate fails its pre-check until only the cut is left.
  for (let i = 0; i < 12 && choice.kind !== 'unavailable' && !/cut/.test(choice.plan.recipe); i++) {
    tried.push(choice.plan.recipe);
    exclude.push(transitionSignature(choice.plan, choice.exitBar));
    choice = chooseSetTransition(input(exclude));
  }
  assert.ok(choice.kind === 'route-free' && choice.plan.recipe === 'fallback-cut', choice.kind);
  assert.equal(tried[0], 'fallback-echo-reset');
  assert.equal(tried.filter(r => r === 'fallback-filter-dissolve').length, 2, tried.join());
  assert.equal(tried.filter(r => r === 'fallback-tone-dissolve').length, 2, tried.join());
  assert.equal(tried.filter(r => r === 'fallback-echo-reset').length, ROUTE_FREE_RETRY.echoBars, 'the echo reset is retried at one more bar');
  assert.ok(tried.length + 1 <= 10, 'the chain fits the player attempt budget (SET_CANDIDATE_ATTEMPTS = 10)');
  // The cut sits on a four-bar phrase boundary.
  assert.equal(choice.exitBar % 4, 0);
  // Every route-free candidate passed over is in the plan record with its reason.
  const record = validateTransitionPlanRecord(setTransitionRecord(choice, {id: 'a', sha256: 'a'.repeat(64)},
    {id: 'hazy', sha256: 'b'.repeat(64), frames: bFrames}, SR, 'explore', 7));
  for (const recipe of ['fallback-echo-reset', 'fallback-filter-dissolve', 'fallback-tone-dissolve']) {
    assert.ok(record.rejected.some(r => r.recipe === recipe && r.reason.length > 0), recipe);
  }
  assert.ok(record.why.some(line => /mix-structure@1/.test(line)), 'the readout names the structure heuristic');
});

test('route-free exclusion is per parameter: one FAIL never removes the echo reset at every bar', () => {
  const frames = 60 * SR, exit = 16 * 4 * 60 * SR / 90, a = {grid: requestedGrid(90), frames}, b = {grid: requestedGrid(128), frames};
  const echo = planRouteFreeTransition(a, b, exit, SR);
  assert.ok(echo.kind === 'route-free' && echo.recipe === 'fallback-echo-reset');
  const failed = transitionSignature(echo, 16);
  assert.equal(failed, routeFreeSignature('fallback-echo-reset', 0, exit));
  const sameBar = planRouteFreeTransition(a, b, exit, SR, {exclude: [failed]});
  assert.ok(sameBar.kind === 'route-free' && sameBar.recipe === 'fallback-filter-dissolve');
  const otherBar = planRouteFreeTransition(a, b, exit + a.grid.barFrames, SR, {exclude: [failed]});
  assert.ok(otherBar.kind === 'route-free' && otherBar.recipe === 'fallback-echo-reset', 'still available at another bar');
  const twice = planRouteFreeTransition(a, b, exit + 2 * a.grid.barFrames, SR,
    {exclude: [failed, routeFreeSignature('fallback-echo-reset', 0, exit + a.grid.barFrames)]});
  assert.ok(twice.kind === 'route-free' && twice.recipe !== 'fallback-echo-reset', 'bounded: two bars at most');
  // A failed dissolve length is excluded at every bar; the other length is still tried.
  const filter = sameBar as Extract<typeof sameBar, {kind: 'route-free'}>;
  const shorter = planRouteFreeTransition(a, b, exit + 4 * a.grid.barFrames, SR, {exclude: ["fallback-echo-reset", transitionSignature(filter, 16)]});
  assert.ok(shorter.kind === 'route-free' && shorter.recipe === 'fallback-filter-dissolve' && shorter.bars < filter.bars);
});

test('the cut gate: a clean cut only on a phrase boundary at a low-energy A exit', () => {
  const bf = 4 * 60 * SR / 120, frames = 200 * SR, all = ['fallback-echo-reset', 'fallback-filter-dissolve', 'fallback-tone-dissolve'];
  // A is loud until bar 12, then a breakdown to bar 16: the cut moves to bar 16 (end of the breakdown), not bar 8 or 12.
  const structure = structureOf([section(0, 12, 'drop', 0.9, bf), section(12, 4, 'breakdown', 0.3, bf), section(16, 16, 'drop', 0.9, bf)], 0.6);
  const choice = chooseSetTransition({from: {asset: fakeAsset('a', 120, frames), analysis: null, frames, structure},
    to: {asset: fakeAsset('b', 150, frames), analysis: null, frames, channels: 1}, sampleRate: SR,
    earliestFrame: Math.round(downbeatAt(requestedGrid(120), 7)), boundary: {bars: 4, anchorBar: 0}, exclude: all});
  assert.ok(choice.kind === 'route-free' && choice.plan.recipe === 'fallback-cut', choice.kind);
  assert.equal(choice.exitBar, 16, JSON.stringify(choice.notes));
  assert.ok(choice.notes.some(n => /phrase boundary after A's breakdown/.test(n)), JSON.stringify(choice.notes));
  for (const recipe of all) assert.ok(choice.rejected?.some(r => r.recipe === recipe), recipe);
});

test('recipe claims: native entries judge only B\'s entry beat; an echo\'s dip is logged, not failed; limits unchanged', () => {
  assert.deepEqual(MIX_EVALUATION_THRESHOLDS.loudnessLu, {warn: 1, fail: 3});
  assert.deepEqual(MIX_EVALUATION_THRESHOLDS.beatPhase, {warn: 0.05, fail: 0.10});
  assert.deepEqual(recipeClaims('blend'), {beatLocked: true, loudness: 'crossfade'});
  assert.deepEqual(recipeClaims('cut'), {beatLocked: false, loudness: 'crossfade'});
  assert.deepEqual(recipeClaims('echo-out'), {beatLocked: false, loudness: 'dip', maxDipLu: 6});
  assert.equal(routeFreeJudgedAs('fallback-filter-dissolve'), 'echo-out');
  assert.equal(routeFreeJudgedAs('fallback-tone-dissolve'), 'echo-out');
  assert.equal(routeFreeJudgedAs('fallback-echo-reset'), 'echo-out');
  assert.equal(routeFreeJudgedAs('fallback-cut'), 'cut');
  assert.equal(routeFreeJudgedAs('fallback-crossfade'), 'blend');
  const m = (down: number): TransitionMeasurements => ({truePeakDbtp: -6,
    loudness: {momentaryMaxUpLu: 0.2, momentaryMaxDownLu: -down, shortTermMaxUpLu: 0.1, shortTermMaxDownLu: -down},
    lowBuildUp: {maxDb: null, band: null}, beatPhase: {maxError: null, meanError: null, beats: 0, judged: false, reason: 'x'},
    boundaryFlux: {excessDb: null, atFrame: null, judged: false}, sampleJumpRatio: 1, silenceGapMs: 0, stereoCorrelation: null});
  const echo = judgeTransition('echo-out', m(3.3)), blend = judgeTransition('blend', m(3.3));
  assert.equal(echo.verdict, 'pass'); assert.equal(echo.claims, RECIPE_CLAIMS_VERSION);
  assert.equal(echo.unclaimed?.[0]?.metric, 'loudness'); assert.equal(echo.unclaimed?.[0]?.level, 'fail');
  assert.equal(blend.verdict, 'fail', 'the same dip still fails a blend');
  assert.equal(judgeTransition('echo-out', {...m(0), loudness: {...m(0).loudness, shortTermMaxUpLu: 3.4}}).verdict, 'fail', 'a rise is still judged');
  assert.equal(judgeTransition('echo-out', {...m(0), silenceGapMs: 300}).verdict, 'fail', 'a real dropout is still judged');

  // Beat phase: a cut from 100 into 122.3 BPM. B's second beat falls inside A's 1.01-beat window; only the entry beat is judged.
  const rate = 8000, len = 12 * rate, noise = (seed: number) => { let s = seed; return Float32Array.from({length: len}, () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return 0.05 * (s / 2 ** 32 - 0.5); }); };
  const grid = (bpm: number) => Array.from({length: Math.floor(12 * bpm / 60)}, (_, n) => Math.round(n * 60 * rate / bpm));
  const analysis = (bpm: number) => ({tempo: {bpm}, beatGrid: {source: 'measured', frames: grid(bpm)}}) as unknown as MixAnalysis;
  const cutSpec = {recipe: 'cut' as const, fromStartFrame: 6 * rate, toEntryFrame: 0, preRollFrames: 0, tempoRatio: 1,
    automation: cleanCutAutomation(rate)};
  const result = evaluateTransition({sampleRate: rate, channels: [noise(1)]}, {sampleRate: rate, channels: [noise(2)]}, cutSpec as never,
    {from: analysis(100), to: analysis(122.3)});
  assert.equal(result.measurements?.beatPhase.beats, 1, JSON.stringify(result.flags));
  assert.ok((result.measurements?.beatPhase.maxError ?? 1) < 0.05, 'B enters on A\'s beat');
});

test('readout: handover sentence and the short "Tried first" list', () => {
  const h: HandoverStructure = {version: MIX_STRUCTURE_VERSION,
    exit: {bar: 33, label: 'breakdown', at: 'in', analysed: true, partial: false},
    entry: {bar: 17, label: 'drop', ordinal: 1, sectionStart: true, analysed: true}};
  assert.equal(handoverSentence(h, 'Hazy Harbor'), 'leaves in the breakdown at bar 33, enters Hazy Harbor at its first drop (bar 17)');
  assert.equal(handoverSentence({...h, exit: {...h.exit, analysed: false}, entry: {...h.entry, label: null}}),
    'leaves at bar 33 (no structure analysis for A), enters at bar 17 (section unlabeled)');
  const summary = {set: {transition: {rejected: [{recipe: 'fallback-echo-reset:b0:at1234', reason: 'DJ plan check FAIL: loudness fail.'},
    {recipe: 'echo-out', reason: 'Echo-out needs measured rhythm evidence on both songs.'}]}}} as never;
  const text = triedFirst(summary);
  assert.match(text, /^Tried first: /);
  assert.match(text, /check FAIL: loudness fail/);
  assert.ok(text.length <= 240);
  assert.equal(triedFirst({set: {transition: {rejected: []}}} as never), '');
});

test('pre-check window for a dissolve is judged as a non-beat-locked native recipe', () => {
  const rate = 8000, frames = 20 * rate;
  const buffer = (channels: Float32Array[]): AudioBuffer => ({sampleRate: rate, length: channels[0]!.length, numberOfChannels: channels.length,
    getChannelData: (i: number) => channels[i]!, duration: channels[0]!.length / rate}) as AudioBuffer;
  const rec = (id: string, fill: number): DecodedRecording => ({asset: {id, source_kind: 'recording', file: {sha256: id.repeat(64), frames, sample_rate: rate, channels: 1},
    timing: {bpm: 120, meter: [4, 4]}} as unknown as AudioAsset, buffer: buffer([Float32Array.from({length: frames}, (_, n) => fill * Math.sin(n / 7))])});
  const from = rec('a', 0.2), to = rec('b', 0.2);
  const plan = planRouteFreeTransition({grid: {source: 'requested', bpm: 120, barFrames: 2 * rate, downbeats: [0]}, frames},
    {grid: {source: 'requested', bpm: 150, barFrames: 1.6 * rate, downbeats: [0]}, frames}, 8 * rate, rate, {exclude: ['fallback-echo-reset']});
  assert.ok(plan.kind === 'route-free' && plan.recipe === 'fallback-filter-dissolve');
  const window: PrecheckWindow = makePrecheckWindow({plan, from, to, incoming: to, entryFrame: plan.toEntryFrame, fromGain: 1, analysis: {from: null, to: null}});
  assert.equal(window.job.spec.recipe, 'echo-out');
  assert.ok(window.job.streams.reduce((n, s) => n + s.frames * s.channels, 0) <= PRECHECK_LIMITS.inputSamples);
});

test('recipe claims bound the declared dip: a hole deeper than 6 LU still fails an echo', () => {
  const m = (down: number): TransitionMeasurements => ({truePeakDbtp: -6,
    loudness: {momentaryMaxUpLu: 0, momentaryMaxDownLu: -down, shortTermMaxUpLu: 0, shortTermMaxDownLu: -down},
    lowBuildUp: {maxDb: null, band: null}, beatPhase: {maxError: null, meanError: null, beats: 0, judged: false, reason: 'x'},
    boundaryFlux: {excessDb: null, atFrame: null, judged: false}, sampleJumpRatio: 1, silenceGapMs: 0, stereoCorrelation: null});
  assert.equal(RECIPE_CLAIM_LIMITS.echoMaxDipLu, 6);
  assert.equal(judgeTransition('echo-out', m(5.9)).verdict, 'pass');
  const hole = judgeTransition('echo-out', m(6.5));
  assert.equal(hole.verdict, 'fail'); assert.match(hole.flags[0]!.note!, /declared 6 LU/);
});

test('+22.3% on a requested A grid: the echo reset now passes its own pre-check (its 3.3 LU dip is logged, not failed)', () => {
  const a = makeSetFixture({id: 'a', bpm: 81.77, bars: 64, transitionEvidence: true});
  const b = makeSetFixture({id: 'b', bpm: 100, bars: 64, tonic: 2, transitionEvidence: true});
  const bAnalysis = analyzeMixAudio(b), fa = a.channels[0]!.length, fb = b.channels[0]!.length;
  const buffer = (ch: Float32Array[]): AudioBuffer => ({sampleRate: SR, length: ch[0]!.length, numberOfChannels: ch.length,
    getChannelData: (i: number) => ch[i]!, duration: ch[0]!.length / SR}) as AudioBuffer;
  const asset = (id: string, bpm: number, frames: number) => ({id, source_kind: 'recording', file: {sample_rate: SR, frames, sha256: id.repeat(64), channels: 1},
    timing: {bpm, first_downbeat_frame: 0, meter: [4, 4]}}) as unknown as AudioAsset;
  const recA: DecodedRecording = {asset: asset('a', 81.77, fa), buffer: buffer(a.channels as Float32Array[])};
  const recB: DecodedRecording = {asset: asset('b', 100, fb), buffer: buffer(b.channels as Float32Array[])};
  const choice = chooseSetTransition({from: {asset: recA.asset, analysis: null, frames: fa}, to: {asset: recB.asset, analysis: bAnalysis, frames: fb, channels: 1},
    sampleRate: SR, earliestFrame: Math.round(downbeatAt(requestedGrid(81.77), 15)), boundary: {bars: 4, anchorBar: 0}});
  assert.ok(choice.kind === 'route-free' && choice.plan.recipe === 'fallback-echo-reset', choice.kind);
  const window = makePrecheckWindow({plan: choice.plan, from: recA, to: recB, incoming: recB, entryFrame: choice.plan.toEntryFrame, fromGain: 1,
    analysis: {from: null, to: gridAlignedAnalysis(bAnalysis, choice.toGrid)}});
  const input = new Map<string, MixPcm>();
  for (const stream of window.job.streams) {
    const channels = Array.from({length: stream.channels}, () => new Float32Array(stream.frames));
    for (let start = 0; start < stream.frames;) {
      const count = Math.min(stream.frames - start, Math.floor(PRECHECK_LIMITS.chunkSamples / stream.channels));
      window.copy(stream.name, start, count).forEach((copy, c) => channels[c]!.set(copy, start)); start += count;
    }
    input.set(stream.name, {sampleRate: window.job.rate, channels});
  }
  const ev = evaluateTransition(input.get('from')!, input.get('to')!, window.job.spec, window.job.analysis);
  assert.notEqual(ev.verdict, 'fail', JSON.stringify(ev.flags));
  assert.notEqual(ev.safety?.verdict, 'fail');
  const dip = ev.unclaimed?.find(f => f.metric === 'loudness');
  assert.ok(dip && dip.value! > MIX_EVALUATION_THRESHOLDS.loudnessLu.fail && dip.value! < RECIPE_CLAIM_LIMITS.echoMaxDipLu,
    'thresholds@1 alone would have failed this dip (the live clean-cut cause); it is logged beside the verdict');
});
