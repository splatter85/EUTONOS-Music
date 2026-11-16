/**
 * Transition feedback: schema, phone `rate` command, durable relay file endpoints, browser store
 * queue/flush/sync, and the report aggregation. Synthetic plan records only; no audio, no listening.
 */
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {request, type IncomingHttpHeaders} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import test, {type TestContext} from 'node:test';
import {createPhoneRelay, LIMITS, type EncoderProcess, type PhoneRelay} from '../scripts/phone-relay.js';
import {FEEDBACK_FILE_LIMITS, FeedbackFile, FeedbackFileError} from '../scripts/transition-feedback-file.js';
import {buildReport, formatReport, MIN_GROUP, MIN_TOTAL, skippedBucket} from '../scripts/transitions-report.js';
import {FEEDBACK_NOTE_MAX, FEEDBACK_TAGS} from '../web/feedback-vocabulary.js';
import {parseControlCommand, sanitizeDjStatus} from '../web/phone-protocol.js';
import {feedbackFromLegacy, latestPerPlan, makeTransitionFeedback, parseFeedbackLines, parseTransitionFeedback, TRANSITION_FEEDBACK,
  type TransitionFeedback} from '../web/transition-feedback.js';
import {FEEDBACK_CACHE_KEY, FeedbackStore, LEGACY_RATINGS_KEY, type KeyValueStorage} from '../web/transition-feedback-store.js';
import {emptyTransitionRatings, makeTransitionPlanRecord, rateTransition, type TransitionPlanRecord} from '../web/transition-policy.js';
import type {ChoreographyParams} from '../web/eq-choreography.js';

const DJ = 'http://127.0.0.1:4173';
const TOKEN = '0123456789abcdef0123456789abcdef';

function plan(overrides: Partial<Omit<TransitionPlanRecord, 'id' | 'version'>> = {}): TransitionPlanRecord {
  const choreography: ChoreographyParams = {name: 'tone-dissolve', overlapBars: 16, swapMs: 380};
  return makeTransitionPlanRecord({mode: 'auto', seed: null,
    versions: {policy: 'transition-policy@1', planner: 'p', analysis: 'a', choreography: 'eq-choreography@1', safety: 'transition-safety@1'},
    from: {id: 'song-a', sha256: 'aa', bpm: 124, exitFrame: 480000, exitBar: 33},
    to: {id: 'song-b', sha256: 'bb', bpm: 126, entryFrame: 96000, entrySeconds: 2, skippedFraction: 0.01, entryRank: 0},
    sampleRate: 48000, tempo: {gap: 126 / 124 - 1, band: 'normal', meetBpm: null}, recipe: 'blend', choreography,
    overlapBars: 16, why: ['test'], rejected: [], ...overrides});
}
const at = (minute: number): string => `2026-11-16T10:${String(minute).padStart(2, '0')}:00.000Z`;
function fb(overrides: {plan?: TransitionPlanRecord; rating?: 'love' | 'like' | 'ok' | 'dislike'; tags?: string[]; note?: string; device?: 'pc' | 'phone'; at?: string;
  measured?: {status: 'pass' | 'warn' | 'fail' | 'unavailable'; reason: string; fallbackAfterFailedChecks: number | null} | null} = {}): TransitionFeedback {
  return makeTransitionFeedback({plan: overrides.plan ?? plan(), rating: overrides.rating ?? 'like', tags: overrides.tags ?? [], note: overrides.note ?? '',
    device: overrides.device ?? 'pc', at: overrides.at ?? at(0), measured: overrides.measured ?? null});
}

