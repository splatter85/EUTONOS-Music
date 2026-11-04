import {
  PACK_VERSION, type AudioAsset, type AudioPack, type Cue, type CueRoute,
  type MusicState, type Palette, type RecipeReference, type Rights, type Timing,
  type VersionRef,
} from './pack-types.js';

export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
const STATES = ['browse', 'explore', 'drive', 'surge', 'afterglow'] as const;
const USES = ['playback', 'redistribution', 'sample-reuse'] as const;

export class PackError extends Error {
  constructor(readonly code: string, readonly location: string, detail: string) {
    super(`${code} at ${location}: ${detail}`);
    this.name = 'PackError';
  }
}

export function fail(code: string, location: string, detail: string): never {
  throw new PackError(code, location, detail);
}

function object(value: unknown, at: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('INVALID_MANIFEST', at, 'expected an object');
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) fail('UNSUPPORTED_FIELD', `${at}.${key}`, 'not part of v0');
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, at: string, max = 200): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > max) {
    return fail('INVALID_MANIFEST', at, `expected nonempty trimmed text (max ${max})`);
  }
  return value;
}

function id(value: unknown, at: string): string {
  const result = string(value, at, 96);
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(result)) {
    fail('INVALID_ID', at, 'use stable lowercase letters, numbers, dots, hyphens or underscores');
  }
  return result;
}

function number(value: unknown, at: string, min: number, max: number, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max ||
      (integer && !Number.isSafeInteger(value))) {
    return fail('INVALID_MANIFEST', at, `expected ${integer ? 'integer' : 'finite number'} in [${min}, ${max}]`);
  }
  return value;
}

function choice<T extends string>(value: unknown, at: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return fail('INVALID_MANIFEST', at, `expected one of ${values.join(', ')}`);
  }
  return value as T;
}

function list<T>(value: unknown, at: string, parse: (value: unknown, at: string) => T, max = 64): T[] {
  if (!Array.isArray(value) || value.length > max) {
    return fail('INVALID_MANIFEST', at, `expected array with at most ${max} items`);
  }
  return value.map((item, i) => parse(item, `${at}[${i}]`));
}

function unique<T>(values: readonly T[], at: string): void {
  if (new Set(values).size !== values.length) fail('DUPLICATE_ID', at, 'duplicate value');
}

export function portablePath(value: unknown, at = 'path'): string {
  const result = string(value, at, 240);
  const segments = result.split('/');
  if (segments.some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) ||
      segment.endsWith('.') || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment))) {
    fail('UNSAFE_PATH', at, 'expected a portable relative path, without traversal, drive, URL or reserved name');
  }
  return result;
}

function ref(value: unknown, at: string): VersionRef {
  const o = object(value, at, ['id', 'revision']);
  return { id: id(o.id, `${at}.id`), revision: number(o.revision, `${at}.revision`, 1, Number.MAX_SAFE_INTEGER) };
}

function identity(o: Record<string, unknown>, at: string): VersionRef {
  return ref({id: o.id, revision: o.revision}, at);
}

function meter(value: unknown, at: string): readonly [4, 4] {
  if (!Array.isArray(value) || value.length !== 2 || value[0] !== 4 || value[1] !== 4) {
    fail('UNSUPPORTED_METER', at, 'v0 supports constant 4/4 only');
  }
  return [4, 4];
}

function harmony(value: unknown, at: string): number[] | null {
  if (value === null) return null;
  const pitches = list(value, at, (v, p) => number(v, p, 0, 11), 12);
  if (!pitches.length) fail('INVALID_MANIFEST', at, 'use null when no harmony is asserted');
  unique(pitches, at);
  return pitches.sort((a, b) => a - b);
}

function key(value: unknown, at: string): string | null {
  return value === null ? null : string(value, at);
}

function genres(value: unknown, at: string): string[] {
  const result = list(value, at, id, 16);
  unique(result, at);
  return result;
}

function states(value: unknown, at: string): MusicState[] {
  const result = list(value, at, (v, p) => choice(v, p, STATES), STATES.length);
  unique(result, at);
  return result;
}

function rights(value: unknown, at: string): Rights {
  const o = object(value, at, ['origin', 'creator', 'license', 'allowed_uses', 'evidence']);
  const uses = list(o.allowed_uses, `${at}.allowed_uses`, (v, p) => choice(v, p, USES), USES.length);
  unique(uses, at);
  return {origin: string(o.origin, `${at}.origin`), creator: string(o.creator, `${at}.creator`),
    license: string(o.license, `${at}.license`), allowed_uses: uses,
    evidence: portablePath(o.evidence, `${at}.evidence`)};
}

