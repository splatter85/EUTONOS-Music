// Owner decisions 2026-11-16: layered (band-wise) entries instead of automatic clean cuts, recipe-claims@2,
// the seeded explore menu (explore-menu@1) and the 15% stretch limit. Synthetic, original fixtures only.
// Engineering checks: none of this establishes how a handover sounds (listening NOT TESTED).
import assert from 'node:assert/strict';
import test from 'node:test';
import {validateMixAutomation} from '../src/mix-automation.js';
import {chooseSetTransition, downbeatAt, EXPLORE_ROUTE_FREE_MENU, planRouteFreeTransition, routeFreeSignature, setTransitionRecord,
  transitionSignature, type SetBarGrid} from '../src/mix-transition.js';
import type {AudioAsset} from '../src/pack-types.js';
import {renderTimePitch, TIME_PITCH_LIMITS} from '../src/time-pitch.js';
import {checkLayeredLanes, ENTRY_STYLES, exploreEntryStyles, layeredEntryAutomation, layeredKeyLabel, LAYERED_ENTRY_LIMITS,
  preferredEntryStyles} from '../web/layered-entry.js';
import {judgeTransition, recipeClaims, RECIPE_CLAIMS_VERSION, type TransitionMeasurements} from '../web/mix-evaluator.js';
import {routeFreeJudgedAs} from '../web/mix-precheck-data.js';
import {EXPLORE_MENU_POLICY, exploreMenuDraw, makeTransitionPlanRecord, validateTransitionPlanRecord} from '../web/transition-policy.js';

const SR = 16000;
const fakeAsset = (id: string, bpm: number, frames: number) =>
  ({id, file: {sample_rate: SR, frames, sha256: id}, timing: {bpm, first_downbeat_frame: 0}}) as unknown as AudioAsset;
const requestedGrid = (bpm: number): SetBarGrid => ({source: 'requested', bpm, barFrames: 4 * 60 * SR / bpm, downbeats: [0]});

test('layered-entry@1: every style and length builds valid lanes that keep their own claims', () => {
  const barFrames = 4 * 60 * SR / 120;
  for (const style of ENTRY_STYLES) for (const bars of LAYERED_ENTRY_LIMITS.bars) {
    const made = layeredEntryAutomation(style, bars, barFrames, 120, SR, {echoTail: true});
    validateMixAutomation(made.outgoing, SR); validateMixAutomation(made.incoming, SR);
    assert.equal(made.incoming.gain[0]!.value, 0, 'the deck contract: an incoming mix starts at zero gain');
    assert.equal(made.info.durationFrames, Math.round(bars * barFrames));
    const lanes = checkLayeredLanes(made.outgoing, made.incoming, made.info);
    assert.ok(lanes.ok, `${style} ${bars}: ${lanes.reason}`);
    assert.ok(lanes.lowOverlapDb <= LAYERED_ENTRY_LIMITS.lowOverlapMaxDb, 'never both lows near full');
    assert.ok(lanes.leadFirst, 'the lead band(s) open first');
    // Echo tails only where A's last band to leave is the highs, and only for 4 bars or more.
    assert.equal(made.info.echoTail, (style === 'bass-first' || style === 'mid-first') && bars >= 4);
    assert.equal(!!made.outgoing.echo, made.info.echoTail);
  }
  // A lane set that breaks the masking rule is caught without audio.
  const made = layeredEntryAutomation('bass-first', 4, barFrames, 120, SR);
  const flat = made.incoming.bands!.low.map(p => ({frame: p.frame, value: 1}));
  const broken = checkLayeredLanes(made.outgoing, {...made.incoming, bands: {...made.incoming.bands!, low: flat}}, made.info);
  assert.equal(broken.ok, false);
});