test('the feedback schema embeds the plan unchanged, sanitizes text and refuses anything unknown', () => {
  const p = plan();
  const entry = fb({plan: p, rating: 'ok', tags: ['too-abrupt', 'great-blend', 'too-abrupt'], note: '  nice\u0000 ending\u0007  ', device: 'phone',
    measured: {status: 'warn', reason: 'x'.repeat(500), fallbackAfterFailedChecks: 2}});
  assert.equal(entry.version, TRANSITION_FEEDBACK);
  assert.deepEqual(entry.plan, p, 'the plan record is embedded unchanged');
  assert.equal(entry.planId, p.id);
  assert.deepEqual(entry.tags, ['too-abrupt', 'great-blend'], 'tags are unique and known');
  assert.equal(entry.note, 'nice  ending', 'control characters become spaces and ends are trimmed');
  assert.equal(entry.measured!.reason.length, 240);
  assert.equal(parseTransitionFeedback(JSON.parse(JSON.stringify(entry))).planId, p.id, 'round trip');
  assert.equal(fb({note: 'n'.repeat(1000)}).note.length, FEEDBACK_NOTE_MAX, 'long notes are capped');
  const raw = JSON.parse(JSON.stringify(entry)) as Record<string, unknown>;
  for (const [label, mutated] of Object.entries({
    'unknown field': {...raw, extra: 1}, 'unknown rating': {...raw, rating: 'meh'}, 'unknown tag': {...raw, tags: ['nope']},
    'tags not an array': {...raw, tags: 'too-abrupt'}, 'unknown device': {...raw, device: 'watch'}, 'bad time': {...raw, at: 'yesterday'},
    'time without Z': {...raw, at: '2026-11-16T10:00:00'}, 'missing note': {...raw, note: undefined}, 'wrong version': {...raw, version: 'em.transition-feedback.v2'},
    'planId detached': {...raw, planId: plan({seed: 9}).id}, 'plan changed': {...raw, plan: {...p, recipe: 'cut'}},
    'extra plan field': {...raw, plan: {...p, absolutePath: 'C:/Users/me/song.wav'}},
    'measured extra': {...raw, measured: {status: 'pass', reason: '', fallbackAfterFailedChecks: null, extra: 1}},
    'measured status': {...raw, measured: {status: 'great', reason: '', fallbackAfterFailedChecks: null}},
    'measured count': {...raw, measured: {status: 'pass', reason: '', fallbackAfterFailedChecks: -1}},
    'not an object': 7, 'array': [],
  })) assert.throws(() => parseTransitionFeedback(mutated), /Invalid transition feedback/, label);
  assert.throws(() => parseTransitionFeedback({...raw, plan: {...p, why: ['x'.repeat(13_000)]}}), /Invalid transition feedback/, 'oversized plan');
});

test('older love/like/dislike ratings map onto the new schema and the latest rating per plan wins', () => {
  const a = plan(), b = plan({seed: 4, mode: 'explore'});
  let log = rateTransition(emptyTransitionRatings(), a, 'love', at(1));
  log = rateTransition(log, b, 'dislike', at(2));
  const migrated = feedbackFromLegacy(log);
  assert.deepEqual(migrated.map(e => [e.rating, e.device, e.tags.length, e.note]), [['love', 'pc', 0, ''], ['dislike', 'pc', 0, '']]);
  const history = [fb({plan: a, rating: 'love', at: at(1)}), fb({plan: b, rating: 'dislike', at: at(2)}), fb({plan: a, rating: 'ok', at: at(3)}),
    fb({plan: a, rating: 'dislike', at: at(2)})];
  const latest = latestPerPlan(history);
  assert.deepEqual(latest.map(e => [e.planId, e.rating]), [[b.id, 'dislike'], [a.id, 'ok']]);
  const text = history.map(e => JSON.stringify(e)).join('\n') + '\n{not json}\n{"version":"em.transition-feedback.v1"}\n';
  const parsed = parseFeedbackLines(text);
  assert.deepEqual([parsed.entries.length, parsed.lines, parsed.skipped], [4, 6, 2], 'bad lines are skipped and counted');
});

