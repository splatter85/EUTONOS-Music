import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {planHybridHandoff} from '../src/hybrid-handoff.js';
import {reportTransitionCoverage, selectNextVibe} from '../src/library-breadth.js';
import {MusicLibrary, emptyLibrary, type LibraryStorage, type PlaybackObservation} from '../src/library.js';
import {captureRecipeReplay, createRecipeBreadthPack, createRecipeStudyPack, resolveRecipeReplay, type RecipeReplay} from '../src/recipe-library.js';
import {compilePhrase, compileS01Phrase, ROLE_MAX_QUARTERS, S01_RECIPE, S11_ALL_RECIPE_FAMILIES} from '../src/phrase-plan.js';
import {WebAudioClock} from '../src/web-audio.js';
import {ContextDouble} from './audio-double.js';

const raw = JSON.parse(await readFile(new URL('../../fixtures/s01/manifest.json', import.meta.url), 'utf8'));
const pack = createRecipeBreadthPack(raw, {id: 'breadth-study-pack', revision: 1}, S01_RECIPE);
class MemoryStorage implements LibraryStorage {
  value: string | null = null;
  async read() { return this.value; }
  async compareAndSwap(before: string | null, next: string) {
    if (before !== this.value) return false;
    this.value = next;
    return true;
  }
}
async function populated() {
  const library = new MusicLibrary(new MemoryStorage());
  let state = await library.registerPack(pack, 0);
  const replays = new Map<string, RecipeReplay>();
  for (const family of S11_ALL_RECIPE_FAMILIES) {
    const replay = await captureRecipeReplay(pack, {recipe: family, seed: 42, state: 'explore', allowFixtures: true});
    state = await library.saveVibe({id: family.id, label: family.title, replay}, state.revision);
    replays.set(family.id, replay);
  }
  return {library, state, replays};
}
function observation(id: string, replay: RecipeReplay, kind: PlaybackObservation['kind'] = 'started',
  playback_id = id): PlaybackObservation {
  return {id, playback_id, replay, kind, observed_at: '2026-11-16T15:00:00.000Z',
    engine_generation: 1, at_frame: 128};
}

test('study bridge preflight refuses every S11 pattern with a policy-specific reason, preserving legacy S05', () => {
  const clock = new WebAudioClock(new ContextDouble(48000).audio);
  const start = {at: clock.stamp(4800), entryCueId: 'entry'};
  const original = compileS01Phrase(raw, {seed: 42, state: 'explore', allowFixtures: true});
  assert.equal(planHybridHandoff(raw, 's01-a-to-b', original, 'phrase', start, clock, true).policy.id,
    's05-hybrid-handoff');
  for (const recipe of S11_ALL_RECIPE_FAMILIES) for (const exit of ['phrase', 'end'] as const) {
    const plan = compilePhrase(pack, {recipe, seed: 42, state: 'explore', allowFixtures: true});
    assert.throws(() => planHybridHandoff(pack, 's01-a-to-b', plan, exit, start, clock, true),
      /S11 study recipes cannot act as hybrid bridges: no study-specific percussion-only lead-in\/tail policy/);
  }
});

test('eight original study descriptors are JSON data, distinct genres, and explicitly unauditioned', () => {
  assert.equal(S11_ALL_RECIPE_FAMILIES.length, 8);
  assert.equal(new Set(S11_ALL_RECIPE_FAMILIES.map(f => f.genre)).size, 8);
  assert.equal(new Set(S11_ALL_RECIPE_FAMILIES.map(f => f.id)).size, 8);
  for (const f of S11_ALL_RECIPE_FAMILIES) {
    assert.equal(f.listening, 'not-tested');
    assert.ok(f.transitionTo.length > 0);
    assert.ok(f.transitionTo.every(target => S11_ALL_RECIPE_FAMILIES.some(other => other.style === target)));
    assert.equal(typeof f.description, 'string');
    assert.ok(!JSON.stringify(f).includes('function'));
    assert.ok(Object.isFrozen(f) && Object.isFrozen(f.transitionTo));
    assert.deepEqual(pack.recipes.find(recipe => recipe.id === f.id)?.genres, [f.genre]);
  }
  assert.deepEqual(pack.routes, raw.routes, 'no bridge routes or claimed authorizations are added');
  assert.deepEqual(pack.assets, raw.assets, 'no media or rights are added');
});

test('EMF12 ignores endings and deduplicates starts, prefers unseen recipes, then least recent', async () => {
  const {library, replays} = await populated();
  const first = selectNextVibe(await library.read());
  assert.equal(first?.reason, 'no-start-history');
  assert.equal(first?.vibe.id, 's11-broken-current', 'stable id tie-break');
  let snapshot = await library.read();
  const used = S11_ALL_RECIPE_FAMILIES.map(f => f.id);
  for (let i = 0; i < used.length; i++) {
    const id = used[i]!;
    snapshot = await library.recordObservation(observation('start-' + i, replays.get(id)!, 'started', 'play-' + i),
      snapshot.revision);
    snapshot = await library.recordObservation(observation('end-' + i, replays.get(id)!, 'ended', 'play-' + i),
      snapshot.revision);
  }
  assert.equal(selectNextVibe(snapshot)?.vibe.id, used[0]);
  assert.equal(selectNextVibe(snapshot)?.reason, 'least-recent-fallback');
  assert.equal(selectNextVibe(snapshot)?.observed_starts_considered, used.length);
  assert.equal(selectNextVibe(snapshot)?.last_seen_index, used.length - 1);
  assert.equal(selectNextVibe(snapshot, 1)?.vibe.id, 's11-broken-current',
    'bounded window does not interpret old ends as recent playback');
  // A second start event with the same playback identity does not inflate recency.
  const dup = await library.recordObservation(observation('start-duplicate', replays.get(used[0]!)!, 'started', 'play-0'),
    snapshot.revision);
  assert.equal(selectNextVibe(dup)?.observed_starts_considered, used.length);
  assert.throws(() => selectNextVibe(dup, 0), /lookback/);
  assert.throws(() => selectNextVibe(dup, 33), /lookback/);
  assert.equal(selectNextVibe(emptyLibrary()), null);
});

