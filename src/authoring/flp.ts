/**
 * Minimal, dependency-free FL Studio project (.flp) event codec.
 *
 * Clean-room implementation from observed files plus public format notes
 * (event ranges, 24-byte note records, playlist records). It is portable:
 * no filesystem, process or OS access. It deliberately supports only the
 * layout family that was verified on a real host (see VERIFIED_LAYOUTS) and
 * rejects anything else instead of guessing.
 */

export class FlpError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'FlpError';
  }
}

const bad = (code: string, detail: string): never => { throw new FlpError(code, detail); };

export interface FlpEvent {
  readonly id: number;
  /** Fixed-size events (id < 192) carry a number; variable events carry bytes. */
  readonly value: number | Uint8Array;
}

export interface FlpFile {
  readonly format: number;
  readonly channelCount: number;
  readonly ppq: number;
  readonly events: readonly FlpEvent[];
}

/** Event IDs used by this adapter. Names follow public reverse-engineering notes. */
export const EV = {
  timeSigNum: 17,
  timeSigDen: 18,
  channelNew: 64,
  patternNew: 65,
  tempo: 156,
  channelIid: 160,
  patternUnknown161: 161,
  patternName: 193,
  version: 199,
  pluginDefaultName: 201,
  channelName: 203,
  sampleFile: 196,
  notes: 224,
  playlist: 233,
  arrangementNew: 99,
} as const;

export const NOTE_BYTES = 24;
export const PLAYLIST_ITEM_BYTES = 80;
export const PATTERN_BASE = 20480;
/** FL version prefixes whose fixed event sizes and record layouts were checked on the S08 host. */
export const VERIFIED_LAYOUTS = ['24.'] as const;

function size(id: number): 1 | 2 | 4 | 'var' {
  return id < 64 ? 1 : id < 128 ? 2 : id < 192 ? 4 : 'var';
}

export function parseFlp(bytes: Uint8Array): FlpFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 22 || tag(0) !== 'FLhd' || view.getUint32(4, true) !== 6) bad('FLP_HEADER', 'missing FLhd header');
  const format = view.getInt16(8, true), channelCount = view.getUint16(10, true), ppq = view.getUint16(12, true);
  if (tag(14) !== 'FLdt') bad('FLP_HEADER', 'missing FLdt chunk');
  const dataLength = view.getUint32(18, true);
  if (22 + dataLength !== bytes.length) bad('FLP_LENGTH', 'FLdt length does not match file size');
  if (ppq < 24 || ppq > 960) bad('FLP_HEADER', `implausible PPQ ${ppq}`);
  const events: FlpEvent[] = [];
  let p = 22;
  while (p < bytes.length) {
    const id = bytes[p++]!;
    const s = size(id);
    if (s === 1) { if (p + 1 > bytes.length) bad('FLP_TRUNCATED', `event ${id}`); events.push({id, value: bytes[p]!}); p += 1; }
    else if (s === 2) { if (p + 2 > bytes.length) bad('FLP_TRUNCATED', `event ${id}`); events.push({id, value: view.getUint16(p, true)}); p += 2; }
    else if (s === 4) { if (p + 4 > bytes.length) bad('FLP_TRUNCATED', `event ${id}`); events.push({id, value: view.getUint32(p, true)}); p += 4; }
    else {
      let n = 0, shift = 0, b: number;
      do {
        if (p >= bytes.length || shift > 28) bad('FLP_TRUNCATED', `length of event ${id}`);
        b = bytes[p++]!; n += (b & 0x7f) * 2 ** shift; shift += 7;
      } while (b & 0x80);
      if (p + n > bytes.length) bad('FLP_TRUNCATED', `payload of event ${id}`);
      events.push({id, value: bytes.slice(p, p + n)});
      p += n;
    }
  }
  return {format, channelCount, ppq, events};
}

