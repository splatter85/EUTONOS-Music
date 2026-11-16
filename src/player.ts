import {decodeRecording, decodeRecordings, type LoadedBrowserPack} from './browser-pack.js';
import {quartersToFrames} from './pack.js';
import type {ClockStamp, SourceStart} from './playable-source.js';
import type {AudioAsset, VersionRef} from './pack-types.js';
import {commitHybridHandoff, planHybridHandoff, type HybridBridge, type HybridBridgeExit,
  type HybridHandoffPlan} from './hybrid-handoff.js';
import type {ProceduralPlan} from './phrase-plan.js';
import {checkProceduralPlan, decodeProceduralSamples, ProceduralSource} from './procedural-source.js';
import {checkedRoute, planTransition, RecordedSource, requireAudio, WebAudioClock,
  cueFrame, type CheckedRoute, type DecodedRecording} from './web-audio.js';
import {isBeatmatchedRecipe, type AutomaticMixPlan, type LevelMatchPlan, type MixPlannerOptions, type MixRecipe} from './mix-planner.js';
import {bindEchoReturn, unbindEchoReturn} from './mix-automation.js';
import {setTransitionRecord} from './mix-transition.js';
import type {TransitionPlanRecord} from '../web/transition-policy.js';
import {browserMixPreparation, chooseSetTransition, MixAnalysisCache, prepareMixTransition,
  replanPreparedMix, renderSetBlend, transitionSignature, renderPlannedMix, prepareOutgoingLoop, nextBoundary, downbeatAt, setBarGrid, type MixPreparationRuntime, type RouteFreeRecipe, type SetBarGrid,
  type SetTransitionChoice, type SongAnalysisResult} from './mix-transition.js';
import {outputFrameAtSource, sourceFrameAtOutput, type TimePitchMapping} from './time-pitch.js';
import {eligibleForPlayback} from './pack.js';
import {SONG_ANALYSIS_WINDOW, type MixAnalysis} from './mix-analysis.js';
import {DeckMixer, type DeckId, type DeckControl, type ChannelControls, type ControlValue} from '../web/deck-mixer.js';
import {deckPositionAt, type DeckPositionInput, type DeckPosition} from '../web/deck-readout.js';
import {precheckLabel, PRECHECK_PROTOCOL, type PrecheckReport, type PrecheckRequest, type PrecheckRuntime} from '../web/mix-precheck-data.js';

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
/** S21: Next waits at most this long for whole-song B analysis, then uses a bounded non-cut fallback. */
export const SET_SONG_ANALYSIS_DEADLINE_MS = 6000;
/** S21: candidates tried per handover request before the transition is refused. */
export const SET_CANDIDATE_ATTEMPTS = 5;
export interface MixSnapshot {
  readonly phase: 'preparing' | 'scheduled' | 'prelude' | 'mixing' | 'complete' | 'fallback' | 'unavailable';
  readonly reason: string;
  /** Experimental offline model of this selected DJ plan, not listening or manual-control qualification. */
  readonly precheck?: PrecheckReport;
  /** S21: the scheduled clean cut was reached only after measured pre-check FAILs; its own PASS is not a plain pass. */
  readonly fallbackAfterFailedPrecheck?: {readonly failedChecks: number; readonly last: string};
  /** Earliest committed audible mix effect, which may precede B's entry. */
  readonly earliestEffect?: ClockStamp;
  readonly summary: null | {
    /** S18 adds the route-free fallbacks, which never time-stretch B. */
    readonly recipe: MixRecipe | RouteFreeRecipe;
    readonly fromBpm: number; readonly toBpm: number; readonly tempoRatio: number;
    readonly pitchSemitones: number; readonly confidence: number; readonly processor: string;
    readonly fromExitFrame: number; readonly toEntryFrame: number; readonly processedEntryFrame: number;
    readonly outputFrames: number; readonly returnToOriginalTempo: boolean;
    /** Set blend: original B offset and owner-clock join, scheduled with the entry source. */
    readonly nativeJoin?: {readonly sourceFrame: number; readonly outputFrame: number; readonly at: ClockStamp};
    readonly levelMatch?: LevelMatchPlan;
    readonly entryDelayFrames?: number;
    readonly nativeRate?: AutomaticMixPlan['nativeRate'];
    readonly loopExtension?: AutomaticMixPlan['loopExtension'];
    readonly fromHash: string; readonly toHash: string;
    /** S18 set mode only. Bars count from 1 in the outgoing song's grid. */
    readonly set?: SetMixDetail;
  };
}
/** S18: what the set DJ chose and why, for display and receipts. Plan data, not listening evidence. */
export interface SetMixDetail {
  /** S21: the versioned, replayable plan record of exactly this handover (ratings attach to it). */
  readonly transition?: TransitionPlanRecord;
  /** S21 readout: choreography description, B entry and the policy's reasons. */
  readonly choreography?: string;
  readonly entry?: {readonly seconds: number; readonly fraction: number; readonly rank: number | null};
  readonly why?: readonly string[];
  readonly fromId: string; readonly toId: string;
  readonly exitBar: number; readonly boundaryBar: number;
  readonly boundaryBars: number; readonly anchor: SetBoundary['anchor'];
  readonly fromGrid: SetBarGrid['source']; readonly toGrid: SetBarGrid['source'];
  /** B's own BPM divided by A's: the tempo change at the handover (B ends at its own tempo). */
  readonly tempoChange: number;
  readonly notes: readonly string[];
}
/**
 * S18 set boundary. `song` counts bars from the outgoing song's first downbeat (phrase-aligned
 * Next); `entry` counts from where that song entered the set (Auto every N bars).
 */
export interface SetBoundary {
  readonly bars: 1 | 2 | 4 | 8 | 16 | 32 | 64;
  readonly anchor: 'song' | 'entry';
}
export const SET_BOUNDARY_BARS = [1, 2, 4, 8, 16, 32, 64] as const;
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

export interface DeckView {
  readonly side: DeckId; readonly assetId: string | null; readonly title: string;
  readonly positionSeconds: number; readonly durationSeconds: number; readonly bpm: number | null;
  readonly grid: 'measured' | 'requested'; readonly speed: number; readonly pitchSemitones: number;
  readonly pitchMode: DeckPosition['pitchMode']; readonly live: boolean; readonly controls: ChannelControls;
}
export interface DeckSnapshot {readonly a: DeckView; readonly b: DeckView; readonly crossfader: ControlValue;}

