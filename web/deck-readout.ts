/** Audio-clock display mapping only. It never chooses cues, recipes or playback times. */
import {nativeRateInputAt, rampInInputAt, sourceFrameAtOutput, type NativeRateRamp, type RampIn, type TimePitchMapping} from '../src/time-pitch.js';
export interface DeckPositionInput {
  readonly frame: number; readonly start: number; readonly offset: number; readonly nativeFrames: number;
  readonly mapping: TimePitchMapping | null; readonly entryRate: NativeRateRamp | null;
  readonly sourceStartFrame?: number;
  readonly nativeJoin?: {readonly sourceFrame: number; readonly outputFrame: number};
  readonly motion?: {readonly at: number; readonly sourceFrame: number; readonly rate?: NativeRateRamp; readonly loopFrames?: number;
    /** Part B: A eases to the shared tempo through WSOLA (pitch kept). */
    readonly stretch?: {readonly tempoRatio: number; readonly rampIn: RampIn}};
}
export interface DeckPosition {
  readonly sourceFrame: number; readonly speed: number; readonly pitchSemitones: number;
  readonly pitchMode: 'original' | 'independent' | 'rate-linked';
}
const rateAt = (ramp: NativeRateRamp, frame: number): number =>
  ramp.start + (ramp.end - ramp.start) * Math.min(1, Math.max(0, frame / ramp.frames));
export function deckPositionAt(input: DeckPositionInput): DeckPosition {
  const elapsed = Math.max(0, input.frame - input.start), output = input.offset + elapsed;
  let source = output, speed = 1, pitch = 0, mode: DeckPosition['pitchMode'] = 'original';
  const motion = input.motion;
  if (motion && input.frame >= motion.at) {
    const time = input.frame - motion.at;
    source = motion.sourceFrame - (motion.loopFrames ?? 0) + (motion.rate ? nativeRateInputAt(motion.rate, time) :
      motion.stretch ? rampInInputAt(time, motion.stretch.tempoRatio, motion.stretch.rampIn) : time);
    if (motion.stretch) {
      const {tempoRatio: r, rampIn: ramp} = motion.stretch, u = Math.min(1, time / ramp.rampFrames);
      speed = 1 + (r - 1) * (ramp.curve === 'smoothstep' ? u * u * (3 - 2 * u) : u); mode = 'independent';
    }
    if (motion.rate) { speed = rateAt(motion.rate, time); pitch = 12 * Math.log2(speed); mode = 'rate-linked'; }
  } else if (input.entryRate) {
    source = input.offset + nativeRateInputAt(input.entryRate, elapsed);
    speed = rateAt(input.entryRate, elapsed); pitch = 12 * Math.log2(speed);
    mode = elapsed < input.entryRate.frames ? 'rate-linked' : 'original';
  } else if (input.nativeJoin && output >= input.nativeJoin.outputFrame) {
    source = input.nativeJoin.sourceFrame + output - input.nativeJoin.outputFrame;
  } else if (input.mapping) {
    const map = input.mapping, back = map.returnToOriginal;
    source = (input.sourceStartFrame ?? 0) + sourceFrameAtOutput(map, output);
    const u = back ? Math.min(1, Math.max(0, (output - back.afterFrames) / back.rampFrames)) : 0;
    speed = !back || output <= back.afterFrames ? map.tempoRatio
      : map.tempoRatio + (1 - map.tempoRatio) * (back.curve === 'smoothstep' ? u * u * (3 - 2 * u) : u);
    pitch = map.pitchSemitones; mode = 'independent';
  }
  return {sourceFrame: Math.min(input.nativeFrames, Math.max(0, source)), speed, pitchSemitones: pitch, pitchMode: mode};
}
