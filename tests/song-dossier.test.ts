// em.song-dossier.v1: building from the existing analysis, strict validation, key identity and the
// DjStatus analysis field. Synthetic original fixtures only; nothing here is listening evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSongDossier, currentKey, dossierId, dossierSummary, identityOfAsset, isCurrentFor, isDossierId, parseSongDossier, SONG_DOSSIER,
  SONG_DOSSIER_ANALYSIS, SONG_DOSSIER_LIMITS} from '../web/song-dossier.js';
import {sanitizeDjStatus, STATUS_TEXT_LIMIT} from '../web/phone-protocol.js';
import {identity, sampleAnalysis, sampleDossier, sha} from './helpers/dossier-fixtures.js';

test('a dossier wraps the existing analysis: tempo, grid, key, sections, cues, quality, versions and cost', () => {
  const d = sampleDossier(1), a = sampleAnalysis();
  assert.equal(d.version, SONG_DOSSIER);
  assert.equal(d.key.analysis, SONG_DOSSIER_ANALYSIS);
  assert.match(SONG_DOSSIER_ANALYSIS, /mix-analysis-v5\+mix-structure@1$/);
  assert.equal(d.tempo.bpm === null ? null : Math.round(d.tempo.bpm), a.tempo.bpm === null ? null : Math.round(a.tempo.bpm));
  assert.equal(d.source.sampleRate, 16000);
  assert.ok(Math.abs(d.source.seconds - a.frames / 16000) < 0.001);
  assert.ok(d.grid.beatSeconds.length > 0 && d.grid.downbeatSeconds.length > 0, 'beats and downbeats in seconds');
  assert.equal(d.cost.analysisMs, 1234);
  assert.equal(d.cues.entries.length > 0 || d.cues.exits.length > 0, true);
  assert.deepEqual(d.tonal.key, a.key.name);
  assert.ok(Array.isArray(d.quality.flags) && d.quality.coverage > 0);
  assert.deepEqual(parseSongDossier(JSON.parse(JSON.stringify(d))), d, 'round-trips through JSON');
  assert.ok(new TextEncoder().encode(JSON.stringify(d)).byteLength < SONG_DOSSIER_LIMITS.maxBytes);
  assert.match(dossierSummary(d), /BPM estimate|tempo uncertain/);
});

test('a dossier holds numbers and hashes only: no path, title, audio or personal text', () => {
  const text = JSON.stringify(sampleDossier(2));
  assert.ok(!/[A-Za-z]:\\|\/Users\/|\.wav|\.mp3|file:/i.test(text), 'no path or file name');
  assert.deepEqual(Object.keys(sampleDossier(2)).sort(), ['cost', 'cues', 'grid', 'key', 'limitations', 'loudness', 'quality', 'sections', 'source', 'structure', 'tempo', 'tonal', 'version']);
});

test('validation refuses unknown fields, wrong types, bad ranges, long lists, control characters and disorder', () => {
  const good = JSON.parse(JSON.stringify(sampleDossier(3))) as Record<string, any>;
  const mutate = (change: (d: Record<string, any>) => void): unknown => { const d = JSON.parse(JSON.stringify(good)) as Record<string, any>; change(d); return d; };
  const bad: Record<string, unknown> = {
    'not an object': 7, 'unknown top field': mutate(d => { d.extra = 1; }), 'unknown nested field': mutate(d => { d.tempo.extra = 1; }),
    'missing field': mutate(d => { delete d.cost; }), 'wrong version': mutate(d => { d.version = 'em.song-dossier.v2'; }),
    'bad sha': mutate(d => { d.key.sha256 = 'XYZ'; }), 'path in analysis tag': mutate(d => { d.key.analysis = '../../x'; }),
    'NaN bpm': mutate(d => { d.tempo.bpm = 'fast'; }), 'bpm out of range': mutate(d => { d.tempo.bpm = 9000; }),
    'confidence above 1': mutate(d => { d.tempo.confidence = 1.5; }), 'beats not in order': mutate(d => { d.grid.beatSeconds = [2, 1]; }),
    'too many beats': mutate(d => { d.grid.beatSeconds = Array.from({length: SONG_DOSSIER_LIMITS.beats + 1}, (_, i) => i / 100); }),
    'control character': mutate(d => { d.limitations = ['bad\u0000text']; }), 'long text': mutate(d => { d.limitations = ['x'.repeat(SONG_DOSSIER_LIMITS.textChars + 1)]; }),
    'unknown flag': mutate(d => { d.quality.flags = ['great-song']; }), 'bad time': mutate(d => { d.cost.at = 'yesterday'; }),
    'negative cost': mutate(d => { d.cost.analysisMs = -1; }), 'three channels': mutate(d => { d.source.channels = 3; }),
    'section label': mutate(d => { d.sections = [{startSeconds: 0, endSeconds: 1, startBar: 0, bars: 1, label: 'chorus', guess: null, energy: 0, low: 0, vocal: 0, confidence: 0}]; }),
  };
  for (const [name, value] of Object.entries(bad)) assert.throws(() => parseSongDossier(value), /Invalid song dossier/, name);
  assert.ok(parseSongDossier(good));
});

