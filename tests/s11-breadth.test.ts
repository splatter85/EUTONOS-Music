import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {FileLibraryStorage} from '../src/library-file.js';
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
    snapshot = await library.recordObservation({...observation('start-' + i, replays.get(id)!, 'started', 'play-' + i),
      observed_at: new Date(Date.UTC(2026, 10, 16, 15, i)).toISOString()}, snapshot.revision);
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

// Review regressions use actual library writes, so manifests, digests and timestamps
// satisfy the storage contract rather than relying on unchecked snapshot stubs.
async function genreLibrary(count: number, storage = new MemoryStorage(), reverse = false) {
  const library = new MusicLibrary(storage);
  let snapshot = await library.read();
  const indices = Array.from({length: Math.ceil(count / 12)}, (_, i) => i);
  for (const index of reverse ? indices.reverse() : indices) {
    const input = structuredClone(raw);
    input.id = 'review-genres-' + index;
    const genres = Array.from({length: Math.min(12, count - index * 12)}, (_, i) =>
      'review-genre-' + String(index * 12 + i).padStart(2, '0'));
    input.recipes[0].genres = reverse ? genres.reverse() : genres;
    snapshot = await library.registerPack(input, snapshot.revision);
  }
  return snapshot;
}
async function recencyPair() {
  const library = new MusicLibrary(new MemoryStorage());
  let snapshot = await library.registerPack(pack, 0);
  const replays = [];
  for (const [index, recipe] of S11_ALL_RECIPE_FAMILIES.slice(0, 2).entries()) {
    const replay = await captureRecipeReplay(pack, {recipe, seed: 42, state: 'explore', allowFixtures: true});
    replays.push(replay);
    snapshot = await library.saveVibe({id: index === 0 ? 'a-study' : 'b-study', label: recipe.title, replay},
      snapshot.revision);
  }
  return {library, snapshot, a: replays[0]!, b: replays[1]!};
}

test('EMF13 review: 36 valid genre nodes produce bounded, explicitly partial coverage without mutation', async () => {
  const snapshot = await genreLibrary(36), before = JSON.stringify(snapshot);
  const report = reportTransitionCoverage(snapshot);
  assert.equal(report.nodes.length, 32);
  assert.equal(report.edges.length, 32 * 31);
  assert.deepEqual(report, {...report, complete: false, node_limit: 32, total_nodes: 36, omitted_nodes: 4,
    possible_pairs: 36 * 35, unevaluated_pairs: 36 * 35 - 32 * 31});
  assert.equal(report.total_pairs, report.edges.length);
  assert.equal(report.metadata_candidates + report.gaps, report.total_pairs);
  assert.equal(report.gaps, 32 * 31, 'unprofiled evaluated pairs are gaps, not omitted pairs');
  assert.deepEqual(report.nodes.map(n => n.genre), Array.from({length: 32}, (_, i) =>
    'review-genre-' + String(i).padStart(2, '0')));
  assert.equal(JSON.stringify(snapshot), before);
  assert.deepEqual(reportTransitionCoverage(await genreLibrary(36, new MemoryStorage(), true)), report,
    'node selection and report are independent of catalogue and genre insertion order');
});

test('EMF13 review: empty, singleton and exactly 32 nodes have complete, reconciled counts', async () => {
  for (const count of [0, 1, 32]) {
    const report = reportTransitionCoverage(await genreLibrary(count));
    const pairs = count * Math.max(0, count - 1);
    assert.deepEqual(report, {...report, complete: true, node_limit: 32, total_nodes: count, omitted_nodes: 0,
      possible_pairs: pairs, unevaluated_pairs: 0});
    assert.equal(report.nodes.length, count);
    assert.equal(report.total_pairs, pairs);
    assert.equal(report.metadata_candidates + report.gaps, report.total_pairs);
  }
});

test('EMF13 review: the 33rd node is omitted explicitly rather than throwing or inventing gaps', async () => {
  const report = reportTransitionCoverage(await genreLibrary(33));
  assert.deepEqual(report, {...report, complete: false, node_limit: 32, total_nodes: 33, omitted_nodes: 1,
    possible_pairs: 33 * 32, unevaluated_pairs: 64});
  assert.equal(report.total_pairs, 32 * 31);
  assert.ok(report.edges.every(edge => edge.from.genre !== 'review-genre-32' && edge.to.genre !== 'review-genre-32'));
});

