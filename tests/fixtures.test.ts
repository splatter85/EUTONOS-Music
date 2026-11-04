import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { generateFixtures } from '../scripts/generate-fixtures.js';
import { readPcm16Wav, validatePackFiles } from '../src/audio.js';
import { validatePackManifest } from '../src/pack.js';

const run = promisify(execFile);
const fixtureRoot = fileURLToPath(new URL('../../fixtures/s01/', import.meta.url));
const generatorCli = fileURLToPath(new URL('../scripts/generate-fixtures.js', import.meta.url));

test('original fixture generation is deterministic and matches every committed byte', async () => {
  const first = generateFixtures();
  const second = generateFixtures();
  assert.equal(first.files.size, 7);
  for (const [path, bytes] of first.files) {
    assert.deepEqual(bytes, second.files.get(path), path);
    assert.deepEqual(bytes, await readFile(join(fixtureRoot, path)), path);
  }
  const pack = validatePackManifest(first.manifest);
  const reports = await validatePackFiles(pack, async path => {
    const bytes = first.files.get(path);
    assert.ok(bytes, path);
    return bytes;
  });
  assert.equal(reports.length, 6);
});

test('PCM fixtures contain distinct finite arrangements and bounded non-silent sample inputs', () => {
  const { manifest, files } = generateFixtures();
  const [a, b] = manifest.assets;
  assert.ok(a && b);
  assert.notDeepEqual(files.get(a.file.path), files.get(b.file.path));
  for (const asset of manifest.assets) {
    const bytes = files.get(asset.file.path)!;
    const pcm = readPcm16Wav(bytes);
    assert.equal(pcm.sample_rate, 24_000);
    assert.equal(pcm.channels, 1);
    assert.ok(pcm.peak > 0.01 && pcm.peak < 0.95, `${asset.id}: peak ${pcm.peak}`);
    assert.equal(bytes.readInt16LE(pcm.data_offset), 0, `${asset.id}: first sample`);
    assert.equal(bytes.readInt16LE(pcm.data_offset + pcm.data_bytes - 2), 0, `${asset.id}: last sample`);
    assert.equal(asset.eligibility, 'fixture-only');
    assert.equal(asset.rights.license, 'CC0-1.0');
    if (asset.source_kind === 'recording') {
      assert.equal(pcm.frames, 384_000);
      assert.equal(pcm.frames / pcm.sample_rate, 16);
      assert.deepEqual(asset.harmony_pitch_classes, [0, 4, 9]);
      assert.deepEqual(asset.cues.map(cue => cue.position_quarters), [0, 16, 32]);
      // The tail contains actual audio, rather than silence padding to satisfy an exit cue.
      let tailPeak = 0;
      for (let frame = 16 * 12_000; frame < 24 * 12_000; frame++) {
        tailPeak = Math.max(tailPeak, Math.abs(bytes.readInt16LE(pcm.data_offset + frame * 2)));
      }
      assert.ok(tailPeak > 1_000);
    } else {
      assert.equal(asset.timing, null);
      assert.deepEqual(asset.cues, []);
    }
  }
  assert.deepEqual(manifest.palettes[0]!.samples.map(sample => sample.role), ['drum', 'percussion', 'bass', 'harmony']);
  assert.equal(manifest.recipes.length, 1);
  assert.equal(manifest.routes.length, 1);
  assert.equal(manifest.routes[0]!.overlap_quarters, 8);
});

test('generator CLI accepts portable output paths and check mode never repairs changed bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eutonos s01 '));
  try {
    await run(process.execPath, [generatorCli, directory], { cwd: tmpdir() });
    const target = join(directory, 'audio', 's01-recording-a.wav');
    const before = await stat(target);
    await run(process.execPath, [generatorCli, '--check', directory], { cwd: tmpdir() });
    assert.equal((await stat(target)).mtimeMs, before.mtimeMs);
    const altered = Buffer.from(await readFile(target));
    altered[100] = altered[100]! ^ 1;
    await writeFile(target, altered);
    await assert.rejects(run(process.execPath, [generatorCli, '--check', directory], { cwd: tmpdir() }), /Fixture differs/);
    assert.deepEqual(await readFile(target), altered);
    // Default fixture resolution must also work from outside the repository.
    await run(process.execPath, [generatorCli, '--check'], { cwd: tmpdir() });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
