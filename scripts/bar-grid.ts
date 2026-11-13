/**
 * Prints a WAV file's bar grid as JSON (profile eutonos.bar-grid.v1) for editing tools such as
 * Music Studio's snap-to-bars. Offline and read-only: it never plays audio or writes files.
 *
 *   node dist/scripts/bar-grid.js song.wav [--bpm-hint 124] [--beats-per-bar 4]
 */
import {readFile, stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {decodeWav, MAX_ANALYSIS_BYTES} from '../src/audio-analysis.js';
import {barGrid, type BarGrid} from '../src/bar-grid.js';

export interface BarGridArgs {readonly file: string | null; readonly bpmHint: number | null; readonly beatsPerBar: number; readonly help: boolean}

const USAGE = 'Usage: node dist/scripts/bar-grid.js <file.wav> [--bpm-hint BPM] [--beats-per-bar N]';

export function parseBarGridArgs(args: readonly string[]): BarGridArgs {
  let file: string | null = null, bpmHint: number | null = null, beatsPerBar = 4, help = false;
  const number = (name: string, value: string | undefined) => {
    if (value === undefined || !/^\d+(\.\d+)?$/.test(value)) throw new Error(`${name} needs a positive number`);
    return Number(value);
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--bpm-hint') bpmHint = number(arg, args[++i]);
    else if (arg.startsWith('--bpm-hint=')) bpmHint = number('--bpm-hint', arg.slice(11));
    else if (arg === '--beats-per-bar') beatsPerBar = number(arg, args[++i]);
    else if (arg.startsWith('--beats-per-bar=')) beatsPerBar = number('--beats-per-bar', arg.slice(16));
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else if (file === null) file = arg;
    else throw new Error('Pass exactly one WAV file');
  }
  if (!help && file === null) throw new Error('Pass one WAV file');
  return {file, bpmHint, beatsPerBar, help};
}

export async function barGridForFile(path: string, bpmHint: number | null, beatsPerBar = 4): Promise<BarGrid> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path} is not a file`);
  if (info.size > MAX_ANALYSIS_BYTES) throw new Error(`${path} is larger than ${MAX_ANALYSIS_BYTES} bytes`);
  const audio = decodeWav(new Uint8Array(await readFile(path)));
  return barGrid({sampleRate: audio.sample_rate, channels: audio.samples}, {bpmHint, beatsPerBar});
}

async function main(argv: readonly string[]): Promise<number> {
  let args: BarGridArgs;
  try { args = parseBarGridArgs(argv); }
  catch (error) { process.stderr.write(`${(error as Error).message}\n${USAGE}\n`); return 2; }
  if (args.help) { process.stdout.write(`${USAGE}\n`); return 0; }
  try {
    process.stdout.write(`${JSON.stringify(await barGridForFile(args.file!, args.bpmHint, args.beatsPerBar))}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`bar-grid: ${(error as Error).message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