test('EMF12 review: delayed older starts do not displace the newest timestamp, including lookback one', async () => {
  const {library, a, b, snapshot: initial} = await recencyPair();
  let snapshot = await library.recordObservation({...observation('newer', b),
    observed_at: '2026-11-16T14:00:00.000Z'}, initial.revision);
  snapshot = await library.recordObservation({...observation('older-delayed', a),
    observed_at: '2026-11-16T12:00:00.000Z'}, snapshot.revision);
  snapshot = await library.recordObservation({...observation('latest-end', a, 'ended'),
    observed_at: '2026-11-16T16:00:00.000Z'}, snapshot.revision);
  snapshot = await library.recordObservation({...observation('latest-stop', a, 'stopped'),
    observed_at: '2026-11-16T17:00:00.000Z'}, snapshot.revision);
  const before = JSON.stringify(snapshot);
  for (const lookback of [1, 2, 8]) {
    const choice = selectNextVibe(snapshot, lookback)!;
    assert.equal(choice.vibe.id, 'a-study', 'B really started most recently, regardless of write order');
    assert.equal(choice.reason, lookback === 1 ? 'not-in-recent-starts' : 'least-recent-fallback');
    assert.equal(choice.observed_starts_considered, Math.min(lookback, 2));
  }
  assert.equal(JSON.stringify(snapshot), before, 'sorting must not change persisted history');
});

test('EMF12 review: equal timestamps use stable observation IDs, independent of arrival order', async () => {
  for (const reverse of [false, true]) {
    const {library, a, b, snapshot: initial} = await recencyPair();
    let snapshot = initial;
    const starts = [observation('a-observation', a), observation('b-observation', b)];
    for (const event of reverse ? starts.reverse() : starts) {
      snapshot = await library.recordObservation(event, snapshot.revision);
    }
    assert.equal(selectNextVibe(snapshot, 1)?.vibe.id, 'b-study', 'ascending ID wins the timestamp tie');
    assert.equal(selectNextVibe(snapshot, 2)?.vibe.id, 'b-study');
    assert.deepEqual(selectNextVibe(snapshot), selectNextVibe(snapshot), 'repeatable on an unchanged snapshot');
  }
});

test('EMF12 review: duplicate playback starts are deduplicated after time ordering and before lookback', async () => {
  const {library, a, b, snapshot: initial} = await recencyPair();
  let snapshot = initial;
  const events = [
    {...observation('newest-b', b, 'started', 'b-play'), observed_at: '2026-11-16T15:00:00.000Z'},
    {...observation('older-a', a, 'started', 'a-play'), observed_at: '2026-11-16T12:00:00.000Z'},
    {...observation('duplicate-b', b, 'started', 'b-play'), observed_at: '2026-11-16T14:00:00.000Z'},
    {...observation('oldest-a-copy', a, 'started', 'a-play'), observed_at: '2026-11-16T11:00:00.000Z'},
  ];
  for (const event of events) snapshot = await library.recordObservation(event, snapshot.revision);
  const choice = selectNextVibe(snapshot, 2)!;
  assert.equal(choice.vibe.id, 'a-study');
  assert.equal(choice.observed_starts_considered, 2);
  assert.equal(choice.last_seen_index, 1);
});

test('EMF13 review: CLI retains partial-coverage diagnostics for a valid oversized library', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'emf-s11-review-'));
  try {
    const storage = await FileLibraryStorage.open(directory);
    const library = new MusicLibrary(storage);
    const initial = await genreLibrary(36);
    let saved = await library.read();
    for (const entry of initial.catalogue) saved = await library.registerPack(entry.pack, saved.revision);
    const cli = spawnSync(process.execPath,
      [fileURLToPath(new URL('../scripts/s11-library-demo.js', import.meta.url)), '--directory', directory],
      {encoding: 'utf8', timeout: 30000});
    assert.equal(cli.error, undefined);
    assert.equal(cli.status, 0, cli.stderr);
    const output = JSON.parse(cli.stdout).transition_coverage;
    assert.equal(output.complete, false);
    assert.equal(output.node_limit, 32);
    assert.equal(output.total_nodes, 45, '36 existing genre nodes plus the nine-node demo pack');
    assert.equal(output.omitted_nodes, 13);
    assert.equal(output.possible_pairs, 45 * 44);
    assert.equal(output.total_pairs, 32 * 31);
    assert.equal(output.unevaluated_pairs, 45 * 44 - 32 * 31);
    assert.equal(output.metadata_candidates + output.gaps, output.total_pairs);
    assert.equal(output.missing_pairs.length, output.gaps);
    assert.equal((await library.read()).catalogue.length, 4, 'original library packs are retained');
  } finally { await rm(directory, {recursive: true, force: true}); }
});
