/**
 * Durable, local-only store for transition feedback: one JSON line per rating in
 * `<root>/local/transition-ratings/ratings.jsonl` (the repo's git-ignored `/local/`). The phone
 * relay is the only writer. Append-only; re-rating a plan appends a newer line and readers take the
 * latest per plan. Directories are created one component at a time and refused if any is a symlink
 * or junction; the file is refused if it is a symlink and opened with O_NOFOLLOW where the OS has it.
 */
import {constants} from 'node:fs';
import {lstat, mkdir, open} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {latestPerPlan, parseFeedbackLines, parseTransitionFeedback, type TransitionFeedback} from '../web/transition-feedback.js';

export const FEEDBACK_DIR_SEGMENTS = ['local', 'transition-ratings'] as const;
export const FEEDBACK_FILE_NAME = 'ratings.jsonl';
export const FEEDBACK_FILE_LIMITS = Object.freeze({maxFileBytes: 2 * 1024 * 1024, maxLineBytes: 16 * 1024});
export const defaultFeedbackRoot = fileURLToPath(new URL('../../', import.meta.url));

export type FeedbackFileErrorCode = 'unsafe' | 'full' | 'line-too-large';
export class FeedbackFileError extends Error {
  constructor(readonly code: FeedbackFileErrorCode, message: string) { super(message); }
}

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

export class FeedbackFile {
  private queue: Promise<unknown> = Promise.resolve();
  readonly directory: string;
  readonly path: string;

  constructor(readonly root: string = defaultFeedbackRoot) {
    this.directory = join(resolve(root), ...FEEDBACK_DIR_SEGMENTS);
    this.path = join(this.directory, FEEDBACK_FILE_NAME);
  }

  /** Creates each component under the root and refuses symlinks, junctions and non-directories. */
  private async ensureDirectory(): Promise<void> {
    let current = resolve(this.root);
    for (const segment of FEEDBACK_DIR_SEGMENTS) {
      current = join(current, segment);
      let info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
      if (!info) {
        await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
        info = await lstat(current);
      }
      if (info.isSymbolicLink() || !info.isDirectory()) throw new FeedbackFileError('unsafe', `${segment} is not a plain directory.`);
    }
  }
  private async checkFile(): Promise<{size: number} | null> {
    const info = await lstat(this.path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!info) return null;
    if (info.isSymbolicLink() || !info.isFile()) throw new FeedbackFileError('unsafe', 'The ratings file is not a plain file.');
    return {size: info.size};
  }
  private async readText(): Promise<string> {
    await this.ensureDirectory();
    if (!await this.checkFile()) return '';
    const handle = await open(this.path, constants.O_RDONLY | NO_FOLLOW);
    try {
      if (!(await handle.stat()).isFile()) throw new FeedbackFileError('unsafe', 'The ratings file is not a plain file.');
      return await handle.readFile({encoding: 'utf8'});
    } finally { await handle.close(); }
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Validates, then appends one line with a single write on an O_APPEND handle. An identical
   * (plan id, time) pair that is already stored is not written twice.
   */
  async append(value: unknown): Promise<{duplicate: boolean; lines: number}> {
    const entry = parseTransitionFeedback(value);
    const line = JSON.stringify(entry) + '\n';
    if (Buffer.byteLength(line) > FEEDBACK_FILE_LIMITS.maxLineBytes) throw new FeedbackFileError('line-too-large', 'The rating is too large.');
    return this.serialize(async () => {
      const text = await this.readText();
      const existing = parseFeedbackLines(text);
      if (existing.entries.some(e => e.planId === entry.planId && e.at === entry.at)) return {duplicate: true, lines: existing.lines};
      if (Buffer.byteLength(text) + Buffer.byteLength(line) > FEEDBACK_FILE_LIMITS.maxFileBytes) {
        throw new FeedbackFileError('full', 'The ratings file is full.');
      }
      const handle = await open(this.path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NO_FOLLOW, 0o600);
      try {
        if (!(await handle.stat()).isFile()) throw new FeedbackFileError('unsafe', 'The ratings file is not a plain file.');
        await handle.write(line);
      } finally { await handle.close(); }
      return {duplicate: false, lines: existing.lines + 1};
    });
  }

  /** Latest rating per plan plus counts; unreadable lines are skipped and counted. */
  read(): Promise<{entries: TransitionFeedback[]; lines: number; skipped: number}> {
    return this.serialize(async () => {
      const parsed = parseFeedbackLines(await this.readText());
      return {entries: latestPerPlan(parsed.entries), lines: parsed.lines, skipped: parsed.skipped};
    });
  }
  /** Every stored line, for the report (still sanitized and validated). */
  readAll(): Promise<{entries: TransitionFeedback[]; lines: number; skipped: number}> {
    return this.serialize(async () => parseFeedbackLines(await this.readText()));
  }
}
