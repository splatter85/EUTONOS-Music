/**
 * EMF-S06 mock FL producer. MOCK ONLY: no FL Studio runs and nothing here shows FL control.
 *
 * It drives the real S08 broker through its MCP JSON-RPC session (create, prepare, apply,
 * verify, render, verify-export) against MockFlHost, a HostAdapter whose "render" is a small
 * deterministic synthesizer of the project's song notes. The renders become an
 * em.producer-delivery.v0 delivery that the producer-agnostic importer turns into a pack.
 * Synthesis uses only + - * / and rounding, so the bytes are the same on every OS.
 */
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  EV, PATTERN_BASE, parseFlp, serializeFlp, songLengthTicks, songNotes, viewProject, type FlpEvent, type ProjectView,
} from '../src/authoring/flp.js';
import type {HostAdapter, HostInfo, HostRun} from '../src/authoring/host.js';
import {McpSession} from '../src/authoring/mcp-server.js';
import {DELIVERY_VERSION, importDelivery} from '../src/importer.js';

export const MOCK_RATE = 44100;
export const MOCK_TAIL_FRAMES = MOCK_RATE / 2;
const TEMPLATE = 'fl-factory/create-a-chord-progression';
const PPQ = 96;

// ---------- synthetic, non-proprietary template ----------
const utf16 = (s: string) => { const b = new Uint8Array((s.length + 1) * 2); [...s].forEach((c, i) => { b[i * 2] = c.charCodeAt(0); }); return b; };
const ascii = (s: string) => new TextEncoder().encode(s + '\0');

function playlist(items: readonly {pattern: number; length: number; track: number}[]): Uint8Array {
  const b = new Uint8Array(items.length * 80), v = new DataView(b.buffer);
  items.forEach((it, i) => {
    const o = i * 80;
    v.setUint32(o, 0, true); v.setUint16(o + 4, PATTERN_BASE, true); v.setUint16(o + 6, PATTERN_BASE + it.pattern, true);
    v.setUint32(o + 8, it.length, true); v.setUint16(o + 12, 499 - it.track, true); v.setUint32(o + 28, it.length, true);
    v.setFloat64(o + 64, 1, true);
  });
  return b;
}

/** A one-bar, 120 BPM, FL 24-layout project with empty patterns Main and Beat and channels Keys and Kit. */
export function mockTemplateFlp(): Uint8Array {
  const events: FlpEvent[] = [
    {id: EV.version, value: ascii('24.2.99.4720')}, {id: EV.tempo, value: 120000}, {id: EV.timeSigNum, value: 4}, {id: EV.timeSigDen, value: 4},
    {id: EV.channelNew, value: 0}, {id: EV.pluginDefaultName, value: utf16('MockSynth')}, {id: EV.channelName, value: utf16('Keys')},
    {id: EV.channelNew, value: 1}, {id: EV.pluginDefaultName, value: utf16('MockKit')}, {id: EV.channelName, value: utf16('Kit')},
    {id: EV.patternNew, value: 1}, {id: EV.patternName, value: utf16('Main')},
    {id: EV.patternNew, value: 2}, {id: EV.patternName, value: utf16('Beat')},
    {id: EV.arrangementNew, value: 0},
    {id: EV.playlist, value: playlist([{pattern: 1, length: 4 * PPQ, track: 0}, {pattern: 2, length: 4 * PPQ, track: 1}])},
  ];
  return serializeFlp({format: 0, channelCount: 2, ppq: PPQ, events});
}

// ---------- deterministic mock synthesizer ----------
/** Equal-tempered C4..B4 in Hz; other octaves are exact power-of-two scalings. */
const OCTAVE4 = [261.6255653005986, 277.1826309768721, 293.6647679174076, 311.1269837220809, 329.6275569128699,
  349.2282314330039, 369.9944227116344, 391.99543598174927, 415.3046975799451, 440, 466.1637615180899, 493.8833012561241];
