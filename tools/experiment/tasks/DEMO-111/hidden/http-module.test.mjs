import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from '../../src/server.mjs';

const source = (name) => readFileSync(new URL(`../../src/${name}`, import.meta.url), 'utf8');

test('hidden DEMO-111: helpers live in src/http.mjs', async () => {
  const http = await import('../../src/http.mjs');
  assert.equal(typeof http.send, 'function');
  assert.equal(typeof http.readJson, 'function');
  const server = source('server.mjs');
  assert.match(server, /from '\.\/http\.mjs'/);
  assert.doesNotMatch(server, /function send\(|function readJson\(|const send =|const readJson =/);
});

test('hidden DEMO-111: behaviour is unchanged', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title: 'x' }) });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('content-type'), 'application/json; charset=utf-8');
    const body = await created.text();
    assert.equal(created.headers.get('content-length'), String(Buffer.byteLength(body)));
    const del = await fetch(`${base}/todos/1`, { method: 'DELETE' });
    assert.deepEqual([del.status, await del.text(), del.headers.get('content-type')], [204, '', null]);
    const bad = await fetch(`${base}/todos`, { method: 'POST', body: '{nope' });
    assert.deepEqual([bad.status, await bad.json()], [400, { error: 'request body must be JSON' }]);
    const big = await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title: 'x'.repeat(70 * 1024) }) });
    assert.deepEqual([big.status, await big.json()], [400, { error: 'request body too large' }]);
    const empty = await fetch(`${base}/todos`, { method: 'POST' });
    assert.deepEqual([empty.status, (await empty.json()).error], [400, 'title must be a non-empty string']);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
