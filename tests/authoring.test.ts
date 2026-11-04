import assert from 'node:assert/strict';
import {appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {Broker} from '../src/authoring/broker.js';
import {AuthoringError} from '../src/authoring/errors.js';
import {
  EV, PATTERN_BASE, encodeNotes, parseFlp, replaceChannelNotes, serializeFlp, setPatternClipLength, setTempo,
  songLengthTicks, songNotes, viewProject, NOTE_DEFAULTS, type FlpEvent,
} from '../src/authoring/flp.js';
import {UnsupportedHost, type HostAdapter, type HostInfo, type HostRun} from '../src/authoring/host.js';
import {McpSession, SUPPORTED_PROTOCOLS, TOOLS} from '../src/authoring/mcp-server.js';
import {parseSmf} from '../src/authoring/smf.js';
import {loadPack} from '../src/node.js';

// ---------- synthetic, non-proprietary FLP ----------
const utf16 = (s: string) => { const b = new Uint8Array((s.length + 1) * 2); [...s].forEach((c, i) => { b[i * 2] = c.charCodeAt(0); }); return b; };
const ascii = (s: string) => new TextEncoder().encode(s + '\0');
const note = (position: number, channel: number, key: number, length = 48, velocity = 100) =>
  ({...NOTE_DEFAULTS, position, channel, key, length, velocity});
function playlist(items: {pattern: number; position: number; length: number; track: number}[]): Uint8Array {
  const b = new Uint8Array(items.length * 80), v = new DataView(b.buffer);
  items.forEach((it, i) => {
    const o = i * 80;
    v.setUint32(o, it.position, true); v.setUint16(o + 4, PATTERN_BASE, true); v.setUint16(o + 6, PATTERN_BASE + it.pattern, true);
    v.setUint32(o + 8, it.length, true); v.setUint16(o + 12, 499 - it.track, true); v.setUint32(o + 28, it.length, true);
    v.setFloat64(o + 64, 1, true);
  });
  return b;
}
function syntheticFlp(version = '24.2.99.4720'): Uint8Array {
  const events: FlpEvent[] = [
    {id: EV.version, value: ascii(version)}, {id: EV.tempo, value: 128000}, {id: EV.timeSigNum, value: 4}, {id: EV.timeSigDen, value: 4},
    {id: EV.patternNew, value: 1}, {id: EV.notes, value: encodeNotes([note(0, 0, 60), note(96, 0, 64), note(0, 1, 36, 24)])},
    {id: EV.channelIid, value: 0}, {id: EV.patternUnknown161, value: 0}, {id: EV.channelIid, value: 1}, {id: EV.patternUnknown161, value: 0},
    {id: EV.channelNew, value: 0}, {id: EV.pluginDefaultName, value: utf16('TestSynth')}, {id: EV.channelName, value: utf16('Keys')},
    {id: EV.channelNew, value: 1}, {id: EV.channelName, value: utf16('Kit')},
    {id: EV.patternNew, value: 1}, {id: EV.patternName, value: utf16('Main')},
    {id: EV.patternNew, value: 2}, {id: EV.patternName, value: utf16('Beat')},
    {id: EV.arrangementNew, value: 0},
    {id: EV.playlist, value: playlist([{pattern: 1, position: 0, length: 384, track: 0}, {pattern: 2, position: 0, length: 384, track: 1}])},
  ];
  return serializeFlp({format: 0, channelCount: 2, ppq: 96, events});
}

// ---------- fake FL host mirroring observed CLI behaviour ----------
function smf(division: number, tempoUs: number, tracks: {name: string; notes: {key: number; start: number; length: number; velocity: number}[]}[]): Uint8Array {
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
function wav(frames: number, rate = 8000, amplitude = 8000): Uint8Array {
  const data = frames * 4, b = new Uint8Array(44 + data), v = new DataView(b.buffer);
  b.set(new TextEncoder().encode('RIFF'), 0); v.setUint32(4, 36 + data, true); b.set(new TextEncoder().encode('WAVEfmt '), 8);
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); b.set(new TextEncoder().encode('data'), 36); v.setUint32(40, data, true);
  for (let f = 0; f < frames; f++) { const s = Math.round(amplitude * Math.sin(f / 8)); v.setInt16(44 + f * 4, s, true); v.setInt16(46 + f * 4, s, true); }
  return b;
}
class FakeHost implements HostAdapter {
  running: string[] = [];
  mode: 'ok' | 'no-output' | 'silent' | 'short' | 'drop-note' = 'ok';
  constructor(private readonly template: string) {}
  async info(): Promise<HostInfo> { return {platform: 'test', adapter: 'fake', available: true, fl_executable: 'fake', fl_version: '0.0.0', reason: null}; }
  async runningInstances() { return this.running; }
  private guard() { if (this.running.length) throw new AuthoringError('HOST_BUSY', 'fake FL running'); }
  async renderWav(path: string): Promise<HostRun> {
    this.guard();
    const view = viewProject(parseFlp(new Uint8Array(await readFile(path))));
    const seconds = songLengthTicks(view) / view.ppq * 60 / (view.tempoBpm ?? 120);
    if (this.mode !== 'no-output') {
      const frames = Math.round((this.mode === 'short' ? seconds / 2 : seconds + 0.5) * 8000);
      await writeFile(path.replace(/\.flp$/, '.wav'), wav(frames, 8000, this.mode === 'silent' ? 0 : 8000));
    }
    return {command: 'fake /R /Ewav "<p>"', exit_code: 0, duration_ms: 1};
  }
  async exportMidi(path: string): Promise<HostRun> {
    this.guard();
    const view = viewProject(parseFlp(new Uint8Array(await readFile(path))));
    const end = songLengthTicks(view), song = songNotes(view);
    const tracks = view.channels.map(c => ({name: c.name ?? '', notes: (song.get(c.index) ?? [])
      .map(n => ({key: n.key, start: n.start, length: n.start + n.length === end ? n.length - 1 : n.length, velocity: Math.min(127, n.velocity)}))}));
    if (this.mode === 'drop-note') tracks[0]!.notes.pop();
    if (this.mode !== 'no-output') await writeFile(path.replace(/\.flp$/, '.mid'), smf(view.ppq, Math.round(60e6 / (view.tempoBpm ?? 120)), tracks));
    return {command: 'fake /M"<p>"', exit_code: 0, duration_ms: 1};
  }
  async templatePath() { return this.template; }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'em-authoring-'));
  const template = join(root, 'template.flp');
  await writeFile(template, syntheticFlp());
  const host = new FakeHost(template);
  const ws = join(root, 'ws');
  return {root, host, ws, a: new Broker(ws, host, 'claude-code'), b: new Broker(ws, host, 'codex')};
}
const code = (c: string) => (e: unknown) => { assert.ok(e instanceof AuthoringError, String(e)); assert.equal(e.code, c); return true; };
const melody = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({midi: 69 + (i % 3) * 2, start_quarters: i, duration_quarters: 1, velocity: 0.75}));
const beat = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({midi: i % 2 ? 38 : 36, start_quarters: i, duration_quarters: 0.25, velocity: 0.9}));
const targets = [
  {pattern: {index: 1, expected_name: 'Main'}, channel: {index: 0, expected_name: 'Keys'}, notes: melody},
  {pattern: {index: 2, expected_name: 'Beat'}, channel: {index: 1, expected_name: 'Kit'}, notes: beat},
];

