import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('hidden DEMO-110: 201 Created with Location', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = () => fetch(`${base}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x' }) });
    await post();
    const res = await post();
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.id, 2);
    assert.equal(res.headers.get('location'), '/todos/2');
    const get = await fetch(`${base}/todos/2`);
    assert.equal(get.headers.get('location'), null);
    assert.equal((await fetch(`${base}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).headers.get('location'), null);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
