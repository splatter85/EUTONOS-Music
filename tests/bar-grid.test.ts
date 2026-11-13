import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {execFile} from 'node:child_process';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {BAR_GRID_PROFILE, barGrid} from '../src/bar-grid.js';
import {parseBarGridArgs} from '../scripts/bar-grid.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/bar-grid.js', import.meta.url));

/** Synthetic kick-like clicks at a constant tempo; every fourth beat is louder. */
function clicks(bpm: number, seconds: number, sampleRate = 16000, firstBeat = 0.25): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const beat = 60 / bpm, length = Math.round(0.06 * sampleRate);
  for (let b = 0, t = firstBeat; t < seconds; b++, t = firstBeat + b * beat) {
    const start = Math.round(t * sampleRate), gain = b % 4 === 0 ? 0.9 : 0.45;
    for (let i = 0; i < length && start + i < out.length; i++) {
      out[start + i]! += gain * Math.exp(-i / (0.012 * sampleRate)) * Math.sin(2 * Math.PI * 60 * i / sampleRate);
    }
  }
  return out;
}

function pcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true));
  return bytes;
}

async function temporary(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'eutonos bar grid '));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

function assertRegularGrid(grid: ReturnType<typeof barGrid>): void {
  assert.equal(grid.profile, BAR_GRID_PROFILE);
  for (let i = 1; i < grid.beats.length; i++) assert.ok(Math.abs(grid.beats[i]! - grid.beats[i - 1]! - grid.beat_seconds) < 2e-4);
  for (const bar of grid.bars) assert.ok(grid.beats.includes(bar), 'every bar line is a beat');
  for (let i = 1; i < grid.bars.length; i++) assert.ok(Math.abs(grid.bars[i]! - grid.bars[i - 1]! - grid.beats_per_bar * grid.beat_seconds) < 5e-4);
  assert.ok(grid.beats.every(t => t >= 0 && t < grid.seconds));
}

test('a requested-tempo hint is refined to the audio and gives a regular bar grid', () => {
  const grid = barGrid({sampleRate: 16000, channels: [clicks(124, 40)]}, {bpmHint: 124});
  assertRegularGrid(grid);
  assert.ok(Math.abs(grid.tempo.bpm - 124) < 0.05, `bpm ${grid.tempo.bpm}`);
  assert.equal(grid.tempo.source, 'hint-refined');
  assert.ok(Math.abs(grid.first_beat - 0.25) < 0.015, `first beat ${grid.first_beat}`);
  assert.equal(grid.beats_per_bar, 4);
});

test('a slightly wrong hint is corrected by the onset fit', () => {
  const grid = barGrid({sampleRate: 16000, channels: [clicks(124, 40)]}, {bpmHint: 125});
  assert.ok(Math.abs(grid.tempo.bpm - 124) < 0.05, `bpm ${grid.tempo.bpm}`);
});

test('without a hint the grid follows the analysis tempo', () => {
  const grid = barGrid({sampleRate: 16000, channels: [clicks(124, 40)]});
  assertRegularGrid(grid);
  assert.equal(grid.tempo.source, 'analysis-refined');
  assert.equal(grid.tempo.hint_bpm, null);
  assert.ok(Math.abs(grid.tempo.bpm - 124) < 0.1, `bpm ${grid.tempo.bpm}`);
});

test('other meters group beats into bars of that size', () => {
  const grid = barGrid({sampleRate: 16000, channels: [clicks(124, 30)]}, {bpmHint: 124, beatsPerBar: 3});
  assertRegularGrid(grid);
  assert.equal(grid.beats_per_bar, 3);
  assert.equal(grid.downbeat.source, 'first-beat');
  assert.ok(grid.warnings.some(w => w.includes('only detected for 4 beats')));
});

test('audio longer than the analysis window gets a grid over its whole length', () => {
  const grid = barGrid({sampleRate: 8000, channels: [clicks(120, 190, 8000)]}, {bpmHint: 120});
  assertRegularGrid(grid);
  assert.ok(grid.warnings.some(w => w.includes('first 180')));
  assert.ok(grid.beats.at(-1)! > 189, `last beat ${grid.beats.at(-1)}`);
  assert.ok(Math.abs(grid.tempo.bpm - 120) < 0.05);
});

test('invalid input is refused with a clear message', () => {
  const ok = clicks(120, 10);
  assert.throws(() => barGrid({sampleRate: 16000, channels: [clicks(120, 2)]}), /at least 4 seconds/);
  assert.throws(() => barGrid({sampleRate: 16000, channels: [ok]}, {bpmHint: 500}), /bpm hint/);
  assert.throws(() => barGrid({sampleRate: 16000, channels: [ok]}, {beatsPerBar: 5}), /beats per bar/);
  assert.throws(() => barGrid({sampleRate: 16000, channels: [ok, ok.subarray(1)]}), /equal length/);
});

test('argument parsing accepts the documented options and rejects others', () => {
  assert.deepEqual(parseBarGridArgs(['a.wav', '--bpm-hint', '124']), {file: 'a.wav', bpmHint: 124, beatsPerBar: 4, help: false});
  assert.deepEqual(parseBarGridArgs(['--beats-per-bar=3', 'a.wav']), {file: 'a.wav', bpmHint: null, beatsPerBar: 3, help: false});
  assert.equal(parseBarGridArgs(['--help']).help, true);
  assert.throws(() => parseBarGridArgs([]), /one WAV/);
  assert.throws(() => parseBarGridArgs(['a.wav', 'b.wav']), /exactly one/);
  assert.throws(() => parseBarGridArgs(['a.wav', '--bpm-hint', 'fast']), /positive number/);
  assert.throws(() => parseBarGridArgs(['a.wav', '--loud']), /Unknown option/);
});

test('the command prints the grid as JSON and reports errors with exit codes', async t => {
  const directory = await temporary(t), wav = join(directory, 'clicks 124.wav');
  await writeFile(wav, pcm16Wav(clicks(124, 20), 16000));
  const {stdout} = await run(process.execPath, [cli, wav, '--bpm-hint', '124'], {windowsHide: true, timeout: 120_000});
  const grid = JSON.parse(stdout) as ReturnType<typeof barGrid>;
  assert.equal(grid.profile, BAR_GRID_PROFILE);
  assert.ok(Math.abs(grid.tempo.bpm - 124) < 0.05);
  await assert.rejects(run(process.execPath, [cli], {windowsHide: true}), (e: {code?: number}) => e.code === 2);
  await assert.rejects(run(process.execPath, [cli, join(directory, 'missing.wav')], {windowsHide: true}),
    (e: {code?: number; stderr?: string}) => e.code === 1 && /bar-grid:/.test(e.stderr ?? ''));
});
