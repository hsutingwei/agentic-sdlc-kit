import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/todos/import`, { method: 'POST', body: JSON.stringify({ items: Array.from({ length: 7 }, (_, i) => ({ title: `item ${i + 1}` })) }) });
});

after(() => new Promise((resolve) => server.close(resolve)));

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, body });
  const text = await res.text();
  return [res.status, text ? JSON.parse(text) : undefined];
};

test('what is not a route answers 404, whatever the method', async () => {
  for (const path of ['/todos/007', '/todos/1.0', '/todos/0', '/todos/7/', '/todos/abc']) {
    assert.deepEqual(await call('GET', path), [404, { error: 'not found' }], path);
    assert.deepEqual(await call('DELETE', path), [404, { error: 'not found' }], path);
  }
  assert.equal((await call('GET', '/todos'))[1].length, 7, 'nothing was deleted');
});

test('a route without the method answers 405', async () => {
  for (const [method, path] of [['GET', '/todos/import'], ['DELETE', '/todos/import'], ['POST', '/summary'], ['POST', '/todos/1'], ['PUT', '/todos/999']]) {
    assert.deepEqual(await call(method, path, method === 'GET' ? undefined : '{}'), [405, { error: 'method not allowed' }], `${method} ${path}`);
  }
});

test('a body is checked before the item is looked up', async () => {
  assert.equal((await call('PATCH', '/todos/999', '{bad'))[0], 400);
  assert.deepEqual(await call('PATCH', '/todos/999', '{"done":true}'), [404, { error: 'not found' }]);
});
