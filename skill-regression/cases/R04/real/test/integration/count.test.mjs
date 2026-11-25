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

test('DEMO-204: counts, and only GET', async () => {
  for (const title of ['a', 'b', 'c']) await call('POST', '/todos', { title });
  await call('PATCH', '/todos/2', { done: true });
  assert.deepEqual((await call('GET', '/todos/count')).body, { total: 3, done: 1, open: 2 });
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await call(method, '/todos/count', {})).status, 405, method);
  assert.equal((await call('GET', '/todos/1')).body.title, 'a');
});