test('entry style by section, and the seeded explore permutation is deterministic', () => {
  assert.equal(preferredEntryStyles(null, 'drop').styles[0], 'high-first');
  assert.equal(preferredEntryStyles('breakdown', null).styles[0], 'bass-first');
  assert.equal(preferredEntryStyles('verse' as never, 'intro').styles[0], 'drums-first');
  assert.equal(preferredEntryStyles(null, 'build').styles[0], 'mid-first');
  const none = preferredEntryStyles(null, null);
  assert.equal(none.structural, false); assert.equal(none.styles.length, 4);
  const a = exploreEntryStyles(7, ENTRY_STYLES), b = exploreEntryStyles(7, ENTRY_STYLES);
  assert.deepEqual(a, b); assert.deepEqual([...a].sort(), [...ENTRY_STYLES].sort());
  const seen = new Set(Array.from({length: 32}, (_, s) => exploreEntryStyles(s, ENTRY_STYLES)[0]));
  assert.equal(seen.size, 4, 'every style leads for some seed');
  assert.equal(layeredKeyLabel('fallback-layered-entry/bass-first:b4:at123'), 'Bass-first layered entry');
  assert.equal(layeredKeyLabel('fallback-echo-reset'), null);
});

test('recipe-claims@2: a layered entry is judged on its claims; missing evidence fails', () => {
  assert.equal(RECIPE_CLAIMS_VERSION, 'recipe-claims@2');
  assert.deepEqual(recipeClaims('layered-entry'), {beatLocked: false, loudness: 'dip', maxDipLu: LAYERED_ENTRY_LIMITS.maxDipLu, layered: true});
  assert.equal(routeFreeJudgedAs('fallback-layered-entry'), 'layered-entry');
  const m = (layered?: TransitionMeasurements['layered'], down = 1): TransitionMeasurements => ({truePeakDbtp: -6,
    loudness: {momentaryMaxUpLu: 0.2, momentaryMaxDownLu: -down, shortTermMaxUpLu: 0.1, shortTermMaxDownLu: -down},
    lowBuildUp: {maxDb: null, band: null}, beatPhase: {maxError: null, meanError: null, beats: 0, judged: false, reason: 'not claimed'},
    boundaryFlux: {excessDb: null, atFrame: null, judged: false}, sampleJumpRatio: 1, silenceGapMs: 0, stereoCorrelation: null,
    ...(layered ? {layered} : {})});
  const good = {style: 'bass-first' as const, leadDb: 9, maskingDb: -4, lowOverlapDb: -6, lowSumMinDb: -1, leadFirst: true, lanesOk: true};
  assert.equal(judgeTransition('layered-entry', m(good)).verdict, 'pass');
  assert.equal(judgeTransition('layered-entry', m()).verdict, 'fail', 'no layered measurements never passes');
  assert.equal(judgeTransition('layered-entry', m({...good, maskingDb: -0.5})).flags[0]!.metric, 'lowMasking');
  assert.equal(judgeTransition('layered-entry', m({...good, leadDb: 3})).flags[0]!.metric, 'layeredLead');
  assert.equal(judgeTransition('layered-entry', m({...good, lanesOk: false})).verdict, 'fail');
  assert.equal(judgeTransition('layered-entry', m(good, 3.5)).verdict, 'pass', 'a 3.5 LU dip is within the declared 4 LU');
  assert.equal(judgeTransition('layered-entry', m(good, 4.5)).verdict, 'fail', 'deeper than the declared 4 LU');
  // Continuity claim: a rise over the straight-line interpolation is logged, a rise over the louder song fails.
  const rising = (riseOverLouderLu: number) => ({...m({...good, riseOverLouderLu}),
    loudness: {momentaryMaxUpLu: 8, momentaryMaxDownLu: -1, shortTermMaxUpLu: 6, shortTermMaxDownLu: -1}});
  const quietA = judgeTransition('layered-entry', rising(1));
  assert.equal(quietA.verdict, 'pass', 'B arriving early over a quiet A is the recipe');
  assert.equal(quietA.unclaimed?.[0]?.metric, 'loudness');
  assert.equal(judgeTransition('layered-entry', rising(3.5)).verdict, 'fail', 'louder than both songs fails at thresholds@1');
  assert.equal(judgeTransition('echo-out', rising(1)).verdict, 'fail', 'other recipes keep the interpolation rule');
  // Continuity envelope: a dip below the interpolation into a much quieter B is logged; a drop below both songs fails.
  const dipping = (dipUnderQuieterLu: number) => m({...good, riseOverLouderLu: 0.2, dipUnderQuieterLu}, 12);
  const quietB = judgeTransition('layered-entry', dipping(1));
  assert.equal(quietB.verdict, 'pass', 'reaching a quieter B early is the recipe');
  assert.ok(quietB.unclaimed?.some(f => f.metric === 'loudness' && f.value === 12));
  assert.equal(judgeTransition('layered-entry', dipping(4.5)).verdict, 'fail', 'a hole below both songs fails at the declared 4 LU');
  assert.equal(judgeTransition('echo-out', dipping(1)).verdict, 'fail', 'other recipes keep the interpolation dip');
});

