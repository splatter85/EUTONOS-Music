import { eligibleForPlayback, validatePackManifest } from './pack.js';
import type { AudioAsset, AudioPack, VersionRef } from './pack-types.js';

/** The performer is executable code; s01-recipe@1 remains its unchanged data descriptor. */
export const S01_PERFORMER = Object.freeze({ id: 's04-s01-performer', revision: 1 });
export type S01PhraseState = 'explore' | 'drive';
export type S01PhraseRole = 'drum' | 'percussion' | 'bass' | 'harmony';
export interface PhraseEvent {
  readonly sample: VersionRef;
  readonly role: S01PhraseRole;
  readonly atQuarters: number;
  readonly gain: number;
}
export interface PhraseSection {
  readonly name: 'statement' | 'answer';
  readonly fromQuarters: number;
  readonly toQuarters: number;
  readonly rhythm: number;
  readonly motif: number;
  readonly fill: number;
}
export interface PhraseSample {
  readonly asset: AudioAsset;
  readonly role: S01PhraseRole;
  readonly rootMidi: number | null;
}
export interface ProceduralPlan {
  readonly performer: VersionRef;
  readonly pack: VersionRef;
  readonly recipe: VersionRef;
  readonly palette: VersionRef;
  readonly seed: number;
  readonly state: S01PhraseState;
  readonly bpm: 120;
  readonly meter: readonly [4, 4];
  readonly bars: 8;
  readonly phraseBars: 4;
  readonly durationQuarters: 32;
  readonly exitQuarters: readonly [16, 32];
  readonly sections: readonly PhraseSection[];
  readonly events: readonly PhraseEvent[];
  /** Complete, immutable source snapshots bind hashes, revisions, rights and eligibility. */
  readonly samples: readonly PhraseSample[];
}
export interface CompileS01PhraseOptions {
  readonly seed: number;
  readonly state: S01PhraseState;
  readonly allowFixtures?: boolean;
}
export class PhrasePlanError extends Error {
  constructor(readonly code: 'seed' | 'state' | 'compatibility' | 'eligibility', detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'PhrasePlanError';
  }
}

