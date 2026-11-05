import type {LoadedBrowserPack} from './browser-pack.js';
import {sha256} from './audio.js';
import {eligibleForPlayback, quartersToFrames} from './pack.js';
import type {AudioClock, ClockStamp, PlayableSource, SourceExit, SourceStart} from './playable-source.js';
import {assertCompiledS01Phrase, compilePhrase, type ProceduralPlan, type S01PhraseRole} from './phrase-plan.js';
import {requireAudio, WebAudioClock, type DecodedRecording} from './web-audio.js';

/** Four resident samples, not a rendered-song cache. The limit counts Float32 samples;
 * the S06 role length bounds keep any contract palette under it at 192 kHz stereo. */
export const MAX_PROCEDURAL_SAMPLE_VALUES = 1024 * 1024;
export const MAX_PROCEDURAL_EVENTS = 256;
export const MAX_PROCEDURAL_VOICES = 4;

function checkRate(rate: number): void {
  requireAudio(Number.isInteger(rate) && rate >= 8000 && rate <= 192000,
    'The finite sampler supports output rates from 8000 through 192000 Hz.');
}

/** Recheck every intent even when the owner can reuse its verified decoded palette. */
export function checkProceduralPlan(loaded: LoadedBrowserPack, plan: ProceduralPlan): void {
  assertCompiledS01Phrase(plan);
  const rebound = compilePhrase(loaded.pack,
    {recipe: plan.recipe, seed: plan.seed, state: plan.state, allowFixtures: loaded.allowFixtures});
  requireAudio(JSON.stringify(rebound) === JSON.stringify(plan), 'Procedural plan does not match this pack revision.');
}

/** The pack loader verifies file hashes before this bounded, off-deadline decode. */
export async function decodeProceduralSamples(loaded: LoadedBrowserPack, context: BaseAudioContext,
  plan: ProceduralPlan): Promise<DecodedRecording[]> {
  checkProceduralPlan(loaded, plan);
  checkRate(context.sampleRate);
  const assets = plan.samples.map(binding => {
    const asset = loaded.pack.assets.find(a => a.id === binding.asset.id && a.revision === binding.asset.revision);
    requireAudio(asset && asset.source_kind === 'sample', 'A procedural sample is missing.');
    requireAudio(eligibleForPlayback(asset, loaded.allowFixtures) && asset.rights.allowed_uses.includes('sample-reuse'),
      'Procedural samples require playback and sample-reuse permission and eligible review status.');
    return asset;
  });
  requireAudio(assets.reduce((sum, a) => sum +
    Math.ceil(a.file.frames * context.sampleRate / a.file.sample_rate) * a.file.channels, 0) <= MAX_PROCEDURAL_SAMPLE_VALUES,
  'Procedural samples exceed the 4 MiB decoded memory budget.');
  const result: DecodedRecording[] = [];
  for (const asset of assets) {
    const resident = loaded.files.get(asset.file.path);
    requireAudio(resident, `Missing verified sample bytes: ${asset.id}`);
    const bytes = new Uint8Array(resident);
    requireAudio(bytes.length === asset.file.bytes && await sha256(bytes) === asset.file.sha256,
      `Sample bytes no longer match their bound hash: ${asset.id}`);
    const buffer = await context.decodeAudioData(bytes.buffer);
    requireAudio(buffer.sampleRate === context.sampleRate && buffer.numberOfChannels === asset.file.channels &&
      Math.abs(buffer.length - Math.round(asset.file.frames * context.sampleRate / asset.file.sample_rate)) <= 1,
    `Unexpected decoded sample format: ${asset.id}`);
    result.push({asset, buffer});
  }
  return result;
}

/**
 * A bar-aligned span of the phrase in which only the named roles may sound.
 * S05 uses one before full entry (lead-in) and one after a role handoff exit (tail).
 */
export interface RoleWindow {
  readonly quarters: number;
  readonly roles: readonly S01PhraseRole[];
}

const phraseRoles: readonly S01PhraseRole[] = ['drum', 'percussion', 'bass', 'harmony'];

