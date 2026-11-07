/** Browser-safe validation shared by S11 metadata persistence and replay identities. */
import {sha256} from './audio.js';

export const MAX_LIBRARY_BYTES = 2 * 1024 * 1024;
export class LibraryError extends Error {
  constructor(readonly code: 'invalid' | 'version' | 'conflict' | 'limit' | 'unavailable' | 'storage' | 'reconcile',
    detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'LibraryError';
  }
}
export function requireLibrary(ok: unknown, detail: string,
  code: LibraryError['code'] = 'invalid'): asserts ok {
  if (!ok) throw new LibraryError(code, detail);
}
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireLibrary(typeof value === 'object' && value !== null && !Array.isArray(value), 'expected an object');
  const item = value as Record<string, unknown>;
  requireLibrary(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null,
    'expected plain data');
  requireLibrary(Object.keys(item).length === keys.length && keys.every(key => Object.hasOwn(item, key)),
    'unknown or missing fields');
  return item;
}
export function text(value: unknown, maximum = 160): string {
  requireLibrary(typeof value === 'string' && value.trim().length > 0 &&
    value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value), 'expected bounded text');
  return value;
}
export function identifier(value: unknown): string {
  const id = text(value, 96);
  requireLibrary(/^[a-z0-9][a-z0-9._-]*$/.test(id), 'expected a portable identifier');
  return id;
}
export function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  requireLibrary(typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= minimum && value <= maximum, 'integer outside supported bounds');
  return value;
}
export function versionRef(value: unknown): {readonly id: string; readonly revision: number} {
  const item = object(value, ['id', 'revision']);
  return {id: identifier(item.id), revision: integer(item.revision, 1)};
}
export function hash(value: unknown): string {
  requireLibrary(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), 'expected a SHA-256 digest');
  return value;
}
export function sameRef(a: {id: string; revision: number}, b: {id: string; revision: number}): boolean {
  return a.id === b.id && a.revision === b.revision;
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Stable object-key order; array order is part of identity. No executable values. */
export function canonicalJson(value: unknown, depth = 0): string {
  requireLibrary(depth <= 32, 'data nesting limit exceeded', 'limit');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireLibrary(Number.isFinite(value), 'non-finite JSON number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(item => canonicalJson(item, depth + 1)).join(',') + ']';
  requireLibrary(typeof value === 'object' && value !== null, 'only declarative JSON data is supported');
  const item = value as Record<string, unknown>;
  requireLibrary(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null,
    'expected plain JSON data');
  return '{' + Object.keys(item).sort().map(key =>
    JSON.stringify(key) + ':' + canonicalJson(item[key], depth + 1)).join(',') + '}';
}
export function boundedPayload(raw: string): string {
  requireLibrary(typeof raw === 'string' && raw.length <= MAX_LIBRARY_BYTES &&
    new TextEncoder().encode(raw).byteLength <= MAX_LIBRARY_BYTES, 'snapshot exceeds 2 MiB', 'limit');
  return raw;
}
export async function digestJson(value: unknown): Promise<string> {
  return sha256(new TextEncoder().encode(canonicalJson(value)));
}
