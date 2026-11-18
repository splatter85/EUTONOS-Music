// DJ booth settings (em.dj-settings.v1): validation, Manual / DJ decides semantics, the allowed-styles list (never a cut,
// the last style cannot be removed), max stretch and wait bars in the planner, the settings stamp in plan records and
// ratings, and the report grouping. Synthetic fixtures only. Engineering checks: none of this establishes how a
// handover sounds (listening NOT TESTED).
import assert from 'node:assert/strict';
import test from 'node:test';
import {chooseSetTransition, downbeatAt, planRouteFreeTransition, routeFreeSignature, setTransitionRecord, planStretch,
  type SetBarGrid} from '../src/mix-transition.js';
import type {AudioAsset} from '../src/pack-types.js';
import {DEFAULT_SETTINGS_ID, defaultDjSettings, describeSnapshot, EXPLORE_WEIGHTS, exploreWeight, isAllDj, isSettingsStamp, mergeDjSettings,
  parseDjSettings, resolveDjSettings, settingsStamp, STYLE_IDS, STYLE_RECIPE_KEY, styleIdOfRecipeKey, summarizeSnapshot, transitionSettingsOf,
  settingsSnapshot} from '../web/dj-settings.js';
import {ENTRY_STYLES} from '../web/layered-entry.js';
import {dualRampTempo, tempoBandsFor, tempoGapPolicy, validateTransitionPlanRecord, exploreMenuDraw} from '../web/transition-policy.js';
import {makeTransitionFeedback, parseTransitionFeedback} from '../web/transition-feedback.js';
import {buildReport, formatReport, NO_SETTINGS, styleOfEntry} from '../scripts/transitions-report.js';

const SR = 16000;
const fakeAsset = (id: string, bpm: number, frames: number) =>
  ({id, file: {sample_rate: SR, frames, sha256: id}, timing: {bpm, first_downbeat_frame: 0}}) as unknown as AudioAsset;
const requestedGrid = (bpm: number): SetBarGrid => ({source: 'requested', bpm, barFrames: 4 * 60 * SR / bpm, downbeats: [0]});
const frames = 200 * SR;
const input = (seed: number | null, settings?: ReturnType<typeof transitionSettingsOf>, exclude: string[] = [], toBpm = 123) => ({
  from: {asset: fakeAsset('a', 120, frames), analysis: null, frames}, to: {asset: fakeAsset('b', toBpm, frames), analysis: null, frames, channels: 1},
  sampleRate: SR, earliestFrame: Math.round(downbeatAt(requestedGrid(120), 7)), boundary: {bars: 4, anchorBar: 0},
  ...(seed === null ? {} : {explore: {seed}}), exclude, ...(settings ? {settings} : {})});
const manual = (patch: Record<string, unknown>) => mergeDjSettings(defaultDjSettings(), patch);
const ids = (...styles: (typeof STYLE_IDS)[number][]) => ({styles: {mode: 'manual', value: styles}});
const keyOf = (c: Exclude<ReturnType<typeof chooseSetTransition>, {kind: 'unavailable'}>): string =>
  'layered' in c.plan && c.plan.layered ? `fallback-layered-entry/${c.plan.layered.style}` : c.plan.recipe;

test('defaults: every setting is DJ decides, so nothing changes until the owner touches a control', () => {
  const d = defaultDjSettings();
  assert.ok(isAllDj(d));
  const e = resolveDjSettings(d);
  assert.deepEqual([e.pairSearch, e.explore.enabled, e.explore.level, e.maxStretch, e.waitBars, e.allowedStyles.length, e.restrictsStyles],
    ['off', true, 'dj', 0.15, 8, 8, false]);
  assert.equal(transitionSettingsOf(e).allowedRecipeKeys, undefined, 'no allow-list unless the owner restricts it');
  assert.equal(settingsStamp(d).id, DEFAULT_SETTINGS_ID);
  // Stored values behind a DJ-decides setting do not matter: the id and the effective settings stay the same.
  const behind = mergeDjSettings(d, {explore: {mode: 'dj', value: 'high'}, maxStretch: {mode: 'dj', value: 8}});
  assert.equal(settingsStamp(behind).id, DEFAULT_SETTINGS_ID);
  assert.deepEqual(resolveDjSettings(behind), e);
  // Every style maps to a planner recipe key and back; a hard cut is not in the list.
  assert.equal(STYLE_IDS.length, 8);
  for (const id of STYLE_IDS) assert.equal(styleIdOfRecipeKey(STYLE_RECIPE_KEY[id]), id);
  assert.ok(!STYLE_IDS.some(id => /cut/.test(id)) && !Object.values(STYLE_RECIPE_KEY).some(k => /cut/.test(k)));
});

