import type {MixPcm} from '../../src/mix-analysis.js';

export interface MixFixtureOptions {
  readonly bpm?: number;
  readonly sampleRate?: number;
  readonly bars?: number;
  readonly tonic?: number;
  readonly mode?: 'major' | 'minor';
  readonly offsetSeconds?: number;
  readonly stereo?: 'mono' | 'same' | 'antiphase';
  readonly drums?: boolean;
  readonly chords?: boolean;
  readonly accents?: boolean;
}
/** Original synthetic kick, bass and triads with exact beat/phrase/key ground truth.
 * No audio is read or persisted. A finite, deterministic oscillatory transient
 * replaces random noise, so repeated fixture construction is bitwise identical.
 */
export function makeMixFixture(options: MixFixtureOptions = {}): MixPcm {
  const sampleRate = options.sampleRate ?? 16000, bpm = options.bpm ?? 120;
  const bars = options.bars ?? 8, tonic = options.tonic ?? 9, mode = options.mode ?? 'minor';
  const offset = options.offsetSeconds ?? 0, duration = bars * 4 * 60 / bpm + offset;
  const frames = Math.ceil(sampleRate * duration), channel = new Float32Array(frames);
  const period = 60 / bpm, beatFrames = sampleRate * period, startFrame = Math.round(offset * sampleRate);
  const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
  if (options.chords !== false) {
    for (let i = startFrame; i < frames; i++) {
      const t = (i - startFrame) / sampleRate, bar = Math.floor(t / (4 * period));
      const root = tonic + (bar % 4 === 2 ? 5 : 0), third = mode === 'minor' ? 3 : 4;
      const local = t % (4 * period), release = 4 * period - local;
      const envelope = Math.min(1, local / 0.025, release / 0.025);
      let value = 0.075 * Math.sin(2 * Math.PI * frequency(36 + root) * t);
      for (const note of [48 + root, 48 + root + third, 48 + root + 7]) {
        value += 0.055 * Math.sin(2 * Math.PI * frequency(note) * t);
      }
      channel[i] = value * Math.max(0, envelope);
    }
  }
  if (options.drums !== false) for (let beat = 0; beat < bars * 4; beat++) {
    const start = startFrame + Math.round(beat * beatFrames);
    const accent = options.accents !== false && beat % 4 === 0 ? 1 : 0.55;
    for (let j = 0; j < sampleRate * 0.13 && start + j < frames; j++) {
      const t = j / sampleRate, attack = Math.min(1, t / 0.002);
      const kick = 0.32 * Math.sin(2 * Math.PI * 52 * t) * Math.exp(-t * 35);
      const click = 0.15 * (Math.sin(2 * Math.PI * 1900 * t) + 0.4 * Math.sin(2 * Math.PI * 3101 * t)) * Math.exp(-t * 160);
      channel[start + j] = channel[start + j]! + accent * attack * (kick + click);
    }
  }
  return {sampleRate, channels: options.stereo && options.stereo !== 'mono'
    ? [channel, Float32Array.from(channel, x => options.stereo === 'antiphase' ? -x : x)] : [channel]};
}