test('the rate command is an allowlist with known ratings and tags, a capped note and an optional plan id', () => {
  assert.deepEqual(parseControlCommand({command: 'rate', rating: 'love'}), {command: 'rate', rating: 'love', tags: []});
  assert.deepEqual(parseControlCommand({command: 'rate', rating: 'dislike', tags: ['bass-clash', 'too-long', 'bass-clash'], note: ' too  muddy\u0000 ', planId: 'tp-0123abcd'}),
    {command: 'rate', rating: 'dislike', tags: ['bass-clash', 'too-long'], note: 'too  muddy', planId: 'tp-0123abcd'});
  assert.deepEqual(parseControlCommand({command: 'rate', rating: 'ok', note: '   '}), {command: 'rate', rating: 'ok', tags: []}, 'a blank note is dropped');
  assert.equal(FEEDBACK_TAGS.length, 15);
  assert.ok(parseControlCommand({command: 'rate', rating: 'like', tags: [...FEEDBACK_TAGS]}));
  for (const bad of [{command: 'rate'}, {command: 'rate', rating: 'meh'}, {command: 'rate', rating: 7}, {command: 'rate', rating: 'love', tags: 'too-long'},
    {command: 'rate', rating: 'love', tags: ['unknown']}, {command: 'rate', rating: 'love', tags: [...FEEDBACK_TAGS, 'too-long']},
    {command: 'rate', rating: 'love', note: 'x'.repeat(FEEDBACK_NOTE_MAX + 1)}, {command: 'rate', rating: 'love', note: 5},
    {command: 'rate', rating: 'love', planId: 'tp-123'}, {command: 'rate', rating: 'love', planId: '../x'}, {command: 'rate', rating: 'love', plan: {}},
    {command: 'rate', rating: 'love', extra: 1}]) {
    assert.equal(parseControlCommand(bad), null, JSON.stringify(bad));
  }
  // The handover card may carry the plan id and rating, but only valid ones.
  const status = sanitizeDjStatus({transitionLast: {recipe: 'Bass swap', overlap: '', choreography: '', tempo: '', entry: '', fallback: '', planId: 'tp-0123abcd', rated: 'like', ratedSaved: true}});
  assert.deepEqual([status!.transitionLast!.planId, status!.transitionLast!.rated, status!.transitionLast!.ratedSaved], ['tp-0123abcd', 'like', true]);
  const dirty = sanitizeDjStatus({transitionLast: {recipe: 'x', overlap: '', choreography: '', tempo: '', entry: '', fallback: '', planId: '../../x', rated: 'amazing', ratedSaved: true}});
  assert.equal('planId' in dirty!.transitionLast!, false);
  assert.equal('rated' in dirty!.transitionLast!, false);
  assert.equal('ratedSaved' in dirty!.transitionLast!, false);
});

// ---------------------------------------------------------------------------------------------
// Relay endpoints
// ---------------------------------------------------------------------------------------------
interface HttpResult {status: number | undefined; headers: IncomingHttpHeaders; body: Buffer}
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
const djHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({origin: DJ, 'x-relay-token': TOKEN, 'content-type': 'application/json', ...extra});
const post = (port: number, body: unknown, headers = djHeaders()): Promise<HttpResult> =>
  http(port, '/api/dj/rating', {method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body)});
const json = (result: HttpResult): Record<string, unknown> => JSON.parse(result.body.toString('utf8')) as Record<string, unknown>;

async function relay(t: TestContext): Promise<{relay: PhoneRelay; port: number; root: string; file: string}> {
  const root = await mkdtemp(join(tmpdir(), 'eutonos feedback '));
  await writeFile(join(root, 'package.json'), '{"private":true}');
  const encoder = (): EncoderProcess => { const stdin = new PassThrough(), stdout = new PassThrough(); return {stdin, stdout, kill: () => undefined, on: () => undefined}; };
  const created = createPhoneRelay({root, feedbackRoot: root, token: TOKEN, spawnEncoder: encoder});
  t.after(async () => { await created.close(); await rm(root, {recursive: true, force: true}); });
  created.server.listen(0, '127.0.0.1');
  await once(created.server, 'listening');
  const address = created.server.address();
  assert.ok(address && typeof address !== 'string');
  return {relay: created, port: address.port, root, file: join(root, 'local', 'transition-ratings', 'ratings.jsonl')};
}