/** Copy and check a role window so later caller mutation cannot change a schedule. */
export function checkRoleWindow(window: RoleWindow, plan: ProceduralPlan): RoleWindow {
  requireAudio(Number.isSafeInteger(window.quarters) && window.quarters >= 0 && window.quarters % 4 === 0 &&
    window.quarters <= plan.durationQuarters, 'A role window spans whole bars inside the finite phrase.');
  const roles = [...window.roles];
  requireAudio(roles.every(role => phraseRoles.includes(role)) && new Set(roles).size === roles.length,
    'A role window names distinct performer roles.');
  return Object.freeze({quarters: window.quarters, roles: Object.freeze(roles)});
}

export interface ProceduralOptions {
  readonly allowFixtures?: boolean;
  readonly fadeInFrames?: number;
  readonly fadeOutFrames?: number;
  /** Phrase events before `quarters` sound only for these roles; others are never allocated. */
  readonly leadIn?: RoleWindow;
}

interface Note {
  readonly node: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly role: S01PhraseRole;
  readonly startFrame: number;
  readonly naturalEndFrame: number;
  started: boolean;
}

/**
 * One finite, native sampler performance on the caller's existing audio clock.
 * All note times are committed together; timers and UI polling never trigger notes.
 * The event plan is compiled ahead, and at most four notes can sound at once.
 */
export class ProceduralSource implements PlayableSource {
  readonly kind = 'procedural' as const;
  readonly reference;
  private phase: 'new' | 'prepared' | 'scheduled' | 'stopping' | 'ended' | 'released' = 'new';
  private clock: WebAudioClock | null = null;
  private generation = -1;
  private output: GainNode | null = null;
  private mixBuses: GainNode[] = [];
  private notes = new Set<Note>();
  private samples: readonly DecodedRecording[];
  private readonly fadeIn: number;
  private readonly fadeOut: number;
  private start: SourceStart | null = null;
  private finishFrame = 0;
  private naturalEndFrame = 0;
  private transitionFrame: number | null = null;
  private allocatedNotes = 0;
  readonly leadIn: RoleWindow | null;
  private retainedAfterExit: RoleWindow | null = null;

  constructor(private readonly context: BaseAudioContext, readonly plan: ProceduralPlan,
    samples: readonly DecodedRecording[], private readonly destination: AudioNode,
    private readonly options: ProceduralOptions = {}) {
    assertCompiledS01Phrase(plan);
    this.reference = Object.freeze({...plan.recipe});
    // Metadata cannot change between preparation and scheduling through the caller's array.
    this.samples = samples.map(({asset, buffer}) => ({asset: structuredClone(asset), buffer}));
    this.fadeIn = options.fadeInFrames ?? 0;
    this.fadeOut = options.fadeOutFrames ?? 0;
    requireAudio([this.fadeIn, this.fadeOut].every(n => Number.isSafeInteger(n) && n >= 0),
      'Fades must use nonnegative integer output frames.');
    this.leadIn = options.leadIn ? checkRoleWindow(options.leadIn, plan) : null;
  }