function timing(value: unknown, at: string): Timing {
  const o = object(value, at, ['bpm', 'meter', 'bars', 'phrase_bars', 'first_downbeat_frame']);
  const result: Timing = {bpm: number(o.bpm, `${at}.bpm`, 20, 400, false),
    meter: meter(o.meter, `${at}.meter`), bars: number(o.bars, `${at}.bars`, 1, 4096),
    phrase_bars: number(o.phrase_bars, `${at}.phrase_bars`, 1, 4096),
    first_downbeat_frame: number(o.first_downbeat_frame, `${at}.first_downbeat_frame`, 0, MAX_AUDIO_BYTES / 2)};
  if (result.bars % result.phrase_bars !== 0) fail('INVALID_TIMING', at, 'body must contain whole phrases');
  return result;
}

function cue(value: unknown, at: string): Cue {
  const o = object(value, at, ['id', 'kind', 'position_quarters']);
  return {id: id(o.id, `${at}.id`), kind: choice(o.kind, `${at}.kind`, ['entry', 'exit']),
    position_quarters: number(o.position_quarters, `${at}.position_quarters`, 0, 16384)};
}

export function quartersToFrames(quarters: number, bpm: number, sampleRate: number): number {
  return Math.round(quarters * 60 * sampleRate / bpm);
}

function asset(value: unknown, at: string): AudioAsset {
  const o = object(value, at, ['id', 'revision', 'title', 'source_kind', 'file', 'rights', 'eligibility',
    'genres', 'states', 'key', 'harmony_pitch_classes', 'timing', 'cues']);
  const f = object(o.file, `${at}.file`, ['path', 'sha256', 'bytes', 'format', 'sample_rate', 'channels', 'frames']);
  const path = portablePath(f.path, `${at}.file.path`);
  if (path !== path.toLowerCase() || !path.endsWith('.wav')) fail('UNSAFE_PATH', at, 'audio paths must be lowercase .wav paths');
  const hash = string(f.sha256, `${at}.file.sha256`);
  if (!/^[a-f0-9]{64}$/.test(hash)) fail('INVALID_HASH', at, 'expected a lowercase SHA-256');
  const channels = number(f.channels, `${at}.file.channels`, 1, 2) as 1 | 2;
  const result: AudioAsset = {...identity(o, at), title: string(o.title, `${at}.title`),
    source_kind: choice(o.source_kind, `${at}.source_kind`, ['recording', 'sample']),
    file: {path, sha256: hash, bytes: number(f.bytes, `${at}.file.bytes`, 44, MAX_AUDIO_BYTES),
      format: choice(f.format, `${at}.file.format`, ['pcm16-wav']),
      sample_rate: number(f.sample_rate, `${at}.file.sample_rate`, 8000, 192000), channels,
      frames: number(f.frames, `${at}.file.frames`, 1, MAX_AUDIO_BYTES / (channels * 2))},
    rights: rights(o.rights, `${at}.rights`),
    eligibility: choice(o.eligibility, `${at}.eligibility`, ['fixture-only', 'unreviewed', 'listening-reviewed']),
    genres: genres(o.genres, `${at}.genres`), states: states(o.states, `${at}.states`),
    key: key(o.key, `${at}.key`), harmony_pitch_classes: harmony(o.harmony_pitch_classes, `${at}.harmony_pitch_classes`),
    timing: o.timing === null ? null : timing(o.timing, `${at}.timing`), cues: list(o.cues, `${at}.cues`, cue)};
  unique(result.cues.map(c => c.id), `${at}.cues`);
  if (result.source_kind === 'sample') {
    if (result.timing !== null || result.cues.length) fail('INVALID_TIMING', at, 'v0 samples are one-shots without a track grid/cues');
  } else {
    const t = result.timing;
    if (!t) return fail('INVALID_TIMING', at, 'recordings require authored timing');
    const bodyEnd = t.first_downbeat_frame + quartersToFrames(t.bars * 4, t.bpm, result.file.sample_rate);
    if (bodyEnd > result.file.frames + 1) fail('INVALID_LENGTH', at, 'musical body exceeds audio frames');
    for (const c of result.cues) {
      if (c.position_quarters % (t.phrase_bars * 4) !== 0 || c.position_quarters > t.bars * 4 ||
          (c.kind === 'entry' && c.position_quarters === t.bars * 4)) {
        fail('INVALID_CUE', `${at}.cues.${c.id}`, 'cue must be a valid phrase boundary within the body (entry before end)');
      }
    }
  }
  return result;
}

function palette(value: unknown, at: string): Palette {
  const o = object(value, at, ['id', 'revision', 'samples']);
  const samples = list(o.samples, `${at}.samples`, (v, p) => {
    const s = object(v, p, ['asset', 'role', 'root_midi']);
    return {asset: ref(s.asset, `${p}.asset`),
      role: choice(s.role, `${p}.role`, ['drum', 'percussion', 'bass', 'harmony', 'texture']),
      root_midi: s.root_midi === null ? null : number(s.root_midi, `${p}.root_midi`, 0, 127)};
  });
  if (!samples.length) fail('INVALID_MANIFEST', at, 'palette cannot be empty');
  unique(samples.map(s => s.asset.id), at);
  return {...identity(o, at), samples};
}

