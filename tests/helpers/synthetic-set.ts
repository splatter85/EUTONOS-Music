/**
 * S18 synthetic set: original generated kick/bass/triad songs (never owner audio), exported in
 * the rated-export shape and imported through the real `importRatedTakes --set` path, so
 * tests and the browser check exercise the same pack contract the owner's set uses.
 */
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {MixPcm} from '../../src/mix-analysis.js';
import {importRatedTakes, setAssetId} from '../../src/rated-takes.js';
import {makeMixFixture} from './mix-fixtures.js';

export interface SyntheticSong {
  readonly id: string; readonly bpm: number; readonly bars?: number;
  readonly tonic?: number; readonly mode?: 'major' | 'minor';
  readonly seconds?: number; readonly stereo?: boolean; readonly transitionEvidence?: boolean;
}

/** Original sectioned fixture, with real accent/activity changes rather than mocked analysis. */
export function makeSetFixture(song: SyntheticSong, sampleRate = 16000): MixPcm {
  const bars = song.seconds ? Math.ceil(song.seconds * song.bpm / 240) : song.bars ?? 16;
  const options = {bpm: song.bpm, bars, sampleRate, tonic: song.tonic ?? 9, mode: song.mode ?? 'minor' as const};
  const pcm = makeMixFixture({...options, ...(song.transitionEvidence ? {chords: false} : {})});
  const channel = pcm.channels[0] as Float32Array;
  if (song.transitionEvidence) {
    const harmony = makeMixFixture({...options, drums: false}).channels[0]!;
    for (let i = 0; i < channel.length; i++) {
      const beat = Math.floor(i * song.bpm / (sampleRate * 60)), bar = Math.floor(beat / 4);
      channel[i] = (channel[i]! * (beat % 4 === 0 ? 1 : 0.8) + harmony[i]! * 0.35) * (Math.floor(bar / 4) % 2 === 0 ? 1 : 0.5);
    }
  }
  const cropped = song.seconds ? channel.slice(0, Math.round(song.seconds * sampleRate)) : channel;
  return {sampleRate, channels: song.stereo ? [cropped, new Float32Array(cropped)] : [cropped]};
}
/** Default four-song set: 128, 122, 90 and 128 BPM, 16 bars each, at 16 kHz mono. */
export const SYNTHETIC_SET: readonly SyntheticSong[] = [
  {id: 'synthetic-128-a', bpm: 128, tonic: 9, mode: 'minor'},
  {id: 'synthetic-122', bpm: 122, tonic: 9, mode: 'minor'},
  {id: 'synthetic-90', bpm: 90, tonic: 2, mode: 'major'},
  {id: 'synthetic-128-b', bpm: 128, tonic: 4, mode: 'minor'},
];

export function pcm16Wav(pcm: MixPcm): Uint8Array {
  const channels = pcm.channels.length, frames = pcm.channels[0]!.length;
  const bytes = new Uint8Array(44 + frames * channels * 2), view = new DataView(bytes.buffer);
  const tag = (at: number, value: string): void => bytes.set(new TextEncoder().encode(value), at);
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, pcm.sampleRate, true); view.setUint32(28, pcm.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, frames * channels * 2, true);
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
    const value = Math.max(-1, Math.min(1, pcm.channels[c]![i]!));
    view.setInt16(44 + (i * channels + c) * 2, Math.round(value * 32767), true);
  }
  return bytes;
}

/** Decodes a PCM16 WAV to Float32 channels (test-only stand-in for decodeAudioData). */
export function decodePcm16(bytes: Uint8Array): {sampleRate: number; channels: Float32Array[]} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true), sampleRate = view.getUint32(24, true);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4)), size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const frames = size / (channels * 2);
      const out = Array.from({length: channels}, () => new Float32Array(frames));
      for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) {
        out[c]![i] = view.getInt16(offset + 8 + (i * channels + c) * 2, true) / 32768;
      }
      return {sampleRate, channels: out};
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('No WAV data chunk.');
}

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

/**
 * Writes a synthetic rated export and imports it as a set. Returns the output root whose
 * `pack/manifest.json` is the set pack, plus the asset IDs in set (catalogue) order.
 */
export async function buildSyntheticSet(songs: readonly SyntheticSong[] = SYNTHETIC_SET, sampleRate = 16000) {
  const root = await mkdtemp(join(tmpdir(), 's18-set-')), source = join(root, 'export'), out = join(root, 'out');
  const sets: {rating: string; manifest: string}[] = [];
  const recipe = json({synthetic: true, note: 'Generated test tone; inert data'});
  const groups: Record<'love' | 'like' | 'dislike', SyntheticSong[]> = {
    love: songs.filter((_, i) => i % 2 === 0), like: songs.filter((_, i) => i % 2 === 1),
    dislike: [{id: 'synthetic-dislike', bpm: 120, bars: 4}],
  };
  for (const rating of ['love', 'like', 'dislike'] as const) {
    const takes = [];
    for (const song of groups[rating]) {
      const pcm = makeSetFixture(song, sampleRate);
      const audio = pcm16Wav(pcm), frames = pcm.channels[0]!.length;
      await mkdir(join(source, rating, song.id), {recursive: true});
      const file = (name: string, bytes: Uint8Array) => ({path: `${song.id}/${name}`, sha256: sha(bytes), bytes: bytes.length});
      await writeFile(join(source, rating, song.id, 'take.wav'), audio);
      await writeFile(join(source, rating, song.id, 'audition.wav'), audio);
      await writeFile(join(source, rating, song.id, 'recipe.json'), recipe);
      takes.push({id: song.id, title: `Synthetic ${song.bpm} BPM (${song.id})`, rating, duration_seconds: frames / sampleRate,
        tempo: {bpm: song.bpm, source: 'requested'}, key: {value: null, source: 'unknown'},
        audio: file('take.wav', audio), recipe: file('recipe.json', recipe), dj_audio: file('audition.wav', audio)});
    }
    await writeFile(join(source, rating, 'manifest.json'), json({schema_version: 'music-studio.rated-set.v1', rating, takes}));
    sets.push({rating, manifest: `${rating}/manifest.json`});
  }
  await writeFile(join(source, 'manifest.json'), json({schema_version: 'music-studio.rated-export.v1', sets}));
  await importRatedTakes(source, out, {set: 'loved-liked'});
  const order = [...groups.love, ...groups.like].map(s => setAssetId(s.id));
  return {root, out, manifest: join(out, 'pack', 'manifest.json'), order,
    idFor: (takeId: string) => setAssetId(takeId), cleanup: () => rm(root, {recursive: true, force: true})};
}
