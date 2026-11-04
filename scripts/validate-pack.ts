import {loadPack} from '../src/node.js';

const root = process.argv[2];
if (!root || process.argv.length !== 3) {
  console.error('Usage: node dist/scripts/validate-pack.js <pack-directory>');
  process.exitCode = 2;
} else {
  try {
    const {pack, audio} = await loadPack(root);
    console.log(JSON.stringify({pack: pack.id, revision: pack.revision, schema: pack.schema_version,
      result: 'PASS', recordings: pack.assets.filter(a => a.source_kind === 'recording').length,
      samples: pack.assets.filter(a => a.source_kind === 'sample').length,
      routes: pack.routes.length, audio,
      listening: 'NOT TESTED; metadata and PCM integrity do not establish musical quality'}, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
