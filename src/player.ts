import {decodeRecordings, type LoadedBrowserPack} from './browser-pack.js';
import {quartersToFrames} from './pack.js';
import type {SourceStart} from './playable-source.js';
import {checkedRoute, planTransition, RecordedSource, requireAudio, WebAudioClock,
  type CheckedRoute, type DecodedRecording, type TransitionPlan} from './web-audio.js';

export type PlayerState = 'idle' | 'loading' | 'scheduled' | 'playing' | 'paused' | 'ended' | 'closed';
export interface PlayerSnapshot {
  readonly state: PlayerState;
  readonly requested: string | null;
  readonly now: readonly string[];
  readonly next: string | null;
  readonly transition: 'none' | 'scheduled' | 'mixing' | 'complete';
  readonly transitionInSeconds: number | null;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly currentFrame: number;
  readonly sampleRate: number;
  readonly engineGeneration: number;
  readonly contextState: string;
  readonly muted: boolean;
  readonly volume: number;
}

interface Voice { source: RecordedSource; start: SourceStart; }

/** Thin A/B transport owner. S03 supplies the DJ/control-contract integration. */
export class SmallPlayer {
  readonly clock: WebAudioClock;
  readonly pair: CheckedRoute;
  private readonly output: GainNode;
  private decoded: Promise<DecodedRecording[]> | null = null;
  private voices: Voice[] = [];
  private plan: TransitionPlan | null = null;
  private state: PlayerState = 'idle';
  private operation = 0;
  private wantsRunning = false;
  private selected: 'a' | 'b' | null = null;
  private volume = 0.65;
  private muted = false;
  private readonly stateChanged = () => this.onContextState();

  constructor(readonly context: AudioContext, private readonly loaded: LoadedBrowserPack,
    routeId: string) {
    this.pair = checkedRoute(loaded.pack, routeId, loaded.allowFixtures);
    this.clock = new WebAudioClock(context);
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(context.destination);
    context.addEventListener('statechange', this.stateChanged);
  }

  /** Call directly from a user gesture: resume is issued before the first await. */
  async play(selection: 'a' | 'b', ownership: Promise<void> = Promise.resolve()): Promise<void> {
    requireAudio(this.state !== 'closed' && this.context.state !== 'closed', 'Player is closed. Reload the page.');
    this.cancelVoices();
    const operation = ++this.operation;
    this.selected = selection;
    this.state = 'loading';
    this.wantsRunning = true;
    this.setOutput(false);
    try {
      const resume = this.context.resume();
      this.decoded ??= decodeRecordings(this.loaded, this.context).catch(error => {
        this.decoded = null;
        throw error;
      });
      const [recordings] = await Promise.all([this.decoded, resume, ownership]);
      if (operation !== this.operation) return;
      requireAudio(this.context.state === 'running' && this.wantsRunning, 'Audio could not start. Press Play again.');
      const asset = selection === 'a' ? this.pair.from : this.pair.to;
      const recording = recordings.find(r => r.asset.id === asset.id && r.asset.revision === asset.revision);
      requireAudio(recording, 'The requested recording is not prepared.');
      const fadeOutFrames = quartersToFrames(this.pair.route.overlap_quarters, this.pair.from.timing!.bpm, this.clock.sampleRate);
      const source = new RecordedSource(this.context, recording, this.output,
        {allowFixtures: this.loaded.allowFixtures, fadeOutFrames});
      await source.prepare(this.clock);
      if (operation !== this.operation) { source.release(); return; }
      const entry = asset.cues.find(c => c.kind === 'entry');
      requireAudio(entry, 'Recording has no entry cue.');
      const start: SourceStart = {at: this.clock.stamp(this.clock.currentFrame + this.leadFrames), entryCueId: entry.id};
      try { source.scheduleStart(start); }
      catch (error) { source.release(); throw error; }
      this.voices = [{source, start}];
      this.state = 'scheduled';
      this.setOutput(true);
    } catch (error) {
      if (operation !== this.operation) return;
      this.stop();
      throw error;
    }
  }

