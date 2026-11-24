import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

test('done=true and done=false filter the list; other values are refused', async () => {
  await call('POST', '/todos', { title: 'open' });
  const done = await call('POST', '/todos', { title: 'finished' });
  await call('PATCH', `/todos/${done.body.id}`, { done: true });
  assert.deepEqual((await call('GET', '/todos?done=true')).body.map((t) => t.title), ['finished']);
  assert.deepEqual((await call('GET', '/todos?done=false')).body.map((t) => t.title), ['open']);
  assert.equal((await call('GET', '/todos')).body.length, 2);
  assert.equal((await call('GET', '/todos?done=maybe')).status, 400);
});
