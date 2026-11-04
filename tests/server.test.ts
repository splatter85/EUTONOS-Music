import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from '../scripts/serve.js';

const execFileAsync = promisify(execFile);
const serverScript = fileURLToPath(new URL('../scripts/serve.js', import.meta.url));
const sourceManifest = fileURLToPath(new URL('../../fixtures/s01/manifest.json', import.meta.url));

interface HttpResult {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function get(port: number, path: string, method = 'GET', host = `127.0.0.1:${port}`): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path, method, setHost: false, headers: { host } }, incoming => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(chunks) }));
      incoming.on('error', reject);
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function serve(t: TestContext): Promise<{ root: string; port: number; server: Server }> {
  const root = await mkdtemp(join(tmpdir(), 'eutonos server '));
  const server = createDemoServer(root);
  t.after(async () => {
    try {
      if (server.listening) await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  assert.equal(server.listening, false, 'importing/creating the server must not start it');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { root, port: address.port, server };
}

async function put(root: string, path: string, content: string | Buffer): Promise<void> {
  const parts = path.split('/');
  const name = parts.pop();
  assert.ok(name);
  const directory = join(root, ...parts);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), content);
}

test('demo server serves only mapped assets with correct MIME, query and HEAD behavior', async t => {
  const { root, port } = await serve(t);
  const assets = [
    ['/', 'web/index.html', '<main>S02</main>', 'text/html; charset=utf-8'],
    ['/checks.html', 'web/checks.html', '<main>Checks</main>', 'text/html; charset=utf-8'],
    ['/web/style.css', 'web/style.css', 'body { color: white; }', 'text/css; charset=utf-8'],
    ['/dist/web/app.js', 'dist/web/app.js', 'export const app = 1;', 'text/javascript; charset=utf-8'],
    ['/dist/web/checks.js', 'dist/web/checks.js', 'export const checks = 1;', 'text/javascript; charset=utf-8'],
    ['/dist/src/player.js', 'dist/src/player.js', 'export const player = 1;', 'text/javascript; charset=utf-8'],
    ['/dist/src/index.js', 'dist/src/index.js', 'export const index = 1;', 'text/javascript; charset=utf-8'],
    ['/fixtures/s01/manifest.json', 'fixtures/s01/manifest.json', '{"version":0}', 'application/json; charset=utf-8'],
    ['/fixtures/s01/README.md', 'fixtures/s01/README.md', '# Fixture', 'text/plain; charset=utf-8'],
    ['/fixtures/s01/audio/test.wav', 'fixtures/s01/audio/test.wav', 'RIFF sample bytes', 'audio/wav'],
  ] as const;
  for (const [url, file, content, mime] of assets) {
    await put(root, file, content);
    const result = await get(port, `${url}?version=1`);
    assert.equal(result.status, 200, url);
    assert.equal(result.body.toString(), content, url);
    assert.equal(result.headers['content-type'], mime, url);
    assert.equal(result.headers['content-length'], String(Buffer.byteLength(content)), url);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.headers['x-content-type-options'], 'nosniff');
    const head = await get(port, url, 'HEAD');
    assert.equal(head.status, 200, url);
    assert.equal(head.body.byteLength, 0, url);
    assert.equal(head.headers['content-length'], result.headers['content-length'], url);
    assert.equal(head.headers['content-type'], mime, url);
  }
});

test('demo server keeps repo files, node adapters, directories and absent assets private', async t => {
  const { root, port } = await serve(t);
  const privatePaths = [
    'AGENTS.md', '.git/config', 'package.json', 'node_modules/example/index.js',
    'dist/scripts/serve.js', 'dist/tests/server.test.js', 'dist/src/node.js',
    'dist/src/unreviewed.js', 'web/index.html', 'web/checks.html', 'web/app.ts',
    'fixtures/s01/secret.txt',
  ];
  for (const path of privatePaths) {
    await put(root, path, 'private');
    assert.equal((await get(port, `/${path}`)).status, 404, path);
  }
  await mkdir(join(root, 'fixtures/s01/audio/folder.wav'), { recursive: true });
  for (const path of ['/web/', '/dist/src/', '/fixtures/s01/', '/fixtures/s01/audio/folder.wav', '/dist/web/missing.js']) {
    assert.equal((await get(port, path)).status, 404, path);
  }
});

