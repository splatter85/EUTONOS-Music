import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeMixAudio, findIncomingCues, findOutgoingCues,
  type MixAnalysis, type MixPcm, type MixPointCandidate} from '../src/mix-analysis.js';
import {planAutomaticMix} from '../src/mix-planner.js';
import {replanPreparedMix, type ReadyMixTransition} from '../src/mix-transition.js';
import {makeMixFixture} from './helpers/mix-fixtures.js';

// Generated original percussive/tonal sections; bar numbers are zero based.
// No inference of semantic song labels is used in any expectation.
function structured(level: (bar: number) => number, bars = 40, gain = 1,
  pitch: (bar: number) => number = () => 220): MixPcm {
  const sampleRate = 8000, drums = makeMixFixture({sampleRate, bars, chords: false}).channels[0]!;
  return {sampleRate, channels: [Float32Array.from(drums, (sample, i) => {
    const t = i / sampleRate, bar = Math.floor(t / 2), local = t % 2;
    const envelope = Math.min(1, local / 0.025, (2 - local) / 0.025);
    const tone = envelope * (0.06 * Math.sin(2 * Math.PI * pitch(bar) * t) +
      0.04 * Math.sin(2 * Math.PI * pitch(bar) * 1.5 * t));
    return gain * level(bar) * (sample + tone);
  })]};
}
function atBar(a: MixAnalysis, bar: number): MixPointCandidate | undefined {
  return a.mixIn.find(c => Math.abs(c.frame / a.sampleRate - bar * 2) < 0.03);
}
function exactGrid(a: MixAnalysis): void {
  for (const c of [...a.mixIn, ...a.mixOut]) {
    assert.ok(a.structure.downbeatFrames.includes(c.frame));
    assert.ok(c.frame >= 0 && c.frame < a.frames);
    if (c.evidence) {
      const i = a.cueFeatures!.findIndex(b => b.frame === c.frame);
      assert.equal(c.evidence.windowEndFrame, a.cueFeatures![i + 3]!.endFrame);
      assert.ok(c.evidence.windowEndFrame <= a.frames);
      assert.ok(c.evidence.salience >= 0 && c.evidence.salience <= 1);
    }
  }
}

for (const intro of [8, 16]) test('measured ' + intro + '-bar intro boundary outranks a weak change', () => {
  const a = analyzeMixAudio(structured(bar => bar < 4 ? 0.28 : bar < intro ? 0.32 : 1));
  exactGrid(a);
  const strong = atBar(a, intro);
  assert.ok(strong?.evidence && strong.evidence.kind === 'boundary',
    JSON.stringify(a.mixIn.map(c => [c.seconds, c.evidence])));
  const weak = atBar(a, 4);
  assert.ok(strong.evidence.boundary > (weak?.evidence?.boundary ?? 0) + 0.1);
  assert.ok(strong.score > (weak?.score ?? 0));
  assert.ok(a.mixIn.indexOf(strong) < (weak ? a.mixIn.indexOf(weak) : Infinity));
});

test('no-intro entry is supported without inventing a preceding section', () => {
  const a = analyzeMixAudio(structured(() => 1));
  exactGrid(a);
  assert.ok(a.mixIn.some(c => c.evidence?.kind === 'track-start'));
  assert.ok(a.mixIn.every(c => c.evidence!.boundary < 0.08));
  assert.deepEqual(a.mixOut, [], 'constant sections do not invent exit boundaries');
});

test('drop and breakdown yield asymmetric candidates and relative energy valleys', () => {
  const a = analyzeMixAudio(structured(bar => bar < 8 ? 0.3 : bar < 20 ? 1 : bar < 28 ? 0.22 : 0.9));
  exactGrid(a);
  assert.ok(atBar(a, 8)?.evidence?.kind === 'boundary');
  assert.ok(a.mixOut.some(c => Math.abs(c.seconds - 40) < 0.03 && c.evidence!.boundary > 0.08));
  assert.ok(a.mixOut.some(c => c.evidence?.kind === 'low-interference'));
  assert.notDeepEqual(a.mixIn.map(c => c.frame), a.mixOut.map(c => c.frame));
  assert.ok(a.mixIn.every(c => c.frame < a.frames * 0.6));
  assert.ok(a.mixOut.every(c => c.frame >= a.frames * 0.25 && c.frame < a.frames * 0.9));
});

