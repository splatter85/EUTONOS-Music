/**
 * Bounded local metadata, saved recipes and renderer-observation history.
 * No media bytes, transport, command receipts or executable schedules are restored.
 * Import this module directly; it is deliberately outside the S09 demo dependency graph.
 */
import {validatePackManifest} from './pack.js';
import type {AudioPack} from './pack-types.js';
import {resolveRecipeReplay, validateRecipeReplay, type RecipeReplay} from './recipe-library.js';
import {boundedPayload, canonicalJson, digestJson, freeze, hash, identifier, integer, LibraryError,
  object, requireLibrary, sameRef, text} from './library-codec.js';

export const LIBRARY_VERSION = 'em.music-library.v1' as const;
export const LIBRARY_LIMITS = Object.freeze({catalogue: 16, vibes: 64, history: 256});
/** CAS compares the entire previously validated payload, including null for an absent store.
 * Pre-commit failures preserve prior bytes. After any storage error, re-read to reconcile.
 * Hashing/validation precedes transactions. */
export interface LibraryStorage {
  read(): Promise<string | null>;
  compareAndSwap(expected: string | null, next: string): Promise<boolean>;
}
export interface CatalogueEntry {
  readonly pack: AudioPack;
  readonly sha256: string;
}
export interface SavedVibe {
  readonly id: string;
  readonly label: string;
  readonly replay: RecipeReplay;
}
export interface LibraryPreferences {
  readonly volume: number;
  readonly muted: boolean;
}
/** A caller's renderer observation, never a claim of physical output or human listening.
 * Stable IDs deduplicate within the retained window only; dropped IDs are not a ledger. */
export interface PlaybackObservation {
  readonly id: string;
  readonly playback_id: string;
  readonly observed_at: string;
  readonly kind: 'started' | 'ended' | 'stopped';
  readonly engine_generation: number;
  readonly at_frame: number;
  readonly replay: RecipeReplay;
}
export interface MusicLibrarySnapshot {
  readonly schema_version: typeof LIBRARY_VERSION;
  readonly revision: number;
  readonly catalogue: readonly CatalogueEntry[];
  readonly vibes: readonly SavedVibe[];
  readonly preferences: LibraryPreferences;
  readonly history: readonly PlaybackObservation[];
  readonly dropped_history: number;
}
function array(value: unknown, limit: number): unknown[] {
  requireLibrary(Array.isArray(value), 'expected an array');
  requireLibrary(value.length <= limit, 'collection limit exceeded', 'limit');
  return value;
}
function unique(values: readonly string[]): void {
  requireLibrary(new Set(values).size === values.length, 'duplicate identities');
}
function preferences(input: unknown): LibraryPreferences {
  const item = object(input, ['volume', 'muted']);
  requireLibrary(typeof item.volume === 'number' && Number.isFinite(item.volume) &&
    item.volume >= 0 && item.volume <= 1 && typeof item.muted === 'boolean', 'invalid volume or mute');
  return {volume: item.volume, muted: item.muted};
}
function savedVibe(input: unknown): SavedVibe {
  const item = object(input, ['id', 'label', 'replay']);
  return {id: identifier(item.id), label: text(item.label), replay: validateRecipeReplay(item.replay)};
}
function observation(input: unknown): PlaybackObservation {
  const item = object(input, ['id', 'playback_id', 'observed_at', 'kind', 'engine_generation', 'at_frame', 'replay']);
  const when = text(item.observed_at, 24), parsed = Date.parse(when);
  requireLibrary(Number.isFinite(parsed) && new Date(parsed).toISOString() === when, 'use canonical UTC observation time');
  requireLibrary(item.kind === 'started' || item.kind === 'ended' || item.kind === 'stopped',
    'history accepts renderer observations, not accepted or scheduled requests');
  return {id: identifier(item.id), playback_id: identifier(item.playback_id), observed_at: when,
    kind: item.kind, engine_generation: integer(item.engine_generation), at_frame: integer(item.at_frame),
    replay: validateRecipeReplay(item.replay)};
}
function checkReplayReference(replay: RecipeReplay, catalogue: readonly CatalogueEntry[]): void {
  const entry = catalogue.find(item => sameRef(item.pack, replay.pack) && item.sha256 === replay.pack_sha256);
  requireLibrary(entry, 'replay references an absent exact catalogue revision', 'unavailable');
  const recipe = entry.pack.recipes.find(item => sameRef(item, replay.recipe));
  requireLibrary(recipe && sameRef(recipe.palette, replay.palette),
    'replay recipe or palette reference is absent', 'unavailable');
}
/** Deep validation never promotes catalogue metadata to installed, reviewed or decoded audio. */
export async function validateLibrarySnapshot(input: unknown): Promise<MusicLibrarySnapshot> {
  boundedPayload(canonicalJson(input));
  const item = object(input, ['schema_version', 'revision', 'catalogue', 'vibes', 'preferences', 'history', 'dropped_history']);
  requireLibrary(item.schema_version === LIBRARY_VERSION, 'unsupported library schema; retain original data', 'version');
  const catalogue: CatalogueEntry[] = [];
  for (const raw of array(item.catalogue, LIBRARY_LIMITS.catalogue)) {
    const entry = object(raw, ['pack', 'sha256']);
    const pack = validatePackManifest(entry.pack), expected = hash(entry.sha256);
    requireLibrary(await digestJson(pack) === expected, 'catalogue metadata digest mismatch');
    catalogue.push({pack, sha256: expected});
  }
  unique(catalogue.map(entry => entry.pack.id + '@' + entry.pack.revision));
  const vibes = array(item.vibes, LIBRARY_LIMITS.vibes).map(savedVibe);
  const history = array(item.history, LIBRARY_LIMITS.history).map(observation);
  unique(vibes.map(vibe => vibe.id));
  unique(history.map(event => event.id));
  for (const value of [...vibes, ...history]) checkReplayReference(value.replay, catalogue);
  return freeze({
    schema_version: LIBRARY_VERSION, revision: integer(item.revision), catalogue, vibes,
    preferences: preferences(item.preferences), history, dropped_history: integer(item.dropped_history),
  });
}
export function emptyLibrary(): MusicLibrarySnapshot {
  return freeze({schema_version: LIBRARY_VERSION, revision: 0, catalogue: [], vibes: [],
    preferences: {volume: 0.7, muted: false}, history: [], dropped_history: 0});
}
export async function decodeLibrarySnapshot(raw: string | null): Promise<MusicLibrarySnapshot> {
  if (raw === null) return emptyLibrary();
  boundedPayload(raw);
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { throw new LibraryError('invalid', 'invalid library JSON; original data was retained'); }
  return validateLibrarySnapshot(input);
}

