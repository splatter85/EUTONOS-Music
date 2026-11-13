import {decodeRecordings, type LoadedBrowserPack} from './browser-pack.js';
import {quartersToFrames} from './pack.js';
import type {ClockStamp, SourceStart} from './playable-source.js';
import type {VersionRef} from './pack-types.js';
import {commitHybridHandoff, planHybridHandoff, type HybridBridge, type HybridBridgeExit,
  type HybridHandoffPlan} from './hybrid-handoff.js';
import type {ProceduralPlan} from './phrase-plan.js';
import {checkProceduralPlan, decodeProceduralSamples, ProceduralSource} from './procedural-source.js';
import {checkedRoute, planTransition, RecordedSource, requireAudio, WebAudioClock,
  cueFrame, type CheckedRoute, type DecodedRecording} from './web-audio.js';
import type {MixPlannerOptions} from './mix-planner.js';
import {browserMixPreparation, prepareMixTransition, replanPreparedMix, type MixPreparationRuntime} from './mix-transition.js';

export type PlayerState = 'idle' | 'loading' | 'scheduled' | 'playing' | 'paused' | 'ended' | 'closed';
/** S05 diagnostics. The phase comes from the audio clock, not from measured device output. */
export interface HybridSnapshot {
  readonly policy: VersionRef;
  readonly bridge: HybridBridge;
  readonly phase: 'scheduled' | 'lead-in' | 'bridge' | 'tail' | 'complete';
  readonly fromExit: ClockStamp;
  readonly bridgeFull: ClockStamp;
  readonly toStart: ClockStamp;
  readonly end: ClockStamp;
}
export interface MixSnapshot {
  readonly phase: 'preparing' | 'scheduled' | 'mixing' | 'complete' | 'fallback' | 'unavailable';
  readonly reason: string;
  readonly summary: null | {
    readonly fromBpm: number; readonly toBpm: number; readonly tempoRatio: number;
    readonly pitchSemitones: number; readonly confidence: number; readonly processor: string;
    readonly fromExitFrame: number; readonly toEntryFrame: number; readonly processedEntryFrame: number;
    readonly outputFrames: number; readonly returnToOriginalTempo: boolean;
    readonly fromHash: string; readonly toHash: string;
  };
}
export interface PlayerSnapshot {
  readonly state: PlayerState;
  readonly requested: string | null;
  readonly now: readonly string[];
  readonly next: string | null;
  readonly transition: 'none' | 'scheduled' | 'mixing' | 'complete';
  readonly transitionInSeconds: number | null;
  readonly voices: readonly {readonly source: VersionRef; readonly start: ClockStamp; readonly endFrame: number}[];
  readonly transitionAt: ClockStamp | null;
  readonly transitionEnd: ClockStamp | null;
  readonly handoff: HybridSnapshot | null;
  readonly mix: MixSnapshot | null;
  readonly elapsedSeconds: number;
  readonly durationSeconds: number;
  readonly currentFrame: number;
  readonly sampleRate: number;
  readonly engineGeneration: number;
  readonly contextState: string;
  readonly muted: boolean;
  readonly volume: number;
}

interface Voice { source: RecordedSource | ProceduralSource; start: SourceStart; }
type Selection = 'a' | 'b' | ProceduralPlan;

/** Thin A/B transport owner. S03 supplies the DJ/control-contract integration. */
export class SmallPlayer {
  readonly clock: WebAudioClock;
  readonly pair: CheckedRoute;
  private readonly output: GainNode;
  private decoded: Promise<DecodedRecording[]> | null = null;
  private decodedPalette: Promise<DecodedRecording[]> | null = null;
  private paletteBinding: string | null = null;
  private voices: Voice[] = [];
  /** The committed transition window: direct crossfade or hybrid handoff. */
  private plan: {readonly at: ClockStamp; readonly end: ClockStamp} | null = null;
  private hybrid: HybridHandoffPlan | null = null;
  private mix: MixSnapshot | null = null;
  private mixAbort: AbortController | null = null;
  private state: PlayerState = 'idle';
  private operation = 0;
  private transitionOperation = 0;
  private wantsRunning = false;
  private selected: Selection | null = null;
  private volume = 0.65;
  private muted = false;
  private readonly stateChanged = () => this.onContextState();

