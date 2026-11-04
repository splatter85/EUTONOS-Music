import type { VersionRef } from './pack-types.js';

/** All sources share this caller-owned clock. A source never creates a clock. */
export interface AudioClock {
  readonly engineGeneration: number;
  readonly sampleRate: number;
  readonly currentFrame: number;
}

/** Absolute frame in one engine generation, not wall-clock milliseconds. */
export interface ClockStamp {
  readonly engineGeneration: number;
  readonly frame: number;
}

export interface SourceStart {
  readonly at: ClockStamp;
  readonly entryCueId: string;
}

export interface SourceExit {
  readonly cueId: string;
  /**
   * Offset from the source timeline origin (frame zero), in frames at the caller
   * clock's sampleRate supplied to prepare. It is independent of the selected
   * entry cue, so exits can be inspected before scheduling. S02 converts file
   * cue frames to this domain and subtracts the selected entry offset when
   * calculating the exit's absolute clock frame.
   */
  readonly offsetFrames: number;
}

/**
 * Contract shared by recorded and procedural sources. Implementations must retain
 * the supplied clock by identity and reject operations from an old generation.
 *
 * Lifecycle: prepare once -> scheduleStart once -> stop OR transitionOut -> release.
 * release is also legal after prepare or scheduled start (cancels pending work).
 * Scheduling accepts intent; it does not certify an audible event. S02 supplies
 * an actual renderer; S01 tests this interface with an audio-free test double.
 */
export interface PlayableSource {
  readonly kind: 'recorded' | 'procedural';
  readonly reference: VersionRef;
  prepare(clock: AudioClock): Promise<void>;
  scheduleStart(start: SourceStart): void;
  getValidExits(): readonly SourceExit[];
  stop(at: ClockStamp): void;
  transitionOut(exitCueId: string, at: ClockStamp): void;
  release(): void;
}