test('validation: unknown keys are ignored, a bad value rejects the whole change, the last style cannot go', () => {
  const base = defaultDjSettings();
  const ignored = mergeDjSettings(base, {version: 'em.dj-settings.v1', surprise: 1, explore: {mode: 'manual', value: 'high', extra: true}});
  assert.deepEqual(ignored.explore, {mode: 'manual', value: 'high'});
  assert.equal((ignored as unknown as Record<string, unknown>).surprise, undefined);
  for (const bad of [{pairSearch: {mode: 'manual', value: 'sometimes'}}, {explore: {mode: 'maybe'}}, {maxStretch: {mode: 'manual', value: 12}},
    {waitBars: {mode: 'manual', value: -1}}, {waitBars: {mode: 'manual', value: '4'}}, {styles: {mode: 'manual', value: ['nope']}},
    {styles: {mode: 'manual', value: []}}, {styles: {mode: 'manual', value: ['crossfade', 'crossfade'.repeat(3)]}}, {pairSearch: 'live'},
    {version: 'em.dj-settings.v9'}, 'text', null, [], {styles: {mode: 'manual', value: ['cut']}}]) {
    assert.throws(() => mergeDjSettings(base, bad), Error, JSON.stringify(bad));
  }
  // One bad value among good ones rejects everything: nothing is half applied.
  assert.throws(() => mergeDjSettings(base, {explore: {mode: 'manual', value: 'low'}, maxStretch: {mode: 'manual', value: 99}}));
  assert.deepEqual(base, defaultDjSettings(), 'the input is never mutated');
  assert.deepEqual(parseDjSettings({explore: {mode: 'manual', value: 'off'}}).explore, {mode: 'manual', value: 'off'});
  // A partial change keeps the other fields: switching a setting back to DJ keeps its stored value.
  const pinned = mergeDjSettings(base, {maxStretch: {mode: 'manual', value: 8}});
  assert.equal(mergeDjSettings(pinned, {maxStretch: {mode: 'dj'}}).maxStretch.value, 8);
});

test('mode semantics: Manual pins, DJ decides ignores the stored value, the URL flag wins for pair search', () => {
  const pinned = manual({pairSearch: {mode: 'manual', value: 'shadow'}, explore: {mode: 'manual', value: 'off'}, maxStretch: {mode: 'manual', value: 8},
    waitBars: {mode: 'manual', value: 0}, ...ids('crossfade', 'layered-bass-first')});
  const e = resolveDjSettings(pinned);
  assert.deepEqual([e.pairSearch, e.explore.enabled, e.maxStretch, e.waitBars, e.restrictsStyles], ['shadow', false, 0.08, 0, true]);
  assert.deepEqual([...e.allowedRecipeKeys].sort(), ['fallback-crossfade', 'fallback-layered-entry/bass-first']);
  const back = mergeDjSettings(pinned, {pairSearch: {mode: 'dj'}, styles: {mode: 'dj'}});
  assert.equal(resolveDjSettings(back).pairSearch, 'off');
  assert.equal(resolveDjSettings(back).restrictsStyles, false);
  assert.equal(resolveDjSettings(pinned, 'live').pairSearch, 'live', 'the ?pairsearch= flag overrides the setting');
  assert.notEqual(settingsStamp(pinned, 'live').id, settingsStamp(pinned).id, 'the flag is part of the stamp');
  assert.equal(settingsStamp(pinned, 'live').urlPairSearch, 'live');
  // Explore levels: low favours safe styles, high favours bold ones; DJ decides is equal weights.
  assert.equal(exploreWeight('dj', 'fallback-crossfade'), 1);
  assert.equal(exploreWeight('low', 'fallback-crossfade'), EXPLORE_WEIGHTS.strong);
  assert.equal(exploreWeight('low', 'fallback-layered-entry/bass-first'), EXPLORE_WEIGHTS.weak);
  assert.equal(exploreWeight('high', 'fallback-layered-entry/bass-first'), EXPLORE_WEIGHTS.strong);
  assert.equal(exploreWeight('high', 'fallback-crossfade'), EXPLORE_WEIGHTS.weak);
  assert.ok(describeSnapshot(settingsSnapshot(pinned)).some(l => /Allowed styles: manual, 2 of 8/.test(l)));
  assert.match(summarizeSnapshot(settingsSnapshot(pinned)), /stretch 8% · wait 0b/);
});

