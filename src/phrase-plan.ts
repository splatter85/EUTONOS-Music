import { eligibleForPlayback, validatePackManifest } from './pack.js';
import type { AudioAsset, AudioPack, VersionRef } from './pack-types.js';

/**
 * The performer is executable code; a recipe reference stays a data descriptor. Its event
 * rules are unchanged since S04. Since S06 it binds any palette that meets
 * PERFORMER_PALETTE_CONTRACT instead of the pinned S01 media (EM-DEC032).
 */
export const S01_PERFORMER = Object.freeze({ id: 's04-s01-performer', revision: 1 });
/** The S01 recipe identity that the S04 tools, the DJ bridge and the S05 policy compile. */
export const S01_RECIPE = Object.freeze({ id: 's01-recipe', revision: 1 });
/** What a producer's palette must satisfy before this performer may play it. */
export const PERFORMER_PALETTE_CONTRACT = Object.freeze({ id: 's06-performer-palette', revision: 1 });
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

export interface CompilePhraseOptions extends CompileS01PhraseOptions {
  /** The recipe reference to perform, by exact id and revision inside the pack. */
  readonly recipe: VersionRef;
}

/**
 * The longest one-shot each role may hold, in quarter notes at 120 BPM. Each value is the
 * shortest distance from any onset of that role to its next onset, to the phrase end
 * (32) or, for roles that do not continue through an S05 handoff, to the exit at 16.
 * A sample within it never overlaps its own next note or crosses those boundaries.
 */
export const ROLE_MAX_QUARTERS: Readonly<Record<S01PhraseRole, number>> =
  Object.freeze({ drum: 0.5, percussion: 0.25, bass: 1, harmony: 2 });

/**
 * The longest native sample, in frames, a role may use at this sample rate. Onsets sit on
 * a sixteenth-note grid. When the rate is not divisible by 8 a native onset can round up
 * by half a frame, so the bound keeps that half frame free.
 */
export function maxRoleFrames(role: S01PhraseRole, sampleRate: number): number {
  const exact = ROLE_MAX_QUARTERS[role] * 60 * sampleRate / 120;
  return Math.floor(sampleRate % 8 === 0 ? exact : exact - 0.5);
}
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

/** Compile the S01 recipe identity (`s01-recipe@1`) under the palette contract. */
export function compileS01Phrase(input: AudioPack, options: CompileS01PhraseOptions): ProceduralPlan {
  return compilePhrase(input, { seed: options.seed, state: options.state, recipe: S01_RECIPE,
    ...(options.allowFixtures === undefined ? {} : { allowFixtures: options.allowFixtures }) });
}

/**
 * Compile eight bars of bounded events for a recipe whose palette meets the contract,
 * whoever produced its samples. Input metadata is revalidated and copied; no input
 * reference survives in the plan, which snapshots the exact bound media.
 */
export function compilePhrase(input: AudioPack, options: CompilePhraseOptions): ProceduralPlan {
  if (!Number.isInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) {
    throw new PhrasePlanError('seed', 'seed must be an explicit uint32');
  }
  if (options.state !== 'explore' && options.state !== 'drive') {
    throw new PhrasePlanError('state', 'only explore and drive are supported');
  }
  const pack = validatePackManifest(input);
  const wanted = options.recipe;
  compatibility(typeof wanted === 'object' && wanted !== null, 'name the recipe to perform');
  const recipe = pack.recipes.find(item => item.id === wanted.id && item.revision === wanted.revision);
  compatibility(recipe !== undefined, `the pack has no recipe ${String(wanted.id)}@${String(wanted.revision)}`);
  compatibility(recipe.bpm === 120 && equal(recipe.meter, [4, 4]) && recipe.phrase_bars === 4,
    'the performer plays 4/4 at 120 BPM in four-bar phrases');
  const harmony = recipe.harmony_pitch_classes;
  compatibility(harmony !== null, 'the recipe must assert its constant harmony');
  compatibility(recipe.states.includes(options.state), `the recipe does not declare ${options.state}`);
  const palette = pack.palettes.find(item => item.id === recipe.palette.id && item.revision === recipe.palette.revision);
  compatibility(palette !== undefined && palette.samples.length === 4 &&
    roleOrder.every(role => palette.samples.filter(item => item.role === role).length === 1),
  'the palette needs exactly one drum, percussion, bass and harmony sample');
  const samples: PhraseSample[] = roleOrder.map(role => {
    const membership = palette.samples.find(item => item.role === role)!;
    const asset = pack.assets.find(item => item.id === membership.asset.id && item.revision === membership.asset.revision);
    compatibility(asset !== undefined && asset.source_kind === 'sample', `the ${role} member must be a sample`);
    if (role === 'bass' || role === 'harmony') {
      const pitches = asset.harmony_pitch_classes;
      compatibility(membership.root_midi !== null && pitches !== null && pitches.every(pitch => harmony.includes(pitch)) &&
        pitches.includes(membership.root_midi % 12),
      `${asset.id}: a ${role} sample asserts pitch classes inside the recipe harmony, including its root`);
    } else {
      compatibility(membership.root_midi === null && asset.harmony_pitch_classes === null,
        `${asset.id}: a ${role} sample is unpitched, with no root or harmony`);
    }
    compatibility(asset.file.frames <= maxRoleFrames(role, asset.file.sample_rate),
      `${asset.id}: a ${role} sample lasts at most ${ROLE_MAX_QUARTERS[role]} quarter note(s) at 120 BPM ` +
      `(${maxRoleFrames(role, asset.file.sample_rate)} frames at ${asset.file.sample_rate} Hz)`);
    if (!eligibleForPlayback(asset, options.allowFixtures === true) || !asset.rights.allowed_uses.includes('sample-reuse')) {
      throw new PhrasePlanError('eligibility', `${asset.id} requires playback and sample-reuse rights plus reviewed or explicitly opted-in fixture eligibility`);
    }
    return { asset, role, rootMidi: membership.root_midi };
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
    const bound = samples.find(item => item.role === role)!.asset;
    events.push({ sample: { id: bound.id, revision: bound.revision }, role, atQuarters: position, gain });
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
