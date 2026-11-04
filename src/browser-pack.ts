import {validatePackFiles} from './audio.js';
import {eligibleForPlayback, validatePackManifest} from './pack.js';
import type {AudioPack} from './pack-types.js';
import {requireAudio, type DecodedRecording} from './web-audio.js';

export interface LoadedBrowserPack {
  readonly pack: AudioPack;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly allowFixtures: boolean;
}

/** S02 is a small, resident demo, not an arbitrary-pack importer or streamer. */
export const MAX_DEMO_BYTES = 16 * 1024 * 1024;

async function fetchBytes(url: URL, maxBytes: number, fetcher: typeof fetch): Promise<Uint8Array> {
  const response = await fetcher(url, {cache: 'no-store', redirect: 'error'});
  requireAudio(response.ok, `Unable to load ${url.pathname}: HTTP ${response.status}`);
  requireAudio(response.body, `Empty response for ${url.pathname}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.length;
      requireAudio(size <= maxBytes, `Response exceeds the demo size limit: ${url.pathname}`);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Fetch only validated pack-relative paths; validate bytes before any decoder. */
export async function loadBrowserPack(manifestUrl: URL, allowFixtures = false,
  fetcher: typeof fetch = fetch): Promise<LoadedBrowserPack> {
  requireAudio(['http:', 'https:'].includes(manifestUrl.protocol), 'Serve the demo over HTTP on localhost or HTTPS.');
  const manifest = await fetchBytes(manifestUrl, 256 * 1024, fetcher);
  const pack = validatePackManifest(JSON.parse(new TextDecoder().decode(manifest)) as unknown);
  requireAudio(pack.assets.reduce((sum, a) => sum + a.file.bytes, 0) <= MAX_DEMO_BYTES,
    'This small player supports at most 16 MiB of packed audio.');
  const recordings = pack.assets.filter(a => a.source_kind === 'recording');
  requireAudio(recordings.length > 0 && recordings.length <= 2, 'The S02 demo supports one or two recordings.');
  requireAudio(recordings.every(a => eligibleForPlayback(a, allowFixtures)),
    'Recording is not eligible; fixture audio requires explicit fixture mode.');
  const base = new URL('.', manifestUrl), files = new Map<string, Uint8Array>();
  for (const asset of pack.assets) {
    files.set(asset.file.path, await fetchBytes(new URL(asset.file.path, base), asset.file.bytes, fetcher));
  }
  await validatePackFiles(pack, async path => {
    const bytes = files.get(path);
    requireAudio(bytes, `Missing validated media: ${path}`);
    return bytes;
  });
  for (const evidence of new Set(pack.assets.map(a => a.rights.evidence))) {
    const bytes = await fetchBytes(new URL(evidence, base), 64 * 1024, fetcher);
    requireAudio(new TextDecoder().decode(bytes).trim().length > 0, `Missing rights evidence: ${evidence}`);
  }
  return {pack, files, allowFixtures};
}

export async function decodeRecordings(loaded: LoadedBrowserPack, context: BaseAudioContext): Promise<DecodedRecording[]> {
  const result: DecodedRecording[] = [];
  const recordings = loaded.pack.assets.filter(a => a.source_kind === 'recording');
  requireAudio(recordings.reduce((sum, a) => sum +
    Math.ceil(a.file.frames * context.sampleRate / a.file.sample_rate) * a.file.channels, 0) <= 16 * 1024 * 1024,
  'Decoded recordings exceed the 64 MiB demo memory budget.');
  for (const asset of recordings) {
    requireAudio(eligibleForPlayback(asset, loaded.allowFixtures), 'Recording is not eligible for decoding/playback.');
    const bytes = loaded.files.get(asset.file.path);
    requireAudio(bytes, `Missing verified bytes: ${asset.id}`);
    // decodeAudioData can detach its input; keep the verified bytes intact.
    const buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
    requireAudio(buffer.sampleRate === context.sampleRate && buffer.numberOfChannels === asset.file.channels &&
      Math.abs(buffer.length - Math.round(asset.file.frames * context.sampleRate / asset.file.sample_rate)) <= 1,
    `Unexpected decoded format: ${asset.id}`);
    result.push({asset, buffer});
  }
  return result;
}
