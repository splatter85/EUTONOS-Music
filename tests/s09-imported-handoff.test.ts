import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import type {LoadedBrowserPack} from '../src/browser-pack.js';
import {CONTROL_VERSION, type ControlRequest} from '../src/control.js';
import {DeterministicDj} from '../src/dj.js';
import {bridgeSeed, HYBRID_POLICIES, hybridPolicyForRoute, planHybridHandoff, S05_HYBRID_POLICY,
  S06_MOCK_HYBRID_POLICY, S09_HYBRID_POLICY} from '../src/hybrid-handoff.js';
import type {HostAdapter} from '../src/authoring/host.js';
import {loadPack} from '../src/node.js';
import {compilePhrase, compileS01Phrase, maxRoleFrames} from '../src/phrase-plan.js';
import {SmallPlayer} from '../src/player.js';
import {WebAudioClock} from '../src/web-audio.js';
import {fadeCut, produceFlDelivery, SHOTS, soundingFrames, wavInfo} from '../scripts/fl-producer.js';
import {generateMockPack} from '../scripts/mock-fl-producer.js';
import {ContextDouble, fixturePack} from './audio-double.js';

const root = await mkdtemp(join(tmpdir(), 'em-s09-'));
test.after(() => rm(root, {recursive: true, force: true}));
const mockDir = await generateMockPack(join(root, 'mock'));
const mockPack = (await loadPack(mockDir)).pack;
const mock: LoadedBrowserPack = {pack: mockPack, allowFixtures: true, files: new Map(await Promise.all(mockPack.assets.map(async a =>
  [a.file.path, new Uint8Array(await readFile(join(mockDir, ...a.file.path.split('/'))))] as const)))};
const MOCK_RECIPE = {id: 's06-mock-recipe', revision: 1};

test('hybrid policies are frozen, distinct and found only by exact route identity', () => {
  assert.deepEqual(HYBRID_POLICIES.map(p => p.id), ['s05-hybrid-handoff', 's06-mock-hybrid-handoff', 's09-hybrid-handoff']);
  assert.ok(Object.isFrozen(HYBRID_POLICIES) && HYBRID_POLICIES.every(p => Object.isFrozen(p)));
  assert.equal(hybridPolicyForRoute({id: 's01-a-to-b', revision: 1}), S05_HYBRID_POLICY);
  assert.equal(hybridPolicyForRoute({id: 's06-a-to-b', revision: 1}), S06_MOCK_HYBRID_POLICY);
  assert.equal(hybridPolicyForRoute({id: 's09-a-to-b', revision: 1}), S09_HYBRID_POLICY);
  assert.equal(hybridPolicyForRoute({id: 's09-a-to-b', revision: 2}), null, 'a revised route needs its own policy');
  assert.equal(hybridPolicyForRoute({id: 'other', revision: 1}), null);
  for (const policy of [S06_MOCK_HYBRID_POLICY, S09_HYBRID_POLICY]) {
    assert.deepEqual(policy.performer, S05_HYBRID_POLICY.performer, 'the same S04 performer');
    assert.equal(policy.leadIn, S05_HYBRID_POLICY.leadIn);
    assert.equal(policy.tail, S05_HYBRID_POLICY.tail);
    assert.equal(policy.review, 'engineering-only');
  }
});

test('an imported pack plans a hybrid handoff only with its own policy recipe', () => {
  const context = new ContextDouble(), clock = new WebAudioClock(context.audio);
  const start = {at: {engineGeneration: clock.engineGeneration, frame: 4800}, entryCueId: 'entry'};
  const bridge = compilePhrase(mock.pack, {recipe: MOCK_RECIPE, seed: 3, state: 'drive', allowFixtures: true});
  const plan = planHybridHandoff(mock.pack, 's06-a-to-b', bridge, 'phrase', start, clock, true);
  assert.deepEqual(plan.policy, {id: 's06-mock-hybrid-handoff', revision: 1});
  assert.deepEqual([plan.fromExit.frame, plan.bridgeFull.frame, plan.toStart.frame, plan.end.frame],
    [4800 + 8 * 48000, 4800 + 10 * 48000, 4800 + 16 * 48000, 4800 + 18 * 48000]);
  assert.throws(() => planHybridHandoff(mock.pack, 's06-a-to-b', bridge, 'phrase', start, clock, false), /fixture mode/);
  return fixturePack().then(s01 => {
    const s01Bridge = compileS01Phrase(s01.pack, {seed: 3, state: 'drive', allowFixtures: true});
    assert.throws(() => planHybridHandoff(mock.pack, 's06-a-to-b', s01Bridge, 'phrase', start, clock, true), /not the policy performer and recipe/);
    assert.throws(() => planHybridHandoff(s01.pack, 's01-a-to-b', bridge, 'phrase', start, clock, true), /not the policy performer and recipe/);
  });
});

