import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title: 'one' }) });
});

after(() => new Promise((resolve) => server.close(resolve)));

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, body });
  const text = await res.text();
  return [res.status, text ? JSON.parse(text) : undefined];
};

test('a route without the method answers 405', async () => {
  for (const [method, path] of [['PUT', '/todos/import'], ['POST', '/summary'], ['POST', '/todos/1']]) {
    assert.deepEqual(await call(method, path, '{}'), [405, { error: 'method not allowed' }], `${method} ${path}`);
  }
});

test('a body is checked before the item is looked up', async () => {
  assert.equal((await call('PATCH', '/todos/999', '{bad'))[0], 400);
  assert.deepEqual(await call('PATCH', '/todos/999', '{"done":true}'), [404, { error: 'not found' }]);
});
