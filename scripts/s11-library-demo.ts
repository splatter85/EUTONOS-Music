/**
 * S11 persistence/recipe example, independent of the S09 UI:
 * npm run build
 * node dist/scripts/s11-library-demo.js [--directory LOCAL_DIRECTORY]
 *
 * Saves eight original fixture studies and restores their symbolic identities stopped.
 * It verifies source WAVs, never creates live audio, and does not invent playback history.
 * The default local/ directory is ignored by Git. No FL Studio or agent is required.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {loadPack} from '../src/node.js';
import {FileLibraryStorage} from '../src/library-file.js';
import {MusicLibrary} from '../src/library.js';
import {reportTransitionCoverage, selectNextVibe} from '../src/library-breadth.js';
import {captureRecipeReplay, createRecipeBreadthPack} from '../src/recipe-library.js';
import {S01_RECIPE, S11_ALL_RECIPE_FAMILIES} from '../src/phrase-plan.js';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--directory' || !args[1])) {
  throw new Error('Usage: node dist/scripts/s11-library-demo.js [--directory LOCAL_DIRECTORY]');
}
const directory = args[1] ? resolve(args[1]) : fileURLToPath(new URL('../../local/s11-library', import.meta.url));
const loaded = await loadPack(fileURLToPath(new URL('../../fixtures/s01', import.meta.url)));
const pack = createRecipeBreadthPack(loaded.pack, {id: 's11-original-breadth', revision: 1}, S01_RECIPE);
const storage = await FileLibraryStorage.open(directory), library = new MusicLibrary(storage);
let snapshot = await library.read();
snapshot = await library.registerPack(pack, snapshot.revision);
const restored = [];
for (const recipe of S11_ALL_RECIPE_FAMILIES) {
  const replay = await captureRecipeReplay(pack, {recipe, seed: 42, state: 'explore', allowFixtures: true});
  const vibeId = 'breadth-' + recipe.id; // Do not replace historical saved study selections.
  snapshot = await library.saveVibe({id: vibeId, label: recipe.title, replay}, snapshot.revision);
  const plan = await library.resolveVibe(vibeId, pack, {allowFixtures: true});
  const selection = await library.restore(vibeId);
  restored.push({name: recipe.title, recipe: plan.recipe, performer: plan.performer, seed: plan.seed,
    events: plan.events.length, transport: selection.transport, requires_explicit_play: selection.requires_explicit_play});
}
const coverage = reportTransitionCoverage(snapshot);
const suggestion = selectNextVibe(snapshot);
console.log(JSON.stringify({directory, revision: snapshot.revision, restored,
  recency: suggestion ? {vibe: suggestion.vibe.id, reason: suggestion.reason} : null,
  transition_coverage: {
    basis: coverage.basis, total_pairs: coverage.total_pairs,
    metadata_candidates: coverage.metadata_candidates, gaps: coverage.gaps,
    missing_pairs: coverage.edges.filter(edge => edge.verdict === 'gap').map(edge => ({
      from: edge.from.genre, to: edge.to.genre, reasons: edge.reasons})),
  },
  media: 'Original S01 fixture WAVs verified; no new media produced.',
  listening: 'Not tested. No playback observation was added and no transitions were scheduled.'}, null, 2));