const bindings = [
  { id: 's01-kick', role: 'drum', root: null, frames: 6000, hash: '19d69c96a284f64a1079f3bf5febe599ac288556e1d14e77f711831367d7da5d', pitches: null },
  { id: 's01-percussion', role: 'percussion', root: null, frames: 1800, hash: '78615392ad936771715fa506165f9deb6ed432693ae55cee162268fc1054d75c', pitches: null },
  { id: 's01-bass-a2', role: 'bass', root: 45, frames: 9000, hash: '9e770ee7e19e1115fa6d25c73f824b3ede1cf2d13284d5cf7d6d6274f3b857ab', pitches: [9] },
  { id: 's01-harmony-am', role: 'harmony', root: 45, frames: 24000, hash: 'dac81e41d55f91fa1ab466890bfc98f975d5f9b2d8549f0c49d9f68c755fb09b', pitches: [0, 4, 9] },
] as const;
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const ref = (value: VersionRef): VersionRef => ({ id: value.id, revision: value.revision });
function compatibility(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new PhrasePlanError('compatibility', detail);
}
function freeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const compiledPlans = new WeakSet<object>();
/** Rehydrate a replay by compiling its identity, never by accepting arbitrary events. */
export function assertCompiledS01Phrase(plan: unknown): asserts plan is ProceduralPlan {
  if (typeof plan !== 'object' || plan === null || !compiledPlans.has(plan)) {
    throw new PhrasePlanError('compatibility', 'use an immutable plan returned by compileS01Phrase');
  }
}
/** Mulberry32: versioned with this performer, including the valid all-zero seed. */
function randomFor(seed: number): () => number {
  let word = seed;
  return () => {
    word = (word + 0x6d2b79f5) >>> 0;
    let mixed = word;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Positions are quarter-note units within one bar, never sample playback-rate changes.
const kickRhythms = [[0, 2], [0, 1.5, 2.5], [0, 1, 3], [0, 2, 3.5]] as const;
const bassMotifs = [[0, 2], [0.5, 2, 3], [0, 1.5, 3], [0.5, 1.5, 2.5]] as const;
const percussionRhythms = [[1, 3], [0.5, 1.5, 2.5, 3.5], [1, 2.5, 3.5], [0.75, 1.75, 2.75, 3.75]] as const;
const fills = [[2.5, 3, 3.5, 3.75], [2, 2.75, 3.25, 3.75], [2.5, 2.75, 3.5, 3.75], [2, 2.5, 3, 3.5, 3.75]] as const;
const roleOrder: readonly S01PhraseRole[] = ['drum', 'percussion', 'bass', 'harmony'];

/**
 * Compile the one supported original S01 palette into eight bars of bounded events.
 * Input metadata is revalidated and copied; no input reference survives in the plan.
 * New recipe/palette/media revisions require a new explicitly reviewed performer.
 */
export function compileS01Phrase(input: AudioPack, options: CompileS01PhraseOptions): ProceduralPlan {
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) {
    throw new PhrasePlanError('seed', 'seed must be an explicit uint32');
  }
  if (options.state !== 'explore' && options.state !== 'drive') {
    throw new PhrasePlanError('state', 'only explore and drive are supported');
  }
  const pack = validatePackManifest(input);
  compatibility(pack.id === 's01-foundation' && pack.revision === 1, 'requires s01-foundation@1');
  const recipe = pack.recipes.find(item => item.id === 's01-recipe');
  compatibility(recipe !== undefined && recipe.revision === 1, 'requires s01-recipe@1');
  compatibility(equal(recipe.palette, { id: 's01-palette', revision: 1 }) && recipe.bpm === 120 &&
    equal(recipe.meter, [4, 4]) && recipe.phrase_bars === 4 && recipe.key === 'A minor' &&
    equal(recipe.harmony_pitch_classes, [0, 4, 9]) && equal(recipe.genres, ['synthetic-test']) &&
    equal(recipe.states, ['explore', 'drive']), 'unsupported recipe descriptor');
  const palette = pack.palettes.find(item => item.id === 's01-palette');
  compatibility(palette !== undefined && palette.revision === 1 && palette.samples.length === 4,
    'requires the exact four-role s01-palette@1');
  const samples: PhraseSample[] = bindings.map(binding => {
    const membership = palette.samples.find(item => item.asset.id === binding.id);
    const asset = pack.assets.find(item => item.id === binding.id);
    compatibility(membership !== undefined && membership.asset.revision === 1 &&
      membership.role === binding.role && membership.root_midi === binding.root,
    `unsupported palette binding for ${binding.id}`);
    compatibility(asset !== undefined && asset.revision === 1 && asset.source_kind === 'sample' &&
      asset.file.format === 'pcm16-wav' && asset.file.sample_rate === 24000 && asset.file.channels === 1 &&
      asset.file.frames === binding.frames && asset.file.bytes === 44 + binding.frames * 2 &&
      asset.file.sha256 === binding.hash && asset.key === (binding.root === null ? null : 'A minor') &&
      equal(asset.harmony_pitch_classes, binding.pitches) && asset.timing === null && asset.cues.length === 0 &&
      equal(asset.genres, ['synthetic-test']) && equal(asset.states, ['explore', 'drive']),
    `unsupported sample metadata for ${binding.id}`);
    if (!eligibleForPlayback(asset, options.allowFixtures === true) || !asset.rights.allowed_uses.includes('sample-reuse')) {
      throw new PhrasePlanError('eligibility', `${asset.id} requires playback and sample-reuse rights plus reviewed or explicitly opted-in fixture eligibility`);
    }
    return { asset, role: binding.role, rootMidi: binding.root };
  });
  // Independent role streams keep a percussion choice from perturbing another part.
  const drumRandom = randomFor((options.seed ^ 0x243f6a88) >>> 0);
  const bassRandom = randomFor((options.seed ^ 0x85a308d3) >>> 0);
  const percussionRandom = randomFor((options.seed ^ 0x13198a2e) >>> 0);
  const harmonyRandom = randomFor((options.seed ^ 0x03707344) >>> 0);
  const choose = (random: () => number, count: number): number => Math.floor(random() * count);
  const rhythm = choose(drumRandom, 4);
  const motif = choose(bassRandom, 4);
  const percussion = choose(percussionRandom, 4);
  const fill = choose(percussionRandom, 4);
  const answerRhythm = (rhythm + 1 + choose(drumRandom, 3)) % 4;
  const answerMotif = (motif + 1 + choose(bassRandom, 3)) % 4;
  const harmonyOffset = choose(harmonyRandom, 2) * 2;
  const answerHarmonyOffset = 2 - harmonyOffset;
  const events: PhraseEvent[] = [];
  const add = (role: S01PhraseRole, position: number, gain: number): void => {
    const binding = bindings.find(item => item.role === role)!;
    events.push({ sample: { id: binding.id, revision: 1 }, role, atQuarters: position, gain });
  };
  for (let bar = 0; bar < 8; bar++) {
    const base = bar * 4;
    const answer = bar >= 4;
    const endOfSection = bar % 4 === 3;
    const currentRhythm = answer ? answerRhythm : rhythm;
    const currentMotif = answer ? answerMotif : motif;
    for (const [index, position] of kickRhythms[currentRhythm]!.entries()) {
      add('drum', base + position, index === 0 ? 0.72 : 0.58);
    }
    // Drive establishes a stronger pulse; skips duplicates and maintains >= .5q separation.
    if (options.state === 'drive' && !kickRhythms[currentRhythm]!.some(position => Math.abs(position - 2) < 0.5)) {
      add('drum', base + 2, 0.63);
    }
    for (const [index, position] of bassMotifs[currentMotif]!.entries()) {
      // Section cadences leave the final quarter clear, so every bass tail stays inside its bar.
      if (!endOfSection || position < 3) add('bass', base + position, index === 0 ? 0.57 : 0.43);
    }
    const percussivePositions: readonly number[] = endOfSection ? fills[(fill + (answer ? 1 : 0)) % 4]! :
      percussionRhythms[(percussion + (answer ? 1 : 0)) % 4]!;
    for (const [index, position] of percussivePositions.entries()) {
      // Explore breathes on alternate bars; the fill still answers the phrase at each exit.
      if (options.state === 'drive' || endOfSection || bar % 2 === 0 || index % 2 === 0) {
        add('percussion', base + position, endOfSection ? (index % 2 === 0 ? 0.38 : 0.29) : 0.26);
      }
    }
    const chordOffset = answer ? answerHarmonyOffset : harmonyOffset;
    if (bar % 2 === 0 || options.state === 'drive') add('harmony', base + chordOffset, answer ? 0.31 : 0.27);
  }
  events.sort((a, b) => a.atQuarters - b.atQuarters || roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));
  const plan = freeze({
    performer: ref(S01_PERFORMER), pack: ref(pack), recipe: ref(recipe), palette: ref(palette),
    seed: options.seed, state: options.state, bpm: 120, meter: [4, 4], bars: 8, phraseBars: 4,
    durationQuarters: 32, exitQuarters: [16, 32], samples, events,
    sections: [
      { name: 'statement', fromQuarters: 0, toQuarters: 16, rhythm, motif, fill },
      { name: 'answer', fromQuarters: 16, toQuarters: 32, rhythm: answerRhythm, motif: answerMotif, fill: (fill + 1) % 4 },
    ],
  } satisfies ProceduralPlan);
  compiledPlans.add(plan);
  return plan;
}
