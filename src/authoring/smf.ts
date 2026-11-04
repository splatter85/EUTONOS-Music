/** Minimal Standard MIDI File reader used for host-side note readback. Portable; no I/O. */

export interface SmfNote { readonly key: number; readonly start: number; readonly length: number; readonly velocity: number; readonly channel: number }
export interface SmfTrack { readonly name: string | null; readonly notes: readonly SmfNote[] }
export interface Smf { readonly format: number; readonly division: number; readonly tempoUsPerQuarter: number | null; readonly tracks: readonly SmfTrack[] }

export class SmfError extends Error {
  constructor(detail: string) { super(`INVALID_MIDI: ${detail}`); this.name = 'SmfError'; }
}

export function parseSmf(bytes: Uint8Array): Smf {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 14 || tag(0) !== 'MThd' || v.getUint32(4) < 6) throw new SmfError('missing MThd');
  const format = v.getUint16(8), count = v.getUint16(10), division = v.getUint16(12);
  if (division & 0x8000) throw new SmfError('SMPTE time division is not supported');
  let p = 8 + v.getUint32(4);
  let tempo: number | null = null;
  const tracks: SmfTrack[] = [];
  for (let t = 0; t < count; t++) {
    if (p + 8 > bytes.length || tag(p) !== 'MTrk') throw new SmfError(`track ${t} header`);
    const end = p + 8 + v.getUint32(p + 4);
    if (end > bytes.length) throw new SmfError(`track ${t} truncated`);
    let q = p + 8, tick = 0, status = 0, name: string | null = null;
    const open = new Map<string, {start: number; velocity: number}[]>();
    const notes: SmfNote[] = [];
    const varint = () => {
      let n = 0, b: number, guard = 0;
      do { if (q >= end || guard++ > 4) throw new SmfError('bad varint'); b = bytes[q++]!; n = n * 128 + (b & 0x7f); } while (b & 0x80);
      return n;
    };
    while (q < end) {
      tick += varint();
      let s = bytes[q]!;
      if (s === 0xff) {
        const type = bytes[q + 1]!; q += 2;
        const len = varint(), data = bytes.subarray(q, q + len); q += len;
        if (type === 0x03 && name === null) name = String.fromCharCode(...data);
        if (type === 0x51 && len === 3 && tempo === null) tempo = (data[0]! << 16) | (data[1]! << 8) | data[2]!;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) { q++; q += varint(); continue; }
      if (s & 0x80) { status = s; q++; } else s = status;
      if (!status) throw new SmfError('running status without status');
      const kind = status & 0xf0, ch = status & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) { q += 1; continue; }
      const a = bytes[q]!, b = bytes[q + 1]!; q += 2;
      const k = `${ch}:${a}`;
      if (kind === 0x90 && b > 0) { const l = open.get(k) ?? []; l.push({start: tick, velocity: b}); open.set(k, l); }
      else if (kind === 0x80 || kind === 0x90) {
        const s0 = open.get(k)?.shift();
        if (s0) notes.push({key: a, start: s0.start, length: tick - s0.start, velocity: s0.velocity, channel: ch});
      }
    }
    notes.sort((x, y) => x.start - y.start || x.key - y.key);
    tracks.push({name, notes});
    p = end;
  }
  return {format, division, tempoUsPerQuarter: tempo, tracks};
}
