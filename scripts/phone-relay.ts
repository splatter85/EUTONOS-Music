/**
 * S17 phone relay. Loopback-only Node server (built-ins only) that turns the DJ page's
 * MediaRecorder WebM/Opus chunks into one endless MP3 stream for phone listeners and relays
 * allowlisted phone commands back to the DJ page. The PC browser stays the only audio engine.
 *
 * Security split:
 * - DJ endpoints (/api/dj/*) need a loopback Host, an allowed DJ Origin and no proxy headers,
 *   so phone/tailnet requests cannot inject audio or impersonate the DJ.
 * - Phone endpoints accept a loopback or *.ts.net Host (plus --allow-host names), which is how
 *   `tailscale serve` reaches this loopback listener. Everything else is refused.
 * This is not a production host and is never bound to the LAN.
 */
import {spawn, execFile} from 'node:child_process';
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {readFile, realpath, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import type {Readable, Writable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {parseControlCommand, sanitizeDjStatus, type DjStatus, type RelayStatus,
  type RelayedCommand} from '../web/phone-protocol.js';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

export const DEFAULT_RELAY_PORT = 4180;
export const DEFAULT_DJ_ORIGINS = ['http://127.0.0.1:4173', 'http://localhost:4173'] as const;
export const FFMPEG_ARGS = ['-hide_banner', '-loglevel', 'error', '-fflags', 'nobuffer', '-probesize', '32', '-analyzeduration', '0',
  '-f', 'webm', '-i', 'pipe:0', '-vn',
  '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '256k', '-flush_packets', '1', '-f', 'mp3', 'pipe:1'] as const;
export const LIMITS = {
  ingestBytes: 1024 * 1024,
  statusBytes: 16 * 1024,
  controlBytes: 1024,
  /** About two seconds of 256 kbit/s MP3, sent first to a new listener for fast start. */
  recentBytes: 64 * 1024,
  /** A listener whose unsent backlog exceeds this is dropped instead of buffered. */
  listenerBacklogBytes: 512 * 1024,
  encoderBacklogBytes: 4 * 1024 * 1024,
  maxListeners: 8,
  heartbeatMs: 15_000,
} as const;
/** A phone request this recent (or any open live listener) means a phone is looking. */
export const PHONE_SEEN_WINDOW_MS = 8_000;
export const DELAY_NOTE = 'The phone hears the PC about 2-5 seconds late. Controls act on the PC immediately.';

/** The part of a child process the relay uses; tests inject a fake encoder. */
export interface EncoderProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr?: Readable | null;
  kill(): unknown;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}
export type SpawnEncoder = () => EncoderProcess;

export function ffmpegEncoder(ffmpegPath = 'ffmpeg'): SpawnEncoder {
  return () => spawn(ffmpegPath, [...FFMPEG_ARGS], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
}

export interface PhoneRelayOptions {
  readonly spawnEncoder?: SpawnEncoder;
  readonly djOrigins?: readonly string[];
  readonly allowHosts?: readonly string[];
  /** Root holding web/phone.html, web/phone.css and dist/web/phone.js. */
  readonly root?: string;
  readonly log?: (message: string) => void;
  /** Per-run DJ secret; generated (16 random bytes, hex) when omitted. */
  readonly token?: string;
  /** Clock in ms; injectable so tests can age phone activity without waiting. */
  readonly now?: () => number;
}

export interface PhoneRelay {
  readonly server: Server;
  /** Required as X-Relay-Token on every /api/dj/* request except the CORS preflight. */
  readonly token: string;
  status(): RelayStatus;
  close(): Promise<void>;
}

const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;
const TAILNET = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net\.?(?::\d{1,5})?$/i;
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded',
  'tailscale-user-login', 'tailscale-user-name', 'tailscale-headers-info'] as const;

export function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK.test(host);
}
function hostName(host: string): string {
  const withoutPort = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.replace(/:\d{1,5}$/, '');
  return withoutPort.replace(/\.$/, '').toLowerCase();
}
export function isPhoneHost(host: string | undefined, allowHosts: readonly string[] = []): boolean {
  if (host === undefined || host.length > 255 || /[\s/\\@]/.test(host)) return false;
  if (LOOPBACK.test(host) || TAILNET.test(host)) return true;
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return false;
  const name = hostName(host);
  return allowHosts.some(allowed => allowed.toLowerCase() === name);
}
export function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.origin !== origin.replace(/\/$/, '')) return null;
    return url.origin;
  } catch { return null; }
}

