/**
 * `npm run phone:host`: one command that makes the PC a hands-off phone host. It starts the
 * demo/file server and the phone relay (the same code `npm run demo` and `npm run phone` use),
 * then opens the Studio set page in a dedicated Edge (or Chrome) window started with the
 * documented `--autoplay-policy=no-user-gesture-required` flag and a throwaway profile, so a
 * phone's Play can start sound on the PC with no click on the PC. The relay token is passed in
 * the URL fragment automatically. It never touches the owner's real browser profile, and
 * it does not run `tailscale serve` (the phone address is printed for the owner to run).
 */
import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import type {Server} from 'node:http';
import {tmpdir} from 'node:os';
import {delimiter, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDemoServer} from './serve.js';
import {createPhoneRelay, DEFAULT_DJ_ORIGINS, DEFAULT_RELAY_PORT, ffmpegEncoder, studioSetPageUrl} from './phone-relay.js';

/** Chromium's documented switch: lets a page start audio without a user gesture on that page. */
export const AUTOPLAY_FLAG = '--autoplay-policy=no-user-gesture-required';
const DEMO_PORT = 4173;

/** Browser candidates in preference order: Edge first, then Chrome. */
export function browserCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env['ProgramFiles'], env['LOCALAPPDATA']].filter((value): value is string => !!value);
    return [...roots.map(root => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ...roots.map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'))];
  }
  if (platform === 'darwin') {
    return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  }
  const names = ['microsoft-edge', 'microsoft-edge-stable', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  return (env['PATH'] ?? '').split(delimiter).filter(Boolean).flatMap(dir => names.map(name => join(dir, name)));
}

export function findBrowser(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync): string | null {
  return browserCandidates(platform, env).find(exists) ?? null;
}

/** Arguments for the dedicated DJ window. `profile` must be a throwaway directory. */
export function browserArgs(url: string, profile: string, minimized: boolean): string[] {
  return [`--user-data-dir=${profile}`, AUTOPLAY_FLAG, `--app=${url}`, '--no-first-run', '--no-default-browser-check',
    // A hidden or covered window must keep its audio clock and timers running.
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(minimized ? ['--start-minimized'] : [])];
}

export interface HostOptions { browser: string | null; open: boolean; minimized: boolean; ffmpeg: string }
export function parseHostArgs(args: readonly string[]): HostOptions | string {
  const options: HostOptions = {browser: null, open: true, minimized: true, ffmpeg: 'ffmpeg'};
  for (let index = 0; index < args.length; index++) {
    const name = args[index], value = args[index + 1];
    if (name === '--no-browser') options.open = false;
    else if (name === '--visible') options.minimized = false;
    else if (name === '--browser' && value) { options.browser = value; index++; }
    else if (name === '--ffmpeg' && value) { options.ffmpeg = value; index++; }
    else return 'Usage: node dist/scripts/phone-host.js [--browser PATH] [--ffmpeg PATH] [--visible] [--no-browser]';
  }
  return options;
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address !== 'string') resolveListen(address.port); else reject(new Error('No listening address.'));
    });
  });
}

async function main(args: string[]): Promise<void> {
  const options = parseHostArgs(args);
  if (typeof options === 'string') { console.error(options); process.exitCode = 1; return; }
  const browser = options.browser ?? findBrowser();
  if (options.open && !browser) {
    console.error('No Edge or Chrome found. Pass --browser PATH, or use --no-browser and open the printed address in a browser started with');
    console.error(`  ${AUTOPLAY_FLAG}`);
    process.exitCode = 1; return;
  }
  const demo = createDemoServer();
  let demoOwned = true;
  try { await listen(demo, DEMO_PORT); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    demoOwned = false;
    console.log(`Port ${DEMO_PORT} is already serving (probably npm run demo); reusing it.`);
  }
  const relay = createPhoneRelay({spawnEncoder: ffmpegEncoder(options.ffmpeg), djOrigins: [...DEFAULT_DJ_ORIGINS],
    log: message => { console.log(message); }});
  const relayPort = await listen(relay.server, DEFAULT_RELAY_PORT).catch(() => listen(relay.server, 0));
  const url = studioSetPageUrl(DEFAULT_DJ_ORIGINS[0], relayPort, relay.token);
  console.log(`EUTONOS Music phone host: relay http://127.0.0.1:${relayPort}/  DJ http://127.0.0.1:${DEMO_PORT}/studio.html?pack=set  (loopback only)`);
  console.log(`On the phone, after \`tailscale serve --bg ${relayPort}\` (run it yourself), open https://<pc-name>.<tailnet>.ts.net/`);

  let child: ChildProcess | null = null;
  let profile: string | null = null;
  if (options.open && browser) {
    profile = await mkdtemp(join(tmpdir(), 'eutonos-phone-host-'));
    child = spawn(browser, browserArgs(url, profile, options.minimized), {stdio: 'ignore', windowsHide: false});
    child.on('error', error => { console.error(`Could not start the browser: ${error.message}`); });
    console.log(`Opened a dedicated DJ window (${browser}) with a throwaway profile at ${profile}.`);
    console.log('It has the autoplay flag, so a phone Play needs no click on this PC. Leave it open; closing it ends sound.');
  } else {
    console.log('Open this in a browser started with the autoplay flag:');
    console.log(`  ${url}`);
  }
  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log('Stopping the phone host...');
    try { child?.kill(); } catch { /* already gone */ }
    await relay.close().catch(() => undefined);
    if (demoOwned) { demo.closeAllConnections(); await new Promise<void>(done => demo.close(() => done())); }
    // The browser may hold profile files for a moment after it exits.
    if (profile) await rm(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 300}).catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => { void stop(); });
  process.on('SIGTERM', () => { void stop(); });
  child?.on('exit', () => { if (!stopping) { console.log('The DJ window closed.'); void stop(); } });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