  async prepare(clock: AudioClock): Promise<void> {
    requireAudio(this.phase === 'new', 'Prepare a source once.');
    requireAudio(clock instanceof WebAudioClock && clock.context === this.context,
      'A source must retain its owner context and clock by identity.');
    requireAudio(this.destination.context === this.context, 'Output belongs to another context.');
    requireAudio(this.context.state !== 'closed', 'Cannot prepare a closed context.');
    checkRate(clock.sampleRate);
    requireAudio(this.plan.events.length > 0 && this.plan.events.length <= MAX_PROCEDURAL_EVENTS,
      'The finite sampler event budget is exceeded.');
    requireAudio(this.samples.length === this.plan.samples.length, 'Provide exactly the bound palette samples.');
    let values = 0;
    for (const binding of this.plan.samples) {
      const matches = this.samples.filter(s => s.asset.id === binding.asset.id && s.asset.revision === binding.asset.revision);
      requireAudio(matches.length === 1, `Missing or duplicate decoded sample: ${binding.asset.id}`);
      const {asset, buffer} = matches[0]!;
      requireAudio(asset.source_kind === 'sample' && asset.file.sha256 === binding.asset.file.sha256 &&
        asset.file.frames === binding.asset.file.frames && asset.file.sample_rate === binding.asset.file.sample_rate &&
        asset.file.channels === binding.asset.file.channels, `Decoded sample metadata differs from the plan: ${asset.id}`);
      requireAudio(eligibleForPlayback(asset, this.options.allowFixtures) && asset.rights.allowed_uses.includes('sample-reuse') &&
        eligibleForPlayback(binding.asset, this.options.allowFixtures) && binding.asset.rights.allowed_uses.includes('sample-reuse'),
        'Procedural samples require playback and sample-reuse permission and eligible review status.');
      requireAudio(JSON.stringify(asset) === JSON.stringify(binding.asset), 'Decoded sample metadata differs from the bound plan.');
      requireAudio(buffer.sampleRate === clock.sampleRate && buffer.numberOfChannels === asset.file.channels &&
        Math.abs(buffer.length - Math.round(asset.file.frames * clock.sampleRate / asset.file.sample_rate)) <= 1,
      `Decoded buffer does not match the sample and output sample rate: ${asset.id}`);
      values += buffer.length * buffer.numberOfChannels;
    }
    requireAudio(values <= MAX_PROCEDURAL_SAMPLE_VALUES, 'Procedural samples exceed the 4 MiB decoded memory budget.');
    const duration = quartersToFrames(this.plan.durationQuarters, this.plan.bpm, clock.sampleRate);
    requireAudio(this.fadeIn <= duration && this.fadeOut <= duration, 'Fades exceed the finite performance.');
    this.clock = clock;
    this.generation = clock.engineGeneration;
    this.output = this.context.createGain();
    this.output.gain.value = 0;
    this.output.connect(this.destination);
    this.phase = 'prepared';
  }

  scheduleStart(start: SourceStart): void {
    requireAudio(this.phase === 'prepared', 'Prepare before start; start each source once.');
    this.checkStamp(start.at);
    requireAudio(start.entryCueId === 'entry', 'The first sampler supports only its zero entry cue.');
    const rate = this.clock!.sampleRate;
    const endFrame = start.at.frame + quartersToFrames(this.plan.durationQuarters, this.plan.bpm, rate);
    requireAudio(Number.isSafeInteger(endFrame), 'Performance end exceeds the audio-clock frame range.');
    const leadIn = this.leadIn;
    const audible = this.plan.events.filter(event =>
      !leadIn || event.atQuarters >= leadIn.quarters || leadIn.roles.includes(event.role));
    requireAudio(audible.length > 0, 'The role lead-in leaves no phrase events.');
    const prepared = audible.map(event => {
      const sample = this.samples.find(s => s.asset.id === event.sample.id && s.asset.revision === event.sample.revision)!;
      const frame = start.at.frame + quartersToFrames(event.atQuarters, this.plan.bpm, rate);
      // A decoder may round its natural EOF by one frame. Never overlap the next
      // same-role event or extend the declared phrase because of that padding.
      const nativeOffset = quartersToFrames(event.atQuarters, this.plan.bpm, sample.asset.file.sample_rate);
      const authoredEnd = start.at.frame + Math.round((nativeOffset + sample.asset.file.frames) *
        rate / sample.asset.file.sample_rate);
      const frames = Math.min(sample.buffer.length, authoredEnd - frame);
      requireAudio(frame + frames <= endFrame, 'A sample tail exceeds the declared finite phrase.');
      return {event, sample, frame, end: frame + frames};
    });
    const boundaries = prepared.flatMap(note => [{frame: note.frame, delta: 1, role: note.event.role},
      {frame: note.end, delta: -1, role: note.event.role}])
      .sort((a, b) => a.frame - b.frame || a.delta - b.delta);
    let voices = 0;
    const roleVoices = new Map<S01PhraseRole, number>();
    for (const boundary of boundaries) {
      voices += boundary.delta;
      requireAudio(voices <= MAX_PROCEDURAL_VOICES, 'The finite sampler polyphony budget is exceeded.');
      const count = (roleVoices.get(boundary.role) ?? 0) + boundary.delta;
      requireAudio(count <= 1, `The finite sampler allows only one active note per role: ${boundary.role}.`);
      roleVoices.set(boundary.role, count);
    }
    try {
      // Keep the master muted until the entire schedule is committed successfully.
      // Fix the grouping of Float32 sums: rhythm and pitched pairs each have at
      // most two active signals, and the master receives only those two buses.
      // Register each allocation before any later native operation can fail.
      for (let pair = 0; pair < 2; pair++) {
        const bus = this.context.createGain();
        this.mixBuses.push(bus);
        bus.gain.value = 1;
        bus.connect(this.output!);
      }
      for (const item of prepared) {
        const node = this.context.createBufferSource();
        const gain = this.context.createGain();
        const note: Note = {node, gain, role: item.event.role, startFrame: item.frame, naturalEndFrame: item.end, started: false};
        this.notes.add(note);
        this.allocatedNotes++;
        node.buffer = item.sample.buffer;
        gain.gain.value = item.event.gain;
        node.connect(gain);
        gain.connect(this.mixBuses[item.event.role === 'drum' || item.event.role === 'percussion' ? 0 : 1]!);
        node.onended = () => {
          node.onended = null;
          node.disconnect(); gain.disconnect(); this.notes.delete(note);
          if (this.notes.size === 0 && this.phase !== 'released') {
            this.phase = 'ended';
            this.releaseMixBuses();
            this.output?.disconnect();
          }
        };
      }
      this.checkStamp(start.at);
      for (const note of this.notes) {
        note.node.start(note.startFrame / rate);
        note.started = true;
        note.node.stop(note.naturalEndFrame / rate);
      }
      // A slow native allocation/scheduling pass fails silent instead of accepting a late first note.
      this.checkStamp(start.at);
      this.output!.gain.setValueAtTime(this.fadeIn ? 0 : 1, start.at.frame / rate);
      if (this.fadeIn) this.output!.gain.linearRampToValueAtTime(1, (start.at.frame + this.fadeIn) / rate);
      this.start = {at: {...start.at}, entryCueId: start.entryCueId};
      this.finishFrame = this.naturalEndFrame = endFrame;
      this.phase = 'scheduled';
    } catch (error) {
      this.release();
      throw error;
    }
  }