function hz(key: number): number {
  let f = OCTAVE4[((key % 12) + 12) % 12]!;
  for (let o = Math.floor(key / 12) - 5; o > 0; o--) f *= 2;
  for (let o = Math.floor(key / 12) - 5; o < 0; o++) f /= 2;
  return f;
}
/** Parabolic sine approximation of sin(2*pi*q) for q in [0, 1). */
const psin = (q: number) => q < 0.5 ? 16 * q * (0.5 - q) : -16 * (q - 0.5) * (1 - q);

interface Voice { readonly left: number; readonly right: number; sample(t: number, len: number): number }
function voice(channel: string | null, key: number, start: number): Voice {
  if (channel === 'Kit' && key <= 40) {
    let phase = 0;
    return {left: 0.30, right: 0.36, sample(t, len) {
      const f = 45 + 115 * (1 - t / len) * (1 - t / len);
      phase += f / MOCK_RATE; phase -= Math.floor(phase);
      const e = (1 - t / len) * (1 - t / len) * Math.min(1, t / 16);
      return e * psin(phase);
    }};
  }
  if (channel === 'Kit') {
    let state = (0x9e3779b9 ^ (start * 31 + key)) >>> 0 || 1;
    return {left: 0.08, right: 0.12, sample(t, len) {
      state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
      const e = (1 - t / len) * (1 - t / len) * (1 - t / len) * Math.min(1, t / 8);
      return e * (state / 2147483648 - 1);
    }};
  }
  let phase = 0;
  const step = hz(key) / MOCK_RATE;
  return {left: 0.15, right: 0.11, sample(t, len) {
    phase += step; phase -= Math.floor(phase);
    const harmonic = phase * 2 - Math.floor(phase * 2);
    const e = (1 - t / len) * (1 - t / len) * Math.min(1, t / 64);
    return e * (psin(phase) + 0.25 * psin(harmonic));
  }};
}