test('POST /api/dj/rating needs the DJ origin, the token and the DJ guard, like the other DJ endpoints', async t => {
  const {port, file} = await relay(t);
  const body = fb();
  assert.equal((await post(port, body, {'content-type': 'application/json'})).status, 403, 'no Origin');
  assert.equal((await post(port, body, djHeaders({origin: 'https://pc.tail1.ts.net'}))).status, 403, 'phone Origin');
  assert.equal((await post(port, body, djHeaders({origin: 'http://127.0.0.1:9999'}))).status, 403, 'other local Origin');
  assert.equal((await post(port, body, djHeaders({host: 'pc.tail1.ts.net'}))).status, 403, 'tailnet Host');
  assert.equal((await post(port, body, djHeaders({'x-forwarded-for': '100.64.0.2'}))).status, 403, 'proxied');
  const {'x-relay-token': _omit, ...noToken} = djHeaders();
  assert.equal((await post(port, body, noToken)).status, 401, 'no token');
  assert.equal((await post(port, body, djHeaders({'x-relay-token': 'f'.repeat(32)}))).status, 401, 'wrong token');
  assert.equal((await http(port, '/api/dj/rating?token=' + TOKEN, {method: 'POST', headers: noToken, body: JSON.stringify(body)})).status, 401, 'no query token');
  assert.equal((await http(port, '/api/dj/ratings', {headers: noToken})).status, 401, 'GET needs the token too');
  assert.equal((await http(port, '/api/dj/ratings', {headers: {origin: 'https://pc.tail1.ts.net', 'x-relay-token': TOKEN}})).status, 403);
  await assert.rejects(stat(file), /ENOENT/, 'no refused request created the file');
  assert.equal((await post(port, body)).status, 200);
  assert.equal((await http(port, '/api/dj/rating', {headers: djHeaders()})).status, 405, 'rating is POST only');
  assert.equal((await http(port, '/api/dj/ratings', {method: 'POST', headers: djHeaders(), body: '{}'})).status, 405, 'ratings is GET only');
  const preflight = await http(port, '/api/dj/rating', {method: 'OPTIONS', headers: djHeaders({'access-control-request-method': 'POST'})});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], DJ);
});

test('the relay validates and sanitizes each rating, appends one JSON line, never rewrites and reads the latest back', async t => {
  const {port, file} = await relay(t);
  const a = plan(), b = plan({seed: 3, mode: 'explore'});
  const first = fb({plan: a, rating: 'love', tags: ['great-blend'], note: 'lovely', device: 'phone', at: at(1)});
  const accepted = await post(port, first);
  assert.equal(accepted.status, 200);
  assert.deepEqual(json(accepted), {ok: true, duplicate: false, lines: 1});
  assert.equal(json(await post(port, first)).duplicate, true, 'the same plan and time is not written twice');
  assert.equal((await post(port, fb({plan: b, rating: 'dislike', tags: ['bass-clash', 'too-long'], at: at(2)}))).status, 200);
  const before = await readFile(file, 'utf8');
  assert.equal(before.split('\n').filter(Boolean).length, 2);
  assert.equal(await readFile(file, 'utf8'), before + '', 'unchanged');
  assert.equal((await post(port, fb({plan: a, rating: 'ok', at: at(3)}))).status, 200, 're-rating appends a line');
  const after = await readFile(file, 'utf8');
  assert.ok(after.startsWith(before), 'append-only: earlier lines are untouched');
  assert.equal(after.split('\n').filter(Boolean).length, 3);
  const read = json(await http(port, '/api/dj/ratings', {headers: djHeaders()}));
  assert.equal(read.version, 'em.transition-feedback-log.v1');
  assert.deepEqual([read.lines, read.skipped], [3, 0]);
  const entries = read.entries as TransitionFeedback[];
  assert.deepEqual(entries.map(e => [e.planId, e.rating]), [[b.id, 'dislike'], [a.id, 'ok']], 'latest per plan');
  entries.forEach(e => parseTransitionFeedback(e));
  // Sanitisation happens on the way in: a dirty note is stored cleaned and capped, never raw.
  const dirty = {...JSON.parse(JSON.stringify(fb({plan: plan({seed: 11}), at: at(4)}))) as Record<string, unknown>, note: `a\u0000b${'z'.repeat(400)}`};
  assert.equal((await post(port, dirty)).status, 200);
  const stored = (await readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as TransitionFeedback).at(-1)!;
  assert.equal(stored.note.length, FEEDBACK_NOTE_MAX);
  assert.ok(!stored.note.includes('\u0000'));
  const text = await readFile(file, 'utf8');
  assert.ok(!/[A-Za-z]:[\\/]/.test(text), 'no absolute paths in the file');
});