test('allow-list: unticked styles are never chosen by the explore menu or the deterministic ladder', () => {
  const only = (...keys: string[]) => ({allowedRecipeKeys: keys});
  for (const allowed of [['fallback-crossfade'], ['fallback-layered-entry/drums-first'], ['fallback-echo-reset', 'fallback-tone-dissolve']]) {
    for (let seed = 1; seed <= 40; seed++) {
      const c = chooseSetTransition(input(seed, only(...allowed)));
      assert.ok(c.kind !== 'unavailable', `seed ${seed}`);
      assert.ok(allowed.includes(keyOf(c)), `${keyOf(c)} is not in ${allowed.join(', ')}`);
      assert.ok(c.menu?.alternatives.every(a => allowed.includes(a.key)), 'the logged menu holds only allowed styles');
      assert.ok(!/cut/.test(c.plan.recipe));
    }
    const plain = chooseSetTransition(input(null, only(...allowed)));
    assert.ok(plain.kind !== 'unavailable' && allowed.includes(keyOf(plain)), `deterministic: ${plain.kind === 'unavailable' ? plain.reason : keyOf(plain)}`);
  }
});

test('allow-list: when no allowed style fits, the last rung is a layered entry, logged as an override, never a cut', () => {
  const frames60 = 60 * SR, a = {grid: requestedGrid(90), frames: frames60}, b = {grid: requestedGrid(128), frames: frames60}, exit = 16 * a.grid.barFrames;
  // Every ordinary candidate is already used up and only the crossfade is allowed: the shortest layered entry still plans.
  const used = ['fallback-crossfade', 'fallback-echo-reset', 'fallback-filter-dissolve', 'fallback-tone-dissolve',
    ...ENTRY_STYLES.flatMap(s => [8, 4].map(bars => routeFreeSignature(`fallback-layered-entry/${s}`, bars, exit)))];
  const over = planRouteFreeTransition(a, b, exit, SR, {exclude: used, allowedKeys: ['fallback-crossfade']});
  assert.ok(over.kind === 'route-free' && over.layered?.lastRung && over.bars === 2 && over.allowListOverridden === true, JSON.stringify(over).slice(0, 200));
  assert.ok(!/cut/.test(over.kind === 'route-free' ? over.recipe : ''));
  // With a layered style allowed the last rung is that rung honouring the list, and nothing is overridden.
  const honoured = planRouteFreeTransition(a, b, exit, SR, {exclude: used, allowedKeys: ['fallback-layered-entry/bass-first']});
  assert.ok(honoured.kind === 'route-free' && honoured.layered?.style === 'bass-first' && !honoured.allowListOverridden);
  // The 90 to 128 BPM pair gives the crossfade no candidate at all: it falls to the last rung and says so.
  const noFit = planRouteFreeTransition(a, b, exit, SR, {allowedKeys: ['fallback-crossfade']});
  assert.ok(noFit.kind === 'route-free' && noFit.allowListOverridden === true && noFit.layered?.lastRung, noFit.kind);
  // The chooser reports it in the plan's reasons and the stamp can carry the flag.
  const frame = 200 * SR;
  const choice = chooseSetTransition({from: {asset: fakeAsset('a', 90, frame), analysis: null, frames: frame}, to: {asset: fakeAsset('b', 128, frame), analysis: null, frames: frame, channels: 1},
    sampleRate: SR, earliestFrame: Math.round(downbeatAt(requestedGrid(90), 7)), boundary: {bars: 4, anchorBar: 0}, settings: {allowedRecipeKeys: ['fallback-crossfade']}});
  assert.ok(choice.kind !== 'unavailable' && 'layered' in choice.plan && choice.plan.layered?.lastRung);
  assert.ok(choice.why?.some(w => /Allowed styles overridden/.test(w)));
  const s = settingsStamp(manual(ids('crossfade')), null, true);
  assert.ok(isSettingsStamp(s) && s.allowListOverridden === true);
});

