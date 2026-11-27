import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer({ now: () => new Date('2026-03-10T12:00:00Z') });
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
  const created = await call('POST', '/todos', { title: 'demo', due_date: '2026-03-01' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, { id: created.body.id, title: 'demo', done: false, due_date: '2026-03-01' });
  const id = created.body.id;
  assert.equal((await call('GET', '/todos')).body.length, 1);
  assert.equal((await call('GET', `/todos/${id}`)).body.title, 'demo');
  assert.equal((await call('PATCH', `/todos/${id}`, { done: true })).body.done, true);
  assert.equal((await call('DELETE', `/todos/${id}`)).status, 204);
  assert.equal((await call('GET', `/todos/${id}`)).status, 404);
});

test('import, filters and the summary', async () => {
  const imported = await call('POST', '/todos/import', {
    items: [{ title: 'Quarterly Report', due_date: '2026-03-01' }, { title: '買牛奶', done: true }, { title: 'later', due_date: '2026-04-01' }],
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.body.length, 3);
  const titles = async (query) => (await call('GET', `/todos${query}`)).body.map((t) => t.title);
  assert.deepEqual(await titles('?overdue=true'), ['Quarterly Report']);
  assert.deepEqual(await titles('?done=true'), ['買牛奶']);
  assert.deepEqual(await titles(`?q=${encodeURIComponent('牛奶')}`), ['買牛奶']);
  assert.deepEqual((await call('GET', '/summary')).body, { total: 3, done: 1, open: 2, overdue: 1, due_today: 0 });
  assert.equal((await call('POST', '/todos/import', { items: [{ title: 'ok' }, { title: '' }] })).status, 400);
  assert.equal((await call('GET', '/todos')).body.length, 3, 'a refused import adds nothing');
  assert.equal((await call('GET', '/todos?page=2')).status, 400);
});

test('bad requests get 400, unknown routes 404, wrong methods 405', async () => {
  assert.equal((await call('POST', '/todos', '{bad')).status, 400);
  assert.equal((await call('POST', '/todos', { title: '' })).status, 400);
  assert.equal((await call('POST', '/todos', { title: 'x', due_date: 'tomorrow' })).status, 400);
  assert.equal((await call('GET', '/nope')).status, 404);
  assert.equal((await call('GET', '/todos/0')).status, 404);
  assert.equal((await call('PUT', '/todos')).status, 405);
});
