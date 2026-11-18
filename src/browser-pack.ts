import {validatePackFiles} from './audio.js';
import {eligibleForPlayback, validatePackManifest} from './pack.js';
import type {AudioAsset, AudioPack} from './pack-types.js';
import {requireAudio, type DecodedRecording} from './web-audio.js';

export interface LoadedBrowserPack {
  readonly pack: AudioPack;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly allowFixtures: boolean;
  /** Explicit owner-local audition only; never changes an asset's review status. */
  readonly allowUnreviewed?: boolean;
  readonly maxBytes?: number;
  /**
   * S18 set mode only: media is fetched and verified per song on demand instead of up front.
   * `files` stays empty for these paths; `decodeRecording` reads through this reader.
   */
  readonly lazy?: LazyMediaReader;
}

/** S18: verified on-demand media for a set pack. Bytes are never retained after a read. */
export interface LazyMediaReader {
  /** True when the manifest lists this pack-relative media path. */
  has(path: string): boolean;
  /** Fetches, length/hash/PCM-checks and returns the bytes of one manifest asset. */
  read(path: string): Promise<Uint8Array>;
}

/** S02 is a small, resident demo, not an arbitrary-pack importer or streamer. */
export const MAX_DEMO_BYTES = 16 * 1024 * 1024;
export const MAX_AUDITION_BYTES = 128 * 1024 * 1024;
/** S18 set limits, up to 128 songs; the 4 GiB packed budget is a manifest total (nothing is resident, one song is fetched at a time). */
export const SET_LIMITS = Object.freeze({minRecordings: 2, maxRecordings: 128, maxPackedBytes: 4 * 1024 * 1024 * 1024,
  /** Decoded Float32 budget for one song at the output rate (about 5.8 min of 48 kHz stereo). */
  maxDecodedSongBytes: 128 * 1024 * 1024});

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
  fetcher: typeof fetch = fetch, options: {allowUnreviewed?: boolean; maxBytes?: number; set?: boolean} = {}): Promise<LoadedBrowserPack> {
  if (options.set === true) return loadSetPack(manifestUrl, allowFixtures, fetcher, options.allowUnreviewed === true);
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

/**
 * S18 set mode: the manifest and rights evidence are checked up front; each song's audio is
 * fetched and verified only when the player decodes it. The 1–2 recording loader is unchanged.
 */
async function loadSetPack(manifestUrl: URL, allowFixtures: boolean, fetcher: typeof fetch,
  allowUnreviewed: boolean): Promise<LoadedBrowserPack> {
  requireAudio(['http:', 'https:'].includes(manifestUrl.protocol), 'Serve the demo over HTTP on localhost or HTTPS.');
  const manifest = await fetchBytes(manifestUrl, 256 * 1024, fetcher);
  const pack = validatePackManifest(JSON.parse(new TextDecoder().decode(manifest)) as unknown);
  const recordings = pack.assets.filter(a => a.source_kind === 'recording');
  requireAudio(recordings.length >= SET_LIMITS.minRecordings && recordings.length <= SET_LIMITS.maxRecordings &&
    recordings.length === pack.assets.length, `A set needs ${SET_LIMITS.minRecordings}–${SET_LIMITS.maxRecordings} recordings and no samples.`);
  requireAudio(pack.assets.reduce((sum, a) => sum + a.file.bytes, 0) <= SET_LIMITS.maxPackedBytes,
    'A set supports at most 4 GiB of packed audio.');
  requireAudio(recordings.every(a => a.timing && a.cues.some(c => c.kind === 'entry')), 'Every set song needs timing and an entry cue.');
  requireAudio(recordings.every(a => eligibleForPlayback(a, allowFixtures, allowUnreviewed)),
    'Recording is not eligible; fixture mode or explicit owner-local unreviewed audition is required.');
  const base = new URL('.', manifestUrl);
  for (const evidence of new Set(pack.assets.map(a => a.rights.evidence))) {
    const bytes = await fetchBytes(new URL(evidence, base), 64 * 1024, fetcher);
    requireAudio(new TextDecoder().decode(bytes).trim().length > 0, `Missing rights evidence: ${evidence}`);
  }
  const byPath = new Map(pack.assets.map(a => [a.file.path, a] as const));
  const lazy: LazyMediaReader = {
    has: path => byPath.has(path),
    read: async path => {
      const asset = byPath.get(path);
      requireAudio(asset, `Not a manifest media path: ${path}`);
      const bytes = await fetchBytes(new URL(asset.file.path, base), asset.file.bytes, fetcher);
      // Reuse the pack validator for exactly this one asset: length, SHA-256 and PCM metadata.
      await validatePackFiles({...pack, assets: [asset], palettes: [], recipes: [], routes: []}, async () => bytes);
      return bytes;
    },
  };
  return {pack, files: new Map(), allowFixtures, allowUnreviewed, maxBytes: SET_LIMITS.maxDecodedSongBytes, lazy};
}

/** Decoded Float32 bytes for one recording at the output rate. */
export function decodedBytes(asset: AudioAsset, sampleRate: number): number {
  return Math.ceil(asset.file.frames * sampleRate / asset.file.sample_rate) * asset.file.channels * 4;
}

/**
 * S18: decode one recording on demand. Set packs read verified bytes through `lazy`; resident packs
 * use their verified `files`. The budget is per song, never the whole set.
 */
export async function decodeRecording(loaded: LoadedBrowserPack, context: BaseAudioContext,
  asset: AudioAsset): Promise<DecodedRecording> {
  requireAudio(asset.source_kind === 'recording' && loaded.pack.assets.includes(asset), 'Unknown recording.');
  requireAudio(eligibleForPlayback(asset, loaded.allowFixtures, loaded.allowUnreviewed), 'Recording is not eligible for decoding/playback.');
  requireAudio(decodedBytes(asset, context.sampleRate) <= (loaded.lazy ? SET_LIMITS.maxDecodedSongBytes : loaded.maxBytes ?? MAX_DEMO_BYTES),
    `Decoded song exceeds the per-song memory budget: ${asset.id}`);
  const bytes = loaded.files.get(asset.file.path) ?? (loaded.lazy?.has(asset.file.path) ? await loaded.lazy.read(asset.file.path) : undefined);
  requireAudio(bytes, `Missing verified bytes: ${asset.id}`);
  const buffer = await context.decodeAudioData(new Uint8Array(bytes).buffer);
  requireAudio(buffer.sampleRate === context.sampleRate && buffer.numberOfChannels === asset.file.channels &&
    Math.abs(buffer.length - Math.round(asset.file.frames * context.sampleRate / asset.file.sample_rate)) <= 1,
  `Unexpected decoded format: ${asset.id}`);
  return {asset, buffer};
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