test('demo server rejects raw and encoded traversal before URL normalization', async t => {
  const { root, port } = await serve(t);
  await put(root, 'fixtures/secret.wav', 'outside s01');
  await put(root, 'web/index.html', 'public');
  const paths = [
    '/fixtures/s01/../secret.wav', '/fixtures/s01/%2e%2e/secret.wav',
    '/fixtures/s01/%2E%2E/secret.wav', '/fixtures/s01/.%2e/secret.wav',
    '/fixtures/s01/%252e%252e/secret.wav', '/fixtures/s01/%2e%2e%2fsecret.wav',
    '/fixtures/s01/%2e%2e%5csecret.wav', '/fixtures/s01/..\\secret.wav',
    '/fixtures/s01/./manifest.json', '/web/%00style.css', '/web/%zz.css',
    '//web/style.css', '/%2fweb/style.css', 'http://127.0.0.1/web/style.css',
  ];
  for (const path of paths) assert.equal((await get(port, path)).status, 404, path);
});

test('demo server rejects symlink escapes and aliases to private repository files', async t => {
  const { root, port } = await serve(t);
  const outside = await mkdtemp(join(tmpdir(), 'eutonos private '));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await put(outside, 'secret.wav', 'outside secret');
  await put(root, 'private/secret.wav', 'inside secret');
  await mkdir(join(root, 'fixtures/s01'), { recursive: true });
  // Windows directory junctions do not require symlink administrator privileges.
  await symlink(outside, join(root, 'fixtures/s01/escape'), 'junction');
  await symlink(join(root, 'private'), join(root, 'fixtures/s01/alias'), 'junction');
  assert.equal((await get(port, '/fixtures/s01/escape/secret.wav')).status, 404);
  assert.equal((await get(port, '/fixtures/s01/alias/secret.wav')).status, 404);
});

test('demo server restricts methods and accepts only loopback Host headers', async t => {
  const { root, port } = await serve(t);
  await put(root, 'web/index.html', 'public');
  const post = await get(port, '/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  for (const host of ['evil.example', `localhost.evil.example:${port}`, '127.0.0.1@evil.example', '']) {
    assert.equal((await get(port, '/', 'GET', host)).status, 400, host);
  }
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]) {
    assert.equal((await get(port, '/', 'GET', host)).status, 200, host);
  }
});

test('demo CLI resolves its default assets independently of cwd and reports an ephemeral port', { timeout: 10_000 }, async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'eutonos server cwd '));
  const child = spawn(process.execPath, [serverScript, '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  t.after(async () => {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await closed;
    } finally {
      // Windows keeps a running process's cwd in use. Kill before removing it;
      // a failed earlier after-hook would otherwise skip child cleanup entirely.
      await rm(cwd, { recursive: true, force: true });
    }
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const port = await new Promise<number>((resolve, reject) => {
    let stdout = '';
    const timer = setTimeout(() => reject(new Error(`Server did not announce its port. ${stderr}`)), 5_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${String(code)}: ${stderr}`)); });
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
      const match = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(stdout);
      if (match?.[1]) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  assert.ok(port > 0);
  const manifest = await get(port, '/fixtures/s01/manifest.json');
  assert.equal(manifest.status, 200);
  assert.deepEqual(manifest.body, await readFile(sourceManifest));
  assert.equal(stderr, '');
});

test('demo CLI refuses malformed and out-of-range ports', async () => {
  for (const args of [['--port', '-1'], ['--port', '65536'], ['--port', '1.5'], ['--port'], ['--host', '0.0.0.0']]) {
    await assert.rejects(execFileAsync(process.execPath, [serverScript, ...args]), error => {
      assert.ok(error && typeof error === 'object' && 'code' in error && 'stderr' in error);
      assert.equal(error.code, 1);
      assert.match(String(error.stderr), /Usage:|port must be/);
      return true;
    });
  }
});
