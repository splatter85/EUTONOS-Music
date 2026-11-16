/** Browser persistence around the unchanged canonical set analyzer. No recipe/entry choice lives here. */
import type {AudioAsset} from '../src/pack-types.js';
import type {DecodedRecording} from '../src/web-audio.js';
import {MixAnalysisCache, type MixPreparationRuntime, type SongAnalysisResult} from '../src/mix-transition.js';
import {MIX_ANALYSIS_VERSION, SONG_ANALYSIS_WINDOW, type MixAnalysis} from '../src/mix-analysis.js';
import {songAnalysisWindowFrames, validateSongAnalysis} from '../src/mix-prepare.js';
import {ANALYSIS_RECORD_BYTES, IndexedDbAnalysisStorage, type AnalysisStorage, type StoredAnalysis} from './analysis-storage.js';
import {summarizeWaveform, validateWaveform, type SongWaveform} from './set-waveform.js';

export const SET_ANALYSIS_CACHE_VERSION = 'set-analysis-cache@1';
interface Dimensions {sampleRate: number; frames: number; channels: number;}
interface Payload extends Dimensions {
  version: typeof SET_ANALYSIS_CACHE_VERSION;
  analysis: MixAnalysis;
  waveform: SongWaveform | null;
}
export interface SongPresentation {
  readonly analysis: MixAnalysis | null;
  readonly waveform: SongWaveform | null;
  readonly analyzing: boolean;
  readonly wavePending: boolean;
  readonly error: string | null;
  readonly source: 'session' | 'saved';
}
const check = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
const dimensions = (buffer: AudioBuffer): Dimensions =>
  ({sampleRate: buffer.sampleRate, frames: buffer.length, channels: buffer.numberOfChannels});
