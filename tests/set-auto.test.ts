import assert from 'node:assert/strict';
import test from 'node:test';
import {autoDecision, describeSetMix, moveTarget, tempoPercent, type AutoInput} from '../web/set-mode.js';

const base: AutoInput = {enabled: true, loop: false, playerState: 'playing', transition: 'none', armed: false, pending: false,
  voiceKey: 'song-a@100', handledKey: null, queueLength: 2};

test('Auto acts once per playing song, only when nothing is pending, and never while off or paused', () => {
  assert.deepEqual(autoDecision(base), {kind: 'next', voiceKey: 'song-a@100', reason: 'Auto: next song is scheduled.'});
  assert.equal(autoDecision({...base, enabled: false}).kind, 'idle');
  assert.equal(autoDecision({...base, playerState: 'paused'}).kind, 'idle');
  assert.equal(autoDecision({...base, playerState: 'scheduled'}).kind, 'idle');
  for (const busy of [{armed: true}, {pending: true}, {transition: 'scheduled' as const}, {transition: 'mixing' as const}]) {
    assert.equal(autoDecision({...base, ...busy}).kind, 'wait', JSON.stringify(busy));
  }
  assert.equal(autoDecision({...base, voiceKey: null}).kind, 'wait', 'two voices: the handover has not settled');
  // A failed or cancelled step is not retried for the same song; the next song gets its own step.
  assert.equal(autoDecision({...base, handledKey: 'song-a@100'}).kind, 'wait');
  assert.equal(autoDecision({...base, handledKey: 'song-a@100', voiceKey: 'song-b@9000'}).kind, 'next');
});

test('at the end of the set Auto stops by default and re-queues only with loop on', () => {
  assert.equal(autoDecision({...base, queueLength: 0}).kind, 'finish');
  assert.equal(autoDecision({...base, queueLength: 0, loop: true}).kind, 'requeue');
  assert.equal(autoDecision({...base, queueLength: 0, loop: true, handledKey: 'song-a@100'}).kind, 'wait');
});

test('queue moves stay inside the queue', () => {
  assert.equal(moveTarget(0, -1, 3), null);
  assert.equal(moveTarget(0, 1, 3), 1);
  assert.equal(moveTarget(2, 1, 3), null);
  assert.equal(moveTarget(2, -1, 3), 1);
  assert.equal(moveTarget(3, -1, 3), null);
  assert.equal(moveTarget(0.5, 1, 3), null);
});

test('the set handover description names the recipe, the bar and the tempo change', () => {
  assert.equal(tempoPercent(128 / 122), '+4.9%');
  assert.equal(tempoPercent(1), '0.0%');
  assert.equal(tempoPercent(0.99999), '0.0%');
  assert.equal(tempoPercent(90 / 128), '-29.7%');
  const summary = {recipe: 'fallback-cut', fromBpm: 128, toBpm: 90, tempoRatio: 1, pitchSemitones: 0, confidence: 0, processor: 'none',
    fromExitFrame: 0, toEntryFrame: 0, processedEntryFrame: 0, outputFrames: 0, returnToOriginalTempo: false, fromHash: 'a', toHash: 'b',
    set: {fromId: 'a', toId: 'b', exitBar: 9, boundaryBar: 9, boundaryBars: 4, anchor: 'song', fromGrid: 'requested', toGrid: 'requested',
      tempoChange: 90 / 128, notes: []}} as const;
  const text = describeSetMix(summary);
  assert.match(text, /Clean cut on the bar/);
  assert.match(text, /bar 9 of the outgoing song \(4-bar boundary\)/);
  assert.match(text, /tempo change -29\.7%/);
  assert.match(text, /grids: requested → requested/);
  assert.match(describeSetMix({...summary, recipe: 'blend', set: {...summary.set, anchor: 'entry', boundaryBars: 32,
    fromGrid: 'measured', toGrid: 'measured'}}), /Beatmatched blend .*Auto every 32 bars.*measured beat grids/);
});
