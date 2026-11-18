/**
 * DJ song sources (EMF-S18 increment): the DJ's song pool is the UNION of the ticked source checkboxes.
 * Pure data (no DOM, no Node APIs) shared by the phone relay, the Studio page and the phone page.
 *
 * Sources: Music Studio loved, Music Studio liked, the existing EUTONOS packs (owner-local real FL, mock FL, rated
 * takes) and any number of owner-added folders of WAV files. A disliked take is never a source of anything: the
 * Music Studio listing only offers love and like, and the pool refuses any other rating.
 *
 * The relay owns the truth (`local/dj-sources/sources.json`: the ticks and the folder allow-list). The browser keeps a
 * localStorage cache of the ticks only; folders (and their absolute paths) live on the PC.
 */
export const SOURCES_ENVELOPE = 'em.dj-sources.v1' as const;
export const SOURCES_LIMITS = Object.freeze({
  /** The DJ set size cap (raised from 32, then to 128 by owner decision). The pool is refused, with a message, above this. */
  maxSongs: 128, minSongs: 2, maxFolders: 8, maxPathChars: 400, maxLabelChars: 60, maxFilesPerFolder: 128, maxRatings: 4096,
  /** Largest single file: the pack contract's own bound (src/pack.ts MAX_AUDIO_BYTES). */
  maxFileBytes: 64 * 1024 * 1024,
  /** All validated audio of one scan; nothing is resident (the DJ page fetches one song at a time). */
  maxScanBytes: 4 * 1024 * 1024 * 1024,
  /** Duration bounds of one song, seconds. */
  minSeconds: 10, maxSeconds: 20 * 60,
});

export const FIXED_SOURCES = Object.freeze([
  {id: 'studio-loved', kind: 'studio', label: 'Music Studio: loved', rating: 'love', defaultOn: true},
  {id: 'studio-liked', kind: 'studio', label: 'Music Studio: liked', rating: 'like', defaultOn: true},
  {id: 'pack-fl', kind: 'pack', label: 'Pack: real FL (owner-local)', rating: 'unrated', defaultOn: false},
  {id: 'pack-mock-fl', kind: 'pack', label: 'Pack: mock FL', rating: 'unrated', defaultOn: false},
  {id: 'pack-rated', kind: 'pack', label: 'Pack: rated takes (local)', rating: 'unrated', defaultOn: false},
] as const);
export type FixedSourceId = typeof FIXED_SOURCES[number]['id'];
export const FIXED_SOURCE_IDS: readonly string[] = FIXED_SOURCES.map(s => s.id);
export type SourceKind = 'studio' | 'pack' | 'folder';
export type SongRating = 'love' | 'like' | 'unrated';
export const SONG_RATINGS: readonly SongRating[] = ['love', 'like', 'unrated'];
export const RATING_WORDS: Readonly<Record<SongRating, string>> = {love: 'loved', like: 'liked', unrated: 'unrated, playable'};
export const FOLDER_ID = /^folder-[0-9a-f]{12}$/;
export const isSourceId = (value: unknown): value is string =>
  typeof value === 'string' && (FIXED_SOURCE_IDS.includes(value) || FOLDER_ID.test(value));

