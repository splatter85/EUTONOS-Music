import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, type MixPcm} from '../src/mix-analysis.js';
import {barGrid} from '../src/bar-grid.js';
import {planAutomaticMix} from '../src/mix-planner.js';

function rhythm(firstBeat = 0, bpm = 120, syncopatedGain = 0, onGridGain = 0): MixPcm {
  const sampleRate = 8000, period = 60 / bpm, beats = 96;
  const channel = new Float32Array(Math.ceil((beats + 1) * period * sampleRate));
  const add = (at: number, frequency: number, gain: number, decay = 37) => {
    const start = Math.round(at * sampleRate);
    for (let i = 0; i < 0.11 * sampleRate && start + i < channel.length; i++) {
      const t = i / sampleRate;
      channel[start + i] = channel[start + i]! + gain * Math.sin(2 * Math.PI * frequency * t) * Math.exp(-decay * t);
    }
  };
  for (let beat = firstBeat; beat < beats; beat++) {
    const at = 0.137 + beat * period;
    if (!syncopatedGain || beat % 4 === 0) add(at, 55, beat % 4 === 0 ? 0.55 : 0.396);
    if (onGridGain && beat % 4 === 2) add(at, 55, onGridGain);
    if (syncopatedGain && beat % 4 === 2) add(at + period / 2, 55, syncopatedGain);
    if (beat % 2 === 1) {add(at, 790, 0.32, 65); add(at, 1680, 0.16, 65);}
    add(at, 3100, 0.07, 125);
    if (syncopatedGain) add(at + period / 2, 3100, 0.07, 125);
  }
  return {sampleRate, channels: [channel]};
}

test('C1 mid-bar first attacks at beats 10/11 cannot backfill silent phase-0 beat 8', () => {
  const pcm = rhythm(10);
  const a = analyzeMixAudio(pcm), expected = Math.round((0.137 + 12 * 0.5) * pcm.sampleRate);
  assert.ok(a.tempo.bpm !== null && Math.abs(a.tempo.bpm - 120) < 0.25);
  assert.ok(a.structure.downbeatConfidence > 0.2, 'later section must establish phase independently');
  assert.ok(Math.abs(a.structure.downbeatFrames[0]! - expected) < pcm.sampleRate * 0.03,
    JSON.stringify(a.structure.downbeatFrames.slice(0, 3).map(f => f / pcm.sampleRate)));
  assert.ok([...a.mixIn, ...a.mixOut].every(c => c.frame >= a.structure.downbeatFrames[0]!));
  assert.ok(a.mixIn.some(c => c.frame === a.structure.downbeatFrames[0]), 'earliest cue uses the supported phase');
});

test('C2 a tied octave reduces legacy selected-tempo and downbeat scalars', () => {
  // Fixed generated syncopation: inspect the two score margins as well as ambiguity.
  const a = analyzeMixAudio(rhythm(0, 87, 0.6, 0.3));
  const clear = analyzeMixAudio(rhythm(0, 87, 0.2, 0.3));
  const best = a.tempo.candidates[0]!;
  const octave = a.tempo.candidates.find(c => Math.abs(Math.abs(Math.log2(c.bpm / best.bpm)) - 1) < 0.02)!;
  assert.ok(octave, 'must have an octave competitor');
  const margin = (best.strength - octave.strength) / best.strength;
  assert.ok(margin < 0.02, 'genuinely tied octave score margin: ' + margin);
  assert.ok(a.tempo.ambiguity > 0.9);
  assert.ok(a.tempo.confidence < 0.5);
  assert.ok(a.structure.downbeatConfidence > 0.1 && a.structure.downbeatConfidence < 0.3);
  assert.ok(clear.structure.downbeatConfidence > 0.55);
  assert.ok(a.structure.downbeatConfidence < clear.structure.downbeatConfidence - 0.25);
  assert.ok(a.tempo.confidence < clear.tempo.confidence - 0.25);
  const grid = barGrid(rhythm(0, 87, 0.6, 0.3));
  assert.ok(grid.tempo.confidence < 0.5, JSON.stringify(grid.tempo));
  assert.ok(grid.downbeat.confidence < 0.5, JSON.stringify(grid.downbeat));
  assert.equal(planAutomaticMix(a, clear).kind, 'fallback');
});