export function serializeFlp(file: FlpFile): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  const push = (u: Uint8Array) => { parts.push(u); total += u.length; };
  for (const e of file.events) {
    const s = size(e.id);
    if (s === 'var') {
      if (!(e.value instanceof Uint8Array)) bad('FLP_EVENT', `event ${e.id} needs bytes`);
      const payload = e.value as Uint8Array, len: number[] = [];
      let n = payload.length;
      do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; len.push(b); } while (n);
      push(Uint8Array.of(e.id, ...len)); push(payload);
    } else {
      if (typeof e.value !== 'number') bad('FLP_EVENT', `event ${e.id} needs a number`);
      const u = new Uint8Array(1 + s), v = new DataView(u.buffer);
      u[0] = e.id;
      if (s === 1) u[1] = e.value as number; else if (s === 2) v.setUint16(1, e.value as number, true); else v.setUint32(1, e.value as number, true);
      push(u);
    }
  }
  const out = new Uint8Array(22 + total), view = new DataView(out.buffer);
  out.set([0x46, 0x4c, 0x68, 0x64]); view.setUint32(4, 6, true);
  view.setInt16(8, file.format, true); view.setUint16(10, file.channelCount, true); view.setUint16(12, file.ppq, true);
  out.set([0x46, 0x4c, 0x64, 0x74], 14); view.setUint32(18, total, true);
  let p = 22;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

const utf16 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i]! | (b[i + 1]! << 8));
  return s.replace(/\0+$/, '');
};
const ascii = (b: Uint8Array) => String.fromCharCode(...b).replace(/\0+$/, '');

export interface FlpNote {
  readonly position: number;
  readonly flags: number;
  readonly channel: number;
  readonly length: number;
  readonly key: number;
  readonly group: number;
  readonly finePitch: number;
  readonly unknown: number;
  readonly release: number;
  readonly midiChannel: number;
  readonly pan: number;
  readonly velocity: number;
  readonly modX: number;
  readonly modY: number;
}

export function decodeNotes(blob: Uint8Array): FlpNote[] {
  if (blob.length % NOTE_BYTES !== 0) bad('UNSUPPORTED_NOTE_LAYOUT', `note blob of ${blob.length} bytes`);
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength), out: FlpNote[] = [];
  for (let o = 0; o < blob.length; o += NOTE_BYTES) {
    out.push({position: v.getUint32(o, true), flags: v.getUint16(o + 4, true), channel: v.getUint16(o + 6, true),
      length: v.getUint32(o + 8, true), key: v.getUint16(o + 12, true), group: v.getUint16(o + 14, true),
      finePitch: blob[o + 16]!, unknown: blob[o + 17]!, release: blob[o + 18]!, midiChannel: blob[o + 19]!,
      pan: blob[o + 20]!, velocity: blob[o + 21]!, modX: blob[o + 22]!, modY: blob[o + 23]!});
  }
  return out;
}

export function encodeNotes(notes: readonly FlpNote[]): Uint8Array {
  const blob = new Uint8Array(notes.length * NOTE_BYTES), v = new DataView(blob.buffer);
  notes.forEach((n, i) => {
    const o = i * NOTE_BYTES;
    v.setUint32(o, n.position, true); v.setUint16(o + 4, n.flags, true); v.setUint16(o + 6, n.channel, true);
    v.setUint32(o + 8, n.length, true); v.setUint16(o + 12, n.key, true); v.setUint16(o + 14, n.group, true);
    blob.set([n.finePitch, n.unknown, n.release, n.midiChannel, n.pan, n.velocity, n.modX, n.modY], o + 16);
  });
  return blob;
}

/** Defaults observed on notes written by FL itself (flags 0x4000, centred pitch/pan). */
export const NOTE_DEFAULTS = {flags: 0x4000, group: 0, finePitch: 120, unknown: 0, release: 64, midiChannel: 0,
  pan: 64, modX: 128, modY: 128} as const;

export interface PlaylistItem {
  readonly index: number;
  readonly position: number;
  readonly pattern: number | null;
  readonly channelItem: number | null;
  readonly length: number;
  readonly track: number;
  readonly endOffset: number;
}

