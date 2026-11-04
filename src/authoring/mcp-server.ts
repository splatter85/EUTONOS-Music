/**
 * EUTONOS Music MCP facade: dependency-free MCP over stdio (newline-delimited
 * JSON-RPC 2.0). Claude Code and Codex both launch this same server; every
 * process shares the one broker workspace, so they coordinate through its
 * writer lease, lock and operation journal. Logs go to stderr only.
 */
import {AuthoringError} from './errors.js';
import {schemaErrors} from './schema.js';
import {BRIDGE_VERSION, Broker, type EditRequest} from './broker.js';
import type {HostAdapter} from './host.js';

export const SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'] as const;
const LATEST = '2025-11-25';

type Json = Record<string, unknown>;
interface Tool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Json;
  readonly annotations: {readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean};
  readonly run: (b: Broker, a: Json) => Promise<object>;
}

const str = (description: string, extra: Json = {}) => ({type: 'string', maxLength: 128, description, ...extra});
const ID_PATTERN = '^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$';
const projectId = str('Workspace project id (lowercase, e.g. "emf-s08-demo").', {pattern: ID_PATTERN, maxLength: 64});
const opId = str('Caller-chosen unique operation id. Reuse it ONLY to retry the same request; the broker replays the recorded outcome.', {pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$'});
const obj = (properties: Json, required: string[]) => ({type: 'object', properties, required, additionalProperties: false});
const RO = {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false};
const WRITE = {readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false};

const noteSchema = obj({
  midi: {type: 'integer', minimum: 0, maximum: 127, description: 'MIDI key (60 = C5 in FL naming, middle C).'},
  start_quarters: {type: 'number', minimum: 0, maximum: 4096, description: 'Start within the pattern, in quarter notes (must land on a whole tick).'},
  duration_quarters: {type: 'number', exclusiveMinimum: 0, maximum: 4096, description: 'Length in quarter notes.'},
  velocity: {type: 'number', minimum: 0, maximum: 1, description: 'Velocity 0..1 (FL stores 0..128).'},
}, ['midi', 'start_quarters', 'duration_quarters', 'velocity']);

const s = (v: unknown) => v as string;
export const TOOLS: readonly Tool[] = [
  {name: 'fl_capabilities', title: 'Discover FL authoring capabilities', annotations: RO,
    description: 'Report the bridge contract, FL host availability/version, writer model, and which operations are supported, partial or unsupported.',
    inputSchema: obj({}, []), run: b => b.capabilities()},
  {name: 'fl_list_projects', title: 'List workspace projects', annotations: RO,
    description: 'List EUTONOS-managed FL projects in the private workspace with their current revision.',
    inputSchema: obj({}, []), run: b => b.listProjects()},
  {name: 'fl_create_project', title: 'Create a disposable FL project', annotations: {...WRITE, idempotentHint: true},
    description: 'Copy an allowlisted FL Studio factory template into the private workspace as a new, disposable project. Never touches user projects.',
    inputSchema: obj({project_id: projectId, template: str('Template id from fl_capabilities.templates.'), operation_id: opId},
      ['project_id', 'template', 'operation_id']),
    run: (b, a) => b.createProject(s(a.project_id), s(a.template), s(a.operation_id))},
  {name: 'fl_inspect', title: 'Inspect project', annotations: RO,
    description: 'Read the saved project: revision (SHA-256), FL version, tempo, meter, channels, patterns (optionally every note), playlist clips, writer lease and whether an FL window holds it.',
    inputSchema: obj({project_id: projectId, include_notes: {type: 'boolean', default: false}}, ['project_id']),
    run: (b, a) => b.inspect(s(a.project_id), a.include_notes === true)},
  {name: 'fl_acquire_writer', title: 'Acquire writer lease', annotations: WRITE,
    description: 'Take the single writer lease for a project. Fails with LEASE_CONFLICT while another client (e.g. the other agent app) holds an unexpired lease.',
    inputSchema: obj({project_id: projectId, ttl_seconds: {type: 'integer', minimum: 30, maximum: 3600, default: 900}}, ['project_id']),
    run: (b, a) => b.acquireWriter(s(a.project_id), typeof a.ttl_seconds === 'number' ? a.ttl_seconds : 900)},
  {name: 'fl_release_writer', title: 'Release writer lease', annotations: WRITE,
    description: 'Release the writer lease this client holds.',
    inputSchema: obj({project_id: projectId}, ['project_id']), run: (b, a) => b.releaseWriter(s(a.project_id))},
  {name: 'fl_prepare_edit', title: 'Prepare a musical edit', annotations: {...RO, readOnlyHint: false},
    description: 'Validate and dry-run an edit against an exact project revision without changing the project. Each target names a pattern and channel by index AND expected name and gives the complete note list that replaces that channel\'s notes in that pattern. Optional tempo_bpm and clip_bars (resizes the playlist clips of the targeted patterns). Returns a change_id and the predicted after_revision.',
    inputSchema: obj({
      project_id: projectId,
      expected_revision: str('Revision from fl_inspect; stale revisions are refused (TARGET_CHANGED).'),
      tempo_bpm: {type: 'number', minimum: 10, maximum: 522},
      clip_bars: {type: 'integer', minimum: 1, maximum: 64},
      targets: {type: 'array', minItems: 1, maxItems: 16, items: obj({
        pattern: obj({index: {type: 'integer', minimum: 1, maximum: 999}, expected_name: {type: 'string', maxLength: 128}}, ['index', 'expected_name']),
        channel: obj({index: {type: 'integer', minimum: 0, maximum: 999}, expected_name: {type: 'string', maxLength: 128}}, ['index', 'expected_name']),
        notes: {type: 'array', maxItems: 2048, items: noteSchema},
      }, ['pattern', 'channel', 'notes'])},
    }, ['project_id', 'expected_revision', 'targets']),
    run: (b, a) => b.prepareEdit(a as unknown as EditRequest)},
  {name: 'fl_apply_edit', title: 'Apply a prepared edit', annotations: WRITE,
    description: 'Apply a prepared change under the writer lease: journal, backup of the before-revision, atomic write, file readback. Retrying with the same operation_id replays the outcome instead of re-applying.',
    inputSchema: obj({project_id: projectId, change_id: str('change_id from fl_prepare_edit'), operation_id: opId}, ['project_id', 'change_id', 'operation_id']),
    run: (b, a) => b.applyEdit(s(a.project_id), s(a.change_id), s(a.operation_id))},
  {name: 'fl_verify', title: 'FL-side readback', annotations: RO,
    description: 'Have FL Studio itself load the current saved project (CLI MIDI export) and compare every channel\'s notes and the tempo with what the project file says. Requires FL Studio to be closed.',
    inputSchema: obj({project_id: projectId}, ['project_id']), run: (b, a) => b.verify(s(a.project_id))},
  {name: 'fl_save', title: 'Save a named checkpoint', annotations: WRITE,
    description: 'Write a named, hash-verified checkpoint copy of the current editable project.',
    inputSchema: obj({project_id: projectId, label: str('lowercase label, e.g. "acceptance"'), operation_id: opId}, ['project_id', 'label', 'operation_id']),
    run: (b, a) => b.save(s(a.project_id), s(a.label), s(a.operation_id))},
  {name: 'fl_render', title: 'Render WAV with FL Studio', annotations: {...WRITE, openWorldHint: false},
    description: 'Render the current revision to WAV with FL Studio\'s official command-line renderer and check the file (PCM16, length covers the arrangement, not silent). Requires FL Studio to be closed (HOST_BUSY otherwise).',
    inputSchema: obj({project_id: projectId, operation_id: opId}, ['project_id', 'operation_id']),
    run: (b, a) => b.render(s(a.project_id), s(a.operation_id))},
  {name: 'fl_verify_export', title: 'Verify a render', annotations: RO,
    description: 'Re-check a render: WAV present, parseable PCM16, unchanged hash, long enough for the arrangement, source copy intact.',
    inputSchema: obj({project_id: projectId, render_id: str('render_id from fl_render')}, ['project_id', 'render_id']),
    run: (b, a) => b.verifyExport(s(a.project_id), s(a.render_id))},
  {name: 'fl_build_pack', title: 'Build em.audio-pack.v0', annotations: WRITE,
    description: 'Build and validate an em.audio-pack.v0 pack from a verified render. Rights stay owner-local playback; eligibility unreviewed.',
    inputSchema: obj({project_id: projectId, render_id: str('render_id'), pack_id: str('lowercase pack id', {pattern: ID_PATTERN, maxLength: 64}), pack_revision: {type: 'integer', minimum: 1, maximum: 1000000},
      asset_id: str('lowercase asset id', {pattern: ID_PATTERN, maxLength: 64}), title: {type: 'string', minLength: 1, maxLength: 120}, bars: {type: 'integer', minimum: 1, maximum: 64},
      phrase_bars: {type: 'integer', minimum: 1, maximum: 16, description: 'Must divide bars.'}, key: {type: ['string', 'null'], maxLength: 16},
      genres: {type: 'array', maxItems: 16, items: {type: 'string', maxLength: 40}}, states: {type: 'array', maxItems: 5, items: {enum: ['browse', 'explore', 'drive', 'surge', 'afterglow']}},
      operation_id: opId},
    ['project_id', 'render_id', 'pack_id', 'pack_revision', 'asset_id', 'title', 'bars', 'phrase_bars', 'key', 'genres', 'states', 'operation_id']),
    run: (b, a) => b.buildPack(a as unknown as Parameters<Broker['buildPack']>[0])},
  {name: 'fl_operation_status', title: 'Reconcile an operation', annotations: WRITE,
    description: 'Look up an operation by its caller-known id. For an operation that started without a recorded outcome, determines from the project, checkpoints, renders or packs on disk whether it took effect and records that outcome.',
    inputSchema: obj({project_id: projectId, operation_id: opId}, ['project_id', 'operation_id']),
    run: (b, a) => b.operationStatus(s(a.project_id), s(a.operation_id))},
  {name: 'fl_list_backups', title: 'List backups', annotations: RO,
    description: 'List pre-mutation backup revisions available to fl_restore.',
    inputSchema: obj({project_id: projectId}, ['project_id']), run: (b, a) => b.listBackups(s(a.project_id))},
  {name: 'fl_restore', title: 'Restore a backup', annotations: {...WRITE, destructiveHint: true},
    description: 'Under the writer lease, replace the current project with a backup revision. The replaced revision is kept as a backup first.',
    inputSchema: obj({project_id: projectId, backup_revision: str('sha256 from fl_list_backups'), expected_revision: str('current revision'), operation_id: opId},
      ['project_id', 'backup_revision', 'expected_revision', 'operation_id']),
    run: (b, a) => b.restore(s(a.project_id), s(a.backup_revision), s(a.expected_revision), s(a.operation_id))},
];

export interface ServerOptions {
  readonly workspace: string;
  readonly host: HostAdapter;
  readonly write: (line: string) => void;
  readonly log?: (line: string) => void;
}

/** Transport-agnostic MCP session: feed it lines, it writes response lines. */
export class McpSession {
  private broker: Broker | null = null;
  private queue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private readonly options: ServerOptions) {}

  /** Agents never see local filesystem paths: the workspace root is replaced with a placeholder. */
  private redact(value: unknown): unknown {
    const ws = this.options.workspace;
    const forms = [ws, ws.split(String.fromCharCode(92)).join('/')].filter((x, i, a) => x && a.indexOf(x) === i);
    const walk = (v: unknown): unknown => typeof v === 'string' ? forms.reduce((s, f) => s.split(f).join('<workspace>'), v)
      : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
    return walk(value);
  }

  private reply(id: unknown, result: unknown) { this.options.write(JSON.stringify({jsonrpc: '2.0', id, result})); }
  private error(id: unknown, code: number, message: string) { this.options.write(JSON.stringify({jsonrpc: '2.0', id, error: {code, message}})); }

  /** Resolves when this line (and any tool call it queued) is handled. */
  handleLine(line: string): Promise<void> {
    if (!line.trim()) return Promise.resolve();
    let msg: Json;
    try { msg = JSON.parse(line) as Json; } catch { this.error(null, -32700, 'parse error'); return Promise.resolve(); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      if (msg && typeof msg === 'object' && 'id' in msg && !('method' in msg)) return Promise.resolve(); // a response to us; ignore
      this.error((msg as Json)?.id ?? null, -32600, 'invalid request');
      return Promise.resolve();
    }
    const isNotification = !('id' in msg);
    if (isNotification) return Promise.resolve(); // never answer notifications
    const id = msg.id, params = (msg.params ?? {}) as Json;
    switch (msg.method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : LATEST;
        const clientName = typeof (params.clientInfo as Json | undefined)?.name === 'string' ? (params.clientInfo as Json).name as string : 'client';
        this.broker = new Broker(this.options.workspace, this.options.host, clientName);
        this.initialized = true;
        this.options.log?.(`initialize from ${clientName}; client_id ${this.broker.clientId}`);
        this.reply(id, {
          protocolVersion: (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested) ? requested : LATEST,
          capabilities: {tools: {listChanged: false}},
          serverInfo: {name: 'eutonos-music', title: 'EUTONOS Music (FL Studio authoring)', version: BRIDGE_VERSION},
          instructions: 'One shared broker for FL Studio authoring. Flow: fl_capabilities -> fl_inspect -> fl_prepare_edit -> fl_acquire_writer -> fl_apply_edit -> fl_verify -> fl_save -> fl_render -> fl_verify_export -> fl_build_pack. Use a fresh operation_id per mutation; reuse it only to retry. On OUTCOME_UNKNOWN call fl_operation_status before anything else. FL Studio must be closed for verify/render.',
        });
        return Promise.resolve();
      }
      case 'ping': this.reply(id, {}); return Promise.resolve();
      case 'tools/list':
        this.reply(id, {tools: TOOLS.map(({run: _run, ...t}) => t)});
        return Promise.resolve();
      case 'resources/list': this.reply(id, {resources: []}); return Promise.resolve();
      case 'resources/templates/list': this.reply(id, {resourceTemplates: []}); return Promise.resolve();
      case 'prompts/list': this.reply(id, {prompts: []}); return Promise.resolve();
      case 'tools/call': {
        const tool = TOOLS.find(t => t.name === params.name);
        if (!tool) { this.error(id, -32602, `unknown tool ${String(params.name)}`); return Promise.resolve(); }
        if (!this.initialized || !this.broker) { this.error(id, -32002, 'server not initialized'); return Promise.resolve(); }
        const args = (params.arguments ?? {}) as Json;
        if (typeof args !== 'object' || Array.isArray(args)) { this.error(id, -32602, 'arguments must be an object'); return Promise.resolve(); }
        const invalid = schemaErrors(tool.inputSchema, args);
        if (invalid.length) {
          const err = {code: 'INVALID_PAYLOAD', message: `INVALID_PAYLOAD: ${invalid.join('; ')}`, effects_possible: false};
          this.reply(id, {content: [{type: 'text', text: JSON.stringify({error: err}, null, 2)}], structuredContent: {error: err}, isError: true});
          return Promise.resolve();
        }
        const broker = this.broker;
        // One tool call at a time per client process; cross-process safety comes from the broker's lease/lock.
        this.queue = this.queue.then(async () => {
          const started = Date.now();
          try {
            const result = this.redact(await tool.run(broker, args)) as object;
            this.options.log?.(`${tool.name} ok ${Date.now() - started}ms`);
            this.reply(id, {content: [{type: 'text', text: JSON.stringify(result, null, 2)}], structuredContent: result, isError: false});
          } catch (e) {
            const err = this.redact(e instanceof AuthoringError
              ? {code: e.code, message: e.message, effects_possible: e.effectsPossible}
              : {code: 'INTERNAL', message: String((e as Error)?.message ?? e), effects_possible: true}) as {code: string; message: string; effects_possible: boolean};
            this.options.log?.(`${tool.name} error ${err.code}`);
            this.reply(id, {content: [{type: 'text', text: JSON.stringify({error: err}, null, 2)}], structuredContent: {error: err}, isError: true});
          }
        });
        return this.queue;
      }
      default:
        this.error(id, -32601, `method not found: ${msg.method}`);
        return Promise.resolve();
    }
  }
}