/** The fixed phone-page allowlist; nothing else on disk is reachable. */
const PHONE_FILES: Readonly<Record<string, {file: string; type: string}>> = {
  '/': {file: 'web/phone.html', type: 'text/html; charset=utf-8'},
  '/phone.html': {file: 'web/phone.html', type: 'text/html; charset=utf-8'},
  '/phone.css': {file: 'web/phone.css', type: 'text/css; charset=utf-8'},
  '/phone.js': {file: 'dist/web/phone.js', type: 'text/javascript; charset=utf-8'},
  '/phone-watchdog.js': {file: 'dist/web/phone-watchdog.js', type: 'text/javascript; charset=utf-8'},
  '/phone-ui.js': {file: 'dist/web/phone-ui.js', type: 'text/javascript; charset=utf-8'},
};

/** Raw-target path check in the same discipline as scripts/serve.ts; returns the decoded path. */
export function safeRequestPath(requestTarget: string): string | undefined {
  const rawPath = requestTarget.split('?')[0];
  if (!rawPath || !rawPath.startsWith('/') || rawPath.startsWith('//')) return undefined;
  if (/%(?:2f|5c)/i.test(rawPath)) return undefined;
  let path: string;
  try { path = decodeURIComponent(rawPath); } catch { return undefined; }
  if (path.includes('\\') || /[\x00-\x1f\x7f#%]/.test(path)) return undefined;
  if (path.split('/').some(segment => segment === '.' || segment === '..')) return undefined;
  return path;
}

class BodyTooLarge extends Error {}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { reject(new BodyTooLarge()); request.resume(); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    request.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.byteLength;
      if (size > limit) { done = true; reject(new BodyTooLarge()); request.resume(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => { if (!done) { done = true; resolveBody(Buffer.concat(chunks)); } });
    request.on('error', error => { if (!done) { done = true; reject(error); } });
  });
}

interface Session {
  readonly id: string;
  nextSeq: number;
  readonly encoder: EncoderProcess;
  ended: boolean;
}

/** Index of the first plausible MPEG audio frame header, so new listeners start on a frame. */
export function firstFrameOffset(buffer: Buffer): number {
  for (let index = 0; index + 1 < buffer.length; index++) {
    if (buffer[index] === 0xff && ((buffer[index + 1] ?? 0) & 0xe0) === 0xe0) return index;
  }
  return buffer.length;
}

export function createPhoneRelay(options: PhoneRelayOptions = {}): PhoneRelay {
  const spawnEncoder = options.spawnEncoder ?? ffmpegEncoder();
  const djOrigins = new Set((options.djOrigins ?? DEFAULT_DJ_ORIGINS).map(origin => {
    const normalized = normalizeOrigin(origin);
    if (!normalized) throw new Error(`Invalid DJ origin: ${origin}`);
    return normalized;
  }));
  const allowHosts = options.allowHosts ?? [];
  const root = resolve(options.root ?? repositoryRoot);
  const log = options.log ?? (() => undefined);
  const now = options.now ?? Date.now;
  /** Time of the last phone-side request (status, live stream, control); DJ requests never set it. */
  let phoneSeenAt: number | null = null;

  let session: Session | null = null;
  const listeners = new Set<ServerResponse>();
  let recent: Buffer[] = [];
  let recentBytes = 0;
  let djEvents: ServerResponse | null = null;
  let djStatus: {status: DjStatus; at: number} | null = null;
  let commandId = 0;
  let chunksIn = 0;
  let bytesOut = 0;
  let sessions = 0;
  let encoderState: 'idle' | 'running' | 'error' = 'idle';
  let lastError: string | null = null;
  let closing = false;
  const token = options.token ?? randomBytes(16).toString('hex');
  if (!/^[0-9a-f]{32,128}$/.test(token)) throw new Error('The relay token must be 32-128 lowercase hex characters.');
  const tokenDigest = createHash('sha256').update(token).digest();
  /** Constant-time comparison of equal-length digests. */
  function tokenMatches(request: IncomingMessage): boolean {
    const supplied = request.headers['x-relay-token'];
    if (typeof supplied !== 'string') return false;
    return timingSafeEqual(createHash('sha256').update(supplied).digest(), tokenDigest);
  }

  function fail(message: string): void { lastError = message; log(`Relay: ${message}`); }

  function broadcast(chunk: Buffer): void {
    recent.push(chunk);
    recentBytes += chunk.byteLength;
    while (recentBytes > LIMITS.recentBytes && recent.length > 1) recentBytes -= recent.shift()!.byteLength;
    for (const listener of listeners) {
      if (listener.writableLength > LIMITS.listenerBacklogBytes) {
        // Slow listeners are dropped, never buffered without bound; they can reconnect.
        listeners.delete(listener);
        listener.destroy();
        log('Relay: dropped a slow listener.');
        continue;
      }
      listener.write(chunk);
      bytesOut += chunk.byteLength;
    }
  }

  function endSession(reason: string): void {
    const current = session;
    if (!current) return;
    session = null;
    current.ended = true;
    encoderState = encoderState === 'error' ? 'error' : 'idle';
    log(`Relay: ingest session ended (${reason}).`);
    try { current.encoder.stdin.end(); } catch { /* already closed */ }
    try { current.encoder.kill(); } catch { /* already exited */ }
  }

  function startSession(id: string): Session {
    endSession('replaced by a new session');
    // A new session has a new WebM header; old MP3 bytes are not a valid fast start for it.
    recent = []; recentBytes = 0;
    const encoder = spawnEncoder();
    const created: Session = {id, nextSeq: 0, encoder, ended: false};
    session = created;
    sessions++;
    encoderState = 'running';
    const stale = (): boolean => session !== created;
    encoder.stdout.on('data', (chunk: Buffer) => { if (!stale()) broadcast(chunk); });
    encoder.stdin.on('error', error => { if (!stale()) { encoderState = 'error'; fail(`encoder input failed: ${error.message}`); endSession('encoder input error'); } });
    encoder.stderr?.on('data', (chunk: Buffer) => {
      if (!stale()) fail(`encoder: ${chunk.toString('utf8').trim().slice(0, 300)}`);
    });
    encoder.on('error', error => {
      if (stale()) return;
      encoderState = 'error';
      fail(`encoder could not start or failed: ${error.message}`);
      endSession('encoder error');
    });
    encoder.on('exit', (code, signal) => {
      if (stale() || created.ended) return;
      encoderState = 'error';
      fail(`encoder exited unexpectedly (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`);
      endSession('encoder exited');
    });
    log(`Relay: ingest session ${id} started.`);
    return created;
  }

  function json(response: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload)});
    response.end(payload);
  }
  function plain(response: ServerResponse, status: number, message: string, head = false): void {
    response.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8'});
    response.end(head ? undefined : `${message}\n`);
  }

  /** DJ guard: loopback Host, an allowed Origin and no reverse-proxy headers. */
  function djOrigin(request: IncomingMessage): string | null {
    if (!isLoopbackHost(request.headers.host)) return null;
    if (PROXY_HEADERS.some(header => request.headers[header] !== undefined)) return null;
    const origin = request.headers.origin;
    return typeof origin === 'string' && djOrigins.has(origin) ? origin : null;
  }
  function corsHeaders(response: ServerResponse, origin: string): void {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }

  function status(): RelayStatus {
    return {
      dj: {connected: djEvents !== null, ageMs: djStatus ? now() - djStatus.at : null, status: djStatus?.status ?? null},
      stream: {ingesting: session !== null, listeners: listeners.size, encoder: encoderState, chunksIn, bytesOut,
        sessions, lastError},
      delayNote: DELAY_NOTE,
    };
  }

  async function handleDj(request: IncomingMessage, response: ServerResponse, path: string, url: URL): Promise<void> {
    const origin = djOrigin(request);
    if (!origin) { plain(response, 403, 'DJ endpoints accept only the local DJ page'); return; }
    corsHeaders(response, origin);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Relay-Token',
        'Access-Control-Max-Age': '600',
        ...(request.headers['access-control-request-private-network'] === 'true' ? {'Access-Control-Allow-Private-Network': 'true'} : {}),
      });
      response.end();
      return;
    }
    if (!tokenMatches(request)) { json(response, 401, {error: 'relay-token-required'}); return; }
    if (path === '/api/dj/wanted') {
      if (request.method !== 'GET') { response.setHeader('Allow', 'GET, OPTIONS'); plain(response, 405, 'Method not allowed'); return; }
      const phoneSeenMs = phoneSeenAt === null ? null : Math.max(0, now() - phoneSeenAt);
      json(response, 200, {wanted: listeners.size > 0 || (phoneSeenMs !== null && phoneSeenMs <= PHONE_SEEN_WINDOW_MS),
        phoneSeenMs, listeners: listeners.size});
      return;
    }
    if (path === '/api/dj/events') {
      if (request.method !== 'GET') { response.setHeader('Allow', 'GET, OPTIONS'); plain(response, 405, 'Method not allowed'); return; }
      // One DJ page owns remote control; a second one is refused while the first is open.
      if (djEvents) { json(response, 409, {error: 'another-dj-connected'}); return; }
      response.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive'});
      response.write('retry: 2000\n\n: connected\n\n');
      djEvents = response;
      const heartbeat = setInterval(() => { response.write(': ping\n\n'); }, LIMITS.heartbeatMs);
      heartbeat.unref();
      response.on('close', () => {
        clearInterval(heartbeat);
        if (djEvents === response) { djEvents = null; log('Relay: DJ page disconnected from control events.'); }
      });
      log('Relay: DJ page connected for control events.');
      return;
    }
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST, OPTIONS'); plain(response, 405, 'Method not allowed'); return; }
    if (path === '/api/dj/status') {
      const body = await readBody(request, LIMITS.statusBytes);
      let parsed: unknown;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { json(response, 400, {error: 'invalid-json'}); return; }
      const clean = sanitizeDjStatus(parsed);
      if (!clean) { json(response, 400, {error: 'invalid-status'}); return; }
      djStatus = {status: clean, at: now()};
      json(response, 200, {ok: true});
      return;
    }
    // /api/dj/ingest
    const id = url.searchParams.get('session') ?? '';
    const seqText = url.searchParams.get('seq') ?? '';
    const final = url.searchParams.get('final') === '1';
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || (!final && !/^\d{1,9}$/.test(seqText))) {
      json(response, 400, {error: 'invalid-session-or-seq'}); return;
    }
    const body = await readBody(request, LIMITS.ingestBytes);
    if (final) {
      if (session?.id === id) endSession('the DJ page stopped streaming');
      json(response, 200, {ok: true, ended: true});
      return;
    }
    const seq = Number(seqText);
    let current = session;
    if (!current || current.id !== id) {
      // A WebM stream is only decodable from its header chunk, which is sequence 0.
      if (seq !== 0) { json(response, 409, {error: 'unknown-session'}); return; }
      try { current = startSession(id); } catch (error) {
        encoderState = 'error';
        fail(`encoder could not start: ${error instanceof Error ? error.message : String(error)}`);
        session = null;
        json(response, 503, {error: 'encoder-unavailable'});
        return;
      }
    } else if (seq !== current.nextSeq) {
      fail(`ingest gap: expected chunk ${current.nextSeq}, received ${seq}.`);
      endSession('sequence gap');
      json(response, 409, {error: 'sequence-gap', expected: current.nextSeq});
      return;
    }
    current.nextSeq = seq + 1;
    chunksIn++;
    if (body.byteLength) current.encoder.stdin.write(body);
    if (current.encoder.stdin.writableLength > LIMITS.encoderBacklogBytes) {
      fail('encoder is not keeping up; restarting the session.');
      endSession('encoder backlog');
      json(response, 503, {error: 'encoder-backlog'});
      return;
    }
    json(response, 200, {ok: true, seq});
  }

  function sameOriginOrAbsent(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    const site = request.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
    if (origin === undefined) return true;
    const host = request.headers.host ?? '';
    return origin === `https://${host}` || origin === `http://${host}`;
  }

  async function handlePhone(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    const head = request.method === 'HEAD';
    if ((path === '/api/control' || path === '/api/status' || path === '/live.mp3')
      && request.headers['sec-fetch-site'] !== 'cross-site' && sameOriginOrAbsent(request)) phoneSeenAt = now();
    if (path === '/api/control') {
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); plain(response, 405, 'Method not allowed'); return; }
      // JSON content type forces a CORS preflight for any foreign page; none is ever granted here.
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '') || !sameOriginOrAbsent(request)) {
        json(response, 403, {error: 'same-origin-json-only'}); return;
      }
      const body = await readBody(request, LIMITS.controlBytes);
      let parsed: unknown;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { json(response, 400, {error: 'invalid-json'}); return; }
      const command = parseControlCommand(parsed);
      if (!command) { json(response, 400, {error: 'unknown-command'}); return; }
      if (!djEvents) { json(response, 503, {error: 'dj-not-connected'}); return; }
      const relayed: RelayedCommand = {...command, id: ++commandId};
      djEvents.write(`event: command\ndata: ${JSON.stringify(relayed)}\n\n`);
      json(response, 202, {ok: true, id: relayed.id});
      return;
    }
    if (request.method !== 'GET' && !head) { response.setHeader('Allow', 'GET, HEAD'); plain(response, 405, 'Method not allowed'); return; }
    if ((path === '/api/status' || path === '/live.mp3') && request.headers['sec-fetch-site'] === 'cross-site') {
      plain(response, 403, 'Cross-site requests are refused', head); return;
    }
    if (path === '/api/status') { json(response, 200, status()); return; }
    if (path === '/live.mp3') {
      if (listeners.size >= LIMITS.maxListeners) { plain(response, 503, 'Too many listeners', head); return; }
      // An endless live stream, Icecast style: any Range (e.g. iOS bytes=0-1 probes) gets 200 with
      // the live body and no Content-Length.
      response.writeHead(200, {'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache, no-store', 'Accept-Ranges': 'none',
        'icy-name': 'EUTONOS Music DJ (live from the PC)'});
      if (head) { response.end(); return; }
      response.flushHeaders();
      const fast = Buffer.concat(recent);
      const start = firstFrameOffset(fast);
      if (start < fast.length) { response.write(fast.subarray(start)); bytesOut += fast.length - start; }
      listeners.add(response);
      response.on('close', () => { listeners.delete(response); });
      return;
    }
    const entry = Object.hasOwn(PHONE_FILES, path) ? PHONE_FILES[path] : undefined;
    if (!entry) { plain(response, 404, 'Not found', head); return; }
    try {
      const canonicalRoot = await realpath(root);
      const candidate = join(canonicalRoot, entry.file);
      const canonicalFile = await realpath(candidate);
      if (canonicalFile !== candidate) { plain(response, 404, 'Not found', head); return; }
      const info = await stat(canonicalFile);
      if (!info.isFile()) { plain(response, 404, 'Not found', head); return; }
      const content = head ? undefined : await readFile(canonicalFile);
      response.writeHead(200, {
        'Content-Type': entry.type, 'Content-Length': content?.byteLength ?? info.size,
        'Content-Security-Policy': "default-src 'self'; media-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
      });
      response.end(content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'ELOOP') plain(response, 404, 'Not found', head);
      else plain(response, 500, 'Unable to read file', head);
    }
  }

  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (closing) { plain(response, 503, 'Relay is stopping'); return; }
    const path = safeRequestPath(request.url ?? '');
    if (path === undefined) { plain(response, 404, 'Not found'); return; }
    const url = new URL(request.url ?? '/', 'http://relay.invalid');
    const handler = path.startsWith('/api/dj/')
      ? (['/api/dj/ingest', '/api/dj/events', '/api/dj/status', '/api/dj/wanted'].includes(path) ? handleDj(request, response, path, url) : Promise.resolve(plain(response, 404, 'Not found')))
      : isPhoneHost(request.headers.host, allowHosts)
        ? handlePhone(request, response, path)
        : Promise.resolve(plain(response, 400, 'Invalid host'));
    handler.catch(error => {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof BodyTooLarge) { json(response, 413, {error: 'body-too-large'}); return; }
      fail(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      json(response, 500, {error: 'internal'});
    });
  });

  async function close(): Promise<void> {
    closing = true;
    endSession('relay stopping');
    for (const listener of listeners) listener.destroy();
    listeners.clear();
    djEvents?.destroy();
    djEvents = null;
    await new Promise<void>(resolveClose => {
      if (!server.listening) { resolveClose(); return; }
      server.close(() => { resolveClose(); });
      server.closeAllConnections();
    });
  }

  return {server, token, status, close};
}

