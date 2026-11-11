import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {analyzeInput, manifestSections, parseAnalysisArgs, parseSections} from '../scripts/analyze-audio.js';
import type {AudioPack} from '../src/pack-types.js';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/analyze-audio.js', import.meta.url));
const packRoot = fileURLToPath(new URL('../../fixtures/s01/', import.meta.url));
const pack = JSON.parse(await readFile(join(packRoot, 'manifest.json'), 'utf8')) as AudioPack;
type Report = Awaited<ReturnType<typeof analyzeInput>>;

async function temporary(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'eutonos analysis cli '));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
}

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function packHashes(): Promise<[string, string][]> {
  const paths = [...new Set(['manifest.json', ...pack.assets.map(a => a.file.path),
    ...pack.assets.map(a => a.rights.evidence)])].sort();
  return Promise.all(paths.map(async path => [path, hash(await readFile(join(packRoot, path)))]));
}

function finiteNumbers(value: unknown): void {
  if (typeof value === 'number') assert.ok(Number.isFinite(value));
  else if (Array.isArray(value)) value.forEach(finiteNumbers);
  else if (value !== null && typeof value === 'object') Object.values(value).forEach(finiteNumbers);
}

async function execute(args: string[], cwd: string) {
  try {
    const {stdout, stderr} = await run(process.execPath, [cli, ...args],
      {cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true});
    return {code: 0, stdout, stderr};
  } catch (error) {
    const result = error as Error & {code?: number | string; stdout?: string; stderr?: string};
    if (typeof result.code !== 'number' || typeof result.stdout !== 'string' ||
        typeof result.stderr !== 'string') throw error;
    return {code: result.code, stdout: result.stdout, stderr: result.stderr};
  }
}

async function reports(cwd: string): Promise<{name: string; report: Report}[]> {
  const directory = join(cwd, 'artifacts', 'analysis');
  let names: string[];
  try { names = await readdir(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  assert.ok(names.every(name => name.endsWith('.json')), 'no temporary/partial report files remain');
  return Promise.all(names.sort().map(async name => {
    const text = await readFile(join(directory, name), 'utf8');
    const report = JSON.parse(text) as Report;
    finiteNumbers(report);
    return {name, report};
  }));
}

/** Original synthetic mono PCM16 bytes, used only in cleaned-up temporary directories. */
function testWav(): Uint8Array {
  const rate = 8000, frames = rate;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    bytes.writeInt16LE(Math.round(4096 * Math.sin(2 * Math.PI * 1000 * frame / rate)), 44 + frame * 2);
  }
  return bytes;
}

test('section arguments accept comma, whitespace, equals and repeated option forms', () => {
  assert.deepEqual(parseSections('0:1, 1.25:2'), [{start: 0, end: 1}, {start: 1.25, end: 2}]);
  const ranges = [{start: 0, end: 1}, {start: 1, end: 2}];
  for (const args of [
    ['a.wav', '--sections', '0:1,1:2'],
    ['--sections=0:1,1:2', 'a.wav'],
    ['a.wav', '--sections', '0:1', '1:2'],
    ['--sections', '0:1', 'a.wav', '--sections=1:2'],
  ]) {
    const parsed = parseAnalysisArgs(args);
    assert.deepEqual(parsed.inputs, ['a.wav']);
    assert.deepEqual(parsed.sections, ranges);
    assert.equal(parsed.help, false);
  }
  assert.deepEqual(parseSections('.25:1.'), [{start: 0.25, end: 1}]);
  assert.deepEqual(parseAnalysisArgs(['--', '-literal.wav']).inputs, ['-literal.wav']);
});

test('invalid options and sections fail with useful input guidance', () => {
  assert.throws(() => parseAnalysisArgs([]), /at least one WAV/i);
  assert.throws(() => parseAnalysisArgs(['a.wav', '--bogus']), /Unknown option/);
  assert.throws(() => parseAnalysisArgs(['a.wav', '--sections']), /needs at least one/i);
  for (const value of ['', '0:0', '2:1', '-1:2', '0:Infinity', 'NaN:1', '0:1,', '0:1:2']) {
    assert.throws(() => parseSections(value), /Invalid section/);
  }
  assert.throws(() => parseAnalysisArgs(['a.wav', '--sections', Array(257).fill('0:1').join(',')]),
    /At most 256/);
});

test('manifest sections retain phrase boundaries, pickup and tail; samples have none', () => {
  const recording = pack.assets.find(a => a.source_kind === 'recording')!;
  const sample = pack.assets.find(a => a.source_kind === 'sample')!;
  assert.deepEqual(manifestSections(recording), [{start: 0, end: 8}, {start: 8, end: 16}]);
  assert.deepEqual(manifestSections(sample), []);
  const rate = recording.file.sample_rate;
  assert.deepEqual(manifestSections({...recording,
    file: {...recording.file, frames: 18 * rate},
    timing: {...recording.timing!, first_downbeat_frame: rate}}),
  [{start: 0, end: 1}, {start: 1, end: 9}, {start: 9, end: 17}, {start: 17, end: 18}]);
});

test('importing the CLI module is inert and leaves no artifacts', async t => {
  const directory = await temporary(t);
  const url = new URL('../scripts/analyze-audio.js', import.meta.url).href;
  const code = 'const mod = await import(' + JSON.stringify(url) +
    '); console.log(typeof mod.runAnalysisCli);';
  const result = await run(process.execPath, ['--input-type=module', '--eval', code], {cwd: directory});
  assert.equal(result.stdout.trim(), 'function');
  assert.equal(result.stderr, '');
  assert.deepEqual(await reports(directory), []);
  await assert.rejects(stat(join(directory, 'artifacts')), {code: 'ENOENT'});
});

test('actual CLI analyzes S01 in place with six full assets and recording sections', async t => {
  const directory = await temporary(t), before = await packHashes();
  const result = await execute([packRoot], directory);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /LUFS/);
  assert.match(result.stdout, /Measurements only; listening NOT TESTED/);
  const outputs = await reports(directory);
  assert.equal(outputs.length, 1);
  const report = outputs[0]!.report;
  assert.equal(report.schema, 'em.audio-analysis.prototype.v1');
  assert.equal(report.source.kind, 'pack');
  assert.equal(report.source.id, 's01-foundation');
  assert.equal(report.source.path, resolve(packRoot));
  assert.equal(report.files.length, 6);
  assert.equal(report.files.filter(f => f.source_kind === 'recording').length, 2);
  for (const file of report.files) {
    assert.equal(file.sha256, pack.assets.find(a => a.id === file.id)!.file.sha256);
    assert.ok(file.full.frames > 0);
    assert.ok(file.full.rms_windows.length > 0);
    if (file.source_kind === 'recording') {
      assert.deepEqual(file.sections.map(s => [s.analysis.start_seconds, s.analysis.end_seconds]),
        [[0, 8], [8, 16]]);
      assert.ok(file.sections.every(s => s.origin === 'manifest'));
      assert.equal(file.full.duration_seconds, 16);
    } else assert.deepEqual(file.sections, []);
  }
  assert.deepEqual(await packHashes(), before, 'pack media, manifest and provenance remain unchanged');
});