function recipe(value: unknown, at: string): RecipeReference {
  const o = object(value, at, ['id', 'revision', 'palette', 'bpm', 'meter', 'phrase_bars', 'key',
    'harmony_pitch_classes', 'genres', 'states']);
  return {...identity(o, at), palette: ref(o.palette, `${at}.palette`),
    bpm: number(o.bpm, `${at}.bpm`, 20, 400, false), meter: meter(o.meter, `${at}.meter`),
    phrase_bars: number(o.phrase_bars, `${at}.phrase_bars`, 1, 4096), key: key(o.key, `${at}.key`),
    harmony_pitch_classes: harmony(o.harmony_pitch_classes, `${at}.harmony_pitch_classes`),
    genres: genres(o.genres, `${at}.genres`), states: states(o.states, `${at}.states`)};
}

function route(value: unknown, at: string): CueRoute {
  const o = object(value, at, ['id', 'revision', 'from', 'to', 'exit_cue', 'entry_cue', 'overlap_quarters', 'review']);
  return {...identity(o, at), from: ref(o.from, `${at}.from`), to: ref(o.to, `${at}.to`),
    exit_cue: id(o.exit_cue, `${at}.exit_cue`), entry_cue: id(o.entry_cue, `${at}.entry_cue`),
    overlap_quarters: number(o.overlap_quarters, `${at}.overlap_quarters`, 4, 16384),
    review: choice(o.review, `${at}.review`, ['fixture-only'])};
}

function resolve<T extends VersionRef>(reference: VersionRef, values: readonly T[], at: string): T {
  const found = values.find(v => v.id === reference.id && v.revision === reference.revision);
  return found ?? fail('MISSING_REFERENCE', at, `unknown id/revision ${reference.id}@${reference.revision}`);
}

/** Parses untrusted data. Validation is structural/technical, not a license or listening certification. */
export function validatePackManifest(value: unknown): AudioPack {
  const o = object(value, 'pack', ['schema_version', 'id', 'revision', 'assets', 'palettes', 'recipes', 'routes']);
  if (o.schema_version !== PACK_VERSION) fail('UNSUPPORTED_VERSION', 'pack.schema_version', `expected ${PACK_VERSION}`);
  const pack: AudioPack = {...identity(o, 'pack'), schema_version: PACK_VERSION,
    assets: list(o.assets, 'pack.assets', asset), palettes: list(o.palettes, 'pack.palettes', palette),
    recipes: list(o.recipes, 'pack.recipes', recipe), routes: list(o.routes, 'pack.routes', route)};
  if (!pack.assets.length) fail('INVALID_MANIFEST', 'pack.assets', 'pack needs audio');
  unique([pack.id, ...pack.assets.map(a => a.id), ...pack.palettes.map(p => p.id),
    ...pack.recipes.map(r => r.id), ...pack.routes.map(r => r.id)], 'pack.ids');
  unique(pack.assets.map(a => a.file.path.toLowerCase()), 'pack.paths');
  for (const p of pack.palettes) for (const s of p.samples) {
    const a = resolve(s.asset, pack.assets, p.id);
    if (a.source_kind !== 'sample') fail('INVALID_REFERENCE', p.id, 'palette must refer to samples');
    if ((s.role === 'bass' || s.role === 'harmony') && s.root_midi === null) {
      fail('INVALID_REFERENCE', p.id, 'pitched bass/harmony sample needs an authored root');
    }
  }
  for (const r of pack.recipes) resolve(r.palette, pack.palettes, r.id);
  for (const r of pack.routes) {
    const a = resolve(r.from, pack.assets, r.id), b = resolve(r.to, pack.assets, r.id);
    const exit = a.cues.find(c => c.id === r.exit_cue && c.kind === 'exit');
    const entry = b.cues.find(c => c.id === r.entry_cue && c.kind === 'entry');
    if (!a.timing || !b.timing || !exit || !entry) fail('INVALID_CUE', r.id, 'route needs a recording exit and entry');
    if (a.timing.bpm !== b.timing.bpm || r.overlap_quarters % 4 !== 0) {
      fail('INCOMPATIBLE_ROUTE', r.id, 'v0 requires equal tempo and whole-bar overlap');
    }
    if (!a.harmony_pitch_classes || !b.harmony_pitch_classes ||
        a.harmony_pitch_classes.join(',') !== b.harmony_pitch_classes.join(',')) {
      fail('INCOMPATIBLE_ROUTE', r.id, 'matching authored constant harmony is required; key labels alone are insufficient');
    }
    if (exit.position_quarters + r.overlap_quarters > a.timing.bars * 4 ||
        entry.position_quarters + r.overlap_quarters > b.timing.bars * 4) {
      fail('INVALID_CUE', r.id, 'insufficient musical body for overlap');
    }
  }
  return pack;
}

/** Fixture mode is explicit. Well-formed metadata alone never admits unreviewed audio. */
export function eligibleForPlayback(asset: AudioAsset, allowFixtures = false): boolean {
  return asset.rights.allowed_uses.includes('playback') &&
    (asset.eligibility === 'listening-reviewed' || (allowFixtures && asset.eligibility === 'fixture-only'));
}
