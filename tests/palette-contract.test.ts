import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import type {LoadedBrowserPack} from '../src/browser-pack.js';
import type {AudioPack} from '../src/pack-types.js';
import {quartersToFrames, validatePackManifest} from '../src/pack.js';
import {
  compilePhrase, compileS01Phrase, maxRoleFrames, PhrasePlanError, ROLE_MAX_QUARTERS, type S01PhraseRole,
} from '../src/phrase-plan.js';
import {decodeProceduralSamples, ProceduralSource} from '../src/procedural-source.js';
import {WebAudioClock} from '../src/web-audio.js';
import {ContextDouble} from './audio-double.js';

const s01 = JSON.parse(await readFile(new URL('../../fixtures/s01/manifest.json', import.meta.url), 'utf8'));
const ROLES: readonly S01PhraseRole[] = ['drum', 'percussion', 'bass', 'harmony'];
const SEEDS = [...Array(512).keys(), 0xdeadbeef, 0x80000000, 0xffffffff];
const NATIVE_RATES = [8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000];

test('every same-role gap, and the gap to the phrase end, is at least the contract length', () => {
  for (const state of ['explore', 'drive'] as const) for (const seed of SEEDS) {
    const plan = compileS01Phrase(s01, {seed, state, allowFixtures: true});
    for (const role of ROLES) {
      const onsets = plan.events.filter(e => e.role === role).map(e => e.atQuarters);
      for (const [i, at] of onsets.entries()) {
        assert.equal(at * 4, Math.round(at * 4), 'onsets sit on the sixteenth-note grid that maxRoleFrames assumes');
        const next = onsets[i + 1] ?? plan.durationQuarters;
        assert.ok(next - at >= ROLE_MAX_QUARTERS[role], `${role} gap ${next - at} at ${at} (seed ${seed}, ${state})`);
      }
    }
  }
});

test('maxRoleFrames rounding keeps every output-rate end on or before the next same-role onset', () => {
  // Mirrors ProceduralSource: onset = round(q r/2); end = round((round(q n/2) + F) r/n), for onsets
  // on the sixteenth-note grid (asserted above). Off that grid, e.g. at 88.2 kHz and q = 0.375, an
  // end can land one output frame late, so a performer with finer onsets needs a new contract.
  for (const native of NATIVE_RATES) for (const output of NATIVE_RATES) for (const role of ROLES) {
    const frames = maxRoleFrames(role, native), gap = ROLE_MAX_QUARTERS[role];
    assert.ok(frames > 0 && frames <= gap * native / 2);
    for (let k = 0; k <= 32 * 4; k++) {
      const q = k / 4;
      const end = Math.round((quartersToFrames(q, 120, native) + frames) * output / native);
      assert.ok(end <= quartersToFrames(q + gap, 120, output), `${role} ${native}->${output} Hz at ${q}`);
    }
  }
});

/** The S01 descriptors under new identities, rates and channels, as another producer might deliver them. */
function otherProducer(rate: number, channels: 1 | 2): AudioPack {
  const pack = structuredClone(s01);
  pack.id = 'other-producer'; pack.revision = 7;
  for (const asset of pack.assets) {
    asset.id = `other-${asset.id}`; asset.file.path = `audio/${asset.id}.wav`;
    if (asset.source_kind !== 'sample') continue;
    const role = s01.palettes[0].samples.find((s: {asset: {id: string}}) => `other-${s.asset.id}` === asset.id).role;
    Object.assign(asset.file, {sample_rate: rate, channels, frames: maxRoleFrames(role, rate), sha256: 'a'.repeat(64),
      bytes: 44 + maxRoleFrames(role, rate) * channels * 2});
    asset.key = asset.harmony_pitch_classes ? 'any label' : null;
  }
  pack.routes[0].from.id = 'other-s01-recording-a'; pack.routes[0].to.id = 'other-s01-recording-b';
  pack.palettes[0].id = 'other-palette';
  for (const s of pack.palettes[0].samples) s.asset.id = `other-${s.asset.id}`;
  Object.assign(pack.recipes[0], {id: 'other-recipe', palette: {id: 'other-palette', revision: 1}, key: 'any label', genres: ['other']});
  return validatePackManifest(pack);
}

test('a contract palette from any producer drives the identical performer events', () => {
  for (const [rate, channels] of [[44100, 2], [48000, 1], [8000, 2]] as const) {
    const pack = otherProducer(rate, channels);
    for (const state of ['explore', 'drive'] as const) for (const seed of [0, 1, 42, 0xffffffff]) {
      const plan = compilePhrase(pack, {recipe: {id: 'other-recipe', revision: 1}, seed, state, allowFixtures: true});
      const base = compileS01Phrase(s01, {seed, state, allowFixtures: true});
      assert.deepEqual(plan.events.map(e => ({...e, sample: {...e.sample, id: e.sample.id.replace(/^other-/, '')}})), base.events);
      assert.deepEqual(plan.sections, base.sections);
      assert.deepEqual(plan.pack, {id: 'other-producer', revision: 7});
      assert.deepEqual(plan.samples.map(s => s.asset.file.sample_rate), [rate, rate, rate, rate]);
    }
  }
});