export function decodePlaylist(blob: Uint8Array): PlaylistItem[] {
  if (blob.length % PLAYLIST_ITEM_BYTES !== 0) bad('UNSUPPORTED_PLAYLIST_LAYOUT', `playlist blob of ${blob.length} bytes`);
  const v = new DataView(blob.buffer, blob.byteOffset, blob.byteLength), out: PlaylistItem[] = [];
  for (let o = 0, i = 0; o < blob.length; o += PLAYLIST_ITEM_BYTES, i++) {
    const base = v.getUint16(o + 4, true), item = v.getUint16(o + 6, true);
    if (base !== PATTERN_BASE) bad('UNSUPPORTED_PLAYLIST_LAYOUT', `item ${i} pattern base ${base}`);
    out.push({index: i, position: v.getUint32(o, true), pattern: item > PATTERN_BASE ? item - PATTERN_BASE : null,
      channelItem: item <= PATTERN_BASE ? item : null, length: v.getUint32(o + 8, true),
      track: 499 - v.getUint16(o + 12, true), endOffset: v.getUint32(o + 28, true)});
  }
  return out;
}

export interface ChannelInfo { readonly index: number; readonly name: string | null; readonly plugin: string | null; readonly sample: string | null }
export interface PatternInfo { readonly index: number; readonly name: string | null; readonly notes: readonly FlpNote[] }

export interface ProjectView {
  readonly flVersion: string | null;
  readonly layoutVerified: boolean;
  readonly ppq: number;
  readonly tempoBpm: number | null;
  readonly timeSignature: readonly [number, number] | null;
  readonly channels: readonly ChannelInfo[];
  readonly patterns: readonly PatternInfo[];
  readonly playlist: readonly PlaylistItem[] | null;
  readonly playlistError: string | null;
}

function firstNumber(events: readonly FlpEvent[], id: number): number | null {
  const e = events.find(x => x.id === id);
  return e && typeof e.value === 'number' ? e.value : null;
}

/** Index of the first channel event; pattern note blocks precede it in verified files. */
function channelStart(events: readonly FlpEvent[]): number {
  const i = events.findIndex(e => e.id === EV.channelNew);
  return i < 0 ? events.length : i;
}

export function viewProject(file: FlpFile): ProjectView {
  const ev = file.events;
  const versionEvent = ev.find(e => e.id === EV.version);
  const flVersion = versionEvent && versionEvent.value instanceof Uint8Array ? ascii(versionEvent.value) : null;
  const tempo = firstNumber(ev, EV.tempo);
  const num = firstNumber(ev, EV.timeSigNum), den = firstNumber(ev, EV.timeSigDen);

  const channels: ChannelInfo[] = [];
  const playlistAt = ev.findIndex(e => e.id === EV.playlist || e.id === EV.arrangementNew);
  type Mutable = {index: number; name: string | null; plugin: string | null; sample: string | null};
  const found: Mutable[] = [];
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]!, current = found[found.length - 1];
    if (e.id === EV.channelNew && typeof e.value === 'number') {
      found.push({index: e.value, name: null, plugin: null, sample: null});
    } else if (current && (playlistAt < 0 || i < playlistAt) && e.value instanceof Uint8Array) {
      if (e.id === EV.channelName && current.name === null) current.name = utf16(e.value);
      if (e.id === EV.pluginDefaultName && current.plugin === null) current.plugin = utf16(e.value) || null;
      if (e.id === EV.sampleFile && current.sample === null) current.sample = utf16(e.value);
    }
  }
  channels.push(...found);

  const patterns = new Map<number, {index: number; name: string | null; notes: FlpNote[]}>();
  let pat: number | null = null;
  for (const e of ev) {
    if (e.id === EV.patternNew && typeof e.value === 'number') {
      pat = e.value;
      if (!patterns.has(pat)) patterns.set(pat, {index: pat, name: null, notes: []});
    } else if (pat !== null && e.value instanceof Uint8Array) {
      const p = patterns.get(pat)!;
      if (e.id === EV.patternName) p.name = utf16(e.value);
      if (e.id === EV.notes) p.notes.push(...decodeNotes(e.value));
    }
  }

  let playlist: PlaylistItem[] | null = null, playlistError: string | null = null;
  const pl = ev.filter(e => e.id === EV.playlist);
  if (pl.length === 1 && pl[0]!.value instanceof Uint8Array) {
    try { playlist = decodePlaylist(pl[0]!.value); } catch (error) { playlistError = String(error); }
  } else playlistError = `expected one playlist event, found ${pl.length}`;

  return {flVersion, layoutVerified: !!flVersion && VERIFIED_LAYOUTS.some(v => flVersion.startsWith(v)),
    ppq: file.ppq, tempoBpm: tempo === null ? null : tempo / 1000,
    timeSignature: num !== null && den !== null ? [num, den] : null,
    channels, patterns: [...patterns.values()].sort((a, b) => a.index - b.index), playlist, playlistError};
}

