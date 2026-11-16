// EMF-S21 review finding 2: a bass-drop handover planned through the planner and judged by the
// evaluator (transition-evaluator@1, mix-evaluation-thresholds@1 unchanged) on synthetic fixtures.
// Engineering only: nothing here says how a handover sounds (listening NOT TESTED).
import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio} from '../src/mix-analysis.js';
import {evaluateTransition, planTransitionSpec} from '../src/mix-evaluate.js';
import {planAutomaticMix} from '../src/mix-planner.js';
import {chooseChoreography, type PairFeatures} from '../web/transition-policy.js';
import type {ChoreographyParams} from '../web/eq-choreography.js';
import {makeSetFixture} from './helpers/synthetic-set.js';

const rate = 16000;
const drop = (overlapBars: number, gapBars: 1 | 2 | 4): ChoreographyParams =>
  ({name: 'bass-drop-handover', overlapBars, swapMs: 380, gapBars});
const carve = (overlapBars: number): ChoreographyParams => ({name: 'mid-carve', overlapBars, swapMs: 380});

test('bass-drop handover against thresholds@1: 12 bars is refused, beat phase holds, mid-carve is the measured-safe choice', () => {
  const rows: string[] = [];
  for (const [fromBpm, toBpm] of [[120, 120], [120, 124]] as const) {
    const from = makeSetFixture({id: 'a', bpm: fromBpm, bars: 72, transitionEvidence: true, tonic: 9});
    const to = makeSetFixture({id: 'b', bpm: toBpm, bars: 72, transitionEvidence: true, tonic: 9});
    const analysis = {from: analyzeMixAudio(from), to: analyzeMixAudio(to)};
    const plan = (choreography: ChoreographyParams) => planAutomaticMix(analysis.from, analysis.to, {recipe: 'blend', harmonicMode: 'limited',
      minimumFromFrame: 4 * rate, returnToOriginalTempo: true, choreography});
    // 12 bars (= 48 beats) is not a supported overlap: the planner refuses it, so the policy never emits it.
    assert.equal(plan({...drop(8, 4), overlapBars: 12}).kind, 'fallback');
    const verdicts: Record<string, string> = {};
    for (const [label, choreography] of [['drop 8b gap2', drop(8, 2)], ['drop 16b gap4', drop(16, 4)], ['mid-carve 8b', carve(8)]] as const) {
      const planned = plan(choreography);
      if (planned.kind !== 'mix') assert.fail(`${label}: ${planned.reason}`);
      const result = evaluateTransition(from, to, planTransitionSpec(planned), analysis);
      const phase = result.measurements!.beatPhase.maxError!;
      assert.ok(phase < 0.05, `${label}: beat phase ${phase} (drift is not what limits a bass drop)`);
      verdicts[label] = result.verdict;
      rows.push(`${fromBpm}->${toBpm} ${label}: ${result.verdict}, phase max ${phase.toFixed(3)}, flags ${result.flags.map(f => `${f.metric}:${f.level}=${(f.value ?? 0).toFixed(1)}`).join(' ') || 'none'}, safety ${result.safety?.verdict}`);
    }
    assert.notEqual(verdicts['mid-carve 8b'], 'fail', 'mid-carve stays within thresholds@1 on this pair');
  }
  console.log('S21 bass-drop measurement (thresholds@1 unchanged):\n' + rows.join('\n'));
});

test('Auto no longer picks a bass-drop gap for weak harmony alone (measured to fail thresholds@1); dense or energetic still does', () => {
  const base: PairFeatures = {densityA: 0.6, densityB: 0.6, harmonic: null, bpm: 126, maxOverlapSeconds: 26};
  assert.equal(chooseChoreography(base).params.name, 'mid-carve');
  assert.equal(chooseChoreography({...base, densityA: 0.8}).params.name, 'bass-drop-handover');
  assert.equal(chooseChoreography({...base, style: 'energetic'}).params.name, 'bass-drop-handover');
});