/** One small versioned snapshot, with atomic adapters. No automatic reset or merge on conflict. */
export class MusicLibrary {
  constructor(private readonly storage: LibraryStorage) {}
  async read(): Promise<MusicLibrarySnapshot> { return decodeLibrarySnapshot(await this.storage.read()); }

  async registerPack(input: AudioPack, expectedRevision: number): Promise<MusicLibrarySnapshot> {
    const pack = validatePackManifest(input), sha256 = await digestJson(pack);
    return this.change(expectedRevision, current => {
      const prior = current.catalogue.find(entry => sameRef(entry.pack, pack));
      if (prior) {
        requireLibrary(prior.sha256 === sha256, 'pack metadata changed without a new revision', 'conflict');
        return null;
      }
      requireLibrary(current.catalogue.length < LIBRARY_LIMITS.catalogue, 'catalogue is full', 'limit');
      return {...current, catalogue: [...current.catalogue, {pack, sha256}]};
    });
  }
  async saveVibe(input: SavedVibe, expectedRevision: number): Promise<MusicLibrarySnapshot> {
    const vibe = savedVibe(input);
    return this.change(expectedRevision, current => {
      const previous = current.vibes.find(item => item.id === vibe.id);
      if (previous && canonicalJson(previous) === canonicalJson(vibe)) return null;
      requireLibrary(previous || current.vibes.length < LIBRARY_LIMITS.vibes, 'saved-vibe limit reached', 'limit');
      return {...current, vibes: previous ? current.vibes.map(item => item.id === vibe.id ? vibe : item) :
        [...current.vibes, vibe]};
    });
  }
  async removeVibe(id: string, expectedRevision: number): Promise<MusicLibrarySnapshot> {
    identifier(id);
    return this.change(expectedRevision, current =>
      current.vibes.some(item => item.id === id) ? {...current, vibes: current.vibes.filter(item => item.id !== id)} : null);
  }
  async setPreferences(input: LibraryPreferences, expectedRevision: number): Promise<MusicLibrarySnapshot> {
    const next = preferences(input);
    return this.change(expectedRevision, current =>
      canonicalJson(next) === canonicalJson(current.preferences) ? null : {...current, preferences: next});
  }
  async recordObservation(input: PlaybackObservation, expectedRevision: number): Promise<MusicLibrarySnapshot> {
    const event = observation(input);
    return this.change(expectedRevision, current => {
      const prior = current.history.find(item => item.id === event.id);
      if (prior) {
        requireLibrary(canonicalJson(prior) === canonicalJson(event), 'observation ID has different content', 'conflict');
        return null; // Recover an identical retained event before checking a stale caller revision.
      }
      const history = [...current.history, event], dropped = Math.max(0, history.length - LIBRARY_LIMITS.history);
      return {...current, history: history.slice(dropped), dropped_history: current.dropped_history + dropped};
    });
  }
  /** Selection and preferences only. Never acquires an audio owner or executes a schedule. */
  async restore(id: string): Promise<{
    readonly transport: 'stopped'; readonly requires_explicit_play: true;
    readonly vibe: SavedVibe; readonly preferences: LibraryPreferences;
  }> {
    identifier(id);
    const current = await this.read(), vibe = current.vibes.find(item => item.id === id);
    requireLibrary(vibe, 'saved vibe not found', 'unavailable');
    return freeze({transport: 'stopped', requires_explicit_play: true, vibe, preferences: current.preferences});
  }
  /** Resolve against CURRENT supplied metadata; callers still load/verify media before playback. */
  async resolveVibe(id: string, currentPack: AudioPack, options: {readonly allowFixtures?: boolean} = {}) {
    const restored = await this.restore(id);
    return resolveRecipeReplay(currentPack, restored.vibe.replay, options);
  }
  private async change(expectedRevision: number,
    update: (current: MusicLibrarySnapshot) => MusicLibrarySnapshot | null): Promise<MusicLibrarySnapshot> {
    integer(expectedRevision);
    const raw = await this.storage.read(), current = await decodeLibrarySnapshot(raw), proposal = update(current);
    if (proposal === null) return current;
    requireLibrary(current.revision === expectedRevision, 'library revision changed; reload before retrying', 'conflict');
    const next = await validateLibrarySnapshot({...proposal, revision: integer(current.revision + 1)});
    const encoded = boundedPayload(canonicalJson(next) + '\n');
    requireLibrary(await this.storage.compareAndSwap(raw, encoded), 'another writer changed the library', 'conflict');
    return next;
  }
}
