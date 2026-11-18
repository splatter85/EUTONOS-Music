/**
 * Folder allow-list validation for the DJ song sources. A path typed by the owner becomes a scan root only if it is
 * an absolute, local, plain directory that is neither a symlink nor a junction nor reached through one. Errors carry a
 * code and a fixed message; the typed path is never echoed back (the phone must not learn private paths).
 */
import {createHash} from 'node:crypto';
import {realpath as realpathCallback} from 'node:fs';
import {lstat, mkdir} from 'node:fs/promises';
import {basename, isAbsolute, parse, resolve, sep} from 'node:path';
import {SOURCES_LIMITS} from '../web/dj-sources.js';

export type SourcePathCode = 'invalid' | 'unc' | 'not-absolute' | 'missing' | 'not-directory' | 'link' | 'reserved';
export class SourcePathError extends Error {
  constructor(readonly code: SourcePathCode, message: string) { super(message); }
}
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$)(?:\..*)?$/i;
/** True for a file or folder name Windows treats as a device, has trailing dots/spaces or stream syntax. */
export function isUnsafeName(name: string): boolean {
  return !name.length || WINDOWS_RESERVED.test(name) || /[<>:"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name);
}
/** Canonical path with true casing, resolving junctions and links in any ancestor (the OS-native realpath). */
export const realNative = (path: string): Promise<string> =>
  new Promise((done, fail) => realpathCallback.native(path, (error, resolved) => error ? fail(error) : done(resolved)));
const foldCase = (p: string): string => process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;

/** Stable id of a canonical folder path. */
export const folderIdOf = (canonical: string): string => `folder-${createHash('sha256').update(foldCase(canonical)).digest('hex').slice(0, 12)}`;

export interface ValidatedFolder { readonly canonical: string; readonly id: string; readonly label: string }

/** Folder label shown in the UI: the last path component, bounded and without control characters. */
export function folderLabel(canonical: string): string {
  const name = basename(canonical) || parse(canonical).root.replace(/[\\/]+$/, '');
  return (name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, SOURCES_LIMITS.maxLabelChars - 'Folder: '.length) || 'folder');
}

export async function validateFolderPath(input: unknown): Promise<ValidatedFolder> {
  if (typeof input !== 'string') throw new SourcePathError('invalid', 'Type the full path of a folder.');
  const typed = input.trim().replace(/^"(.*)"$/, '$1');
  if (!typed.length || typed.length > SOURCES_LIMITS.maxPathChars || /[\x00-\x1f\x7f]/.test(typed)) {
    throw new SourcePathError('invalid', 'Type the full path of a folder (up to 400 characters, no control characters).');
  }
  // UNC and device paths (network shares, \\?\ and \\.\ prefixes) are refused outright, in either slash style.
  if (/^[\\/]{2}/.test(typed)) throw new SourcePathError('unc', 'Network (UNC) and device paths are not accepted. Use a folder on a local drive.');
  const windowsDrive = /^[A-Za-z]:[\\/]/.test(typed);
  if (!isAbsolute(typed) || (process.platform === 'win32' && !windowsDrive)) {
    throw new SourcePathError('not-absolute', 'Use a full path that starts at a drive letter (or /).');
  }
  const lexical = resolve(typed);
  const segments = lexical.slice(parse(lexical).root.length).split(sep).filter(Boolean);
  if (segments.some(isUnsafeName)) throw new SourcePathError('reserved', 'That path has a name that is not allowed (reserved or special characters).');
  let info;
  try { info = await lstat(lexical); } catch { throw new SourcePathError('missing', 'That folder was not found.'); }
  if (info.isSymbolicLink()) throw new SourcePathError('link', 'Links and junctions are not accepted. Add the real folder.');
  if (!info.isDirectory()) throw new SourcePathError('not-directory', 'That path is not a plain folder.');
  // realpath.native yields the canonical casing and resolves junctions/links in ANY ancestor; a difference means an alias.
  let canonical: string;
  try { canonical = await realNative(lexical); } catch { throw new SourcePathError('missing', 'That folder was not found.'); }
  if (/^[\\/]{2}/.test(canonical)) throw new SourcePathError('unc', 'That drive resolves to a network location, which is not accepted.');
  if (foldCase(canonical.replace(/[\\/]+$/, '')) !== foldCase(lexical.replace(/[\\/]+$/, ''))) {
    throw new SourcePathError('link', 'That path goes through a link or junction. Add the real folder.');
  }
  return {canonical, id: folderIdOf(canonical), label: folderLabel(canonical)};
}

/** Creates `segments` under `root` one component at a time, refusing symlinks, junctions and non-directories. */
export async function ensureSafeDirs(root: string, segments: readonly string[], create = true): Promise<string | null> {
  let current = resolve(root);
  for (const segment of segments) {
    current = resolve(current, segment);
    let info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) {
      if (!create) return null;
      await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      info = await lstat(current);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new SourcePathError('link', `${segment} is not a plain directory.`);
  }
  return current;
}

/** True when `child` is `root` or inside it (case-folded on Windows/macOS); both must be canonical absolute paths. */
export function isInside(root: string, child: string): boolean {
  const r = foldCase(root).replace(/[\\/]+$/, ''), c = foldCase(child);
  return c === r || c.startsWith(r + sep) || c.startsWith(r + '/');
}
