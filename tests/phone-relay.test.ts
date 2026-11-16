import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {request, type IncomingHttpHeaders, type IncomingMessage} from 'node:http';
import {connect} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import {test, type TestContext} from 'node:test';
import {promisify} from 'node:util';
import {createPhoneRelay, djPageUrl, studioSetPageUrl, ffmpegEncoder, firstFrameOffset, isLoopbackHost, isPhoneHost, LIMITS,
  parseRelayArgs, safeRequestPath, type EncoderProcess, type PhoneRelay} from '../scripts/phone-relay.js';
import {parseControlCommand, QUEUE_LIMIT, sanitizeDjStatus, STATUS_TEXT_LIMIT} from '../web/phone-protocol.js';
import {StallWatchdog} from '../web/phone-watchdog.js';
import {AUTO_RESUME_ABSENT_MS, AUTO_START_INITIAL, AUTO_START_OWNER_STOPPED, autoStartStep, type AutoStartInput} from '../web/phone-stream.js';

const execFileAsync = promisify(execFile);
const DJ = 'http://127.0.0.1:4173';
const TOKEN = '0123456789abcdef0123456789abcdef';

/** An echoing stand-in for ffmpeg: whatever is written to stdin comes out of stdout. */
class FakeEncoder implements EncoderProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  killed = false;
  received: Buffer[] = [];
  private readonly exitListeners: ((code: number | null, signal: NodeJS.Signals | null) => void)[] = [];
  constructor() {
    this.stdin.on('data', (chunk: Buffer) => { this.received.push(chunk); if (!this.killed) this.stdout.write(chunk); });
  }
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.stdout.end();
    for (const listener of this.exitListeners) listener(null, 'SIGTERM');
  }
  emit(chunk: Buffer): void { this.stdout.write(chunk); }
  on(event: 'exit' | 'error', listener: (...args: never[]) => void): this {
    if (event === 'exit') this.exitListeners.push(listener as (code: number | null, signal: NodeJS.Signals | null) => void);
    return this;
  }
}

interface HttpResult { status: number | undefined; headers: IncomingHttpHeaders; body: Buffer }