/** Portable note description used by the MCP contract. */
export interface NoteSpec {
  readonly midi: number;
  readonly start_quarters: number;
  readonly duration_quarters: number;
  readonly velocity: number;
}

/** Upper bound for note positions/lengths: FL stores them as 32-bit fields; keep well inside the signed range. */
const MAX_TICKS = 0x7fffffff;

export function quartersToTicks(q: number, ppq: number, at: string): number {
  const t = q * ppq;
  if (!Number.isFinite(t) || t < 0 || t > MAX_TICKS || Math.abs(t - Math.round(t)) > 1e-9) {
    bad('INVALID_PAYLOAD', `${at}: ${q} quarters is not a whole number of ticks at PPQ ${ppq}`);
  }
  return Math.round(t);
}

export function noteSpecToFlp(n: NoteSpec, channel: number, ppq: number, at: string): FlpNote {
  if (!Number.isInteger(n.midi) || n.midi < 0 || n.midi > 127) bad('INVALID_PAYLOAD', `${at}.midi must be 0-127`);
  if (!(n.velocity >= 0 && n.velocity <= 1)) bad('INVALID_PAYLOAD', `${at}.velocity must be in [0,1]`);
  const length = quartersToTicks(n.duration_quarters, ppq, `${at}.duration_quarters`);
  if (length <= 0) bad('INVALID_PAYLOAD', `${at}.duration_quarters must be positive`);
  const position = quartersToTicks(n.start_quarters, ppq, `${at}.start_quarters`);
  if (position + length > MAX_TICKS) bad('INVALID_PAYLOAD', `${at} ends beyond the representable range`);
  return {...NOTE_DEFAULTS, position, channel, length,
    key: n.midi, velocity: Math.round(n.velocity * 128)};
}

export function flpNoteToSpec(n: FlpNote, ppq: number): NoteSpec {
  return {midi: n.key, start_quarters: n.position / ppq, duration_quarters: n.length / ppq, velocity: n.velocity / 128};
}

const noteOrder = (a: FlpNote, b: FlpNote) => a.position - b.position || a.channel - b.channel || a.key - b.key;

