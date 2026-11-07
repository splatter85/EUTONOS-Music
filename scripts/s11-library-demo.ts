/**
 * S11 persistence/recipe example, independent of the S09 UI:
 * npm run build
 * node dist/scripts/s11-library-demo.js [--directory LOCAL_DIRECTORY]
 *
 * Saves three original fixture studies and restores their symbolic identities stopped.
 * It verifies source WAVs, never creates live audio, and does not invent playback history.
 * The default local/ directory is ignored by Git. No FL Studio or agent is required.
 */
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {loadPack} from '../src/node.js';
import {FileLibraryStorage} from '../src/library-file.js';
import {MusicLibrary} from '../src/library.js';
import {captureRecipeReplay, createRecipeStudyPack} from '../src/recipe-library.js';
import {S01_RECIPE, S11_RECIPE_FAMILIES} from '../src/phrase-plan.js';

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--directory' || !args[1])) {
  throw new Error('Usage: node dist/scripts/s11-library-demo.js [--directory LOCAL_DIRECTORY]');
}
const directory = args[1] ? resolve(args[1]) : fileURLToPath(new URL('../../local/s11-library', import.meta.url));
const loaded = await loadPack(fileURLToPath(new URL('../../fixtures/s01', import.meta.url)));
const pack = createRecipeStudyPack(loaded.pack, {id: 's11-original-studies', revision: 1}, S01_RECIPE);
const storage = await FileLibraryStorage.open(directory), library = new MusicLibrary(storage);
let snapshot = await library.read();
snapshot = await library.registerPack(pack, snapshot.revision);
const restored = [];
for (const recipe of S11_RECIPE_FAMILIES) {
  const replay = await captureRecipeReplay(pack, {recipe, seed: 42, state: 'explore', allowFixtures: true});
  snapshot = await library.saveVibe({id: recipe.id, label: recipe.title, replay}, snapshot.revision);
  const plan = await library.resolveVibe(recipe.id, pack, {allowFixtures: true});
  const selection = await library.restore(recipe.id);
  restored.push({name: recipe.title, recipe: plan.recipe, performer: plan.performer, seed: plan.seed,
    events: plan.events.length, transport: selection.transport, requires_explicit_play: selection.requires_explicit_play});
}
console.log(JSON.stringify({directory, revision: snapshot.revision, restored,
  media: 'Original S01 fixture WAVs verified; no new media produced.',
  listening: 'Not tested. No playback observation was added.'}, null, 2));
