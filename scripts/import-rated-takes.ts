import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importRatedTakes} from '../src/rated-takes.js';

export async function runRatedIntake(args: readonly string[]): Promise<void> {
  let source: string | undefined, out: string | undefined, pair: [string, string] | undefined;
  for (let i = 0; i < args.length;) {
    const flag = args[i++];
    if (flag === '--source' && !source && args[i] && !args[i]!.startsWith('--')) source = args[i++];
    else if (flag === '--out' && !out && args[i] && !args[i]!.startsWith('--')) out = args[i++];
    else if (flag === '--pair' && !pair && args[i] && args[i + 1] && !args[i]!.startsWith('--') && !args[i + 1]!.startsWith('--')) {
      pair = [args[i++]!, args[i++]!];
    } else throw new Error('Usage: import:rated -- --source EXPORT_ROOT --out NEW_DIRECTORY [--pair TAKE_A TAKE_B]');
  }
  if (!source || !out) throw new Error('Usage: import:rated -- --source EXPORT_ROOT --out NEW_DIRECTORY [--pair TAKE_A TAKE_B]');
  const catalog = await importRatedTakes(source, out, pair ? {pair} : {});
  console.log(JSON.stringify({result: 'IMPORTED', output: resolve(out), takes: catalog.takes.length,
    ratings: Object.fromEntries(['love', 'like', 'dislike'].map(r => [r, catalog.takes.filter(t => t.rating === r).length])),
    pair: catalog.pair, limits: catalog.limits}, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void runRatedIntake(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
