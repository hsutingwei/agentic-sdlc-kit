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
  const res = await fetch(base + path, { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

test('CRUD over HTTP', async () => {
  const created = await call('POST', '/todos', { title: 'demo' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await call('GET', '/todos')).body.length, 1);
  assert.equal((await call('GET', `/todos/${id}`)).body.title, 'demo');
  assert.equal((await call('PATCH', `/todos/${id}`, { done: true })).body.done, true);
  assert.equal((await call('DELETE', `/todos/${id}`)).status, 204);
  assert.equal((await call('GET', `/todos/${id}`)).status, 404);
});

test('bad requests get 400, unknown routes 404, wrong methods 405', async () => {
  assert.equal((await call('POST', '/todos', '{bad')).status, 400);
  assert.equal((await call('POST', '/todos', { title: '' })).status, 400);
  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('GET', '/todos/0')).status, 404);
  assert.equal((await call('PUT', '/todos')).status, 405);
});