test('chroma and spectral flux are measured locally, even at similar energy', () => {
  const a = analyzeMixAudio(structured(() => 1, 40, 1, bar => bar < 16 ? 220 : 293.6648));
  const before = a.cueFeatures!.find(b => Math.abs(b.frame / a.sampleRate - 28) < 0.03)!;
  const after = a.cueFeatures!.find(b => Math.abs(b.frame / a.sampleRate - 36) < 0.03)!;
  assert.ok(before && after && before.midFlux > 0 && before.highFlux > 0 && before.lowOnsets > 0);
  assert.ok(before.chroma.reduce((sum, x, i) => sum + Math.abs(x - after.chroma[i]!), 0) > 0.5);
  assert.ok(atBar(a, 16)?.evidence?.boundary! > 0.08);
});

test('incoming four-bar salience is normalized per track and uses complete source windows', () => {
  const levels = (bar: number) => bar < 8 ? 0.3 : bar < 24 ? 1 : 0.25;
  const a = analyzeMixAudio(structured(levels)), quiet = analyzeMixAudio(structured(levels, 40, 0.1));
  const first = atBar(a, 8)!, scaled = atBar(quiet, 8)!;
  assert.ok(first?.evidence && scaled?.evidence);
  assert.ok(Math.abs(first.evidence.salience - scaled.evidence.salience) < 1e-6);
  exactGrid(a); exactGrid(quiet);
  // Remove one source interval. A partial or discontinuous lookahead cannot qualify.
  const index = a.cueFeatures!.findIndex(b => b.frame === first.frame);
  const broken = {...a, cueFeatures: a.cueFeatures!.filter((_, i) => i !== index + 2)};
  assert.ok(findIncomingCues(broken).every(c => c.frame !== first.frame));
  const truncated = {...a, cueFeatures: a.cueFeatures!.slice(0, index + 3)};
  // Long-form measurement does not become a short-fixture fallback after filtering.
  assert.ok(findIncomingCues(truncated).every(c => c.frame !== first.frame));
});

test('supplied vocal spans exclude inside cues, include the end, and are never detected', () => {
  const pcm = structured(bar => bar < 16 ? 0.3 : 1);
  const baseline = analyzeMixAudio(pcm), cue = atBar(baseline, 16)!;
  assert.ok(cue);
  const spans = [{startFrame: cue.frame, endFrame: cue.frame + pcm.sampleRate}];
  const marked = analyzeMixAudio(pcm, {vocalSpans: spans});
  assert.ok([...marked.mixIn, ...marked.mixOut].every(c =>
    c.frame < spans[0]!.startFrame || c.frame >= spans[0]!.endFrame));
  assert.ok(!marked.mixIn.some(c => c.frame === cue.frame));
  const endsAtCue = analyzeMixAudio(pcm, {vocalSpans: [{startFrame: cue.frame - 100, endFrame: cue.frame}]});
  assert.ok(endsAtCue.mixIn.some(c => c.frame === cue.frame));
  assert.throws(() => analyzeMixAudio(pcm, {vocalSpans: [{startFrame: 5, endFrame: 4}]}), /vocal spans/);
});

test('deterministic structural analysis and weak evidence retain authored fallback', () => {
  const pcm = structured(bar => bar < 16 ? 0.3 : 1);
  const a = analyzeMixAudio(pcm);
  assert.deepEqual(analyzeMixAudio(pcm), a);
  assert.deepEqual(findIncomingCues(a), a.mixIn);
  assert.deepEqual(findOutgoingCues(a), a.mixOut);
  const weak = {...a, tempo: {...a.tempo, confidence: 0.1},
    structure: {...a.structure, downbeatConfidence: 0.1, phraseConfidence: 0.05}};
  assert.ok(findIncomingCues(weak).every(c => c.confidence <= 0.1));
  assert.equal(planAutomaticMix(weak, a).kind, 'fallback');
});

test('joint ranking selects compatible local windows rather than independent top cues', () => {
  const a = analyzeMixAudio(makeMixFixture()), b = analyzeMixAudio(makeMixFixture({bpm: 124}));
  const evidence = (interference: number, pc: number) => ({kind: 'boundary' as const,
    boundary: 0.8, period: 0.6, salience: 0.8, windowEndFrame: Math.min(a.frames, b.frames),
    interference, chroma: Array.from({length: 12}, (_, i) => i === pc ? 1 : 0)});
  const out = {...a.mixOut[0]!, score: 0.9, evidence: evidence(0.25, 9)};
  const bad = {...b.mixIn[0]!, score: 0.95, evidence: evidence(1, 2)};
  const good = {...b.mixIn[1]!, score: 0.9, evidence: evidence(0.25, 9)};
  const decision = planAutomaticMix({...a, mixOut: [out]}, {...b, mixIn: [bad, good]});
  assert.equal(decision.kind, 'mix');
  if (decision.kind === 'mix') assert.equal(decision.toEntryFrame, good.frame);
});

