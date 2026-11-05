/** EMF-S06: import a producer delivery (any producer) into a new, validated em.audio-pack.v0 folder. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {importDelivery} from '../src/importer.js';

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [delivery, output] = process.argv.slice(2);
  if (!delivery || !output || process.argv.length !== 4) {
    console.error('Usage: node dist/scripts/import-delivery.js <delivery-directory> <new-pack-directory>');
    process.exitCode = 2;
  } else {
    importDelivery(delivery, output).then(({receipt}) => {
      console.log(JSON.stringify({result: 'IMPORTED', pack: receipt.pack, manifest_sha256: receipt.manifest_sha256,
        producer: receipt.producer, assets: receipt.assets.map(a => ({id: a.id, frames: a.frames, kept: a.keep_frames, peak: a.peak})),
        generator: receipt.generator.checks, limits: receipt.limits}, null, 2));
    }, (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