test('explicit pack sections replace defaults only for recordings', async t => {
  const directory = await temporary(t), before = await packHashes();
  const result = await execute([packRoot, '--sections=0:4,4:8'], directory);
  assert.equal(result.code, 0, result.stderr);
  const output = (await reports(directory))[0]!.report;
  assert.equal(output.files.length, 6);
  assert.deepEqual(output.requested_sections, [{start: 0, end: 4}, {start: 4, end: 8}]);
  for (const file of output.files) {
    if (file.source_kind === 'recording') {
      assert.deepEqual(file.sections.map(s => [s.analysis.start_seconds, s.analysis.end_seconds]),
        [[0, 4], [4, 8]]);
      assert.ok(file.sections.every(s => s.origin === 'explicit'));
      assert.equal(file.full.duration_seconds, 16);
    } else assert.deepEqual(file.sections, []);
  }
  assert.deepEqual(await packHashes(), before);
});

test('multiple same-basename WAV paths and different section snapshots have distinct reports', async t => {
  const directory = await temporary(t);
  const left = join(directory, 'left space'), right = join(directory, 'right space');
  await mkdir(left); await mkdir(right);
  const a = join(left, 'same.wav'), b = join(right, 'same.wav'), bytes = testWav();
  await writeFile(a, bytes); await writeFile(b, bytes);
  const result = await execute([a, b], directory);
  assert.equal(result.code, 0, result.stderr);
  const first = await reports(directory);
  assert.equal(first.length, 2);
  assert.notEqual(first[0]!.name, first[1]!.name);
  assert.deepEqual(first.map(o => o.report.source.path).sort(), [a, b].sort());
  assert.ok(first.every(o => o.report.source.kind === 'wav' && o.report.files.length === 1));
  assert.ok(first.every(o => o.report.files[0]!.sha256 === hash(bytes)));
  const sectioned = await execute([a, '--sections', '0:.5'], directory);
  assert.equal(sectioned.code, 0, sectioned.stderr);
  const all = await reports(directory);
  assert.equal(all.length, 3);
  assert.ok(all.some(o => o.report.files[0]!.sections.length === 1));
  assert.equal(hash(await readFile(a)), hash(bytes));
  assert.equal(hash(await readFile(b)), hash(bytes));
});

test('a missing input gives nonzero exit but later valid inputs still produce complete JSON', async t => {
  const directory = await temporary(t), valid = join(directory, 'valid.wav');
  await writeFile(valid, testWav());
  const result = await execute([join(directory, 'missing.wav'), valid], directory);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing.wav/);
  const outputs = await reports(directory);
  assert.equal(outputs.length, 1);
  assert.equal(outputs[0]!.report.source.path, valid);
  assert.equal(outputs[0]!.report.files[0]!.full.duration_seconds, 1);
});

test('out-of-range sections and malformed audio fail without partial JSON reports', async t => {
  const directory = await temporary(t);
  const valid = join(directory, 'valid.wav'), broken = join(directory, 'broken.wav');
  await writeFile(valid, testWav()); await writeFile(broken, 'not a RIFF WAV');
  const range = await execute([valid, '--sections', '0:2'], directory);
  assert.equal(range.code, 1);
  assert.match(range.stderr, /Section must satisfy/);
  const malformed = await execute([broken], directory);
  assert.equal(malformed.code, 1);
  assert.match(malformed.stderr, /invalid WAV/i);
  assert.deepEqual(await reports(directory), []);
});

test('help succeeds and invalid syntax returns usage exit status without reading inputs', async t => {
  const directory = await temporary(t);
  const help = await execute(['--help'], directory);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Usage:/);
  const invalid = await execute(['missing.wav', '--sections', 'bad'], directory);
  assert.equal(invalid.code, 2);
  assert.match(invalid.stderr, /Invalid section/);
  assert.match(invalid.stderr, /Usage:/);
  assert.deepEqual(await reports(directory), []);
});
