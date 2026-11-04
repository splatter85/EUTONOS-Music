/** v0 is deliberately small: PCM16 WAV, constant tempo, 4/4 and authored cues. */
export const PACK_VERSION = 'em.audio-pack.v0' as const;
export type MusicState = 'browse' | 'explore' | 'drive' | 'surge' | 'afterglow';
export type SampleRole = 'drum' | 'percussion' | 'bass' | 'harmony' | 'texture';

export interface VersionRef {
  readonly id: string;
  readonly revision: number;
}

export interface AudioFile {
  /** Lowercase, forward-slash, pack-relative path; never a URL or host path. */
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly format: 'pcm16-wav';
  readonly sample_rate: number;
  readonly channels: 1 | 2;
  readonly frames: number;
}

export interface Rights {
  readonly origin: string;
  readonly creator: string;
  readonly license: string;
  readonly allowed_uses: readonly ('playback' | 'redistribution' | 'sample-reuse')[];
  /** Human-readable evidence shipped within the pack, not a verification claim. */
  readonly evidence: string;
}

export interface Cue {
  readonly id: string;
  readonly kind: 'entry' | 'exit';
  /** Zero-based quarter notes, not beats in an ambiguous meter or sample frames. */
  readonly position_quarters: number;
}

export interface Timing {
  /** Quarter notes per minute; constant across this v0 recording. */
  readonly bpm: number;
  readonly meter: readonly [4, 4];
  readonly bars: number;
  readonly phrase_bars: number;
  readonly first_downbeat_frame: number;
}

export interface AudioAsset extends VersionRef {
  readonly title: string;
  readonly source_kind: 'recording' | 'sample';
  readonly file: AudioFile;
  readonly rights: Rights;
  readonly eligibility: 'fixture-only' | 'unreviewed' | 'listening-reviewed';
  readonly genres: readonly string[];
  readonly states: readonly MusicState[];
  readonly key: string | null;
  /** Authored constant harmony for the whole item; null means no asserted harmony. */
  readonly harmony_pitch_classes: readonly number[] | null;
  /** Required for recordings; null for one-shot samples. */
  readonly timing: Timing | null;
  readonly cues: readonly Cue[];
}

export interface Palette extends VersionRef {
  readonly samples: readonly {
    readonly asset: VersionRef;
    readonly role: SampleRole;
    readonly root_midi: number | null;
  }[];
}

/** Descriptive reference only: v0 does not run a recipe or arbitrary code. */
export interface RecipeReference extends VersionRef {
  readonly palette: VersionRef;
  readonly bpm: number;
  readonly meter: readonly [4, 4];
  readonly phrase_bars: number;
  readonly key: string | null;
  readonly harmony_pitch_classes: readonly number[] | null;
  readonly genres: readonly string[];
  readonly states: readonly MusicState[];
}

export interface CueRoute extends VersionRef {
  readonly from: VersionRef;
  readonly to: VersionRef;
  readonly exit_cue: string;
  readonly entry_cue: string;
  readonly overlap_quarters: number;
  /** Timing/harmony assertions are engineering fixtures, not listening approval. */
  readonly review: 'fixture-only';
}

export interface AudioPack extends VersionRef {
  readonly schema_version: typeof PACK_VERSION;
  readonly assets: readonly AudioAsset[];
  readonly palettes: readonly Palette[];
  readonly recipes: readonly RecipeReference[];
  readonly routes: readonly CueRoute[];
}