test('max stretch: 8% narrows the tempo bands, the dual ramp and the pair-search candidates', () => {
  assert.equal(tempoBandsFor(0.15)[1]!.maxGap, 0.15);
  assert.equal(tempoBandsFor(0.08)[1]!.maxGap, 0.08);
  assert.ok(tempoBandsFor(0.08)[2]!.maxGap < tempoBandsFor(0.15)[2]!.maxGap);
  // 120 to 132 BPM is a 10% gap: a stretched blend at 15%, a meet band without a plain blend at 8%.
  const wide = tempoGapPolicy(120, 132, {beatConfident: true}), narrow = tempoGapPolicy(120, 132, {beatConfident: true}, 0.08);
  assert.equal(wide.band, 'stretched'); assert.ok(wide.recipes.includes('blend'));
  assert.equal(narrow.band, 'meet'); assert.ok(!narrow.recipes.includes('blend'));
  const ramp = dualRampTempo(120, 132, 0.08);
  assert.ok(ramp && Math.max(Math.abs(ramp.fromRatio - 1), Math.abs(ramp.toRatio - 1)) <= 0.08 + 1e-9);
  assert.equal(dualRampTempo(120, 144, 0.08), null, 'a 20% gap does not fit two decks within 8%');
  // Planner: a route-free choice is unaffected, but the setting reaches the policy; the plan never exceeds the limit.
  const c = chooseSetTransition(input(null, {maxStretch: 0.08}, [], 132));
  assert.ok(c.kind !== 'unavailable');
  assert.ok(c.kind === 'analyzed' ? planStretch(c.plan) <= 0.08 + 1e-6 : true);
});

test('wait bars: 0 uses only the requested boundary; the default may wait', () => {
  const zero = chooseSetTransition(input(null, {waitBars: 0}));
  const dflt = chooseSetTransition(input(null));
  assert.ok(zero.kind !== 'unavailable' && dflt.kind !== 'unavailable');
  // Earliest bar 7 with a 4-bar boundary: the first boundary is bar 8 (index 8).
  assert.equal(zero.exitBar, 8, 'wait 0 exits on the requested boundary');
  assert.ok(dflt.exitBar >= 8 && dflt.exitBar <= 16);
});

test('explore level reaches the draw: weights tilt the menu without ever excluding a style', () => {
  const keys = ['fallback-crossfade', 'fallback-layered-entry/bass-first'];
  const count = (level: 'low' | 'high', key: string): number => {
    let n = 0;
    for (let seed = 0; seed < 3000; seed++) if (keys[exploreMenuDraw(seed, 0, keys, keys.map(k => exploreWeight(level, k))).index] === key) n++;
    return n;
  };
  assert.ok(count('low', 'fallback-crossfade') > count('high', 'fallback-crossfade') + 600, 'low favours the safe crossfade');
  assert.ok(count('high', 'fallback-layered-entry/bass-first') > count('low', 'fallback-layered-entry/bass-first') + 600);
  assert.ok(count('low', 'fallback-layered-entry/bass-first') > 300, 'the floor keeps every style possible');
  // Through the chooser: the logged weights follow the level and the reason names it.
  const hi = chooseSetTransition(input(5, {exploreLevel: 'high'}));
  assert.ok(hi.kind !== 'unavailable' && hi.menu);
  const w = (k: string) => hi.menu!.alternatives.find(a => a.key === k)?.weight;
  assert.ok(w('fallback-layered-entry/bass-first')! > w('fallback-crossfade')!);
  assert.ok(hi.why?.some(r => /explore level high/.test(r)));
});

const planWith = (settings?: ReturnType<typeof settingsStamp>) => {
  const c = chooseSetTransition(input(3));
  assert.ok(c.kind !== 'unavailable');
  return setTransitionRecord(c, {id: 'a', sha256: 'a'.repeat(64)}, {id: 'b', sha256: 'b'.repeat(64), frames}, SR, 'explore', 3, undefined, settings);
};