test('the key is audio sha256 + analysis version + requested-tempo hint, as a file-safe id', () => {
  const d = sampleDossier(4), id = dossierId(d.key);
  assert.match(id, /^[0-9a-f]{64}_[a-z0-9-]+_100p000_0p250$/);
  assert.ok(isDossierId(id));
  assert.equal(dossierId(sampleDossier(4).key), id, 'stable');
  assert.notEqual(dossierId(sampleDossier(5).key), id, 'audio changes the id');
  assert.notEqual(dossierId(sampleDossier(4, 120).key), id, 'tempo hint changes the id');
  assert.notEqual(dossierId(currentKey(identity(4), 'song-dossier@2+mix-analysis-v6')), id, 'analysis version changes the id');
  assert.match(dossierId(sampleDossier(6, null).key), /_none_none$/);
  for (const bad of ['', '../x', `${sha(1)}_x_none_none/../y`, 'a'.repeat(300), `${sha(1)}_x_none`, 7, null]) assert.ok(!isDossierId(bad), String(bad));
  assert.ok(isCurrentFor(d, identity(4)));
  assert.ok(!isCurrentFor(d, identity(5)));
  assert.ok(!isCurrentFor(d, identity(4), 'song-dossier@2+mix-analysis-v6'), 'older analysis is not current');
  assert.deepEqual(identityOfAsset({file: {sha256: sha(7), sample_rate: 48000}, timing: {bpm: 100, first_downbeat_frame: 24000}}), {sha256: sha(7), tempoHint: 100, downbeatHintSeconds: 0.5});
  assert.deepEqual(identityOfAsset({file: {sha256: sha(7), sample_rate: 48000}, timing: null}), {sha256: sha(7), tempoHint: null, downbeatHintSeconds: null});
});

test('building raises quality flags for weak evidence instead of hiding it', () => {
  const a = sampleAnalysis();
  const {songStructure: _dropped, ...plain} = a;
  const weak = {...plain, tempo: {...a.tempo, bpm: null, status: 'insufficient-rhythm' as const, ambiguity: 0.9},
    key: {...a.key, status: 'ambiguous' as const, name: null, tonic: null, mode: null}, structure: {...a.structure, downbeatConfidence: 0.1}};
  const d = buildSongDossier(weak, {identity: identity(8), channels: 1, analysisMs: 5, at: '2026-11-16T10:00:00.000Z'});
  for (const flag of ['tempo-unknown', 'tempo-insufficient-rhythm', 'tempo-ambiguous', 'downbeat-weak', 'key-ambiguous', 'key-unknown', 'no-structure'] as const) {
    assert.ok(d.quality.flags.includes(flag), flag);
  }
  assert.equal(d.tempo.bpm, null);
});

test('DjStatus carries a bounded analysis line; an older DJ page without it still validates', () => {
  const base = {state: 'playing', now: 'A', next: 'B', detail: '', status: '', requested: '', execution: '', lastCommand: '', hold: false, handoff: 'mix', auto: false};
  assert.equal(sanitizeDjStatus({...base, analysis: 'Analysed 7/9 · next ready'})!.analysis, 'Analysed 7/9 · next ready');
  assert.equal(sanitizeDjStatus(base)!.analysis, '', 'missing field is an empty string');
  assert.equal(sanitizeDjStatus({...base, analysis: 5})!.analysis, '');
  const long = sanitizeDjStatus({...base, analysis: `x\u0000${'y'.repeat(1000)}`})!.analysis!;
  assert.ok(long.length <= STATUS_TEXT_LIMIT && !long.includes('\u0000'));
});