test('the DJ compiles the bridge from the loaded pack\'s own policy recipe', async () => {
  const context = new ContextDouble();
  const player = new SmallPlayer(context.audio, mock, 's06-a-to-b');
  const dj = new DeterministicDj(player, mock, 'explore', {handoff: 'hybrid'});
  const send = (intent: Record<string, unknown>, id: string) => dj.request({schemaVersion: CONTROL_VERSION, commandId: id,
    expectedRevision: dj.snapshot().control.revision, source: 'manual', ...intent} as ControlRequest);
  await send({type: 'transport', action: 'play'}, 'play-1');
  context.advance(0.2);
  const next = await send({type: 'nextSong'}, 'next-1');
  assert.equal(next.execution.status, 'scheduled', next.execution.reason);
  assert.equal(next.execution.trackId, 's06-mock-recording-b');
  const view = dj.snapshot();
  assert.deepEqual(view.player.handoff!.policy, {id: 's06-mock-hybrid-handoff', revision: 1});
  assert.deepEqual(view.player.handoff!.bridge.recipe, MOCK_RECIPE);
  assert.equal(view.player.handoff!.bridge.seed, bridgeSeed('next-1'));
  context.currentTime = 18.5;
  assert.deepEqual(dj.snapshot().player.now, ['s06-mock-recording-b']);
  assert.equal(dj.snapshot().player.handoff!.phase, 'complete');
  await dj.dispose();
});

// ---------- real-FL producer helpers (no FL Studio needed) ----------
function wav(frames: number, sample: (f: number) => number, junk = true): Uint8Array {
  const pad = junk ? 36 : 0, data = frames * 4, out = new Uint8Array(44 + pad + data), d = new DataView(out.buffer);
  const tag = (at: number, s: string) => out.set(new TextEncoder().encode(s), at);
  tag(0, 'RIFF'); d.setUint32(4, 36 + pad + data, true); tag(8, 'WAVE');
  let o = 12;
  if (junk) { tag(o, 'JUNK'); d.setUint32(o + 4, 28, true); o += 36; } // FL writes a JUNK chunk first
  tag(o, 'fmt '); d.setUint32(o + 4, 16, true); d.setUint16(o + 8, 1, true); d.setUint16(o + 10, 2, true);
  d.setUint32(o + 12, 44100, true); d.setUint32(o + 16, 44100 * 4, true); d.setUint16(o + 20, 4, true); d.setUint16(o + 22, 16, true);
  tag(o + 24, 'data'); d.setUint32(o + 28, data, true);
  for (let f = 0; f < frames; f++) { d.setInt16(o + 32 + f * 4, sample(f), true); d.setInt16(o + 34 + f * 4, sample(f), true); }
  return out;
}

test('the FL producer measures sounding length past a JUNK chunk and fade-cuts to an exact frame count', () => {
  const input = wav(1000, f => f < 600 ? 10000 : f < 700 ? 20 : 0);
  assert.deepEqual(wavInfo(input), {sampleRate: 44100, channels: 2, frames: 1000, dataOffset: 80});
  assert.equal(soundingFrames(input), 600 + 32, 'residue at or below -62 dBFS is not sounding; a 32-frame margin is kept');
  assert.equal(soundingFrames(wav(10, () => 0)), 0);
  const cut = fadeCut(input, 500), info = wavInfo(cut), d = new DataView(cut.buffer);
  assert.deepEqual([info.frames, info.dataOffset, cut.length], [500, 44, 44 + 500 * 4]);
  assert.equal(d.getInt16(44, true), 10000, 'unchanged before the fade');
  assert.equal(d.getInt16(44 + 499 * 4, true), 0, 'the fade reaches zero on the last kept frame');
  assert.ok(d.getInt16(44 + 400 * 4, true) < 10000 && d.getInt16(44 + 400 * 4, true) > 0);
  assert.throws(() => fadeCut(input, 1001), /more frames/);
  for (const shot of SHOTS) assert.ok(maxRoleFrames(shot.role, 44100) > 0);
});

test('the FL producer refuses an unavailable host and a running FL Studio before touching the workspace', async () => {
  const host = (available: boolean, running: string[]): HostAdapter => ({
    info: async () => ({platform: 'win32', adapter: 'test', available, fl_executable: null, fl_version: null, reason: available ? null : 'not installed'}),
    runningInstances: async () => running, renderWav: async () => { throw new Error('must not render'); },
    exportMidi: async () => { throw new Error('must not export'); }, templatePath: async () => null,
  });
  await assert.rejects(produceFlDelivery(join(root, 'd1'), join(root, 'w1'), {host: host(false, [])}), /not available: not installed/);
  await assert.rejects(produceFlDelivery(join(root, 'd2'), join(root, 'w2'), {host: host(true, ['FL Studio'])}), /FL Studio is running/);
});