test('EMF12 avoids repeating the same recipe under different saved seed or vibe IDs', async () => {
  const {library, state, replays} = await populated();
  // Replaying a changed seed would fail the saved digest, so capture an actual one.
  const alias = await captureRecipeReplay(pack, {recipe: S11_ALL_RECIPE_FAMILIES[0]!, seed: 17,
    state: 'drive', allowFixtures: true});
  const withAlias = await library.saveVibe({id: 'another-label', label: 'Same recipe, other seed', replay: alias},
    state.revision);
  const snap = await library.recordObservation(observation('first', replays.get(S11_ALL_RECIPE_FAMILIES[0]!.id)!),
    withAlias.revision);
  const picks = [selectNextVibe(snap)!.vibe.id];
  assert.notEqual(picks[0], 'another-label');
  assert.notEqual(picks[0], S11_ALL_RECIPE_FAMILIES[0]!.id);
});

test('EMF13 diagnoses directed declared-style gaps and unknown legacy recipes without claiming listening', async () => {
  const {library} = await populated();
  const report = reportTransitionCoverage(await library.read());
  assert.equal(report.schema_version, 'em.transition-coverage.v1');
  assert.equal(report.basis, 'declarative-only-not-listening-tested');
  assert.equal(report.nodes.length, 9, 'eight study styles plus the unprofiled source recipe');
  assert.equal(report.total_pairs, 9 * 8);
  assert.equal(report.total_pairs, report.metadata_candidates + report.gaps);
  assert.ok(report.metadata_candidates > 0 && report.gaps > 0);
  const edge = (from: string, to: string) => report.edges.find(e => e.from.genre === from && e.to.genre === to);
  assert.equal(edge('ambient-study', 'house-study')?.verdict, 'metadata-candidate');
  assert.equal(edge('house-study', 'ambient-study')?.verdict, 'gap');
  assert.deepEqual(edge('house-study', 'ambient-study')?.reasons, ['no-declared-style-handoff']);
  assert.equal(edge('downtempo-study', 'cinematic-study')?.verdict, 'metadata-candidate');
  assert.equal(edge('electro-study', 'cinematic-study')?.verdict, 'gap');
  const legacyGenre = raw.recipes[0].genres[0] as string;
  assert.equal(edge(legacyGenre, 'house-study')?.verdict, 'gap');
  assert.ok(edge(legacyGenre, 'house-study')?.reasons.includes('undocumented-style'));
  assert.equal(reportTransitionCoverage(emptyLibrary()).total_pairs, 0);
});

test('existing three-study pack and replay remain valid under the original versioned identity', async () => {
  const legacy = createRecipeStudyPack(raw, {id: 's11-original-studies', revision: 1}, S01_RECIPE);
  assert.equal(legacy.recipes.length, raw.recipes.length + 3);
  assert.equal(pack.recipes.length, raw.recipes.length + 8);
  assert.equal(pack.recipes.filter(recipe => !legacy.recipes.some(old => old.id === recipe.id)).length, 5);
  const original = S11_ALL_RECIPE_FAMILIES[0]!;
  const saved = await captureRecipeReplay(legacy, {recipe: original, seed: 0, state: 'explore', allowFixtures: true});
  const restored = await resolveRecipeReplay(legacy, saved, {allowFixtures: true});
  assert.deepEqual(restored.recipe, {id: original.id, revision: 1});
  await assert.rejects(resolveRecipeReplay(pack, saved, {allowFixtures: true}), /exact pack metadata/);
  assert.throws(() => createRecipeBreadthPack(legacy, {id: 'invalid-derived', revision: 1}, S01_RECIPE),
    /reserved S11 study or breadth recipe/);
});

test('all eight declarative performers preserve role windows, phrase bounds and deterministic seed replay', () => {
  const seeds = [0, 42, 104729, 0xffffffff,
    ...Array.from({length: 64}, (_, i) => Math.imul(i + 1, 0x9e3779b9) >>> 0)];
  for (const state of ['explore', 'drive'] as const) for (const seed of seeds) {
    const plans = S11_ALL_RECIPE_FAMILIES.map(recipe =>
      compilePhrase(pack, {recipe, state, seed, allowFixtures: true}));
    const signatures = plans.map(plan => JSON.stringify(plan.events.map(e => [e.role, e.atQuarters])));
    assert.equal(new Set(signatures).size, plans.length);
    for (const plan of plans) {
      assert.equal(plan.events.length > 0 && plan.events.length <= 256, true);
      const endings = new Map<string, number>();
      for (const event of plan.events) {
        assert.ok(Number.isInteger(event.atQuarters * 4) && event.gain > 0 && event.gain <= 1);
        assert.ok(event.atQuarters >= (endings.get(event.role) ?? 0), 'same-role sample overlap');
        const end = event.atQuarters + ROLE_MAX_QUARTERS[event.role];
        assert.ok(end <= (event.atQuarters < 16 ? 16 : 32), 'event crosses a phrase exit');
        endings.set(event.role, end);
      }
      assert.equal(endings.size, 4);
    }
  }
});