function http(port: number, path: string, options: {method?: string; headers?: Record<string, string>; body?: Buffer | string} = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = request({hostname: '127.0.0.1', port, path, method: options.method ?? 'GET', setHost: false,
      headers: {host: `127.0.0.1:${port}`, ...options.headers}}, incoming => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => { resolve({status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks)}); });
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end(options.body);
  });
}
/** Opens an endless response (live MP3 or SSE) and collects its bytes. */
function stream(port: number, path: string, headers: Record<string, string> = {}): Promise<{incoming: IncomingMessage; bytes: () => Buffer; close: () => void}> {
  return new Promise((resolve, reject) => {
    const outgoing = request({hostname: '127.0.0.1', port, path, setHost: false, headers: {host: `127.0.0.1:${port}`, ...headers}}, incoming => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('error', () => undefined);
      resolve({incoming, bytes: () => Buffer.concat(chunks), close: () => { outgoing.destroy(); }});
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}
async function until(check: () => boolean, label: string, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const djHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({origin: DJ, 'x-relay-token': TOKEN, ...extra});
function ingest(port: number, session: string, seq: number, body: Buffer, headers = djHeaders()): Promise<HttpResult> {
  return http(port, `/api/dj/ingest?session=${session}&seq=${seq}`, {method: 'POST',
    headers: {'content-type': 'application/octet-stream', ...headers}, body});
}
function control(port: number, body: unknown, headers: Record<string, string> = {'content-type': 'application/json'}): Promise<HttpResult> {
  return http(port, '/api/control', {method: 'POST', headers, body: JSON.stringify(body)});
}
const mp3ish = (size: number, fill = 0x11): Buffer => { const value = Buffer.alloc(size, fill); value[0] = 0xff; value[1] = 0xfb; return value; };

async function relay(t: TestContext, options: {allowHosts?: string[]; spawn?: () => EncoderProcess; now?: () => number} = {}): Promise<{relay: PhoneRelay; port: number; encoders: FakeEncoder[]; root: string}> {
  const root = await mkdtemp(join(tmpdir(), 'eutonos phone relay '));
  await mkdir(join(root, 'web'), {recursive: true});
  await mkdir(join(root, 'dist', 'web'), {recursive: true});
  await writeFile(join(root, 'web', 'phone.html'), '<!doctype html><title>phone</title>');
  await writeFile(join(root, 'web', 'phone.css'), 'body{}');
  await writeFile(join(root, 'dist', 'web', 'phone.js'), 'export {};');
  await writeFile(join(root, 'dist', 'web', 'phone-watchdog.js'), 'export {};');
  await writeFile(join(root, 'dist', 'web', 'phone-ui.js'), 'export {};');
  await writeFile(join(root, 'package.json'), '{"private":true}');
  const encoders: FakeEncoder[] = [];
  const created = createPhoneRelay({root, token: TOKEN, allowHosts: options.allowHosts ?? [], ...(options.now ? {now: options.now} : {}),
    spawnEncoder: options.spawn ?? (() => { const encoder = new FakeEncoder(); encoders.push(encoder); return encoder; })});
  t.after(async () => { await created.close(); await rm(root, {recursive: true, force: true}); });
  created.server.listen(0, '127.0.0.1');
  await once(created.server, 'listening');
  const address = created.server.address();
  assert.ok(address && typeof address !== 'string');
  return {relay: created, port: address.port, encoders, root};
}

test('host guards accept loopback and tailnet names for the phone and only loopback for the DJ', () => {
  for (const host of ['127.0.0.1:4180', 'localhost', '[::1]:4180', 'pc.tail1234.ts.net', 'PC.Tail-1.ts.net:443']) assert.ok(isPhoneHost(host), host);
  for (const host of [undefined, '', 'evil.example', 'ts.net', 'pc.ts.net.evil.example', '192.168.1.5:4180', 'a@pc.ts.net', 'pc.ts.net/x']) {
    assert.equal(isPhoneHost(host), false, String(host));
  }
  assert.ok(isPhoneHost('studio-pc:4180', ['studio-pc']));
  assert.ok(isPhoneHost('STUDIO-PC', ['studio-pc']));
  assert.equal(isPhoneHost('other-pc', ['studio-pc']), false);
  assert.ok(isLoopbackHost('127.0.0.1:4180'));
  assert.equal(isLoopbackHost('pc.tail1234.ts.net'), false);
});

test('the command allowlist refuses unknown commands, fields and modes', () => {
  assert.deepEqual(parseControlCommand({command: 'next'}), {command: 'next'});
  assert.deepEqual(parseControlCommand({command: 'hold'}), {command: 'hold'});
  assert.deepEqual(parseControlCommand({command: 'hold', enabled: false}), {command: 'hold', enabled: false});
  assert.deepEqual(parseControlCommand({command: 'handoff', mode: 'mix'}), {command: 'handoff', mode: 'mix'});
  // S18: Auto on the Studio set page; same strict shape as hold.
  assert.deepEqual(parseControlCommand({command: 'auto'}), {command: 'auto'});
  assert.deepEqual(parseControlCommand({command: 'auto', enabled: true}), {command: 'auto', enabled: true});
  for (const bad of [{command: 'auto', enabled: 'yes'}, {command: 'auto', bars: 32}, {command: 'auto', enabled: true, loop: true}]) {
    assert.equal(parseControlCommand(bad), null, JSON.stringify(bad));
  }
  // Phone UX: choose the next song by id; ids are short, printable and never paths.
  assert.deepEqual(parseControlCommand({command: 'set-next', songId: 'synthetic-174-a'}), {command: 'set-next', songId: 'synthetic-174-a'});
  for (const bad of [{command: 'set-next'}, {command: 'set-next', songId: ''}, {command: 'set-next', songId: 7}, {command: 'set-next', songId: '../x'},
    {command: 'set-next', songId: 'a/b'}, {command: 'set-next', songId: 'a\b'}, {command: 'set-next', songId: 'x'.repeat(121)},
    {command: 'set-next', songId: 'ok', extra: 1}, {command: 'set-next', songId: 'a b'}]) {
    assert.equal(parseControlCommand(bad), null, JSON.stringify(bad));
  }
  for (const bad of [null, [], 'next', {command: 'rm'}, {command: 'next', extra: 1}, {command: 'hold', enabled: 'yes'},
    {command: 'handoff', mode: 'scratch'}, {command: 'handoff'}, {command: 'pause'}, {command: '__proto__'}]) {
    assert.equal(parseControlCommand(bad), null, JSON.stringify(bad));
  }
  const status = sanitizeDjStatus({now: 'x'.repeat(1000), state: 'playing\u0000', hold: 'true', canNext: true, handoff: 'evil', extra: 'dropped'});
  assert.ok(status);
  assert.equal(status.now.length, STATUS_TEXT_LIMIT);
  assert.equal(status.state, 'playing ');
  assert.equal(status.hold, false);
  assert.equal(status.canNext, true);
  assert.equal(status.handoff, null);
  assert.equal('extra' in status, false);
  assert.equal(sanitizeDjStatus([1]), null);
  // Queue: bounded, sanitized, no paths; missing fields (older DJ page) become empty, never throw.
  const rich = sanitizeDjStatus({state: 'needs-click', nextStatus: 'Ready\u0000', canSetNext: true,
    queue: [{id: 'song-a', title: 'A\u0007'}, {id: 'C:/music/x.wav', title: 'path'}, {id: '..\\x', title: 'p2'}, {id: 'song-b'}, 5, null,
      ...Array.from({length: 40}, (_, i) => ({id: `s${i}`, title: `T${i}`}))],
    transitionNext: {recipe: 'Bass swap', overlap: '8 bars', choreography: 'bass-swap-classic', tempo: '+1.0%', entry: 'enters at 1:12', fallback: '', evil: 'x'},
    transitionLast: {overlap: 'no recipe'}});
  assert.ok(rich);
  assert.equal(rich.state, 'needs-click');
  assert.equal(rich.nextStatus, 'Ready ');
  assert.equal(rich.canSetNext, true);
  assert.equal(rich.queue!.length, QUEUE_LIMIT);
  assert.deepEqual(rich.queue!.slice(0, 2), [{id: 'song-a', title: 'A '}, {id: 'song-b', title: 'song-b'}]);
  assert.ok(rich.queue!.every(item => !/[\\/]/.test(item.id)));
  assert.deepEqual(rich.transitionNext, {recipe: 'Bass swap', overlap: '8 bars', choreography: 'bass-swap-classic', tempo: '+1.0%', entry: 'enters at 1:12', fallback: ''});
  assert.equal(rich.transitionLast, null, 'a transition without a recipe is dropped');
  const old = sanitizeDjStatus({state: 'idle', next: 'x'});
  assert.deepEqual(old!.queue, []);
  assert.equal(old!.canSetNext, false);
  assert.equal(old!.transitionNext, null);
});

test('path safety and relay argument parsing', () => {
  assert.equal(safeRequestPath('/'), '/');
  assert.equal(safeRequestPath('/live.mp3?t=1'), '/live.mp3');
  for (const bad of ['', 'x', '//evil', '/../package.json', '/a/%2e%2e/b', '/%2f', '/a%5cb', '/a\\b', '/%zz', '/a%00']) {
    assert.equal(safeRequestPath(bad), undefined, bad);
  }
  assert.deepEqual(parseRelayArgs([]), {port: 4180, ffmpeg: 'ffmpeg', allowHosts: [], djOrigins: null});
  assert.deepEqual(parseRelayArgs(['--port', '0', '--ffmpeg', 'C:/ff/ffmpeg.exe', '--allow-host', 'pc', '--dj-origin', 'http://localhost:5000']),
    {port: 0, ffmpeg: 'C:/ff/ffmpeg.exe', allowHosts: ['pc'], djOrigins: ['http://localhost:5000']});
  assert.equal(typeof parseRelayArgs(['--port', '70000']), 'string');
  assert.equal(typeof parseRelayArgs(['--dj-origin', 'https://evil.example']), 'string');
  assert.equal(typeof parseRelayArgs(['--host', '0.0.0.0']), 'string', 'no LAN binding option exists');
  assert.equal(firstFrameOffset(Buffer.from([0x49, 0x44, 0x33, 0xff, 0xfb, 0x90])), 3);
});

test('DJ endpoints require loopback Host, the DJ Origin and no proxy headers, with CORS for that origin only', async t => {
  const {port, encoders} = await relay(t);
  const chunk = Buffer.from('webm');
  assert.equal((await ingest(port, 'session-aaaa', 0, chunk, {})).status, 403, 'no Origin');
  assert.equal((await ingest(port, 'session-aaaa', 0, chunk, {origin: 'https://pc.tail1.ts.net'})).status, 403, 'phone Origin');
  assert.equal((await ingest(port, 'session-aaaa', 0, chunk, {origin: 'http://127.0.0.1:9999'})).status, 403, 'other local Origin');
  assert.equal((await ingest(port, 'session-aaaa', 0, chunk, djHeaders({host: 'pc.tail1.ts.net'}))).status, 403, 'tailnet Host');
  assert.equal((await ingest(port, 'session-aaaa', 0, chunk, djHeaders({'x-forwarded-for': '100.64.0.2'}))).status, 403, 'proxied');
  assert.equal((await ingest(port, 'session-aaaa', 0, chunk, djHeaders({'tailscale-user-login': 'someone'}))).status, 403, 'tailscale proxied');
  assert.equal(encoders.length, 0, 'no refused request reached the encoder');
  const refused = await http(port, '/api/dj/ingest', {method: 'OPTIONS', headers: {origin: 'https://evil.example', 'access-control-request-method': 'POST'}});
  assert.equal(refused.status, 403);
  assert.equal(refused.headers['access-control-allow-origin'], undefined);
  const preflight = await http(port, '/api/dj/ingest', {method: 'OPTIONS', headers: djHeaders({'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type'})});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], DJ);
  assert.match(String(preflight.headers['access-control-allow-headers']), /Content-Type/);
  assert.match(String(preflight.headers['access-control-allow-headers']), /X-Relay-Token/);
  // Host and Origin are forgeable by non-browser clients; the per-run token is the real gate.
  const forged = {host: `127.0.0.1:${port}`, origin: DJ};
  assert.equal((await ingest(port, 'session-aaaa', 0, chunk, forged)).status, 401, 'forged Host + Origin without token');
  assert.equal((await ingest(port, 'session-aaaa', 0, chunk, {...forged, 'x-relay-token': 'f'.repeat(32)})).status, 401, 'wrong token');
  assert.equal((await ingest(port, 'session-aaaa', 0, chunk, {...forged, 'x-relay-token': TOKEN.slice(0, 31)})).status, 401, 'short token');
  assert.equal((await http(port, '/api/dj/events', {headers: forged})).status, 401);
  assert.equal((await http(port, '/api/dj/status', {method: 'POST', headers: {...forged, 'content-type': 'application/json'}, body: '{}'})).status, 401);
  assert.equal((await http(port, '/api/dj/events?token=' + TOKEN, {headers: forged})).status, 401, 'no query-string token');
  assert.equal(encoders.length, 0);
  const accepted = await ingest(port, 'session-aaaa', 0, chunk);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers['access-control-allow-origin'], DJ);
  assert.equal(encoders.length, 1);
  assert.equal((await http(port, '/api/dj/other', {headers: djHeaders()})).status, 404);
  const localhostOrigin = await http(port, '/api/dj/status', {method: 'POST', headers: {origin: 'http://localhost:4173', 'x-relay-token': TOKEN, 'content-type': 'application/json'}, body: '{}'});
  assert.equal(localhostOrigin.status, 200);
});

test('phone endpoints use the host guard and same-origin JSON, and cannot inject audio', async t => {
  const {port, encoders} = await relay(t, {allowHosts: ['studio-pc']});
  assert.equal((await http(port, '/', {headers: {host: 'evil.example'}})).status, 400);
  assert.equal((await http(port, '/', {headers: {host: 'pc.tail1234.ts.net'}})).status, 200);
  assert.equal((await http(port, '/', {headers: {host: 'studio-pc:4180'}})).status, 200);
  assert.equal((await control(port, {command: 'next'}, {'content-type': 'text/plain'})).status, 403, 'simple-request CSRF');
  assert.equal((await control(port, {command: 'next'}, {'content-type': 'application/json', origin: 'https://evil.example'})).status, 403);
  assert.equal((await control(port, {command: 'next'}, {'content-type': 'application/json', 'sec-fetch-site': 'cross-site'})).status, 403);
  assert.equal((await control(port, {command: 'rm -rf'})).status, 400);
  assert.equal((await control(port, {command: 'next'}, {'content-type': 'application/json', origin: `http://127.0.0.1:${port}`})).status, 503, 'no DJ connected');
  assert.equal((await http(port, '/api/control')).status, 405);
  const viaPhone = await http(port, '/api/dj/ingest?session=session-aaaa&seq=0', {method: 'POST',
    headers: {host: 'pc.tail1234.ts.net', origin: 'https://pc.tail1234.ts.net', 'content-type': 'application/octet-stream'}, body: 'x'});
  assert.equal(viaPhone.status, 403);
  assert.equal((await http(port, '/live.mp3', {method: 'POST', body: 'x'})).status, 405, 'no upload through the listener path');
  assert.equal(encoders.length, 0);
});

test('request bodies are bounded', async t => {
  const {port} = await relay(t);
  assert.equal((await ingest(port, 'session-aaaa', 0, Buffer.alloc(LIMITS.ingestBytes + 1))).status, 413);
  assert.equal((await http(port, '/api/dj/status', {method: 'POST', headers: djHeaders({'content-type': 'application/json'}),
    body: JSON.stringify({now: 'x'.repeat(LIMITS.statusBytes)})})).status, 413);
  assert.equal((await control(port, {command: 'next', pad: 'x'.repeat(LIMITS.controlBytes)})).status, 413);
  assert.equal((await ingest(port, 'bad', 0, Buffer.from('x'))).status, 400, 'session id format');
  assert.equal((await http(port, '/api/dj/ingest?session=session-aaaa&seq=-1', {method: 'POST', headers: djHeaders(), body: 'x'})).status, 400);
});

test('one ingest session at a time: a new session replaces the old encoder and gaps end a session', async t => {
  const {port, encoders, relay: running} = await relay(t);
  assert.equal((await ingest(port, 'session-aaaa', 1, Buffer.from('late'))).status, 409, 'a session must start at chunk 0');
  assert.equal((await ingest(port, 'session-aaaa', 0, Buffer.from('a0'))).status, 200);
  assert.equal((await ingest(port, 'session-aaaa', 1, Buffer.from('a1'))).status, 200);
  assert.equal(encoders.length, 1);
  assert.equal((await ingest(port, 'session-bbbb', 0, Buffer.from('b0'))).status, 200);
  assert.equal(encoders.length, 2);
  assert.ok(encoders[0]!.killed, 'the replaced session stopped its encoder');
  assert.equal(Buffer.concat(encoders[0]!.received).toString(), 'a0a1');
  assert.equal((await ingest(port, 'session-aaaa', 2, Buffer.from('a2'))).status, 409, 'the old session is gone');
  const gap = await ingest(port, 'session-bbbb', 5, Buffer.from('b5'));
  assert.equal(gap.status, 409);
  assert.equal(JSON.parse(gap.body.toString()).error, 'sequence-gap');
  assert.ok(encoders[1]!.killed);
  assert.equal(running.status().stream.ingesting, false);
  assert.match(running.status().stream.lastError ?? '', /gap/);
  const final = await http(port, '/api/dj/ingest?session=session-cccc&final=1', {method: 'POST', headers: djHeaders(), body: ''});
  assert.equal(final.status, 200);
  assert.equal((await ingest(port, 'session-dddd', 0, Buffer.from('d0'))).status, 200);
  assert.equal((await http(port, '/api/dj/ingest?session=session-dddd&final=1', {method: 'POST', headers: djHeaders(), body: ''})).status, 200);
  assert.ok(encoders[2]!.killed, 'final ends the session');
  assert.equal(running.status().stream.sessions, 3);
});

test('MP3 bytes fan out to every listener, a late listener gets a fast start, and close() ends everything', async t => {
  const {port, encoders, relay: running} = await relay(t);
  const first = await stream(port, '/live.mp3');
  const second = await stream(port, '/live.mp3', {host: 'pc.tail1234.ts.net'});
  assert.equal(first.incoming.statusCode, 200);
  assert.equal(first.incoming.headers['content-type'], 'audio/mpeg');
  await until(() => running.status().stream.listeners === 2, 'two listeners');
  const payload = mp3ish(1000);
  assert.equal((await ingest(port, 'session-aaaa', 0, payload)).status, 200);
  await until(() => first.bytes().length === 1000 && second.bytes().length === 1000, 'both listeners received the chunk');
  assert.deepEqual(first.bytes(), payload);
  // A late listener starts from the recent buffer at a frame boundary.
  encoders[0]!.emit(Buffer.from([0x00, 0x01, 0xff, 0xfb, 0x22]));
  const late = await stream(port, '/live.mp3');
  await until(() => late.bytes().length > 0, 'fast start');
  assert.equal(late.bytes()[0], 0xff);
  assert.equal(late.bytes()[1], 0xfb);
  const ended = new Promise<void>(resolve => { first.incoming.on('close', () => { resolve(); }); });
  await running.close();
  await ended;
  assert.ok(encoders[0]!.killed, 'close() stops the encoder');
  second.close(); late.close();
});

test('a listener that stops reading is dropped instead of buffered without bound', async t => {
  const {port, encoders, relay: running} = await relay(t);
  assert.equal((await ingest(port, 'session-aaaa', 0, mp3ish(16))).status, 200);
  const socket = connect(port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write(`GET /live.mp3 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
  socket.pause();
  const healthy = await stream(port, '/live.mp3');
  await until(() => running.status().stream.listeners === 2, 'two listeners');
  const block = mp3ish(64 * 1024);
  let pushed = 0;
  while (running.status().stream.listeners === 2) {
    assert.ok(pushed < 256 * 1024 * 1024, 'the slow listener was never dropped');
    encoders[0]!.emit(block);
    pushed += block.length;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(running.status().stream.listeners, 1, 'only the slow listener was dropped');
  await until(() => healthy.bytes().length >= pushed, 'the healthy listener kept receiving');
  socket.destroy(); healthy.close();
});

test('phone commands reach the connected DJ page over Server-Sent Events, and DJ status reaches the phone', async t => {
  const {port, relay: running} = await relay(t);
  const events = await stream(port, '/api/dj/events', djHeaders());
  assert.equal(events.incoming.statusCode, 200);
  assert.equal(events.incoming.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.equal(events.incoming.headers['access-control-allow-origin'], DJ);
  await until(() => running.status().dj.connected, 'DJ connected');
  assert.equal((await control(port, {command: 'next'})).status, 202);
  assert.equal((await control(port, {command: 'handoff', mode: 'hybrid'}, {'content-type': 'application/json', origin: 'https://pc.tail1.ts.net', host: 'pc.tail1.ts.net'})).status, 202);
  await until(() => events.bytes().toString().includes('"mode":"hybrid"'), 'two commands delivered');
  const text = events.bytes().toString();
  assert.match(text, /event: command\ndata: \{"command":"next","id":1\}\n\n/);
  assert.match(text, /event: command\ndata: \{"command":"handoff","mode":"hybrid","id":2\}\n\n/);
  // A second DJ connection is refused while the first is open; after it closes, a new one is accepted.
  const second = await http(port, '/api/dj/events', {headers: djHeaders()});
  assert.equal(second.status, 409);
  assert.equal(JSON.parse(second.body.toString()).error, 'another-dj-connected');
  assert.equal(second.headers['access-control-allow-origin'], DJ, 'the DJ page can read the refusal');
  events.close();
  await until(() => !running.status().dj.connected, 'first DJ connection closed');
  const newer = await stream(port, '/api/dj/events', djHeaders());
  assert.equal(newer.incoming.statusCode, 200);
  assert.equal((await control(port, {command: 'stop'})).status, 202);
  await until(() => newer.bytes().toString().includes('"command":"stop"'), 'newer connection got the command');
  // S18: the Studio set page's Auto toggle crosses the relay; malformed Auto is refused.
  assert.equal((await control(port, {command: 'auto', enabled: true})).status, 202);
  await until(() => newer.bytes().toString().includes('"command":"auto","enabled":true'), 'auto delivered');
  assert.equal((await control(port, {command: 'auto', bars: 16})).status, 400);
  // Phone UX: set-next crosses the relay as an allowlisted command; unknown shapes are refused.
  assert.equal((await control(port, {command: 'set-next', songId: 'song-b'})).status, 202);
  await until(() => newer.bytes().toString().includes('"command":"set-next","songId":"song-b"'), 'set-next delivered');
  assert.equal((await control(port, {command: 'set-next', songId: '/etc/passwd'})).status, 400);
  assert.equal((await control(port, {command: 'set-next'})).status, 400);
  const posted = await http(port, '/api/dj/status', {method: 'POST', headers: djHeaders({'content-type': 'application/json'}),
    body: JSON.stringify({state: 'playing', now: 'S01 A', next: 'S01 B', hold: true, handoff: 'mix', canNext: true, auto: true, canAuto: 'yes'})});
  assert.equal(posted.status, 200);
  const phone = JSON.parse((await http(port, '/api/status', {headers: {host: 'pc.tail1.ts.net'}})).body.toString());
  assert.equal(phone.dj.connected, true);
  assert.equal(phone.dj.status.now, 'S01 A');
  assert.equal(phone.dj.status.hold, true);
  assert.equal(phone.dj.status.handoff, 'mix');
  assert.equal(phone.dj.status.auto, true);
  assert.equal(phone.dj.status.canAuto, false, 'flags are strict booleans');
  assert.match(phone.delayNote, /2-5 seconds/);
  assert.equal((await http(port, '/api/dj/status', {method: 'POST', headers: djHeaders({'content-type': 'application/json'}), body: '[1]'})).status, 400);
  newer.close();
  await until(() => !running.status().dj.connected, 'DJ disconnect noticed');
});

test('phone files are a strict allowlist with path safety and security headers', async t => {
  const {port} = await relay(t);
  const page = await http(port, '/');
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(String(page.headers['content-security-policy']), /default-src 'self'/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal((await http(port, '/phone.js')).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await http(port, '/phone.css')).status, 200);
  for (const path of ['/package.json', '/web/phone.html', '/dist/web/phone.js', '/../package.json', '/%2e%2e/package.json',
    '/phone.js%00', '/web%5cphone.html', '//phone.js', '/constructor', '/__proto__']) {
    assert.equal((await http(port, path)).status, 404, path);
  }
  const head = await http(port, '/', {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
});

test('an encoder that fails to start is reported and the next session can retry', async t => {
  let attempts = 0;
  const {port, relay: running} = await relay(t, {spawn: () => {
    attempts++;
    if (attempts === 1) throw new Error('spawn ENOENT');
    return new FakeEncoder();
  }});
  assert.equal((await ingest(port, 'session-aaaa', 0, Buffer.from('x'))).status, 503);
  assert.equal(running.status().stream.encoder, 'error');
  assert.equal((await ingest(port, 'session-bbbb', 0, Buffer.from('x'))).status, 200);
  assert.equal(running.status().stream.encoder, 'running');
});

async function ffmpegReady(): Promise<string | null> {
  try {
    const encoders = (await execFileAsync('ffmpeg', ['-hide_banner', '-encoders'], {windowsHide: true, maxBuffer: 8 << 20})).stdout;
    const decoders = (await execFileAsync('ffmpeg', ['-hide_banner', '-decoders'], {windowsHide: true, maxBuffer: 8 << 20})).stdout;
    if (!/\blibmp3lame\b/.test(encoders)) return 'ffmpeg has no libmp3lame encoder';
    if (!/\blibopus\b/.test(encoders)) return 'ffmpeg has no libopus encoder to generate the WebM input';
    if (!/\bopus\b/.test(decoders)) return 'ffmpeg has no Opus decoder';
    return null;
  } catch (error) { return `ffmpeg is unavailable: ${error instanceof Error ? error.message : String(error)}`; }
}

/** MPEG-1 Layer III frame length for a header at offset, or null when it is not one. */
function mp3FrameLength(bytes: Buffer, offset: number): number | null {
  const b1 = bytes[offset + 1] ?? 0, b2 = bytes[offset + 2] ?? 0;
  if (bytes[offset] !== 0xff || (b1 & 0xfe) !== 0xfa) return null;
  const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const bitrate = bitrates[b2 >> 4];
  const sampleRate = [44100, 48000, 32000][(b2 >> 2) & 3];
  if (!bitrate || !sampleRate) return null;
  return Math.floor(144 * bitrate * 1000 / sampleRate) + ((b2 >> 1) & 1);
}

test('real ffmpeg smoke: WebM/Opus chunks in, consecutive 44.1 kHz 256 kbit/s MP3 frames out', async t => {
  const unavailable = await ffmpegReady();
  if (unavailable) { t.skip(`SKIPPED real-ffmpeg smoke: ${unavailable}`); return; }
  const generated = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=48000',
      '-ac', '2', '-c:a', 'libopus', '-b:a', '192k', '-f', 'webm', 'pipe:1'], {windowsHide: true});
    const chunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', reject);
    child.on('exit', code => { if (code === 0) resolve(Buffer.concat(chunks)); else reject(new Error(`ffmpeg generator exited ${code}`)); });
  });
  assert.ok(generated.length > 1000);
  assert.equal(generated.readUInt32BE(0), 0x1a45dfa3, 'EBML/WebM header');
  const created = createPhoneRelay({token: TOKEN, spawnEncoder: ffmpegEncoder('ffmpeg')});
  t.after(() => created.close());
  created.server.listen(0, '127.0.0.1');
  await once(created.server, 'listening');
  const address = created.server.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  const listener = await stream(port, '/live.mp3');
  let seq = 0;
  for (let offset = 0; offset < generated.length; offset += 4096) {
    const response = await ingest(port, 'smoke-session', seq++, generated.subarray(offset, offset + 4096));
    assert.equal(response.status, 200, response.body.toString());
  }
  // About 3 s of 256 kbit/s MP3 is ~96 KB; require most of it while the session is still open.
  await until(() => listener.bytes().length > 40_000, 'MP3 output from ffmpeg', 15_000);
  const bytes = listener.bytes();
  let offset = firstFrameOffset(bytes);
  let frames = 0;
  while (frames < 20) {
    const length = mp3FrameLength(bytes, offset);
    assert.ok(length, `MP3 frame ${frames} header at ${offset}`);
    assert.equal(bytes[offset + 2]! >> 4, 13, '256 kbit/s');
    assert.equal((bytes[offset + 2]! >> 2) & 3, 0, '44.1 kHz');
    offset += length;
    frames++;
  }
  assert.equal(created.status().stream.encoder, 'running');
  listener.close();
});

test('each relay run gets its own random hex token and a DJ address that carries it only in the fragment', () => {
  const first = createPhoneRelay(), second = createPhoneRelay();
  assert.match(first.token, /^[0-9a-f]{32}$/);
  assert.notEqual(first.token, second.token);
  assert.throws(() => createPhoneRelay({token: 'short'}), /token/);
  const url = new URL(djPageUrl('http://127.0.0.1:4173', 4180, TOKEN));
  assert.equal(url.searchParams.get('relay'), 'http://127.0.0.1:4180');
  assert.equal(url.hash, `#relayToken=${TOKEN}`);
  assert.equal(url.search.includes(TOKEN), false, 'the token is not in the request target');
  const studio = new URL(studioSetPageUrl('http://127.0.0.1:4173', 4180, TOKEN));
  assert.equal(studio.pathname, '/studio.html');
  assert.equal(studio.searchParams.get('pack'), 'set');
  assert.equal(studio.searchParams.get('relay'), 'http://127.0.0.1:4180');
  assert.equal(studio.hash, `#relayToken=${TOKEN}`);
  assert.equal(studio.search.includes(TOKEN), false, 'the token is not in the request target');
});

test('live MP3 is Icecast-style for Range probes, and cross-site status or audio fetches are refused', async t => {
  const {port} = await relay(t);
  const probe = await stream(port, '/live.mp3', {range: 'bytes=0-1'});
  assert.equal(probe.incoming.statusCode, 200);
  assert.equal(probe.incoming.headers['accept-ranges'], 'none');
  assert.equal(probe.incoming.headers['cache-control'], 'no-cache, no-store');
  assert.match(String(probe.incoming.headers['icy-name']), /EUTONOS/);
  assert.equal(probe.incoming.headers['content-length'], undefined);
  probe.close();
  assert.equal((await http(port, '/live.mp3', {headers: {'sec-fetch-site': 'cross-site'}})).status, 403);
  assert.equal((await http(port, '/api/status', {headers: {'sec-fetch-site': 'cross-site'}})).status, 403);
  assert.equal((await http(port, '/api/status', {headers: {'sec-fetch-site': 'same-origin'}})).status, 200);
  assert.equal((await http(port, '/', {headers: {'sec-fetch-site': 'cross-site'}})).status, 200, 'opening the phone page from a link still works');
  assert.equal((await http(port, '/phone-watchdog.js')).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await http(port, '/phone-ui.js')).headers['content-type'], 'text/javascript; charset=utf-8');
});

test('the phone stall watchdog reconnects only after a sustained stall while listening', () => {
  let wants = true;
  let stalls = 0;
  const pending = new Map<number, () => void>();
  let next = 0;
  const timers = {set: (callback: () => void) => { pending.set(++next, callback); return next; },
    clear: (handle: unknown) => { pending.delete(handle as number); }};
  const fire = (): void => { for (const [id, callback] of [...pending]) { pending.delete(id); callback(); } };
  const watchdog = new StallWatchdog(() => wants, () => { stalls++; }, 8000, timers);
  watchdog.starved();
  watchdog.starved();
  assert.equal(pending.size, 1, 'repeated waiting events keep one timer');
  watchdog.fed();
  assert.equal(pending.size, 0, 'playing again cancels the stall');
  fire();
  assert.equal(stalls, 0);
  watchdog.starved();
  fire();
  assert.equal(stalls, 1, 'a sustained stall triggers one reconnect');
  assert.equal(watchdog.armed, false);
  watchdog.starved();
  wants = false;
  fire();
  assert.equal(stalls, 1, 'no reconnect after the listener paused');
  watchdog.starved();
  assert.equal(pending.size, 0, 'not armed while not listening');
});

test('/api/dj/wanted is token and DJ-origin protected and reports a recent phone request', async t => {
  let clock = 1_000_000;
  const {port} = await relay(t, {now: () => clock});
  const wanted = (headers: Record<string, string>): Promise<HttpResult> => http(port, '/api/dj/wanted', {headers});
  assert.equal((await wanted({})).status, 403, 'no Origin');
  assert.equal((await wanted({origin: 'https://pc.tail1.ts.net', 'x-relay-token': TOKEN})).status, 403, 'phone Origin');
  assert.equal((await wanted({origin: DJ})).status, 401, 'no token');
  assert.equal((await wanted({origin: DJ, 'x-relay-token': 'f'.repeat(32)})).status, 401, 'wrong token');
  assert.equal((await http(port, '/api/dj/wanted', {method: 'POST', headers: djHeaders()})).status, 405);
  const first = await wanted(djHeaders());
  assert.equal(first.status, 200);
  assert.equal(first.headers['access-control-allow-origin'], DJ);
  assert.deepEqual(JSON.parse(first.body.toString()), {wanted: false, phoneSeenMs: null, listeners: 0});
  // The DJ page's own requests (including this one) are not phone activity.
  await http(port, '/api/dj/status', {method: 'POST', headers: djHeaders({'content-type': 'application/json'}), body: '{}'});
  assert.equal(JSON.parse((await wanted(djHeaders())).body.toString()).wanted, false);
  // A cross-site status fetch does not count either.
  assert.equal((await http(port, '/api/status', {headers: {'sec-fetch-site': 'cross-site'}})).status, 403);
  assert.equal(JSON.parse((await wanted(djHeaders())).body.toString()).wanted, false);
  assert.equal((await http(port, '/api/status')).status, 200);
  clock += 3000;
  const seen = JSON.parse((await wanted(djHeaders())).body.toString()) as {wanted: boolean; phoneSeenMs: number};
  assert.equal(seen.wanted, true);
  assert.equal(seen.phoneSeenMs, 3000);
  clock += 6000;
  const expired = JSON.parse((await wanted(djHeaders())).body.toString()) as {wanted: boolean; phoneSeenMs: number};
  assert.equal(expired.wanted, false, 'phone silent for more than 8 s');
  assert.equal(expired.phoneSeenMs, 9000);
  // Opening the live stream counts and keeps wanted true while the listener stays connected.
  const live = await stream(port, '/live.mp3');
  assert.equal(live.incoming.statusCode, 200);
  clock += 60_000;
  await new Promise(resolve => setTimeout(resolve, 50));
  const listening = JSON.parse((await wanted(djHeaders())).body.toString()) as {wanted: boolean; listeners: number};
  assert.equal(listening.listeners, 1);
  assert.equal(listening.wanted, true);
  live.close();
});

test('a phone control request counts as the phone looking', async t => {
  let clock = 5_000;
  const {port} = await relay(t, {now: () => clock});
  assert.equal((await control(port, {command: 'next'})).status, 503);
  const body = JSON.parse((await http(port, '/api/dj/wanted', {headers: djHeaders()})).body.toString()) as {wanted: boolean};
  assert.equal(body.wanted, true);
});

test('auto-start decision: starts on a phone, pauses after the owner turns it off until 20 s absent and back', () => {
  const base: AutoStartInput = {now: 0, wanted: true, streaming: false, option: true, hasToken: true};
  assert.equal(autoStartStep(AUTO_START_INITIAL, base).start, true);
  assert.equal(autoStartStep(AUTO_START_INITIAL, {...base, wanted: false}).start, false);
  assert.equal(autoStartStep(AUTO_START_INITIAL, {...base, option: false}).start, false);
  assert.equal(autoStartStep(AUTO_START_INITIAL, {...base, hasToken: false}).start, false);
  assert.equal(autoStartStep(AUTO_START_INITIAL, {...base, streaming: true}).start, false);
  // Owner switched streaming off while the phone is still there: stays off.
  let step = autoStartStep(AUTO_START_OWNER_STOPPED, {...base, now: 1000});
  assert.equal(step.start, false);
  step = autoStartStep(step.state, {...base, now: 3000});
  assert.equal(step.start, false);
  // Phone leaves; before 20 s it is still paused even if it flickers back.
  step = autoStartStep(step.state, {...base, now: 4000, wanted: false});
  step = autoStartStep(step.state, {...base, now: 4000 + AUTO_RESUME_ABSENT_MS - 1, wanted: false});
  assert.equal(step.state.pausedByOwner, true);
  const flicker = autoStartStep(step.state, {...base, now: 4000 + AUTO_RESUME_ABSENT_MS, wanted: true});
  assert.equal(flicker.start, false, 'a return resets the absence timer while paused');
  // Absent for a full 20 s, then the phone reappears: starts.
  step = autoStartStep(flicker.state, {...base, now: 30_000, wanted: false});
  step = autoStartStep(step.state, {...base, now: 30_000 + AUTO_RESUME_ABSENT_MS, wanted: false});
  assert.equal(step.state.pausedByOwner, false);
  assert.equal(autoStartStep(step.state, {...base, now: 60_000}).start, true);
});