// ---------- codec ----------
test('FLP codec round-trips bytes and exposes channels, patterns and playlist', () => {
  const bytes = syntheticFlp(), file = parseFlp(bytes);
  assert.deepEqual(serializeFlp(file), bytes);
  const v = viewProject(file);
  assert.equal(v.flVersion, '24.2.99.4720'); assert.ok(v.layoutVerified);
  assert.equal(v.tempoBpm, 128); assert.deepEqual(v.timeSignature, [4, 4]);
  assert.deepEqual(v.channels.map(c => [c.index, c.name, c.plugin]), [[0, 'Keys', 'TestSynth'], [1, 'Kit', null]]);
  assert.deepEqual(v.patterns.map(p => [p.index, p.name, p.notes.length]), [[1, 'Main', 3], [2, 'Beat', 0]]);
  assert.equal(songLengthTicks(v), 384);
  assert.equal(viewProject(parseFlp(syntheticFlp('20.9.0'))).layoutVerified, false);
  assert.throws(() => parseFlp(bytes.slice(0, bytes.length - 1)), /FLP_LENGTH/);
});

test('note replacement preserves other channels and inserts a missing pattern block before channels', () => {
  let file = parseFlp(syntheticFlp());
  file = replaceChannelNotes(file, 1, 0, [note(0, 0, 72)]);
  file = replaceChannelNotes(file, 2, 1, [note(0, 1, 36), note(48, 1, 38)]);
  file = setTempo(setPatternClipLength(file, 2, 768), 120);
  const v = viewProject(parseFlp(serializeFlp(file)));
  assert.deepEqual(v.patterns[0]!.notes.map(n => [n.channel, n.key]), [[0, 72], [1, 36]], 'Kit notes in pattern 1 survive');
  assert.deepEqual(v.patterns[1]!.notes.map(n => n.key), [36, 38]);
  const firstChannel = file.events.findIndex(e => e.id === EV.channelNew);
  assert.ok(file.events.findIndex(e => e.id === EV.patternNew && e.value === 2) < firstChannel);
  assert.equal(v.tempoBpm, 120); assert.equal(songLengthTicks(v), 768);
  assert.throws(() => replaceChannelNotes(file, 1, 9, []), /TARGET_MISMATCH/);
  assert.throws(() => setTempo(file, 5), /INVALID_PAYLOAD/);
});

