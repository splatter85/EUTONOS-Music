import {eligibleForPlayback, quartersToFrames, validatePackManifest} from './pack.js';
import type {AudioAsset, AudioPack, CueRoute} from './pack-types.js';
import type {AudioClock, ClockStamp, PlayableSource, SourceExit, SourceStart} from './playable-source.js';
import {createMixAutomationGraph, validateMixAutomation, type MixAutomation, type MixAutomationGraph} from './mix-automation.js';

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
export function checkedRoute(pack: AudioPack, routeId: string, allowFixtures = false): CheckedRoute {
  const parsed = validatePackManifest(pack);
  const route = parsed.routes.find(r => r.id === routeId);
  requireAudio(route, `No directed route: ${routeId}`);
  requireAudio(allowFixtures, 'This v0 route requires explicit fixture mode.');
  const from = parsed.assets.find(a => a.id === route.from.id && a.revision === route.from.revision)!;
  const to = parsed.assets.find(a => a.id === route.to.id && a.revision === route.to.revision)!;
  requireAudio(from.id !== to.id, 'The small player requires distinct A and B recordings.');
  requireAudio(eligibleForPlayback(from, allowFixtures) && eligibleForPlayback(to, allowFixtures),
    'Both recordings must have playback permission and eligible review status.');
  return {route, from, to};
}

export interface TransitionPlan extends CheckedRoute {
  readonly at: ClockStamp;
  readonly end: ClockStamp;
  readonly overlapFrames: number;
}

export function planTransition(pack: AudioPack, routeId: string, fromStart: SourceStart,
  clock: AudioClock, allowFixtures = false, leadFrames = 0): TransitionPlan {
  const pair = checkedRoute(pack, routeId, allowFixtures);
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
}

export interface RecordingOptions {
  readonly allowFixtures?: boolean;
  readonly fadeInFrames?: number;
  readonly fadeOutFrames?: number;
}

/** One-shot recording implementation of the S01 shared source seam. */
export class RecordedSource implements PlayableSource {
  readonly kind = 'recorded' as const;
  readonly reference;
  private phase: 'new' | 'prepared' | 'scheduled' | 'stopping' | 'ended' | 'released' = 'new';
  private clock: WebAudioClock | null = null;
  private generation = -1;
  private node: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private mixGraph: MixAutomationGraph | null = null;
  private start: SourceStart | null = null;
  private entryFrame = 0;
  private finishFrame = 0;
  private naturalEndFrame = 0;
  private transitionFrame: number | null = null;
  private readonly fadeIn: number;
  private readonly fadeOut: number;

  constructor(private readonly context: BaseAudioContext, readonly recording: DecodedRecording,
    private readonly destination: AudioNode, private readonly options: RecordingOptions = {}) {
    this.reference = {id: recording.asset.id, revision: recording.asset.revision};
    this.fadeIn = options.fadeInFrames ?? 0;
    this.fadeOut = options.fadeOutFrames ?? 0;
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
    requireAudio(eligibleForPlayback(asset, this.options.allowFixtures), 'Recording is not eligible for playback.');
    const sourceFrames = Math.round(asset.file.frames * clock.sampleRate / asset.file.sample_rate);
    const processed = this.recording.processed;
    if (processed !== undefined) requireAudio(processed && Number.isSafeInteger(processed.sourceFrames) &&
      Math.abs(processed.sourceFrames - sourceFrames) <= 1 &&
      Number.isSafeInteger(processed.outputFrames) && processed.outputFrames > 0 &&
      processed.outputFrames === buffer.length && typeof processed.algorithm === 'string' &&
      processed.algorithm.length > 0 && processed.algorithm.length <= 128,
    'Processed recording needs explicit original/rendered frames and its algorithm version.');
    requireAudio(buffer.sampleRate === clock.sampleRate && buffer.numberOfChannels === asset.file.channels &&
      (processed !== undefined || Math.abs(buffer.length - sourceFrames) <= 1),
    'Decoded buffer does not match the recording and output sample rate.');
    this.clock = clock;
    this.generation = clock.engineGeneration;
    this.node = this.context.createBufferSource();
    this.node.buffer = buffer;
    this.gain = this.context.createGain();
    this.node.connect(this.gain);
    this.gain.connect(this.destination);
    this.node.onended = () => {
      if (this.phase !== 'released') this.phase = 'ended';
      this.node?.disconnect();
      this.gain?.disconnect();
      this.mixGraph?.release(); this.mixGraph = null;
    };
    this.phase = 'prepared';
  }