test('the settings stamp lives in the plan record and the rating; older records and ratings stay valid', () => {
  const none = planWith();
  assert.equal(none.settings, undefined);
  const stamp = settingsStamp(manual({maxStretch: {mode: 'manual', value: 8}, ...ids('crossfade', 'echo-reset')}));
  const stamped = planWith(stamp);
  assert.equal(validateTransitionPlanRecord(stamped).settings?.id, stamp.id);
  assert.notEqual(stamped.id, none.id, 'the stamp is part of the plan identity');
  assert.equal(planWith(settingsStamp(defaultDjSettings())).settings?.id, DEFAULT_SETTINGS_ID);
  // A tampered stamp (wrong id, unknown key, bad value) is refused.
  assert.throws(() => validateTransitionPlanRecord({...stamped, settings: {...stamp, id: 'ds-00000000'}}));
  assert.throws(() => validateTransitionPlanRecord({...stamped, settings: {...stamp, extra: 1}}));
  assert.throws(() => validateTransitionPlanRecord({...stamped, settings: {...stamp, snapshot: {...stamp.snapshot, maxStretch: {mode: 'manual', value: 99}}}}));
  // Ratings: the optional field is copied from the plan; an old rating without it still parses.
  const at = '2026-11-17T10:00:00.000Z';
  const rated = makeTransitionFeedback({plan: stamped, rating: 'like', device: 'phone', at});
  assert.equal(rated.settings?.id, stamp.id);
  assert.equal(parseTransitionFeedback(JSON.parse(JSON.stringify(rated))).settings?.id, stamp.id);
  const old = makeTransitionFeedback({plan: none, rating: 'ok', device: 'pc', at});
  assert.equal('settings' in old, false);
  assert.equal(parseTransitionFeedback(JSON.parse(JSON.stringify(old))).planId, none.id);
  assert.throws(() => parseTransitionFeedback({...rated, settings: settingsStamp(defaultDjSettings())}), /do not match the plan/);
  assert.throws(() => parseTransitionFeedback({...old, settings: stamp}), /do not match the plan/);
  assert.throws(() => parseTransitionFeedback({...rated, settings: {...stamp, id: 'x'}}));
});

test('report: ratings group by settings id, by style and by style within settings id, with a legend', () => {
  const sA = settingsStamp(manual(ids('crossfade'))), sB = settingsStamp(manual({maxStretch: {mode: 'manual', value: 8}}));
  const mk = (n: number, stamp: ReturnType<typeof settingsStamp> | undefined, rating: 'love' | 'dislike') => {
    const c = chooseSetTransition(input(n));
    assert.ok(c.kind !== 'unavailable');
    const plan = setTransitionRecord(c, {id: 'a', sha256: 'a'.repeat(64)}, {id: 'b', sha256: 'b'.repeat(64), frames}, SR, 'explore', n, undefined, stamp);
    return makeTransitionFeedback({plan, rating, device: 'phone', at: `2026-11-17T10:00:${String(n).padStart(2, '0')}.000Z`});
  };
  const entries = [mk(1, sA, 'love'), mk(2, sA, 'love'), mk(3, sB, 'dislike'), mk(4, undefined, 'love'), mk(5, sB, 'love')];
  const report = buildReport(entries, {lines: 5, skipped: 0});
  const byId = Object.fromEntries(report.groups['settings id']!.map(r => [r.key, r.n]));
  assert.equal(byId[sA.id], 2); assert.equal(byId[sB.id], 2); assert.equal(byId[NO_SETTINGS], 1);
  assert.ok(report.groups['style (recipe or layered entry)']!.length >= 1);
  assert.ok(report.groups['style within settings id']!.every(r => r.key.includes(' · ')));
  assert.ok(report.groups['style within settings id']!.some(r => r.key.startsWith(sA.id)));
  assert.deepEqual(Object.keys(report.settingsLegend).sort(), [sA.id, sB.id].sort());
  assert.match(report.settingsLegend[sA.id]!.summary, /styles 1\/8/);
  for (const e of entries) assert.ok(styleOfEntry(e).length > 0);
  const text = formatReport(report);
  assert.ok(text.includes('By settings id:') && text.includes('By style within settings id:') && text.includes('Settings ids'));
  assert.ok(text.includes(sA.id));
});
