/**
 * Song dossier, `em.song-dossier.v1`: the compact, persisted result of analysing one song BEFORE it is
 * played. It wraps what the existing whole-song analysis (`mix-analysis-v5` plus `mix-structure@1`)
 * already produces: tempo, beat and bar grid with confidences, key estimate, heuristic sections, cue
 * candidates, quality flags, versions and the time the analysis took. It adds no new analysis.
 *
 * Pure data (no DOM, no Node APIs, no audio): the relay, the DJ page and tests share it. Times are in
 * seconds, so one dossier serves any AudioContext rate. It holds the song's audio sha256 and
 * numbers only: no audio, no file path, no title, no personal data. A dossier is analysis evidence,
 * not a listening qualification, and it does not carry the full planner analysis: the planner still
 * reads the analysis cache (see docs/S21_TRANSITION_PLANNER.md, "Song dossiers").
 *
 * Validation is strict on write and on read: unknown fields, wrong types, out-of-range numbers and
 * oversized arrays are refused, never silently dropped.
 */
import {MIX_ANALYSIS_VERSION, type MixAnalysis, type MixPointCandidate} from '../src/mix-analysis.js';
import {MIX_STRUCTURE_VERSION} from './mix-structure.js';

export const SONG_DOSSIER = 'em.song-dossier.v1' as const;
/** Analysis tag in every key. Any change to the analysers or this wrapper changes it, so old dossiers stop being "current". */
export const SONG_DOSSIER_ANALYSIS = `song-dossier@1+${MIX_ANALYSIS_VERSION}+${MIX_STRUCTURE_VERSION}`;
export const SONG_DOSSIER_LIMITS = Object.freeze({
  /** One serialized dossier, in UTF-8 bytes. */
  maxBytes: 96 * 1024,
  beats: 1024, downbeats: 512, sections: 32, cues: 16, alternatives: 16, flags: 16, limitations: 16, reasons: 4,
  textChars: 240, reasonChars: 120, maxSeconds: 3600,
});
export const DOSSIER_FLAGS = ['tempo-unknown', 'tempo-ambiguous', 'tempo-insufficient-rhythm', 'beat-grid-weak', 'downbeat-weak',
  'key-ambiguous', 'key-unknown', 'no-structure', 'partial-coverage', 'structure-partial'] as const;
export type DossierFlag = typeof DOSSIER_FLAGS[number];
export const SECTION_LABELS = ['intro', 'build', 'drop', 'breakdown', 'outro'] as const;
const GRID_SOURCES = ['measured', 'requested'] as const;
const DOWNBEAT_SOURCES = ['audio', 'requested-origin', 'audio+requested'] as const;
const CUE_KINDS = ['boundary', 'low-interference', 'track-start'] as const;
const TEMPO_STATUS = ['estimated', 'insufficient-rhythm'] as const;
const KEY_STATUS = ['estimated', 'ambiguous'] as const;

/** Thresholds used only to raise quality flags; engineering starting points, not calibrated values. */
const FLAG_LIMITS = Object.freeze({ambiguity: 0.5, gridConfidence: 0.65, downbeatConfidence: 0.65, coverage: 0.9});

