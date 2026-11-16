/**
 * S17 browser check: the real DJ page streams to an isolated phone relay and obeys phone
 * commands. Uses real ffmpeg when it can encode MP3, otherwise an echoing fake encoder (the
 * report says which). Headless Chromium output is not physical output or listening.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {request, type IncomingMessage} from 'node:http';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type Page} from 'playwright';
import {createDemoServer} from './serve.js';
import {AUTOPLAY_FLAG} from './phone-host.js';
import {createPhoneRelay, djPageUrl, ffmpegEncoder, type EncoderProcess, type PhoneRelay, type SpawnEncoder} from './phone-relay.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = new URL('../../artifacts/s17-phone/', import.meta.url);
await mkdir(output, {recursive: true});

function realEncoderAvailable(): boolean {
  try { return /\blibmp3lame\b/.test(execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {encoding: 'utf8', windowsHide: true, maxBuffer: 8 << 20})); }
  catch { return false; }
}
function fakeEncoder(): EncoderProcess {
  const stdin = new PassThrough(), stdout = new PassThrough();
  stdin.pipe(stdout);
  return {stdin, stdout, kill: () => { stdin.unpipe(stdout); stdout.end(); }, on: () => undefined};
}
const real = realEncoderAvailable();
const spawnEncoder: SpawnEncoder = real ? ffmpegEncoder('ffmpeg') : fakeEncoder;

const demo = createDemoServer(root);
let relay: PhoneRelay | undefined;
let browser: Browser | undefined;
let page: Page | undefined;
let stage = 'Start demo server, relay and browser';
const checks: {name: string; status: string}[] = [];
const errors: string[] = [];
let listener: IncomingMessage | undefined;
let listenerBytes = Buffer.alloc(0);

async function listen(server: import('node:http').Server): Promise<number> {
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}
async function waitText(target: Page, selector: string, expected: RegExp, timeout = 10_000): Promise<void> {
  await target.waitForFunction(({selector, source, flags}) =>
    new RegExp(source, flags).test(document.querySelector(selector)?.textContent ?? ''),
  {selector, source: expected.source, flags: expected.flags}, {timeout});
}
async function until(check: () => boolean, label: string, timeout = 10_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
function phoneCommand(port: number, body: unknown): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const outgoing = request({hostname: '127.0.0.1', port, path: '/api/control', method: 'POST',
      headers: {'content-type': 'application/json'}}, incoming => { incoming.resume(); incoming.on('end', () => { resolve(incoming.statusCode); }); });
    outgoing.on('error', reject);
    outgoing.end(JSON.stringify(body));
  });
}

try {
  const demoPort = await listen(demo);
  const origin = `http://127.0.0.1:${demoPort}`;
  relay = createPhoneRelay({spawnEncoder, djOrigins: [origin]});
  const relayPort = await listen(relay.server);
  const relayOrigin = `http://127.0.0.1:${relayPort}`;
  const running = relay;
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({viewport: {width: 1280, height: 1000}});
  context.setDefaultTimeout(10_000);
  page = await context.newPage();
  page.on('pageerror', error => errors.push(`dj: ${error.message}`));
  checks.push({name: stage, status: 'PASS'});

  stage = 'Without the relay token streaming refuses and explains how to get it';
  const tokenless = await context.newPage();
  tokenless.on('pageerror', error => errors.push(`tokenless: ${error.message}`));
  await tokenless.goto(`${origin}/?relay=${encodeURIComponent(relayOrigin)}`);
  await tokenless.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#phone-stream')!.disabled);
  await tokenless.locator('#phone-stream').click();
  await waitText(tokenless, '#phone-stream-error', /No valid relay token\. Open the DJ address that `npm run phone` printed/);
  assert.equal(await tokenless.locator('#phone-stream').getAttribute('aria-pressed'), 'false');
  assert.equal(running.status().dj.connected, false);
  await tokenless.close();
  checks.push({name: stage, status: 'PASS'});

  stage = 'Streaming is off by default, the DJ page loads normally and the token leaves the address bar';
  await page.goto(djPageUrl(origin, relayPort, running.token));
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#play')!.disabled);
  assert.equal(await page.evaluate(() => location.hash), '', 'token fragment removed');
  assert.ok(!page.url().includes(running.token), 'token not left in the URL');
  assert.equal(await page.locator('#phone-stream').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#phone-stream-state').innerText(), 'Off');
  assert.equal(running.status().dj.connected, false);
  checks.push({name: stage, status: 'PASS'});

  stage = 'Stream to phone connects control events and sends ordered MediaRecorder chunks after Play';
  await new Promise<void>((resolve, reject) => {
    const outgoing = request({hostname: '127.0.0.1', port: relayPort, path: '/live.mp3'}, incoming => {
      listener = incoming;
      incoming.on('data', (chunk: Buffer) => { listenerBytes = Buffer.concat([listenerBytes, chunk]); });
      incoming.on('error', () => undefined);
      resolve();
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
  await page.locator('#phone-stream').click();
  await waitText(page, '#phone-stream-state', /control connected/);
  await until(() => running.status().dj.connected, 'DJ control connection');
  await page.locator('#play').click();
  await waitText(page, '#now-title', /^S01 A/);
  await until(() => running.status().stream.chunksIn >= 8, 'eight ingested chunks');
  await waitText(page, '#phone-stream-state', /recorder recording · ([89]|\d{2,}) chunks sent/);
  await until(() => listenerBytes.length > (real ? 8000 : 1000), 'bytes at the phone listener', 15_000);
  if (real) {
    const sync = listenerBytes.findIndex((value, index) => value === 0xff && ((listenerBytes[index + 1] ?? 0) & 0xfe) === 0xfa);
    assert.ok(sync >= 0, 'MP3 frame header from real ffmpeg');
  } else {
    assert.equal(listenerBytes.readUInt32BE(0), 0x1a45dfa3, 'fake encoder echoes the WebM header first');
  }
  assert.equal(running.status().stream.sessions, 1);
  assert.equal(running.status().stream.lastError, null);
  checks.push({name: stage, status: 'PASS'});

  stage = 'A second DJ tab is refused and cannot replace the streaming session';
  const second = await context.newPage();
  second.on('pageerror', error => errors.push(`second: ${error.message}`));
  await second.goto(djPageUrl(origin, relayPort, running.token));
  await second.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#phone-stream')!.disabled);
  await second.locator('#phone-stream').click();
  await waitText(second, '#phone-stream-error', /Another DJ tab is streaming to the phone/);
  await waitText(second, '#phone-stream-state', /control refused · recorder waiting · 0 chunks sent/);
  const chunksBefore = running.status().stream.chunksIn;
  await until(() => running.status().stream.chunksIn > chunksBefore + 2, 'first tab keeps streaming');
  assert.equal(running.status().stream.sessions, 1, 'the second tab started no audio session');
  await second.locator('#phone-stream').click();
  await second.close();
  checks.push({name: stage, status: 'PASS'});

  stage = 'DJ status reaches the phone page and phone commands use the DJ page controls';
  await until(() => /^S01 A/.test(running.status().dj.status?.now ?? ''), 'DJ status at relay');
  const phone = await context.newPage();
  phone.on('pageerror', error => errors.push(`phone: ${error.message}`));
  await phone.setViewportSize({width: 390, height: 844});
  await phone.goto(`${relayOrigin}/`);
  await waitText(phone, '#now', /^S01 A/);
  await waitText(phone, '#connection', /DJ connected · streaming/);
  await phone.waitForFunction(() => !document.querySelector<HTMLButtonElement>('#next-song')!.disabled);
  // Simplified main view: one big Play/Pause, Next-up, no separate Listen or DJ Play/Stop buttons.
  assert.equal(await phone.locator('#play').count(), 1);
  assert.equal(await phone.locator('#listen, #dj-play, #dj-stop').count(), 0, 'no Listen / Play (DJ) / Stop (DJ) buttons');
  await waitText(phone, '#play', /^Pause$/);
  await waitText(phone, '#next', /\S/);
  assert.equal(await phone.locator('#hold').isVisible(), false, 'Hold stays behind More');
  assert.equal(await phone.locator('#handoff').isVisible(), false, 'Handoff stays behind More');
  assert.equal(await phone.locator('#picker').isVisible(), false, 'an older DJ page has no queue: no picker');
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone layout overflows');
  await phone.screenshot({path: fileURLToPath(new URL('phone.png', output)), fullPage: true});
  assert.equal(await phoneCommand(relayPort, {command: 'next'}), 202);
  await waitText(page, '#phone-stream-detail', /#1 next: pressed Next Song/);
  await waitText(page, '#next-title', /^S01 B/);
  await waitText(phone, '#next', /^S01 B/);
  await phone.locator('#more summary').click();
  await phone.locator('#hold').click();
  await page.waitForFunction(() => document.getElementById('hold')?.getAttribute('aria-pressed') === 'true');
  await phone.waitForFunction(() => document.getElementById('hold')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await phoneCommand(relayPort, {command: 'hold', enabled: true}), 202);
  await waitText(page, '#phone-stream-detail', /hold: Hold already on/);
  assert.equal(await phoneCommand(relayPort, {command: 'handoff', mode: 'hybrid'}), 202);
  await page.waitForFunction(() => document.querySelector<HTMLSelectElement>('#handoff')!.value === 'hybrid');
  assert.equal(await phoneCommand(relayPort, {command: 'play'}), 202);
  await waitText(page, '#phone-stream-detail', /play: ignored: Play is not available now/);
  assert.equal(await phoneCommand(relayPort, {command: 'rm'}), 400);
  await page.screenshot({path: fileURLToPath(new URL('dj-streaming.png', output)), fullPage: true});
  checks.push({name: stage, status: 'PASS'});

  stage = 'Phone Stop and Play reach the DJ; turning streaming off tears down cleanly while playback continues';
  assert.equal(await phoneCommand(relayPort, {command: 'stop'}), 202);
  await waitText(page, '#now-title', /^Nothing playing$/);
  await waitText(phone, '#play', /^Play$/);
  await phone.locator('#play').click();
  await waitText(page, '#now-title', /^S01/);
  await waitText(phone, '#play', /^(Pause|Starting…)$/);
  await phone.locator('#play').click();
  await waitText(page, '#now-title', /^Nothing playing$/);
  await waitText(phone, '#play', /^Play$/);
  assert.equal(await phoneCommand(relayPort, {command: 'play'}), 202);
  await waitText(page, '#now-title', /^S01/);
  await page.locator('#phone-stream').click();
  assert.equal(await page.locator('#phone-stream-state').innerText(), 'Off');
  await until(() => !running.status().dj.connected && !running.status().stream.ingesting, 'relay saw the teardown');
  await waitText(page, '#now-detail', /^(scheduled|playing) ·/);
  checks.push({name: stage, status: 'PASS'});

  stage = 'The phone page renders next-up, the queue picker and the handover card, and set-next posts an allowlisted command';
  const mock = await context.newPage();
  mock.on('pageerror', error => errors.push(`mock phone: ${error.message}`));
  await mock.setViewportSize({width: 390, height: 844});
  const fakeStatus = {dj: {connected: true, ageMs: 10, status: {state: 'playing', now: 'Song One', next: 'Song Two', detail: '', status: '', requested: '', execution: '',
    lastCommand: '', hold: false, handoff: 'mix', canPlay: false, canStop: true, canNext: true, canHold: true, canHandoff: false, auto: false, canAuto: true,
    queue: [{id: 'song-two', title: 'Song Two'}, {id: 'song-three', title: 'Song Three'}, {id: 'song-four', title: 'Song Four'}],
    nextStatus: 'Ready — handover prepared', canSetNext: true,
    transitionNext: {recipe: 'Bass swap', overlap: '8 bars', choreography: 'bass-swap-classic', tempo: '+1.0%', entry: 'enters at 1:12', fallback: ''},
    transitionLast: {recipe: 'Clean cut (last resort)', overlap: '', choreography: '', tempo: '0.0%', entry: 'enters at 0:00', fallback: 'Fallback after 2 failed pre-check(s)'}}},
  stream: {ingesting: true, listeners: 0, encoder: 'running', chunksIn: 1, bytesOut: 1, sessions: 1, lastError: null}, delayNote: 'about 2-5 seconds'};
  await mock.route('**/api/status', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(fakeStatus)}));
  await mock.route('**/live.mp3*', route => route.abort());
  const posted: unknown[] = [];
  await mock.route('**/api/control', route => { posted.push(route.request().postDataJSON()); return route.fulfill({status: 202, contentType: 'application/json', body: '{"ok":true}'}); });
  await mock.goto(`${relayOrigin}/`);
  await waitText(mock, '#next', /^Song Two$/);
  await waitText(mock, '#next-status', /handover prepared/);
  await waitText(mock, '#transition-next', /Planned: Bass swap · 8 bars overlap · tempo \+1\.0% · enters at 1:12/);
  await waitText(mock, '#transition-last', /Last: Clean cut \(last resort\).*Fallback after 2 failed pre-check/);
  await mock.locator('#picker summary').click();
  assert.deepEqual(await mock.locator('#picker-list button').allInnerTexts(), ['Song Two (next)', 'Song Three', 'Song Four']);
  await mock.locator('#picker-list button', {hasText: 'Song Four'}).click();
  await until(() => posted.some(body => JSON.stringify(body) === '{"command":"set-next","songId":"song-four"}'), 'set-next posted');
  assert.ok(await mock.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mock phone layout overflows');
  await mock.screenshot({path: fileURLToPath(new URL('phone-simple.png', output)), fullPage: true});
  await mock.close();
  checks.push({name: stage, status: 'PASS'});

  stage = 'Autoplay: the flag is what lets a remote Play start sound without a click on the PC';
  // Playwright's bundled Chromium ignores the autoplay switch and page.evaluate() itself counts as a
  // user gesture, so this stage uses real Edge (or Chrome) and observes only through init scripts,
  // console logs and the relay. It is skipped, and reported NOT TESTED, when neither is installed.
  const realBrowser = async (args: string[]): Promise<Browser | null> => {
    for (const channel of ['msedge', 'chrome']) {
      try { return await chromium.launch({channel, headless: true, args, ...(args.includes(AUTOPLAY_FLAG) ? {} : {ignoreDefaultArgs: ['--autoplay-policy=no-user-gesture-required']})}); } catch { /* try the next */ }
    }
    return null;
  };
  const probeLogs = async (args: string[]): Promise<string[] | null> => {
    const b = await realBrowser(args);
    if (!b) return null;
    try {
      const p = await (await b.newContext()).newPage();
      const logs: string[] = [];
      p.on('console', message => { logs.push(message.text()); });
      await p.addInitScript(() => {
        const c = new AudioContext(); c.resume().catch(() => undefined);
        setTimeout(() => console.log(`state ${c.state}`), 1500);
      });
      await p.goto(`${origin}/`);
      await until(() => logs.some(line => line.startsWith('state ')), 'probe state', 8000);
      return logs;
    } finally { await b.close(); }
  };
  let autoplay = 'NOT TESTED (no Edge or Chrome installed)';
  const without = await probeLogs(['--autoplay-policy=document-user-activation-required']);
  if (without) {
    assert.ok(without.includes('state suspended'), `without the flag the context stays suspended: ${without.join(' | ')}`);
    const flagged = await probeLogs([AUTOPLAY_FLAG]);
    assert.ok(flagged?.includes('state running'), `with the flag it starts without a gesture: ${flagged?.join(' | ')}`);
    const remotePlay = async (args: string[]): Promise<{logs: string[]; page: Page; close: () => Promise<void>}> => {
      const b = (await realBrowser(args))!;
      const p = await (await b.newContext()).newPage();
      const logs: string[] = [];
      p.on('console', message => { logs.push(message.text()); });
      p.on('pageerror', error => errors.push(`autoplay dj: ${error.message}`));
      // Page script, not Playwright: a programmatic click is not user activation, so nobody touched this page.
      await p.addInitScript(() => {
        const timer = setInterval(() => {
          const button = document.getElementById('phone-stream') as HTMLButtonElement | null;
          if (button && !button.disabled) { clearInterval(timer); button.click(); }
        }, 100);
        setInterval(() => { const gate = document.getElementById('gesture-gate'); if (gate && !gate.hidden) console.log('GATE-VISIBLE'); }, 200);
      });
      await p.goto(djPageUrl(origin, relayPort, running.token));
      await until(() => running.status().dj.connected, 'autoplay DJ control connection', 15_000);
      assert.equal(await phoneCommand(relayPort, {command: 'play'}), 202);
      return {logs, page: p, close: () => b.close()};
    };
    const allowed = await remotePlay([AUTOPLAY_FLAG]);
    await until(() => running.status().stream.chunksIn >= 4 && /^S01/.test(running.status().dj.status?.now ?? ''), 'a flagged window plays with no click', 15_000);
    assert.ok(!allowed.logs.includes('GATE-VISIBLE'), 'no click-here overlay with the flag');
    await allowed.close();
    await until(() => !running.status().dj.connected, 'flagged window gone');
    const blocked = await remotePlay(['--autoplay-policy=document-user-activation-required']);
    await until(() => running.status().dj.status?.state === 'needs-click', 'needs-click reported to the relay', 15_000);
    await until(() => blocked.logs.includes('GATE-VISIBLE'), 'click-here overlay shown on the PC page');
    const phoneNeeds = await context.newPage();
    await phoneNeeds.goto(`${relayOrigin}/`);
    await waitText(phoneNeeds, '#play-message', /Tap play on the PC page once/);
    await phoneNeeds.close();
    await blocked.page.locator('#gesture-gate-button').click();
    await until(() => /^S01/.test(running.status().dj.status?.now ?? '') && running.status().dj.status?.state !== 'needs-click', 'the pending Play proceeds after the click', 15_000);
    await blocked.close();
    await until(() => !running.status().dj.connected, 'blocked window gone');
    autoplay = "PASS";
  }
  checks.push({name: stage, status: autoplay.startsWith('PASS') ? 'PASS' : autoplay});

  stage = 'An unreachable relay shows an error and never affects playback';
  await running.close();
  relay = undefined;
  // The 24 s fixture may have ended while the earlier stages ran: make sure it is playing again.
  if (await page.locator('#play').isEnabled()) await page.locator('#play').click();
  await page.locator('#phone-stream').click();
  await waitText(page, '#phone-stream-error', /Relay unreachable|Relay refused/, 15_000);
  await waitText(page, '#now-detail', /^(scheduled|playing) ·/);
  const elapsed = async (): Promise<number> => Number(/· ([\d.]+)s \//.exec(await page!.locator('#now-detail').innerText())?.[1] ?? NaN);
  const before = await elapsed();
  await page.waitForTimeout(600);
  assert.ok(await elapsed() > before, 'the audio clock keeps advancing while the relay is down');
  await page.locator('#phone-stream').click();
  await page.locator('#stop').click();
  await waitText(page, '#now-title', /^Nothing playing$/);
  assert.deepEqual(errors, []);
  checks.push({name: stage, status: 'PASS'});

  const report = {platform: process.platform, node: process.version, browser: browser.version(),
    source: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    encoder: real ? 'real ffmpeg (libmp3lame)' : 'fake echo encoder (ffmpeg/libmp3lame unavailable)',
    checks, physicalOutput: 'NOT TESTED', listening: 'NOT TESTED', realPhone: 'NOT TESTED', backgroundTab: 'NOT TESTED'};
  await writeFile(new URL('phone-browser.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({path: fileURLToPath(new URL('failure.png', output)), fullPage: true, timeout: 5000}).catch(() => undefined);
  await writeFile(new URL('failure.json', output), JSON.stringify({stage, checks, errors,
    error: error instanceof Error ? error.stack ?? error.message : String(error)}, null, 2) + '\n').catch(() => undefined);
  throw error;
} finally {
  listener?.destroy();
  try { await browser?.close(); }
  finally {
    await relay?.close();
    if (demo.listening) {
      const closed = new Promise<void>(resolve => demo.close(() => resolve()));
      demo.closeAllConnections();
      await closed;
    }
  }
}