  async scheduleAB(): Promise<void> {
    requireAudio(this.selected === 'a' && this.voices.length === 1 && !this.plan,
      'Play A first. Only one A → B transition can be scheduled.');
    const from = this.voices[0]!;
    const operation = this.operation;
    // Check before preparation, then check again immediately before committing.
    planTransition(this.loaded.pack, this.pair.route.id, from.start, this.clock, this.loaded.allowFixtures, this.leadFrames);
    const recordings = await this.decoded!;
    if (operation !== this.operation) return;
    const recording = recordings.find(r => r.asset.id === this.pair.to.id && r.asset.revision === this.pair.to.revision)!;
    const overlapFrames = quartersToFrames(this.pair.route.overlap_quarters, this.pair.from.timing!.bpm, this.clock.sampleRate);
    const incoming = new RecordedSource(this.context, recording, this.output,
      {allowFixtures: this.loaded.allowFixtures, fadeInFrames: overlapFrames});
    await incoming.prepare(this.clock);
    if (operation !== this.operation) { incoming.release(); return; }
    if (this.plan) { incoming.release(); throw new Error('The A → B transition is already scheduled.'); }
    try {
      const plan = planTransition(this.loaded.pack, this.pair.route.id, from.start, this.clock,
        this.loaded.allowFixtures, this.leadFrames);
      const start: SourceStart = {at: plan.at, entryCueId: plan.route.entry_cue};
      incoming.scheduleStart(start);
      // Both calls use absolute times on the same context; no callback starts B.
      from.source.transitionOut(plan.route.exit_cue, plan.at);
      this.voices.push({source: incoming, start});
      this.plan = plan;
    } catch (error) {
      incoming.release();
      // A failed late plan leaves the unchanged A playing. If A was altered,
      // its transitionOut succeeded and the nonthrowing assignments above finish.
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (this.state === 'closed') return;
    ++this.operation; // invalidates an in-flight decode/start or transition preparation
    this.wantsRunning = false;
    this.state = this.selected ? 'paused' : 'idle';
    this.setOutput(false); // listener control is immediate, never cue-quantized
    if (this.context.state !== 'closed') await this.context.suspend();
  }

  async resume(ownership: Promise<void> = Promise.resolve()): Promise<void> {
    requireAudio(this.state !== 'closed', 'Player is closed. Reload the page.');
    if (!this.voices.length) { await this.play(this.selected ?? 'a', ownership); return; }
    const operation = ++this.operation;
    this.wantsRunning = true;
    this.state = 'loading';
    try {
      await Promise.all([this.context.resume(), ownership]);
      if (operation !== this.operation) return;
      requireAudio(this.context.state === 'running', 'Audio is suspended. Press Resume again.');
      this.state = 'playing';
      this.setOutput(true);
    } catch (error) {
      if (operation !== this.operation) return;
      this.wantsRunning = false;
      this.state = 'paused';
      this.setOutput(false);
      throw error;
    }
  }

  stop(): void {
    if (this.state === 'closed') return;
    ++this.operation;
    this.wantsRunning = false;
    this.setOutput(false);
    this.cancelVoices();
    this.selected = null;
    this.state = 'idle';
    if (this.context.state !== 'closed') void this.context.suspend().catch(() => undefined);
  }

  setVolume(value: number): void {
    requireAudio(Number.isFinite(value) && value >= 0 && value <= 1, 'Volume must be between 0 and 1.');
    this.volume = value;
    this.setOutput(this.wantsRunning && this.context.state === 'running' && this.state !== 'loading');
  }
  setMuted(value: boolean): void {
    this.muted = value;
    this.setOutput(this.wantsRunning && this.context.state === 'running' && this.state !== 'loading');
  }

  snapshot(): PlayerSnapshot {
    const frame = this.clock.currentFrame;
    const first = this.voices[0];
    const last = this.voices.at(-1);
    if (first && this.state !== 'loading' && this.state !== 'closed') {
      if (frame >= last!.source.endFrame && this.state !== 'ended') {
        this.state = 'ended';
        this.wantsRunning = false;
        this.setOutput(false);
        if (this.context.state !== 'closed') void this.context.suspend().catch(() => undefined);
      } else if (this.wantsRunning && this.context.state === 'running') {
        this.state = frame < first.start.at.frame ? 'scheduled' : 'playing';
      }
    }
    const now = this.voices.filter(v => frame >= v.start.at.frame && frame < v.source.endFrame)
      .map(v => v.source.reference.id);
    const pending = this.voices.find(v => frame < v.start.at.frame);
    const transition = !this.plan ? 'none' : frame < this.plan.at.frame ? 'scheduled' :
      frame < this.plan.end.frame ? 'mixing' : 'complete';
    const duration = first && last ? (last.source.endFrame - first.start.at.frame) / this.clock.sampleRate : 0;
    return {state: this.state, requested: this.selected === 'a' ? this.pair.from.id : this.selected === 'b' ? this.pair.to.id : null,
      now, next: pending?.source.reference.id ?? null, transition,
      transitionInSeconds: this.plan ? Math.max(0, (this.plan.at.frame - frame) / this.clock.sampleRate) : null,
      elapsedSeconds: first ? Math.max(0, Math.min(duration, (frame - first.start.at.frame) / this.clock.sampleRate)) : 0,
      durationSeconds: duration, currentFrame: frame, sampleRate: this.clock.sampleRate,
      engineGeneration: this.clock.engineGeneration, contextState: this.context.state,
      muted: this.muted, volume: this.volume};
  }

  async dispose(): Promise<void> {
    if (this.state === 'closed') return;
    this.stop();
    this.state = 'closed';
    this.context.removeEventListener('statechange', this.stateChanged);
    this.output.disconnect();
    if (this.context.state !== 'closed') await this.context.close();
  }

  private get leadFrames(): number { return Math.ceil(0.1 * this.clock.sampleRate); }
  private cancelVoices(): void {
    for (const voice of this.voices) voice.source.release();
    this.voices = [];
    this.plan = null;
    this.clock.invalidate();
  }
  private setOutput(enabled: boolean): void {
    this.output.gain.setValueAtTime(enabled && !this.muted ? this.volume : 0, this.context.currentTime);
  }
  private onContextState(): void {
    if (this.state === 'closed') return;
    if (this.context.state === 'closed') {
      this.stop();
      this.state = 'closed';
      return;
    }
    if (!this.wantsRunning) {
      this.setOutput(false);
      if (this.context.state === 'running') void this.context.suspend().catch(() => undefined);
    } else if (this.state !== 'loading' && this.context.state !== 'running') {
      // OS/device interruption is a pause. Recovery requires a new user gesture.
      ++this.operation;
      this.wantsRunning = false;
      this.state = 'paused';
      this.setOutput(false);
    }
  }
}
