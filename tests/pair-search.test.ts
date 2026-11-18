/**
 * Transition engine increment 3 (pair-search@1): candidate generator, stage-1 model, anytime search, ladder and the
 * player wiring (design 9 row 3). The search unit tests use a fake check; the player tests use original synthetic
 * songs (never owner audio) with the real analysis/planner/render path and an injected pre-check runtime, so they
 * count renders and checks exactly. Engineering evidence only: nothing here is listened to.
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test, {after, before} from 'node:test';
import {loadBrowserPack} from '../src/browser-pack.js';
import {analyzeMixAudio, measureMixLevel, nativeSamplePeak} from '../src/mix-analysis.js';
import type {MixPreparationRuntime} from '../src/mix-transition.js';
import {SmallPlayer} from '../src/player.js';
import {renderFiniteLoop, renderTimePitch} from '../src/time-pitch.js';
import type {CandidateSpec} from '../web/engine-candidates.js';
import {CANDIDATE_LIMITS} from '../web/engine-candidates.js';
import {DecisionJournal, isEngineRecord, PAIR_SEARCH_MODES} from '../web/engine-journal.js';
import {pickChecked, pickModelled} from '../web/engine-ladder.js';
import {ABSENT_MODEL_TERMS, type ModelScore} from '../web/engine-model.js';
import {buildTable, PAIR_SEARCH_LIMITS, PairSearch, type CheckOutcome, type ScoredCandidate} from '../web/engine-search.js';
import {PRECHECK_PROTOCOL, type PrecheckReport, type PrecheckRuntime} from '../web/mix-precheck-data.js';
import {validateTransitionPlanRecord} from '../web/transition-policy.js';
import {ContextDouble, NodeDouble, ParameterDouble} from './audio-double.js';
import {buildSyntheticSet, decodePcm16} from './helpers/synthetic-set.js';

// ---------- search unit tests (fake candidates, fake check) ----------
let serial = 0;
function spec(bar: number, kind: CandidateSpec['kind'] = 'route-free', recipe = 'crossfade'): CandidateSpec {
  const key = `${recipe}|x${bar}|e0|b4|${++serial}`;
  return {id: 'c-' + serial, key, kind, recipe, exit: {bar, frame: bar * 1000, section: 0, sectionEnd: false, phrase: true, cue: false},
    entry: {bar: 0, frame: 0, section: 0, sectionStart: true, skipCost: 0}, overlapBars: 4, lastRung: false,
    tempo: {strategy: 'native', stretch: 0}, beatLock: false} as unknown as CandidateSpec;
}
const model = (score: number): ModelScore => ({score, terms: {}, prior: 0, missing: [], absent: ABSENT_MODEL_TERMS} as unknown as ModelScore);
const pair = {fromId: 'a', toId: 'b', fromSha256: 'x', toSha256: 'y', versions: {}};
const instant = async (): Promise<void> => undefined;
function clock(step = 0) { let t = 0; return () => (t += step); }

test('pair search checks the top K per slot, nearest slot first, and records every render+check time', async () => {
  const scored = [0, 4].flatMap(bar => [0.9, 0.8, 0.7, 0.6, 0.5, 0.4].map(s => ({spec: spec(bar), model: model(s)})));
  const table = buildTable(pair, scored, scored.length);
  const order: number[] = [];
  const search = new PairSearch<string>(table, {
    check: async c => { order.push(c.spec.exit.bar); return {status: 'pass', reason: 'ok', prepared: c.spec.id, renderMs: 2, checkMs: 3}; },
    earliestFrame: () => 0, now: clock(1), pause: instant});
  await search.start();
  assert.equal(search.state, 'complete');
  for (const slot of table.slots) assert.equal(slot.ranked.filter(c => c.status === 'checked-pass').length, PAIR_SEARCH_LIMITS.k);
  assert.deepEqual(order, [0, 0, 0, 4, 4, 4], 'nearest slot first, K per slot');
  assert.equal(table.searched.rendered, 6);
  assert.equal(search.timings().length, 6, 'one timing per render+check');
  assert.ok(search.progress().medianCheckMs !== null);
  assert.deepEqual(table.slots[0]!.ranked[0]!.timing, {renderMs: 2, checkMs: 3});
});

test('a cut is never returned while budget remains and the slot still has an unrendered non-cut candidate', async () => {
  const cut = {spec: spec(0, 'cut', 'cut'), model: model(0.99)}, plain = {spec: spec(0), model: model(0.2)};
  const table = buildTable(pair, [cut, plain], 2);
  assert.equal(table.slots[0]!.ranked.at(-1)!.spec.kind, 'cut', 'cuts rank last whatever their model score');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const checkedKinds: string[] = [];
  const search = new PairSearch<string>(table, {
    check: async c => { checkedKinds.push(c.spec.kind); if (c.spec.kind !== 'cut') await gate; return {status: c.spec.kind === 'cut' ? 'pass' : 'fail', reason: 'x', prepared: 'p'}; },
    earliestFrame: () => 0, now: clock(0), pause: instant});
  const run = search.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  // Simulate a checked cut while the non-cut is still unrendered/in flight: it must not be offered.
  const slot = table.slots[0]!, cutRow = slot.ranked.find(c => c.spec.kind === 'cut')!;
  assert.deepEqual(checkedKinds, ['route-free'], 'non-cut candidates are rendered first');
  cutRow.status = 'checked-pass'; cutRow.final = 0.99;
  // The plain candidate is in flight (status still modelled): the cut is withheld.
  assert.equal(search.bestIn(slot, 0), null);
  assert.equal(pickChecked(search, {earliestFrame: 0, firstBar: 0, lastBar: 8}), null);
  assert.equal(pickModelled(search, {earliestFrame: 0, firstBar: 0, lastBar: 8})?.spec.kind, 'route-free', 'L1 never offers a cut');
  release(); await run;
  // Every non-cut was rendered (and failed): only now may the checked cut be returned.
  assert.equal(search.bestIn(slot, 0)?.spec.kind, 'cut');
});

test('when the budget runs out the search stops with a best-so-far table', async () => {
  const scored = [0.9, 0.8, 0.7].map(s => ({spec: spec(0), model: model(s)}));
  const table = buildTable(pair, scored, 3);
  const search = new PairSearch<string>(table, {check: async c => ({status: 'warn', reason: 'w', prepared: c.spec.id}),
    earliestFrame: () => 0, now: clock(PAIR_SEARCH_LIMITS.budgetMs / 2 + 1), pause: instant});
  await search.start();
  assert.equal(search.state, 'budget');
  assert.ok(table.slots[0]!.ranked.some(c => c.status === 'checked-warn'));
  assert.equal(search.budgetRemains, false);
  // WARN costs the configured penalty on the final score (passing is a floor, not the ranking).
  const best = search.bestIn(table.slots[0]!, 0)!;
  assert.equal(best.final, Math.round((best.model.score - PAIR_SEARCH_LIMITS.warnPenalty) * 1e4) / 1e4);
});

test('cancel stops at once and drops the kept audio; halt keeps it; refusals are not renders', async () => {
  const scored = [0.9, 0.8, 0.7, 0.6].map(s => ({spec: spec(0), model: model(s)}));
  const table = buildTable(pair, scored, 4);
  let calls = 0;
  const search = new PairSearch<string>(table, {
    check: async (c, signal) => {
      calls++;
      if (calls === 1) return {status: 'refused', reason: 'planner refused'};
      if (calls === 2) return {status: 'pass', reason: 'ok', prepared: c.spec.id, heavy: true};
      await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), {once: true}));
      return {status: 'pass', reason: 'never'};
    }, earliestFrame: () => 0, now: clock(0), pause: instant});
  const run = search.start();
  while (calls < 3) await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(table.searched.rendered, 1, 'the refusal made no render');
  const kept = table.slots[0]!.ranked.find(c => c.status === 'checked-pass')!;
  search.halt(); await run;
  assert.equal(search.state, 'cancelled');
  assert.equal(search.preparedFor(kept.spec.id), kept.spec.id, 'halt keeps the prepared audio for the handover');
  search.cancel();
  assert.equal(search.preparedFor(kept.spec.id), null, 'cancel drops it');
});

test('kept heavy buffers are capped, nearest slots first; light entries are always kept', async () => {
  const scored = [0, 4, 8, 12, 16, 20].map(bar => ({spec: spec(bar), model: model(0.5)}));
  const table = buildTable(pair, scored, scored.length);
  const search = new PairSearch<string>(table, {check: async c => ({status: 'pass', reason: 'ok', prepared: c.spec.id, heavy: c.spec.exit.bar !== 20} as CheckOutcome<string>),
    earliestFrame: () => 0, now: clock(0), pause: instant}, {...PAIR_SEARCH_LIMITS, keepSlots: 6} as unknown as typeof PAIR_SEARCH_LIMITS);
  await search.start();
  const kept = table.slots.filter(s => search.preparedFor(s.ranked[0]!.spec.id) !== null).map(s => s.exitBar);
  assert.deepEqual(kept, [0, 4, 8, 12, 20], `${PAIR_SEARCH_LIMITS.maxHeavy} heavy (nearest) plus the light one`);
});

test('journal is bounded and engine records validate', () => {
  const journal = new DecisionJournal(3);
  for (let i = 0; i < 5; i++) journal.add({at: 't', fromId: 'a', toId: 'b', kind: 'decision', text: String(i)});
  assert.deepEqual(journal.entries().map(e => e.text), ['2', '3', '4']);
  assert.deepEqual([...PAIR_SEARCH_MODES], ['off', 'shadow', 'live']);
  const record = {version: 'pair-search@1', mode: 'live', rung: 'L0', badge: 'checked', table: null, versions: {}, unsure: []};
  assert.ok(isEngineRecord(record));
  assert.ok(!isEngineRecord({...record, rung: 'L5'}));
  assert.ok(!isEngineRecord({...record, unsure: ['x'.repeat(241)]}));
});

// ---------- player wiring with original synthetic songs ----------
function audioBuffer(rate: number, channels: Float32Array[]): AudioBuffer {
  return {sampleRate: rate, length: channels[0]!.length, duration: channels[0]!.length / rate, numberOfChannels: channels.length,
    getChannelData: (i: number) => channels[i]!, copyToChannel: (source: Float32Array, i: number) => channels[i]!.set(source)} as AudioBuffer;
}
class FilterDouble extends NodeDouble {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new ParameterDouble(); readonly gain = new ParameterDouble(); readonly Q = new ParameterDouble();
}
class SetContext extends ContextDouble {
  constructor() { super(16000); }
  createBiquadFilter(): BiquadFilterNode { return new FilterDouble(this.audio) as unknown as BiquadFilterNode; }
  createBuffer(count: number, frames: number, rate: number): AudioBuffer { return audioBuffer(rate, Array.from({length: count}, () => new Float32Array(frames))); }
  override async decodeAudioData(input: ArrayBuffer): Promise<AudioBuffer> { const pcm = decodePcm16(new Uint8Array(input)); return audioBuffer(this.sampleRate, pcm.channels); }
}
function countingRuntime() {
  const calls = {render: 0, loop: 0};
  const runtime: MixPreparationRuntime = {
    analyze: async (from, to) => ({from: analyzeMixAudio(from), to: analyzeMixAudio(to)}),
    render: async (audio, options) => { calls.render++; return renderTimePitch(audio, options); },
    scanPeak: async audio => nativeSamplePeak(audio),
    renderLoop: async (audio, loop, tail, bars, gain) => { calls.loop++; return renderFiniteLoop(audio, loop, tail, bars, gain); },
    analyzeOne: async (audio, _signal, options, levelAudio) => ({...analyzeMixAudio(audio, options), level: measureMixLevel(levelAudio ?? audio)}),
  };
  return {runtime, calls};
}
function countingPrecheck() {
  const state = {calls: 0};
  const run: PrecheckRuntime = async () => {
    state.calls++;
    // Injected stand-in for the Worker pre-check (its own tests live elsewhere); PASS lets the table fill.
    return {version: PRECHECK_PROTOCOL, status: 'pass', reason: 'synthetic pass', evaluation: null, coverage: null} as PrecheckReport;
  };
  return {run, state};
}
let set: Awaited<ReturnType<typeof buildSyntheticSet>>;
// 64 bars at 120 BPM = 128 s each: more than 60 s of lead before the requested boundary.
before(async () => { set = await buildSyntheticSet([{id: 'ps-a', bpm: 120, bars: 64, tonic: 9}, {id: 'ps-b', bpm: 120, bars: 64, tonic: 4},
  {id: 'ps-c', bpm: 120, bars: 64, tonic: 2, mode: 'major'}]); });
after(async () => { await set?.cleanup(); });

async function setup(mode: 'off' | 'shadow' | 'live') {
  const fetcher = (async (input: string | URL | Request) => new Response(new Uint8Array(await readFile(
    join(set.out, ...decodeURIComponent(new URL(String(input)).pathname).slice(1).split('/')))))) as typeof fetch;
  const loaded = await loadBrowserPack(new URL('http://localhost/pack/manifest.json'), false, fetcher, {allowUnreviewed: true, set: true});
  const context = new SetContext(), {runtime, calls} = countingRuntime(), pre = countingPrecheck();
  const player = new SmallPlayer(context.audio, loaded, null, runtime, undefined, pre.run);
  player.setPairSearch(mode);
  const ids = ['ps-a', 'ps-b', 'ps-c'].map(id => set.idFor(id));
  await player.playAsset(ids[0]!); context.advance(0.5);
  return {context, player, ids, calls, pre, loaded};
}
async function until(cond: () => boolean, label: string, ms = 120_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out: ' + label);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('player: pair search is off by default and the record still names the ladder rung', async () => {
  const {player, ids, loaded} = await setup('off');
  try {
    assert.equal(new SmallPlayer(new SetContext().audio, loaded, null).pairSearch, 'off', 'the player default is off');
    player.preparePair(ids[1]!);
    assert.equal(player.pairPlanTable(), null, 'off mode starts no search');
    await player.scheduleMixTo(ids[1]!, {bars: 4, anchor: 'song'});
    const record = player.snapshot().mix!.summary!.set!.transition!;
    assert.ok(validateTransitionPlanRecord(record));
    assert.equal(record.engine!.mode, 'off'); assert.equal(record.engine!.table, null);
    assert.ok(['L2', 'L3'].includes(record.engine!.rung), record.engine!.rung);
    assert.equal(record.engine!.badge, 'fallback');
  } finally { await player.dispose(); }
});

test('player live: with 60 s of lead the table holds checked plans for the nearest slots and Next schedules from it with no new render', async () => {
  const {player, ids, calls, pre, context} = await setup('live');
  try {
    player.preparePair(ids[1]!);
    await until(() => player.pairSearchReadiness().phase === 'done', 'search finished');
    const table = player.pairPlanTable()!;
    assert.ok(table.searched.generated > 0 && table.searched.modelScored === table.searched.generated);
    // Generator coverage: every phrase boundary of A after the earliest feasible bar has a slot.
    const bars = table.slots.map(s => s.exitBar);
    for (let bar = bars[0]!; bar <= Math.min(bars.at(-1)!, bars[0]! + 16); bar += CANDIDATE_LIMITS.phraseBars)
      if (bar % CANDIDATE_LIMITS.phraseBars === 0) assert.ok(bars.includes(bar), `phrase bar ${bar} has a slot`);
    // Stage 1 invents nothing: the unsupported terms are marked absent and the learned prior is 0.
    const any = table.slots[0]!.ranked[0]!;
    assert.deepEqual([...any.model.absent], [...ABSENT_MODEL_TERMS]); assert.ok(!Object.keys(any.model.terms).some(k => /loudness|chroma|kick|prior/i.test(k))); assert.equal(any.model.prior, 0);
    // The nearest slots hold checked plans (60 s of lead, synthetic pass gate).
    const near = table.slots.slice(0, 3);
    for (const slot of near) assert.ok(slot.ranked.some(c => c.status === 'checked-pass'), `slot ${slot.exitBar} has a checked plan`);
    assert.ok(table.slots.some(s => s.ranked.some(c => c.status === 'checked-pass' && player.pairSearchKeeps(c.spec.id))), 'kept audio for Next');
    // Timing is recorded per render+check.
    const timed = table.slots.flatMap(s => s.ranked).filter(c => c.timing);
    assert.ok(timed.length > 0 && timed.every(c => c.timing!.renderMs >= 0 && c.timing!.checkMs >= 0));
    assert.ok(player.pairSearchReadiness().text.includes('checked plan'));
    const renders = calls.render + calls.loop, checks = pre.state.calls, sources = context.sources.length;
    await player.scheduleMixTo(ids[1]!, {bars: 4, anchor: 'song'});
    assert.equal(calls.render + calls.loop, renders, 'Next after the search rendered nothing new');
    assert.equal(pre.state.calls, checks, 'Next after the search ran no new pre-check');
    assert.ok(context.sources.length > sources, 'the handover was scheduled');
    const snap = player.snapshot(), record = snap.mix!.summary!.set!.transition!;
    assert.ok(validateTransitionPlanRecord(record));
    assert.equal(record.engine!.rung, 'L0'); assert.equal(record.engine!.badge, 'checked'); assert.equal(record.engine!.mode, 'live');
    assert.ok(record.engine!.table!.checkedPlans > 0 && record.engine!.table!.medianCheckMs !== null);
    assert.notEqual(record.recipe, 'cut'); assert.notEqual(record.recipe, 'fallback-cut');
    assert.ok(record.why.some(w => w.startsWith('Ladder (engine-ladder@1): L0')), 'Why this handover names the rung');
    assert.match(snap.mix!.reason, /Pair search L0/);
    assert.ok(player.decisionJournal().some(e => e.kind === 'decision' && e.engine?.rung === 'L0'));
    assert.ok(JSON.stringify(record).length <= 12_000, 'fits the feedback store plan limit');
  } finally { await player.dispose(); }
});

test('player: changing the next song cancels the search and restarts it for the new pair', async () => {
  const {player, ids} = await setup('shadow');
  try {
    player.preparePair(ids[1]!);
    await until(() => player.pairSearchReadiness().phase !== 'analysing', 'search started');
    player.preparePair(ids[1]!); // idempotent for the same pair
    assert.equal(player.decisionJournal().filter(e => e.kind === 'search-started').length, 1);
    player.preparePair(ids[2]!);
    const r = player.pairSearchReadiness();
    assert.equal(r.targetId, ids[2]);
    const journal = player.decisionJournal();
    assert.ok(journal.some(e => e.kind === 'search-cancelled' && e.toId === ids[1]) || journal.some(e => e.kind === 'search-finished' && e.toId === ids[1]),
      'the old pair search ended (cancelled, or had already finished)');
    assert.equal(journal.filter(e => e.kind === 'search-started').length, 2);
    await until(() => player.pairSearchReadiness().phase === 'done', 'restarted search finished');
    assert.equal(player.pairPlanTable()!.pair.toId, ids[2]);
    // Shadow: the existing path schedules; the would-be choice is recorded.
    await player.scheduleMixTo(ids[2]!, {bars: 4, anchor: 'song'});
    const record = player.snapshot().mix!.summary!.set!.transition!;
    assert.ok(validateTransitionPlanRecord(record));
    assert.equal(record.engine!.mode, 'shadow'); assert.ok(['L2', 'L3'].includes(record.engine!.rung));
    assert.ok(record.engine!.shadow && record.engine!.shadow.rung === 'L0', JSON.stringify(record.engine!.shadow));
    assert.ok(record.why.some(w => w.startsWith('Shadow pair search would have chosen')));
  } finally { await player.dispose(); }
});

test('player live: Next before the search has a table cancels it and uses the policy ladder, saying so', async () => {
  const {player, ids} = await setup('live');
  try {
    player.preparePair(ids[1]!);
    assert.equal(player.pairSearchReadiness().phase, 'analysing');
    await player.scheduleMixTo(ids[1]!, {bars: 4, anchor: 'song'});
    const record = player.snapshot().mix!.summary!.set!.transition!;
    assert.ok(validateTransitionPlanRecord(record));
    assert.ok(['L2', 'L3'].includes(record.engine!.rung)); assert.equal(record.engine!.badge, 'fallback');
    assert.ok(record.engine!.unsure.some(u => /no table/.test(u)), JSON.stringify(record.engine!.unsure));
    assert.notEqual(record.recipe, 'cut'); assert.notEqual(record.recipe, 'fallback-cut');
    assert.ok(player.decisionJournal().some(e => e.kind === 'search-cancelled'));
  } finally { await player.dispose(); }
});