  getValidExits(): readonly SourceExit[] {
    requireAudio(this.phase === 'prepared' || this.phase === 'scheduled', 'Source must be ready.');
    this.checkGeneration();
    return [{cueId: 'phrase', offsetFrames: quartersToFrames(16, this.plan.bpm, this.clock!.sampleRate)},
      {cueId: 'end', offsetFrames: quartersToFrames(this.plan.durationQuarters, this.plan.bpm, this.clock!.sampleRate)}];
  }

  /**
   * Without `retain`, the whole performance fades after the exit (S04). With `retain`
   * (S05 role handoff), roles outside the window never attack at or after the exit,
   * retained roles may sound only inside the window under the output fade, and any
   * other note still sounding at the exit is refused before a native effect.
   */
  transitionOut(exitCueId: string, at: ClockStamp, retain?: RoleWindow): void {
    requireAudio(this.phase === 'scheduled' && this.start, 'Start before transition; transition once.');
    this.checkStamp(at);
    const exit = this.getValidExits().find(item => item.cueId === exitCueId);
    requireAudio(exit && at.frame === this.start.at.frame + exit.offsetFrames, 'Transition must align to a declared phrase exit.');
    requireAudio(at.frame >= this.start.at.frame + this.fadeIn, 'Transition cannot precede the completed entry fade.');
    const rate = this.clock!.sampleRate;
    const window = retain ? checkRoleWindow(retain, this.plan) : null;
    const fade = window ? quartersToFrames(window.quarters, this.plan.bpm, rate) : this.fadeOut;
    requireAudio(at.frame + fade <= this.naturalEndFrame, 'Transition fade exceeds the finite performance.');
    const fadeEnd = at.frame + fade;
    // Decide every note first: a refusal leaves the committed schedule untouched.
    const stops = [...this.notes].map(note => {
      if (!window) return {note, frame: Math.min(note.naturalEndFrame, fadeEnd)};
      const retained = window.roles.includes(note.role);
      // Stopping at the start frame keeps a future one-shot from producing any frame.
      if (note.startFrame >= (retained ? fadeEnd : at.frame)) return {note, frame: note.startFrame};
      requireAudio(retained || note.naturalEndFrame <= at.frame,
        `A ${note.role} note would still sound after the role handoff exit.`);
      return {note, frame: Math.min(note.naturalEndFrame, fadeEnd)};
    });
    this.output!.gain.setValueAtTime(1, at.frame / rate);
    if (fade) this.output!.gain.linearRampToValueAtTime(0, fadeEnd / rate);
    else this.output!.gain.setValueAtTime(0, at.frame / rate);
    for (const {note, frame} of stops) note.node.stop(frame / rate);
    this.finishFrame = fadeEnd;
    this.transitionFrame = at.frame;
    this.retainedAfterExit = window;
    this.phase = 'stopping';
  }

