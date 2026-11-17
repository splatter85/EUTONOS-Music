import {analyzeMixAudio} from '../../src/mix-analysis.js';
import {labelSongStructure} from '../../web/mix-structure.js';
import {buildSongDossier, type DossierIdentity, type SongDossier} from '../../web/song-dossier.js';
import {makeMixFixture} from './mix-fixtures.js';

let cached: ReturnType<typeof analyzeMixAudio> | null = null;
/** One real analysis of an original synthetic song, computed once per test process. */
export function sampleAnalysis(): ReturnType<typeof analyzeMixAudio> {
  if (!cached) {
    const base = analyzeMixAudio(makeMixFixture({bpm: 100, bars: 32, sampleRate: 16000}));
    const structure = labelSongStructure(base);
    cached = structure ? {...base, songStructure: structure} : base;
  }
  return cached;
}
export const sha = (n: number): string => n.toString(16).padStart(64, '0');
export const identity = (n: number, bpm: number | null = 100): DossierIdentity =>
  ({sha256: sha(n), tempoHint: bpm, downbeatHintSeconds: bpm === null ? null : 0.25});
/** A valid dossier for song number `n`, built from the real sample analysis. */
export function sampleDossier(n = 1, bpm: number | null = 100): SongDossier {
  return buildSongDossier(sampleAnalysis(), {identity: identity(n, bpm), channels: 2, analysisMs: 1234, at: '2026-11-16T10:00:00.000Z'});
}
