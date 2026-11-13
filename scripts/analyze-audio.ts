/** Standalone offline analyzer. It never starts a player, producer, DAW or model. */
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {basename, extname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {analyzeAudio, decodeWav, MAX_ANALYSIS_BYTES, type AudioAnalysis} from '../src/audio-analysis.js';
import {loadPack, packReader} from '../src/node.js';
import type {AudioAsset} from '../src/pack-types.js';
import {analyzeMixAudio, MIX_ANALYSIS_VERSION, type MixAnalysis} from '../src/mix-analysis.js';

export interface Section {readonly start: number; readonly end: number}
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export function parseSections(text: string): Section[] {
  const number = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const pattern = new RegExp(`^(${number}):(${number})$`);
  return text.split(',').map(value => {
    const match = pattern.exec(value.trim());
    if (!match) throw new Error(`Invalid section '${value}'; use start:end in seconds, e.g. 0:8,8:16`);
    const start = Number(match[1]), end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`Invalid section '${value}'; require finite 0 <= start < end`);
    }
    return {start, end};
  });
}

export function parseAnalysisArgs(args: readonly string[]) {
  const inputs: string[] = [], sections: Section[] = [];
  let help = false, literal = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (literal) { inputs.push(arg); continue; }
    if (arg === '--') { literal = true; continue; }
    if (arg === '--help' || arg === '-h') { help = true; continue; }
    if (arg === '--sections' || arg.startsWith('--sections=')) {
      const first = arg === '--sections' ? args[++i] : arg.slice('--sections='.length);
      if (!first) throw new Error('--sections needs at least one start:end range');
      sections.push(...parseSections(first));
      // Both comma-separated and whitespace-separated lists are accepted.
      while (i + 1 < args.length && /^[\d.]+:[\d.]+(?:,[\d.]+:[\d.]+)*$/.test(args[i + 1]!)) {
        sections.push(...parseSections(args[++i]!));
      }
    } else if (arg.startsWith('-')) throw new Error(`Unknown option '${arg}'`);
    else inputs.push(arg);
  }
  if (sections.length > 256) throw new Error('At most 256 explicit sections per input');
  if (!help && !inputs.length) throw new Error('Provide at least one WAV file or pack directory');
  return {inputs, sections, help};
}