test('the relay refuses unknown fields, bad enums, detached plans, bad JSON and oversize bodies without writing', async t => {
  const {port, file} = await relay(t);
  const good = JSON.parse(JSON.stringify(fb())) as Record<string, unknown>;
  for (const [label, body] of Object.entries({
    'unknown field': {...good, extra: 'x'}, 'unknown rating': {...good, rating: 'meh'}, 'unknown tag': {...good, tags: ['nope']},
    'plan mismatch': {...good, planId: plan({seed: 1}).id}, 'wrong version': {...good, version: 'v2'}, 'array': [good], 'string': 'hello',
  })) {
    const result = await post(port, body);
    assert.equal(result.status, 400, label);
    assert.ok(['invalid-feedback', 'invalid-json'].includes(json(result).error as string), label);
  }
  assert.equal((await post(port, '{not json')).status, 400);
  assert.equal((await post(port, 'x'.repeat(LIMITS.ratingBytes + 1))).status, 413, 'body cap');
  assert.equal((await post(port, {...good, note: 'n'.repeat(LIMITS.ratingBytes)})).status, 413);
  await assert.rejects(stat(file), /ENOENT/, 'nothing was written');
  // A plan whose record is big but valid still fits one line; one that exceeds the line cap is refused.
  const big = plan({why: Array.from({length: 40}, (_, i) => `reason ${i} ${'y'.repeat(250)}`)});
  assert.ok(JSON.stringify(big).length < 12_000 && JSON.stringify(big).length > FEEDBACK_FILE_LIMITS.maxLineBytes - 6_000);
  assert.equal((await post(port, fb({plan: big}))).status, 200);
});

