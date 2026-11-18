/**
 * DJ booth settings through the real player (original synthetic songs, real analysis/planner/render path, injected
 * pre-check): the settings stamp reaches the plan record, the allowed styles reach the pair-search candidates, the URL flag
 * overrides the pair search setting and a settings change restarts the search. Engineering evidence only (listening NOT TESTED).
 */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import test, {after, before} from 'node:test';
import {loadBrowserPack} from '../src/browser-pack.js';
import {analyzeMixAudio, measureMixLevel, nativeSamplePeak} from '../src/mix-analysis.js';
import type {MixPreparationRuntime} from '../src/mix-transition.js';
import {SmallPlayer} from '../src/player.js';
import {renderFiniteLoop, renderTimePitch} from '../src/time-pitch.js';
import {DEFAULT_SETTINGS_ID, defaultDjSettings, mergeDjSettings, settingsStamp} from '../web/dj-settings.js';
import {PRECHECK_PROTOCOL, type PrecheckReport, type PrecheckRuntime} from '../web/mix-precheck-data.js';
import {validateTransitionPlanRecord} from '../web/transition-policy.js';
import {ContextDouble, NodeDouble, ParameterDouble} from './audio-double.js';
import {buildSyntheticSet, decodePcm16} from './helpers/synthetic-set.js';

function audioBuffer(rate: number, channels: Float32Array[]): AudioBuffer {
  return {sampleRate: rate, length: channels[0]!.length, duration: channels[0]!.length / rate, numberOfChannels: channels.length,
    getChannelData: (i: number) => channels[i]!, copyToChannel: (source: Float32Array, i: number) => channels[i]!.set(source)} as AudioBuffer;
}
class FilterDouble extends NodeDouble {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new ParameterDouble(); readonly gain = new ParameterDouble(); readonly Q = new ParameterDouble();
}
class SetContext extends ContextDouble {
  constructor() { super(16000); }
  createBiquadFilter(): BiquadFilterNode { return new FilterDouble(this.audio) as unknown as BiquadFilterNode; }
  createBuffer(count: number, frames: number, rate: number): AudioBuffer { return audioBuffer(rate, Array.from({length: count}, () => new Float32Array(frames))); }
  override async decodeAudioData(input: ArrayBuffer): Promise<AudioBuffer> { const pcm = decodePcm16(new Uint8Array(input)); return audioBuffer(this.sampleRate, pcm.channels); }
}
const runtime: MixPreparationRuntime = {
  analyze: async (from, to) => ({from: analyzeMixAudio(from), to: analyzeMixAudio(to)}),
  render: async (audio, options) => renderTimePitch(audio, options),
  scanPeak: async audio => nativeSamplePeak(audio),
  renderLoop: async (audio, loop, tail, bars, gain) => renderFiniteLoop(audio, loop, tail, bars, gain),
  analyzeOne: async (audio, _signal, options, levelAudio) => ({...analyzeMixAudio(audio, options), level: measureMixLevel(levelAudio ?? audio)}),
};
const pass: PrecheckRuntime = async () => ({version: PRECHECK_PROTOCOL, status: 'pass', reason: 'synthetic pass', evaluation: null, coverage: null} as PrecheckReport);

let set: Awaited<ReturnType<typeof buildSyntheticSet>>;
before(async () => { set = await buildSyntheticSet([{id: 'ds-a', bpm: 120, bars: 64, tonic: 9}, {id: 'ds-b', bpm: 120, bars: 64, tonic: 4}]); });
after(async () => { await set?.cleanup(); });

