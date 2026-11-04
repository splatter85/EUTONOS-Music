/** Offline construction of original, fixed S01 test material; not a music performer. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AudioAsset, AudioPack, Rights } from '../src/pack-types.js';

export const FIXTURE_GENERATOR_VERSION = 1;
export const FIXTURE_SEED = 0x454d4601;
const RATE = 24_000;
const QUARTER = 12_000;
const TRACK_FRAMES = 32 * QUARTER;
const PHASE_MASK = 0xffffff;
// Rounded Q24 phase increments at 24 kHz: A2, C3, E3, A3, C4, E4.
const PITCH = [76_896, 91_445, 115_213, 153_791, 182_890, 230_427] as const;

type Voice = 'kick' | 'percussion' | 'bass' | 'harmony';

function triangle(phase: number): number {
  const p = phase >>> 8;
  return p < 32_768 ? p * 2 - 32_768 : 98_303 - p * 2;
}

function note(voice: Voice, length: number, variant = 0, seed = FIXTURE_SEED): Int32Array {
  const out = new Int32Array(length);
  const phases = [0, 0, 0];
  let noise = seed >>> 0;
  let filtered = 0;
  const attack = voice === 'harmony' ? 1_200 : voice === 'bass' ? 160 : 24;
  const release = voice === 'harmony' ? Math.min(6_000, length >> 2) : Math.max(1, length - attack);
  for (let i = 0; i < length; i++) {
    let value = 0;
    if (voice === 'kick') {
      // A downward pitch sweep and decaying triangle, entirely integer arithmetic.
      const step = 36_000 + Math.trunc(190_000 * (length - i) ** 2 / (length * length));
      phases[0] = ((phases[0] ?? 0) + step) & PHASE_MASK;
      value = Math.trunc(triangle(phases[0]) * 9_000 / 32_768);
    } else if (voice === 'percussion') {
      noise ^= noise << 13;
      noise ^= noise >>> 17;
      noise ^= noise << 5;
      value = Math.trunc(((noise >>> 16) - 32_768) * 2_200 / 32_768);
    } else {
      const increments = voice === 'bass' ? [PITCH[0]] : variant === 0 ? PITCH.slice(0, 3) : PITCH.slice(3, 6);
      for (let k = 0; k < increments.length; k++) {
        phases[k] = ((phases[k] ?? 0) + increments[k]!) & PHASE_MASK;
        let wave = triangle(phases[k]!);
        if (voice === 'bass' && variant === 1) {
          // A smoothed pulse gives B a different waveform without changing the pitch class.
          filtered = Math.trunc((filtered * 7 + (phases[k]! < 0x800000 ? 24_000 : -24_000)) / 8);
          wave = filtered;
        }
        value += Math.trunc(wave * (voice === 'bass' ? 4_000 : 1_300) / 32_768);
      }
    }
    const envelope = Math.min(32_768, Math.trunc(i * 32_768 / attack), Math.trunc((length - 1 - i) * 32_768 / release));
    out[i] = Math.trunc(value * envelope / 32_768);
  }
  return out;
}

function add(target: Int32Array, source: Int32Array, start: number, gain = 32_768): void {
  for (let i = 0; i < source.length && start + i < target.length; i++) {
    target[start + i] = target[start + i]! + Math.trunc(source[i]! * gain / 32_768);
  }
}

function recording(variant: 0 | 1): Int32Array {
  const out = new Int32Array(TRACK_FRAMES);
  for (let bar = 0; bar < 8; bar++) {
    const base = bar * 4 * QUARTER;
    for (const beat of variant === 0 ? [0, 2] : [0, 1.5, 3]) {
      add(out, note('kick', 6_000), base + beat * QUARTER, variant === 0 ? 32_768 : 27_000);
    }
    for (const beat of variant === 0 ? [1, 3] : [0.5, 1, 2.5, 3.5]) {
      add(out, note('percussion', 1_800, 0, FIXTURE_SEED + base + beat * QUARTER), base + beat * QUARTER);
    }
    for (const beat of variant === 0 ? [0, 2] : [0, 1.5, 2.5, 3]) {
      add(out, note('bass', variant === 0 ? 18_000 : 9_000, variant), base + beat * QUARTER);
    }
  }
  for (let q = 0; q < 32; q += 8) add(out, note('harmony', 8 * QUARTER, variant), q * QUARTER);
  // Both finite recordings end at exactly eight bars, with a short final fade.
  for (let i = TRACK_FRAMES - 2_400; i < TRACK_FRAMES; i++) {
    out[i] = Math.trunc(out[i]! * (TRACK_FRAMES - 1 - i) / 2_399);
  }
  return out;
}

function wav(samples: Int32Array): Buffer {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]!;
    if (value < -30_000 || value > 30_000) throw new Error(`Fixture lacks headroom at frame ${i}`);
    bytes.writeInt16LE(value, 44 + i * 2);
  }
  return bytes;
}

export interface GeneratedFixtures {
  readonly manifest: AudioPack;
  readonly files: ReadonlyMap<string, Buffer>;
}

/** Pure, repeatable materialization: no file access, clocks, random sources or audio devices. */
export function generateFixtures(): GeneratedFixtures {
  const files = new Map<string, Buffer>();
  const rights: Rights = {
    origin: 'Original integer-synthesized fixture; no external recordings, samples or plugins.',
    creator: 'OpenAI ChatGPT for EUTONOS-Music',
    license: 'CC0-1.0',
    allowed_uses: ['playback', 'redistribution', 'sample-reuse'],
    evidence: 'PROVENANCE.md',
  };
  const definitions: readonly [string, string, 'recording' | 'sample', Int32Array, readonly number[] | null][] = [
    ['s01-recording-a', 'S01 A — slow triangle pulse', 'recording', recording(0), [0, 4, 9]],
    ['s01-recording-b', 'S01 B — syncopated pulse', 'recording', recording(1), [0, 4, 9]],
    ['s01-kick', 'S01 original kick', 'sample', note('kick', 6_000), null],
    ['s01-percussion', 'S01 original seeded percussion', 'sample', note('percussion', 1_800), null],
    ['s01-bass-a2', 'S01 original A2 bass', 'sample', note('bass', 9_000), [9]],
    ['s01-harmony-am', 'S01 original A minor harmony', 'sample', note('harmony', 24_000), [0, 4, 9]],
  ];
  const assets: AudioAsset[] = definitions.map(([id, title, kind, samples, harmony]) => {
    const path = `audio/${id}.wav`;
    const bytes = wav(samples);
    files.set(path, bytes);
    return {
      id, revision: 1, title, source_kind: kind,
      file: { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
        format: 'pcm16-wav', sample_rate: RATE, channels: 1, frames: samples.length },
      rights, eligibility: 'fixture-only', genres: ['synthetic-test'], states: ['explore', 'drive'],
      key: harmony === null ? null : 'A minor', harmony_pitch_classes: harmony,
      timing: kind === 'recording' ? { bpm: 120, meter: [4, 4], bars: 8, phrase_bars: 4, first_downbeat_frame: 0 } : null,
      cues: kind === 'recording' ? [
        { id: 'entry', kind: 'entry', position_quarters: 0 },
        { id: 'exit', kind: 'exit', position_quarters: 16 },
        { id: 'end', kind: 'exit', position_quarters: 32 },
      ] : [],
    };
  });
  const manifest: AudioPack = {
    schema_version: 'em.audio-pack.v0', id: 's01-foundation', revision: 1, assets,
    palettes: [{ id: 's01-palette', revision: 1, samples: [
      { asset: { id: 's01-kick', revision: 1 }, role: 'drum', root_midi: null },
      { asset: { id: 's01-percussion', revision: 1 }, role: 'percussion', root_midi: null },
      { asset: { id: 's01-bass-a2', revision: 1 }, role: 'bass', root_midi: 45 },
      { asset: { id: 's01-harmony-am', revision: 1 }, role: 'harmony', root_midi: 45 },
    ] }],
    recipes: [{ id: 's01-recipe', revision: 1, palette: { id: 's01-palette', revision: 1 },
      bpm: 120, meter: [4, 4], phrase_bars: 4, key: 'A minor', harmony_pitch_classes: [0, 4, 9],
      genres: ['synthetic-test'], states: ['explore', 'drive'] }],
    routes: [{ id: 's01-a-to-b', revision: 1,
      from: { id: 's01-recording-a', revision: 1 }, to: { id: 's01-recording-b', revision: 1 },
      exit_cue: 'exit', entry_cue: 'entry', overlap_quarters: 8, review: 'fixture-only' }],
  };
  files.set('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'));
  return { manifest, files };
}

async function main(args: readonly string[]): Promise<void> {
  const check = args.includes('--check');
  const positional = args.filter(arg => arg !== '--check');
  if (positional.length > 1 || positional.some(arg => arg.startsWith('-')) || args.filter(arg => arg === '--check').length > 1) {
    throw new Error('Usage: node dist/scripts/generate-fixtures.js [--check] [output-directory]');
  }
  const directory = positional[0] === undefined
    ? fileURLToPath(new URL('../../fixtures/s01/', import.meta.url)) : resolve(positional[0]);
  const { files } = generateFixtures();
  for (const [relative, expected] of files) {
    const path = resolve(directory, relative);
    if (check) {
      const actual = await readFile(path);
      if (!actual.equals(expected)) throw new Error(`Fixture differs from generator v${FIXTURE_GENERATOR_VERSION}: ${relative}`);
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, expected);
    }
  }
  process.stdout.write(`${check ? 'Verified' : 'Generated'} ${files.size} deterministic fixture files (generator v${FIXTURE_GENERATOR_VERSION}, seed 0x${FIXTURE_SEED.toString(16)}).\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
