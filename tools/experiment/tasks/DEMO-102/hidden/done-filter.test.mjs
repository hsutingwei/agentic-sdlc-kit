import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('hidden DEMO-102: done filter', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  try {
    await call('POST', '/todos', { title: 'open' });
    const done = await call('POST', '/todos', { title: 'finished' });
    await call('PATCH', `/todos/${done.body.id}`, { done: true });
    assert.deepEqual((await call('GET', '/todos?done=true')).body.map((t) => t.title), ['finished']);
    assert.deepEqual((await call('GET', '/todos?done=false')).body.map((t) => t.title), ['open']);
    assert.equal((await call('GET', '/todos')).body.length, 2);
    for (const bad of ['yes', '1', 'TRUE', '']) assert.equal((await call('GET', `/todos?done=${bad}`)).status, 400, bad);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