async function setup() {
  const fetcher = (async (input: string | URL | Request) => new Response(new Uint8Array(await readFile(
    join(set.out, ...decodeURIComponent(new URL(String(input)).pathname).slice(1).split('/')))))) as typeof fetch;
  const loaded = await loadBrowserPack(new URL('http://localhost/pack/manifest.json'), false, fetcher, {allowUnreviewed: true, set: true});
  const context = new SetContext();
  const player = new SmallPlayer(context.audio, loaded, null, runtime, undefined, pass);
  const ids = ['ds-a', 'ds-b'].map(id => set.idFor(id));
  await player.playAsset(ids[0]!); context.advance(0.5);
  return {player, ids, context};
}
async function until(cond: () => boolean, label: string, ms = 120_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out: ' + label);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const manual = (patch: Record<string, unknown>) => mergeDjSettings(defaultDjSettings(), patch);

test('player: no settings applied means no stamp; applied settings are stamped on the plan record', async () => {
  const {player, ids} = await setup();
  try {
    assert.equal(player.djSettingsStamp, null);
    await player.scheduleMixTo(ids[1]!, {bars: 4, anchor: 'song'});
    assert.equal(player.snapshot().mix!.summary!.set!.transition!.settings, undefined, 'older behaviour: no stamp until settings are applied');
  } finally { await player.dispose(); }
  const second = await setup();
  try {
    const stamp = second.player.setDjSettings(manual({maxStretch: {mode: 'manual', value: 8}}));
    assert.equal(second.player.djSettingsStamp?.id, stamp.id);
    await second.player.scheduleMixTo(second.ids[1]!, {bars: 4, anchor: 'song'});
    const record = validateTransitionPlanRecord(second.player.snapshot().mix!.summary!.set!.transition!);
    assert.equal(record.settings?.id, stamp.id);
    assert.equal(record.settings?.snapshot.maxStretch.mode, 'manual');
  } finally { await second.player.dispose(); }
  const third = await setup();
  try {
    third.player.setDjSettings(defaultDjSettings());
    await third.player.scheduleMixTo(third.ids[1]!, {bars: 4, anchor: 'song'});
    assert.equal(third.player.snapshot().mix!.summary!.set!.transition!.settings?.id, DEFAULT_SETTINGS_ID, 'all-DJ settings have the constant default id');
  } finally { await third.player.dispose(); }
});

test('player: pair search mode follows the setting, the URL flag wins, and a settings change restarts the search', async () => {
  const {player, ids} = await setup();
  try {
    assert.equal(player.pairSearch, 'off');
    player.setDjSettings(manual({pairSearch: {mode: 'manual', value: 'shadow'}}));
    assert.equal(player.pairSearch, 'shadow');
    player.setDjSettings(manual({pairSearch: {mode: 'manual', value: 'shadow'}}), 'live');
    assert.equal(player.pairSearch, 'live', 'the ?pairsearch= flag overrides the setting');
    assert.equal(player.djSettingsStamp?.urlPairSearch, 'live');
    player.setDjSettings(defaultDjSettings());
    assert.equal(player.pairSearch, 'off', 'DJ decides is off today');
    player.setDjSettings(manual({pairSearch: {mode: 'manual', value: 'shadow'}}));
    player.preparePair(ids[1]!);
    await until(() => player.pairSearchReadiness().phase !== 'analysing', 'search started');
    const started = () => player.decisionJournal().filter(e => e.kind === 'search-started').length;
    assert.equal(started(), 1);
    player.setDjSettings(manual({pairSearch: {mode: 'manual', value: 'shadow'}, maxStretch: {mode: 'manual', value: 8}}));
    assert.equal(started(), 2, 'a planning change restarts the search for the same pair');
    player.setDjSettings(manual({pairSearch: {mode: 'manual', value: 'shadow'}, maxStretch: {mode: 'manual', value: 8}}));
    assert.equal(started(), 2, 'the same settings do not restart it');
  } finally { await player.dispose(); }
});

test('player live: ticked styles only reach the pair-search table; the plan honours them and carries the stamp', async () => {
  const {player, ids} = await setup();
  try {
    const settings = manual({pairSearch: {mode: 'manual', value: 'live'}, styles: {mode: 'manual', value: ['crossfade', 'layered-bass-first']}});
    const stamp = player.setDjSettings(settings);
    player.preparePair(ids[1]!);
    await until(() => player.pairSearchReadiness().phase === 'done', 'search finished');
    const table = player.pairPlanTable()!;
    const candidates = table.slots.flatMap(s => s.ranked).map(c => c.spec);
    const routeFree = candidates.filter(c => c.kind === 'route-free');
    assert.ok(routeFree.length > 0, 'some route-free candidates remain');
    for (const c of routeFree) assert.ok(c.recipe === 'fallback-crossfade' || c.recipe === 'fallback-layered-entry/bass-first', `${c.recipe} is not ticked`);
    assert.ok(candidates.every(c => c.kind !== 'cut'), 'no cut candidate, ever');
    await player.scheduleMixTo(ids[1]!, {bars: 4, anchor: 'song'});
    const record = validateTransitionPlanRecord(player.snapshot().mix!.summary!.set!.transition!);
    assert.equal(record.settings?.id, stamp.id);
    assert.notEqual(record.recipe, 'cut'); assert.notEqual(record.recipe, 'fallback-cut');
    if (record.recipe.startsWith('fallback-')) {
      const style = record.entryStyle?.style;
      assert.ok(record.recipe === 'fallback-crossfade' || style === 'bass-first', `${record.recipe} ${style}`);
    }
  } finally { await player.dispose(); }
});

test('settingsStamp ids are stable across processes of the same settings', () => {
  assert.equal(settingsStamp(defaultDjSettings()).id, DEFAULT_SETTINGS_ID);
  assert.match(DEFAULT_SETTINGS_ID, /^ds-[0-9a-f]{8}$/);
});