test('the ratings file has a size cap and refuses symlinks and junctions', async t => {
  const store = await mkdtemp(join(tmpdir(), 'eutonos feedback files '));
  t.after(async () => { await rm(store, {recursive: true, force: true}); });
  // Size cap.
  const small = new FeedbackFile(join(store, 'cap'));
  await mkdir(join(store, 'cap', 'local', 'transition-ratings'), {recursive: true});
  await writeFile(small.path, 'x'.repeat(FEEDBACK_FILE_LIMITS.maxFileBytes - 10));
  await assert.rejects(small.append(fb()), (error: unknown) => error instanceof FeedbackFileError && error.code === 'full');
  assert.equal((await readFile(small.path, 'utf8')).length, FEEDBACK_FILE_LIMITS.maxFileBytes - 10, 'a refused append changed nothing');
  // A symlinked ratings file is never written through.
  const linked = new FeedbackFile(join(store, 'link'));
  await mkdir(join(store, 'link', 'local', 'transition-ratings'), {recursive: true});
  const target = join(store, 'elsewhere.txt');
  await writeFile(target, 'untouched');
  let canLink = true;
  try { await symlink(target, linked.path, 'file'); } catch { canLink = false; }
  if (canLink) {
    await assert.rejects(linked.append(fb()), (error: unknown) => error instanceof FeedbackFileError && error.code === 'unsafe');
    await assert.rejects(linked.read(), (error: unknown) => error instanceof FeedbackFileError && error.code === 'unsafe');
    assert.equal(await readFile(target, 'utf8'), 'untouched', 'nothing was written through the symlink');
  } else t.diagnostic('file symlinks need privilege here: file-symlink refusal NOT exercised');
  // A symlinked or junctioned directory is refused (a junction needs no privilege on Windows).
  const outside = join(store, 'outside');
  await mkdir(outside);
  await mkdir(join(store, 'dirlink'));
  let canDirLink = true;
  try { await symlink(outside, join(store, 'dirlink', 'local'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { canDirLink = false; }
  if (canDirLink) {
    await assert.rejects(new FeedbackFile(join(store, 'dirlink')).append(fb()), (error: unknown) => error instanceof FeedbackFileError && error.code === 'unsafe');
    await assert.rejects(stat(join(outside, 'transition-ratings')), /ENOENT/, 'nothing was created through the directory link');
  } else t.diagnostic('directory links are unavailable here: directory-link refusal NOT exercised');
});

test('through the relay a symlinked ratings file is refused with a 409 and nothing leaks', async t => {
  const {port, root, file} = await relay(t);
  await mkdir(join(root, 'local', 'transition-ratings'), {recursive: true});
  const target = join(root, 'target.txt');
  await writeFile(target, 'untouched');
  try { await symlink(target, file, 'file'); } catch { t.diagnostic('file symlinks need privilege here: NOT exercised'); return; }
  const result = await post(port, fb());
  assert.equal(result.status, 409);
  assert.equal(json(result).error, 'ratings-unsafe');
  assert.ok(!result.body.toString('utf8').includes(root), 'no filesystem path in the error');
  assert.equal(await readFile(target, 'utf8'), 'untouched');
});

// ---------------------------------------------------------------------------------------------
// Browser store: queue, flush, sync, dedupe, legacy migration
// ---------------------------------------------------------------------------------------------
function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {data: Map<string, string>} {
  const data = new Map(Object.entries(initial));
  return {data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }};
}

test('the store queues while the relay is down, flushes later without duplicates and treats the file as the source of truth', async t => {
  const {port} = await relay(t);
  const origin = `http://127.0.0.1:${port}`;
  // Node's fetch may not set Origin, so route through the test's http helper with the DJ origin.
  let down = true;
  const calls: string[] = [];
  const relayFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url.replace(origin, '')}`);
    if (down) throw new TypeError('connection refused');
    const result = await http(port, url.replace(origin, ''), {method: init?.method ?? 'GET', headers: {origin: DJ, ...init?.headers as Record<string, string>},
      ...(typeof init?.body === 'string' ? {body: init.body} : {})});
    return new Response(new Uint8Array(result.body), {status: result.status ?? 500});
  }) as typeof fetch;
  const storage = memoryStorage();
  const store = new FeedbackStore({relay: origin, token: TOKEN, storage, fetch: relayFetch});
  const p = plan();
  assert.equal(await store.rate(fb({plan: p, rating: 'love', at: at(1)})), 'queued', 'the relay is down: queued, not saved');
  assert.equal(store.isSaved(p.id), false);
  assert.equal(store.pendingCount, 1);
  assert.match(store.lastProblem, /stays queued/);
  assert.equal(await store.rate(fb({plan: p, rating: 'dislike', tags: ['too-abrupt'], at: at(2)})), 'queued');
  assert.equal(store.pendingCount, 1, 're-rating the same plan replaces the queued rating');
  // A reloaded page (new store, same storage) still has the queue.
  const reloaded = new FeedbackStore({relay: origin, token: TOKEN, storage, fetch: relayFetch});
  assert.equal(reloaded.pendingCount, 1);
  assert.equal(reloaded.get(p.id)!.rating, 'dislike');
  down = false;
  await reloaded.tick();
  assert.equal(reloaded.pendingCount, 0);
  assert.equal(reloaded.isSaved(p.id), true);
  await reloaded.flush();
  assert.equal(calls.filter(c => c.startsWith('POST')).length, 3, 'two failed attempts, one accepted, and no resend after it was accepted');
  const file = new FeedbackFile((await relayRoot(port)) ?? '');
  void file;
  const read = json(await http(port, '/api/dj/ratings', {headers: djHeaders()}));
  assert.deepEqual((read.entries as TransitionFeedback[]).map(e => [e.rating, e.tags, e.device]), [['dislike', ['too-abrupt'], 'pc']]);
  // Another page (empty cache) learns the rating from the file.
  const other = new FeedbackStore({relay: origin, token: TOKEN, storage: memoryStorage(), fetch: relayFetch});
  assert.equal(other.get(p.id), undefined);
  await other.sync();
  assert.equal(other.get(p.id)!.rating, 'dislike');
  assert.equal(other.isSaved(p.id), true);
  // A newer queued rating is not overwritten by an older one from the file.
  down = true;
  await other.rate(fb({plan: p, rating: 'love', at: at(9)}));
  down = false;
  await other.sync();
  assert.equal(other.get(p.id)!.rating, 'love', 'the newer local rating wins until it is flushed');
  await other.flush();
  assert.equal(other.isSaved(p.id), true);
  assert.equal((json(await http(port, '/api/dj/ratings', {headers: djHeaders()})).entries as TransitionFeedback[])[0]!.rating, 'love');
});
async function relayRoot(_port: number): Promise<string | null> { return null; }

test('without a relay the store is browser-only, and an older ratings log is migrated and queued', async () => {
  const p = plan();
  const legacy = rateTransition(emptyTransitionRatings(), p, 'like', at(1));
  const storage = memoryStorage({[LEGACY_RATINGS_KEY]: JSON.stringify(legacy)});
  const local = new FeedbackStore({relay: null, token: null, storage});
  assert.equal(local.relayReady, false);
  assert.equal(local.get(p.id)!.rating, 'like', 'legacy ratings are carried over');
  assert.equal(storage.data.get(LEGACY_RATINGS_KEY), JSON.stringify(legacy), 'the legacy log is left in place');
  assert.equal(await local.rate(fb({plan: plan({seed: 2}), at: at(2)})), 'local');
  assert.equal(local.all().length, 2);
  const cache = JSON.parse(storage.data.get(FEEDBACK_CACHE_KEY)!) as {entries: unknown[]; pending: string[]};
  assert.equal(cache.entries.length, 2);
  // Corrupt cache entries are dropped, never trusted.
  const bad = memoryStorage({[FEEDBACK_CACHE_KEY]: JSON.stringify({version: 'em.transition-feedback-cache.v1', entries: [{rating: 'love'}, JSON.parse(JSON.stringify(fb()))], pending: [], legacyMigrated: true})});
  assert.equal(new FeedbackStore({relay: null, token: null, storage: bad}).all().length, 1);
  // Storage that throws must not break rating.
  const broken = {getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }};
  assert.equal(await new FeedbackStore({relay: null, token: null, storage: broken}).rate(fb()), 'local');
});

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------
test('the report counts by recipe, band, choreography, entry, fallback and mode, and says when the sample is too small', () => {
  const precheckFail = {status: 'fail' as const, reason: 'low build-up', fallbackAfterFailedChecks: 2};
  const entries = [
    fb({plan: plan({seed: 1}), rating: 'love', tags: ['great-blend'], at: at(1)}),
    fb({plan: plan({seed: 2}), rating: 'like', at: at(2)}),
    fb({plan: plan({seed: 3, recipe: 'cut', choreography: null, overlapBars: null, tempo: {gap: 0.3, band: 'reset', meetBpm: null}, rejected: [{recipe: 'blend', reason: 'x'}]}),
      rating: 'dislike', tags: ['too-abrupt', 'volume-jump', 'great-surprise'], measured: precheckFail, at: at(3)}),
    fb({plan: plan({seed: 4, mode: 'explore', choreography: {name: 'bass-drop-handover', overlapBars: 16, swapMs: 300, gapBars: 2}, to: {id: 'song-b', sha256: 'bb', bpm: 126, entryFrame: 96000,
      entrySeconds: 90, skippedFraction: 0.6, entryRank: 1}}), rating: 'dislike', tags: ['bass-clash', 'too-abrupt'], note: 'muddy', device: 'phone', at: at(4)}),
    fb({plan: plan({seed: 4, mode: 'explore', choreography: {name: 'bass-drop-handover', overlapBars: 16, swapMs: 300, gapBars: 2}, to: {id: 'song-b', sha256: 'bb', bpm: 126, entryFrame: 96000,
      entrySeconds: 90, skippedFraction: 0.6, entryRank: 1}}), rating: 'ok', at: at(5)}),
  ];
  const report = buildReport(entries, {lines: 5, skipped: 0});
  assert.equal(report.ratedPlans, 4, 'the later rating of the same plan replaces the earlier one');
  assert.equal(report.replacedRatings, 1);
  assert.deepEqual(report.byRating, {love: 1, like: 1, ok: 1, dislike: 1});
  assert.equal(report.enoughData, false);
  assert.match(report.verdict, new RegExp(`Too few ratings \\(4 rated plans; at least ${MIN_TOTAL}`));
  const rows = (name: string) => Object.fromEntries((report.groups[name] ?? []).map(r => [r.key, r.n]));
  assert.deepEqual(rows('recipe'), {blend: 3, cut: 1});
  assert.deepEqual(rows('tempo-gap band'), {normal: 3, reset: 1});
  assert.deepEqual(rows('explore vs auto'), {auto: 3, explore: 1});
  assert.deepEqual(rows('fallback after failed pre-check'), {no: 3, 'yes: reached after failed pre-check(s)': 1});
  assert.equal(rows('skipped fraction (where B enters)')['enters 50%+ in'], 1);
  assert.equal(rows('choreography')['bass-drop-handover'], 1);
  assert.equal(rows('choreography')['none (recipe uses its own automation)'], 1);
  assert.deepEqual(rows('rated on'), {pc: 4}, 'the phone rating was replaced by the later PC one');
  const cutRow = report.groups.recipe!.find(r => r.key === 'cut')!;
  assert.deepEqual([cutRow.n, cutRow.counts.dislike, cutRow.dislikedShare, cutRow.tooSmall], [1, 1, 1, true]);
  assert.ok(report.groups.recipe!.every(r => r.n >= MIN_GROUP || r.tooSmall));
  // Complaint tags only; positive tags are not complaints.
  assert.deepEqual(report.negativeTagsByRecipe.cut!.map(t => [t.tag, t.count]), [['too-abrupt', 1], ['volume-jump', 1]]);
  assert.deepEqual(report.negativeTagsByRecipe.blend ?? [], [], 'the later tag-less rating replaced the one with complaints');
  assert.deepEqual(report.best.map(b => b.rating), ['love', 'like']);
  assert.deepEqual(report.worst.map(w => w.rating), ['dislike', 'ok']);
  assert.equal(report.worst[0]!.recipe, 'cut');
  assert.equal(report.worst[0]!.fallbackAfterFailedChecks, 2);
  const text = formatReport(report);
  assert.match(text, /Too few ratings \(4 rated plans/);
  assert.match(text, /\[too small to read\]/);
  assert.match(text, /no significance test is run/i);
  assert.equal(skippedBucket(0.05), 'enters in the first 10%');
  assert.equal(skippedBucket(0.3), 'enters 25-50% in');
  const empty = buildReport([], {lines: 0, skipped: 0});
  assert.equal(empty.ratedPlans, 0);
  assert.match(formatReport(empty), /No ratings yet/);
  // Enough data changes the wording but still claims no significance.
  const many = Array.from({length: MIN_TOTAL}, (_, i) => fb({plan: plan({seed: 100 + i}), rating: i % 2 ? 'like' : 'dislike', at: at(i)}));
  const enough = buildReport(many, {lines: many.length, skipped: 0});
  assert.equal(enough.enoughData, true);
  assert.match(enough.verdict, /descriptive/);
  assert.match(enough.verdict, /no significance is computed/);
});
