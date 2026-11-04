import type {AudioPack} from './pack-types.js';
import {fail, MAX_AUDIO_BYTES, PackError} from './pack.js';

export interface PcmInfo {
  readonly sample_rate: number;
  readonly channels: 1 | 2;
  readonly frames: number;
  readonly data_offset: number;
  readonly data_bytes: number;
  readonly peak: number;
}

/** Parse RIFF chunks rather than assuming every WAV has a 44-byte header. */
export function readPcm16Wav(bytes: Uint8Array): PcmInfo {
  const bad = (detail: string): never => fail('INVALID_WAV', 'audio', detail);
  if (bytes.length < 44 || bytes.length > MAX_AUDIO_BYTES) bad('file outside v0 size bounds');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) + 8 !== bytes.length) {
    bad('missing RIFF/WAVE or inconsistent file length');
  }
  let format: {rate: number; channels: 1 | 2; align: number} | undefined;
  let data: {offset: number; size: number} | undefined;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) bad('truncated chunk header');
    const size = view.getUint32(offset + 4, true), start = offset + 8;
    const end = start + size + (size % 2);
    if (end > bytes.length) bad('truncated chunk or missing padding');
    if (tag(offset) === 'fmt ') {
      if (format || size < 16) bad('duplicate or short format chunk');
      const channels = view.getUint16(start + 2, true);
      const rate = view.getUint32(start + 4, true), align = view.getUint16(start + 12, true);
      if (view.getUint16(start, true) !== 1 || view.getUint16(start + 14, true) !== 16 ||
          (channels !== 1 && channels !== 2) || rate < 8000 || rate > 192000 ||
          align !== channels * 2 || view.getUint32(start + 8, true) !== rate * align) {
        bad('only consistent little-endian PCM16 mono/stereo at 8–192 kHz is supported');
      }
      format = {rate, channels: channels as 1 | 2, align};
    } else if (tag(offset) === 'data') {
      if (!format || data) bad('data must follow one format chunk and cannot be duplicated');
      data = {offset: start, size};
    }
    offset = end;
  }
  if (!format || !data || data.size === 0 || data.size % format.align !== 0) {
    return bad('missing format/data or partial sample frame');
  }
  let peak = 0;
  for (let i = data.offset; i < data.offset + data.size; i += 2) {
    peak = Math.max(peak, Math.abs(view.getInt16(i, true)) / 32768);
  }
  return {sample_rate: format.rate, channels: format.channels, frames: data.size / format.align,
    data_offset: data.offset, data_bytes: data.size, peak};
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface AudioReport extends PcmInfo {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly duration_seconds: number;
}

/** Caller supplies bytes from its own registered root/URL. No audio clock or filesystem in the core. */
export async function validatePackFiles(pack: AudioPack,
  read: (relativePath: string) => Promise<Uint8Array>): Promise<AudioReport[]> {
  const reports: AudioReport[] = [];
  for (const asset of pack.assets) {
    let bytes: Uint8Array;
    try { bytes = await read(asset.file.path); }
    catch (error) {
      if (error instanceof PackError) throw error;
      return fail('MISSING_MEDIA', asset.file.path, String(error));
    }
    if (bytes.byteLength !== asset.file.bytes) fail('BYTE_LENGTH_MISMATCH', asset.file.path, 'actual bytes differ from manifest');
    const info = readPcm16Wav(bytes), hash = await sha256(bytes);
    if (hash !== asset.file.sha256) fail('HASH_MISMATCH', asset.file.path, 'actual SHA-256 differs from manifest');
    for (const field of ['sample_rate', 'channels', 'frames'] as const) {
      if (info[field] !== asset.file[field]) fail('AUDIO_METADATA_MISMATCH', asset.file.path, `actual ${field} differs from manifest`);
    }
    reports.push({...info, id: asset.id, path: asset.file.path, sha256: hash,
      bytes: bytes.byteLength, duration_seconds: info.frames / info.sample_rate});
  }
  return reports;
}
