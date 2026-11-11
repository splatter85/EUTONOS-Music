/** Local, loopback-only demo server. This is not a production host. */
import { createServer, type Server } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const browserModules = new Set([
  'index', 'pack-types', 'pack', 'audio', 'playable-source', 'control',
  'browser-pack', 'web-audio', 'player', 'dj', 'phrase-plan', 'procedural-source', 'hybrid-handoff',
  // EUTONOS Studio: S11 library, IndexedDB adapter and the pure WAV decoder for waveforms.
  'library-codec', 'library', 'recipe-library', 'library-indexeddb', 'audio-analysis',
]);
const mimeTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav',
};

function assetPath(requestTarget: string): string | undefined {
  // Inspect the raw target before URL normalization can hide ../ segments.
  const rawPath = requestTarget.split('?')[0];
  if (!rawPath || !rawPath.startsWith('/') || rawPath.startsWith('//')) return undefined;
  if (/%(?:2f|5c)/i.test(rawPath)) return undefined;
  let path: string;
  try { path = decodeURIComponent(rawPath); } catch { return undefined; }
  if (path.includes('\\') || /[\x00-\x1f\x7f#%]/.test(path)) return undefined;
  if (path.split('/').some(segment => segment === '.' || segment === '..')) return undefined;
  if (path === '/') return 'web/index.html';
  if (path === '/checks.html') return 'web/checks.html';
  if (path === '/procedural.html') return 'web/procedural.html';
  if (path === '/studio.html') return 'web/studio.html';
  if (/^\/web\/[a-zA-Z0-9_-]+\.css$/.test(path)) return path.slice(1);
  if (/^\/dist\/web\/[a-zA-Z0-9_-]+\.js$/.test(path)) return path.slice(1);
  const module = /^\/dist\/src\/([a-zA-Z0-9_-]+)\.js$/.exec(path)?.[1];
  if (module && browserModules.has(module)) return path.slice(1);
  if (/^\/fixtures\/s01\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:json|md|wav)$/.test(path)) {
    return path.slice(1);
  }
  // S06: the pack the mock FL producer generates under dist/ (never committed).
  if (/^\/generated\/s06-mock-fl\/pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav)$/.test(path)) {
    return `dist${path}`;
  }
  // S09: the owner-local real-FL pack under the git-ignored local/ folder (never committed or published).
  if (/^\/local\/s09-fl\/pack\/(?:audio\/)?[a-zA-Z0-9_-]+\.(?:json|md|wav)$/.test(path)) {
    return path.slice(1);
  }
  return undefined;
}

function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host);
}

/** The optional root supports isolated fixtures; the default works from any cwd. */
export function createDemoServer(root: string = repositoryRoot): Server {
  const absoluteRoot = resolve(root);
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const reply = (status: number, message: string): void => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : `${message}\n`);
    };
    if (!isLoopbackHost(request.headers.host)) { reply(400, 'Invalid local host'); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      reply(405, 'Method not allowed');
      return;
    }
    const asset = assetPath(request.url ?? '');
    if (!asset) { reply(404, 'Not found'); return; }
    try {
      const canonicalRoot = await realpath(absoluteRoot);
      const candidate = join(canonicalRoot, asset);
      const canonicalFile = await realpath(candidate);
      // Reject symlink aliases as well as escapes, including aliases to private repo files.
      if (canonicalFile !== candidate) { reply(404, 'Not found'); return; }
      const info = await stat(canonicalFile);
      if (!info.isFile()) { reply(404, 'Not found'); return; }
      const content = request.method === 'HEAD' ? undefined : await readFile(canonicalFile);
      response.writeHead(200, {
        'Content-Type': mimeTypes[extname(canonicalFile)] ?? 'application/octet-stream',
        'Content-Length': content?.byteLength ?? info.size,
      });
      response.end(content);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'ELOOP') {
        reply(404, 'Not found');
      } else {
        console.error('Demo server could not read an asset:', error instanceof Error ? error.message : String(error));
        reply(500, 'Unable to read asset');
      }
    }
  });
}

function startDemo(args: string[]): void {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1] ?? ''))) {
    console.error('Usage: node dist/scripts/serve.js [--port 0..65535]');
    process.exitCode = 1;
    return;
  }
  const port = args.length === 0 ? 4173 : Number(args[1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('Demo port must be an integer from 0 through 65535.');
    process.exitCode = 1;
    return;
  }
  const server = createDemoServer();
  server.on('error', error => {
    console.error(`Cannot start the demo: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') {
      console.log(`EUTONOS Music demo: http://127.0.0.1:${address.port}/`);
      console.log('Local development server. Press Ctrl+C to stop.');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startDemo(process.argv.slice(2));
}
