import {validatePackFiles} from './audio.js';
import {eligibleForPlayback, validatePackManifest} from './pack.js';
import type {AudioPack} from './pack-types.js';
import {requireAudio, type DecodedRecording} from './web-audio.js';

export interface LoadedBrowserPack {
  readonly pack: AudioPack;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly allowFixtures: boolean;
  /** Explicit owner-local audition only; never changes an asset's review status. */
  readonly allowUnreviewed?: boolean;
  readonly maxBytes?: number;
}

/** S02 is a small, resident demo, not an arbitrary-pack importer or streamer. */
export const MAX_DEMO_BYTES = 16 * 1024 * 1024;
export const MAX_AUDITION_BYTES = 128 * 1024 * 1024;

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
  fetcher: typeof fetch = fetch, options: {allowUnreviewed?: boolean; maxBytes?: number} = {}): Promise<LoadedBrowserPack> {
  const maxBytes = options.maxBytes ?? MAX_DEMO_BYTES;
  requireAudio(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= MAX_AUDITION_BYTES,
    'Packed audio budget must be a positive integer at most 128 MiB.');
  const allowUnreviewed = options.allowUnreviewed === true;
  requireAudio(['http:', 'https:'].includes(manifestUrl.protocol), 'Serve the demo over HTTP on localhost or HTTPS.');
  const manifest = await fetchBytes(manifestUrl, 256 * 1024, fetcher);
  const pack = validatePackManifest(JSON.parse(new TextDecoder().decode(manifest)) as unknown);
  requireAudio(pack.assets.reduce((sum, a) => sum + a.file.bytes, 0) <= maxBytes,
    `This small player supports at most ${maxBytes / (1024 * 1024)} MiB of packed audio.`);
  const recordings = pack.assets.filter(a => a.source_kind === 'recording');
  requireAudio(recordings.length > 0 && recordings.length <= 2, 'The S02 demo supports one or two recordings.');
  requireAudio(recordings.every(a => eligibleForPlayback(a, allowFixtures, allowUnreviewed)),
    'Recording is not eligible; fixture mode or explicit owner-local unreviewed audition is required.');
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
  return {pack, files, allowFixtures, allowUnreviewed, maxBytes};
}

export async function decodeRecordings(loaded: LoadedBrowserPack, context: BaseAudioContext): Promise<DecodedRecording[]> {
  const result: DecodedRecording[] = [];
  const recordings = loaded.pack.assets.filter(a => a.source_kind === 'recording');
  requireAudio(recordings.reduce((sum, a) => sum +
    Math.ceil(a.file.frames * context.sampleRate / a.file.sample_rate) * a.file.channels, 0) <= (loaded.maxBytes ?? MAX_DEMO_BYTES),
  'Decoded recordings exceed the configured memory budget (four bytes per channel sample).');
  for (const asset of recordings) {
    requireAudio(eligibleForPlayback(asset, loaded.allowFixtures, loaded.allowUnreviewed), 'Recording is not eligible for decoding/playback.');
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