test('explore-menu@1: seeded draw is deterministic, floor-weighted and covers every candidate', () => {
  const keys = ['blend', ...EXPLORE_ROUTE_FREE_MENU];
  assert.deepEqual(exploreMenuDraw(11, 0, keys), exploreMenuDraw(11, 0, keys));
  const counts = new Map<string, number>();
  for (let seed = 0; seed < 2000; seed++) { const k = keys[exploreMenuDraw(seed, 0, keys).index]!; counts.set(k, (counts.get(k) ?? 0) + 1); }
  assert.equal(counts.size, keys.length, 'every candidate is drawn');
  const even = 2000 / keys.length;
  for (const [k, n] of counts) assert.ok(n > even * 0.6 && n < even * 1.4, `${k}: ${n}`);
  // Floor weights: a candidate given weight 0 still keeps half an even share.
  const w = exploreMenuDraw(3, 0, ['a', 'b', 'c'], [10, 0, 0]).weights;
  assert.ok(w[1]! >= EXPLORE_MENU_POLICY.floorShare * 10 / 3 - 1e-6 && w[2]! > 0);
  assert.throws(() => exploreMenuDraw(1, 0, []));
});

test('explore mode: chooser draws from every planned candidate, records the menu, and is deterministic per seed', () => {
  const frames = 200 * SR;
  const input = (seed: number, exclude: string[] = []) => ({from: {asset: fakeAsset('a', 120, frames), analysis: null, frames},
    to: {asset: fakeAsset('b', 123, frames), analysis: null, frames, channels: 1}, sampleRate: SR,
    earliestFrame: Math.round(downbeatAt(requestedGrid(120), 7)), boundary: {bars: 4, anchorBar: 0}, explore: {seed}, exclude});
  const chosen = new Set<string>();
  for (let seed = 1; seed <= 60; seed++) {
    const c = chooseSetTransition(input(seed));
    assert.ok(c.kind !== 'unavailable' && c.menu, c.kind);
    assert.ok(!/cut/.test(c.plan.recipe), 'explore never plans a cut');
    assert.deepEqual(chooseSetTransition(input(seed)), c, 'deterministic per seed');
    chosen.add(c.menu.chosen);
    assert.ok(c.menu.alternatives.some(a => a.key === 'fallback-crossfade') && c.menu.alternatives.some(a => a.key.startsWith('fallback-layered-entry/')),
      'crossfades stay on the menu beside layered entries');
    if (seed === 1) {
      const record = validateTransitionPlanRecord(setTransitionRecord(c, {id: 'a', sha256: 'a'.repeat(64)}, {id: 'b', sha256: 'b'.repeat(64), frames}, SR, 'explore', seed));
      assert.equal(record.menu?.policy, EXPLORE_MENU_POLICY.version); assert.equal(record.menu?.chosen, c.menu.chosen);
      // A failed draw is excluded and the next draw is made among the rest.
      const next = chooseSetTransition(input(seed, [transitionSignature(c.plan, c.exitBar)]));
      assert.ok(next.kind !== 'unavailable' && next.menu && next.menu.attempt === 1);
      // After maxDraws failed draws the deterministic ladder takes the remaining attempts (no menu).
      const failed: string[] = [];
      let draw: ReturnType<typeof chooseSetTransition> = c;
      while (failed.length < EXPLORE_MENU_POLICY.maxDraws && draw.kind !== 'unavailable') {
        failed.push(transitionSignature(draw.plan, draw.exitBar)); draw = chooseSetTransition(input(seed, failed));
      }
      assert.ok(draw.kind !== 'unavailable' && !draw.menu, 'deterministic ladder after the draw limit');
      assert.ok(draw.notes.some(n => n.includes('draw limit')));
    }
  }
  assert.ok(chosen.size >= 5, `varied styles over 60 seeds: ${[...chosen].join(', ')}`);
});