/** Stereo PCM16 render of the arranged song notes, plus a half-second tail. Every note fades to zero by its end. */
export function renderSong(view: ProjectView): Uint8Array {
  const bpm = view.tempoBpm ?? 120, frameOf = (ticks: number) => Math.round(ticks / view.ppq * 60 / bpm * MOCK_RATE);
  const frames = frameOf(songLengthTicks(view)) + MOCK_TAIL_FRAMES;
  const left = new Float64Array(frames), right = new Float64Array(frames);
  const song = songNotes(view);
  for (const channel of view.channels) {
    for (const note of song.get(channel.index) ?? []) {
      const start = frameOf(note.start), len = frameOf(note.start + note.length) - start;
      const v = voice(channel.name, note.key, start), velocity = Math.min(128, note.velocity) / 128;
      for (let t = 0; t < len && start + t < frames; t++) {
        const s = v.sample(t, len) * velocity;
        left[start + t]! += s * v.left; right[start + t]! += s * v.right;
      }
    }
  }
  const data = frames * 4, out = new Uint8Array(44 + data), d = new DataView(out.buffer);
  const tag = (at: number, s: string) => out.set(new TextEncoder().encode(s), at);
  tag(0, 'RIFF'); d.setUint32(4, 36 + data, true); tag(8, 'WAVEfmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true);
  d.setUint16(22, 2, true); d.setUint32(24, MOCK_RATE, true); d.setUint32(28, MOCK_RATE * 4, true); d.setUint16(32, 4, true);
  d.setUint16(34, 16, true); tag(36, 'data'); d.setUint32(40, data, true);
  const q = (x: number) => Math.max(-32767, Math.min(32767, Math.round(x * 32767)));
  for (let f = 0; f < frames; f++) { d.setInt16(44 + f * 4, q(left[f]!), true); d.setInt16(46 + f * 4, q(right[f]!), true); }
  return out;
}

function smf(division: number, tempoUs: number, tracks: readonly {name: string; notes: {key: number; start: number; length: number; velocity: number}[]}[]): Uint8Array {
  const vlq = (n: number) => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
  const chunk = (tag: string, body: number[]) => [...tag].map(c => c.charCodeAt(0)).concat([body.length >>> 24, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255], body);
  const track0 = [0, 0xff, 0x51, 3, tempoUs >> 16, (tempoUs >> 8) & 255, tempoUs & 255, 0, 0xff, 0x2f, 0];
  const out = [...chunk('MThd', [0, 1, 0, tracks.length + 1, division >> 8, division & 255]), ...chunk('MTrk', track0)];
  for (const t of tracks) {
    const ev: {at: number; data: number[]}[] = [];
    for (const n of t.notes) { ev.push({at: n.start, data: [0x90, n.key, n.velocity]}); ev.push({at: n.start + n.length, data: [0x80, n.key, 0]}); }
    ev.sort((a, b) => a.at - b.at || a.data[0]! - b.data[0]!);
    const body = [0, 0xff, 0x03, t.name.length, ...[...t.name].map(c => c.charCodeAt(0))];
    let last = 0;
    for (const e of ev) { body.push(...vlq(e.at - last), ...e.data); last = e.at; }
    body.push(0, 0xff, 0x2f, 0);
    out.push(...chunk('MTrk', body));
  }
  return Uint8Array.from(out);
}

/** HostAdapter double. It mirrors the S08 FL CLI conventions (stereo 44.1 kHz PCM16; MIDI end-note one tick short). */
export class MockFlHost implements HostAdapter {
  constructor(private readonly template: string) {}
  async info(): Promise<HostInfo> {
    return {platform: process.platform, adapter: 'mock-fl (S06; no FL Studio)', available: true, fl_executable: null, fl_version: 'mock', reason: null};
  }
  async runningInstances() { return []; }
  async renderWav(path: string): Promise<HostRun> {
    await writeFile(path.replace(/\.flp$/, '.wav'), renderSong(viewProject(parseFlp(new Uint8Array(await readFile(path))))));
    return {command: 'mock-render "<project>"', exit_code: 0, duration_ms: 0};
  }
  async exportMidi(path: string): Promise<HostRun> {
    const view = viewProject(parseFlp(new Uint8Array(await readFile(path))));
    const end = songLengthTicks(view), song = songNotes(view);
    const tracks = view.channels.map(c => ({name: c.name ?? '', notes: (song.get(c.index) ?? [])
      .map(n => ({key: n.key, start: n.start, length: n.start + n.length === end ? n.length - 1 : n.length, velocity: Math.min(127, n.velocity)}))}));
    await writeFile(path.replace(/\.flp$/, '.mid'), smf(view.ppq, Math.round(60e6 / (view.tempoBpm ?? 120)), tracks));
    return {command: 'mock-midi "<project>"', exit_code: 0, duration_ms: 0};
  }
  async templatePath(id: string) { return id === TEMPLATE ? this.template : null; }
}

// ---------- the delivery the mock producer authors ----------
export interface NoteSpec { readonly midi: number; readonly start_quarters: number; readonly duration_quarters: number; readonly velocity: number }
const MAIN = {pattern: {index: 1, expected_name: 'Main'}, channel: {index: 0, expected_name: 'Keys'}};
const BEAT = {pattern: {index: 2, expected_name: 'Beat'}, channel: {index: 1, expected_name: 'Kit'}};
export const range = (n: number) => [...Array(n).keys()];

const RECORDING_A = {
  keys: range(32).map(i => ({midi: [57, 60, 64, 69][i % 4]!, start_quarters: i, duration_quarters: 1, velocity: 0.7})),
  kit: range(16).flatMap(b => [{midi: 36, start_quarters: b * 2, duration_quarters: 0.5, velocity: 0.9},
    {midi: 42, start_quarters: b * 2 + 1.5, duration_quarters: 0.25, velocity: 0.6}]),
};
const RECORDING_B = {
  keys: range(16).flatMap(h => [57, 60, 64].map(midi => ({midi: midi + (h % 4 === 3 ? 12 : 0), start_quarters: h * 2, duration_quarters: 2, velocity: 0.55}))),
  kit: range(32).flatMap(q => [{midi: 36, start_quarters: q, duration_quarters: 0.5, velocity: 0.85},
    {midi: 42, start_quarters: q + 0.5, duration_quarters: 0.25, velocity: 0.5}]),
};
/** One-shots: one bar each, rendered by "FL" with a tail, then trimmed by the importer to the sounding length. */
export const ONE_SHOTS = [
  {id: 's06-mock-kick', role: 'drum', target: BEAT, notes: [{midi: 36, start_quarters: 0, duration_quarters: 0.375, velocity: 1}], root: null, harmony: null},
  {id: 's06-mock-hat', role: 'percussion', target: BEAT, notes: [{midi: 42, start_quarters: 0, duration_quarters: 0.1875, velocity: 1}], root: null, harmony: null},
  {id: 's06-mock-bass-a2', role: 'bass', target: MAIN, notes: [{midi: 45, start_quarters: 0, duration_quarters: 0.75, velocity: 0.9}], root: 45, harmony: [9]},
  {id: 's06-mock-chord-am', role: 'harmony', target: MAIN,
    notes: [57, 60, 64].map(midi => ({midi, start_quarters: 0, duration_quarters: 1.5, velocity: 0.8})), root: 57, harmony: [0, 4, 9]},
] as const;
const soundingFrames = (notes: readonly NoteSpec[]) =>
  Math.max(...notes.map(n => Math.round((n.start_quarters + n.duration_quarters) * 60 / 120 * MOCK_RATE)));

const RIGHTS = {origin: 'Synthesized by the S06 mock FL host (repository code); no FL Studio, plugins, presets or external samples.',
  creator: 'EUTONOS Music EMF-S06 mock producer', license: 'CC0-1.0',
  allowed_uses: ['playback', 'redistribution', 'sample-reuse'], evidence: 'PROVENANCE.md'};
const PROVENANCE = `# S06 mock FL delivery — provenance

MOCK. No FL Studio ran. The EUTONOS Music MCP broker (S08) drove \`MockFlHost\`, a
test double whose "render" is a deterministic synthesizer of the project's notes
(\`scripts/mock-fl-producer.ts\`). Nothing here shows FL Studio control.

The audio is original synthetic test material made only with repository code and
is dedicated to the public domain under CC0-1.0. It is regenerated on demand and
is not committed. Eligibility is fixture-only; listening is NOT TESTED.
`;

export type Call = (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export function mcpClient(workspace: string, host: HostAdapter): {call: Call; init: () => Promise<void>} {
  const replies: Record<string, unknown>[] = [];
  const session = new McpSession({workspace, host, write: line => replies.push(JSON.parse(line))});
  let id = 0;
  const send = async (method: string, params: unknown) => {
    await session.handleLine(JSON.stringify({jsonrpc: '2.0', id: ++id, method, params}));
    const reply = replies.pop();
    if (!reply || reply.id !== id) throw new Error(`no MCP reply to ${method}`);
    if (reply.error) throw new Error(`MCP ${method}: ${JSON.stringify(reply.error)}`);
    return reply.result as Record<string, unknown>;
  };
  return {
    init: async () => { await send('initialize', {protocolVersion: '2025-06-18', clientInfo: {name: 's06-mock-producer'}, capabilities: {}}); },
    call: async (name, args) => {
      const result = await send('tools/call', {name, arguments: args}) as {isError: boolean; structuredContent: Record<string, unknown>};
      if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.structuredContent.error)}`);
      return result.structuredContent;
    },
  };
}

/** Authors, verifies and renders one disposable project; returns the verified render's WAV hash. */
export async function author(call: Call, project: string, bars: number, targets: readonly unknown[]): Promise<{renderId: string; sha256: string}> {
  await call('fl_create_project', {project_id: project, template: TEMPLATE, operation_id: `op-create-${project}`});
  const {revision} = await call('fl_inspect', {project_id: project}) as {revision: string};
  const {change_id} = await call('fl_prepare_edit', {project_id: project, expected_revision: revision, tempo_bpm: 120, clip_bars: bars, targets}) as {change_id: string};
  await call('fl_acquire_writer', {project_id: project});
  const applied = await call('fl_apply_edit', {project_id: project, change_id, operation_id: `op-apply-${project}`}) as {status: string};
  if (applied.status !== 'applied_file_verified') throw new Error(`${project}: ${applied.status}`);
  const verified = await call('fl_verify', {project_id: project}) as {verified: boolean; problems: string[]};
  if (!verified.verified) throw new Error(`${project}: host readback failed: ${verified.problems.join('; ')}`);
  const {render_id} = await call('fl_render', {project_id: project, operation_id: `op-render-${project}`}) as {render_id: string};
  const exported = await call('fl_verify_export', {project_id: project, render_id}) as {ok: boolean; problems: string[]; wav: {sha256: string}};
  if (!exported.ok) throw new Error(`${project}: ${exported.problems.join('; ')}`);
  await call('fl_release_writer', {project_id: project});
  return {renderId: render_id, sha256: exported.wav.sha256};
}

export interface MockDeliveryOptions {
  /** Test hook: change render bytes after fl_verify_export, as a damaged transfer would. */
  readonly tamper?: (id: string, wav: Uint8Array) => Uint8Array;
}

/** Writes `<deliveryDir>/delivery.json`, `PROVENANCE.md` and `renders/*.wav`. The directory must not exist. */
export async function produceMockDelivery(deliveryDir: string, options: MockDeliveryOptions = {}): Promise<Record<string, unknown>> {
  if (await stat(deliveryDir).then(() => true, () => false)) throw new Error('delivery directory already exists');
  const scratch = await mkdtemp(join(tmpdir(), 'em-s06-mock-fl-'));
  try {
    const template = join(scratch, 'template.flp');
    await writeFile(template, mockTemplateFlp());
    const workspace = join(scratch, 'workspace'), {init, call} = mcpClient(workspace, new MockFlHost(template));
    await init();
    await mkdir(join(deliveryDir, 'renders'), {recursive: true});
    const delivered = async (project: string, bars: number, targets: readonly unknown[]) => {
      const {renderId, sha256} = await author(call, project, bars, targets);
      let wav: Uint8Array = new Uint8Array(await readFile(join(workspace, 'projects', project, 'renders', renderId, `${project}.wav`)));
      if (options.tamper) wav = options.tamper(project, wav);
      await writeFile(join(deliveryDir, 'renders', `${project}.wav`), wav);
      return {source: `renders/${project}.wav`, expected_sha256: sha256};
    };
    const recording = async (id: string, title: string, notes: {keys: readonly NoteSpec[]; kit: readonly NoteSpec[]}) => ({
      id, revision: 1, title, source_kind: 'recording',
      ...await delivered(id, 8, [{...MAIN, notes: notes.keys}, {...BEAT, notes: notes.kit}]),
      rights: RIGHTS, eligibility: 'fixture-only', genres: ['synthetic-test'], states: ['explore', 'drive'],
      key: 'A minor', harmony_pitch_classes: [0, 4, 9],
      timing: {bpm: 120, meter: [4, 4], bars: 8, phrase_bars: 4, first_downbeat_frame: 0},
      cues: [{id: 'entry', kind: 'entry', position_quarters: 0}, {id: 'exit', kind: 'exit', position_quarters: 16},
        {id: 'end', kind: 'exit', position_quarters: 32}],
    });
    const assets: unknown[] = [
      await recording('s06-mock-recording-a', 'S06 mock A — keys arpeggio and kit', RECORDING_A),
      await recording('s06-mock-recording-b', 'S06 mock B — held chords and kit', RECORDING_B),
    ];
    for (const shot of ONE_SHOTS) {
      assets.push({id: shot.id, revision: 1, title: `S06 mock ${shot.role} one-shot`, source_kind: 'sample',
        ...await delivered(shot.id, 1, [{...shot.target, notes: shot.notes}]), keep_frames: soundingFrames(shot.notes),
        rights: RIGHTS, eligibility: 'fixture-only', genres: ['synthetic-test'], states: ['explore', 'drive'],
        key: shot.harmony ? 'A minor' : null, harmony_pitch_classes: shot.harmony, timing: null, cues: []});
    }
    const delivery = {
      schema_version: DELIVERY_VERSION,
      producer: {id: 's06-mock-fl-producer', revision: 1, kind: 'mock-fl-studio-mcp',
        description: 'MOCK: the S08 MCP broker drove a mock FL host; no FL Studio ran and nothing here shows FL control.'},
      pack: {id: 's06-mock-fl', revision: 1}, assets,
      palettes: [{id: 's06-mock-palette', revision: 1,
        samples: ONE_SHOTS.map(s => ({asset: {id: s.id, revision: 1}, role: s.role, root_midi: s.root}))}],
      recipes: [{id: 's06-mock-recipe', revision: 1, palette: {id: 's06-mock-palette', revision: 1}, bpm: 120, meter: [4, 4],
        phrase_bars: 4, key: 'A minor', harmony_pitch_classes: [0, 4, 9], genres: ['synthetic-test'], states: ['explore', 'drive']}],
      routes: [{id: 's06-a-to-b', revision: 1, from: {id: 's06-mock-recording-a', revision: 1}, to: {id: 's06-mock-recording-b', revision: 1},
        exit_cue: 'exit', entry_cue: 'entry', overlap_quarters: 8, review: 'fixture-only'}],
    };
    await writeFile(join(deliveryDir, 'PROVENANCE.md'), PROVENANCE);
    await writeFile(join(deliveryDir, 'delivery.json'), JSON.stringify(delivery, null, 2) + '\n');
    return delivery;
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
}

const MARKER = '.s06-mock-fl';

/** Regenerates `<out>/delivery` and `<out>/pack`. Only a folder this script made (or none) is replaced. */
export async function generateMockPack(out: string): Promise<string> {
  const root = resolve(out);
  if (await stat(root).then(() => true, () => false)) {
    if (!(await stat(join(root, MARKER)).then(() => true, () => false))) throw new Error(`${root} exists and was not made by this script`);
    await rm(root, {recursive: true, force: true});
  }
  await mkdir(root, {recursive: true});
  await writeFile(join(root, MARKER), 'Generated by scripts/mock-fl-producer.ts; safe to delete.\n');
  await produceMockDelivery(join(root, 'delivery'));
  await importDelivery(join(root, 'delivery'), join(root, 'pack'));
  return join(root, 'pack');
}

export const DEFAULT_MOCK_OUT = fileURLToPath(new URL('../generated/s06-mock-fl/', import.meta.url));

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out')) {
    console.error('Usage: node dist/scripts/mock-fl-producer.js [--out <directory>]');
    process.exitCode = 2;
  } else {
    generateMockPack(args[1] ?? DEFAULT_MOCK_OUT).then(async pack => {
      const receipt = JSON.parse(await readFile(join(pack, 'IMPORT.json'), 'utf8'));
      console.log(JSON.stringify({pack, manifest_sha256: receipt.manifest_sha256, generator: receipt.generator.checks,
        note: 'MOCK producer: no FL Studio ran. Listening NOT TESTED.'}, null, 2));
    }, (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}

