/**
 * EMF-S09 real FL producer (Windows). It drives the same S08 broker as the S06 mock producer, but
 * through WindowsFlHost: FL Studio's own CLI renders disposable projects made from its factory
 * template. The renders become an em.producer-delivery.v0 delivery that the unchanged S06 importer
 * turns into a pack.
 *
 * OWNER-LOCAL ONLY. The owner decided (2026-11-06) that these renders may be reused as samples on
 * this PC. They use FL's factory instruments, so they are never committed or published: the output
 * root defaults to the git-ignored `local/` folder. FL Studio must be closed while this runs.
 * Nothing here is a listening judgment.
 */
import {mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {HostAdapter} from '../src/authoring/host.js';
import {WindowsFlHost} from '../src/authoring/host-windows.js';
import {DELIVERY_VERSION, importDelivery} from '../src/importer.js';
import {maxRoleFrames, type S01PhraseRole} from '../src/phrase-plan.js';
import {author, mcpClient, range, type NoteSpec} from './mock-fl-producer.js';

export const FL_RATE = 44100;
/** A tail at or below this peak (as a fraction of full scale) is inaudible residue; the importer's own limit is 0.001. */
const RESIDUE = 0.0008;
const TAIL_MARGIN_FRAMES = 32;

const CH = {chords: {index: 0, expected_name: 'Chords'}, bass: {index: 1, expected_name: 'Bass'},
  lead: {index: 2, expected_name: 'Lead'}, drums: {index: 3, expected_name: 'Drums'}} as const;
const PAT = {chords: {index: 1, expected_name: 'Chords'}, bass: {index: 2, expected_name: 'Bass'},
  lead: {index: 3, expected_name: 'Lead'}, drums: {index: 4, expected_name: 'Drums'}} as const;
type Part = keyof typeof CH;
const PARTS: readonly Part[] = ['chords', 'bass', 'lead', 'drums'];
const KICK = 36, SNARE = 38, HAT = 42, A2 = 45;
const AM = [57, 60, 64]; // A minor triad: pitch classes 9, 0, 4

type Parts = Readonly<Record<Part, readonly NoteSpec[]>>;
const note = (midi: number, start: number, duration: number, velocity: number): NoteSpec =>
  ({midi, start_quarters: start, duration_quarters: duration, velocity});
const targets = (parts: Parts) => PARTS.map(p => ({pattern: PAT[p], channel: CH[p], notes: parts[p]}));
const silent: Parts = {chords: [], bass: [], lead: [], drums: []};

/** A: slow and spare, eight bars of A minor. */
export const RECORDING_A: Parts = {
  chords: range(8).flatMap(b => AM.map(m => note(m, b * 4, 3.5, 0.6))),
  bass: range(8).flatMap(b => [note(A2, b * 4, 1.5, 0.8), note(A2, b * 4 + 2, 1, 0.7)]),
  lead: [],
  drums: range(16).flatMap(h => [note(KICK, h * 2, 0.25, 0.9), note(HAT, h * 2 + 1.5, 0.125, 0.6)]),
};
/** B: busier, four on the floor with an arpeggio on top; same key and tempo. */
export const RECORDING_B: Parts = {
  chords: range(16).flatMap(h => AM.map(m => note(m, h * 2, 1.875, 0.5))),
  bass: range(64).map(e => note(A2, e * 0.5, 0.375, 0.75)),
  lead: range(64).map(e => note([69, 72, 76, 72][e % 4]!, e * 0.5, 0.375, 0.6)),
  drums: range(32).flatMap(q => [note(KICK, q, 0.25, 0.9), ...(q % 2 === 1 ? [note(SNARE, q, 0.25, 0.7)] : []),
    note(HAT, q + 0.5, 0.125, 0.5)]),
};

export interface Shot {
  readonly id: string; readonly role: S01PhraseRole; readonly parts: Parts;
  readonly root: number | null; readonly harmony: readonly number[] | null;
}
/** One-shots: one bar each; the producer trims each to its sounding length and refuses one over the role limit. */
export const SHOTS: readonly Shot[] = [
  {id: 's09-fl-kick', role: 'drum', parts: {...silent, drums: [note(KICK, 0, 0.25, 1)]}, root: null, harmony: null},
  {id: 's09-fl-hat', role: 'percussion', parts: {...silent, drums: [note(HAT, 0, 0.125, 1)]}, root: null, harmony: null},
  {id: 's09-fl-bass-a2', role: 'bass', parts: {...silent, bass: [note(A2, 0, 0.5, 0.9)]}, root: 45, harmony: [9]},
  {id: 's09-fl-chord-am', role: 'harmony', parts: {...silent, chords: AM.map(m => note(m, 0, 1, 0.8))}, root: 57, harmony: [0, 4, 9]},
];

// ---------- WAV measurement ----------
export interface WavInfo { readonly sampleRate: number; readonly channels: number; readonly frames: number; readonly dataOffset: number }
export function wavInfo(wav: Uint8Array): WavInfo {
  const d = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (o: number) => String.fromCharCode(...wav.subarray(o, o + 4));
  if (wav.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let fmt: {rate: number; channels: number; bits: number} | null = null;
  for (let o = 12; o + 8 <= wav.length;) {
    const size = d.getUint32(o + 4, true);
    if (tag(o) === 'fmt ') fmt = {channels: d.getUint16(o + 10, true), rate: d.getUint32(o + 12, true), bits: d.getUint16(o + 22, true)};
    if (tag(o) === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('expected 16-bit PCM before the data chunk');
      return {sampleRate: fmt.rate, channels: fmt.channels, frames: Math.floor(Math.min(size, wav.length - o - 8) / (2 * fmt.channels)), dataOffset: o + 8};
    }
    o += 8 + size + (size & 1);
  }
  throw new Error('no data chunk');
}

/** 1 + the last frame whose peak exceeds the residue limit, plus a small margin; 0 for a silent file. */
export function soundingFrames(wav: Uint8Array): number {
  const info = wavInfo(wav), d = new DataView(wav.buffer, wav.byteOffset, wav.byteLength), limit = RESIDUE * 32768;
  for (let f = info.frames - 1; f >= 0; f--) {
    for (let c = 0; c < info.channels; c++) {
      if (Math.abs(d.getInt16(info.dataOffset + (f * info.channels + c) * 2, true)) > limit) return Math.min(info.frames, f + 1 + TAIL_MARGIN_FRAMES);
    }
  }
  return 0;
}


/** First `frames` frames of a stereo PCM16 WAV with a raised-cosine fade over the last 30 %, as a canonical 44-byte-header WAV. */
export function fadeCut(wav: Uint8Array, frames: number): Uint8Array {
  const info = wavInfo(wav), src = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (frames > info.frames) throw new Error('cannot keep more frames than the render has');
  const data = frames * info.channels * 2, out = new Uint8Array(44 + data), d = new DataView(out.buffer);
  const tag = (at: number, s: string) => out.set(new TextEncoder().encode(s), at);
  tag(0, 'RIFF'); d.setUint32(4, 36 + data, true); tag(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
  d.setUint16(22, info.channels, true); d.setUint32(24, info.sampleRate, true); d.setUint32(28, info.sampleRate * info.channels * 2, true);
  d.setUint16(32, info.channels * 2, true); d.setUint16(34, 16, true); tag(36, 'data'); d.setUint32(40, data, true);
  const fade = Math.max(1, Math.floor(frames * 0.3)), from = frames - fade;
  for (let f = 0; f < frames; f++) {
    const gain = f < from ? 1 : 0.5 * (1 + Math.cos(Math.PI * (f - from + 1) / fade));
    for (let c = 0; c < info.channels; c++) {
      const at = (f * info.channels + c) * 2;
      d.setInt16(44 + at, Math.round(src.getInt16(info.dataOffset + at, true) * gain), true);
    }
  }
  return out;
}

// ---------- delivery ----------
export interface FlProducerOptions {
  readonly host?: HostAdapter;
  readonly flVersion?: string | null;
}

const rightsFor = (flVersion: string | null) => ({
  origin: `Rendered on the owner's PC by FL Studio${flVersion ? ` ${flVersion}` : ''} (CLI) from this repo's notes in FL's factory chord template; FL factory sounds.`,
  creator: 'EUTONOS Music EMF-S09 producer (notes); FL Studio factory sounds (instruments)',
  license: 'owner-local-only',
  allowed_uses: ['playback', 'sample-reuse'],
  evidence: 'PROVENANCE.md',
});
const provenance = (flVersion: string | null) => `# S09 real FL delivery — provenance

**OWNER-LOCAL ONLY. Do not commit, publish or share this folder or its audio.**

- The audio was rendered by FL Studio${flVersion ? ` ${flVersion}` : ''} on the owner's Windows PC through the
  EUTONOS Music MCP broker (S08): a disposable project is created from FL's factory template, notes
  written by \`scripts/fl-producer.ts\` are applied and verified, and FL's CLI renders it.
- The sounds are FL Studio's factory instruments and presets. Their redistribution terms were not
  reviewed. The owner decided on 2026-11-06 that these renders may be reused as samples **for the
  owner's own use on this PC only**. That is why \`allowed_uses\` omits \`redistribution\` and why the
  folder lives in the git-ignored \`local/\` directory.
- Eligibility is \`fixture-only\`: an engineering/audition gate, not a listening judgment. Nobody has
  reviewed this material by ear (that is S10).
- A one-shot whose natural sounding length exceeds its role's contract limit is cut at the limit with
  a raised-cosine fade over its last 30 %; \`shaping.json\` lists each one-shot's render hash and lengths.
- FL renders are not byte-reproducible; the hashes in the import receipt describe this run only.
`;

export interface Delivery { readonly delivery: Record<string, unknown>; readonly sampleFrames: Readonly<Record<string, number>> }

/** Writes `<deliveryDir>/delivery.json`, `PROVENANCE.md` and `renders/*.wav`. */
export async function produceFlDelivery(deliveryDir: string, workspace: string, options: FlProducerOptions = {}): Promise<Delivery> {
  const host = options.host ?? new WindowsFlHost();
  const info = await host.info();
  if (!info.available) throw new Error(`FL Studio is not available: ${info.reason ?? 'unknown reason'}`);
  const running = await host.runningInstances();
  if (running.length) throw new Error('FL Studio is running. Close it first: the CLI hands off to a running instance and renders nothing.');
  const flVersion = options.flVersion ?? info.fl_version;
  const rights = rightsFor(flVersion);
  const {init, call} = mcpClient(workspace, host);
  await init();
  await mkdir(join(deliveryDir, 'renders'), {recursive: true});
  const rendered = async (project: string, bars: number, parts: Parts) => {
    const {renderId, sha256} = await author(call, project, bars, targets(parts));
    const wav = new Uint8Array(await readFile(join(workspace, 'projects', project, 'renders', renderId, `${project}.wav`)));
    const meta = wavInfo(wav);
    if (meta.sampleRate !== FL_RATE || meta.channels !== 2) throw new Error(`${project}: expected 44.1 kHz stereo, got ${meta.sampleRate} Hz x ${meta.channels}`);
    await writeFile(join(deliveryDir, 'renders', `${project}.wav`), wav);
    return {wav, source: `renders/${project}.wav`, expected_sha256: sha256};
  };
  const recording = async (id: string, title: string, parts: Parts) => {
    const {source, expected_sha256} = await rendered(id, 8, parts);
    return {id, revision: 1, title, source_kind: 'recording', source, expected_sha256, rights, eligibility: 'fixture-only',
      genres: ['fl-factory-sketch'], states: ['explore', 'drive'], key: 'A minor', harmony_pitch_classes: [0, 4, 9],
      timing: {bpm: 120, meter: [4, 4], bars: 8, phrase_bars: 4, first_downbeat_frame: 0},
      cues: [{id: 'entry', kind: 'entry', position_quarters: 0}, {id: 'exit', kind: 'exit', position_quarters: 16},
        {id: 'end', kind: 'exit', position_quarters: 32}]};
  };
  const assets: unknown[] = [
    await recording('s09-fl-recording-a', 'S09 FL A — chords, bass and kit (slow)', RECORDING_A),
    await recording('s09-fl-recording-b', 'S09 FL B — arpeggio, bass and kit (busy)', RECORDING_B),
  ];
  const sampleFrames: Record<string, number> = {};
  const shaping: Record<string, unknown> = {};
  for (const shot of SHOTS) {
    const {wav, source, expected_sha256} = await rendered(shot.id, 1, shot.parts);
    const natural = soundingFrames(wav), limit = maxRoleFrames(shot.role, FL_RATE);
    if (natural === 0) throw new Error(`${shot.id}: the render is silent`);
    let keep = natural, shaped = false, expected: string | undefined = expected_sha256;
    if (natural > limit) {
      // The role limit is part of the palette contract, so the sample is shortened rather than the limit relaxed:
      // cut at the limit with a raised-cosine fade over its last 30 %, and write the shaped bytes in place of the render.
      await writeFile(join(deliveryDir, source), fadeCut(wav, limit));
      keep = limit; shaped = true; expected = undefined;
    }
    sampleFrames[shot.id] = keep;
    shaping[shot.id] = {render_sha256: expected_sha256, natural_frames: natural, kept_frames: keep, fade_cut: shaped};
    assets.push({id: shot.id, revision: 1, title: `S09 FL ${shot.role} one-shot`, source_kind: 'sample', source,
      ...(expected ? {expected_sha256: expected} : {}), keep_frames: keep, rights, eligibility: 'fixture-only',
      genres: ['fl-factory-sketch'], states: ['explore', 'drive'],
      key: shot.harmony ? 'A minor' : null, harmony_pitch_classes: shot.harmony, timing: null, cues: []});
  }
  const delivery = {
    schema_version: DELIVERY_VERSION,
    producer: {id: 's09-fl-producer', revision: 1, kind: 'fl-studio-mcp',
      description: `Real FL Studio${flVersion ? ` ${flVersion}` : ''} CLI renders through the S08 MCP broker (Windows). Owner-local reuse only.`},
    pack: {id: 's09-fl', revision: 1}, assets,
    palettes: [{id: 's09-fl-palette', revision: 1,
      samples: SHOTS.map(s => ({asset: {id: s.id, revision: 1}, role: s.role, root_midi: s.root}))}],
    recipes: [{id: 's09-fl-recipe', revision: 1, palette: {id: 's09-fl-palette', revision: 1}, bpm: 120, meter: [4, 4],
      phrase_bars: 4, key: 'A minor', harmony_pitch_classes: [0, 4, 9], genres: ['fl-factory-sketch'], states: ['explore', 'drive']}],
    routes: [{id: 's09-a-to-b', revision: 1, from: {id: 's09-fl-recording-a', revision: 1}, to: {id: 's09-fl-recording-b', revision: 1},
      exit_cue: 'exit', entry_cue: 'entry', overlap_quarters: 8, review: 'fixture-only'}],
  };
  await writeFile(join(deliveryDir, 'PROVENANCE.md'), provenance(flVersion));
  await writeFile(join(deliveryDir, 'delivery.json'), JSON.stringify(delivery, null, 2) + '\n');
  await writeFile(join(deliveryDir, 'shaping.json'), JSON.stringify(shaping, null, 2) + '\n');
  return {delivery, sampleFrames};
}

const MARKER = '.s09-fl';
export const DEFAULT_FL_OUT = fileURLToPath(new URL('../../local/s09-fl/', import.meta.url));

/** Regenerates `<out>/delivery`, `<out>/pack` and the disposable `<out>/workspace`. Only a folder this script made (or none) is replaced. */
export async function generateFlPack(out: string, options: FlProducerOptions = {}): Promise<string> {
  const root = resolve(out);
  if (await stat(root).then(() => true, () => false)) {
    if (!(await stat(join(root, MARKER)).then(() => true, () => false))) throw new Error(`${root} exists and was not made by this script`);
    await rm(root, {recursive: true, force: true});
  }
  await mkdir(root, {recursive: true});
  await writeFile(join(root, MARKER), 'Generated by scripts/fl-producer.ts. OWNER-LOCAL ONLY: never commit or publish. Safe to delete.\n');
  await produceFlDelivery(join(root, 'delivery'), join(root, 'workspace'), options);
  await importDelivery(join(root, 'delivery'), join(root, 'pack'));
  return join(root, 'pack');
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out')) {
    console.error('Usage: node dist/scripts/fl-producer.js [--out <directory>]   (FL Studio must be closed; Windows)');
    process.exitCode = 2;
  } else {
    generateFlPack(args[1] ?? DEFAULT_FL_OUT).then(async pack => {
      const receipt = JSON.parse(await readFile(join(pack, 'IMPORT.json'), 'utf8'));
      console.log(JSON.stringify({pack, manifest_sha256: receipt.manifest_sha256, generator: receipt.generator.checks,
        note: 'Real FL render, owner-local only. Listening NOT TESTED.'}, null, 2));
    }, (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
