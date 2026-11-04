import assert from 'node:assert/strict';
import test from 'node:test';
import type { AudioClock, ClockStamp, PlayableSource, SourceExit, SourceStart } from '../src/playable-source.js';

/** Audio-free conformance example: S02 must provide and test actual renderers. */
class SourceDouble implements PlayableSource {
  readonly reference = { id: 'fixture-source', revision: 1 };
  private phase: 'new' | 'prepared' | 'scheduled' | 'ended' | 'released' = 'new';
  clock: AudioClock | null = null;
  private generation = -1;
  private startFrame = 0;
  constructor(readonly kind: 'recorded' | 'procedural') {}
  async prepare(clock: AudioClock): Promise<void> {
    assert.equal(this.phase, 'new', 'prepare once');
    assert.ok(Number.isSafeInteger(clock.sampleRate) && clock.sampleRate > 0);
    assert.ok(Number.isSafeInteger(clock.currentFrame) && clock.currentFrame >= 0);
    assert.ok(Number.isSafeInteger(clock.engineGeneration) && clock.engineGeneration >= 0);
    this.clock = clock;
    this.generation = clock.engineGeneration;
    this.phase = 'prepared';
  }
  scheduleStart(start: SourceStart): void {
    assert.equal(this.phase, 'prepared', 'prepare before start; start once');
    this.check(start.at);
    assert.equal(start.entryCueId, 'entry-0', 'valid entry cue');
    this.startFrame = start.at.frame;
    this.phase = 'scheduled';
  }
  getValidExits(): readonly SourceExit[] {
    assert.ok(this.phase === 'prepared' || this.phase === 'scheduled', 'source must be ready');
    this.checkGeneration();
    return [{ cueId: 'exit-1', offsetFrames: 48000 }];
  }
  stop(at: ClockStamp): void {
    assert.equal(this.phase, 'scheduled', 'start before stop');
    this.check(at);
    assert.ok(at.frame >= this.startFrame, 'stop follows start');
    this.phase = 'ended';
  }
  transitionOut(exitCueId: string, at: ClockStamp): void {
    assert.equal(this.phase, 'scheduled', 'start before transition');
    this.check(at);
    assert.equal(exitCueId, 'exit-1', 'valid exit cue');
    assert.equal(at.frame, this.startFrame + 48000, 'exit aligns to source-relative cue');
    this.phase = 'ended';
  }
  release(): void {
    assert.notEqual(this.phase, 'new', 'prepare before release');
    // Cleanup remains legal after an engine restart and is idempotent.
    this.phase = 'released';
    this.clock = null;
  }
  private checkGeneration(): void {
    assert.equal(this.clock?.engineGeneration, this.generation, 'stale-generation');
  }
  private check(at: ClockStamp): void {
    this.checkGeneration();
    assert.equal(at.engineGeneration, this.generation, 'stale-generation');
    assert.ok(Number.isSafeInteger(at.frame) && at.frame >= this.clock!.currentFrame, 'valid future frame');
  }
}
const stamp = (frame: number, engineGeneration = 7): ClockStamp => ({ frame, engineGeneration });

for (const kind of ['recorded', 'procedural'] as const) {
  test(`${kind}: common prepare/start/exit/release lifecycle`, async () => {
    const clock = { engineGeneration: 7, sampleRate: 48000, currentFrame: 100 };
    const source: PlayableSource = new SourceDouble(kind);
    await source.prepare(clock);
    assert.deepEqual(source.getValidExits(), [{ cueId: 'exit-1', offsetFrames: 48000 }]);
    source.scheduleStart({ at: stamp(1000), entryCueId: 'entry-0' });
    assert.throws(() => source.transitionOut('missing', stamp(49000)), /valid exit cue/);
    assert.throws(() => source.transitionOut('exit-1', stamp(48000)), /exit aligns/);
    source.transitionOut('exit-1', stamp(49000));
    assert.throws(() => source.stop(stamp(50000)), /start before stop/);
    source.release();
    source.release();
  });
  test(`${kind}: invalid order, stale generation and late scheduling are rejected`, async () => {
    const clock = { engineGeneration: 7, sampleRate: 48000, currentFrame: 100 };
    const source = new SourceDouble(kind);
    assert.throws(() => source.scheduleStart({ at: stamp(1000), entryCueId: 'entry-0' }), /prepare before/);
    await source.prepare(clock);
    assert.equal(source.clock, clock, 'retains caller-owned clock, never a copy');
    await assert.rejects(source.prepare(clock), /prepare once/);
    assert.throws(() => source.scheduleStart({ at: stamp(99), entryCueId: 'entry-0' }), /future frame/);
    assert.throws(() => source.scheduleStart({ at: stamp(1000, 6), entryCueId: 'entry-0' }), /stale-generation/);
    source.scheduleStart({ at: stamp(1000), entryCueId: 'entry-0' });
    assert.throws(() => source.scheduleStart({ at: stamp(2000), entryCueId: 'entry-0' }), /start once/);
    clock.engineGeneration = 8;
    assert.throws(() => source.stop(stamp(2000)), /stale-generation/);
    assert.throws(() => source.getValidExits(), /stale-generation/);
    source.release();
    assert.equal(source.clock, null);
    assert.throws(() => source.scheduleStart({ at: stamp(2000, 8), entryCueId: 'entry-0' }), /prepare before/);
  });
}

test('recorded and procedural sources share one clock; stop and cancellation release resources', async () => {
  const clock = { engineGeneration: 7, sampleRate: 48000, currentFrame: 0 };
  const recorded = new SourceDouble('recorded');
  const procedural = new SourceDouble('procedural');
  await Promise.all([recorded.prepare(clock), procedural.prepare(clock)]);
  assert.equal(recorded.clock, procedural.clock);
  recorded.scheduleStart({ at: stamp(1000), entryCueId: 'entry-0' });
  recorded.stop(stamp(2000));
  recorded.release();
  procedural.release();
  assert.equal(recorded.clock, null);
  assert.equal(procedural.clock, null);
});


test('release cancels a scheduled source before its future start', async () => {
  const source = new SourceDouble('recorded');
  await source.prepare({ engineGeneration: 7, sampleRate: 48000, currentFrame: 0 });
  source.scheduleStart({ at: stamp(48000), entryCueId: 'entry-0' });
  source.release();
  assert.equal(source.clock, null);
  assert.throws(() => source.stop(stamp(50000)), /start before stop/);
  assert.throws(() => source.getValidExits(), /source must be ready/);
});