  cancelTransition(): boolean {
    if (this.transitionFrame === null) return true;
    this.checkGeneration();
    if (this.clock!.currentFrame >= this.transitionFrame) return false;
    const frame = this.transitionFrame, rate = this.clock!.sampleRate;
    this.output!.gain.cancelScheduledValues(frame / rate);
    if (this.start!.at.frame >= frame) this.output!.gain.setValueAtTime(this.fadeIn ? 0 : 1, this.start!.at.frame / rate);
    if (this.fadeIn && this.start!.at.frame + this.fadeIn >= frame) {
      this.output!.gain.linearRampToValueAtTime(1, (this.start!.at.frame + this.fadeIn) / rate);
    }
    for (const note of this.notes) note.node.stop(note.naturalEndFrame / rate);
    this.finishFrame = this.naturalEndFrame;
    this.transitionFrame = null;
    this.retainedAfterExit = null;
    this.phase = 'scheduled';
    return true;
  }

  stop(at: ClockStamp): void {
    requireAudio(this.phase === 'scheduled' && this.start, 'Start before stop.');
    this.checkStamp(at);
    requireAudio(at.frame >= this.start.at.frame, 'Stop follows start; use release to cancel a future start.');
    requireAudio(at.frame <= this.naturalEndFrame, 'Stop cannot extend the finite performance.');
    const when = at.frame / this.clock!.sampleRate;
    this.output!.gain.cancelScheduledValues(when);
    this.output!.gain.setValueAtTime(0, when);
    for (const note of this.notes) note.node.stop(Math.min(note.naturalEndFrame, at.frame) / this.clock!.sampleRate);
    this.finishFrame = at.frame;
    this.phase = 'stopping';
  }

  /** Cleanup remains legal after clock invalidation, before entry, or after partial failure. */
  release(): void {
    if (this.phase === 'released') return;
    this.phase = 'released';
    for (const note of this.notes) {
      note.node.onended = null;
      if (note.started) {
        try { note.node.stop(this.context.currentTime); } catch { /* A closed native context still needs disconnection. */ }
      }
      note.node.disconnect(); note.gain.disconnect();
    }
    this.notes.clear();
    this.releaseMixBuses();
    this.output?.disconnect();
    this.output = null;
    this.clock = null;
    this.samples = [];
  }

  get endFrame(): number { return this.finishFrame; }
  /** The roles still allowed after a committed role handoff exit, or null. */
  get retainedRoles(): RoleWindow | null { return this.retainedAfterExit; }
  get resourceUsage(): {allocatedNoteNodes: number; liveNoteNodes: number; liveMixBuses: number; sampleValues: number; maximumVoices: number} {
    return {allocatedNoteNodes: this.allocatedNotes, liveNoteNodes: this.notes.size, liveMixBuses: this.mixBuses.length,
      sampleValues: this.samples.reduce((sum, s) => sum + s.buffer.length * s.buffer.numberOfChannels, 0),
      maximumVoices: MAX_PROCEDURAL_VOICES};
  }
  private releaseMixBuses(): void {
    for (const bus of this.mixBuses) bus.disconnect();
    this.mixBuses = [];
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