interface Voice {
  source: RecordedSource | ProceduralSource; start: SourceStart;
  /** S18 set voices: the original asset, the buffer frame at `start` and, if processed, its time map. */
  set?: {readonly asset: AudioAsset; readonly deck: DeckId; readonly offset: number; readonly mapping: TimePitchMapping | null;
    readonly bpm?: number; readonly grid?: 'measured' | 'requested'; readonly motion?: DeckPositionInput['motion'];
    readonly sourceStartFrame?: number; readonly nativeJoin?: {readonly sourceFrame: number; readonly outputFrame: number}};
}
type Selection = 'a' | 'b' | ProceduralPlan | {readonly assetId: string};
const isProcedural = (selection: Selection): selection is ProceduralPlan =>
  typeof selection === 'object' && !('assetId' in selection);

/** Thin A/B transport owner. S03 supplies the DJ/control-contract integration. */
export class SmallPlayer {
  readonly clock: WebAudioClock;
  /** S18: true for a set pack with no authored route; only set methods are available. */
  readonly routeFree: boolean;
  private readonly authored: CheckedRoute | null;
  /** S18 lazily decoded native songs: at most the selected next song is retained here. */
  private readonly setDecoded = new Map<string, Promise<DecodedRecording>>();
  private readonly output: GainNode;
  private readonly deckMixer: DeckMixer | null;
  private streamTap: MediaStreamAudioDestinationNode | null = null;
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
    routeId: string | null, private readonly mixRuntime: MixPreparationRuntime = browserMixPreparation,
    readonly analyses: MixAnalysisCache & {observe?(recording: DecodedRecording): void} = new MixAnalysisCache(),
    private readonly mixPrecheck: PrecheckRuntime | null = null) {
    this.routeFree = routeId === null;
    this.authored = routeId === null ? null : checkedRoute(loaded.pack, routeId, loaded.allowFixtures, loaded.allowUnreviewed);
    if (this.routeFree) {
      requireAudio(loaded.pack.assets.filter(a => a.source_kind === 'recording').length >= 2,
        'A set needs at least two recordings.');
    }
    this.clock = new WebAudioClock(context);
    this.output = context.createGain();
    this.output.gain.value = 0;
    this.output.connect(context.destination);
    this.deckMixer = this.routeFree ? new DeckMixer(context, this.output) : null;
    context.addEventListener('statechange', this.stateChanged);
  }

  /** The authored A/B pair. A set player has none and refuses pair-only operations. */
  get pair(): CheckedRoute {
    requireAudio(this.authored, 'This set has no authored pair; use the set methods.');
    return this.authored;
  }

  /** Call directly from a user gesture: resume is issued before the first await. */
  play(selection: 'a' | 'b', ownership: Promise<void> = Promise.resolve()): Promise<void> {
    requireAudio(!this.routeFree, 'This set has no authored pair; use playAsset.');
    return this.playSelection(selection, ownership);
  }

  /** S18: start one set song from its entry cue. Call directly from a user gesture. */
  playAsset(assetId: string, ownership: Promise<void> = Promise.resolve()): Promise<void> {
    requireAudio(this.routeFree, 'playAsset needs a set pack.');
    return this.playSelection({assetId}, ownership);
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
      if (typeof selection === 'object' && 'assetId' in selection) {
        decoding = this.decodeSetSong(selection.assetId).then(recording => [recording]);
      } else if (isProcedural(selection)) {
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
      let set: Voice['set'];
      if (typeof selection === 'object' && 'assetId' in selection) {
        const recording = recordings[0]!, deck: DeckId = 'a';
        source = new RecordedSource(this.context, recording, this.deckMixer![deck].input,
          {allowFixtures: this.loaded.allowFixtures, allowUnreviewed: !!this.loaded.allowUnreviewed, mixer: this.deckMixer![deck].createOwner()});
        const entry = recording.asset.cues.find(c => c.kind === 'entry');
        requireAudio(entry, 'Recording has no entry cue.');
        entryCueId = entry.id;
        set = {asset: recording.asset, deck, offset: cueFrame(recording.asset, entry.id, 'entry', this.clock.sampleRate), mapping: null};
        this.retainSetSongs([]);
      } else if (isProcedural(selection)) {
        source = new ProceduralSource(this.context, selection, recordings, this.output,
          {allowFixtures: this.loaded.allowFixtures});
        entryCueId = 'entry';
      } else {
        const asset = selection === 'a' ? this.pair.from : this.pair.to;
        const recording = recordings.find(r => r.asset.id === asset.id && r.asset.revision === asset.revision);
        requireAudio(recording, 'The requested recording is not prepared.');
        const fadeOutFrames = quartersToFrames(this.pair.route.overlap_quarters, this.pair.from.timing!.bpm, this.clock.sampleRate);
        source = new RecordedSource(this.context, recording, this.output,
          {allowFixtures: this.loaded.allowFixtures, allowUnreviewed: !!this.loaded.allowUnreviewed, fadeOutFrames});
        const entry = asset.cues.find(c => c.kind === 'entry');
        requireAudio(entry, 'Recording has no entry cue.');
        entryCueId = entry.id;
      }
      await source.prepare(this.clock);
      if (operation !== this.operation) { source.release(); return; }
      const start: SourceStart = {at: this.clock.stamp(this.clock.currentFrame + this.leadFrames), entryCueId};
      try { source.scheduleStart(start); }
      catch (error) { source.release(); throw error; }
      this.voices = [{source, start, ...(set ? {set} : {})}];
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
    planTransition(this.loaded.pack, this.pair.route.id, from.start, this.clock, this.loaded.allowFixtures, this.leadFrames, this.loaded.allowUnreviewed);
    const recordings = await this.decoded!;
    if (operation !== this.operation || transitionOperation !== this.transitionOperation) return;
    const recording = recordings.find(r => r.asset.id === this.pair.to.id && r.asset.revision === this.pair.to.revision)!;
    const overlapFrames = quartersToFrames(this.pair.route.overlap_quarters, this.pair.from.timing!.bpm, this.clock.sampleRate);
    const incoming = new RecordedSource(this.context, recording, this.output,
      {allowFixtures: this.loaded.allowFixtures, allowUnreviewed: !!this.loaded.allowUnreviewed, fadeInFrames: overlapFrames});
    await incoming.prepare(this.clock);
    if (operation !== this.operation || transitionOperation !== this.transitionOperation) { incoming.release(); return; }
    if (this.plan) { incoming.release(); throw new Error('The A → B transition is already scheduled.'); }
    try {
      const plan = planTransition(this.loaded.pack, this.pair.route.id, from.start, this.clock,
        this.loaded.allowFixtures, this.leadFrames, this.loaded.allowUnreviewed);
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
    const incoming = new RecordedSource(this.context, recording, this.output, {allowFixtures: this.loaded.allowFixtures, allowUnreviewed: !!this.loaded.allowUnreviewed});
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
    options = {...options};
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
        {...options, minimumFromFrame: earliest, fromLevelGain: outgoing.levelGain}, controller.signal, this.mixRuntime);
      if (!current()) return;
      if (ready.kind === 'fallback') { await useAuthoredFallback(ready.reason); return; }
      const loopBuffer = await prepareOutgoingLoop(this.context, outgoing.nativeRecording, ready.plan, outgoing.levelGain, controller.signal, this.mixRuntime);
      if (!current()) return;
      incoming = new RecordedSource(this.context, ready.incoming, this.output,
        {allowFixtures: this.loaded.allowFixtures, allowUnreviewed: !!this.loaded.allowUnreviewed, levelGain: ready.plan.levelMatch?.toGain ?? 1});
      await incoming.prepare(this.clock);
      if (!current()) { incoming.release(); incoming = null; return; }
      requireAudio(!this.plan, 'A transition already owns the next boundary.');
      let plan = ready.plan;
      let at = this.clock.stamp(from.start.at.frame + plan.fromExitFrame - entry + (plan.entryDelayFrames ?? 0));
      if (at.frame - (plan.entryDelayFrames ?? 0) - plan.preRollFrames < this.clock.currentFrame + this.leadFrames) {
        requireAudio(!plan.loopExtension, 'Finite loop missed its prepared native anchor; preserve A.');
        const later = replanPreparedMix(ready, Math.max(earliest,
          this.clock.currentFrame + this.leadFrames - from.start.at.frame + entry));
        requireAudio(later.kind === 'mix',
          'Prepared mix missed its exact audio-clock deadline; no later analyzed cue is available.');
        plan = later;
        at = this.clock.stamp(from.start.at.frame + plan.fromExitFrame - entry + (plan.entryDelayFrames ?? 0));
      }
      requireAudio(at.frame - (plan.entryDelayFrames ?? 0) - plan.preRollFrames >= this.clock.currentFrame + this.leadFrames,
        'Prepared mix missed its exact audio-clock deadline.');
      const effect = this.clock.stamp(at.frame - (plan.entryDelayFrames ?? 0) - plan.preRollFrames);
      const end = this.clock.stamp(at.frame + plan.overlapFrames);
      requireAudio(plan.fromExitFrame + plan.overlapFrames <= outgoing.recording.buffer.length &&
        ready.entryFrame + plan.overlapFrames <= ready.incoming.buffer.length,
      'Prepared mix sources do not cover the complete tail.');
      // The identity is unique to this live commit; native destinations never enter plan data.
      const outgoingAutomation = structuredClone(plan.automation.outgoing);
      incoming.scheduleMixStart(at, ready.entryFrame, plan.automation.incoming);
      // Outgoing A changes last. A refusal releases all prepared B effects before fallback.
      try {
        if (outgoingAutomation.echo) bindEchoReturn(outgoingAutomation, this.output);
        outgoing.transitionMixOut(effect, plan.fromExitFrame - plan.preRollFrames, outgoingAutomation,
          {...(plan.nativeRate ? {rate: plan.nativeRate.outgoing} : {}), ...(loopBuffer ? {loopBuffer} : {})});
      } finally { unbindEchoReturn(outgoingAutomation); }
      this.voices.push({source: incoming, start: {at, entryCueId: 'mix-entry'}});
      this.plan = {at, end};
      this.mix = {phase: 'scheduled', earliestEffect: effect,
        reason: 'B is ready; the selected recipe is scheduled on the owner clock. Listening and candidate evaluation are untested.',
        summary: {recipe: plan.recipe, fromBpm: plan.fromBpm, toBpm: plan.toBpm, tempoRatio: plan.tempoRatio,
          pitchSemitones: plan.pitchSemitones, confidence: plan.confidence,
          processor: ready.processed.processor, fromExitFrame: plan.fromExitFrame,
          toEntryFrame: plan.toEntryFrame, processedEntryFrame: ready.entryFrame,
          outputFrames: ready.incoming.buffer.length, returnToOriginalTempo: plan.returnToOriginalTempo,
          ...(plan.levelMatch ? {levelMatch: plan.levelMatch} : {}),
          ...(plan.entryDelayFrames ? {entryDelayFrames: plan.entryDelayFrames} : {}),
          ...(plan.nativeRate ? {nativeRate: plan.nativeRate} : {}), ...(plan.loopExtension ? {loopExtension: plan.loopExtension} : {}),
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
      const retained = this.voices[0];
      if (retained?.set) { const {motion: _cancelledMotion, ...set} = retained.set; retained.set = set; }
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
    if (!this.voices.length) {
      const selection = this.selected ?? (this.routeFree ? null : 'a');
      requireAudio(selection, 'Choose a set song first.');
      await this.playSelection(selection, ownership);
      return;
    }
    const operation = ++this.operation;
    this.abortMixPreparation();
    this.wantsRunning = true;
    this.state = 'loading';
    try {
      // Existing voices already unlocked this context on their initial gesture.
      // Keep their frozen timeline intact until ownership is admitted.
      await ownership;
      if (operation !== this.operation) return;
      await this.context.resume();
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
    if (this.routeFree) this.settleCompletedTransition();
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
    return {state: this.state, requested: this.requestedId(),
      now, next: pending?.source.reference.id ?? null, transition,
      transitionInSeconds: this.plan ? Math.max(0, (this.plan.at.frame - frame) / this.clock.sampleRate) : null,
      voices: this.voices.map(voice => ({source: {...voice.source.reference}, start: {...voice.start.at}, endFrame: voice.source.endFrame})),
      transitionAt: this.plan ? {...this.plan.at} : null,
      transitionEnd: this.plan ? {...this.plan.end} : null,
      handoff, mix: this.mix ? {...this.mix, phase: this.mix.summary && this.plan
        ? frame < this.plan.at.frame ? this.mix.earliestEffect && frame >= this.mix.earliestEffect.frame ? 'prelude' : 'scheduled' : frame < this.plan.end.frame ? 'mixing' : 'complete'
        : this.mix.phase, summary: this.mix.summary ? {...this.mix.summary} : null} : null,
      elapsedSeconds: first ? Math.max(0, Math.min(duration, (frame - first.start.at.frame) / this.clock.sampleRate)) : 0,
      durationSeconds: duration, currentFrame: frame, sampleRate: this.clock.sampleRate,
      engineGeneration: this.clock.engineGeneration, contextState: this.context.state,
      muted: this.muted, volume: this.volume};
  }

  /**
   * S17 phone streaming: an observational extra connection from the single master output
   * into a MediaStream. The output → destination path is unchanged, so the tap cannot
   * alter what the PC plays; repeated calls return the same stream.
   */
  createStreamTap(): MediaStream {
    requireAudio(this.state !== 'closed' && this.context.state !== 'closed', 'Player is closed. Reload the page.');
    if (!this.streamTap) {
      const tap = this.context.createMediaStreamDestination();
      this.output.connect(tap);
      this.streamTap = tap;
    }
    return this.streamTap.stream;
  }

  /** Removes only the S17 tap connection; safe to call when no tap exists. */
  releaseStreamTap(): void {
    const tap = this.streamTap;
    if (!tap) return;
    this.streamTap = null;
    try { this.output.disconnect(tap); } catch { /* already disconnected by dispose */ }
    for (const track of tap.stream.getTracks()) track.stop();
  }

  async dispose(): Promise<void> {
    if (this.state === 'closed') return;
    this.stop();
    this.state = 'closed';
    this.context.removeEventListener('statechange', this.stateChanged);
    this.releaseStreamTap();
    this.deckMixer?.release();
    this.output.disconnect();
    this.decodedPalette = null;
    this.decoded = null;
    this.setDecoded.clear();
    if (this.context.state !== 'closed') await this.context.close();
  }

  // ---------------------------------------------------------------------------------------
  // S18 set mode
  // ---------------------------------------------------------------------------------------

  /** S20 controls use this same owner; transport and source lifetime remain independent. */
  setDeckControl(side: DeckId, control: DeckControl, value: number): void { this.requireDeck(side).take(control, value); }
  returnDeckControl(side: DeckId, control: DeckControl): void { this.requireDeck(side).giveBack(control); }
  setCrossfader(value: number): void { this.requireDeck('a'); this.deckMixer!.setCrossfader(value); }
  returnCrossfader(): void { this.requireDeck('a'); this.deckMixer!.returnCrossfader(); }
  copyDeckWaveform(side: DeckId, target: Float32Array<ArrayBuffer>): void { this.requireDeck(side).waveform(target); }
  private requireDeck(side: DeckId) {
    requireAudio(this.deckMixer && (side === 'a' || side === 'b') && this.state !== 'closed' && this.context.state !== 'closed', 'A deck control needs an open set player.');
    return this.deckMixer[side];
  }
  deckSnapshot(): DeckSnapshot | null {
    if (!this.deckMixer) return null;
    const snap = this.snapshot(), active = this.voices.filter(v => v.set && snap.currentFrame >= v.start.at.frame && snap.currentFrame < v.source.endFrame).map(v => v.set!.deck);
    const controls = this.deckMixer.snapshot(active);
    const view = (side: DeckId): DeckView => {
      const voice = this.voices.find(v => v.set?.deck === side), set = voice?.set;
      if (!voice || !set || !(voice.source instanceof RecordedSource)) return {side, assetId: null, title: 'Deck ' + side.toUpperCase(),
        positionSeconds: 0, durationSeconds: 0, bpm: null, grid: 'requested', speed: 1, pitchSemitones: 0,
        pitchMode: 'original', live: false, controls: controls[side]};
      const pos = deckPositionAt({frame: snap.currentFrame, start: voice.start.at.frame, offset: set.offset,
        nativeFrames: voice.source.nativeRecording.buffer.length, mapping: set.mapping, entryRate: voice.source.nativeRate,
        ...(set.sourceStartFrame !== undefined ? {sourceStartFrame: set.sourceStartFrame} : {}),
        ...(set.nativeJoin ? {nativeJoin: set.nativeJoin} : {}), ...(set.motion ? {motion: set.motion} : {})});
      return {side, assetId: set.asset.id, title: set.asset.title, positionSeconds: pos.sourceFrame / snap.sampleRate,
        durationSeconds: set.asset.file.frames / set.asset.file.sample_rate, bpm: (set.bpm ?? set.asset.timing!.bpm) * pos.speed,
        grid: set.grid ?? 'requested', speed: pos.speed, pitchSemitones: pos.pitchSemitones, pitchMode: pos.pitchMode,
        live: snap.state === 'playing' && active.includes(side), controls: controls[side]};
    };
    return {a: view('a'), b: view('b'), crossfader: controls.crossfader};
  }

  /** Asset IDs of every set recording in pack (catalogue) order. */
  setSongs(): readonly AudioAsset[] {
    return this.loaded.pack.assets.filter(a => a.source_kind === 'recording');
  }

  /** Live UI supplies the worker dependency; test/offline consumers can supply their own gate. */
  private async checkSelectedMix(request: PrecheckRequest, signal: AbortSignal,
    current: () => boolean, retry = false): Promise<PrecheckReport | null | false> {
    if (!this.mixPrecheck) return null;
    this.mix = {phase: 'preparing', summary: null, reason: 'Checking the selected DJ plan before scheduling audio…'};
    let report: PrecheckReport;
    try { report = await this.mixPrecheck(request, signal); }
    catch (error) {
      if (!current()) return null;
      report = {version: PRECHECK_PROTOCOL, status: 'unavailable', evaluation: null, coverage: null,
        reason: error instanceof Error ? error.message : String(error)};
    }
    if (!current()) return null;
    const allowed = report.status === 'pass' || report.status === 'warn';
    // A worker error is not a candidate defect, so only a measured FAIL tries the next candidate.
    if (!allowed && retry && report.status === 'fail') {
      // S21: a rejected candidate is excluded and the next one is tried; nothing was scheduled.
      this.mix = {phase: 'preparing', summary: null, precheck: report, reason: precheckLabel(report) + '. Trying the next handover candidate…'};
      return false;
    }
    const reason = precheckLabel(report) + (allowed ? '. Your manual controls still apply.' : '. The playing song is unchanged.');
    this.mix = {phase: allowed ? 'preparing' : 'unavailable', summary: null, reason, precheck: report};
    requireAudio(allowed, reason);
    return report;
  }

  /**
   * Optional warm-up for the likely next song: decode and analyze it now so Next is quick.
   * Only this one song is retained beyond the playing voices.
   */
  async warmSetSong(assetId: string): Promise<SongAnalysisResult> {
    requireAudio(this.routeFree, 'Warm-up needs a set pack.');
    this.retainSetSongs([assetId]);
    const recording = await this.decodeSetSong(assetId);
    return this.analyses.analyzeSong(recording, this.mixRuntime);
  }

  /** S21 seeded explore mode for set handovers (null = deterministic Auto). Seeds advance per handover. */
  setTransitionExplore(seed: number | null): void {
    requireAudio(seed === null || Number.isSafeInteger(seed) && seed >= 0 && seed < 2 ** 31, 'Explore seed must be an integer from 0.');
    this.explore = seed === null ? null : {seed, next: seed};
  }
  get transitionExplore(): number | null { return this.explore?.seed ?? null; }
  private explore: {seed: number; next: number} | null = null;

  /** Whole-song B analysis, bounded by a deadline so Next never waits on new analysis for long. */
  private incomingAnalysis(recording: DecodedRecording, signal: AbortSignal): Promise<SongAnalysisResult> {
    const task = this.analyses.analyzeSong(recording, this.mixRuntime);
    task.catch(() => undefined);
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error('Mix preparation cancelled.')); return; }
      const timer = setTimeout(() => { cleanup(); resolve({ok: false,
        reason: 'Whole-song analysis of B is still running; a bounded non-cut handover is used (analysis continues for later).'}); },
      SET_SONG_ANALYSIS_DEADLINE_MS);
      const abort = (): void => { cleanup(); reject(new Error('Mix preparation cancelled.')); };
      const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      signal.addEventListener('abort', abort, {once: true});
      task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }

  /**
   * S18: schedule the playing set song → `targetId` at the requested bar boundary. Order:
   * analyzed blend, analyzed cut, then a route-free crossfade or clean cut. Never consults an
   * authored route. Preparation happens before commit; nothing is started by a timer.
   */
  async scheduleMixTo(targetId: string, boundary: SetBoundary = {bars: 4, anchor: 'song'}, options: MixPlannerOptions = {}): Promise<void> {
    options = {...options};
    requireAudio(this.routeFree, 'Set transitions need a set pack.');
    requireAudio(SET_BOUNDARY_BARS.includes(boundary.bars) && (boundary.anchor === 'song' || boundary.anchor === 'entry'),
      'Unsupported set boundary.');
    boundary = {...boundary};
    this.settleCompletedTransition();
    requireAudio(this.voices.length === 1 && !this.plan, 'Play a set song first. Only one transition can be scheduled.');
    const from = this.voices[0]!;
    requireAudio(from.source instanceof RecordedSource && from.set, 'A set transition starts from a set song.');
    const outgoing = from.source, fromSet = from.set;
    const toAsset = this.setSongs().find(a => a.id === targetId);
    requireAudio(toAsset, `Unknown set song ${targetId}.`);
    requireAudio(toAsset.id !== fromSet.asset.id, 'Choose a different song than the one playing.');
    requireAudio(eligibleForPlayback(toAsset, this.loaded.allowFixtures, this.loaded.allowUnreviewed), 'Song is not eligible.');
    const operation = this.operation, transitionOperation = this.transitionOperation;
    const controller = new AbortController();
    this.mixAbort?.abort(); this.mixAbort = controller;
    this.mix = {phase: 'preparing', reason: 'Decoding and analyzing the next song; no transition is scheduled.', summary: null};
    const current = (): boolean => operation === this.operation && transitionOperation === this.transitionOperation &&
      !controller.signal.aborted && this.voices.length === 1 && this.voices[0] === from;
    const rate = this.clock.sampleRate;
    let incoming: RecordedSource | null = null;
    try {
      this.retainSetSongs([targetId]);
      const nativeFrames = outgoing.nativeRecording.buffer.length;
      const requestedGrid = setBarGrid(fromSet.asset, null, rate);
      const currentBuffer = fromSet.offset + this.clock.currentFrame + this.leadFrames + 2 * rate - from.start.at.frame;
      const currentNative = outgoing.nativeRate ? outgoing.nativeFrameAtClock(this.clock.currentFrame + this.leadFrames + 2 * rate) : fromSet.nativeJoin && currentBuffer >= fromSet.nativeJoin.outputFrame
        ? fromSet.nativeJoin.sourceFrame + currentBuffer - fromSet.nativeJoin.outputFrame
        : fromSet.mapping ? (fromSet.sourceStartFrame ?? 0) + sourceFrameAtOutput(fromSet.mapping, currentBuffer) : currentBuffer;
      const entryNative = fromSet.mapping ? (fromSet.sourceStartFrame ?? 0) + sourceFrameAtOutput(fromSet.mapping, fromSet.offset) : fromSet.offset;
      const requestedAnchor = boundary.anchor === 'song' ? 0 : Math.max(0,
        Math.round((entryNative - downbeatAt(requestedGrid, 0)) / requestedGrid.barFrames));
      const targetBar = nextBoundary(requestedGrid, requestedAnchor, boundary.bars, currentNative).bar;
      // Roughly half a window of real context before the likely exit, aligned to the requested
      // grid. The measured window is rebound to native coordinates; its start is never bar 1.
      const contextBars = Math.max(4, 4 * Math.floor(SONG_ANALYSIS_WINDOW.seconds * rate / requestedGrid.barFrames / 8));
      const analysisStart = Math.min(nativeFrames - 1, Math.max(0, downbeatAt(requestedGrid, Math.max(0, targetBar - contextBars))));
      const fromAnalysis = this.analyses.analyze(outgoing.nativeRecording, this.mixRuntime, controller.signal, analysisStart);
      // An early return below must not leave this started analysis as an unhandled rejection.
      fromAnalysis.catch(() => undefined);
      const toRecording = await this.decodeSetSong(targetId);
      if (!current()) return;
      const [a, b] = await Promise.all([fromAnalysis, this.incomingAnalysis(toRecording, controller.signal)]);
      if (!current()) return;
      const analysisA = a.ok ? a.analysis : null, analysisB = b.ok ? b.analysis : null;
      // Native A frame now, and the earliest native A frame with a two-second preparation allowance.
      const toNative = (bufferFrame: number): number => outgoing.nativeRate ? outgoing.nativeFrameAtClock(from.start.at.frame + bufferFrame - fromSet.offset) : fromSet.nativeJoin && bufferFrame >= fromSet.nativeJoin.outputFrame
        ? fromSet.nativeJoin.sourceFrame + bufferFrame - fromSet.nativeJoin.outputFrame
        : fromSet.mapping ? (fromSet.sourceStartFrame ?? 0) + sourceFrameAtOutput(fromSet.mapping, bufferFrame) : bufferFrame;
      const toBuffer = (nativeFrame: number): number => outgoing.nativeRate ? nativeFrame : fromSet.nativeJoin && nativeFrame >= fromSet.nativeJoin.sourceFrame
        ? fromSet.nativeJoin.outputFrame + nativeFrame - fromSet.nativeJoin.sourceFrame
        : fromSet.mapping ? outputFrameAtSource(fromSet.mapping, nativeFrame - (fromSet.sourceStartFrame ?? 0)) : nativeFrame;
      const bufferAt = (clockFrame: number): number => fromSet.offset + clockFrame - from.start.at.frame;
      const settledNative = fromSet.nativeJoin?.sourceFrame ?? (fromSet.mapping?.returnToOriginal
        ? sourceFrameAtOutput(fromSet.mapping, fromSet.mapping.returnToOriginal.afterFrames + fromSet.mapping.returnToOriginal.rampFrames)
        : fromSet.mapping ? nativeFrames : 0);
      const earliestNative = (): number => Math.max(settledNative, toNative(fromSet.offset),
        toNative(bufferAt(this.clock.currentFrame + this.leadFrames + 2 * rate)));
      const grid = setBarGrid(fromSet.asset, analysisA, rate);
      const anchorBar = boundary.anchor === 'song' ? 0 : Math.max(0,
        Math.round((toNative(fromSet.offset) - downbeatAt(grid, 0)) / grid.barFrames));
      // S21: candidates are tried in policy order; a render, deadline or pre-check rejection excludes
      // that recipe and the next candidate is prepared. Nothing is scheduled until one passes.
      const exclude: string[] = [];
      const explore = this.explore ? {seed: this.explore.next} : null;
      const choose = (allowBlend: boolean): SetTransitionChoice => chooseSetTransition({
        from: {asset: fromSet.asset, analysis: analysisA, frames: nativeFrames},
        to: {asset: toAsset, analysis: analysisB, frames: toRecording.buffer.length,
          channels: allowBlend ? toRecording.buffer.numberOfChannels : Number.MAX_SAFE_INTEGER},
        sampleRate: rate, earliestFrame: earliestNative(), boundary: {bars: boundary.bars, anchorBar},
        options: {...options, fromLevelGain: outgoing.levelGain}, exclude, ...(explore ? {explore} : {})});
      if (!analysisB && !b.ok) this.mix = {phase: 'preparing', summary: null, reason: b.reason};
      type Prepared = Awaited<ReturnType<SmallPlayer['prepareSetIncoming']>>;
      let choice: SetTransitionChoice = choose(true);
      let prepared!: Prepared, at!: ClockStamp, loopBuffer: AudioBuffer | undefined, precheck: PrecheckReport | null = null;
      let lastRejected: PrecheckReport | null = null;
      const failedChecks: {recipe: string; reason: string}[] = [];
      const delayFor = (): number => 'entryDelayFrames' in prepared.plan ? prepared.plan.entryDelayFrames ?? 0 : 0;
      const atFor = (): ClockStamp => this.clock.stamp((outgoing.nativeRate ? outgoing.clockFrameAtNative(prepared.plan.fromExitFrame) :
        from.start.at.frame + toBuffer(prepared.plan.fromExitFrame) - fromSet.offset) + delayFor());
      for (let attempt = 1; ; attempt++) {
        if (choice.kind === 'unavailable') {
          const reason: string = lastRejected ? precheckLabel(lastRejected) + '. No other handover candidate passed; the playing song is unchanged.' : choice.reason;
          this.mix = {phase: 'unavailable', reason, summary: null, ...(lastRejected ? {precheck: lastRejected} : {})};
          requireAudio(false, reason);
        }
        prepared = await this.prepareSetIncoming(choice, toRecording, analysisA, analysisB, controller.signal)
          .catch(async error => {
            if (!current()) throw error;
            // A failed blend render falls back to native B; nothing has been scheduled yet.
            choice = choose(false);
            if (choice.kind === 'unavailable') throw error;
            return this.prepareSetIncoming(choice, toRecording, analysisA, analysisB, controller.signal);
          });
        if (!current()) return;
        at = atFor();
        if (at.frame - delayFor() - prepared.plan.preRollFrames < this.clock.currentFrame + this.leadFrames) {
          // Preparation outlasted its allowance: re-choose a later bar with native B (no re-render).
          choice = choose(false);
          requireAudio(choice.kind !== 'unavailable', 'The set transition missed its audio-clock deadline and no later bar remains.');
          prepared = await this.prepareSetIncoming(choice, toRecording, analysisA, analysisB, controller.signal);
          if (!current()) return;
          at = atFor();
        }
        loopBuffer = undefined;
        try {
          if ('loopExtension' in prepared.plan) loopBuffer = await prepareOutgoingLoop(this.context, outgoing.nativeRecording, prepared.plan, outgoing.levelGain, controller.signal, this.mixRuntime);
        } catch (error) {
          if (!current()) throw error;
          choice = choose(false);
          requireAudio(choice.kind !== 'unavailable', 'Loop preparation failed and no native fallback boundary remains.');
          prepared = await this.prepareSetIncoming(choice, toRecording, analysisA, analysisB, controller.signal);
          at = atFor();
        }
        if (loopBuffer && at.frame - delayFor() - prepared.plan.preRollFrames < this.clock.currentFrame + this.leadFrames) {
          choice = choose(false);
          requireAudio(choice.kind !== 'unavailable', 'Finite loop missed S and no native fallback boundary remains.');
          prepared = await this.prepareSetIncoming(choice, toRecording, analysisA, analysisB, controller.signal);
          at = atFor(); loopBuffer = undefined;
        }
        if (!current()) return;
        const candidate = prepared.plan;
        const effectFrame = at.frame - delayFor() - candidate.preRollFrames;
        requireAudio(effectFrame >= this.clock.currentFrame + this.leadFrames, 'The set transition missed its audio-clock deadline.');
        const candidateExit = toBuffer(candidate.fromExitFrame);
        // The outgoing deck consumes A for its whole automation, measured from the effect (exit minus pre-roll).
        const aNeeds = candidate.automation.outgoing.durationFrames - candidate.preRollFrames;
        requireAudio(candidateExit + aNeeds <= outgoing.playbackFrames &&
          prepared.entryFrame + candidate.overlapFrames <= prepared.incoming.buffer.length,
        'The set transition does not have enough audio for its handover.');
        const report = await this.checkSelectedMix({plan: candidate, from: outgoing.nativeRecording, to: toRecording,
          incoming: prepared.incoming, entryFrame: prepared.entryFrame, fromGain: outgoing.levelGain,
          ...(loopBuffer ? {loopBuffer} : {}), analysis: {from: analysisA, to: analysisB},
          fromPlayback: {recording: outgoing.recording, entryFrame: fromSet.offset, elapsedFrames: effectFrame - from.start.at.frame}},
        controller.signal, current, attempt < SET_CANDIDATE_ATTEMPTS);
        if (!current()) return;
        if (report !== false) { precheck = report; break; }
        lastRejected = this.mix?.precheck ?? null;
        // S21: exclude this parameterisation only (recipe + boundary + overlap + choreography), not its whole recipe family.
        const failedSignature = transitionSignature(candidate, (choice as Exclude<SetTransitionChoice, {kind: 'unavailable'}>).exitBar);
        exclude.push(failedSignature);
        if (lastRejected) failedChecks.push({recipe: failedSignature, reason: precheckLabel(lastRejected)});
        choice = choose(true);
      }
      const plan = prepared.plan;
      const effect = this.clock.stamp(at.frame - delayFor() - plan.preRollFrames);
      const exitBuffer = toBuffer(plan.fromExitFrame);
      if (!current()) return;
      requireAudio(effect.frame >= this.clock.currentFrame + this.leadFrames,
        'The checked set transition missed its audio-clock deadline. Request Next again.');
      const deck: DeckId = fromSet.deck === 'a' ? 'b' : 'a';
      incoming = new RecordedSource(this.context, prepared.incoming, this.deckMixer![deck].input,
        {allowFixtures: this.loaded.allowFixtures, allowUnreviewed: !!this.loaded.allowUnreviewed,
          levelGain: 'levelMatch' in plan ? plan.levelMatch?.toGain ?? 1 : 1, mixer: this.deckMixer![deck].createOwner()});
      await incoming.prepare(this.clock);
      if (!current()) { incoming.release(); incoming = null; return; }
      requireAudio(!this.plan, 'A transition already owns the next boundary.');
      requireAudio(effect.frame >= this.clock.currentFrame + this.leadFrames, 'The set transition missed its audio-clock deadline.');
      const outgoingAutomation = structuredClone(plan.automation.outgoing);
      incoming.scheduleMixStart(at, prepared.entryFrame, plan.automation.incoming);
      // Outgoing A changes last; a refusal releases the prepared B and leaves A unchanged.
      outgoing.transitionMixOut(effect, exitBuffer - plan.preRollFrames, outgoingAutomation,
        {...('nativeRate' in plan && plan.nativeRate ? {rate: plan.nativeRate.outgoing} : {}), ...(loopBuffer ? {loopBuffer} : {})});
      const joinAt = prepared.nativeJoin ? this.clock.stamp(at.frame + prepared.nativeJoin.outputFrame - prepared.entryFrame) : null;
      // The next request may prepare while B returns to native tempo; its voice still owns
      // both the finishing entry and the ahead-scheduled native join.
      const end = this.clock.stamp(Math.max(effect.frame + plan.automation.outgoing.durationFrames,
        at.frame + plan.automation.incoming.durationFrames));
      const picked = choice as Exclude<SetTransitionChoice, {kind: 'unavailable'}>;
      // A clean cut reached only after measured pre-check FAILs is a fallback, never a plain pass.
      const cutAfterFail = failedChecks.length > 0 && (picked.plan.recipe === 'cut' || picked.plan.recipe === 'fallback-cut');
      const chosen: typeof picked = failedChecks.length ? {...picked,
        why: [...(picked.why ?? []), ...(cutAfterFail ? [`Clean cut (last resort) reached after ${failedChecks.length} failed pre-check${failedChecks.length > 1 ? 's' : ''}; the check on the cut itself is not a plain pass.`] : [])],
        rejected: [...(picked.rejected ?? []), ...failedChecks]} : picked;
      const record = setTransitionRecord(chosen, {id: fromSet.asset.id, sha256: fromSet.asset.file.sha256},
        {id: toAsset.id, sha256: toAsset.file.sha256, frames: toRecording.buffer.length}, rate, explore ? 'explore' : options.recipe && options.recipe !== 'auto' ? 'manual' : 'auto', explore?.seed ?? null);
      from.set = {...fromSet, bpm: plan.fromBpm, grid: chosen.fromGrid.source,
        motion: {at: effect.frame, sourceFrame: plan.fromExitFrame - plan.preRollFrames,
          ...('nativeRate' in plan && plan.nativeRate ? {rate: plan.nativeRate.outgoing} : {}),
          ...(loopBuffer ? {loopFrames: delayFor()} : {})}};
      this.voices.push({source: incoming, start: {at, entryCueId: 'mix-entry'},
        set: {asset: toAsset, deck, bpm: plan.toBpm, grid: chosen.toGrid.source, offset: prepared.entryFrame, mapping: prepared.mapping,
          ...(prepared.sourceStartFrame !== undefined ? {sourceStartFrame: prepared.sourceStartFrame} : {}),
          ...(prepared.nativeJoin ? {nativeJoin: prepared.nativeJoin} : {})}});
      this.plan = {at, end};
      const tempoRatio = 'tempoRatio' in plan ? plan.tempoRatio : 1;
      this.mix = {phase: 'scheduled', earliestEffect: effect, ...(precheck ? {precheck} : {}),
        ...(cutAfterFail ? {fallbackAfterFailedPrecheck: {failedChecks: failedChecks.length, last: failedChecks.at(-1)!.reason}} : {}),
        reason: `${chosen.kind === 'route-free' ? chosen.plan.reason : `Analyzed ${plan.recipe} at bar ${chosen.exitBar + 1}.`} ${precheck ? (cutAfterFail
          ? `Fallback after ${failedChecks.length} failed pre-check${failedChecks.length > 1 ? 's' : ''} (last: ${failedChecks.at(-1)!.reason}); the cut itself: ${precheckLabel(precheck)}`
          : precheckLabel(precheck)) + '. ' : ''}Listening is untested.`,
        summary: {recipe: plan.recipe, fromBpm: plan.fromBpm, toBpm: plan.toBpm, tempoRatio,
          pitchSemitones: 'pitchSemitones' in plan ? plan.pitchSemitones : 0,
          confidence: 'confidence' in plan ? plan.confidence : 0, processor: prepared.processor,
          fromExitFrame: plan.fromExitFrame, toEntryFrame: plan.toEntryFrame, processedEntryFrame: prepared.entryFrame,
          outputFrames: prepared.incoming.buffer.length,
          ...(prepared.nativeJoin ? {nativeJoin: {...prepared.nativeJoin, at: joinAt!}} : {}),
          ...('levelMatch' in plan && plan.levelMatch ? {levelMatch: plan.levelMatch} : {}),
          ...('entryDelayFrames' in plan && plan.entryDelayFrames ? {entryDelayFrames: plan.entryDelayFrames} : {}),
          ...('nativeRate' in plan && plan.nativeRate ? {nativeRate: plan.nativeRate} : {}),
          ...('loopExtension' in plan && plan.loopExtension ? {loopExtension: plan.loopExtension} : {}),
          returnToOriginalTempo: 'returnToOriginalTempo' in plan ? plan.returnToOriginalTempo : false,
          fromHash: fromSet.asset.file.sha256, toHash: toAsset.file.sha256,
          set: {fromId: fromSet.asset.id, toId: toAsset.id, exitBar: chosen.exitBar + 1, boundaryBar: chosen.boundaryBar + 1,
            boundaryBars: boundary.bars, anchor: boundary.anchor, fromGrid: chosen.fromGrid.source,
            toGrid: chosen.toGrid.source, tempoChange: plan.toBpm / plan.fromBpm, notes: [...chosen.notes],
            transition: record, why: [...(chosen.why ?? [])],
            ...('choreography' in plan && plan.choreography ? {choreography: plan.choreography.description} : {}),
            entry: {seconds: plan.toEntryFrame / rate, fraction: plan.toEntryFrame / toRecording.buffer.length,
              rank: 'entry' in plan ? plan.entry?.rank ?? null : null}}}};
      if (explore && this.explore) this.explore = {...this.explore, next: (this.explore.next + 1) % 2 ** 31};
      incoming = null; // ownership transferred to this.voices
      this.retainSetSongs([]);
    } catch (error) {
      incoming?.release(); incoming = null;
      if (current()) {
        if (this.mix?.phase !== 'unavailable') this.mix = {phase: 'unavailable', summary: null,
          reason: `${error instanceof Error ? error.message : String(error)} The playing song is unchanged.`};
        throw error;
      }
    } finally {
      // Release the prepared decode on success, abort, unavailable and failure alike; a newer
      // scheduleMixTo (which replaced mixAbort) owns the retained set from then on.
      const superseded = this.mixAbort !== controller && this.mixAbort !== null;
      if (this.mixAbort === controller) this.mixAbort = null;
      if (!superseded) this.retainSetSongs([]);
    }
  }

  private async prepareSetIncoming(choice: SetTransitionChoice, to: DecodedRecording,
    analysisA: MixAnalysis | null, analysisB: MixAnalysis | null, signal: AbortSignal): Promise<{
      plan: Exclude<SetTransitionChoice, {kind: 'unavailable'}>['plan']; incoming: DecodedRecording;
      entryFrame: number; mapping: TimePitchMapping | null; processor: string;
      sourceStartFrame?: number; nativeJoin?: {sourceFrame: number; outputFrame: number}}> {
    requireAudio(choice.kind !== 'unavailable', choice.kind === 'unavailable' ? choice.reason : '');
    if (choice.kind === 'analyzed' && ['tempo-ramp', 'brake'].includes(choice.plan.recipe)) {
      const ready = await renderPlannedMix(this.context, {buffer: {length: choice.plan.fromFrames}}, to, choice.plan,
        {from: analysisA!, to: analysisB!}, signal, this.mixRuntime);
      return {plan: ready.plan, incoming: ready.incoming, entryFrame: ready.entryFrame, mapping: null, processor: ready.processed.processor};
    }
    if (choice.kind === 'analyzed' && isBeatmatchedRecipe(choice.plan.recipe)) {
      const ready = await renderSetBlend(this.context, to, choice.plan, analysisB!, signal, this.mixRuntime);
      return {plan: ready.plan, incoming: ready.incoming, entryFrame: ready.entryFrame,
        mapping: ready.mapping, sourceStartFrame: ready.sourceStartFrame, nativeJoin: ready.nativeJoin,
        processor: ready.processor};
    }
    // Cut and route-free recipes play the verified native B buffer directly.
    return {plan: choice.plan, incoming: to, entryFrame: choice.plan.toEntryFrame, mapping: null, processor: 'native-pcm@1'};
  }

  /** Release voices of a completed set transition and return the new song to a direct connection. */
  private settleCompletedTransition(): void {
    if (!this.plan || this.voices.length < 2 || this.clock.currentFrame < this.plan.end.frame) return;
    if (this.hybrid || !this.voices.every(v => v.set)) return;
    const last = this.voices.at(-1)!;
    for (const voice of this.voices.slice(0, -1)) voice.source.release();
    this.voices = [last];
    if (last.source instanceof RecordedSource) last.source.settleMixEntry();
    this.plan = null;
    this.mix = null;
  }

  private decodeSetSong(assetId: string): Promise<DecodedRecording> {
    const existing = this.setDecoded.get(assetId);
    if (existing) return existing;
    const asset = this.setSongs().find(a => a.id === assetId);
    if (!asset) return Promise.reject(new Error(`Unknown set song ${assetId}.`));
    const task = decodeRecording(this.loaded, this.context, asset).then(recording => {
      try { this.analyses.observe?.(recording); } catch { /* Display summaries never block audio. */ }
      return recording;
    }).catch(error => {
      if (this.setDecoded.get(assetId) === task) this.setDecoded.delete(assetId);
      throw error;
    });
    this.setDecoded.set(assetId, task);
    return task;
  }

  /** Keep only these decoded songs in the cache; playing voices own their own buffers. */
  private retainSetSongs(ids: readonly string[]): void {
    for (const id of [...this.setDecoded.keys()]) if (!ids.includes(id)) this.setDecoded.delete(id);
  }

  private requestedId(): string | null {
    const selected = this.selected;
    if (selected === null) return null;
    if (selected === 'a') return this.pair.from.id;
    if (selected === 'b') return this.pair.to.id;
    if ('assetId' in selected) return this.voices.at(-1)?.set?.asset.id ?? selected.assetId;
    return selected.recipe.id;
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
