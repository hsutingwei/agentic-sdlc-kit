import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('hidden DEMO-105: toggle', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  try {
    const { body: item } = await call('POST', '/todos', { title: 'flip me' });
    const on = await call('POST', `/todos/${item.id}/toggle`);
    assert.deepEqual([on.status, on.body.done, on.body.title], [200, true, 'flip me']);
    assert.equal((await call('POST', `/todos/${item.id}/toggle`)).body.done, false);
    assert.equal((await call('GET', `/todos/${item.id}`)).body.done, false);
    assert.equal((await call('POST', '/todos/99/toggle')).status, 404);
    for (const method of ['GET', 'PATCH', 'DELETE', 'PUT']) assert.equal((await call(method, `/todos/${item.id}/toggle`)).status, 405, method);
    assert.equal((await call('GET', `/todos/${item.id}/other`)).status, 404);
    assert.equal((await call('DELETE', `/todos/${item.id}`)).status, 204);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