/** The DJ page address the owner opens; the token rides in the fragment, not the request. */
export function djPageUrl(djOrigin: string, relayPort: number, token: string): string {
  return `${djOrigin}/?relay=${encodeURIComponent(`http://127.0.0.1:${relayPort}`)}#relayToken=${token}`;
}

/** S18: the Studio set page (any-to-any set DJ with Auto) with the same relay and token. */
export function studioSetPageUrl(djOrigin: string, relayPort: number, token: string): string {
  return `${djOrigin}/studio.html?pack=set&tab=dj&relay=${encodeURIComponent(`http://127.0.0.1:${relayPort}`)}#relayToken=${token}`;
}

function usage(): string {
  return 'Usage: node dist/scripts/phone-relay.js [--port 0..65535] [--ffmpeg PATH] [--allow-host NAME]... [--dj-origin ORIGIN]...';
}

export interface RelayCliOptions { port: number; ffmpeg: string; allowHosts: string[]; djOrigins: string[] | null }

export function parseRelayArgs(args: readonly string[]): RelayCliOptions | string {
  const parsed: RelayCliOptions = {port: DEFAULT_RELAY_PORT, ffmpeg: 'ffmpeg', allowHosts: [], djOrigins: null};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (value === undefined) return usage();
    if (name === '--port') {
      if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) return 'Relay port must be an integer from 0 through 65535.';
      parsed.port = Number(value);
    } else if (name === '--ffmpeg') parsed.ffmpeg = value;
    else if (name === '--allow-host') {
      if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/i.test(value)) return `Invalid --allow-host name: ${value}`;
      parsed.allowHosts.push(value);
    } else if (name === '--dj-origin') {
      const origin = normalizeOrigin(value);
      if (!origin || !LOOPBACK.test(new URL(origin).host)) return `--dj-origin must be a loopback http(s) origin: ${value}`;
      (parsed.djOrigins ??= []).push(origin);
    } else return usage();
  }
  return parsed;
}