export interface DossierKey {
  readonly sha256: string;
  readonly analysis: string;
  /** The producer's requested tempo used as analysis evidence (null when none). */
  readonly tempoHint: number | null;
  readonly downbeatHintSeconds: number | null;
}
export interface DossierSection {
  readonly startSeconds: number; readonly endSeconds: number; readonly startBar: number; readonly bars: number;
  readonly label: typeof SECTION_LABELS[number] | null; readonly guess: typeof SECTION_LABELS[number] | null;
  readonly energy: number; readonly low: number; readonly vocal: number; readonly confidence: number;
}
export interface DossierCue {
  readonly seconds: number; readonly score: number; readonly confidence: number;
  readonly kind: typeof CUE_KINDS[number] | null; readonly reasons: readonly string[];
}
export interface SongDossier {
  readonly version: typeof SONG_DOSSIER;
  readonly key: DossierKey;
  readonly source: {readonly sampleRate: number; readonly frames: number; readonly channels: 1 | 2; readonly seconds: number};
  readonly tempo: {readonly status: typeof TEMPO_STATUS[number]; readonly bpm: number | null; readonly confidence: number; readonly ambiguity: number;
    readonly alternatives: readonly {readonly bpm: number; readonly strength: number}[];
    readonly driftBpm: number | null; readonly resolvedBy: string | null};
  readonly grid: {readonly beatSeconds: readonly number[]; readonly downbeatSeconds: readonly number[];
    readonly beatConfidence: number; readonly downbeatConfidence: number; readonly maxFitErrorSeconds: number | null;
    readonly beatSource: typeof GRID_SOURCES[number]; readonly downbeatSource: typeof DOWNBEAT_SOURCES[number]};
  readonly tonal: {readonly status: typeof KEY_STATUS[number]; readonly key: string | null; readonly confidence: number; readonly alternatives: readonly string[]};
  readonly loudness: {readonly samplePeak: number | null};
  readonly structure: {readonly version: string | null; readonly partial: boolean; readonly medianEnergy: number | null};
  readonly sections: readonly DossierSection[];
  readonly cues: {readonly entries: readonly DossierCue[]; readonly exits: readonly DossierCue[]};
  readonly quality: {readonly flags: readonly DossierFlag[]; readonly coverage: number};
  readonly cost: {readonly analysisMs: number; readonly at: string};
  readonly limitations: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fail = (message: string): never => { throw new Error(`Invalid song dossier: ${message}`); };
function exact(value: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (!isRecord(value)) return fail(`${where} is not an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`unknown field "${key.slice(0, 40)}" in ${where}`);
  for (const key of keys) if (!(key in value)) fail(`missing "${key}" in ${where}`);
  return value;
}
function num(value: unknown, where: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail(`${where} is not a number in range`);
  return value;
}
const unit = (value: unknown, where: string): number => num(value, where, 0, 1);
const nullableNum = (value: unknown, where: string, min: number, max: number): number | null => value === null ? null : num(value, where, min, max);
function oneOf<T extends string>(value: unknown, allowed: readonly T[], where: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) return fail(`${where} is not an allowed value`);
  return value as T;
}
function list(value: unknown, max: number, where: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(`${where} is not a list of at most ${max}`);
  return value;
}
/** Text is printable single-line and bounded; a control character is refused, not rewritten. */
function text(value: unknown, where: string, max: number): string {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) return fail(`${where} is not short printable text`);
  return value;
}
const secondsOf = (value: unknown, where: string): number => num(value, where, 0, SONG_DOSSIER_LIMITS.maxSeconds);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ANALYSIS_TAG = /^[A-Za-z0-9@+._-]{1,80}$/;

/** Lists of seconds must be non-decreasing. */
function secondsList(value: unknown, max: number, where: string): number[] {
  const items = list(value, max, where).map((v, i) => secondsOf(v, `${where}[${i}]`));
  for (let i = 1; i < items.length; i++) if (items[i]! < items[i - 1]!) fail(`${where} is not in order`);
  return items;
}

function parseCue(value: unknown, where: string): DossierCue {
  const o = exact(value, ['seconds', 'score', 'confidence', 'kind', 'reasons'], where);
  return {seconds: secondsOf(o.seconds, `${where}.seconds`), score: num(o.score, `${where}.score`, -1e6, 1e6), confidence: unit(o.confidence, `${where}.confidence`),
    kind: o.kind === null ? null : oneOf(o.kind, CUE_KINDS, `${where}.kind`),
    reasons: list(o.reasons, SONG_DOSSIER_LIMITS.reasons, `${where}.reasons`).map((r, i) => text(r, `${where}.reasons[${i}]`, SONG_DOSSIER_LIMITS.reasonChars))};
}
function parseSection(value: unknown, where: string): DossierSection {
  const o = exact(value, ['startSeconds', 'endSeconds', 'startBar', 'bars', 'label', 'guess', 'energy', 'low', 'vocal', 'confidence'], where);
  const startSeconds = secondsOf(o.startSeconds, `${where}.startSeconds`), endSeconds = secondsOf(o.endSeconds, `${where}.endSeconds`);
  if (endSeconds < startSeconds) fail(`${where} ends before it starts`);
  return {startSeconds, endSeconds, startBar: num(o.startBar, `${where}.startBar`, -1, 100_000), bars: num(o.bars, `${where}.bars`, 0, 100_000),
    label: o.label === null ? null : oneOf(o.label, SECTION_LABELS, `${where}.label`), guess: o.guess === null ? null : oneOf(o.guess, SECTION_LABELS, `${where}.guess`),
    energy: unit(o.energy, `${where}.energy`), low: unit(o.low, `${where}.low`), vocal: unit(o.vocal, `${where}.vocal`), confidence: unit(o.confidence, `${where}.confidence`)};
}

/**
 * Strict structure and range checks; returns a fresh, bounded copy. Throws `Invalid song dossier: ...`.
 * A dossier whose serialized form exceeds `maxBytes` is refused.
 */
export function parseSongDossier(value: unknown): SongDossier {
  const o = exact(value, ['version', 'key', 'source', 'tempo', 'grid', 'tonal', 'loudness', 'structure', 'sections', 'cues', 'quality', 'cost', 'limitations'], 'dossier');
  if (o.version !== SONG_DOSSIER) fail('version');
  const k = exact(o.key, ['sha256', 'analysis', 'tempoHint', 'downbeatHintSeconds'], 'key');
  if (typeof k.sha256 !== 'string' || !SHA256.test(k.sha256)) fail('key.sha256');
  if (typeof k.analysis !== 'string' || !ANALYSIS_TAG.test(k.analysis)) fail('key.analysis');
  const s = exact(o.source, ['sampleRate', 'frames', 'channels', 'seconds'], 'source');
  const channels = num(s.channels, 'source.channels', 1, 2);
  if (!Number.isInteger(channels)) fail('source.channels');
  const sampleRate = num(s.sampleRate, 'source.sampleRate', 8000, 192_000), frames = num(s.frames, 'source.frames', 1, 2 ** 32);
  if (!Number.isInteger(sampleRate) || !Number.isInteger(frames)) fail('source rate or frames');
  const t = exact(o.tempo, ['status', 'bpm', 'confidence', 'ambiguity', 'alternatives', 'driftBpm', 'resolvedBy'], 'tempo');
  const g = exact(o.grid, ['beatSeconds', 'downbeatSeconds', 'beatConfidence', 'downbeatConfidence', 'maxFitErrorSeconds', 'beatSource', 'downbeatSource'], 'grid');
  const n = exact(o.tonal, ['status', 'key', 'confidence', 'alternatives'], 'tonal');
  const l = exact(o.loudness, ['samplePeak'], 'loudness');
  const st = exact(o.structure, ['version', 'partial', 'medianEnergy'], 'structure');
  const c = exact(o.cues, ['entries', 'exits'], 'cues');
  const q = exact(o.quality, ['flags', 'coverage'], 'quality');
  const cost = exact(o.cost, ['analysisMs', 'at'], 'cost');
  if (typeof st.partial !== 'boolean') fail('structure.partial');
  if (st.version !== null) text(st.version, 'structure.version', 64);
  if (typeof cost.at !== 'string' || !ISO_TIME.test(cost.at) || Number.isNaN(Date.parse(cost.at))) fail('cost.at');
  const flags = list(q.flags, SONG_DOSSIER_LIMITS.flags, 'quality.flags').map((f, i) => oneOf(f, DOSSIER_FLAGS, `quality.flags[${i}]`));
  const result: SongDossier = {
    version: SONG_DOSSIER,
    key: {sha256: k.sha256 as string, analysis: k.analysis as string, tempoHint: nullableNum(k.tempoHint, 'key.tempoHint', 20, 400),
      downbeatHintSeconds: nullableNum(k.downbeatHintSeconds, 'key.downbeatHintSeconds', 0, SONG_DOSSIER_LIMITS.maxSeconds)},
    source: {sampleRate, frames, channels: channels as 1 | 2, seconds: secondsOf(s.seconds, 'source.seconds')},
    tempo: {status: oneOf(t.status, TEMPO_STATUS, 'tempo.status'), bpm: nullableNum(t.bpm, 'tempo.bpm', 20, 400), confidence: unit(t.confidence, 'tempo.confidence'),
      ambiguity: unit(t.ambiguity, 'tempo.ambiguity'),
      alternatives: list(t.alternatives, SONG_DOSSIER_LIMITS.alternatives, 'tempo.alternatives').map((a, i) => {
        const r = exact(a, ['bpm', 'strength'], `tempo.alternatives[${i}]`);
        return {bpm: num(r.bpm, 'alternative bpm', 20, 400), strength: num(r.strength, 'alternative strength', -1e6, 1e6)};
      }),
      driftBpm: nullableNum(t.driftBpm, 'tempo.driftBpm', 0, 400), resolvedBy: t.resolvedBy === null ? null : text(t.resolvedBy, 'tempo.resolvedBy', 40)},
    grid: {beatSeconds: secondsList(g.beatSeconds, SONG_DOSSIER_LIMITS.beats, 'grid.beatSeconds'), downbeatSeconds: secondsList(g.downbeatSeconds, SONG_DOSSIER_LIMITS.downbeats, 'grid.downbeatSeconds'),
      beatConfidence: unit(g.beatConfidence, 'grid.beatConfidence'), downbeatConfidence: unit(g.downbeatConfidence, 'grid.downbeatConfidence'),
      maxFitErrorSeconds: nullableNum(g.maxFitErrorSeconds, 'grid.maxFitErrorSeconds', 0, 60),
      beatSource: oneOf(g.beatSource, GRID_SOURCES, 'grid.beatSource'), downbeatSource: oneOf(g.downbeatSource, DOWNBEAT_SOURCES, 'grid.downbeatSource')},
    tonal: {status: oneOf(n.status, KEY_STATUS, 'tonal.status'), key: n.key === null ? null : text(n.key, 'tonal.key', 32), confidence: unit(n.confidence, 'tonal.confidence'),
      alternatives: list(n.alternatives, 8, 'tonal.alternatives').map((a, i) => text(a, `tonal.alternatives[${i}]`, 32))},
    loudness: {samplePeak: nullableNum(l.samplePeak, 'loudness.samplePeak', 0, 16)},
    structure: {version: st.version as string | null, partial: st.partial as boolean, medianEnergy: st.medianEnergy === null ? null : unit(st.medianEnergy, 'structure.medianEnergy')},
    sections: list(o.sections, SONG_DOSSIER_LIMITS.sections, 'sections').map((x, i) => parseSection(x, `sections[${i}]`)),
    cues: {entries: list(c.entries, SONG_DOSSIER_LIMITS.cues, 'cues.entries').map((x, i) => parseCue(x, `cues.entries[${i}]`)),
      exits: list(c.exits, SONG_DOSSIER_LIMITS.cues, 'cues.exits').map((x, i) => parseCue(x, `cues.exits[${i}]`))},
    quality: {flags, coverage: unit(q.coverage, 'quality.coverage')},
    cost: {analysisMs: num(cost.analysisMs, 'cost.analysisMs', 0, 86_400_000), at: cost.at as string},
    limitations: list(o.limitations, SONG_DOSSIER_LIMITS.limitations, 'limitations').map((x, i) => text(x, `limitations[${i}]`, SONG_DOSSIER_LIMITS.textChars)),
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > SONG_DOSSIER_LIMITS.maxBytes) fail('dossier is too large');
  return result;
}

// ---------------------------------------------------------------------------------------------
// Key identity
// ---------------------------------------------------------------------------------------------
/** What identifies an analysis result: the audio, the analysers and the requested-tempo hint. */
export interface DossierIdentity {
  readonly sha256: string;
  /** Producer timing the analysers used as evidence; both null when the song has none. */
  readonly tempoHint: number | null;
  readonly downbeatHintSeconds: number | null;
}
const fixed = (n: number): string => n.toFixed(3).replace('.', 'p');
const ID_PATTERN = /^[0-9a-f]{64}_[a-z0-9-]{1,80}_(?:none|\d{1,4}p\d{3})_(?:none|\d{1,5}p\d{3})$/;
/**
 * Stable file-safe id of a key: sha256, analysis tag, tempo hint, downbeat hint. Printable ASCII only,
 * no separators or dots, so it is safe as a file name and a query value.
 */
export function dossierId(key: DossierKey): string {
  const id = `${key.sha256}_${key.analysis.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)}_` +
    `${key.tempoHint === null ? 'none' : fixed(key.tempoHint)}_${key.downbeatHintSeconds === null ? 'none' : fixed(key.downbeatHintSeconds)}`;
  if (!ID_PATTERN.test(id)) throw new Error('Invalid song dossier: key cannot form an id');
  return id;
}
export const isDossierId = (value: unknown): value is string => typeof value === 'string' && value.length <= 200 && ID_PATTERN.test(value);
/** The key a song has under the CURRENT analysis version. */
export function currentKey(identity: DossierIdentity, analysis: string = SONG_DOSSIER_ANALYSIS): DossierKey {
  return {sha256: identity.sha256, analysis, tempoHint: identity.tempoHint, downbeatHintSeconds: identity.downbeatHintSeconds};
}
/** True when the dossier was made by the current analysers for exactly this identity (ids compare the rounded hints). */
export function isCurrentFor(dossier: SongDossier, identity: DossierIdentity, analysis: string = SONG_DOSSIER_ANALYSIS): boolean {
  try { return dossierId(dossier.key) === dossierId(currentKey(identity, analysis)); } catch { return false; }
}

// ---------------------------------------------------------------------------------------------
// Build from the existing analysis
// ---------------------------------------------------------------------------------------------
const round = (n: number, digits = 4): number => { const f = 10 ** digits; return Math.round(n * f) / f; };
const clean = (n: number, min: number, max: number): number => Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
const printable = (s: string, max: number): string => s.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, max);

function cueOf(c: MixPointCandidate, rate: number): DossierCue {
  return {seconds: round(clean(c.frame / rate, 0, SONG_DOSSIER_LIMITS.maxSeconds)), score: round(clean(c.score, -1e6, 1e6)), confidence: round(clean(c.confidence, 0, 1)),
    kind: c.evidence?.kind ?? null,
    reasons: c.reasons.slice(0, SONG_DOSSIER_LIMITS.reasons).map(r => printable(r, SONG_DOSSIER_LIMITS.reasonChars))};
}
const top = (cues: readonly MixPointCandidate[], rate: number): DossierCue[] =>
  [...cues].sort((a, b) => b.score - a.score).slice(0, SONG_DOSSIER_LIMITS.cues).map(c => cueOf(c, rate)).sort((a, b) => a.seconds - b.seconds);
/** Evenly thinned so a long song keeps its whole span within the cap. */
function thin<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * items.length / max)]!);
  return out;
}

export interface BuildContext {
  readonly identity: DossierIdentity;
  readonly channels: 1 | 2;
  /** Wall-clock milliseconds the analysis took (decode excluded); measured by the caller. */
  readonly analysisMs: number;
  /** ISO time the analysis finished. */
  readonly at: string;
}
/**
 * Wraps a whole-song `MixAnalysis` (native coordinates at `analysis.sampleRate`). The analysis is not
 * changed. Throws when the result would not pass `parseSongDossier`.
 */
export function buildSongDossier(analysis: MixAnalysis, context: BuildContext): SongDossier {
  const rate = analysis.sampleRate;
  const seconds = analysis.frames / rate;
  const beats = thin(analysis.beatGrid.frames.map(f => round(clean(f / rate, 0, SONG_DOSSIER_LIMITS.maxSeconds), 3)), SONG_DOSSIER_LIMITS.beats);
  const downbeats = thin(analysis.structure.downbeatFrames.map(f => round(clean(f / rate, 0, SONG_DOSSIER_LIMITS.maxSeconds), 3)), SONG_DOSSIER_LIMITS.downbeats);
  const windows = analysis.analyzedWindows ?? (analysis.analyzedWindow ? [analysis.analyzedWindow] : []);
  let covered = 0, cursor = 0;
  for (const w of [...windows].sort((a, b) => a.startFrame - b.startFrame)) {
    const start = Math.max(cursor, w.startFrame), end = Math.min(analysis.frames, w.startFrame + w.frames);
    if (end > start) { covered += end - start; cursor = end; }
  }
  const coverage = windows.length ? clean(covered / analysis.frames, 0, 1) : 1;
  const song = analysis.songStructure;
  const sections = (song?.sections ?? []).slice(0, SONG_DOSSIER_LIMITS.sections).map((s): DossierSection => ({
    startSeconds: round(clean(s.startFrame / rate, 0, SONG_DOSSIER_LIMITS.maxSeconds), 3), endSeconds: round(clean(s.endFrame / rate, 0, SONG_DOSSIER_LIMITS.maxSeconds), 3),
    startBar: s.startBar, bars: s.bars, label: s.label, guess: s.guess,
    energy: round(clean(s.energy, 0, 1)), low: round(clean(s.low, 0, 1)), vocal: round(clean(s.vocal, 0, 1)), confidence: round(clean(s.confidence, 0, 1))}));
  const flags: DossierFlag[] = [];
  const t = analysis.tempo;
  if (t.bpm === null) flags.push('tempo-unknown');
  if (t.status === 'insufficient-rhythm') flags.push('tempo-insufficient-rhythm');
  if (t.ambiguity >= FLAG_LIMITS.ambiguity) flags.push('tempo-ambiguous');
  if (analysis.beatGrid.confidence < FLAG_LIMITS.gridConfidence) flags.push('beat-grid-weak');
  if (analysis.structure.downbeatConfidence < FLAG_LIMITS.downbeatConfidence) flags.push('downbeat-weak');
  if (analysis.key.status === 'ambiguous') flags.push('key-ambiguous');
  if (analysis.key.name === null) flags.push('key-unknown');
  if (!song) flags.push('no-structure'); else if (song.partial) flags.push('structure-partial');
  if (coverage < FLAG_LIMITS.coverage) flags.push('partial-coverage');
  const dossier: SongDossier = {
    version: SONG_DOSSIER, key: currentKey(context.identity),
    source: {sampleRate: rate, frames: analysis.frames, channels: context.channels, seconds: round(seconds, 3)},
    tempo: {status: t.status, bpm: t.bpm === null ? null : round(clean(t.bpm, 20, 400), 3), confidence: round(clean(t.confidence, 0, 1)), ambiguity: round(clean(t.ambiguity, 0, 1)),
      alternatives: t.alternatives.slice(0, SONG_DOSSIER_LIMITS.alternatives).map(a => ({bpm: round(clean(a.bpm, 20, 400), 3), strength: round(clean(a.strength, -1e6, 1e6))})),
      driftBpm: analysis.songTempo ? round(clean(analysis.songTempo.driftBpm, 0, 400), 3) : null, resolvedBy: analysis.songTempo?.resolvedBy ?? null},
    grid: {beatSeconds: beats, downbeatSeconds: downbeats, beatConfidence: round(clean(analysis.beatGrid.confidence, 0, 1)),
      downbeatConfidence: round(clean(analysis.structure.downbeatConfidence, 0, 1)),
      maxFitErrorSeconds: analysis.beatGrid.maxFitErrorSeconds === null ? null : round(clean(analysis.beatGrid.maxFitErrorSeconds, 0, 60), 5),
      beatSource: analysis.beatGrid.source ?? 'measured', downbeatSource: analysis.structure.downbeatSource ?? 'audio'},
    tonal: {status: analysis.key.status, key: analysis.key.name === null ? null : printable(analysis.key.name, 32), confidence: round(clean(analysis.key.confidence, 0, 1)),
      alternatives: analysis.key.alternatives.slice(0, 8).map(a => printable(a.name, 32))},
    loudness: {samplePeak: analysis.nativePeak ? round(clean(analysis.nativePeak.value, 0, 16), 5) : null},
    structure: {version: song?.version ?? null, partial: song?.partial ?? true, medianEnergy: song ? round(clean(song.medianEnergy, 0, 1)) : null},
    sections, cues: {entries: top(analysis.mixIn, rate), exits: top(analysis.mixOut, rate)},
    quality: {flags, coverage: round(coverage, 3)},
    cost: {analysisMs: Math.round(clean(context.analysisMs, 0, 86_400_000)), at: context.at},
    limitations: analysis.limitations.slice(0, SONG_DOSSIER_LIMITS.limitations).map(l => printable(l, SONG_DOSSIER_LIMITS.textChars)),
  };
  return parseSongDossier(dossier);
}

/** One line for the Studio list and logs: tempo, key and flags in plain words. Estimates, not facts. */
export function dossierSummary(dossier: SongDossier): string {
  const bpm = dossier.tempo.bpm === null ? 'tempo uncertain' : `${dossier.tempo.bpm.toFixed(1)} BPM estimate`;
  const key = dossier.tonal.key && dossier.tonal.status === 'estimated' ? `${dossier.tonal.key} key estimate` : 'key uncertain';
  const flags = dossier.quality.flags.length ? ` · flags: ${dossier.quality.flags.join(', ')}` : '';
  return `${bpm} · ${key} · ${dossier.sections.length} section${dossier.sections.length === 1 ? '' : 's'}${flags}`;
}

/** The identity of an asset from its pack record: audio hash plus the producer's tempo and first-downbeat hints. */
export function identityOfAsset(asset: {readonly file: {readonly sha256: string; readonly sample_rate: number};
  readonly timing?: {readonly bpm: number; readonly first_downbeat_frame?: number} | null}): DossierIdentity {
  const timing = asset.timing;
  return {sha256: asset.file.sha256, tempoHint: timing && timing.bpm > 0 ? timing.bpm : null,
    downbeatHintSeconds: timing && timing.bpm > 0 && typeof timing.first_downbeat_frame === 'number' && asset.file.sample_rate > 0
      ? timing.first_downbeat_frame / asset.file.sample_rate : null};
}

/** Index row the relay returns for each stored file. */
export interface DossierIndexEntry {readonly id: string; readonly sha256: string; readonly analysis: string; readonly bytes: number; readonly at: string}
