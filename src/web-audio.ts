import {eligibleForPlayback, quartersToFrames, validatePackManifest} from './pack.js';
import type {AudioAsset, AudioPack, CueRoute} from './pack-types.js';
import type {AudioClock, ClockStamp, PlayableSource, SourceExit, SourceStart} from './playable-source.js';
import {createMixAutomationGraph, validateMixAutomation, type MixAutomation, type MixAutomationGraph} from './mix-automation.js';
import {nativeRateInputAt, nativeRateOutputAt, validateNativeRate, type NativeRateRamp} from './time-pitch.js';

let nextGeneration = 1;

/** The context is the only time authority. No timers drive audio events. */
export class WebAudioClock implements AudioClock {
  private generation = nextGeneration++;
  constructor(readonly context: BaseAudioContext) {}
  get engineGeneration(): number { return this.generation; }
  get sampleRate(): number { return this.context.sampleRate; }
  get currentFrame(): number { return Math.ceil(this.context.currentTime * this.sampleRate); }
  invalidate(): void { this.generation = nextGeneration++; }
  stamp(frame: number): ClockStamp { return {engineGeneration: this.generation, frame}; }
}

export function requireAudio(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

/** Round in the file's domain first, then map to the single output clock. */
export function cueFrame(asset: AudioAsset, cueId: string, kind: 'entry' | 'exit', rate: number): number {
  const cue = asset.cues.find(c => c.id === cueId && c.kind === kind);
  requireAudio(asset.timing && cue, `Missing ${kind} cue: ${asset.id}/${cueId}`);
  const native = asset.timing.first_downbeat_frame +
    quartersToFrames(cue.position_quarters, asset.timing.bpm, asset.file.sample_rate);
  return Math.round(native * rate / asset.file.sample_rate);
}

export interface CheckedRoute {
  readonly route: CueRoute;
  readonly from: AudioAsset;
  readonly to: AudioAsset;
}

/** Recheck revisions, directed cues, tempo, overlap and harmony before planning. */
export function checkedRoute(pack: AudioPack, routeId: string, allowFixtures = false, allowUnreviewed = false): CheckedRoute {
  const parsed = validatePackManifest(pack);
  const route = parsed.routes.find(r => r.id === routeId);
  requireAudio(route, `No directed route: ${routeId}`);
  requireAudio(allowFixtures, 'This v0 route requires explicit fixture mode.');
  const from = parsed.assets.find(a => a.id === route.from.id && a.revision === route.from.revision)!;
  const to = parsed.assets.find(a => a.id === route.to.id && a.revision === route.to.revision)!;
  requireAudio(from.id !== to.id, 'The small player requires distinct A and B recordings.');
  requireAudio(eligibleForPlayback(from, allowFixtures, allowUnreviewed) && eligibleForPlayback(to, allowFixtures, allowUnreviewed),
    'Both recordings must have playback permission and eligible review status.');
  return {route, from, to};
}

export interface TransitionPlan extends CheckedRoute {
  readonly at: ClockStamp;
  readonly end: ClockStamp;
  readonly overlapFrames: number;
}

export function planTransition(pack: AudioPack, routeId: string, fromStart: SourceStart,
  clock: AudioClock, allowFixtures = false, leadFrames = 0, allowUnreviewed = false): TransitionPlan {
  const pair = checkedRoute(pack, routeId, allowFixtures, allowUnreviewed);
  requireAudio(fromStart.at.engineGeneration === clock.engineGeneration, 'Stale engine generation.');
  requireAudio(Number.isSafeInteger(fromStart.at.frame) && fromStart.at.frame >= 0 &&
    Number.isSafeInteger(leadFrames) && leadFrames >= 0, 'Invalid start or scheduling lead.');
  const entry = cueFrame(pair.from, fromStart.entryCueId, 'entry', clock.sampleRate);
  const exit = cueFrame(pair.from, pair.route.exit_cue, 'exit', clock.sampleRate);
  const frame = fromStart.at.frame + exit - entry;
  requireAudio(exit >= entry && frame >= clock.currentFrame + leadFrames,
    'The exit cue has passed or is too close. Restart A to schedule this transition.');
  const overlapFrames = quartersToFrames(pair.route.overlap_quarters, pair.from.timing!.bpm, clock.sampleRate);
  return {...pair, at: {engineGeneration: clock.engineGeneration, frame}, overlapFrames,
    end: {engineGeneration: clock.engineGeneration, frame: frame + overlapFrames}};
}

export interface DecodedRecording {
  readonly asset: AudioAsset;
  readonly buffer: AudioBuffer;
  /** Explicit prepare-time derivative; source identity/rights remain the original asset. */
  readonly processed?: {
    readonly sourceFrames: number;
    readonly outputFrames: number;
    readonly algorithm: string;
  };
  /** Set-only bounded render, followed by this original buffer at the prepared buffer's EOF. */
  readonly continuation?: {readonly buffer: AudioBuffer; readonly sourceFrame: number};
  readonly nativeRate?: NativeRateRamp;
}

export interface RecordingOptions {
  readonly allowFixtures?: boolean;
  readonly allowUnreviewed?: boolean;
  readonly fadeInFrames?: number;
  readonly fadeOutFrames?: number;
  /** Fixed per-entry gain outside all transition lanes; retained through native continuation. */
  readonly levelGain?: number;
}

/** One-shot recording implementation of the S01 shared source seam. */
export class RecordedSource implements PlayableSource {
  readonly kind = 'recorded' as const;
  readonly reference;
  private phase: 'new' | 'prepared' | 'scheduled' | 'stopping' | 'ended' | 'released' = 'new';
  private clock: WebAudioClock | null = null;
  private generation = -1;
  private node: AudioBufferSourceNode | null = null;
  private continuationNode: AudioBufferSourceNode | null = null;
  private loopNode: AudioBufferSourceNode | null = null;
  private loopSplice: {original: GainNode; entry: GainNode} | null = null;
  private readonly entryRate: NativeRateRamp | null;
  private exitRate = false;
  private continuationAt: number | null = null;
  private gain: GainNode | null = null;
  private entryGain: GainNode | null = null;
  private levelNode: GainNode | null = null;
  private mixGraph: MixAutomationGraph | null = null;
  private start: SourceStart | null = null;
  private entryFrame = 0;
  private finishFrame = 0;
  private naturalEndFrame = 0;
  private transitionFrame: number | null = null;
  /** S18: owner-clock frame where a mix entry's automation reaches its neutral final values. */
  private mixEntryEndFrame: number | null = null;
  private readonly fadeIn: number;
  private readonly fadeOut: number;
  private readonly fixedLevelGain: number;

  constructor(private readonly context: BaseAudioContext, readonly recording: DecodedRecording,
    private readonly destination: AudioNode, private readonly options: RecordingOptions = {}) {
    this.reference = {id: recording.asset.id, revision: recording.asset.revision};
    this.fadeIn = options.fadeInFrames ?? 0;
    this.fadeOut = options.fadeOutFrames ?? 0;
    this.fixedLevelGain = options.levelGain ?? 1;
    this.entryRate = recording.nativeRate ? {...recording.nativeRate} : null;
    requireAudio(Number.isFinite(this.levelGain) && this.levelGain > 0 && this.levelGain <= 4, 'Recording level gain must be positive and at most +12 dB.');
    requireAudio([this.fadeIn, this.fadeOut].every(n => Number.isSafeInteger(n) && n >= 0),
      'Fades must use nonnegative integer output frames.');
  }

  async prepare(clock: AudioClock): Promise<void> {
    requireAudio(this.phase === 'new', 'Prepare a source once.');
    requireAudio(clock instanceof WebAudioClock && clock.context === this.context,
      'A source must retain its owner context and clock by identity.');
    requireAudio(this.destination.context === this.context, 'Output belongs to another context.');
    const {asset, buffer} = this.recording;
    requireAudio(asset.source_kind === 'recording' && asset.timing, 'A recorded source requires recording timing.');
    requireAudio(eligibleForPlayback(asset, this.options.allowFixtures, this.options.allowUnreviewed), 'Recording is not eligible for playback.');
    const sourceFrames = Math.round(asset.file.frames * clock.sampleRate / asset.file.sample_rate);
    const processed = this.recording.processed;
    if (this.entryRate) { validateNativeRate(this.entryRate, clock.sampleRate); requireAudio(!processed && this.entryRate.end === 1, 'Native entry rate must settle to original PCM at unity.'); }
    if (processed !== undefined) requireAudio(processed && Number.isSafeInteger(processed.sourceFrames) &&
      Math.abs(processed.sourceFrames - sourceFrames) <= 1 &&
      Number.isSafeInteger(processed.outputFrames) && processed.outputFrames > 0 &&
      processed.outputFrames === buffer.length && typeof processed.algorithm === 'string' &&
      processed.algorithm.length > 0 && processed.algorithm.length <= 128,
    'Processed recording needs explicit original/rendered frames and its algorithm version.');
    requireAudio(buffer.sampleRate === clock.sampleRate && buffer.numberOfChannels === asset.file.channels &&
      (processed !== undefined || Math.abs(buffer.length - sourceFrames) <= 1),
    'Decoded buffer does not match the recording and output sample rate.');
    const continuation = this.recording.continuation;
    if (continuation) requireAudio(processed && continuation.buffer.sampleRate === clock.sampleRate &&
      continuation.buffer.numberOfChannels === asset.file.channels && Math.abs(continuation.buffer.length - sourceFrames) <= 1 &&
      Number.isSafeInteger(continuation.sourceFrame) && continuation.sourceFrame > 0 && continuation.sourceFrame < continuation.buffer.length,
    'A native continuation needs the original recording and an explicit native join offset.');
    this.clock = clock;
    this.generation = clock.engineGeneration;
    this.node = this.context.createBufferSource();
    this.node.buffer = buffer;
    if (this.entryRate) this.node.playbackRate.value = this.entryRate.start;
    this.gain = this.context.createGain();
    if (continuation) {
      this.entryGain = this.context.createGain();
      this.entryGain.connect(this.gain);
    }
    this.node.connect(this.entryGain ?? this.gain);
    if (this.levelGain !== 1) {
      this.levelNode = this.context.createGain(); this.levelNode.gain.value = this.levelGain;
      this.gain.connect(this.levelNode); this.levelNode.connect(this.destination);
    } else this.gain.connect(this.destination);
    const entryNode = this.node;
    this.node.onended = () => {
      entryNode.disconnect();
      if (continuation || this.loopNode) return; // a scheduled owned continuation owns EOF
      if (this.phase !== 'released') this.phase = 'ended';
      this.gain?.disconnect();
      this.levelNode?.disconnect();
      this.mixGraph?.release(); this.mixGraph = null;
    };
    if (continuation) {
      this.continuationNode = this.context.createBufferSource();
      this.continuationNode.buffer = continuation.buffer;
      this.continuationNode.connect(this.gain);
      const nativeNode = this.continuationNode;
      nativeNode.onended = () => {
        nativeNode.disconnect();
        if (this.loopNode) return;
        if (this.phase !== 'released') this.phase = 'ended';
        this.gain?.disconnect();
        this.levelNode?.disconnect();
        this.mixGraph?.release(); this.mixGraph = null;
      };
    }
    this.phase = 'prepared';
  }

  scheduleStart(start: SourceStart): void {
    requireAudio(this.phase === 'prepared', 'Prepare before start; start each source once.');
    requireAudio(!this.recording.processed && !this.entryRate, 'A processed/native-rate recording needs an explicit mapped mix entry.');
    this.checkStamp(start.at);
    const entry = cueFrame(this.recording.asset, start.entryCueId, 'entry', this.clock!.sampleRate);
    requireAudio(entry < this.recording.buffer.length && entry + this.fadeIn <= this.recording.buffer.length,
      'Entry/fade exceeds decoded audio.');
    const when = start.at.frame / this.clock!.sampleRate;
    this.gain!.gain.setValueAtTime(this.fadeIn ? 0 : 1, when);
    if (this.fadeIn) this.gain!.gain.linearRampToValueAtTime(1, (start.at.frame + this.fadeIn) / this.clock!.sampleRate);
    this.node!.start(when, entry / this.clock!.sampleRate);
    this.start = start;
    this.entryFrame = entry;
    this.finishFrame = start.at.frame + this.recording.buffer.length - entry;
    this.naturalEndFrame = this.finishFrame;
    this.phase = 'scheduled';
  }

  /** Analyzed/processed entry in decoded output frames; no authored cue is rewritten. */
  scheduleMixStart(at: ClockStamp, entryOffsetFrames: number, automation: MixAutomation): void {
    requireAudio(this.phase === 'prepared', 'Prepare before start; start each source once.');
    this.checkStamp(at);
    validateMixAutomation(automation, this.clock!.sampleRate);
    requireAudio(Number.isSafeInteger(entryOffsetFrames) && entryOffsetFrames >= 0 &&
      entryOffsetFrames + (this.entryRate ? nativeRateInputAt(this.entryRate, automation.durationFrames) : automation.durationFrames) <= this.recording.buffer.length,
    'Analyzed entry/automation exceeds prepared audio.');
    requireAudio(automation.gain[0]!.value === 0, 'An incoming mix must start at zero gain.');
    const graph = createMixAutomationGraph(this.context, this.node!, this.entryGain ?? this.gain!, at.frame, automation);
    const lifetime = this.entryRate ? Math.round(nativeRateOutputAt(this.entryRate, this.recording.buffer.length - entryOffsetFrames)) : this.playbackFrames - entryOffsetFrames;
    let entryStarted = false, nativeStarted = false;
    try {
      // The mix curve owns this entrance; constructor fades belong to authored cues only.
      this.gain!.gain.setValueAtTime(1, at.frame / this.clock!.sampleRate);
      // Gate native filter tails at prepared EOF; onended is cleanup, never an audio deadline.
      // Native playbackRate is k-rate. Let native EOF close B, never gate it at the analytic
      // endpoint; retain a two-quantum lifecycle guard for the nominal map's block error.
      if (!this.entryRate) this.gain!.gain.setValueAtTime(0,
        (at.frame + lifetime) / this.clock!.sampleRate);
      if (this.entryRate) this.scheduleRate(this.node!, this.entryRate, at.frame);
      this.node!.start(at.frame / this.clock!.sampleRate, entryOffsetFrames / this.clock!.sampleRate);
      entryStarted = true;
      if (this.recording.continuation) {
        this.continuationAt = at.frame + this.recording.buffer.length - entryOffsetFrames;
        this.continuationNode!.start(this.continuationAt / this.clock!.sampleRate,
          this.recording.continuation.sourceFrame / this.clock!.sampleRate);
        nativeStarted = true;
        // Gate filter tails at the PCM seam, independently of the native continuation.
        this.entryGain!.gain.setValueAtTime(0, this.continuationAt / this.clock!.sampleRate);
      }
    } catch (error) {
      // Preserve the scheduling failure even if a native cleanup call also fails. The caller
      // still releases/disconnects both prepared nodes, including the future continuation.
      try { if (entryStarted) this.node!.stop(this.context.currentTime); } catch { /* release disconnects it */ }
      try { if (nativeStarted) this.continuationNode!.stop(this.context.currentTime); } catch { /* release disconnects it */ }
      try { graph.restore(); } catch { /* caller releases the prepared source */ }
      try { this.gain!.gain.cancelScheduledValues(at.frame / this.clock!.sampleRate); } catch { /* preserve original error */ }
      throw error;
    }
    this.mixGraph = graph;
    const nyquist = this.clock!.sampleRate / 2;
    // Only an entry that ends exactly neutral may later be replaced by the direct connection.
    this.mixEntryEndFrame = !automation.echo && automation.gain.at(-1)!.value === 1 &&
      automation.lowShelfDb.at(-1)!.value === 0 && automation.highPassHz.at(-1)!.value === 0 &&
      automation.lowPassHz.at(-1)!.value === nyquist ? Math.max(at.frame + automation.durationFrames, this.continuationAt ?? 0) : null;
    this.start = {at: {...at}, entryCueId: 'mix-entry'};
    this.entryFrame = entryOffsetFrames;
    this.finishFrame = at.frame + lifetime + (this.entryRate ? 256 : 0);
    this.naturalEndFrame = this.finishFrame;
    this.phase = 'scheduled';
  }

  getValidExits(): readonly SourceExit[] {
    requireAudio(this.phase === 'prepared' || this.phase === 'scheduled', 'Source must be ready.');
    requireAudio(!this.recording.processed && !this.entryRate, 'Processed/native-rate audio requires explicitly mapped mix offsets.');
    this.checkGeneration();
    return this.recording.asset.cues.filter(c => c.kind === 'exit').map(c => ({cueId: c.id,
      offsetFrames: cueFrame(this.recording.asset, c.id, 'exit', this.clock!.sampleRate)}));
  }

  /** The fade starts at the exit cue. A caller may choose its length for this one exit (S05 tail bar). */
  transitionOut(exitCueId: string, at: ClockStamp, fadeOutFrames = this.fadeOut): void {
    requireAudio(this.phase === 'scheduled' && this.start, 'Start before transition; transition once.');
    requireAudio(!this.recording.processed && !this.entryRate && !this.mixGraph, 'Use mapped mix offsets for an opt-in processed/native-rate source.');
    this.checkStamp(at);
    requireAudio(Number.isSafeInteger(fadeOutFrames) && fadeOutFrames >= 0, 'Fades must use nonnegative integer output frames.');
    const expected = this.start.at.frame + cueFrame(this.recording.asset, exitCueId, 'exit', this.clock!.sampleRate) - this.entryFrame;
    requireAudio(at.frame === expected && at.frame >= this.start.at.frame, 'Transition must align to the selected exit cue.');
    requireAudio(at.frame + fadeOutFrames <= this.finishFrame, 'Transition fade exceeds decoded audio.');
    const when = at.frame / this.clock!.sampleRate, end = (at.frame + fadeOutFrames) / this.clock!.sampleRate;
    this.gain!.gain.setValueAtTime(1, when);
    if (fadeOutFrames) this.gain!.gain.linearRampToValueAtTime(0, end);
    else this.gain!.gain.setValueAtTime(0, when);
    this.node!.stop(end);
    this.finishFrame = at.frame + fadeOutFrames;
    this.transitionFrame = at.frame;
    this.phase = 'stopping';
  }

  /** Exit at the analyzed decoded-frame offset, with every move on the owner clock. */
  transitionMixOut(at: ClockStamp, sourceOffsetFrames: number, automation: MixAutomation,
    extra: {readonly rate?: NativeRateRamp; readonly loopBuffer?: AudioBuffer} = {}): void {
    requireAudio(this.phase === 'scheduled' && this.start && !this.mixGraph,
      'Start before a mix exit; one automation graph owns each source.');
    this.checkStamp(at);
    const rate = this.clock!.sampleRate;
    validateMixAutomation(automation, rate);
    requireAudio(!automation.echo || this.levelGain === 1, 'Echo master return requires unity fixed source gain.');
    requireAudio(Number.isSafeInteger(sourceOffsetFrames) && sourceOffsetFrames >= this.entryFrame &&
      at.frame === (this.entryRate ? this.clockFrameAtNative(sourceOffsetFrames) : this.start.at.frame + sourceOffsetFrames - this.entryFrame),
    'Mix exit must align to the analyzed source offset.');
    if (extra.rate) validateNativeRate(extra.rate, rate);
    const consumed = extra.rate ? nativeRateInputAt(extra.rate, automation.durationFrames) : automation.durationFrames;
    requireAudio(extra.loopBuffer ? extra.loopBuffer.length === automation.durationFrames && extra.loopBuffer.sampleRate === rate &&
      extra.loopBuffer.numberOfChannels === this.recording.buffer.numberOfChannels :
      sourceOffsetFrames + consumed <= this.playbackFrames && at.frame + automation.durationFrames <= this.finishFrame,
      'Mix exit automation exceeds decoded audio.');
    requireAudio(automation.gain[0]!.value === 1 && automation.gain.at(-1)!.value === 0 &&
      automation.lowShelfDb[0]!.value === 0 && automation.highPassHz[0]!.value === 0 &&
      automation.lowPassHz[0]!.value === rate / 2,
    'An outgoing mix starts neutral and ends at zero gain.');
    const loop = extra.loopBuffer ? this.context.createBufferSource() : null;
    if (loop) {
      loop.buffer = extra.loopBuffer!;
      this.loopSplice = {original: this.context.createGain(), entry: this.context.createGain()};
      this.loopSplice.entry.connect(this.gain!); loop.connect(this.loopSplice.entry);
    }
    const graph = createMixAutomationGraph(this.context, loop ?? this.node!, this.loopSplice?.entry ?? this.gain!, at.frame, automation);
    try {
      if (extra.rate) { this.scheduleRate(this.node!, extra.rate, at.frame); this.exitRate = true; }
      if (loop) {
        loop.start(at.frame / rate); loop.stop((at.frame + automation.durationFrames) / rate);
        // Native-rate k-rate integration can be a quantum away from the nominal sample.
        // Complementary 20ms branches splice the continuing actual A into the finite loop.
        const splice = this.loopSplice!, end = (at.frame + Math.round(rate * 0.02)) / rate;
        splice.entry.gain.setValueAtTime(0, at.frame / rate); splice.entry.gain.linearRampToValueAtTime(1, end);
        this.node!.disconnect(); this.node!.connect(splice.original); splice.original.connect(this.gain!);
        splice.original.gain.setValueAtTime(1, at.frame / rate); splice.original.gain.linearRampToValueAtTime(0, end);
        this.node!.stop(end);
      } else this.node!.stop((at.frame + automation.durationFrames) / rate);
    } catch (error) {
      try { loop?.stop(this.context.currentTime); } catch { /* release below */ }
      try { graph.restore(); } catch { /* preserve the scheduling error; caller releases B */ }
      loop?.disconnect();
      this.restoreLoopSplice();
      if (extra.rate) { this.node!.playbackRate.cancelScheduledValues(at.frame / rate); this.node!.playbackRate.setValueAtTime(1, at.frame / rate); this.exitRate = false; }
      try { this.node!.stop(this.naturalEndFrame / rate); } catch { /* retain original scheduling error */ }
      throw error;
    }
    if (loop) {
      this.loopNode = loop;
      loop.onended = () => { loop.disconnect(); if (this.phase !== 'released') this.phase = 'ended'; this.gain?.disconnect(); this.levelNode?.disconnect(); this.mixGraph?.release(); this.mixGraph = null; };
    }
    this.mixGraph = graph;
    this.finishFrame = at.frame + automation.durationFrames;
    this.transitionFrame = at.frame;
    this.phase = 'stopping';
  }

  /**
   * S18 set mode: once a mix entry's automation has finished, every lane holds its neutral end
   * value (unity gain, open filters), so the entry graph is replaced by the direct connection.
   * The source can then own one later mix exit. Refused before the entry has completed or
   * when the entry automation did not end neutral.
   */
  settleMixEntry(): boolean {
    if (this.mixEntryEndFrame === null || !this.mixGraph || this.transitionFrame !== null) return false;
    this.checkGeneration();
    if (this.clock!.currentFrame < this.mixEntryEndFrame) return false;
    this.mixGraph.restore(); this.mixGraph = null;
    if (this.continuationNode) {
      this.node!.onended = null; this.node!.disconnect();
      this.entryGain!.disconnect(); this.entryGain = null;
      this.node = this.continuationNode; this.continuationNode = null;
    }
    this.mixEntryEndFrame = null;
    return true;
  }

  /** Restore the original start envelope and finish only before an exit has begun. */
  cancelTransition(): boolean {
    if (this.transitionFrame === null) return true;
    this.checkGeneration();
    if (this.clock!.currentFrame >= this.transitionFrame) return false;
    this.mixGraph?.restore(); this.mixGraph = null;
    const transitionFrame = this.transitionFrame;
    const rate = this.clock!.sampleRate;
    if (this.loopNode) { this.loopNode.onended = null; this.loopNode.stop(this.context.currentTime); this.loopNode.disconnect(); this.loopNode = null; }
    this.restoreLoopSplice();
    if (this.exitRate) { this.node!.playbackRate.cancelScheduledValues(transitionFrame / rate); this.node!.playbackRate.setValueAtTime(1, transitionFrame / rate); this.exitRate = false; }
    this.gain!.gain.cancelScheduledValues(transitionFrame / rate);
    // A future exit may share a timestamp with an original start-envelope event.
    // Recreate any such event removed by cancelScheduledValues.
    if (this.start!.at.frame >= transitionFrame) {
      this.gain!.gain.setValueAtTime(this.fadeIn ? 0 : 1, this.start!.at.frame / rate);
    }
    if (this.fadeIn && this.start!.at.frame + this.fadeIn >= transitionFrame) {
      this.gain!.gain.linearRampToValueAtTime(1, (this.start!.at.frame + this.fadeIn) / rate);
    }
    // S18: a settled mix entry keeps its prepared-EOF gate, which cancelScheduledValues removed.
    if (this.start!.entryCueId === 'mix-entry') this.gain!.gain.setValueAtTime(0, this.naturalEndFrame / rate);
    // Web Audio replaces a future scheduled stop when stop() is called again.
    this.node!.stop(this.naturalEndFrame / rate);
    this.finishFrame = this.naturalEndFrame;
    this.transitionFrame = null;
    this.phase = 'scheduled';
    return true;
  }

  stop(at: ClockStamp): void {
    requireAudio(this.phase === 'scheduled', 'Start before stop.');
    this.checkStamp(at);
    requireAudio(at.frame >= this.start!.at.frame, 'Stop follows start; use release to cancel a future start.');
    const when = at.frame / this.clock!.sampleRate;
    this.gain!.gain.cancelScheduledValues(when);
    this.gain!.gain.setValueAtTime(0, when);
    this.node!.stop(when);
    this.continuationNode?.stop(when);
    this.loopNode?.stop(when);
    this.finishFrame = at.frame;
    this.phase = 'stopping';
  }

  /** Cleanup stays legal after invalidation, and cancels a not-yet-started voice. */
  release(): void {
    if (this.phase === 'released') return;
    if (this.node) {
      this.node.onended = null;
      if (this.start) this.node.stop(this.context.currentTime);
      this.node.disconnect();
      this.gain!.disconnect();
    }
    if (this.continuationNode) {
      this.continuationNode.onended = null;
      if (this.start) this.continuationNode.stop(this.context.currentTime);
      this.continuationNode.disconnect(); this.continuationNode = null;
    }
    if (this.loopNode) { this.loopNode.onended = null; this.loopNode.stop(this.context.currentTime); this.loopNode.disconnect(); this.loopNode = null; }
    this.loopSplice?.original.disconnect(); this.loopSplice?.entry.disconnect(); this.loopSplice = null;
    this.mixGraph?.release(); this.mixGraph = null;
    this.entryGain?.disconnect(); this.entryGain = null;
    this.levelNode?.disconnect(); this.levelNode = null;
    this.phase = 'released';
    this.node = null;
    this.gain = null;
    this.clock = null;
  }

  get endFrame(): number { return this.finishFrame; }
  get levelGain(): number { return this.fixedLevelGain; }
  get nativeRate(): NativeRateRamp | null { return this.entryRate ? {...this.entryRate} : null; }
  nativeFrameAtClock(clockFrame: number): number {
    requireAudio(this.start, 'A native map needs a scheduled start.');
    return this.entryFrame + Math.ceil(this.entryRate ? nativeRateInputAt(this.entryRate, clockFrame - this.start.at.frame) : clockFrame - this.start.at.frame);
  }
  clockFrameAtNative(nativeFrame: number): number {
    requireAudio(this.start, 'A native map needs a scheduled start.');
    return this.start.at.frame + Math.round(this.entryRate ? nativeRateOutputAt(this.entryRate, nativeFrame - this.entryFrame) : nativeFrame - this.entryFrame);
  }
  private scheduleRate(node: AudioBufferSourceNode, ramp: NativeRateRamp, at: number): void {
    node.playbackRate.setValueAtTime(ramp.start, at / this.clock!.sampleRate);
    node.playbackRate.linearRampToValueAtTime(ramp.end, (at + ramp.frames) / this.clock!.sampleRate);
  }
  private restoreLoopSplice(): void {
    if (!this.loopSplice) return;
    this.loopSplice.original.disconnect(); this.loopSplice.entry.disconnect(); this.loopSplice = null;
    this.node!.disconnect(); this.node!.connect(this.gain!);
  }
  /** Virtual frames: bounded processed entry followed by untouched native PCM. */
  get playbackFrames(): number {
    const native = this.recording.continuation;
    return this.recording.buffer.length + (native ? native.buffer.length - native.sourceFrame : 0);
  }
  get nativeRecording(): DecodedRecording {
    return this.recording.continuation ? {asset: this.recording.asset, buffer: this.recording.continuation.buffer} : this.recording;
  }

  private checkGeneration(): void {
    requireAudio(this.clock && this.clock.engineGeneration === this.generation && this.context.state !== 'closed',
      'Stale engine generation or closed context.');
  }
  private checkStamp(at: ClockStamp): void {
    this.checkGeneration();
    requireAudio(at.engineGeneration === this.generation, 'Stale engine generation.');
    requireAudio(Number.isSafeInteger(at.frame) && at.frame >= this.clock!.currentFrame,
      'Schedule at a valid future audio-clock frame.');
  }
}