/** Replace one channel's notes in one pattern; other channels' notes in that pattern are preserved. */
export function replaceChannelNotes(file: FlpFile, pattern: number, channel: number, notes: readonly FlpNote[]): FlpFile {
  const events = [...file.events];
  const limit = channelStart(events);
  const blocks: number[] = [];
  for (let i = 0; i < limit; i++) if (events[i]!.id === EV.patternNew) blocks.push(i);
  const header = blocks.find(i => events[i]!.value === pattern);
  const channelIndexes = viewProject(file).channels.map(c => c.index);
  if (!channelIndexes.includes(channel)) bad('TARGET_MISMATCH', `channel ${channel} does not exist`);
  if (header !== undefined) {
    const next = blocks.find(i => i > header) ?? limit;
    const noteAt = events.findIndex((e, i) => i > header && i < next && e.id === EV.notes);
    const existing = noteAt >= 0 ? decodeNotes(events[noteAt]!.value as Uint8Array) : [];
    const merged = [...existing.filter(n => n.channel !== channel), ...notes].sort(noteOrder);
    const blob = {id: EV.notes, value: encodeNotes(merged)};
    if (noteAt >= 0) events[noteAt] = blob; else events.splice(header + 1, 0, blob);
  } else {
    // New block mirrors FL's own layout: pattern id, notes, then (channel IID, 0) pairs.
    const block: FlpEvent[] = [{id: EV.patternNew, value: pattern}, {id: EV.notes, value: encodeNotes([...notes].sort(noteOrder))}];
    for (const c of [channel, ...channelIndexes.filter(c => c !== channel)]) {
      block.push({id: EV.channelIid, value: c}, {id: EV.patternUnknown161, value: 0});
    }
    const before = blocks.find(i => (events[i]!.value as number) > pattern) ?? (blocks.length ? undefined : limit);
    let at: number;
    if (before !== undefined) at = before;
    else {
      // after the last existing block: find its end (next block or the first non-block event after its pairs)
      const last = blocks[blocks.length - 1]!;
      at = last + 1;
      while (at < limit && [EV.notes, EV.channelIid, EV.patternUnknown161].includes(events[at]!.id as 224 | 160 | 161)) at++;
    }
    events.splice(at, 0, ...block);
  }
  return {...file, events};
}

export function setTempo(file: FlpFile, bpm: number): FlpFile {
  if (!(bpm >= 10 && bpm <= 522)) bad('INVALID_PAYLOAD', 'tempo must be within 10-522 BPM');
  const idx = file.events.map((e, i) => e.id === EV.tempo ? i : -1).filter(i => i >= 0);
  if (idx.length !== 1) bad('UNSUPPORTED_PROJECT_FORMAT', `expected one tempo event, found ${idx.length}`);
  const events = [...file.events];
  events[idx[0]!] = {id: EV.tempo, value: Math.round(bpm * 1000)};
  return {...file, events};
}

/** Set the length of every playlist item that places `pattern`; only items whose end offset equals their length. */
export function setPatternClipLength(file: FlpFile, pattern: number, ticks: number): FlpFile {
  if (!Number.isInteger(ticks) || ticks <= 0) bad('INVALID_PAYLOAD', 'clip length must be positive ticks');
  const idx = file.events.findIndex(e => e.id === EV.playlist);
  if (idx < 0) bad('UNSUPPORTED_PROJECT_FORMAT', 'no playlist event');
  const blob = (file.events[idx]!.value as Uint8Array).slice();
  const items = decodePlaylist(blob).filter(i => i.pattern === pattern);
  if (!items.length) bad('TARGET_MISMATCH', `pattern ${pattern} is not placed in the playlist`);
  const v = new DataView(blob.buffer);
  for (const item of items) {
    if (item.endOffset !== item.length) bad('UNSUPPORTED_PLAYLIST_LAYOUT', `item ${item.index} is trimmed; refusing to guess offsets`);
    v.setUint32(item.index * PLAYLIST_ITEM_BYTES + 8, ticks, true);
    v.setUint32(item.index * PLAYLIST_ITEM_BYTES + 28, ticks, true);
  }
  const events = [...file.events];
  events[idx] = {id: EV.playlist, value: blob};
  return {...file, events};
}

/** Expected song-time notes per channel: pattern notes placed by playlist items and clipped to item length. */
export function songNotes(view: ProjectView): Map<number, {key: number; start: number; length: number; velocity: number}[]> {
  const out = new Map<number, {key: number; start: number; length: number; velocity: number}[]>();
  for (const item of view.playlist ?? []) {
    if (item.pattern === null) continue;
    const p = view.patterns.find(x => x.index === item.pattern);
    for (const n of p?.notes ?? []) {
      if (n.position >= item.length) continue;
      const list = out.get(n.channel) ?? [];
      list.push({key: n.key, start: item.position + n.position, length: Math.min(n.length, item.length - n.position), velocity: n.velocity});
      out.set(n.channel, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.start - b.start || a.key - b.key);
  return out;
}

export function songLengthTicks(view: ProjectView): number {
  return Math.max(0, ...(view.playlist ?? []).map(i => i.position + i.length));
}
