import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadBrowserPack} from '../src/browser-pack.js';

const fixtureRoot = new URL('../../fixtures/s01/', import.meta.url);
const url = new URL('http://127.0.0.1:4173/fixtures/s01/manifest.json');

function reader(transform?: (path: string, bytes: Uint8Array) => Uint8Array | null): typeof fetch {
  return async input => {
    const address = new URL(input instanceof Request ? input.url : input.toString());
    const path = address.pathname.replace('/fixtures/s01/', '');
    const original = new Uint8Array(await readFile(new URL(path, fixtureRoot)));
    const bytes = transform ? transform(path, original) : original;
    return bytes ? new Response(new Uint8Array(bytes), {status: 200}) : new Response('missing', {status: 404});
  };
}

test('browser pack loader validates all bytes and requires explicit fixture eligibility', async () => {
  await assert.rejects(loadBrowserPack(url, false, reader()), /fixture mode/);
  const loaded = await loadBrowserPack(url, true, reader());
  assert.equal(loaded.pack.id, 's01-foundation');
  assert.equal(loaded.files.size, 6);
  assert.equal(loaded.files.get('audio/s01-recording-a.wav')!.length, 768044);
});

test('browser loader refuses corrupted bytes and missing media or rights evidence', async () => {
  await assert.rejects(loadBrowserPack(url, true, reader((path, bytes) => {
    if (path.endsWith('s01-recording-a.wav')) bytes[100] = bytes[100]! ^ 1;
    return bytes;
  })), /HASH_MISMATCH/);
  await assert.rejects(loadBrowserPack(url, true, reader((path, bytes) => path.endsWith('s01-recording-b.wav') ? null : bytes)), /HTTP 404/);
  await assert.rejects(loadBrowserPack(url, true, reader((path, bytes) => path === 'PROVENANCE.md' ? null : bytes)), /HTTP 404/);
});

test('browser loader refuses oversized streamed responses, resident packs and file URLs', async () => {
  let cancelled = false;
  const tooBig: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(loadBrowserPack(url, true, tooBig), /size limit/);
  assert.equal(cancelled, true);
  await assert.rejects(loadBrowserPack(url, true, reader((path, bytes) => {
    if (path !== 'manifest.json') return bytes;
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    manifest.assets[0].file.bytes = 17 * 1024 * 1024;
    return new TextEncoder().encode(JSON.stringify(manifest));
  })), /16 MiB/);
  await assert.rejects(loadBrowserPack(new URL('file:///fixtures/manifest.json'), true, reader()), /HTTP/);
});
