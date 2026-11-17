/**
 * EMF12/EMF13: pure library advice, never a transport command or audio approval.
 * History contains observed renderer starts, not DJ requests or listener evidence.
 */
import type {MusicLibrarySnapshot, SavedVibe} from './library.js';
import type {RecipeReference, VersionRef} from './pack-types.js';
import {S11_ALL_RECIPE_FAMILIES} from './phrase-plan.js';

const identity = (ref: VersionRef): string => ref.id + '@' + ref.revision;
const recipeIdentity = (vibe: SavedVibe): string => identity(vibe.replay.recipe);
// Code-unit order is independent of host locale and input insertion order.
const compareText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const COVERAGE_NODE_LIMIT = 32;

export interface RecencySelection {
  readonly vibe: SavedVibe;
  readonly reason: 'no-start-history' | 'not-in-recent-starts' | 'least-recent-fallback';
  readonly observed_starts_considered: number;
  /** Zero means most recent, null means the recipe is not in the bounded window. */
  readonly last_seen_index: number | null;
}

/**
 * Deterministic advice from retained starts, newest observed_at first. Equal times
 * use ascending observation IDs; neither late arrival nor an end/stop reorders a play.
 * Count recipe identity, not seed/vibe label; ending/stopping a play does not count again.
 * Never excludes every candidate: if all appeared, choose the least recently started.
 * No randomness, storage writes, media access or implicit Play.
 */
export function selectNextVibe(snapshot: MusicLibrarySnapshot, lookback = 8): RecencySelection | null {
  if (!Number.isInteger(lookback) || lookback < 1 || lookback > 32) {
    throw new RangeError('recency lookback must be an integer from 1 to 32');
  }
  if (snapshot.vibes.length === 0) return null;
  // Work on a filtered copy: history retains its storage order and remains immutable.
  // MusicLibrary validates canonical UTC timestamps before producing a snapshot.
  const starts = snapshot.history.filter(entry => entry.kind === 'started')
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at) || compareText(a.id, b.id));
  const seenPlaybacks = new Set<string>(), recent: string[] = [];
  for (const entry of starts) {
    if (seenPlaybacks.has(entry.playback_id)) continue;
    seenPlaybacks.add(entry.playback_id);
    recent.push(identity(entry.replay.recipe));
    if (recent.length === lookback) break;
  }
  const ranked = snapshot.vibes.map(vibe => ({vibe, index: recent.indexOf(recipeIdentity(vibe))}))
    .sort((a, b) => (b.index < 0 ? Infinity : b.index) - (a.index < 0 ? Infinity : a.index) ||
      compareText(a.vibe.id, b.vibe.id));
  const chosen = ranked[0]!;
  return Object.freeze({
    vibe: chosen.vibe,
    reason: recent.length === 0 ? 'no-start-history' :
      chosen.index < 0 ? 'not-in-recent-starts' : 'least-recent-fallback',
    observed_starts_considered: recent.length,
    last_seen_index: chosen.index < 0 ? null : chosen.index,
  });
}

export type CoverageReason = 'undocumented-style' | 'tempo-or-meter' |
  'harmony-unasserted-or-mismatch' | 'no-declared-style-handoff';
export interface CoverageNode {
  readonly genre: string;
  readonly style: string | null;
  readonly recipes: number;
}
export interface CoverageEdge {
  readonly from: CoverageNode;
  readonly to: CoverageNode;
  readonly verdict: 'metadata-candidate' | 'gap';
  /** Why no declared candidate exists (may include several independent blockers). */
  readonly reasons: readonly CoverageReason[];
}
export interface TransitionCoverage {
  readonly schema_version: 'em.transition-coverage.v1';
  readonly basis: 'declarative-only-not-listening-tested';
  /** False means nodes/pairs were omitted, not that omitted transitions are gaps. */
  readonly complete: boolean;
  readonly node_limit: number;
  readonly total_nodes: number;
  readonly omitted_nodes: number;
  /** First node_limit nodes in deterministic genre/style order. */
  readonly nodes: readonly CoverageNode[];
  /** Directed genre/style edges; no edge is a playback instruction. */
  readonly edges: readonly CoverageEdge[];
  /** Counts below distinguish evaluated pairs from the full library's pair universe. */
  readonly total_pairs: number;
  readonly possible_pairs: number;
  readonly unevaluated_pairs: number;
  readonly metadata_candidates: number;
  readonly gaps: number;
}