function checkFfmpeg(path: string): Promise<string> {
  return new Promise(resolveCheck => {
    execFile(path, ['-hide_banner', '-encoders'], {windowsHide: true, timeout: 10_000, maxBuffer: 4 * 1024 * 1024}, (error, stdout) => {
      if (error) resolveCheck(`WARNING: ffmpeg was not found or failed (${path}): ${error.message}. Use --ffmpeg PATH.`);
      else if (!/\blibmp3lame\b/.test(stdout)) resolveCheck(`WARNING: ${path} has no libmp3lame encoder; MP3 streaming will fail.`);
      else resolveCheck(`Encoder: ${path} (libmp3lame found).`);
    });
  });
}

function startRelay(args: string[]): void {
  const parsed = parseRelayArgs(args);
  if (typeof parsed === 'string') { console.error(parsed); process.exitCode = 1; return; }
  const relay = createPhoneRelay({spawnEncoder: ffmpegEncoder(parsed.ffmpeg), allowHosts: parsed.allowHosts,
    ...(parsed.djOrigins ? {djOrigins: parsed.djOrigins} : {}), log: message => { console.log(message); }});
  relay.server.on('error', error => { console.error(`Cannot start the phone relay: ${error.message}`); process.exitCode = 1; });
  relay.server.listen(parsed.port, '127.0.0.1', () => {
    const address = relay.server.address();
    if (!address || typeof address === 'string') return;
    const port = address.port;
    console.log(`EUTONOS Music phone relay: http://127.0.0.1:${port}/  (loopback only)`);
    console.log('');
    console.log('Phone listening (S17):');
    console.log('  1. In another terminal keep `npm run demo` running, then open THIS address in Edge or Chrome on this PC');
    console.log('     (it carries this run\'s secret relay token in the # fragment, which is never sent over the network):');
    console.log(`       ${djPageUrl(parsed.djOrigins?.[0] ?? DEFAULT_DJ_ORIGINS[0], port, relay.token)}`);
    console.log('     Or, for the S18 any-to-any set (Next, reorder, Auto), open the Studio set page instead:');
    console.log(`       ${studioSetPageUrl(parsed.djOrigins?.[0] ?? DEFAULT_DJ_ORIGINS[0], port, relay.token)}`);
    console.log('     The token changes every time the relay starts; reopen the new address after a restart.');
    console.log('  2. "Stream to phone" turns on by itself when the phone page opens (or switch it on by hand). Press Play there once (or from the phone).');
    console.log(`  3. To reach this relay from your phone, run this yourself on the PC (this relay does not run it):`);
    console.log(`       tailscale serve --bg ${port}`);
    console.log('     Check it with `tailscale serve status`; remove it later with `tailscale serve reset` (clears all serve config).');
    console.log('  4. On the phone (Tailscale app installed and signed in to the same tailnet) open');
    console.log('       https://<pc-name>.<tailnet>.ts.net/');
    console.log(`  ${DELAY_NOTE}`);
    console.log('  The phone hears a lossy MP3 copy: judge mixing defects on the PC, not on a phone speaker.');
    console.log('Press Ctrl+C to stop (the encoder is stopped too).');
    void checkFfmpeg(parsed.ffmpeg).then(message => { console.log(message); });
  });
  let stopping = false;
  const stop = (): void => {
    if (stopping) { process.exit(1); }
    stopping = true;
    console.log('Stopping the phone relay...');
    void relay.close().then(() => { process.exit(0); });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startRelay(process.argv.slice(2));
}
