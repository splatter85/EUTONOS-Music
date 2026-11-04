/** Node-only I/O boundary. Browser consumers import pack/audio/types, not this module. */
import {readFile, readdir, realpath, stat} from 'node:fs/promises';
import {isAbsolute, join, relative, sep} from 'node:path';
import {validatePackManifest, portablePath, fail, MAX_AUDIO_BYTES} from './pack.js';
import {validatePackFiles} from './audio.js';

export async function packReader(directory: string): Promise<(path: string) => Promise<Uint8Array>> {
  const root = await realpath(directory);
  return async (path: string) => {
    portablePath(path);
    // Exact casing is enforced even on case-insensitive Windows/macOS filesystems.
    let current = root;
    for (const segment of path.split('/')) {
      if (!(await readdir(current)).includes(segment)) fail('MISSING_MEDIA', path, 'path missing or casing differs');
      current = join(current, segment);
      const resolved = await realpath(current), rel = relative(root, resolved);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
        fail('UNSAFE_PATH', path, 'symlink escapes registered pack root');
      }
    }
    const info = await stat(current);
    if (!info.isFile() || info.size > MAX_AUDIO_BYTES) fail('INVALID_FILE', path, 'not a bounded regular file');
    return new Uint8Array(await readFile(current));
  };
}

export async function loadPack(directory: string) {
  const read = await packReader(directory);
  const manifest = await read('manifest.json');
  if (manifest.length > 1024 * 1024) fail('INVALID_MANIFEST', 'manifest.json', 'v0 manifest exceeds 1 MiB');
  const pack = validatePackManifest(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(manifest)));
  for (const path of new Set(pack.assets.map(a => a.rights.evidence))) {
    const evidence = await read(path);
    if (!new TextDecoder('utf-8', {fatal: true}).decode(evidence).trim()) {
      fail('MISSING_PROVENANCE', path, 'rights evidence must not be empty');
    }
  }
  return {pack, audio: await validatePackFiles(pack, read)};
}