  scheduleStart(start: SourceStart): void {
    requireAudio(this.phase === 'prepared', 'Prepare before start; start each source once.');
    requireAudio(!this.recording.processed, 'A processed recording needs an explicit mapped mix entry.');
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
      entryOffsetFrames + automation.durationFrames <= this.recording.buffer.length,
    'Analyzed entry/automation exceeds prepared audio.');
    requireAudio(automation.gain[0]!.value === 0, 'An incoming mix must start at zero gain.');
    const graph = createMixAutomationGraph(this.context, this.node!, this.gain!, at.frame, automation);
    try {
      // The mix curve owns this entrance; constructor fades belong to authored cues only.
      this.gain!.gain.setValueAtTime(1, at.frame / this.clock!.sampleRate);
      // Gate native filter tails at prepared EOF; onended is cleanup, never an audio deadline.
      this.gain!.gain.setValueAtTime(0,
        (at.frame + this.recording.buffer.length - entryOffsetFrames) / this.clock!.sampleRate);
      this.node!.start(at.frame / this.clock!.sampleRate, entryOffsetFrames / this.clock!.sampleRate);
    } catch (error) {
      graph.restore(); this.gain!.gain.cancelScheduledValues(at.frame / this.clock!.sampleRate); throw error;
    }
    this.mixGraph = graph;
    this.start = {at: {...at}, entryCueId: 'mix-entry'};
    this.entryFrame = entryOffsetFrames;
    this.finishFrame = at.frame + this.recording.buffer.length - entryOffsetFrames;
    this.naturalEndFrame = this.finishFrame;
    this.phase = 'scheduled';
  }

  getValidExits(): readonly SourceExit[] {
    requireAudio(this.phase === 'prepared' || this.phase === 'scheduled', 'Source must be ready.');
    requireAudio(!this.recording.processed, 'Processed audio requires explicitly mapped mix offsets.');
    this.checkGeneration();
    return this.recording.asset.cues.filter(c => c.kind === 'exit').map(c => ({cueId: c.id,
      offsetFrames: cueFrame(this.recording.asset, c.id, 'exit', this.clock!.sampleRate)}));
  }

  /** The fade starts at the exit cue. A caller may choose its length for this one exit (S05 tail bar). */
  transitionOut(exitCueId: string, at: ClockStamp, fadeOutFrames = this.fadeOut): void {
    requireAudio(this.phase === 'scheduled' && this.start, 'Start before transition; transition once.');
    requireAudio(!this.recording.processed && !this.mixGraph, 'Use mapped mix offsets for an opt-in processed source.');
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
  transitionMixOut(at: ClockStamp, sourceOffsetFrames: number, automation: MixAutomation): void {
    requireAudio(this.phase === 'scheduled' && this.start && !this.mixGraph,
      'Start before a mix exit; one automation graph owns each source.');
    this.checkStamp(at);
    const rate = this.clock!.sampleRate;
    validateMixAutomation(automation, rate);
    requireAudio(Number.isSafeInteger(sourceOffsetFrames) && sourceOffsetFrames >= this.entryFrame &&
      at.frame === this.start.at.frame + sourceOffsetFrames - this.entryFrame,
    'Mix exit must align to the analyzed source offset.');
    requireAudio(at.frame + automation.durationFrames <= this.finishFrame,
      'Mix exit automation exceeds decoded audio.');
    requireAudio(automation.gain[0]!.value === 1 && automation.gain.at(-1)!.value === 0 &&
      automation.lowShelfDb[0]!.value === 0 && automation.highPassHz[0]!.value === 0 &&
      automation.lowPassHz[0]!.value === rate / 2,
    'An outgoing mix starts neutral and ends at zero gain.');
    const graph = createMixAutomationGraph(this.context, this.node!, this.gain!, at.frame, automation);
    try { this.node!.stop((at.frame + automation.durationFrames) / rate); }
    catch (error) { graph.restore(); throw error; }
    this.mixGraph = graph;
    this.finishFrame = at.frame + automation.durationFrames;
    this.transitionFrame = at.frame;
    this.phase = 'stopping';
  }

  /** Restore the original start envelope and finish only before an exit has begun. */
  cancelTransition(): boolean {
    if (this.transitionFrame === null) return true;
    this.checkGeneration();
    if (this.clock!.currentFrame >= this.transitionFrame) return false;
    this.mixGraph?.restore(); this.mixGraph = null;
    const transitionFrame = this.transitionFrame;
    const rate = this.clock!.sampleRate;
    this.gain!.gain.cancelScheduledValues(transitionFrame / rate);
    // A future exit may share a timestamp with an original start-envelope event.
    // Recreate any such event removed by cancelScheduledValues.
    if (this.start!.at.frame >= transitionFrame) {
      this.gain!.gain.setValueAtTime(this.fadeIn ? 0 : 1, this.start!.at.frame / rate);
    }
    if (this.fadeIn && this.start!.at.frame + this.fadeIn >= transitionFrame) {
      this.gain!.gain.linearRampToValueAtTime(1, (this.start!.at.frame + this.fadeIn) / rate);
    }
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
    this.mixGraph?.release(); this.mixGraph = null;
    this.phase = 'released';
    this.node = null;
    this.gain = null;
    this.clock = null;
  }

  get endFrame(): number { return this.finishFrame; }

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