/** A folder on the allow-list. `path` is shown on the PC only; the phone sees the label. */
export interface SourceFolder { readonly id: string; readonly label: string; readonly path?: string }
export interface SourcesDoc {
  readonly version: typeof SOURCES_ENVELOPE;
  /** ISO time of the last write; null for the built-in defaults. */
  readonly updatedAt: string | null;
  readonly rev: number;
  /** Source id to ticked. A missing id means its default (folders default to ticked once added). */
  readonly ticks: Readonly<Record<string, boolean>>;
  readonly folders: readonly SourceFolder[];
}
export interface SourceStatus {
  readonly id: string;
  readonly kind: SourceKind;
  readonly label: string;
  readonly ticked: boolean;
  /** False when the source cannot supply songs right now (Music Studio not running, pack or folder missing). */
  readonly available: boolean;
  /** Playable songs this source contributed before de-duplication; null when not scanned (unticked) yet. */
  readonly songs: number | null;
  /** What the owner should know: why it is unavailable, what was skipped. Never an absolute path. */
  readonly message: string;
}
/** One song of the pool as the Studio and the phone show it. */
export interface PoolSong {
  readonly assetId: string;
  readonly title: string;
  readonly source: string;
  readonly sourceLabel: string;
  readonly rating: SongRating;
  /** Other ticked sources that hold the same audio (same SHA-256). */
  readonly also: readonly string[];
  /** 'requested' (producer or file name) or 'placeholder' (no tempo known: the DJ measures it). */
  readonly tempoSource: 'requested' | 'placeholder';
  readonly seconds: number;
}
export interface PoolStatus {
  readonly ok: boolean;
  readonly songs: number;
  /** Changes whenever the set of songs (their audio hashes) changes; the Studio reloads the queue when it does. */
  readonly rev: string;
  readonly scanning: boolean;
  readonly message: string;
}
/** What the owner can do to a song's rating from the booth or the phone; `null` clears it (click the same rating again). */
export type RateAction = SongRating extends infer _ ? 'love' | 'like' | 'dislike' | null : never;
export const isRateAction = (v: unknown): v is RateAction => v === null || v === 'love' || v === 'like' || v === 'dislike';
export const ASSET_ID = /^src-[0-9a-f]{32}$/;
/** A song the owner disliked: not playable, kept as a negative example, with an Undo that restores it. */
export interface DislikedSong {
  readonly assetId: string;
  readonly title: string;
  readonly sourceLabel: string;
  /** What Undo restores (love or like for Music Studio takes; unrated otherwise). */
  readonly previous: SongRating;
}
export interface SourcesView {
  readonly version: typeof SOURCES_ENVELOPE;
  readonly updatedAt: string | null;
  readonly rev: number;
  readonly ticks: Readonly<Record<string, boolean>>;
  readonly folders: readonly SourceFolder[];
  readonly sources: readonly SourceStatus[];
  readonly pool: PoolStatus;
  readonly songs: readonly PoolSong[];
  readonly disliked: readonly DislikedSong[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function defaultTicks(): Record<string, boolean> {
  return Object.fromEntries(FIXED_SOURCES.map(s => [s.id, s.defaultOn]));
}
/** Effective tick for a source id (defaults filled in). */
export function isTicked(ticks: Readonly<Record<string, boolean>>, id: string): boolean {
  if (Object.hasOwn(ticks, id)) return ticks[id] === true;
  const fixed = FIXED_SOURCES.find(s => s.id === id);
  return fixed ? fixed.defaultOn : FOLDER_ID.test(id);
}
/**
 * A tick patch is `{ticks: {id: boolean}}` or just `{id: boolean}` entries under `ticks`. Unknown ids are refused (one
 * bad entry rejects the whole patch) so a typo cannot silently do nothing.
 */
export function parseTickPatch(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) throw new Error('Expected an object of source ticks.');
  const out: Record<string, boolean> = {};
  const keys = Object.keys(value);
  if (keys.length > FIXED_SOURCES.length + SOURCES_LIMITS.maxFolders) throw new Error('Too many source ticks.');
  for (const key of keys) {
    if (!isSourceId(key)) throw new Error('Unknown source.');
    if (typeof value[key] !== 'boolean') throw new Error('A source tick must be true or false.');
    out[key] = value[key];
  }
  return out;
}
export function parseSourcesDoc(value: unknown): SourcesDoc {
  if (!isRecord(value) || value.version !== SOURCES_ENVELOPE) throw new Error('envelope');
  if (Object.keys(value).some(k => !['version', 'updatedAt', 'rev', 'ticks', 'folders'].includes(k))) throw new Error('unknown field');
  const {updatedAt, rev} = value;
  if (updatedAt !== null && !(typeof updatedAt === 'string' && ISO_TIME.test(updatedAt) && !Number.isNaN(Date.parse(updatedAt)))) throw new Error('updatedAt');
  if (!Number.isSafeInteger(rev) || (rev as number) < 0 || (rev as number) > 1_000_000_000) throw new Error('rev');
  const ticks = parseTickPatch(value.ticks);
  if (!Array.isArray(value.folders) || value.folders.length > SOURCES_LIMITS.maxFolders) throw new Error('folders');
  const seen = new Set<string>();
  const folders = value.folders.map((raw): SourceFolder => {
    if (!isRecord(raw) || Object.keys(raw).some(k => !['id', 'label', 'path'].includes(k))) throw new Error('folder');
    if (typeof raw.id !== 'string' || !FOLDER_ID.test(raw.id) || seen.has(raw.id)) throw new Error('folder id');
    seen.add(raw.id);
    if (typeof raw.label !== 'string' || !raw.label.length || raw.label.length > SOURCES_LIMITS.maxLabelChars || /[\x00-\x1f\x7f]/.test(raw.label)) throw new Error('folder label');
    if (raw.path !== undefined && (typeof raw.path !== 'string' || !raw.path.length || raw.path.length > SOURCES_LIMITS.maxPathChars)) throw new Error('folder path');
    return {id: raw.id, label: raw.label, ...(raw.path !== undefined ? {path: raw.path} : {})};
  });
  return {version: SOURCES_ENVELOPE, updatedAt: updatedAt as string | null, rev: rev as number, ticks, folders};
}
export const defaultSourcesDoc = (): SourcesDoc => ({version: SOURCES_ENVELOPE, updatedAt: null, rev: 0, ticks: defaultTicks(), folders: []});

/** What a song's source is, stamped on ratings so sources can be compared. Never holds a path. */
export interface SongSourceStamp {
  readonly source: string;
  readonly label: string;
  readonly rating: SongRating;
}
export function isSongSourceStamp(value: unknown): value is SongSourceStamp {
  return isRecord(value) && Object.keys(value).length === 3 && isSourceId(value.source) &&
    typeof value.label === 'string' && value.label.length > 0 && value.label.length <= 80 && !/[\x00-\x1f\x7f]/.test(value.label) &&
    SONG_RATINGS.includes(value.rating as SongRating);
}
export interface PairSourceStamp { readonly from: SongSourceStamp; readonly to: SongSourceStamp }
export function isPairSourceStamp(value: unknown): value is PairSourceStamp {
  return isRecord(value) && Object.keys(value).length === 2 && isSongSourceStamp(value.from) && isSongSourceStamp(value.to);
}
export const stampOfSong = (song: PoolSong): SongSourceStamp => ({source: song.source, label: song.sourceLabel, rating: song.rating});
/** "Music Studio: loved - loved" style text for lists: source, then rating in words. */
export function songSourceText(song: {readonly sourceLabel: string; readonly rating: SongRating}): string {
  return `${song.sourceLabel} · ${RATING_WORDS[song.rating]}`;
}
/** Pair label used by the report ("Music Studio: loved -> Folder: Beats"). */
export const pairSourceLabel = (pair: PairSourceStamp): string => `${pair.from.label} -> ${pair.to.label}`;