test('contract refusals name the broken rule', () => {
  const refuse = (change: (p: ReturnType<typeof structuredClone<typeof s01>>) => void, pattern: RegExp) => {
    const pack = structuredClone(s01); change(pack);
    assert.throws(() => compileS01Phrase(pack, {seed: 0, state: 'explore', allowFixtures: true}),
      (e: unknown) => e instanceof PhrasePlanError && e.code === 'compatibility' && pattern.test(e.message));
  };
  const member = (p: typeof s01, role: string) => p.palettes[0].samples.find((s: {role: string}) => s.role === role);
  const assetOf = (p: typeof s01, role: string) => p.assets.find((a: {id: string}) => a.id === member(p, role).asset.id);
  refuse(p => { p.recipes[0].id = 'renamed'; }, /no recipe s01-recipe@1/);
  refuse(p => { member(p, 'bass').role = 'texture'; }, /exactly one drum, percussion, bass and harmony/);
  refuse(p => {
    p.assets.push({...structuredClone(assetOf(p, 'drum')), id: 's01-texture', file: {...assetOf(p, 'drum').file, path: 'audio/texture.wav'}});
    p.palettes[0].samples.push({asset: {id: 's01-texture', revision: 1}, role: 'texture', root_midi: null});
  }, /exactly one drum, percussion, bass and harmony/);
  refuse(p => { member(p, 'harmony').root_midi = 50; }, /including its root/);
  refuse(p => { assetOf(p, 'bass').harmony_pitch_classes = [2]; }, /inside the recipe harmony/);
  refuse(p => { assetOf(p, 'drum').harmony_pitch_classes = [9]; }, /unpitched/);
  refuse(p => { member(p, 'percussion').root_midi = 60; }, /unpitched/);
  refuse(p => { assetOf(p, 'percussion').file.frames = maxRoleFrames('percussion', 24000) + 1; }, /percussion sample lasts at most 0.25/);
  refuse(p => { p.recipes[0].meter = [4, 4]; p.recipes[0].phrase_bars = 2; }, /four-bar phrases/);
});

// ---------- the real sampler with maximum-length palettes ----------
function wav(rate: number, channels: 1 | 2, frames: number): Uint8Array {
  const data = frames * channels * 2, out = new Uint8Array(44 + data), v = new DataView(out.buffer);
  const tag = (at: number, s: string) => out.set(new TextEncoder().encode(s), at);
  tag(0, 'RIFF'); v.setUint32(4, 36 + data, true); tag(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, channels, true); v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true);
  v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, data, true);
  for (let i = 0; i < frames * channels; i++) v.setInt16(44 + i * 2, (i % 50) * 100 - 2500, true);
  return out;
}
function maximal(rate: number, channels: 1 | 2): LoadedBrowserPack {
  const pack = structuredClone(otherProducer(rate, channels)) as unknown as typeof s01;
  const files = new Map<string, Uint8Array>();
  for (const asset of pack.assets) {
    const bytes = asset.source_kind === 'sample' ? wav(rate, channels, asset.file.frames) : wav(8000, 1, 1);
    Object.assign(asset.file, {sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length});
    files.set(asset.file.path, bytes);
  }
  return {pack: validatePackManifest(pack), files, allowFixtures: true};
}

test('the unchanged sampler schedules maximum-length contract palettes at every native/output rate pair', async () => {
  for (const [native, channels] of [[8000, 1], [22050, 2], [44100, 2], [48000, 1], [192000, 2]] as const) {
    const loaded = maximal(native, channels);
    for (const output of [8000, 44100, 48000, 96000, 192000]) {
      for (const state of ['explore', 'drive'] as const) for (const seed of [0, 1, 2, 42, 0x12345678, 0xffffffff]) {
        const plan = compilePhrase(loaded.pack, {recipe: {id: 'other-recipe', revision: 1}, seed, state, allowFixtures: true});
        const context = new ContextDouble(output), clock = new WebAudioClock(context.audio);
        const samples = await decodeProceduralSamples(loaded, context.audio, plan);
        const source = new ProceduralSource(context.audio, plan, samples, context.destination, {allowFixtures: true});
        await source.prepare(clock);
        source.scheduleStart({at: clock.stamp(output), entryCueId: 'entry'});
        assert.equal(context.sources.length, plan.events.length, `${native}->${output} seed ${seed} ${state}`);
        assert.ok(source.resourceUsage.sampleValues <= 1024 * 1024);
        source.release();
      }
    }
  }
});