test('song notes clip to playlist items; SMF reader handles running status and note-on velocity 0', () => {
  const v = viewProject(parseFlp(syntheticFlp()));
  const s = songNotes(v);
  assert.equal(s.get(0)!.length, 2); assert.equal(s.get(1)!.length, 1);
  const bytes = Uint8Array.from([...'MThd'].map(c => c.charCodeAt(0)).concat([0, 0, 0, 6, 0, 0, 0, 1, 0, 96],
    [...'MTrk'].map(c => c.charCodeAt(0)), [0, 0, 0, 13], [0, 0x90, 60, 100, 48, 60, 0, 0, 62, 90, 24, 62, 0]));
  const m = parseSmf(bytes);
  assert.deepEqual(m.tracks[0]!.notes.map(n => [n.key, n.start, n.length, n.velocity]), [[60, 0, 48, 100], [62, 48, 24, 90]]);
  assert.throws(() => parseSmf(bytes.slice(0, 10)), /INVALID_MIDI/);
});

// ---------- broker ----------
test('full flow: create, prepare, lease, apply, FL-side verify, save, render, verify export, pack', async () => {
  const {root, a, ws} = await setup();
  try {
    await a.createProject('demo', 'fl-factory/create-a-chord-progression', 'op-create');
    const before = await a.inspect('demo') as {revision: string};
    const prep = await a.prepareEdit({project_id: 'demo', expected_revision: before.revision, tempo_bpm: 120, clip_bars: 2, targets}) as {change_id: string; after_revision: string};
    await assert.rejects(a.applyEdit('demo', prep.change_id, 'op-apply'), code('LEASE_REQUIRED'));
    await a.acquireWriter('demo');
    const applied = await a.applyEdit('demo', prep.change_id, 'op-apply') as {status: string; after_revision: string};
    assert.equal(applied.status, 'applied_file_verified'); assert.equal(applied.after_revision, prep.after_revision);
    const verified = await a.verify('demo') as {verified: boolean; fl_export_convention: {notes_ending_at_song_end_exported_one_tick_short: number}};
    assert.equal(verified.verified, true);
    assert.equal(verified.fl_export_convention.notes_ending_at_song_end_exported_one_tick_short, 1);
    const saved = await a.save('demo', 'acceptance', 'op-save') as {revision: string; checkpoint: string};
    assert.equal(saved.revision, applied.after_revision);
    const r = await a.render('demo', 'op-render') as {render_id: string; wav: {ok: boolean}};
    assert.ok(r.wav.ok);
    assert.equal((await a.verifyExport('demo', r.render_id) as {ok: boolean}).ok, true);
    const packArgs = {project_id: 'demo', render_id: r.render_id, pack_id: 'demo-pack', pack_revision: 1, asset_id: 'demo-loop', title: 'Demo',
      bars: 2, phrase_bars: 1, key: 'A minor', genres: ['test'], states: ['explore'], operation_id: 'op-pack'};
    await assert.rejects(a.buildPack({...packArgs, operation_id: 'op-pack-bad', pack_id: 'bad-pack', bars: 9}), code('PACK_INVALID'));
    await assert.rejects(a.buildPack({...packArgs, operation_id: 'op-pack-bad2', pack_id: 'bad-pack2', states: ['dancing']}), code('PACK_INVALID'));
    const pack = await a.buildPack(packArgs) as {status: string};
    assert.equal(pack.status, 'pack_built');
    const loaded = await loadPack(join(ws, 'packs', 'demo-pack'));
    assert.equal(loaded.pack.assets[0]!.rights.allowed_uses.join(), 'playback');
    const provenance = await readFile(join(ws, 'packs', 'demo-pack', 'PROVENANCE.md'), 'utf8');
    assert.match(provenance, /through the MCP facade.*Main\/Keys, Beat\/Kit/);
    assert.match(provenance, /NOT written through the facade.*Main\/Kit/, 'template Kit notes in pattern 1 are disclosed');
    assert.match(loaded.pack.assets[0]!.rights.origin, /^mixed:/, 'origin does not claim the template notes');
    await assert.rejects(a.buildPack({...packArgs, operation_id: 'op-pack-bad3', pack_id: 'bad-pack3', phrase_bars: 3}), code('INVALID_PAYLOAD'));
    // An interrupted pack build is reconciled from what is on disk.
    const jpath = join(ws, 'projects', 'demo', 'journal.jsonl');
    const manifest = JSON.parse(await readFile(join(ws, 'packs', 'demo-pack', 'manifest.json'), 'utf8'));
    await appendFile(jpath, JSON.stringify({operation_id: 'op-pack-crash', kind: 'pack', project_id: 'demo', payload_hash: 'x', client_id: 't', state: 'started',
      at: new Date().toISOString(), detail: {pack_id: 'demo-pack', wav_sha256: manifest.assets[0].file.sha256}}) + '\n');
    assert.equal((await a.operationStatus('demo', 'op-pack-crash') as {status: string}).status, 'applied_reconciled');
    const r2 = await a.render('demo', 'Op-Render') as {render_id: string};
    const r3 = await a.render('demo', 'op-render2') as {render_id: string};
    assert.equal(new Set([r.render_id, r2.render_id, r3.render_id]).size, 3, 'render folders are unique per operation id');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('two clients: lease conflict, stale revision, wrong target, duplicate operation ids', async () => {
  const {root, a, b} = await setup();
  try {
    await a.createProject('demo', 'fl-factory/create-a-chord-progression', 'op-create');
    const rev = (await a.inspect('demo') as {revision: string}).revision;
    await assert.rejects(b.prepareEdit({project_id: 'demo', expected_revision: rev, targets: [{...targets[0]!, pattern: {index: 1, expected_name: 'Verse'}}]}), code('TARGET_MISMATCH'));
    await assert.rejects(b.prepareEdit({project_id: 'demo', expected_revision: rev, targets: [{...targets[0]!, channel: {index: 1, expected_name: 'Keys'}}]}), code('TARGET_MISMATCH'));
    await assert.rejects(b.inspect('nope'), code('UNKNOWN_PROJECT'));
    const p1 = await a.prepareEdit({project_id: 'demo', expected_revision: rev, targets: [targets[0]!]}) as {change_id: string};
    const p2 = await b.prepareEdit({project_id: 'demo', expected_revision: rev, targets: [targets[1]!]}) as {change_id: string};
    await a.acquireWriter('demo');
    await assert.rejects(b.acquireWriter('demo'), code('LEASE_CONFLICT'));
    await assert.rejects(b.applyEdit('demo', p2.change_id, 'op-b'), code('LEASE_CONFLICT'));
    await a.applyEdit('demo', p1.change_id, 'op-a');
    const replay = await a.applyEdit('demo', p1.change_id, 'op-a') as {replayed: boolean};
    assert.equal(replay.replayed, true, 'same id + same payload replays');
    await assert.rejects(a.applyEdit('demo', p2.change_id, 'op-a'), code('OPERATION_ID_CONFLICT'));
    await assert.rejects(a.applyEdit('demo', p2.change_id, 'op-a2'), code('TARGET_CHANGED'), 'p2 was prepared against the old revision');
    await assert.rejects(b.prepareEdit({project_id: 'demo', expected_revision: rev, targets: [targets[1]!]}), code('TARGET_CHANGED'));
    await a.releaseWriter('demo');
    await b.acquireWriter('demo');
    const now = (await b.inspect('demo') as {revision: string}).revision;
    const p3 = await b.prepareEdit({project_id: 'demo', expected_revision: now, targets: [targets[1]!]}) as {change_id: string};
    assert.equal((await b.applyEdit('demo', p3.change_id, 'op-b2') as {status: string}).status, 'applied_file_verified');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('uncertain outcome is reconciled by operation id, then replays; restore recovers a backup', async () => {
  const {root, a} = await setup();
  try {
    await a.createProject('demo', 'fl-factory/create-a-chord-progression', 'op-create');
    const rev0 = (await a.inspect('demo') as {revision: string}).revision;
    const prep = await a.prepareEdit({project_id: 'demo', expected_revision: rev0, targets}) as {change_id: string; after_revision: string};
    await a.acquireWriter('demo');
    a.fault = {afterWrite: true};
    await assert.rejects(a.applyEdit('demo', prep.change_id, 'op-x'), code('OUTCOME_UNKNOWN'));
    a.fault = {};
    await assert.rejects(a.applyEdit('demo', prep.change_id, 'op-x'), code('OUTCOME_UNKNOWN'), 'blind retry is refused');
    const status = await a.operationStatus('demo', 'op-x') as {status: string; reconciled: boolean};
    assert.equal(status.status, 'applied_reconciled'); assert.equal(status.reconciled, true);
    assert.equal((await a.applyEdit('demo', prep.change_id, 'op-x') as {replayed: boolean}).replayed, true);
    assert.equal((await a.operationStatus('demo', 'op-never') as {status: string}).status, 'not_found');
    const backups = await a.listBackups('demo') as {backups: string[]};
    assert.deepEqual(backups.backups, [rev0]);
    await assert.rejects(a.restore('demo', rev0, rev0, 'op-r0'), code('TARGET_CHANGED'));
    const restored = await a.restore('demo', rev0, prep.after_revision, 'op-r1') as {after_revision: string};
    assert.equal(restored.after_revision, rev0);
    assert.equal((await a.inspect('demo') as {revision: string}).revision, rev0);
    assert.ok((await a.listBackups('demo') as {backups: string[]}).backups.includes(prep.after_revision), 'replaced revision kept');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('host failures: FL running, no output, silent/short/tampered/missing WAV, readback mismatch, no host', async () => {
  const {root, a, host, ws} = await setup();
  try {
    await a.createProject('demo', 'fl-factory/create-a-chord-progression', 'op-create');
    const rev = (await a.inspect('demo') as {revision: string}).revision;
    const prep = await a.prepareEdit({project_id: 'demo', expected_revision: rev, targets}) as {change_id: string};
    await a.acquireWriter('demo');
    host.running = ['demo.flp - FL Studio 2026'];
    assert.equal((await a.inspect('demo') as {fl_gui_holding_project: string}).fl_gui_holding_project, 'demo.flp - FL Studio 2026');
    await assert.rejects(a.applyEdit('demo', prep.change_id, 'op-busy'), code('HOST_BUSY'));
    await assert.rejects(a.render('demo', 'op-render-busy'), code('HOST_BUSY'));
    host.running = [];
    await a.applyEdit('demo', prep.change_id, 'op-apply');
    host.mode = 'no-output';
    await assert.rejects(a.render('demo', 'op-r1'), code('EXPORT_FAILED'));
    assert.equal((await a.operationStatus('demo', 'op-r1') as {status: string}).status, 'failed');
    await assert.rejects(a.verify('demo'), code('EXPORT_FAILED'));
    host.mode = 'silent';
    await assert.rejects(a.render('demo', 'op-r2'), code('EXPORT_INVALID'));
    host.mode = 'short';
    await assert.rejects(a.render('demo', 'op-r3'), code('EXPORT_INVALID'));
    host.mode = 'drop-note';
    assert.equal((await a.verify('demo') as {verified: boolean}).verified, false);
    host.mode = 'ok';
    const r = await a.render('demo', 'op-r4') as {render_id: string};
    const wavPath = join(ws, 'projects', 'demo', 'renders', r.render_id, 'demo.wav');
    const original = await readFile(wavPath);
    await writeFile(wavPath, wav(40000));
    assert.match((await a.verifyExport('demo', r.render_id) as {problems: string[]}).problems.join(), /hash mismatch/);
    await rm(wavPath);
    assert.match((await a.verifyExport('demo', r.render_id) as {problems: string[]}).problems.join(), /missing/);
    await writeFile(wavPath, original);
    await assert.rejects(a.verifyExport('demo', 'r-000000000000-x'), code('UNKNOWN_RENDER'));
    const none = new Broker(ws, new UnsupportedHost('no FL'), 'nohost');
    await assert.rejects(none.render('demo', 'op-nohost'), code('UNSUPPORTED_CAPABILITY'));
    await assert.rejects(none.createProject('other', 'fl-factory/create-a-chord-progression', 'op-c'), code('HOST_UNAVAILABLE'));
    assert.equal(((await none.capabilities()) as {host: {available: boolean}}).host.available, false);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('failed save is journaled as failed, never left uncertain', async () => {
  const {root, a, ws} = await setup();
  try {
    await a.createProject('demo', 'fl-factory/create-a-chord-progression', 'op-create');
    await writeFile(join(ws, 'projects', 'demo', 'saves'), 'not a directory');
    await assert.rejects(a.save('demo', 'blocked', 'op-save-x'), code('SAVE_FAILED'));
    assert.equal((await a.operationStatus('demo', 'op-save-x') as {status: string}).status, 'failed');
    await assert.rejects(a.save('demo', 'blocked', 'op-save-x'), code('SAVE_FAILED'), 'a recorded failure replays as an error, never as success');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('unverified FL layouts are inspectable but never written', async () => {
  const {root, a, ws} = await setup();
  try {
    await a.createProject('demo', 'fl-factory/create-a-chord-progression', 'op-create');
    await writeFile(join(ws, 'projects', 'demo', 'demo.flp'), syntheticFlp('21.0.3'));
    const v = await a.inspect('demo') as {layout_verified: boolean; revision: string};
    assert.equal(v.layout_verified, false);
    await assert.rejects(a.prepareEdit({project_id: 'demo', expected_revision: v.revision, targets}), code('UNSUPPORTED_PROJECT_FORMAT'));
  } finally { await rm(root, {recursive: true, force: true}); }
});

// ---------- MCP protocol ----------
test('MCP session: negotiation, notifications, tool listing and error mapping', async () => {
  const {root, ws, host} = await setup();
  try {
    const out: Record<string, unknown>[] = [];
    const s = new McpSession({workspace: ws, host, write: l => out.push(JSON.parse(l))});
    await s.handleLine(JSON.stringify({jsonrpc: '2.0', id: 0, method: 'tools/call', params: {name: 'fl_capabilities', arguments: {}}}));
    assert.equal((out.pop()!.error as {code: number}).code, -32002);
    await s.handleLine(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', clientInfo: {name: 'test'}, capabilities: {}}}));
    assert.equal((out.pop()!.result as {protocolVersion: string}).protocolVersion, '2025-06-18');
    await s.handleLine(JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'}));
    assert.equal(out.length, 0, 'notifications are never answered');
    await s.handleLine(JSON.stringify({jsonrpc: '2.0', id: 2, method: 'tools/list'}));
    const tools = (out.pop()!.result as {tools: {name: string; inputSchema: unknown; annotations: unknown}[]}).tools;
    assert.equal(tools.length, TOOLS.length);
    assert.ok(tools.every(t => t.inputSchema && t.annotations && !('run' in t)));
    assert.ok(!tools.some(t => /exec|script|python|path|click/i.test(t.name)), 'no arbitrary execution or path tools');
    await s.handleLine(JSON.stringify({jsonrpc: '2.0', id: 3, method: 'nope'}));
    assert.equal((out.pop()!.error as {code: number}).code, -32601);
    await s.handleLine(JSON.stringify({jsonrpc: '2.0', id: 4, method: 'tools/call', params: {name: 'fl_missing', arguments: {}}}));
    assert.equal((out.pop()!.error as {code: number}).code, -32602);
    await s.handleLine(JSON.stringify({jsonrpc: '2.0', id: 5, method: 'tools/call', params: {name: 'fl_inspect', arguments: {project_id: 'ghost'}}}));
    const r5 = out.pop()!.result as {isError: boolean; structuredContent: {error: {code: string}}};
    assert.equal(r5.isError, true); assert.equal(r5.structuredContent.error.code, 'UNKNOWN_PROJECT');
    await s.handleLine(JSON.stringify({jsonrpc: '2.0', id: 6, method: 'tools/call', params: {name: 'fl_inspect', arguments: {project_id: '../etc'}}}));
    assert.equal((out.pop()!.result as {structuredContent: {error: {code: string}}}).structuredContent.error.code, 'INVALID_PAYLOAD');
    await s.handleLine('{not json');
    assert.equal((out.pop()!.error as {code: number}).code, -32700);
    const s2 = new McpSession({workspace: ws, host, write: l => out.push(JSON.parse(l))});
    await s2.handleLine(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '1999-01-01'}}));
    assert.equal((out.pop()!.result as {protocolVersion: string}).protocolVersion, SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1]);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('review fixes: reserved ids, damaged journal tail, stale locks, interrupted create/save, fail-closed FL check', async () => {
  const {root, a, b, ws, host} = await setup();
  try {
    await assert.rejects(a.createProject('con', 'fl-factory/create-a-chord-progression', 'op-con'), code('INVALID_PAYLOAD'));
    await a.createProject('demo', 'fl-factory/create-a-chord-progression', 'op-create');
    await assert.rejects(b.createProject('demo', 'fl-factory/create-a-chord-progression', 'op-create-b'), code('PROJECT_EXISTS'));
    const dir = join(ws, 'projects', 'demo');
    // A half-written last journal line does not brick the project, and the next record starts on its own line.
    await appendFile(join(dir, 'journal.jsonl'), '{"operation_id":"op-torn');
    assert.equal((await a.operationStatus('demo', 'op-create') as {status: string}).status, 'completed');
    // A lock left by a dead process is broken automatically.
    await writeFile(join(dir, '.write.lock'), JSON.stringify({holder: 'ghost', token: 't', pid: 2147483646, at: new Date().toISOString()}));
    await a.acquireWriter('demo');
    const rev = (await a.inspect('demo') as {revision: string}).revision;
    const prep = await a.prepareEdit({project_id: 'demo', expected_revision: rev, targets: [targets[0]!]}) as {change_id: string};
    assert.equal((await a.applyEdit('demo', prep.change_id, 'op-after-torn') as {status: string}).status, 'applied_file_verified');
    const lines = (await readFile(join(dir, 'journal.jsonl'), 'utf8')).split('\n').filter(Boolean);
    assert.ok(lines.every(l => { try { JSON.parse(l); return true; } catch { return false; } }), 'torn tail was cut off before appending');
    assert.match(await readFile(join(dir, 'journal.torn'), 'utf8'), /op-torn/);
    // Interrupted save: no checkpoint on disk -> reconciled as not applied.
    await appendFile(join(dir, 'journal.jsonl'), JSON.stringify({operation_id: 'op-save-crash', kind: 'save', project_id: 'demo', payload_hash: 'h', client_id: 't',
      state: 'started', at: new Date().toISOString(), before_revision: rev, detail: {checkpoint: 'saves/x-000000000000.flp'}}) + '\n');
    assert.equal((await a.operationStatus('demo', 'op-save-crash') as {status: string}).status, 'not_applied_reconciled');
    // Interrupted create: the incomplete project is moved aside and the id can be created again.
    await mkdir(join(ws, 'projects', 'half'));
    await writeFile(join(ws, 'projects', 'half', 'journal.jsonl'), JSON.stringify({operation_id: 'op-half', kind: 'create', project_id: 'half', payload_hash: 'h',
      client_id: 't', state: 'started', at: new Date().toISOString(), after_revision: 'f'.repeat(64)}) + '\n');
    assert.equal((await a.operationStatus('half', 'op-half') as {status: string}).status, 'not_applied_reconciled');
    assert.equal(await stat(join(ws, 'projects', 'half')).catch(() => null), null);
    await a.createProject('half', 'fl-factory/create-a-chord-progression', 'op-half-2');
    // If the FL process check fails, writes are refused rather than allowed.
    host.runningInstances = async () => { throw new Error('tasklist failed'); };
    assert.match(String((await a.inspect('demo') as {fl_gui_holding_project: string}).fl_gui_holding_project), /unknown/);
    const rev2 = (await a.inspect('demo') as {revision: string}).revision;
    const prep2 = await a.prepareEdit({project_id: 'demo', expected_revision: rev2, targets: [targets[1]!]}) as {change_id: string};
    await assert.rejects(a.applyEdit('demo', prep2.change_id, 'op-blind'), code('HOST_BUSY'));
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('MCP arguments are schema-checked and local paths never reach the agent', async () => {
  const {root, ws, host} = await setup();
  try {
    const out: Record<string, unknown>[] = [];
    const s = new McpSession({workspace: ws, host, write: l => out.push(JSON.parse(l))});
    const call = async (id: number, name: string, args: unknown) => {
      await s.handleLine(JSON.stringify({jsonrpc: '2.0', id, method: 'tools/call', params: {name, arguments: args}}));
      return out.pop()!.result as {isError: boolean; content: {text: string}[]; structuredContent: {error?: {code: string; message: string}}};
    };
    await s.handleLine(JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', clientInfo: {name: 't'}}}));
    out.pop();
    const pack = await call(2, 'fl_build_pack', {project_id: 'demo', render_id: 'r-x', pack_id: 'p', pack_revision: 1, asset_id: 'a', title: 't',
      bars: 1, phrase_bars: 0, key: null, genres: [], states: [], operation_id: 'op-pack'});
    assert.equal(pack.isError, true); assert.equal(pack.structuredContent.error!.code, 'INVALID_PAYLOAD');
    assert.match(pack.structuredContent.error!.message, /phrase_bars must be >= 1/);
    const extra = await call(3, 'fl_inspect', {project_id: 'demo', path: 'C:/x'});
    assert.match(extra.structuredContent.error!.message, /path is not allowed/);
    await call(4, 'fl_create_project', {project_id: 'demo', template: 'fl-factory/create-a-chord-progression', operation_id: 'op-create'});
    await writeFile(join(ws, 'projects', 'demo', 'saves'), 'not a directory');
    const failed = await call(5, 'fl_save', {project_id: 'demo', label: 'x', operation_id: 'op-save'});
    assert.equal(failed.structuredContent.error!.code, 'SAVE_FAILED');
    assert.ok(!JSON.stringify(failed).includes(JSON.stringify(ws).slice(1, -1)), 'workspace path redacted');
    assert.match(failed.structuredContent.error!.message, /<workspace>/);
  } finally { await rm(root, {recursive: true, force: true}); }
});
