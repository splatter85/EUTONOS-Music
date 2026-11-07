/**
 * S11 recipe catalogue and symbolic replay. Metadata does not prove media availability,
 * physical output or listening. Load/verify pack bytes through the existing loaders.
 */
import {validatePackManifest} from './pack.js';
import type {AudioPack, VersionRef} from './pack-types.js';
import {compilePhrase, S11_RECIPE_FAMILIES, type CompilePhraseOptions, type ProceduralPlan,
  type S01PhraseState} from './phrase-plan.js';
import {digestJson, freeze, hash, integer, object, requireLibrary, sameRef, versionRef} from './library-codec.js';

export interface RecipeReplay {
  readonly schema_version: 'em.recipe-replay.v1';
  readonly pack: VersionRef;
  readonly recipe: VersionRef;
  readonly palette: VersionRef;
  readonly performer: VersionRef;
  readonly pack_sha256: string;
  readonly plan_sha256: string;
  readonly seed: number;
  readonly state: S01PhraseState;
}

/** Derive a NEW manifest identity; never relabel or mutate the source pack revision.
 * Assets, file paths and rights are retained. The caller supplies the same verified
 * media when loading the derived pack. No listening approval or route is invented. */
export function createRecipeStudyPack(input: AudioPack, identity: VersionRef, template: VersionRef): AudioPack {
  const pack = validatePackManifest(input), next = versionRef(identity), wanted = versionRef(template);
  requireLibrary(!sameRef(pack, next), 'recipe studies need a new pack identity', 'conflict');
  const base = pack.recipes.find(item => sameRef(item, wanted));
  requireLibrary(base, 'template recipe revision is unavailable', 'unavailable');
  requireLibrary(!pack.recipes.some(item => S11_RECIPE_FAMILIES.some(family => item.id === family.id)),
    'source already contains a reserved S11 recipe identity', 'conflict');
  return freeze(validatePackManifest({...pack, ...next, recipes: [...pack.recipes,
    ...S11_RECIPE_FAMILIES.map(family => ({...base, id: family.id, revision: family.revision,
      genres: [family.genre]}))]}));
}

export function validateRecipeReplay(input: unknown): RecipeReplay {
  const item = object(input, ['schema_version', 'pack', 'recipe', 'palette', 'performer',
    'pack_sha256', 'plan_sha256', 'seed', 'state']);
  requireLibrary(item.schema_version === 'em.recipe-replay.v1', 'unsupported replay schema', 'version');
  requireLibrary(item.state === 'explore' || item.state === 'drive', 'unsupported replay state');
  return freeze({
    schema_version: 'em.recipe-replay.v1',
    pack: versionRef(item.pack), recipe: versionRef(item.recipe), palette: versionRef(item.palette),
    performer: versionRef(item.performer), pack_sha256: hash(item.pack_sha256),
    plan_sha256: hash(item.plan_sha256), seed: integer(item.seed, 0, 0xffffffff), state: item.state,
  });
}

/** Capture immutable recipe/performer/metadata/event identity, not serialized executable events. */
export async function captureRecipeReplay(input: AudioPack, options: CompilePhraseOptions): Promise<RecipeReplay> {
  const pack = validatePackManifest(input), plan = compilePhrase(pack, options);
  return validateRecipeReplay({
    schema_version: 'em.recipe-replay.v1',
    pack: plan.pack, recipe: plan.recipe, palette: plan.palette, performer: plan.performer,
    pack_sha256: await digestJson(pack), plan_sha256: await digestJson(plan),
    seed: plan.seed, state: plan.state,
  });
}

/** Caller must explicitly opt into fixtures each time. Nothing restores playback authority.
 * Matching symbolic plans is promised; byte-identical audio is a separate renderer check. */
export async function resolveRecipeReplay(input: AudioPack, saved: unknown,
  options: {readonly allowFixtures?: boolean} = {}): Promise<ProceduralPlan> {
  const replay = validateRecipeReplay(saved), pack = validatePackManifest(input);
  requireLibrary(sameRef(pack, replay.pack) && await digestJson(pack) === replay.pack_sha256,
    'exact pack metadata is unavailable or changed; historical replay was retained', 'unavailable');
  const plan = compilePhrase(pack, {recipe: replay.recipe, seed: replay.seed, state: replay.state,
    ...(options.allowFixtures === undefined ? {} : {allowFixtures: options.allowFixtures})});
  requireLibrary(sameRef(plan.palette, replay.palette) && sameRef(plan.performer, replay.performer) &&
    await digestJson(plan) === replay.plan_sha256,
  'recipe, palette or performer no longer reproduces this exact symbolic plan', 'unavailable');
  return plan;
}
