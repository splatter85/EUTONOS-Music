/**
 * The one EUTONOS Music project writer. Every MCP client process (Claude Code,
 * Codex, ...) goes through this broker, which coordinates across processes with
 * files in a private workspace:
 *
 *   <workspace>/projects/<id>/<id>.flp      current editable project
 *   <workspace>/projects/<id>/project.json  identity and origin
 *   <workspace>/projects/<id>/lease.json    writer lease (one holder)
 *   <workspace>/projects/<id>/journal.jsonl operation journal (caller-known IDs)
 *   <workspace>/projects/<id>/backups/      every pre-mutation revision
 *   <workspace>/projects/<id>/prepared/     prepared, not yet applied changes
 *   <workspace>/projects/<id>/saves/        named, hash-checked checkpoints
 *   <workspace>/projects/<id>/renders/      FL CLI renders + MIDI readback
 *   <workspace>/packs/<pack-id>/            em.audio-pack.v0 output
 *   <workspace>/.fl-host.lock               serialises FL CLI runs across processes
 *
 * Agents never pass filesystem paths; they pass validated IDs.
 */
import {createHash, randomUUID} from 'node:crypto';
import {appendFile, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {AuthoringError} from './errors.js';
import {
  flpNoteToSpec, noteSpecToFlp, parseFlp, replaceChannelNotes, serializeFlp, setPatternClipLength, setTempo,
  songLengthTicks, songNotes, viewProject, type FlpFile, type NoteSpec, type ProjectView,
} from './flp.js';
import {TEMPLATE_IDS, type HostAdapter} from './host.js';
import {parseSmf} from './smf.js';
import {readPcm16Wav, sha256 as webSha256} from '../audio.js';
import {loadPack} from '../node.js';
import {PACK_VERSION, type AudioPack} from '../pack-types.js';
import {validatePackManifest, quartersToFrames} from '../pack.js';

export const BRIDGE_VERSION = '0.1.0';
export const CONTRACT_VERSION = 'em.fl-authoring.v0';

const ID = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
const OPID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$/;

export function defaultWorkspace(): string {
  if (process.env.EUTONOS_MUSIC_WORKSPACE) return process.env.EUTONOS_MUSIC_WORKSPACE;
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'EUTONOS-Music', 'workspace');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'EUTONOS-Music', 'workspace');
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'eutonos-music', 'workspace');
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const now = () => new Date().toISOString();

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/; // Windows device names

function checkId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID.test(value) || value.length > 64) throw new AuthoringError('INVALID_PAYLOAD', `${what} must be a lowercase id`);
  if (RESERVED.test(value)) throw new AuthoringError('INVALID_PAYLOAD', `${what} "${value}" is a reserved device name on Windows`);
  return value;
}
function checkOp(value: unknown): string {
  if (typeof value !== 'string' || !OPID.test(value)) throw new AuthoringError('INVALID_PAYLOAD', 'operation_id must be 3-96 chars [A-Za-z0-9._:-]');
  return value;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Rename with a short retry: Windows refuses to replace a file another process is reading (EPERM/EBUSY/EACCES). */
async function renameRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(from, to); return; } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (attempt >= 20 || !(code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) throw e;
      await sleep(50);
    }
  }
}

async function atomicWrite(path: string, bytes: Uint8Array | string): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, bytes);
  try { await renameRetry(tmp, path); } catch (e) { await rm(tmp, {force: true}); throw e; }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

interface LockInfo { holder: string; token: string; pid: number; at: string }

/**
 * Cross-process lock by exclusive create. A lock whose owning process is gone,
 * or that is older than staleMs, is moved aside and replaced. Only the owner
 * (matching token) removes a lock.
 */
async function withLock<T>(lock: string, holder: string, waitMs: number, staleMs: number,
  busy: (info: string) => AuthoringError, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID(), deadline = Date.now() + waitMs;
  for (;;) {
    let h;
    try { h = await open(lock, 'wx'); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      if (await breakStaleLock(lock, staleMs)) continue;
      if (Date.now() >= deadline) throw busy(await readFile(lock, 'utf8').catch(() => '?'));
      await sleep(100);
      continue;
    }
    try { await h.writeFile(JSON.stringify({holder, token, pid: process.pid, at: now()} satisfies LockInfo)); }
    catch (e) { await h.close().catch(() => undefined); await rm(lock, {force: true}); throw e; }
    await h.close();
    break;
  }
  try { return await fn(); } finally {
    const current = await readFile(lock, 'utf8').catch(() => null);
    let owner: string | null = null;
    try { owner = current ? (JSON.parse(current) as LockInfo).token : null; } catch { /* not ours */ }
    if (owner === token) await rm(lock, {force: true});
  }
}

async function breakStaleLock(lock: string, staleMs: number): Promise<boolean> {
  const text = await readFile(lock, 'utf8').catch(() => null);
  if (text === null) return true; // released meanwhile
  let info: LockInfo | null = null;
  try { info = JSON.parse(text) as LockInfo; } catch { /* being written, or damaged */ }
  const age = Date.now() - ((await stat(lock).catch(() => null))?.mtimeMs ?? Date.now());
  const ownerGone = !!info && info.pid !== process.pid && !pidAlive(info.pid);
  if (!(ownerGone || age > staleMs || (!info && age > 2000))) return false;
  const aside = `${lock}.stale-${randomUUID().slice(0, 8)}`;
  try { await rename(lock, aside); } catch { return false; }
  const moved = await readFile(aside, 'utf8').catch(() => null);
  // If a new holder replaced the lock between our read and the rename, put theirs back.
  if (moved !== text) { await rename(aside, lock).catch(() => undefined); return false; }
  await rm(aside, {force: true});
  return true;
}

async function exists(path: string): Promise<boolean> { return !!(await stat(path).catch(() => null)); }

export interface EditTarget {
  readonly pattern: {readonly index: number; readonly expected_name: string};
  readonly channel: {readonly index: number; readonly expected_name: string};
  readonly notes: readonly NoteSpec[];
}
export interface EditRequest {
  readonly project_id: string;
  readonly expected_revision: string;
  readonly tempo_bpm?: number;
  readonly targets: readonly EditTarget[];
  /** Optional: set every playlist clip of these patterns to this many bars (unmodified clips only). */
  readonly clip_bars?: number;
}

export interface JournalRecord {
  readonly operation_id: string;
  readonly kind: string;
  readonly project_id: string;
  readonly payload_hash: string;
  readonly client_id: string;
  readonly state: 'started' | 'completed' | 'failed';
  readonly at: string;
  readonly before_revision?: string;
  readonly after_revision?: string;
  readonly result?: unknown;
  readonly error?: {code: string; message: string};
  /** Kind-specific facts used to reconcile an interrupted operation. */
  readonly detail?: Record<string, string>;
}

export interface Fault { afterWrite?: boolean }

export class Broker {
  readonly clientId: string;
  /** Test-only fault injection; never set from MCP input. */
  fault: Fault = {};

  constructor(readonly workspace: string, readonly host: HostAdapter, clientLabel = 'client') {
    this.clientId = `${clientLabel.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 32) || 'client'}:${randomUUID().slice(0, 8)}`;
  }