interface Item {
  readonly pack: VersionRef;
  readonly recipe: RecipeReference;
  readonly genre: string;
  readonly style: string | null;
  readonly exitsTo: readonly string[];
}
const nodeKey = (genre: string, style: string | null): string => JSON.stringify([genre, style]);
function classify(from: Item, to: Item): CoverageReason | null {
  if (!from.style || !to.style) return 'undocumented-style';
  if (from.recipe.bpm !== to.recipe.bpm ||
    JSON.stringify(from.recipe.meter) !== JSON.stringify(to.recipe.meter)) return 'tempo-or-meter';
  if (from.recipe.key === null || to.recipe.key === null ||
    from.recipe.key !== to.recipe.key ||
    from.recipe.harmony_pitch_classes === null || to.recipe.harmony_pitch_classes === null ||
    JSON.stringify(from.recipe.harmony_pitch_classes) !== JSON.stringify(to.recipe.harmony_pitch_classes)) {
    return 'harmony-unasserted-or-mismatch';
  }
  return from.exitsTo.includes(to.style) ? null : 'no-declared-style-handoff';
}

/**
 * EMF13 reports *potential* directed handoffs from exact registered library metadata.
 * A candidate needs matching tempo/meter/key/harmony AND an explicit style exit.
 * It does not assert cue alignment, mix safety, media availability, or audible quality.
 * Unprofiled legacy recipes remain visible as gaps rather than implicit approvals.
 * Large libraries return a bounded partial report; omitted pairs are never classified.
 */
export function reportTransitionCoverage(snapshot: MusicLibrarySnapshot): TransitionCoverage {
  const grouped = new Map<string, Item[]>();
  for (const entry of snapshot.catalogue) for (const recipe of entry.pack.recipes) {
    const known = S11_ALL_RECIPE_FAMILIES.find(family =>
      family.id === recipe.id && family.revision === recipe.revision && recipe.genres.includes(family.genre));
    for (const genre of recipe.genres.length ? recipe.genres : ['(unlabelled)']) {
      const style = known && known.genre === genre ? known.style : null;
      const item: Item = {pack: {id: entry.pack.id, revision: entry.pack.revision}, recipe, genre,
        style, exitsTo: known && known.genre === genre ? known.transitionTo : []};
      const key = nodeKey(genre, style);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
  }
  const allNodes = [...grouped.entries()].map(([key, items]) => {
    const [genre, style] = JSON.parse(key) as [string, string | null];
    return {genre, style, recipes: items.length} satisfies CoverageNode;
  }).sort((a, b) => compareText(a.genre, b.genre) || compareText(a.style ?? '', b.style ?? ''));
  const nodes = allNodes.slice(0, COVERAGE_NODE_LIMIT);
  const omitted_nodes = allNodes.length - nodes.length;
  const possible_pairs = allNodes.length * Math.max(0, allNodes.length - 1);
  const edges: CoverageEdge[] = [];
  for (const from of nodes) for (const to of nodes) {
    if (from.genre === to.genre && from.style === to.style) continue;
    const reasons = new Set<CoverageReason>();
    let candidate = false;
    for (const left of grouped.get(nodeKey(from.genre, from.style))!) {
      for (const right of grouped.get(nodeKey(to.genre, to.style))!) {
        const reason = classify(left, right);
        if (reason === null) candidate = true;
        else reasons.add(reason);
      }
    }
    edges.push({from, to, verdict: candidate ? 'metadata-candidate' : 'gap',
      reasons: candidate ? [] : [...reasons].sort()});
  }
  const metadata_candidates = edges.filter(edge => edge.verdict === 'metadata-candidate').length;
  return Object.freeze({schema_version: 'em.transition-coverage.v1',
    basis: 'declarative-only-not-listening-tested', complete: omitted_nodes === 0,
    node_limit: COVERAGE_NODE_LIMIT, total_nodes: allNodes.length, omitted_nodes, nodes, edges,
    total_pairs: edges.length, possible_pairs, unevaluated_pairs: possible_pairs - edges.length,
    metadata_candidates, gaps: edges.length - metadata_candidates});
}