test('plan record: entryStyle and menu are optional; records without them keep their ids', () => {
  const body = {mode: 'auto' as const, seed: null, from: {id: 'a', sha256: 'a'.repeat(64), exitFrame: 0}, to: {id: 'b', sha256: 'b'.repeat(64), entryFrame: 0},
    sampleRate: SR, recipe: 'fallback-crossfade', why: [], rejected: []} as never;
  const plain = makeTransitionPlanRecord(body);
  const undef = makeTransitionPlanRecord({...(body as object), entryStyle: undefined, menu: undefined} as never);
  assert.equal(plain.id, undef.id, 'absent optional fields do not change the id');
  assert.throws(() => validateTransitionPlanRecord({...plain, menu: {policy: 'explore-menu@1', seed: 1, attempt: 0, chosen: 'x', alternatives: []}}));
});

test('no automatic cut: route-free planning ends at the last rung; a cut only when the owner selected it', () => {
  const frames = 60 * SR, a = {grid: requestedGrid(90), frames}, b = {grid: requestedGrid(128), frames}, exit = 16 * a.grid.barFrames;
  const all = ['fallback-crossfade', 'fallback-echo-reset', 'fallback-filter-dissolve', 'fallback-tone-dissolve',
    ...ENTRY_STYLES.flatMap(s => [8, 4].map(bars => routeFreeSignature(`fallback-layered-entry/${s}`, bars, exit)))];
  const last = planRouteFreeTransition(a, b, exit, SR, {exclude: all});
  assert.ok(last.kind === 'route-free' && last.recipe === 'fallback-layered-entry' && last.layered?.lastRung && last.bars === 2);
  const none = planRouteFreeTransition(a, b, exit, SR, {exclude: [...all, 'fallback-layered-entry']});
  assert.equal(none.kind, 'unavailable', 'no cut without the owner');
  const owner = planRouteFreeTransition(a, b, exit, SR, {allowCut: true});
  assert.ok(owner.kind === 'route-free' && owner.recipe === 'fallback-cut');
  const lastOnly = planRouteFreeTransition(a, b, exit, SR, {lastRung: true});
  assert.ok(lastOnly.kind === 'route-free' && lastOnly.layered?.lastRung);
});

test('15% stretch: WSOLA accepts 0.85 to 1.15 and the mapping stays coherent', () => {
  assert.equal(TIME_PITCH_LIMITS.minTempoRatio, 0.85); assert.equal(TIME_PITCH_LIMITS.maxTempoRatio, 1.15);
  const tone = Float32Array.from({length: 2 * SR}, (_, n) => 0.4 * Math.sin(2 * Math.PI * 220 * n / SR));
  for (const ratio of [0.85, 1.15]) {
    const out = renderTimePitch({sampleRate: SR, channels: [tone]}, {tempoRatio: ratio});
    assert.ok(Math.abs(out.audio.channels[0]!.length - tone.length / ratio) <= 2, String(ratio));
  }
  assert.throws(() => renderTimePitch({sampleRate: SR, channels: [tone]}, {tempoRatio: 0.84}));
  assert.throws(() => renderTimePitch({sampleRate: SR, channels: [tone]}, {tempoRatio: 1.16}));
});