  // ---------- paths ----------
  private dir(project: string) { return join(this.workspace, 'projects', checkId(project, 'project_id')); }
  private flpPath(project: string) { return join(this.dir(project), `${project}.flp`); }

  private async requireDir(project: string): Promise<void> {
    if (!(await exists(this.dir(project)))) throw new AuthoringError('UNKNOWN_PROJECT', `no project ${project}`);
  }

  private async requireProject(project: string): Promise<void> {
    if (!(await exists(join(this.dir(project), 'project.json')))) throw new AuthoringError('UNKNOWN_PROJECT', `no project ${project}`);
  }

  async readProject(project: string): Promise<{bytes: Uint8Array; revision: string; file: FlpFile; view: ProjectView}> {
    await this.requireProject(project);
    const bytes = new Uint8Array(await readFile(this.flpPath(project)));
    let file: FlpFile;
    try { file = parseFlp(bytes); } catch (e) { throw new AuthoringError('UNSUPPORTED_PROJECT_FORMAT', String(e)); }
    return {bytes, revision: sha(bytes), file, view: viewProject(file)};
  }

  // ---------- journal ----------
  /** Reads the journal. A damaged final line (interrupted append) is skipped; damage elsewhere is refused. */
  private async journal(project: string): Promise<JournalRecord[]> {
    const text = await readFile(join(this.dir(project), 'journal.jsonl'), 'utf8').catch(() => '');
    const lines = text.split('\n');
    const out: JournalRecord[] = [];
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try { out.push(JSON.parse(line) as JournalRecord); } catch {
        if (lines.slice(i + 1).some(l => l.trim())) throw new AuthoringError('JOURNAL_CORRUPT', `journal line ${i + 1} of ${project} is damaged; restore it from the workspace before continuing`);
      }
    });
    return out;
  }
  private async record(r: JournalRecord): Promise<void> {
    const path = join(this.dir(r.project_id), 'journal.jsonl');
    const text = await readFile(path, 'utf8').catch(() => '');
    if (text && !text.endsWith('\n')) {
      // An interrupted append left a torn final line: keep it in journal.torn and cut it off before appending.
      const cut = text.lastIndexOf('\n') + 1;
      await appendFile(join(this.dir(r.project_id), 'journal.torn'), text.slice(cut) + '\n');
      const h = await open(path, 'r+');
      try { await h.truncate(Buffer.byteLength(text.slice(0, cut), 'utf8')); } finally { await h.close(); }
    }
    await appendFile(path, JSON.stringify(r) + '\n');
  }
  private async latest(project: string, operationId: string): Promise<JournalRecord | undefined> {
    return (await this.journal(project)).filter(r => r.operation_id === operationId).pop();
  }

  /**
   * Idempotency gate, consulted BEFORE lease/revision checks: a completed operation
   * with the same payload returns its recorded outcome; a different payload under
   * the same ID conflicts; a started-but-unfinished one must be reconciled first.
   */
  private async replay(project: string, operationId: string, payloadHash: string): Promise<unknown | undefined> {
    const prior = await this.latest(project, operationId);
    if (!prior) return undefined;
    if (prior.payload_hash !== payloadHash) throw new AuthoringError('OPERATION_ID_CONFLICT', `${operationId} was used with a different payload`);
    if (prior.state === 'completed') return {...(prior.result as object), replayed: true};
    if (prior.state === 'failed') {
      throw new AuthoringError(prior.error?.code ?? 'OPERATION_FAILED',
        `operation ${operationId} already failed and is not re-run (replayed: ${prior.error?.message ?? 'no detail'}). Fix the cause and use a new operation_id.`);
    }
    throw new AuthoringError('OUTCOME_UNKNOWN', `${operationId} started at ${prior.at} without a recorded outcome; call fl_operation_status before retrying`, true);
  }

  // ---------- writer lease and critical section ----------
  async acquireWriter(project: string, ttlSeconds = 900): Promise<object> {
    await this.requireProject(project);
    if (!(ttlSeconds >= 30 && ttlSeconds <= 3600)) throw new AuthoringError('INVALID_PAYLOAD', 'ttl_seconds must be 30-3600');
    return this.critical(project, async () => {
      const path = join(this.dir(project), 'lease.json');
      const current = JSON.parse(await readFile(path, 'utf8').catch(() => 'null')) as {holder: string; expires_at: string} | null;
      if (current && current.holder !== this.clientId && Date.parse(current.expires_at) > Date.now()) {
        throw new AuthoringError('LEASE_CONFLICT', `writer lease held by ${current.holder} until ${current.expires_at}`);
      }
      const lease = {holder: this.clientId, acquired_at: now(), expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        previous_holder: current && current.holder !== this.clientId ? current.holder : null};
      await atomicWrite(path, JSON.stringify(lease, null, 2));
      return {project_id: project, ...lease};
    });
  }

  async releaseWriter(project: string): Promise<object> {
    return this.critical(project, async () => {
      const path = join(this.dir(project), 'lease.json');
      const current = JSON.parse(await readFile(path, 'utf8').catch(() => 'null')) as {holder: string} | null;
      if (!current) return {released: false, reason: 'no lease'};
      if (current.holder !== this.clientId) throw new AuthoringError('LEASE_CONFLICT', `lease held by ${current.holder}`);
      await rm(path);
      return {released: true};
    });
  }

  private async leaseState(project: string) {
    const lease = JSON.parse(await readFile(join(this.dir(project), 'lease.json'), 'utf8').catch(() => 'null')) as {holder: string; expires_at: string} | null;
    return lease && Date.parse(lease.expires_at) > Date.now() ? lease : null;
  }

  private async requireLease(project: string): Promise<void> {
    const lease = await this.leaseState(project);
    if (!lease) throw new AuthoringError('LEASE_REQUIRED', 'acquire the writer lease (fl_acquire_writer) before mutating');
    if (lease.holder !== this.clientId) throw new AuthoringError('LEASE_CONFLICT', `writer lease held by ${lease.holder} until ${lease.expires_at}`);
  }

  /** Short cross-process critical section per project. Stale locks (dead owner, >2 min) are broken automatically. */
  private critical<T>(project: string, fn: () => Promise<T>): Promise<T> {
    return withLock(join(this.dir(project), '.write.lock'), this.clientId, 5000, 120_000,
      info => new AuthoringError('WRITER_BUSY', `another writer is inside this project's critical section (${info}); retry shortly`), fn);
  }

  /** Serialises FL CLI runs (render, MIDI readback) across every client process. */
  private async hostExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(this.workspace, {recursive: true});
    return withLock(join(this.workspace, '.fl-host.lock'), this.clientId, 60_000, 600_000,
      info => new AuthoringError('HOST_BUSY', `another client is running the FL Studio CLI (${info}); retry later`), fn);
  }

  /** Fails closed: if the FL process check itself fails, the host is treated as busy. */
  private async guiHolds(project: string): Promise<string | null> {
    let titles: readonly string[];
    try { titles = await this.host.runningInstances(); }
    catch (e) { throw new AuthoringError('HOST_BUSY', `cannot determine whether FL Studio has the project open (${String((e as Error).message)})`); }
    return titles.find(t => t.toLowerCase().includes(`${project}.flp`)) ?? null;
  }

  // ---------- discovery ----------
  async capabilities(): Promise<object> {
    const host = await this.host.info();
    return {
      contract_version: CONTRACT_VERSION, bridge_version: BRIDGE_VERSION, host,
      writer: {model: 'single broker per workspace; writer lease + cross-process lock; caller operation IDs', client_id: this.clientId},
      operations: {
        supported: [
          'fl_create_project (copy of an allowlisted FL factory template into the private workspace)',
          'fl_inspect (offline read of the saved project: version, tempo, meter, channels, patterns, notes, playlist clips)',
          'fl_prepare_edit / fl_apply_edit (replace one channel\'s notes inside a named pattern; tempo; clip length)',
          'fl_verify (file readback + FL-side readback through FL\'s own MIDI export)',
          'fl_save (named checkpoint, hash-checked; FL-side readback is fl_verify)',
          'fl_render (official FL CLI WAV render) and fl_verify_export',
          'fl_build_pack (em.audio-pack.v0, validated with the S01 loader)',
          'fl_operation_status (reconcile by operation_id) and fl_restore (backup recovery)',
        ],
        partial: [
          'arrangement: only resizing existing, untrimmed pattern clips',
          'project format: writes only FL 24.x-layout projects (verified); other layouts are read-only or rejected',
        ],
        unsupported: [
          'live edits inside a running FL GUI session (no MIDI input port on this host for controller scripting; render/export refuses while FL is open)',
          'creating channels, loading plugins/samples, mixer and plugin-parameter edits',
          'arbitrary Python, GUI clicks or filesystem paths from agents',
          'render settings (sample rate, bit depth, stems): FL CLI uses the project/app defaults (observed PCM16 stereo 44.1 kHz)',
        ],
      },
      templates: TEMPLATE_IDS,
      workspace: 'private per-user workspace (not exposed as a path)',
    };
  }

  async listProjects(): Promise<object> {
    const root = join(this.workspace, 'projects');
    const ids = (await readdir(root).catch(() => [] as string[])).filter(d => ID.test(d));
    const out = [];
    for (const id of ids) {
      if (!(await exists(join(root, id, 'project.json')))) continue;
      const meta = JSON.parse(await readFile(join(root, id, 'project.json'), 'utf8'));
      const bytes = await readFile(this.flpPath(id)).catch(() => null);
      out.push({project_id: id, created_from: meta.created_from, revision: bytes ? sha(bytes) : null});
    }
    return {projects: out};
  }

  async inspect(project: string, includeNotes = false): Promise<object> {
    const {revision, view} = await this.readProject(project);
    const lease = await this.leaseState(project);
    return {
      project_id: project, revision, fl_version: view.flVersion, layout_verified: view.layoutVerified, ppq: view.ppq,
      tempo_bpm: view.tempoBpm, time_signature: view.timeSignature,
      channels: view.channels.map(c => ({index: c.index, name: c.name, plugin: c.plugin})),
      patterns: view.patterns.map(p => ({index: p.index, name: p.name, note_count: p.notes.length,
        notes_by_channel: Object.fromEntries([...new Set(p.notes.map(n => n.channel))].map(c => [c, p.notes.filter(n => n.channel === c).length])),
        ...(includeNotes ? {notes: p.notes.map(n => ({channel: n.channel, ...flpNoteToSpec(n, view.ppq)}))} : {})})),
      playlist: view.playlist?.map(i => ({pattern: i.pattern, track: i.track, start_quarters: i.position / view.ppq, length_quarters: i.length / view.ppq})) ?? null,
      playlist_error: view.playlistError,
      song_length_quarters: songLengthTicks(view) / view.ppq,
      writer_lease: lease, fl_gui_holding_project: await this.guiHolds(project).catch(() => 'unknown (FL process check failed)'),
    };
  }

  // ---------- create ----------
  async createProject(project: string, templateId: string, operationId: string): Promise<object> {
    checkId(project, 'project_id'); checkOp(operationId);
    if (!(TEMPLATE_IDS as readonly string[]).includes(templateId)) throw new AuthoringError('INVALID_PAYLOAD', `template must be one of ${TEMPLATE_IDS.join(', ')}`);
    const dir = this.dir(project);
    const payloadHash = sha(new TextEncoder().encode(`create:${templateId}`));
    if (await exists(dir)) {
      const replayed = await this.replay(project, operationId, payloadHash);
      if (replayed !== undefined) return replayed as object;
      throw new AuthoringError('PROJECT_EXISTS', `project ${project} already exists`);
    }
    const source = await this.host.templatePath(templateId);
    if (!source) throw new AuthoringError('HOST_UNAVAILABLE', `template ${templateId} is not available on this host`);
    const bytes = new Uint8Array(await readFile(source));
    const view = viewProject(parseFlp(bytes));
    if (!view.layoutVerified) throw new AuthoringError('UNSUPPORTED_PROJECT_FORMAT', `template layout ${view.flVersion} is not verified`);
    await mkdir(join(this.workspace, 'projects'), {recursive: true});
    // Non-recursive mkdir is the exclusive create: exactly one process wins.
    try { await mkdir(dir); } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      throw new AuthoringError('PROJECT_EXISTS', `project ${project} already exists`);
    }
    const revision = sha(bytes);
    const base = {operation_id: operationId, kind: 'create', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
      after_revision: revision, detail: {template: templateId}};
    await this.record({...base, state: 'started', at: now()});
    await mkdir(join(dir, 'backups'), {recursive: true});
    await atomicWrite(this.flpPath(project), bytes);
    await atomicWrite(join(dir, 'project.json'), JSON.stringify({project_id: project, created_from: templateId, created_at: now(),
      created_by: this.clientId, template_sha256: revision}, null, 2));
    const result = {project_id: project, revision, created_from: templateId, fl_version: view.flVersion};
    await this.record({...base, state: 'completed', at: now(), result});
    return result;
  }

  // ---------- prepare / apply ----------
  private plan(file: FlpFile, view: ProjectView, req: EditRequest): FlpFile {
    let next = file;
    if (!Array.isArray(req.targets) || req.targets.length === 0 || req.targets.length > 16) {
      throw new AuthoringError('INVALID_PAYLOAD', 'targets must contain 1-16 entries');
    }
    if (req.tempo_bpm !== undefined) next = setTempo(next, req.tempo_bpm);
    const seen = new Set<string>();
    req.targets.forEach((t, i) => {
      const at = `targets[${i}]`;
      const pat = view.patterns.find(p => p.index === t?.pattern?.index);
      const ch = view.channels.find(c => c.index === t?.channel?.index);
      if (!pat || pat.name !== t.pattern.expected_name) {
        throw new AuthoringError('TARGET_MISMATCH', `${at}: pattern ${t?.pattern?.index} is "${pat?.name ?? 'missing'}", expected "${t?.pattern?.expected_name}"`);
      }
      if (!ch || ch.name !== t.channel.expected_name) {
        throw new AuthoringError('TARGET_MISMATCH', `${at}: channel ${t?.channel?.index} is "${ch?.name ?? 'missing'}", expected "${t?.channel?.expected_name}"`);
      }
      const key = `${pat.index}/${ch.index}`;
      if (seen.has(key)) throw new AuthoringError('INVALID_PAYLOAD', `${at}: duplicate target ${key}`);
      seen.add(key);
      if (!Array.isArray(t.notes) || t.notes.length > 2048) throw new AuthoringError('INVALID_PAYLOAD', `${at}.notes must be an array of at most 2048`);
      try {
        next = replaceChannelNotes(next, pat.index, ch.index, (t.notes as readonly NoteSpec[]).map((n: NoteSpec, j: number) => noteSpecToFlp(n, ch.index, view.ppq, `${at}.notes[${j}]`)));
      } catch (e) { throw new AuthoringError((e as {code?: string}).code ?? 'INVALID_PAYLOAD', String((e as Error).message)); }
    });
    if (req.clip_bars !== undefined) {
      if (!Number.isInteger(req.clip_bars) || req.clip_bars < 1 || req.clip_bars > 64) throw new AuthoringError('INVALID_PAYLOAD', 'clip_bars must be 1-64');
      const [num, den] = view.timeSignature ?? [4, 4];
      const ticks = req.clip_bars * num * 4 / den * view.ppq;
      for (const p of new Set(req.targets.map(t => t.pattern.index))) {
        try { next = setPatternClipLength(next, p, ticks); }
        catch (e) { throw new AuthoringError((e as {code?: string}).code ?? 'INVALID_PAYLOAD', String((e as Error).message)); }
      }
    }
    return next;
  }

  async prepareEdit(req: EditRequest): Promise<object> {
    const project = checkId(req?.project_id, 'project_id');
    const {revision, file, view} = await this.readProject(project);
    if (!view.layoutVerified) throw new AuthoringError('UNSUPPORTED_PROJECT_FORMAT', `writes are verified only for FL 24.x layout, not ${view.flVersion}`);
    if (req.expected_revision !== revision) throw new AuthoringError('TARGET_CHANGED', `project is at ${revision}, not ${req.expected_revision}`);
    const after = serializeFlp(this.plan(file, view, req));
    const afterView = viewProject(parseFlp(after));
    const changeId = `chg-${sha(new TextEncoder().encode(canonical(req))).slice(0, 16)}`;
    const prepared = {change_id: changeId, project_id: project, request: req, before_revision: revision, after_revision: sha(after),
      prepared_by: this.clientId, prepared_at: now()};
    await mkdir(join(this.dir(project), 'prepared'), {recursive: true});
    await atomicWrite(join(this.dir(project), 'prepared', `${changeId}.json`), JSON.stringify(prepared, null, 2));
    return {
      change_id: changeId, project_id: project, before_revision: revision, after_revision: prepared.after_revision,
      summary: req.targets.map(t => {
        const before = view.patterns.find(p => p.index === t.pattern.index)?.notes.filter(n => n.channel === t.channel.index).length ?? 0;
        return {pattern: t.pattern, channel: t.channel, notes_before: before, notes_after: t.notes.length};
      }),
      tempo_bpm: {before: view.tempoBpm, after: afterView.tempoBpm},
      song_length_quarters: {before: songLengthTicks(view) / view.ppq, after: songLengthTicks(afterView) / afterView.ppq},
      next_action: 'Acquire the writer lease, then call fl_apply_edit with this change_id and a new caller-known operation_id.',
    };
  }

  async applyEdit(project: string, changeId: string, operationId: string): Promise<object> {
    checkId(project, 'project_id'); checkOp(operationId);
    if (typeof changeId !== 'string' || !/^chg-[a-f0-9]{16}$/.test(changeId)) throw new AuthoringError('INVALID_PAYLOAD', 'bad change_id');
    await this.requireProject(project);
    const payloadHash = sha(new TextEncoder().encode(`apply:${changeId}`));
    const replayed = await this.replay(project, operationId, payloadHash);
    if (replayed !== undefined) return replayed as object;
    await this.requireLease(project);
    const preparedText = await readFile(join(this.dir(project), 'prepared', `${changeId}.json`), 'utf8').catch(() => null);
    if (!preparedText) throw new AuthoringError('UNKNOWN_CHANGE', `no prepared change ${changeId}`);
    const prepared = JSON.parse(preparedText) as {request: EditRequest; before_revision: string; after_revision: string};
    const gui = await this.guiHolds(project);
    if (gui) throw new AuthoringError('HOST_BUSY', `FL Studio has this project open (${gui}); it is a competing writer. Close it first.`);

    return this.critical(project, async () => {
      await this.requireLease(project); // re-checked inside the lock so the lease cannot change hands mid-write
      const {bytes, revision, file, view} = await this.readProject(project);
      if (revision !== prepared.before_revision) {
        throw new AuthoringError('TARGET_CHANGED', `project changed since prepare (now ${revision}); prepare again`);
      }
      const after = serializeFlp(this.plan(file, view, prepared.request));
      const afterRevision = sha(after);
      if (afterRevision !== prepared.after_revision) throw new AuthoringError('TARGET_CHANGED', 'deterministic replan differs from prepared plan');
      await this.record({operation_id: operationId, kind: 'apply', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
        state: 'started', at: now(), before_revision: revision, after_revision: afterRevision});
      const backup = join(this.dir(project), 'backups', `${revision}.flp`);
      if (!(await exists(backup))) await atomicWrite(backup, bytes);
      await atomicWrite(this.flpPath(project), after);
      if (this.fault.afterWrite) throw new AuthoringError('OUTCOME_UNKNOWN', 'injected fault after write, before journal completion', true);
      const check = await this.fileReadback(project, prepared.request);
      const result = {status: check.ok ? 'applied_file_verified' : 'applied_readback_mismatch', operation_id: operationId,
        change_id: changeId, project_id: project, before_revision: revision, after_revision: afterRevision, backup_revision: revision,
        readback: check, next_action: 'Call fl_verify for FL-side readback before declaring the musical edit complete.'};
      await this.record({operation_id: operationId, kind: 'apply', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
        state: 'completed', at: now(), before_revision: revision, after_revision: afterRevision, result});
      return result;
    });
  }

  private async fileReadback(project: string, req: EditRequest) {
    const {revision, view} = await this.readProject(project);
    const mismatches: string[] = [];
    const tick = (n: {position: number; key: number; length: number; velocity: number}) => `${n.position}:${n.key}:${n.length}:${n.velocity}`;
    for (const t of req.targets) {
      // Compared in ticks, exactly as stored, so fractional quarters do not cause false mismatches.
      const got = (view.patterns.find(p => p.index === t.pattern.index)?.notes ?? []).filter(n => n.channel === t.channel.index).map(tick);
      const want = t.notes.map((n, j) => tick(noteSpecToFlp(n, t.channel.index, view.ppq, `targets.notes[${j}]`)));
      const a = [...got].sort(), b = [...want].sort();
      if (a.length !== b.length || a.some((x, i) => x !== b[i])) mismatches.push(`pattern ${t.pattern.index}/channel ${t.channel.index}: ${a.length} notes read, ${b.length} intended`);
    }
    if (req.tempo_bpm !== undefined && view.tempoBpm !== Math.round(req.tempo_bpm * 1000) / 1000) mismatches.push(`tempo ${view.tempoBpm}`);
    return {ok: mismatches.length === 0, revision, mismatches, method: 'reparse of the persisted project file'};
  }

  // ---------- FL-side verification ----------
  /** Asks FL itself to load the saved project and export MIDI; compares per channel with the file's song notes. */
  async verify(project: string): Promise<object> {
    await this.requireProject(project);
    return this.hostExclusive(() => this.verifyLocked(project));
  }

  private async verifyLocked(project: string): Promise<object> {
    const {bytes, revision, view} = await this.readProject(project);
    const work = join(this.dir(project), 'verify', revision.slice(0, 16));
    await mkdir(work, {recursive: true});
    const copy = join(work, `${project}.flp`), mid = join(work, `${project}.mid`);
    await writeFile(copy, bytes);
    await rm(mid, {force: true});
    const run = await this.host.exportMidi(copy);
    const midBytes = await readFile(mid).catch(() => null);
    if (!midBytes) throw new AuthoringError('EXPORT_FAILED', `FL produced no MIDI readback (exit ${run.exit_code})`);
    const smf = parseSmf(new Uint8Array(midBytes));
    const expected = songNotes(view);
    const songEnd = songLengthTicks(view), scale = smf.division / view.ppq;
    let endTrimmed = 0;
    const channels = view.channels.map(c => {
      // Observed FL 26.1 convention: a note that ends exactly at the song end is exported one tick shorter.
      const want = (expected.get(c.index) ?? []).map(n => {
        const atEnd = n.start + n.length === songEnd;
        return {key: n.key, start: n.start, length: atEnd ? n.length - 1 / scale : n.length, velocity: Math.min(127, n.velocity), atEnd};
      });
      const named = smf.tracks.filter(t => t.name === c.name);
      const track = named.length === 1 ? named[0] : undefined;
      const got = (track?.notes ?? []).map(n => ({key: n.key, start: n.start / scale, length: n.length / scale, velocity: n.velocity}));
      const k = (x: {key: number; start: number; length: number; velocity: number}) => `${x.start}:${x.key}:${x.length}:${x.velocity}`;
      const remaining = new Map<string, number>();
      for (const x of got) remaining.set(k(x), (remaining.get(k(x)) ?? 0) + 1);
      let missing = 0;
      for (const x of want) {
        const left = remaining.get(k(x)) ?? 0;
        if (left > 0) { remaining.set(k(x), left - 1); if (x.atEnd) endTrimmed++; } else missing++;
      }
      const extra = [...remaining.values()].reduce((a, b) => a + b, 0);
      return {channel: c.index, name: c.name, expected_notes: want.length, fl_exported_notes: got.length, missing, extra,
        match: missing === 0 && extra === 0 && (want.length === 0 || named.length === 1),
        track: named.length === 1 ? 'found' : named.length === 0 ? 'absent' : 'ambiguous (duplicate channel names)'};
    });
    const tempoFromMidi = smf.tempoUsPerQuarter ? Math.round(60e9 / smf.tempoUsPerQuarter) / 1000 : null;
    const problems: string[] = [];
    if (view.playlistError) problems.push(`playlist not readable: ${view.playlistError}`);
    if (!channels.some(c => c.expected_notes > 0)) problems.push('no arranged notes to compare');
    if (tempoFromMidi === null || view.tempoBpm === null) problems.push('tempo missing from the project or FL MIDI export');
    else if (Math.abs(tempoFromMidi - view.tempoBpm) > 0.01) problems.push(`tempo differs: file ${view.tempoBpm}, FL export ${tempoFromMidi}`);
    for (const c of channels) if (!c.match) problems.push(`channel ${c.channel} (${c.name}): ${c.missing} missing, ${c.extra} extra, track ${c.track}`);
    return {project_id: project, revision, method: 'FL Studio CLI MIDI export of the saved project (FL parses and re-emits the notes)',
      host_command: run.command, exit_code: run.exit_code, fl_midi_tempo_bpm: tempoFromMidi, file_tempo_bpm: view.tempoBpm,
      song_length_quarters: songEnd / view.ppq, channels,
      compared: 'key, start, length and velocity of every song-time note per channel (multiset)',
      fl_export_convention: {notes_ending_at_song_end_exported_one_tick_short: endTrimmed},
      problems, verified: problems.length === 0};
  }

  // ---------- save ----------
  async save(project: string, label: string, operationId: string): Promise<object> {
    checkOp(operationId); checkId(label, 'label');
    await this.requireProject(project);
    const payloadHash = sha(new TextEncoder().encode(`save:${label}`));
    const replayed = await this.replay(project, operationId, payloadHash);
    if (replayed !== undefined) return replayed as object;
    return this.critical(project, async () => {
      const {bytes, revision} = await this.readProject(project);
      const savesDir = join(this.dir(project), 'saves');
      const name = `${label}-${revision.slice(0, 12)}.flp`, path = join(savesDir, name);
      await this.record({operation_id: operationId, kind: 'save', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
        state: 'started', at: now(), before_revision: revision, detail: {checkpoint: `saves/${name}`}});
      try {
        await mkdir(savesDir, {recursive: true});
        await atomicWrite(path, bytes);
        const readback = sha(new Uint8Array(await readFile(path)));
        if (readback !== revision) throw new AuthoringError('SAVE_FAILED', 'checkpoint bytes differ after write');
      } catch (e) {
        const error = {code: 'SAVE_FAILED', message: String((e as Error).message)};
        await this.record({operation_id: operationId, kind: 'save', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
          state: 'failed', at: now(), before_revision: revision, error});
        throw new AuthoringError('SAVE_FAILED', error.message);
      }
      const result = {status: 'saved', operation_id: operationId, project_id: project, revision, checkpoint: `saves/${name}`,
        editable: 'FL Studio project (.flp); open it in FL Studio to continue editing',
        next_action: 'Call fl_verify to have FL load this revision and read its notes back.'};
      await this.record({operation_id: operationId, kind: 'save', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
        state: 'completed', at: now(), before_revision: revision, after_revision: revision, result});
      return result;
    });
  }

  // ---------- render ----------
  async render(project: string, operationId: string): Promise<object> {
    checkOp(operationId);
    await this.requireProject(project);
    return this.hostExclusive(() => this.renderLocked(project, operationId));
  }

  private async renderLocked(project: string, operationId: string): Promise<object> {
    const {bytes, revision, view} = await this.readProject(project);
    const payloadHash = sha(new TextEncoder().encode(`render:${revision}`));
    const replayed = await this.replay(project, operationId, payloadHash);
    if (replayed !== undefined) return replayed as object;
    // Unique per operation id (hash), so two operations never share a render folder.
    const renderId = `r-${revision.slice(0, 12)}-${sha(new TextEncoder().encode(operationId)).slice(0, 12)}`;
    const dir = join(this.dir(project), 'renders', renderId);
    const flp = join(dir, `${project}.flp`), wav = join(dir, `${project}.wav`);
    await this.record({operation_id: operationId, kind: 'render', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
      state: 'started', at: now(), before_revision: revision, detail: {render_id: renderId}});
    try {
      await mkdir(dir, {recursive: true});
      await writeFile(flp, bytes);
      await rm(wav, {force: true});
      const host = await this.host.info();
      const run = await this.host.renderWav(flp);
      if (!(await exists(wav))) throw new AuthoringError('EXPORT_FAILED', `FL exited ${run.exit_code} without writing a WAV`);
      const quarters = songLengthTicks(view) / view.ppq;
      const meta = {render_id: renderId, project_id: project, source_revision: revision, operation_id: operationId,
        rendered_at: now(), host: {adapter: host.adapter, fl_version: host.fl_version}, command: run.command, exit_code: run.exit_code,
        duration_ms: run.duration_ms, expected_body_quarters: quarters, tempo_bpm: view.tempoBpm, render_settings: 'FL CLI defaults (not selectable)'};
      const report = await this.inspectWav(wav, meta.expected_body_quarters, meta.tempo_bpm);
      const record = {...meta, wav: report};
      await atomicWrite(join(dir, 'render.json'), JSON.stringify(record, null, 2));
      if (!report.ok) throw new AuthoringError('EXPORT_INVALID', report.problems.join('; '));
      const result = {status: 'rendered', ...record};
      await this.record({operation_id: operationId, kind: 'render', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
        state: 'completed', at: now(), before_revision: revision, result});
      return result;
    } catch (e) {
      const error = {code: (e as {code?: string}).code ?? 'EXPORT_FAILED', message: String((e as Error).message)};
      await this.record({operation_id: operationId, kind: 'render', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
        state: 'failed', at: now(), before_revision: revision, error});
      throw e;
    }
  }

  private async inspectWav(path: string, bodyQuarters: number, bpm: number | null) {
    const problems: string[] = [];
    const bytes = new Uint8Array(await readFile(path));
    let info: ReturnType<typeof readPcm16Wav> | null = null;
    try { info = readPcm16Wav(bytes); } catch (e) { problems.push(String((e as Error).message)); }
    const bodyFrames = info && bpm ? quartersToFrames(bodyQuarters, bpm, info.sample_rate) : null;
    if (info && bodyFrames !== null && info.frames < bodyFrames) problems.push(`WAV has ${info.frames} frames, musical body needs ${bodyFrames}`);
    if (info && info.peak === 0) problems.push('WAV is digitally silent');
    if (info && info.peak >= 1) problems.push('WAV reaches full scale (possible clipping)');
    let onsetFrame: number | null = null;
    if (info) {
      const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = info.data_offset, f = 0; i < info.data_offset + info.data_bytes; i += 2 * info.channels, f++) {
        let m = 0;
        for (let c = 0; c < info.channels; c++) m = Math.max(m, Math.abs(v.getInt16(i + 2 * c, true)));
        if (m > 328) { onsetFrame = f; break; } // first sample above -40 dBFS
      }
    }
    return {ok: problems.length === 0, problems, sha256: sha(bytes), bytes: bytes.length, format: info ? 'pcm16-wav' : null,
      sample_rate: info?.sample_rate ?? null, channels: info?.channels ?? null, frames: info?.frames ?? null,
      duration_seconds: info ? info.frames / info.sample_rate : null, peak: info?.peak ?? null,
      body_frames: bodyFrames, first_onset_frame_above_minus40dbfs: onsetFrame};
  }

  async verifyExport(project: string, renderId: string): Promise<object> {
    await this.requireProject(project);
    if (typeof renderId !== 'string' || !/^r-[a-f0-9]{12}-[a-z0-9]+$/.test(renderId)) throw new AuthoringError('INVALID_PAYLOAD', 'bad render_id');
    const dir = join(this.dir(project), 'renders', renderId);
    const record = JSON.parse(await readFile(join(dir, 'render.json'), 'utf8').catch(() => 'null'));
    if (!record) throw new AuthoringError('UNKNOWN_RENDER', `no render ${renderId}`);
    const wav = join(dir, `${project}.wav`);
    if (!(await exists(wav))) return {render_id: renderId, ok: false, problems: ['rendered WAV is missing']};
    const now2 = await this.inspectWav(wav, record.expected_body_quarters, record.tempo_bpm);
    const problems = [...now2.problems];
    if (now2.sha256 !== record.wav.sha256) problems.push('WAV bytes changed since render (hash mismatch)');
    const sourceBytes = await readFile(join(dir, `${project}.flp`)).catch(() => null);
    if (!sourceBytes || sha(sourceBytes) !== record.source_revision) problems.push('rendered source project copy is missing or changed');
    return {render_id: renderId, ok: problems.length === 0, problems, source_revision: record.source_revision, wav: now2,
      provenance: {fl_version: record.host.fl_version, command: record.command, rendered_at: record.rendered_at, operation_id: record.operation_id}};
  }

  // ---------- pack ----------
  async buildPack(args: {project_id: string; render_id: string; pack_id: string; pack_revision: number; asset_id: string;
    title: string; bars: number; phrase_bars: number; key: string | null; genres: string[]; states: string[]; operation_id: string}): Promise<object> {
    const project = checkId(args.project_id, 'project_id'); checkOp(args.operation_id);
    const packId = checkId(args.pack_id, 'pack_id'), assetId = checkId(args.asset_id, 'asset_id');
    const payloadHash = sha(new TextEncoder().encode(canonical(args)));
    const replayed = await this.replay(project, args.operation_id, payloadHash);
    if (replayed !== undefined) return replayed as object;
    const verified = await this.verifyExport(project, args.render_id) as {ok: boolean; problems: string[]; wav: {sha256: string; bytes: number; sample_rate: number; channels: 1 | 2; frames: number}; source_revision: string; provenance: {fl_version: string | null; command: string; rendered_at: string}};
    if (!verified.ok) throw new AuthoringError('EXPORT_INVALID', verified.problems.join('; '));
    const record = JSON.parse(await readFile(join(this.dir(project), 'renders', args.render_id, 'render.json'), 'utf8'));
    const {view} = await this.readProjectAt(join(this.dir(project), 'renders', args.render_id, `${project}.flp`));
    const [num, den] = view.timeSignature ?? [0, 0];
    if (num !== 4 || den !== 4) throw new AuthoringError('PACK_INVALID', 'v0 packs need a 4/4 source project');
    if (!Number.isInteger(args.bars) || args.bars < 1 || args.bars > 64) throw new AuthoringError('INVALID_PAYLOAD', 'bars must be an integer 1-64');
    if (!Number.isInteger(args.phrase_bars) || args.phrase_bars < 1 || args.phrase_bars > 16 || args.bars % args.phrase_bars !== 0) {
      throw new AuthoringError('INVALID_PAYLOAD', 'phrase_bars must be an integer 1-16 that divides bars');
    }
    if (!Number.isInteger(args.pack_revision) || args.pack_revision < 1) throw new AuthoringError('INVALID_PAYLOAD', 'pack_revision must be a positive integer');
    const bodyQuarters = args.bars * 4;
    if (bodyQuarters > record.expected_body_quarters) throw new AuthoringError('PACK_INVALID', `project arrangement has ${record.expected_body_quarters} quarters, fewer than ${args.bars} bars`);
    const finalDir = join(this.workspace, 'packs', packId);
    if (await exists(finalDir)) throw new AuthoringError('PROJECT_EXISTS', `pack ${packId} exists; use a new pack_id`);
    const authorship = await this.authorship(project, view);
    const base = {operation_id: args.operation_id, kind: 'pack', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
      detail: {pack_id: packId, wav_sha256: verified.wav.sha256}};
    await this.record({...base, state: 'started', at: now()});
    // Built in a scratch folder and renamed into place, so a crash never leaves a half-built pack under the real id.
    const packDir = join(this.workspace, 'packs', `.tmp-${packId}-${randomUUID().slice(0, 8)}`);
    try {
    await mkdir(join(packDir, 'audio'), {recursive: true});
    const audioPath = `audio/${assetId.replace(/_/g, '-')}.wav`;
    await copyFile(join(this.dir(project), 'renders', args.render_id, `${project}.wav`), join(packDir, ...audioPath.split('/')));
    const cues = [] as {id: string; kind: 'entry' | 'exit'; position_quarters: number}[];
    for (let q = 0; q <= bodyQuarters; q += args.phrase_bars * 4) {
      if (q < bodyQuarters) cues.push({id: `entry-q${q}`, kind: 'entry', position_quarters: q});
      if (q > 0) cues.push({id: `exit-q${q}`, kind: 'exit', position_quarters: q});
    }
    const manifest = {schema_version: PACK_VERSION, id: packId, revision: args.pack_revision, assets: [{
      id: assetId, revision: 1, title: args.title, source_kind: 'recording',
      file: {path: audioPath, sha256: verified.wav.sha256, bytes: verified.wav.bytes, format: 'pcm16-wav',
        sample_rate: verified.wav.sample_rate, channels: verified.wav.channels, frames: verified.wav.frames},
      rights: {origin: authorship.other.length === 0
          ? 'original composition authored through the EUTONOS Music MCP and rendered by FL Studio'
          : 'mixed: notes authored through the EUTONOS Music MCP plus FL Studio template notes (see PROVENANCE.md), rendered by FL Studio',
        creator: 'EUTONOS Music EMF-S08 authoring session for the repository owner',
        license: 'owner-local; redistribution of rendered FL factory instrument sound not established',
        allowed_uses: ['playback'], evidence: 'PROVENANCE.md'},
      eligibility: 'unreviewed', genres: args.genres, states: args.states, key: args.key, harmony_pitch_classes: null,
      timing: {bpm: view.tempoBpm, meter: [4, 4], bars: args.bars, phrase_bars: args.phrase_bars, first_downbeat_frame: 0},
      cues}], palettes: [], recipes: [], routes: []};
    let parsed: AudioPack;
    try { parsed = validatePackManifest(manifest); } catch (e) { throw new AuthoringError('PACK_INVALID', String((e as Error).message)); }
    const plugins = [...new Set(view.channels.map(c => c.plugin).filter((p): p is string => !!p))];
    const provenance = [
      `# ${args.title} — provenance`, '',
      `- Source project: \`${project}\` revision \`${verified.source_revision}\` (EUTONOS Music workspace; not distributed).`,
      `- Created from FL Studio factory template \`${(JSON.parse(await readFile(join(this.dir(project), 'project.json'), 'utf8'))).created_from}\`.`,
      `- Notes written through the MCP facade (pattern/channel, matched against journaled applies): ${authorship.facade.join(', ') || 'none'}.`,
      `- Arranged notes NOT written through the facade (template or other origin): ${authorship.other.join(', ') || 'none'}.`,
      `- Rendered by FL Studio ${verified.provenance.fl_version ?? 'unknown'} with \`${verified.provenance.command.replace(/".*"/, '"<project>"')}\` at ${verified.provenance.rendered_at}.`,
      `- Instruments: the template's FL Studio channels (${plugins.join(', ') || 'unknown'}). Their sound content is licensed to the FL Studio owner; redistribution of this render is NOT established.`,
      '- Allowed use recorded in the manifest: owner-local playback only. Eligibility: unreviewed (no human listening).',
      '- first_downbeat_frame 0 is the song start of the FL render; harmony is not asserted as constant (null).', '',
    ].join('\n');
    await writeFile(join(packDir, 'PROVENANCE.md'), provenance);
    await writeFile(join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await loadPack(packDir);
    try { await renameRetry(packDir, finalDir); } catch { throw new AuthoringError('PROJECT_EXISTS', `pack ${packId} appeared while building; use a new pack_id`); }
    const result = await this.packResult(packId, parsed);
    await this.record({...base, state: 'completed', at: now(), result});
    return result;
    } catch (e) {
      await rm(packDir, {recursive: true, force: true});
      const error = {code: (e as {code?: string}).code ?? 'PACK_INVALID', message: String((e as Error).message)};
      await this.record({...base, state: 'failed', at: now(), error});
      throw e;
    }
  }

  private async packResult(packId: string, parsed: AudioPack): Promise<object> {
    const packDir = join(this.workspace, 'packs', packId);
    const loaded = await loadPack(packDir);
    const audio = parsed.assets[0]!.file.path;
    const webHash = await webSha256(new Uint8Array(await readFile(join(packDir, ...audio.split('/')))));
    return {status: 'pack_built', pack_id: parsed.id, revision: parsed.revision, schema: parsed.schema_version,
      validation: 'PASS (S01 loadPack: manifest, rights evidence, bytes, SHA-256, PCM metadata)', audio: loaded.audio,
      web_crypto_sha256: webHash, location: `workspace packs/${packId}`};
  }

  /** Which arranged pattern/channel note sets equal a note set some completed apply wrote. */
  private async authorship(project: string, view: ProjectView): Promise<{facade: string[]; other: string[]}> {
    const written = new Map<string, Set<string>>();
    for (const r of await this.journal(project)) {
      if (r.kind !== 'apply' || r.state !== 'completed') continue;
      const changeId = (r.result as {change_id?: string} | undefined)?.change_id;
      const text = changeId ? await readFile(join(this.dir(project), 'prepared', `${changeId}.json`), 'utf8').catch(() => null) : null;
      if (!text) continue;
      for (const t of (JSON.parse(text) as {request: EditRequest}).request.targets) {
        const key = `${t.pattern.index}/${t.channel.index}`;
        const set = written.get(key) ?? new Set<string>();
        set.add(t.notes.map(n => noteSpecToFlp(n, t.channel.index, view.ppq, 'journal')).map(n => `${n.position}:${n.key}:${n.length}:${n.velocity}`).sort().join('|'));
        written.set(key, set);
      }
    }
    const placed = new Set((view.playlist ?? []).map(i => i.pattern).filter((p): p is number => p !== null));
    const facade: string[] = [], other: string[] = [];
    for (const p of view.patterns) {
      if (!placed.has(p.index)) continue;
      for (const c of new Set(p.notes.map(n => n.channel))) {
        const now = p.notes.filter(n => n.channel === c).map(n => `${n.position}:${n.key}:${n.length}:${n.velocity}`).sort().join('|');
        (written.get(`${p.index}/${c}`)?.has(now) ? facade : other).push(`${p.name ?? p.index}/${view.channels.find(x => x.index === c)?.name ?? c}`);
      }
    }
    return {facade, other};
  }

  private async readProjectAt(path: string) {
    const bytes = new Uint8Array(await readFile(path));
    return {view: viewProject(parseFlp(bytes))};
  }

  // ---------- reconcile / recover ----------
  async operationStatus(project: string, operationId: string): Promise<object> {
    checkOp(operationId);
    await this.requireDir(project);
    const peek = await this.latest(project, operationId);
    if (!peek) return {operation_id: operationId, status: 'not_found', effect_state: 'no journal record for this operation id in this project'};
    if (peek.state !== 'started') return {operation_id: operationId, status: peek.state, kind: peek.kind, record: peek};
    // Decide under the same lock the operation itself used, from a fresh read.
    const decide = () => this.critical(project, async () => {
      const last = await this.latest(project, operationId);
      if (!last || last.state !== 'started') return {operation_id: operationId, status: last?.state ?? 'not_found', kind: last?.kind, record: last};
      const outcome = await this.effectOf(project, last);
      if (outcome.effect === 'unknown') {
        return {operation_id: operationId, status: 'unknown', effect_state: outcome.reason, record: last,
          next_action: 'Inspect the project; do not repeat the operation until its effect is understood.'};
      }
      const done = outcome.effect === 'applied';
      const result = {status: done ? 'applied_reconciled' : 'not_applied_reconciled', operation_id: operationId, kind: last.kind,
        ...outcome.facts};
      await this.record({...last, state: done ? 'completed' : 'failed', at: now(), result: done ? result : undefined,
        ...(done ? {} : {error: {code: 'NOT_APPLIED', message: `reconciled: ${outcome.reason}`}})});
      return {...result, effect_state: outcome.reason, reconciled: true};
    });
    const outcome = await (peek.kind === 'render' ? this.hostExclusive(decide) : decide()) as {status: string; kind?: string};
    if (outcome.kind === 'create' && outcome.status === 'not_applied_reconciled') {
      // Outside the project lock (it lives in the folder): move the incomplete project aside so the id is free.
      await rename(this.dir(project), join(this.workspace, 'projects', `.abandoned-${project}-${randomUUID().slice(0, 8)}`));
    }
    return outcome;
  }

  /** What an interrupted operation left behind, judged from durable state only. */
  private async effectOf(project: string, last: JournalRecord): Promise<{effect: 'applied' | 'not_applied' | 'unknown'; reason: string; facts?: object}> {
    const d = last.detail ?? {};
    const current = await readFile(this.flpPath(project)).then(b => sha(b)).catch(() => null);
    switch (last.kind) {
      case 'apply': case 'restore':
        if (current === last.after_revision) return {effect: 'applied', reason: 'project is at after_revision', facts: {before_revision: last.before_revision, after_revision: last.after_revision, current_revision: current}};
        if (current === last.before_revision) return {effect: 'not_applied', reason: 'project still at before_revision', facts: {current_revision: current}};
        return {effect: 'unknown', reason: 'project changed further; compare with fl_list_backups'};
      case 'create': {
        const meta = await readFile(join(this.dir(project), 'project.json'), 'utf8').catch(() => null);
        if (meta && current === last.after_revision) return {effect: 'applied', reason: 'project files complete', facts: {revision: current}};
        return {effect: 'not_applied', reason: 'project files incomplete; the incomplete project will be moved aside so the id is free'};
      }
      case 'save': {
        const bytes = d.checkpoint ? await readFile(join(this.dir(project), ...d.checkpoint.split('/'))).catch(() => null) : null;
        if (bytes && sha(bytes) === last.before_revision) return {effect: 'applied', reason: 'checkpoint present and hash matches', facts: {checkpoint: d.checkpoint, revision: last.before_revision}};
        return {effect: 'not_applied', reason: 'checkpoint missing or incomplete'};
      }
      case 'render': {
        const rec = d.render_id ? JSON.parse(await readFile(join(this.dir(project), 'renders', d.render_id, 'render.json'), 'utf8').catch(() => 'null')) : null;
        if (rec && rec.operation_id === last.operation_id && rec.wav?.ok) {
          const check = await this.verifyExport(project, d.render_id!) as {ok: boolean};
          if (check.ok) return {effect: 'applied', reason: 'verified render present', facts: {render_id: d.render_id}};
        }
        return {effect: 'not_applied', reason: 'no verified render recorded for this operation'};
      }
      case 'pack': {
        const dir = join(this.workspace, 'packs', d.pack_id ?? '');
        try {
          const loaded = await loadPack(dir);
          const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as AudioPack;
          if (d.pack_id && manifest.assets[0]?.file.sha256 === d.wav_sha256) return {effect: 'applied', reason: 'pack present and valid', facts: {pack_id: d.pack_id, audio: loaded.audio}};
        } catch { /* absent or invalid */ }
        return {effect: 'not_applied', reason: 'no valid pack with this render under the pack id'};
      }
      default:
        return {effect: 'unknown', reason: `no reconcile rule for ${last.kind}`};
    }
  }

  async restore(project: string, backupRevision: string, expectedCurrent: string, operationId: string): Promise<object> {
    checkOp(operationId);
    await this.requireProject(project);
    if (typeof backupRevision !== 'string' || !/^[a-f0-9]{64}$/.test(backupRevision)) throw new AuthoringError('INVALID_PAYLOAD', 'backup_revision must be a sha256');
    const payloadHash = sha(new TextEncoder().encode(`restore:${backupRevision}:${expectedCurrent}`));
    const replayed = await this.replay(project, operationId, payloadHash);
    if (replayed !== undefined) return replayed as object;
    await this.requireLease(project);
    const gui = await this.guiHolds(project);
    if (gui) throw new AuthoringError('HOST_BUSY', `FL Studio has this project open (${gui})`);
    return this.critical(project, async () => {
      await this.requireLease(project);
      const {bytes, revision} = await this.readProject(project);
      if (revision !== expectedCurrent) throw new AuthoringError('TARGET_CHANGED', `project is at ${revision}, not ${expectedCurrent}`);
      const backup = new Uint8Array(await readFile(join(this.dir(project), 'backups', `${backupRevision}.flp`)).catch(() => {
        throw new AuthoringError('UNKNOWN_BACKUP', `no backup ${backupRevision}`);
      }));
      if (sha(backup) !== backupRevision) throw new AuthoringError('UNKNOWN_BACKUP', 'backup bytes do not match their revision');
      parseFlp(backup);
      await this.record({operation_id: operationId, kind: 'restore', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
        state: 'started', at: now(), before_revision: revision, after_revision: backupRevision});
      const keep = join(this.dir(project), 'backups', `${revision}.flp`);
      if (!(await exists(keep))) await atomicWrite(keep, bytes);
      await atomicWrite(this.flpPath(project), backup);
      const result = {status: 'restored', operation_id: operationId, project_id: project, before_revision: revision, after_revision: backupRevision,
        preserved_previous_as_backup: revision};
      await this.record({operation_id: operationId, kind: 'restore', project_id: project, payload_hash: payloadHash, client_id: this.clientId,
        state: 'completed', at: now(), before_revision: revision, after_revision: backupRevision, result});
      return result;
    });
  }

  async listBackups(project: string): Promise<object> {
    await this.requireProject(project);
    const files = await readdir(join(this.dir(project), 'backups')).catch(() => [] as string[]);
    return {project_id: project, backups: files.filter(f => /^[a-f0-9]{64}\.flp$/.test(f)).map(f => f.slice(0, 64))};
  }
}
