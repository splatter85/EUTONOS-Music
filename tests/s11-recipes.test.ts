import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {compilePhrase, S01_PERFORMER, S01_RECIPE, S11_PERFORMER, S11_RECIPE_FAMILIES,
  ROLE_MAX_QUARTERS, type ProceduralPlan} from '../src/phrase-plan.js';
import {captureRecipeReplay, createRecipeStudyPack, resolveRecipeReplay} from '../src/recipe-library.js';
import {canonicalJson, LibraryError} from '../src/library-codec.js';

const raw = JSON.parse(await readFile(new URL('../../fixtures/s01/manifest.json', import.meta.url), 'utf8'));
const study = () => createRecipeStudyPack(raw, {id: 's11-fixture-studies', revision: 1}, S01_RECIPE);
const selected = [0, 1, 42, 0xffffffff], heldOut = [97, 104729, 0x9e3779b9, 0xabcdef01];
const compile = (recipe: {readonly id: string; readonly revision: number} = S11_RECIPE_FAMILIES[0], seed = 0, state: 'explore' | 'drive' = 'explore') =>
  compilePhrase(study(), {recipe, seed, state, allowFixtures: true});

function checkBounds(plan: ProceduralPlan): void {
  assert.ok(plan.events.length > 0 && plan.events.length <= 256);
  const endByRole = new Map<string, number>();
  let prior = -1;
  for (const event of plan.events) {
    assert.ok(event.atQuarters >= prior && Number.isInteger(event.atQuarters * 4));
    assert.ok(event.gain > 0 && event.gain <= 1);
    assert.ok(event.atQuarters >= (endByRole.get(event.role) ?? 0), 'maximum-length sample overlaps itself');
    const end = event.atQuarters + ROLE_MAX_QUARTERS[event.role];
    assert.ok(end <= (event.atQuarters < 16 ? 16 : 32), 'sample crosses a declared phrase boundary');
    endByRole.set(event.role, end);
    prior = event.atQuarters;
  }
  assert.equal(endByRole.size, 4);
}

test('S11 adds three exact recipe studies under a new pack identity without changing original media or routes', () => {
  const before = canonicalJson(raw), pack = study();
  assert.equal(pack.recipes.length, raw.recipes.length + 3);
  assert.equal(canonicalJson(pack.assets), canonicalJson(raw.assets));
  assert.equal(canonicalJson(pack.routes), canonicalJson(raw.routes));
  assert.equal(canonicalJson(raw), before);
  assert.ok(Object.isFrozen(pack.recipes));
  assert.throws(() => createRecipeStudyPack(raw, {id: raw.id, revision: raw.revision}, S01_RECIPE), /new pack identity/);
  assert.throws(() => createRecipeStudyPack(pack, {id: 'another-study', revision: 1}, S01_RECIPE), /reserved/);
  assert.ok(S11_RECIPE_FAMILIES.every(recipe => recipe.listening === 'not-tested'));
});

test('S11 exact identities choose structurally different finite recipes and preserve symbolic replay', () => {
  for (const seed of [...selected, ...heldOut]) for (const state of ['explore', 'drive'] as const) {
    const plans = S11_RECIPE_FAMILIES.map(recipe => compile(recipe, seed, state));
    assert.equal(new Set(plans.map(plan => canonicalJson(plan.events.map(event =>
      ({role: event.role, at: event.atQuarters}))))).size, 3, 'families differ beyond title or gain');
    for (const [index, plan] of plans.entries()) {
      assert.deepEqual(plan.performer, S11_PERFORMER);
      assert.deepEqual(plan, compile(S11_RECIPE_FAMILIES[index]!, seed, state));
      checkBounds(plan);
    }
  }
});

test('S11 selected, held-out and 64 boundary seeds respect maximum role lengths and phrase exits', () => {
  for (const recipe of S11_RECIPE_FAMILIES) for (const state of ['explore', 'drive'] as const) {
    for (const seed of [...selected, ...heldOut, ...Array.from({length: 64}, (_, i) => Math.imul(i, 0x9e3779b9) >>> 0)]) {
      checkBounds(compile(recipe, seed, state));
    }
    assert.notEqual(canonicalJson(compile(recipe, 0, state).events), canonicalJson(compile(recipe, 42, state).events));
  }
});

test('legacy S01 and arbitrary S06 recipe IDs keep the original performer and event rules', () => {
  const original = compilePhrase(raw, {recipe: S01_RECIPE, seed: 42, state: 'drive', allowFixtures: true});
  const renamed = structuredClone(raw);
  renamed.recipes[0].id = 'some-producer-recipe';
  const other = compilePhrase(renamed, {recipe: renamed.recipes[0], seed: 42, state: 'drive', allowFixtures: true});
  assert.deepEqual(other.performer, S01_PERFORMER);
  assert.deepEqual(original.events, other.events);
  const unchanged = compilePhrase(study(), {recipe: S01_RECIPE, seed: 42, state: 'drive', allowFixtures: true});
  assert.deepEqual(unchanged.events, original.events);
  const future = structuredClone(study());
  const recipe = future.recipes.find(item => item.id === S11_RECIPE_FAMILIES[0].id)!;
  Object.assign(recipe, {revision: 2});
  assert.throws(() => compilePhrase(future, {recipe, seed: 0, state: 'explore', allowFixtures: true}), /unsupported built-in/);
});

test('replay round-trip recompiles sealed plans and does not retain fixture authorization', async () => {
  const pack = study(), options = {recipe: S11_RECIPE_FAMILIES[1], seed: 0, state: 'drive' as const, allowFixtures: true};
  const saved = await captureRecipeReplay(pack, options);
  const decoded = JSON.parse(JSON.stringify(saved));
  assert.deepEqual(await resolveRecipeReplay(pack, decoded, {allowFixtures: true}), compilePhrase(pack, options));
  await assert.rejects(resolveRecipeReplay(pack, decoded), /eligibility/);
  await assert.rejects(captureRecipeReplay(pack, {...options, allowFixtures: false}), /eligibility/);
});

test('replay refuses changed same-version metadata, changed seed/state, and unknown performer', async () => {
  const pack = study(), saved = await captureRecipeReplay(pack,
    {recipe: S11_RECIPE_FAMILIES[2], seed: 42, state: 'explore', allowFixtures: true});
  for (const mutate of [
    (p: typeof pack) => Object.assign(p.assets[0]!, {title: 'Metadata changed'}),
    (p: typeof pack) => Object.assign(p.assets[0]!.file, {sha256: 'a'.repeat(64)}),
    (p: typeof pack) => Object.assign(p, {revision: 2}),
  ]) {
    const changed = structuredClone(pack); mutate(changed);
    await assert.rejects(resolveRecipeReplay(changed, saved, {allowFixtures: true}), LibraryError);
  }
  for (const changed of [
    {...saved, seed: 97}, {...saved, state: 'drive'},
    {...saved, performer: {id: 'unknown-performer', revision: 1}}, {...saved, plan_sha256: '0'.repeat(64)},
  ]) await assert.rejects(resolveRecipeReplay(pack, changed, {allowFixtures: true}), /no longer reproduces/);
  await assert.rejects(resolveRecipeReplay(pack, {...saved, events: []}, {allowFixtures: true}), /unknown or missing/);
});