const bounded = (value: unknown, max = 8192): value is unknown[] => Array.isArray(value) && value.length <= max;
const text = (value: unknown, max = 1024): value is string => typeof value === 'string' && value.length <= max;
const texts = (value: unknown, max = 128): boolean => bounded(value, max) && value.every(v => text(v));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Persisted data has full-song coordinates. Validate a local copy without changing the result. */
export function validateCachedAnalysis(analysis: MixAnalysis, expected: Dimensions, startFrame: number): void {
  const {sampleRate: rate, frames, channels} = expected, a = analysis;
  check(a && a.version === MIX_ANALYSIS_VERSION && a.sampleRate === rate && a.frames === frames, 'Cached analysis dimensions differ.');
  const window = a.analyzedWindow;
  check(Number.isSafeInteger(startFrame) && startFrame >= 0 && startFrame < frames &&
    window?.policy === SONG_ANALYSIS_WINDOW.policy && window.startFrame === startFrame &&
    window.frames === songAnalysisWindowFrames(frames - startFrame, rate), 'Cached analysis window differs.');
  check(a.nativePeak?.version === 'native-sample-peak@1' && a.nativePeak.frames === frames &&
    finite(a.nativePeak.value) && a.nativePeak.value >= 0 && a.nativePeak.value <= 16, 'Cached native peak is invalid.');
  check(a.tempo && ['estimated', 'insufficient-rhythm'].includes(a.tempo.status) &&
    bounded(a.tempo.candidates, 512) && bounded(a.tempo.alternatives, 512), 'Cached tempo is invalid.');
  const candidateFields = ['strength', 'correlation', 'gridCoverage', 'gridStrength', 'subdivisionContrast',
    'lowPeriodicity', 'backbeat', 'driftSeconds', 'hintSupport'] as const;
  check(a.tempo.candidates.every(c => c && finite(c.bpm) && c.bpm >= 60 && c.bpm <= 180 &&
    candidateFields.every(field => finite(c[field]))) &&
    a.tempo.alternatives.every(c => c && finite(c.bpm) && c.bpm >= 60 && c.bpm <= 180 && finite(c.strength)),
  'Cached tempo candidates are invalid.');
  const key = a.key;
  check(key && ['estimated', 'ambiguous'].includes(key.status) && bounded(key.alternatives, 32) &&
    (key.tonic === null && key.mode === null && key.name === null ||
      Number.isInteger(key.tonic) && key.tonic! >= 0 && key.tonic! < 12 &&
      (key.mode === 'major' || key.mode === 'minor') && text(key.name, 64)) &&
    key.alternatives.every(c => c && Number.isInteger(c.tonic) && c.tonic >= 0 && c.tonic < 12 &&
      (c.mode === 'major' || c.mode === 'minor') && text(c.name, 64) && finite(c.score)), 'Cached key is invalid.');
  check(a.beatGrid && (a.beatGrid.maxFitErrorSeconds === null ||
    finite(a.beatGrid.maxFitErrorSeconds) && a.beatGrid.maxFitErrorSeconds >= 0) &&
    bounded(a.beatGrid.frames) && a.structure?.phraseBars === 4 && bounded(a.structure.downbeatFrames) &&
    bounded(a.structure.phraseFrames) && bounded(a.energyCurve) && bounded(a.mixIn, 1024) && bounded(a.mixOut, 1024) &&
    texts(a.limitations) && (a.cueFeatures === undefined || bounded(a.cueFeatures)) &&
    (a.vocalSpans === undefined || bounded(a.vocalSpans)), 'Cached arrays are invalid or oversized.');
  check([...a.mixIn, ...a.mixOut].every(c => c && texts(c.reasons, 64) && finite(c.seconds) &&
    Math.abs(c.seconds - c.frame / rate) <= 1 / rate), 'Cached cue display data is invalid.');
  check(!a.level || a.level.channels === channels, 'Cached stereo level dimensions differ.');
  const shift = (frame: number): number => {
    check(Number.isSafeInteger(frame), 'Cached native coordinates must be integers.');
    return frame - startFrame;
  };
  const cue = (c: MixAnalysis['mixIn'][number]): MixAnalysis['mixIn'][number] => ({...c,
    frame: shift(c.frame), seconds: shift(c.frame) / rate,
    ...(c.evidence ? {evidence: {...c.evidence, windowEndFrame: shift(c.evidence.windowEndFrame)}} : {})});
  const {analyzedWindow: _window, ...base} = a;
  const local: MixAnalysis = {...base, frames: window!.frames,
    ...(a.level ? {level: {...a.level, startFrame: shift(a.level.startFrame)}} : {}),
    beatGrid: {...a.beatGrid, frames: a.beatGrid.frames.map(shift)},
    structure: {...a.structure, downbeatFrames: a.structure.downbeatFrames.map(shift),
      phraseFrames: a.structure.phraseFrames.map(shift)},
    energyCurve: a.energyCurve.map(e => ({...e, startFrame: shift(e.startFrame), endFrame: shift(e.endFrame)})),
    ...(a.cueFeatures ? {cueFeatures: a.cueFeatures.map(c => ({...c, frame: shift(c.frame), endFrame: shift(c.endFrame)}))} : {}),
    ...(a.vocalSpans ? {vocalSpans: a.vocalSpans.map(s => ({startFrame: shift(s.startFrame), endFrame: shift(s.endFrame)}))} : {}),
    mixIn: a.mixIn.map(cue), mixOut: a.mixOut.map(cue)};
  validateSongAnalysis(local, window!.frames, rate);
}
async function digest(payload: string): Promise<string> {
  const bytes = new TextEncoder().encode(payload);
  check(bytes.byteLength <= ANALYSIS_RECORD_BYTES, 'Cached analysis exceeds its record budget.');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), v => v.toString(16).padStart(2, '0')).join('');
}
export async function encodeAnalysis(asset: AudioAsset, analysis: MixAnalysis, channels: number,
  waveform: SongWaveform | null): Promise<StoredAnalysis> {
  const expected = {sampleRate: analysis.sampleRate, frames: analysis.frames, channels};
  const start = analysis.analyzedWindow?.startFrame ?? -1;
  validateCachedAnalysis(analysis, expected, start);
  if (waveform) validateWaveform(waveform, expected);
  const payload = JSON.stringify({version: SET_ANALYSIS_CACHE_VERSION, ...expected, analysis, waveform} satisfies Payload);
  return {key: MixAnalysisCache.key(asset, expected.sampleRate, start),
    identity: MixAnalysisCache.key(asset, expected.sampleRate), payload, digest: await digest(payload), usedAt: Date.now()};
}
export async function decodeAnalysis(value: unknown, asset: AudioAsset, expected: Dimensions,
  startFrame?: number, displayFrameTolerance: 0 | 1 = 0): Promise<Payload> {
  check(value && typeof value === 'object', 'Cached analysis is not a record.');
  const record = value as StoredAnalysis;
  check(text(record.key, 512) && record.identity === MixAnalysisCache.key(asset, expected.sampleRate) &&
    text(record.payload, ANALYSIS_RECORD_BYTES) && finite(record.usedAt) && typeof record.digest === 'string' && /^[a-f0-9]{64}$/.test(record.digest),
  'Cached analysis envelope is invalid.');
  check(await digest(record.payload) === record.digest, 'Cached analysis checksum differs.');
  const payload = JSON.parse(record.payload) as Payload;
  // Display restoration mirrors the decoder's +/-1 resampling allowance. Planner reuse is exact.
  check(payload && payload.version === SET_ANALYSIS_CACHE_VERSION && Number.isSafeInteger(payload.frames) && payload.frames > 0 &&
    Math.abs(payload.frames - expected.frames) <= displayFrameTolerance &&
    payload.channels === expected.channels && payload.sampleRate === expected.sampleRate, 'Cached native dimensions differ.');
  const actual = {...expected, frames: payload.frames};
  const start = payload.analysis?.analyzedWindow?.startFrame;
  check(Number.isSafeInteger(start) && (startFrame === undefined || start === startFrame) &&
    record.key === MixAnalysisCache.key(asset, expected.sampleRate, start), 'Cached analysis identity differs.');
  validateCachedAnalysis(payload.analysis, actual, start!);
  const waveform = payload.waveform === null ? null : validateWaveform(payload.waveform, actual);
  return {...payload, waveform};
}
function callerResult<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  if (signal.aborted) return Promise.reject(new Error('Mix preparation cancelled.'));
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(new Error('Mix preparation cancelled.'));
    signal.addEventListener('abort', abort, {once: true});
    task.then(value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** A bounded front cache delegates every miss to the canonical implementation, unchanged. */
export class PersistentSetAnalysisCache extends MixAnalysisCache {
  private readonly lookups = new Map<string, Promise<SongAnalysisResult>>();
  private readonly views = new Map<string, Omit<SongPresentation, 'analyzing' | 'wavePending'>>();
  private readonly counts = new Map<string, number>();
  private readonly restores = new Map<string, Promise<void>>();
  private readonly waves = new WeakMap<AudioBuffer, Promise<void>>();
  private readonly waveJobs = new Set<Promise<void>>();
  private readonly waveKeys = new Set<string>();
  private readonly saves = new Map<string, Promise<void>>();
  private readonly latest = new Map<string, {asset: AudioAsset; analysis: MixAnalysis; channels: number}>();
  private waveTail: Promise<void> = Promise.resolve();
  constructor(private readonly storage: AnalysisStorage | null =
    typeof indexedDB === 'undefined' ? null : new IndexedDbAnalysisStorage(),
    private readonly waveform: (buffer: AudioBuffer) => Promise<SongWaveform> = summarizeWaveform, maxEntries = 64) {
    super(maxEntries);
  }
  override get size(): number { return this.lookups.size; }
  override has(asset: AudioAsset, rate: number, start = 0): boolean { return this.lookups.has(MixAnalysisCache.key(asset, rate, start)); }
  presentation(asset: AudioAsset, rate: number): SongPresentation {
    const identity = MixAnalysisCache.key(asset, rate);
    return {...(this.views.get(identity) ?? {analysis: null, waveform: null, error: null, source: 'session' as const}),
      analyzing: (this.counts.get(identity) ?? 0) > 0, wavePending: this.waveKeys.has(identity)};
  }
  private patch(identity: string, update: Partial<Omit<SongPresentation, 'analyzing' | 'wavePending'>>): void {
    const prior = this.views.get(identity) ?? {analysis: null, waveform: null, error: null, source: 'session' as const};
    this.views.delete(identity); this.views.set(identity, {...prior, ...update});
    while (this.views.size > this.maxEntries) this.views.delete(this.views.keys().next().value!);
  }
  /** Restore small display data without fetching or decoding a song. Actual reuse checks decoded dimensions again. */
  restore(asset: AudioAsset, rate: number): Promise<void> {
    const identity = MixAnalysisCache.key(asset, rate);
    let task = this.restores.get(identity);
    if (!task) {
      task = (async () => {
        if (!this.storage) return;
        let stored: unknown;
        try {
          stored = await this.storage.latest(identity);
          if (!stored) return;
          const body = await decodeAnalysis(stored, asset, {sampleRate: rate,
            frames: Math.round(asset.file.frames * rate / asset.file.sample_rate), channels: asset.file.channels}, undefined, 1);
          if (!this.views.get(identity)?.analysis) this.patch(identity, {analysis: body.analysis, waveform: body.waveform, source: 'saved'});
        } catch {
          // A bad display record cannot supply planner evidence. Remove only its own identity-bound row.
          const key = (stored as Partial<StoredAnalysis> | undefined)?.key;
          if (typeof key === 'string' && key.startsWith(asset.file.sha256 + ':')) void this.storage.remove(key, stored).catch(() => undefined);
        }
      })();
      this.restores.set(identity, task);
      while (this.restores.size > this.maxEntries) this.restores.delete(this.restores.keys().next().value!);
    }
    return task;
  }
  /** Display-only decoded-audio hook. It neither retains a source nor changes its schedule. */
  observe(recording: DecodedRecording): void {
    if (recording.processed || this.waves.has(recording.buffer)) return;
    const {asset, buffer} = recording, identity = MixAnalysisCache.key(asset, buffer.sampleRate);
    // At most one running and one queued native buffer; a skipped summary can be requested again.
    if (this.waveJobs.size >= 2 || this.waveKeys.has(identity)) return;
    this.waveKeys.add(identity);
    const task = this.waveTail.then(async () => {
      await this.restore(asset, buffer.sampleRate);
      const existing = this.views.get(identity)?.waveform;
      if (existing) { try { validateWaveform(existing, dimensions(buffer)); return; } catch { /* rebuild */ } }
      const wave = validateWaveform(await this.waveform(buffer), dimensions(buffer));
      this.patch(identity, {waveform: wave});
      const latest = this.latest.get(identity);
      if (latest) this.save(latest.asset, latest.analysis, latest.channels);
    }).catch(() => { /* A missing waveform must never prevent playback or analysis. */ });
    this.waves.set(buffer, task); this.waveJobs.add(task);
    this.waveTail = task;
    void task.finally(() => { this.waveJobs.delete(task); this.waveKeys.delete(identity); this.waves.delete(buffer); });
  }
  private publish(asset: AudioAsset, analysis: MixAnalysis, channels: number, source: 'session' | 'saved', wave?: SongWaveform | null): void {
    const identity = MixAnalysisCache.key(asset, analysis.sampleRate);
    this.latest.delete(identity); this.latest.set(identity, {asset, analysis, channels});
    while (this.latest.size > this.maxEntries) this.latest.delete(this.latest.keys().next().value!);
    this.patch(identity, {analysis, source, error: null, ...(wave ? {waveform: wave} : {})});
  }
  private save(asset: AudioAsset, analysis: MixAnalysis, channels: number): void {
    if (!this.storage) return;
    const key = MixAnalysisCache.key(asset, analysis.sampleRate, analysis.analyzedWindow!.startFrame);
    const identity = MixAnalysisCache.key(asset, analysis.sampleRate);
    const wave = this.views.get(identity)?.waveform ?? null;
    const task = (this.saves.get(key) ?? Promise.resolve()).then(async () => {
      const record = await encodeAnalysis(asset, analysis, channels, wave);
      await this.storage!.write(record);
    }).catch(() => { /* Quota/storage failure leaves the working session cache intact. */ });
    this.saves.set(key, task);
    void task.finally(() => { if (this.saves.get(key) === task) this.saves.delete(key); });
  }
  override analyze(recording: DecodedRecording, runtime: MixPreparationRuntime, signal?: AbortSignal, startFrame = 0): Promise<SongAnalysisResult> {
    const {asset, buffer} = recording;
    if (recording.processed || !Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame >= buffer.length)
      return Promise.reject(new Error('Analysis needs a valid native song window.'));
    if (signal?.aborted) return Promise.reject(new Error('Mix preparation cancelled.'));
    this.observe(recording);
    const key = MixAnalysisCache.key(asset, buffer.sampleRate, startFrame), identity = MixAnalysisCache.key(asset, buffer.sampleRate);
    let task = this.lookups.get(key);
    if (task) { this.lookups.delete(key); this.lookups.set(key, task); }
    else {
      this.counts.set(identity, (this.counts.get(identity) ?? 0) + 1);
      this.patch(identity, {error: null});
      task = (async (): Promise<SongAnalysisResult> => {
        if (this.storage) {
          let stored: unknown;
          try {
            stored = await this.storage.read(key);
            if (stored) {
              const body = await decodeAnalysis(stored, asset, dimensions(buffer), startFrame);
              this.publish(asset, body.analysis, buffer.numberOfChannels, 'saved', body.waveform);
              return {ok: true, analysis: body.analysis};
            }
          } catch { if (stored) void this.storage.remove(key, stored).catch(() => undefined); }
        }
        const result = await super.analyze(recording, runtime, undefined, startFrame);
        if (result.ok) {
          this.publish(asset, result.analysis, buffer.numberOfChannels, 'session');
          this.save(asset, result.analysis, buffer.numberOfChannels);
        } else this.patch(identity, {error: result.reason});
        return result;
      })().finally(() => {
        const count = (this.counts.get(identity) ?? 1) - 1;
        if (count) this.counts.set(identity, count); else this.counts.delete(identity);
      });
      this.lookups.set(key, task);
      const current = task;
      void task.then(result => { if (!result.ok && this.lookups.get(key) === current) this.lookups.delete(key); },
        () => { if (this.lookups.get(key) === current) this.lookups.delete(key); });
      while (this.lookups.size > this.maxEntries) this.lookups.delete(this.lookups.keys().next().value!);
    }
    return callerResult(task, signal);
  }
  /** Test/closeout drain only. Playback never awaits a persistent write or waveform. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.lookups.values()]);
    await Promise.allSettled([...this.waveJobs]);
    while (this.saves.size) await Promise.allSettled([...this.saves.values()]);
  }
}
