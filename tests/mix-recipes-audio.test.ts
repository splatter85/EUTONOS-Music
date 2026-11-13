import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, type MixPcm} from '../src/mix-analysis.js';
import {planAutomaticMix, type MixRecipe} from '../src/mix-planner.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';

/** Original 120 BPM 4/4 drums and one dry tone. Leading pickup is measured, not a cue hint.
 * A lowers energy after bar28; B's standalone entry follows an eight-bar intro.
 * There are no vocals, reverberation or externally supplied analysis/confidence fields.
 */
function originalSections(incoming: boolean): MixPcm {
  const sampleRate = 8000, offsetSeconds = 0.137;
  const drums = makeMixFixture({sampleRate, bars: 40, chords: false, offsetSeconds}).channels[0]!;
  return {sampleRate, channels: [Float32Array.from(drums, (sample, i) => {
    const seconds = i / sampleRate - offsetSeconds;
    if (seconds < 0) return 0;
    const bar = Math.floor(seconds / 2), beat = Math.floor((seconds % 2) / 0.5);
    const level = incoming ? bar < 8 ? 0.3 : 1 : bar < 28 ? 1 : 0.3;
    return level * (sample * (beat === 0 ? 1.4 : 1) + 0.02 * Math.sin(2 * Math.PI * 220 * seconds));
  })]};
}

for (const recipe of ['cut', 'echo-out'] as const satisfies readonly MixRecipe[]) {
  test('untouched generated PCM analysis admits ' + recipe + ' at measured structural cues', () => {
    const fromPcm = originalSections(false), toPcm = originalSections(true);
    const from = analyzeMixAudio(fromPcm), to = analyzeMixAudio(toPcm);
    const before = JSON.stringify({from, to});
    const options = {recipe, echoContentConfirmed: true};
    const plan = planAutomaticMix(from, to, options);
    assert.equal(plan.kind, 'mix', plan.kind === 'fallback' ? plan.reason : '');
    if (plan.kind !== 'mix') return;
    assert.equal(plan.recipe, recipe);
    assert.ok(Math.abs(from.tempo.bpm! - 120) < 0.25);
    assert.ok(Math.abs(to.tempo.bpm! - 120) < 0.25);
    assert.ok(from.tempo.ambiguity <= 0.5 && to.tempo.ambiguity <= 0.5);
    assert.ok(from.structure.downbeatConfidence >= 0.65 && to.structure.downbeatConfidence >= 0.65);
    assert.ok(Math.abs(plan.fromExitFrame / plan.sampleRate - (28 * 2 + 0.137)) <= 0.025);
    assert.ok(Math.abs(plan.toEntryFrame / plan.sampleRate - (8 * 2 + 0.137)) <= 0.025);
    const out = from.mixOut.find(c => c.frame === plan.fromExitFrame)!;
    const entry = to.mixIn.find(c => c.frame === plan.toEntryFrame)!;
    assert.ok(out.confidence >= 0.65 && entry.confidence >= 0.65);
    assert.ok(out.evidence!.boundary >= 0.6 && entry.evidence!.salience >= 0.65);
    if (recipe === 'echo-out') assert.ok(out.evidence!.interference <= 0.35);
    assert.equal(plan.tempoRatio, 1); assert.equal(plan.pitchSemitones, 0);
    assert.equal(plan.harmonic.relation, 'unknown', 'a single dry tone is not an invented tonal key');
    assert.deepEqual(plan, planAutomaticMix(from, to, options));
    assert.equal(JSON.stringify({from, to}), before, 'planning cannot rewrite measured evidence');
  });
}