  constructor(readonly context: AudioContext, private readonly loaded: LoadedBrowserPack,
    routeId: string, private readonly mixRuntime: MixPreparationRuntime = browserMixPreparation) {
    this.pair = checkedRoute(loaded.pack, routeId, loaded.allowFixtures);
    this.clock = new WebAudioClock(context);
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(context.destination);
    context.addEventListener('statechange', this.stateChanged);
  }

  /** Call directly from a user gesture: resume is issued before the first await. */
  play(selection: 'a' | 'b', ownership: Promise<void> = Promise.resolve()): Promise<void> {
    return this.playSelection(selection, ownership);
  }

  /** S04 source audition through this same transport. S05 bridges use scheduleHybrid. */
  playProcedural(plan: ProceduralPlan, ownership: Promise<void> = Promise.resolve()): Promise<void> {
    return this.playSelection(plan, ownership);
  }

  private async playSelection(selection: Selection, ownership: Promise<void>): Promise<void> {
    requireAudio(this.state !== 'closed' && this.context.state !== 'closed', 'Player is closed. Reload the page.');
    this.cancelVoices();
    const operation = ++this.operation;
    this.selected = selection;
    this.state = 'loading';
    this.wantsRunning = true;
    this.setOutput(false);
    try {
      const readiness = Promise.all([this.context.resume(), ownership]);
      // A synchronous plan refusal must still observe late resume/ownership failures.
      void readiness.catch(() => undefined);
      let decoding: Promise<DecodedRecording[]>;
      if (typeof selection === 'object') {
        checkProceduralPlan(this.loaded, selection);
        const binding = JSON.stringify(selection.samples);
        requireAudio(this.paletteBinding === null || this.paletteBinding === binding,
          'The sampler palette changed. Reload before preparing a different palette.');
        this.paletteBinding = binding;
        this.decodedPalette ??= decodeProceduralSamples(this.loaded, this.context, selection).catch(error => {
          this.decodedPalette = null;
          throw error;
        });
        decoding = this.decodedPalette;
      } else {
        this.decoded ??= decodeRecordings(this.loaded, this.context).catch(error => {
          this.decoded = null;
          throw error;
        });
        decoding = this.decoded;
      }
      const [recordings] = await Promise.all([decoding, readiness]);
      if (operation !== this.operation) return;
      requireAudio(this.context.state === 'running' && this.wantsRunning, 'Audio could not start. Press Play again.');
      let source: RecordedSource | ProceduralSource;
      let entryCueId: string;
      if (typeof selection === 'object') {
        source = new ProceduralSource(this.context, selection, recordings, this.output,
          {allowFixtures: this.loaded.allowFixtures});
        entryCueId = 'entry';
      } else {
        const asset = selection === 'a' ? this.pair.from : this.pair.to;
        const recording = recordings.find(r => r.asset.id === asset.id && r.asset.revision === asset.revision);
        requireAudio(recording, 'The requested recording is not prepared.');
        const fadeOutFrames = quartersToFrames(this.pair.route.overlap_quarters, this.pair.from.timing!.bpm, this.clock.sampleRate);
        source = new RecordedSource(this.context, recording, this.output,
          {allowFixtures: this.loaded.allowFixtures, fadeOutFrames});
        const entry = asset.cues.find(c => c.kind === 'entry');
        requireAudio(entry, 'Recording has no entry cue.');
        entryCueId = entry.id;
      }
      await source.prepare(this.clock);
      if (operation !== this.operation) { source.release(); return; }
      const start: SourceStart = {at: this.clock.stamp(this.clock.currentFrame + this.leadFrames), entryCueId};
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
    const transitionOperation = this.transitionOperation;
    // Check before preparation, then check again immediately before committing.
    planTransition(this.loaded.pack, this.pair.route.id, from.start, this.clock, this.loaded.allowFixtures, this.leadFrames);
    const recordings = await this.decoded!;
    if (operation !== this.operation || transitionOperation !== this.transitionOperation) return;
    const recording = recordings.find(r => r.asset.id === this.pair.to.id && r.asset.revision === this.pair.to.revision)!;
    const overlapFrames = quartersToFrames(this.pair.route.overlap_quarters, this.pair.from.timing!.bpm, this.clock.sampleRate);
    const incoming = new RecordedSource(this.context, recording, this.output,
      {allowFixtures: this.loaded.allowFixtures, fadeInFrames: overlapFrames});
    await incoming.prepare(this.clock);
    if (operation !== this.operation || transitionOperation !== this.transitionOperation) { incoming.release(); return; }
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

  /**
   * S05: A → procedural bridge → B on the same clock and output. Everything is checked,
   * prepared and committed in absolute frames before A's exit; nothing starts later by timer.
   */
  async scheduleHybrid(bridge: ProceduralPlan, exit: HybridBridgeExit = 'phrase'): Promise<void> {
    requireAudio(this.selected === 'a' && this.voices.length === 1 && !this.plan,
      'Play A first. Only one A → B transition can be scheduled.');
    const from = this.voices[0]!;
    requireAudio(from.source instanceof RecordedSource, 'A hybrid handoff starts from recording A.');
    const outgoing = from.source;
    const operation = this.operation;
    const transitionOperation = this.transitionOperation;
    // Check before preparation, then check again immediately before committing.
    checkProceduralPlan(this.loaded, bridge);
    const checked = planHybridHandoff(this.loaded.pack, this.pair.route.id, bridge, exit, from.start, this.clock,
      this.loaded.allowFixtures, this.leadFrames);
    const binding = JSON.stringify(bridge.samples);
    requireAudio(this.paletteBinding === null || this.paletteBinding === binding,
      'The sampler palette changed. Reload before preparing a different palette.');
    this.paletteBinding = binding;
    this.decodedPalette ??= decodeProceduralSamples(this.loaded, this.context, bridge).catch(error => {
      this.decodedPalette = null;
      throw error;
    });
    const [recordings, samples] = await Promise.all([this.decoded!, this.decodedPalette]);
    if (operation !== this.operation || transitionOperation !== this.transitionOperation) return;
    const recording = recordings.find(r => r.asset.id === this.pair.to.id && r.asset.revision === this.pair.to.revision)!;
    const bridgeSource = new ProceduralSource(this.context, bridge, samples, this.output,
      {allowFixtures: this.loaded.allowFixtures, leadIn: checked.leadIn});
    const incoming = new RecordedSource(this.context, recording, this.output, {allowFixtures: this.loaded.allowFixtures});
    const releaseBoth = (): void => { bridgeSource.release(); incoming.release(); };
    try { await Promise.all([bridgeSource.prepare(this.clock), incoming.prepare(this.clock)]); }
    catch (error) { releaseBoth(); throw error; }
    if (operation !== this.operation || transitionOperation !== this.transitionOperation) { releaseBoth(); return; }
    if (this.plan) { releaseBoth(); throw new Error('The A → B transition is already scheduled.'); }
    try {
      // A late commit is refused, never shifted to a later boundary.
      const plan = planHybridHandoff(this.loaded.pack, this.pair.route.id, bridge, exit, from.start, this.clock,
        this.loaded.allowFixtures, this.leadFrames);
      commitHybridHandoff(plan, outgoing, bridgeSource, incoming);
      this.voices.push({source: bridgeSource, start: {at: plan.fromExit, entryCueId: 'entry'}},
        {source: incoming, start: {at: plan.toStart, entryCueId: plan.route.entry_cue}});
      this.plan = {at: plan.fromExit, end: plan.end};
      this.hybrid = plan;
    } catch (error) {
      // The commit changes A last, so a refusal leaves the unchanged A playing.
      releaseBoth();
      throw error;
    }
  }

  /** Opt-in analysis/preparation. No source is offered or scheduled before B is ready. */
  async scheduleMix(options: MixPlannerOptions = {}): Promise<void> {
    requireAudio(this.selected === 'a' && this.voices.length === 1 && !this.plan,
      'Play A first. Only one A -> B transition can be scheduled.');
    const from = this.voices[0]!;
    requireAudio(from.source instanceof RecordedSource, 'A mix starts from recording A.');
    const outgoing = from.source, operation = this.operation, transitionOperation = this.transitionOperation;
    const controller = new AbortController();
    this.mixAbort?.abort(); this.mixAbort = controller;
    this.mix = {phase: 'preparing', reason: 'Analyzing and preparing B; no transition is scheduled.', summary: null};
    const current = () => operation === this.operation && transitionOperation === this.transitionOperation &&
      !controller.signal.aborted && this.selected === 'a' && this.voices[0] === from;
    let incoming: RecordedSource | null = null;
    const useAuthoredFallback = async (reason: string): Promise<void> => {
      if (!current()) return;
      this.mix = {phase: 'fallback', reason: `Authored crossfade: ${reason}`, summary: null};
      try {
        await this.scheduleAB();
        if (current() && !this.plan) this.mix = null;
      } catch (error) {
        if (current()) this.mix = {phase: 'unavailable', summary: null,
          reason: `${reason} Authored fallback unavailable: ${error instanceof Error ? error.message : String(error)}`};
        // An unavailable mix is a reported outcome; A and the DJ's queued intent remain intact.
      }
    };
    try {
      const recordings = await this.decoded!;
      if (!current()) return;
      const to = recordings.find(r => r.asset.id === this.pair.to.id && r.asset.revision === this.pair.to.revision);
      requireAudio(to, 'The incoming recording is not decoded.');
      const entry = cueFrame(this.pair.from, from.start.entryCueId, 'entry', this.clock.sampleRate);
      requireAudio(options.minimumFromFrame === undefined || Number.isSafeInteger(options.minimumFromFrame) &&
        options.minimumFromFrame >= 0, 'Invalid requested minimum mix frame.');
      // A bounded two-second preparation allowance is an engineering policy, not a latency promise.
      const earliest = Math.max(entry, this.clock.currentFrame - from.start.at.frame + entry +
        this.leadFrames + 2 * this.clock.sampleRate, options.minimumFromFrame ?? 0);
      const ready = await prepareMixTransition(this.context, outgoing.recording, to,
        {...options, minimumFromFrame: earliest}, controller.signal, this.mixRuntime);
      if (!current()) return;
      if (ready.kind === 'fallback') { await useAuthoredFallback(ready.reason); return; }
      incoming = new RecordedSource(this.context, ready.incoming, this.output,
        {allowFixtures: this.loaded.allowFixtures});
      await incoming.prepare(this.clock);
      if (!current()) { incoming.release(); incoming = null; return; }
      requireAudio(!this.plan, 'A transition already owns the next boundary.');
      let plan = ready.plan;
      let at = this.clock.stamp(from.start.at.frame + plan.fromExitFrame - entry);
      if (at.frame < this.clock.currentFrame + this.leadFrames) {
        const later = replanPreparedMix(ready, Math.max(earliest,
          this.clock.currentFrame + this.leadFrames - from.start.at.frame + entry));
        requireAudio(later.kind === 'mix',
          'Prepared mix missed its exact audio-clock deadline; no later analyzed cue is available.');
        plan = later;
        at = this.clock.stamp(from.start.at.frame + plan.fromExitFrame - entry);
      }
      requireAudio(at.frame >= this.clock.currentFrame + this.leadFrames,
        'Prepared mix missed its exact audio-clock deadline.');
      const end = this.clock.stamp(at.frame + plan.overlapFrames);
      incoming.scheduleMixStart(at, ready.entryFrame, plan.automation.incoming);
      // Outgoing A changes last. A refusal releases all prepared B effects before fallback.
      outgoing.transitionMixOut(at, plan.fromExitFrame, plan.automation.outgoing);
      this.voices.push({source: incoming, start: {at, entryCueId: 'mix-entry'}});
      this.plan = {at, end};
      this.mix = {phase: 'scheduled', reason: 'Processed B is ready; the analyzed mix is scheduled on the owner clock.',
        summary: {fromBpm: plan.fromBpm, toBpm: plan.toBpm, tempoRatio: plan.tempoRatio,
          pitchSemitones: plan.pitchSemitones, confidence: plan.confidence,
          processor: ready.processed.processor, fromExitFrame: plan.fromExitFrame,
          toEntryFrame: plan.toEntryFrame, processedEntryFrame: ready.entryFrame,
          outputFrames: ready.incoming.buffer.length, returnToOriginalTempo: plan.returnToOriginalTempo,
          fromHash: this.pair.from.file.sha256, toHash: this.pair.to.file.sha256}};
      incoming = null; // ownership transferred to this.voices
    } catch (error) {
      incoming?.release(); incoming = null;
      if (current() && !this.plan && this.mix?.phase !== 'unavailable') {
        await useAuthoredFallback(error instanceof Error ? error.message : String(error));
      } else if (current()) throw error;
    } finally {
      if (this.mixAbort === controller) this.mixAbort = null;
    }
  }

  /** Invalidate only an in-flight transition preparation; retain committed audio. */
  cancelTransitionPreparation(): void { ++this.transitionOperation; this.abortMixPreparation(); }

  /** Cancel preparation or a future A → B, without changing playback ownership. */
  cancelPendingTransition(): boolean {
    if (this.plan && this.clock.currentFrame >= this.plan.at.frame) return false;
    if (this.plan && !this.voices[0]!.source.cancelTransition()) return false;
    ++this.transitionOperation;
    this.abortMixPreparation();
    if (this.plan) {
      for (const voice of this.voices.slice(1)) voice.source.release();
      this.voices = this.voices.slice(0, 1);
      this.plan = null;
      this.hybrid = null;
      this.mix = null;
    }
    return true;
  }

  async pause(): Promise<void> {
    if (this.state === 'closed') return;
    ++this.operation; // invalidates an in-flight decode/start or transition preparation
    this.abortMixPreparation();
    this.wantsRunning = false;
    this.state = this.selected ? 'paused' : 'idle';
    this.setOutput(false); // listener control is immediate, never cue-quantized
    if (this.context.state !== 'closed') await this.context.suspend();
  }

  async resume(ownership: Promise<void> = Promise.resolve()): Promise<void> {
    requireAudio(this.state !== 'closed', 'Player is closed. Reload the page.');
    if (!this.voices.length) { await this.playSelection(this.selected ?? 'a', ownership); return; }
    const operation = ++this.operation;
    this.abortMixPreparation();
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
      // A failed external ownership gate must not leave a silent timeline running.
      if (this.context.state !== 'closed') await this.context.suspend().catch(() => undefined);
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
    const hybrid = this.hybrid;
    const handoff: HybridSnapshot | null = hybrid ? {policy: {...hybrid.policy}, bridge: structuredClone(hybrid.bridge),
      phase: frame < hybrid.fromExit.frame ? 'scheduled' : frame < hybrid.bridgeFull.frame ? 'lead-in'
        : frame < hybrid.toStart.frame ? 'bridge' : frame < hybrid.end.frame ? 'tail' : 'complete',
      fromExit: {...hybrid.fromExit}, bridgeFull: {...hybrid.bridgeFull}, toStart: {...hybrid.toStart},
      end: {...hybrid.end}} : null;
    return {state: this.state, requested: this.selected === 'a' ? this.pair.from.id : this.selected === 'b' ? this.pair.to.id : this.selected?.recipe.id ?? null,
      now, next: pending?.source.reference.id ?? null, transition,
      transitionInSeconds: this.plan ? Math.max(0, (this.plan.at.frame - frame) / this.clock.sampleRate) : null,
      voices: this.voices.map(voice => ({source: {...voice.source.reference}, start: {...voice.start.at}, endFrame: voice.source.endFrame})),
      transitionAt: this.plan ? {...this.plan.at} : null,
      transitionEnd: this.plan ? {...this.plan.end} : null,
      handoff, mix: this.mix ? {...this.mix, phase: this.mix.summary && this.plan
        ? frame < this.plan.at.frame ? 'scheduled' : frame < this.plan.end.frame ? 'mixing' : 'complete'
        : this.mix.phase, summary: this.mix.summary ? {...this.mix.summary} : null} : null,
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
    this.decodedPalette = null;
    this.decoded = null;
    if (this.context.state !== 'closed') await this.context.close();
  }

  private get leadFrames(): number { return Math.ceil(0.1 * this.clock.sampleRate); }
  private cancelVoices(): void {
    ++this.transitionOperation;
    this.abortMixPreparation();
    for (const voice of this.voices) voice.source.release();
    this.voices = [];
    this.plan = null;
    this.hybrid = null;
    this.mix = null;
    this.clock.invalidate();
  }
  private setOutput(enabled: boolean): void {
    this.output.gain.setValueAtTime(enabled && !this.muted ? this.volume : 0, this.context.currentTime);
  }
  private abortMixPreparation(): void {
    this.mixAbort?.abort(); this.mixAbort = null;
    if (!this.plan) this.mix = null;
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
      this.abortMixPreparation();
      this.wantsRunning = false;
      this.state = 'paused';
      this.setOutput(false);
    }
  }
}