/** Partition recordings at file ends, musical phrase/cue boundaries, pickup and tail. */
export function manifestSections(asset: AudioAsset): Section[] {
  if (asset.source_kind !== 'recording' || !asset.timing) return [];
  const timing = asset.timing, rate = asset.file.sample_rate, frames = asset.file.frames;
  const boundaries = new Set<number>([0, frames]);
  const add = (frame: number) => boundaries.add(Math.max(0, Math.min(frames, frame)));
  for (let bar = 0; bar <= timing.bars; bar += timing.phrase_bars) {
    add(timing.first_downbeat_frame + Math.round(bar * timing.meter[0] * 60 * rate / timing.bpm));
  }
  add(timing.first_downbeat_frame + Math.round(timing.bars * timing.meter[0] * 60 * rate / timing.bpm));
  for (const cue of asset.cues) {
    add(timing.first_downbeat_frame + Math.round(cue.position_quarters * 60 * rate / timing.bpm));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  return sorted.slice(0, -1).map((start, i) => ({start: start / rate, end: sorted[i + 1]! / rate}));
}

function measureFile(bytes: Uint8Array, path: string, sections: readonly Section[], asset?: AudioAsset) {
  const audio = decodeWav(bytes);
  let mixAnalysis: MixAnalysis | {status: 'unsupported'; reason: string};
  try { mixAnalysis = analyzeMixAudio({sampleRate: audio.sample_rate, channels: audio.samples}); }
  catch (error) { mixAnalysis = {status: 'unsupported', reason: error instanceof Error ? error.message : String(error)}; }
  const ranges = asset ? (asset.source_kind === 'recording' ?
    (sections.length ? sections : manifestSections(asset)) : []) : sections;
  return {id: asset?.id ?? basename(path), source_kind: asset?.source_kind ?? 'wav', path,
    sha256: digest(bytes), bytes: bytes.length, format: audio.format,
    sample_rate: audio.sample_rate, channels: audio.channels, frames: audio.frames,
    full: analyzeAudio(audio), mix_analysis: mixAnalysis,
    sections: ranges.map((range, i) => ({label: `section-${i + 1}`,
      origin: sections.length ? 'explicit' : 'manifest',
      requested_start_seconds: range.start, requested_end_seconds: range.end,
      analysis: analyzeAudio(audio, range.start, range.end)}))};
}

const METHODS = {
  mix_analysis: `${MIX_ANALYSIS_VERSION}: ranked constant-tempo hypotheses in 60–180 BPM from channel-power spectral novelty, grid fit, low-band periodicity, backbeat accents and drift; optional generation BPM is soft evidence; ambiguity and confidence are uncalibrated; 4/4 accents and four-bar phrases remain hypotheses; Hann-window spectral pitch classes with original major/minor templates; unknown real-song generalization; bounded to 180 s / 16,777,216 channel samples`,
  loudness: 'BS.1770 K-weighting per channel; 400 ms complete blocks, 100 ms hop, -70 LUFS absolute and -10 LU relative gates; mono/stereo weights 1; null with explicit status if not measurable',
  true_peak: 'Prototype estimate using BS.1770-5 Annex 2 4x FIR, zero-extension and complete filter flush; at least sample peak. Fixed 4x is below 192 kHz for input below 48 kHz; no conformance certification',
  rms: 'Mean square over frames and channels; nonoverlapping 1 s windows with unpadded final partial window; dBFS referenced to sample amplitude 1',
  energy: '1 s nonoverlapping rectangular FFT windows, zero-pad to power of two, one-sided squared spectrum / (FFT length * total frames * channels). Low [0,250), mid [250,4000), high [4000,Nyquist] Hz; DC and boundary transients retained; fractions null for zero energy. Finite-window leakage applies near boundaries',
  silence: 'Longest contiguous run of frames with every channel strictly below -60 dBFS (absolute amplitude 0.001); ties choose earliest',
  clipping: 'Channel sample hits at either integer PCM rail, or |float| >= 1; also counts frames containing a hit. Not proof of prior clipping/distortion',
  sections: 'Half-open seconds rounded to nearest sample; each section treated as standalone with fresh K filters and zero-extended FIR. Pack defaults partition recordings at phrase/cue, pickup, body end and tail boundaries. Explicit ranges replace defaults for recordings and apply to standalone WAVs; pack samples get full-file analysis only',
  nulls: 'Null dB denotes zero linear amplitude/power; null LUFS has a status; null energy fractions mean zero spectral energy',
};

export async function analyzeInput(input: string, sections: readonly Section[] = []) {
  const absolute = resolve(input), info = await stat(absolute);
  const files: ReturnType<typeof measureFile>[] = [];
  let source: {kind: 'pack' | 'wav'; path: string; id?: string; revision?: number; manifest_canonical_sha256?: string};
  if (info.isDirectory()) {
    const {pack} = await loadPack(absolute), read = await packReader(absolute);
    source = {kind: 'pack', path: absolute, id: pack.id, revision: pack.revision,
      manifest_canonical_sha256: digest(JSON.stringify(pack))};
    for (const asset of pack.assets) {
      const bytes = await read(asset.file.path);
      // Check the same bytes being measured, even if media changed since loadPack's validation.
      if (bytes.length !== asset.file.bytes || digest(bytes) !== asset.file.sha256) {
        throw new Error(`Pack asset changed since validation: ${asset.file.path}`);
      }
      files.push(measureFile(bytes, asset.file.path, sections, asset));
    }
  } else {
    if (!info.isFile() || extname(absolute).toLowerCase() !== '.wav' || info.size > MAX_ANALYSIS_BYTES) {
      throw new Error('Input must be a WAV regular file of at most 64 MiB or a validated pack directory');
    }
    source = {kind: 'wav', path: absolute};
    files.push(measureFile(await readFile(absolute), absolute, sections));
  }
  return {schema: 'em.audio-analysis.prototype.v1', generated_at: new Date().toISOString(), source,
    requested_sections: sections, methods: METHODS, files,
    listening: 'NOT TESTED. These are offline measurements, not listening or musical acceptance.'};
}

function summary(label: string, result: AudioAnalysis): string {
  const db = (value: number | null) => value === null ? '-inf' : value.toFixed(2);
  const lufs = result.loudness.integrated_lufs === null ? `n/a (${result.loudness.status})` :
    `${result.loudness.integrated_lufs.toFixed(2)} LUFS`;
  const percent = (value: number | null) => value === null ? 'n/a' : `${(100 * value).toFixed(1)}%`;
  return `${label} [${result.start_seconds.toFixed(3)}:${result.end_seconds.toFixed(3)} s]: ${lufs}; ` +
    `TP ${db(result.true_peak.dbtp)} dBTP (4x estimate); SP ${db(result.sample_peak.dbfs)} dBFS; ` +
    `RMS ${db(result.rms_dbfs)} dBFS; L/M/H ${percent(result.energy.low_fraction)}/` +
    `${percent(result.energy.mid_fraction)}/${percent(result.energy.high_fraction)}; ` +
    `silence ${result.silence.duration_seconds.toFixed(4)} s; rail hits ${result.clipping.samples}`;
}

export async function runAnalysisCli(args: readonly string[]): Promise<number> {
  let options: ReturnType<typeof parseAnalysisArgs>;
  const usage = 'Usage: node dist/scripts/analyze-audio.js <wav files or pack directories> [--sections 0:8,8:16]';
  try { options = parseAnalysisArgs(args); }
  catch (error) { console.error(String(error)); console.error(usage); return 2; }
  if (options.help) { console.log(usage); return 0; }
  let failures = 0;
  for (const input of options.inputs) {
    try {
      const report = await analyzeInput(input, options.sections);
      const directory = resolve('artifacts', 'analysis');
      await mkdir(directory, {recursive: true});
      const name = (report.source.id ?? basename(input, extname(input))).replace(/[^a-zA-Z0-9_-]/g, '-');
      // Paths distinguish same-named inputs; hashes/ranges distinguish different measurement snapshots.
      const key = digest(JSON.stringify([report.source, report.files.map(f => f.sha256), options.sections])).slice(0, 16);
      const destination = join(directory, `${name || 'audio'}-${key}.json`);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
        await rename(temporary, destination);
      } finally { await unlink(temporary).catch(() => undefined); }
      console.log(`\n${report.source.id ?? basename(input)} -> ${destination}`);
      for (const file of report.files) {
        console.log(summary(file.id, file.full));
        const mix = file.mix_analysis;
        console.log('version' in mix
          ? `  Mix estimates: ${mix.tempo.bpm?.toFixed(2) ?? 'unknown'} BPM (confidence ${mix.tempo.confidence.toFixed(2)}); key ${mix.key.name ?? 'unknown'} (confidence ${mix.key.confidence.toFixed(2)}); ${mix.mixIn.length}/${mix.mixOut.length} ranked in/out points; 4/4 and phrases are guesses`
          : `  Mix analysis unsupported: ${mix.reason}`);
        for (const section of file.sections) console.log(`  ${summary(section.label, section.analysis)}`);
      }
    } catch (error) {
      failures++;
      console.error(`${input}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log('\nMeasurements only; listening NOT TESTED. JSON includes 1 s RMS windows and method limits.');
  return failures ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runAnalysisCli(process.argv.slice(2));
}
