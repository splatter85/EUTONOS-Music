import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertCompiledS01Phrase, compileS01Phrase, PhrasePlanError, S01_PERFORMER,
  type ProceduralPlan, type S01PhraseState,
} from '../src/phrase-plan.js';

const raw = JSON.parse(await readFile(new URL('../../fixtures/s01/manifest.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(raw);
const compile = (seed = 0, state: S01PhraseState = 'explore'): ProceduralPlan =>
  compileS01Phrase(fresh(), { seed, state, allowFixtures: true });
const errorCode = (code: PhrasePlanError['code']) => (error: unknown): boolean =>
  error instanceof PhrasePlanError && error.code === code;
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const structure = (plan: ProceduralPlan): string => digest(plan.events.map(({ sample, role, atQuarters }) =>
  ({ sample, role, atQuarters })));
const selectedSeeds = [0, 1, 2, 42, 255, 256, 1024, 65535, 0x12345678, 0xdecafbad, 0x80000000, 0xffffffff];
const heldOutSeeds = [97, 193, 389, 65537, 104729, 1000003, 0x9e3779b9, 0xabcdef01, 0x76543210, 0xffff0001, 0x70000007, 0x31337313];

function assertFrozen(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) assertFrozen(child);
  }
}

function assertBounded(plan: ProceduralPlan): void {
  assert.ok(plan.events.length > 0 && plan.events.length <= 256);
  const previousEnd = new Map<string, number>();
  const boundaries: { at: number; delta: number }[] = [];
  let previousAt = -Infinity;
  for (const event of plan.events) {
    assert.ok(Number.isFinite(event.atQuarters) && event.atQuarters >= previousAt);
    assert.ok(Number.isFinite(event.gain) && event.gain > 0 && event.gain <= 1);
    assert.ok(event.atQuarters >= 0 && event.atQuarters < 32);
    const sample = plan.samples.find(binding => binding.role === event.role)!;
    assert.ok(sample);
    assert.deepEqual(event.sample, { id: sample.asset.id, revision: sample.asset.revision });
    const duration = sample.asset.file.frames / sample.asset.file.sample_rate * plan.bpm / 60;
    const end = event.atQuarters + duration;
    assert.ok(end <= 32, `${event.role} tail exceeds the phrase`);
    assert.ok(event.atQuarters >= (previousEnd.get(event.role) ?? 0), `${event.role} overlaps itself`);
    previousEnd.set(event.role, end);
    boundaries.push({ at: event.atQuarters, delta: 1 }, { at: end, delta: -1 });
    previousAt = event.atQuarters;
  }
  let active = 0;
  for (const boundary of boundaries.sort((a, b) => a.at - b.at || a.delta - b.delta)) {
    active += boundary.delta;
    assert.ok(active >= 0 && active <= 4, `native voice count ${active}`);
  }
  assert.equal(active, 0);
  assert.deepEqual([...previousEnd.keys()].sort(), ['bass', 'drum', 'harmony', 'percussion']);
}

test('S04 performer binds unchanged S01 descriptors and all four original sample snapshots', () => {
  const input = fresh(), before = JSON.stringify(input);
  const plan = compileS01Phrase(input, { seed: 0, state: 'explore', allowFixtures: true });
  assert.deepEqual(plan.performer, S01_PERFORMER);
  assert.deepEqual(plan.pack, { id: 's01-foundation', revision: 1 });
  assert.deepEqual(plan.recipe, { id: 's01-recipe', revision: 1 });
  assert.deepEqual(plan.palette, { id: 's01-palette', revision: 1 });
  assert.equal(plan.bpm, 120);
  assert.deepEqual(plan.meter, [4, 4]);
  assert.equal(plan.bars, 8);
  assert.equal(plan.phraseBars, 4);
  assert.equal(plan.durationQuarters * 60 / plan.bpm, 16);
  assert.deepEqual(plan.exitQuarters, [16, 32]);
  assert.deepEqual(plan.samples.map(s => [s.role, s.rootMidi]), [
    ['drum', null], ['percussion', null], ['bass', 45], ['harmony', 45],
  ]);
  for (const sample of plan.samples) {
    assert.deepEqual(sample.asset, input.assets.find((asset: { id: string }) => asset.id === sample.asset.id));
    assert.equal(sample.asset.file.sha256.length, 64);
  }
  assert.equal(JSON.stringify(input), before, 'compilation never rewrites recipe or provenance');
});

test('explicit seed zero and a large seed replay the pinned version-one event sequences', () => {
  const zero = compile(0), large = compile(0xdecafbad, 'drive');
  assert.equal(digest(zero.events), '79d80a70f2bb383d891adec176206bb8913e4e7f5f5ef3a932cdbf76acb83056');
  assert.equal(digest(large.events), '959d9c755924dddac901b455ffc0e3438a13661d61155858767a8641b909a0d1');
  for (const seed of [0, 1, 0xdecafbad, 0xffffffff]) {
    for (const state of ['explore', 'drive'] as const) {
      assert.deepEqual(compile(seed, state), compile(seed, state));
    }
  }
});

test('selected and held-out seeds vary event timing and role structure beyond velocity', () => {
  for (const seeds of [selectedSeeds, heldOutSeeds]) {
    for (const state of ['explore', 'drive'] as const) {
      const plans = seeds.map(seed => compile(seed, state));
      assert.ok(new Set(plans.map(structure)).size >= 10, `${state}: structural diversity`);
      assert.ok(new Set(plans.map(plan => plan.sections[0]!.rhythm)).size >= 3);
      assert.ok(new Set(plans.map(plan => plan.sections[0]!.motif)).size >= 3);
      assert.ok(new Set(plans.map(plan => plan.sections[0]!.fill)).size >= 3);
    }
  }
});

test('selected, held-out and 256 additional seeds stay finite, in bounds and within four voices', () => {
  const seeds = [...selectedSeeds, ...heldOutSeeds,
    ...Array.from({ length: 256 }, (_, i) => Math.imul(i + 1, 0x9e3779b9) >>> 0)];
  for (const seed of seeds) for (const state of ['explore', 'drive'] as const) assertBounded(compile(seed, state));
});

test('statement and answer develop rhythms and motifs with four-bar cadences', () => {
  for (const seed of [...selectedSeeds, ...heldOutSeeds]) {
    const plan = compile(seed), [statement, answer] = plan.sections;
    assert.deepEqual(plan.sections.map(s => [s.name, s.fromQuarters, s.toQuarters]), [
      ['statement', 0, 16], ['answer', 16, 32],
    ]);
    assert.notEqual(statement!.rhythm, answer!.rhythm);
    assert.notEqual(statement!.motif, answer!.motif);
    assert.notEqual(statement!.fill, answer!.fill);
    for (const cadence of [12, 28]) {
      assert.ok(plan.events.filter(e => e.role === 'percussion' && e.atQuarters >= cadence + 2 && e.atQuarters < cadence + 4).length >= 4);
      assert.ok(!plan.events.some(e => e.role === 'bass' && e.atQuarters >= cadence + 3 && e.atQuarters < cadence + 4));
    }
  }
});

test('drive increases arrangement density while preserving seed-selected motifs and unchanged pitch', () => {
  for (const seed of [...selectedSeeds, ...heldOutSeeds]) {
    const explore = compile(seed), drive = compile(seed, 'drive');
    assert.deepEqual(explore.sections, drive.sections);
    assert.ok(drive.events.length > explore.events.length);
    assert.equal(explore.events.filter(e => e.role === 'harmony').length, 4);
    assert.equal(drive.events.filter(e => e.role === 'harmony').length, 8);
    assert.deepEqual(explore.samples, drive.samples);
    assert.ok(drive.events.every(e => Object.keys(e).sort().join(',') === 'atQuarters,gain,role,sample'));
  }
});

test('seed must be an explicit uint32 and state must be implemented', () => {
  for (const seed of [undefined, null, -1, 0.5, 0x100000000, NaN, Infinity, '0']) {
    assert.throws(() => compileS01Phrase(fresh(), { seed: seed as number, state: 'explore', allowFixtures: true }), errorCode('seed'));
  }
  for (const state of [undefined, null, 'browse', 'surge', 'afterglow', 'Drive', '']) {
    assert.throws(() => compileS01Phrase(fresh(), { seed: 0, state: state as S01PhraseState, allowFixtures: true }), errorCode('state'));
  }
});

test('valid but unsupported recipe, palette and sample metadata fail closed', () => {
  const mutations: ((pack: ReturnType<typeof fresh>) => void)[] = [
    p => { p.revision = 2; },
    p => { p.recipes[0].bpm = 121; },
    p => { p.recipes[0].phrase_bars = 8; },
    p => { p.recipes[0].key = 'D minor'; },
    p => { p.recipes[0].states = ['explore']; },
    p => { p.palettes[0].samples.find((s: { role: string }) => s.role === 'bass').root_midi = 48; },
    p => { p.assets.find((a: { id: string }) => a.id === 's01-kick').file.sha256 = '0'.repeat(64); },
    p => { p.assets.find((a: { id: string }) => a.id === 's01-percussion').file.sample_rate = 48000; },
    p => { p.assets.find((a: { id: string }) => a.id === 's01-harmony-am').harmony_pitch_classes = [0, 4, 7]; },
    p => { p.assets.find((a: { id: string }) => a.id === 's01-bass-a2').states = ['explore']; },
  ];
  for (const mutate of mutations) {
    const input = fresh(); mutate(input);
    assert.throws(() => compileS01Phrase(input, { seed: 0, state: 'explore', allowFixtures: true }), errorCode('compatibility'));
  }
});

test('every sample requires both reuse and playback rights and explicit fixture opt-in', () => {
  for (const allowFixtures of [undefined, false]) {
    assert.throws(() => compileS01Phrase(fresh(), { seed: 0, state: 'explore', ...(allowFixtures === undefined ? {} : { allowFixtures }) }), errorCode('eligibility'));
  }
  for (const id of ['s01-kick', 's01-percussion', 's01-bass-a2', 's01-harmony-am']) {
    for (const uses of [['playback'], ['sample-reuse']]) {
      const input = fresh();
      input.assets.find((a: { id: string }) => a.id === id).rights.allowed_uses = uses;
      assert.throws(() => compileS01Phrase(input, { seed: 0, state: 'explore', allowFixtures: true }), errorCode('eligibility'));
    }
    const input = fresh();
    input.assets.find((a: { id: string }) => a.id === id).eligibility = 'unreviewed';
    assert.throws(() => compileS01Phrase(input, { seed: 0, state: 'explore', allowFixtures: true }), errorCode('eligibility'));
  }
  const reviewed = fresh();
  for (const asset of reviewed.assets) if (asset.source_kind === 'sample') asset.eligibility = 'listening-reviewed';
  assert.doesNotThrow(() => compileS01Phrase(reviewed, { seed: 0, state: 'explore' }));
});

test('plan and provenance are deep immutable snapshots, isolated from mutable caller input', () => {
  const input = fresh();
  const plan = compileS01Phrase(input, { seed: 42, state: 'drive', allowFixtures: true });
  const before = JSON.stringify(plan);
  assertFrozen(plan);
  assert.ok(!Object.isFrozen(input));
  assert.ok(!Object.isFrozen(input.assets));
  input.assets.find((a: { id: string }) => a.id === 's01-bass-a2').rights.allowed_uses.length = 0;
  input.palettes[0].samples[0].asset.id = 'changed';
  input.recipes[0].bpm = 999;
  assert.equal(JSON.stringify(plan), before);
  assert.throws(() => Object.assign(plan.events[0]!, { gain: 0 }), TypeError);
  assert.throws(() => Object.assign(plan.samples[0]!.asset.file, { sha256: '0'.repeat(64) }), TypeError);
  assert.doesNotThrow(() => assertCompiledS01Phrase(plan));
  for (const forged of [null, {}, structuredClone(plan), JSON.parse(before), Object.freeze({ ...plan })]) {
    assert.throws(() => assertCompiledS01Phrase(forged), errorCode('compatibility'));
  }
  assert.doesNotThrow(() => assertCompiledS01Phrase(compile(plan.seed, plan.state)));
});