test('prepared replan retains frozen B entry and processed mapping with feature-backed cues', () => {
  const base = analyzeMixAudio(makeMixFixture());
  const long = analyzeMixAudio(structured(bar => bar < 8 ? 0.3 : bar < 20 ? 1 : bar < 28 ? 0.22 : 0.9));
  // Isolate cue routing with the already-qualified baseline timing/key evidence.
  const from = {...base, frames: long.frames, energyCurve: long.energyCurve, cueFeatures: long.cueFeatures!,
    mixOut: long.mixOut.map(c => ({...c, confidence: 0.9}))};
  const to = {...base, frames: long.frames, energyCurve: long.energyCurve, cueFeatures: long.cueFeatures!,
    mixIn: long.mixIn.map(c => ({...c, confidence: 0.9}))};
  const earliest = [...from.mixOut].sort((a, b) => a.frame - b.frame)[0]!;
  const plan = planAutomaticMix({...from, mixOut: [earliest]}, to, {returnToOriginalTempo: true});
  assert.equal(plan.kind, 'mix');
  if (plan.kind !== 'mix') return;
  const ready = {kind: 'ready', plan, analysis: {from, to},
    processed: {mapping: {sentinel: 'unchanged'}}, entryFrame: 123} as unknown as ReadyMixTransition;
  const before = structuredClone(ready);
  const later = from.mixOut.filter(c => c.frame > plan.fromExitFrame).sort((a, b) => a.frame - b.frame)[0];
  assert.ok(later, 'fixture must offer a later A cue');
  const replanned = replanPreparedMix(ready, later.frame);
  assert.equal(replanned.kind, 'mix');
  if (replanned.kind === 'mix') {
    assert.ok(replanned.fromExitFrame >= later.frame);
    assert.equal(replanned.toEntryFrame, plan.toEntryFrame);
    assert.equal(replanned.tempoRatio, plan.tempoRatio);
    assert.equal(replanned.pitchSemitones, plan.pitchSemitones);
    assert.equal(replanned.overlapFrames, plan.overlapFrames);
    assert.equal(replanned.returnToOriginalTempo, true);
  }
  assert.deepEqual(ready, before);
  assert.equal(planAutomaticMix(from, {...to, mixIn: []}).kind, 'fallback');
});

for (const period of [4, 8, 16]) test(period + '-bar recurrent changes earn confidence-weighted period support', () => {
  const a = analyzeMixAudio(structured(bar => Math.floor(bar / period) % 2 ? 1 : 0.3, 64));
  const cue = atBar(a, 16)!;
  assert.ok(cue?.evidence && cue.evidence.period > 0.2);
  const weak = {...a, structure: {...a.structure, downbeatConfidence: 0.1}};
  const alternative = findIncomingCues(weak).find(c => c.frame === cue.frame)!;
  assert.ok(alternative?.evidence && alternative.evidence.period < cue.evidence.period);
  assert.ok(alternative.confidence <= 0.1);
});

test('an odd-length measured boundary is eligible without hard phrase-period gating', () => {
  const a = analyzeMixAudio(structured(bar => bar < 9 ? 0.3 : 1));
  assert.ok(atBar(a, 9)?.evidence?.kind === 'boundary');
});

test('planner honors supplied spans and refuses malformed new cue evidence', () => {
  const a = analyzeMixAudio(makeMixFixture()), b = analyzeMixAudio(makeMixFixture({bpm: 124}));
  const out = a.mixOut[0]!, into = b.mixIn[0]!;
  const from = {...a, mixOut: [out]}, to = {...b, mixIn: [into]};
  assert.equal(planAutomaticMix(from, to).kind, 'mix');
  const span = (frame: number) => [{startFrame: frame, endFrame: frame + 1}];
  assert.equal(planAutomaticMix({...from, vocalSpans: span(out.frame)}, to).kind, 'fallback');
  assert.equal(planAutomaticMix(from, {...to, vocalSpans: span(into.frame)}).kind, 'fallback');
  const evidence = {kind: 'boundary' as const, boundary: 0.9, period: 0.7, salience: 0.8,
    interference: 0.4, windowEndFrame: into.frame + 1, chroma: [NaN]};
  assert.equal(planAutomaticMix(from, {...to, mixIn: [{...into, evidence}]}).kind, 'fallback');
});
