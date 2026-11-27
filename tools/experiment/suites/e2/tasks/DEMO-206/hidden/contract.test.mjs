import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

const NOT_FOUND = [404, { error: 'not found' }];
const NOT_ALLOWED = [405, { error: 'method not allowed' }];

// Seven items, ids 1 to 7, and a fixed day.
async function withApi(fn) {
  const server = createServer({ now: () => new Date('2026-03-10T12:00:00Z') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    return [res.status, text ? JSON.parse(text) : undefined];
  };
  const items = Array.from({ length: 7 }, (_, i) => ({ title: `item ${i + 1}`, due_date: i === 0 ? '2026-03-01' : null }));
  assert.equal((await call('POST', '/todos/import', { items }))[0], 201);
  try {
    return await fn(call, base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('hidden DEMO-206: src/routes.mjs exports the table of the README', async () => {
  const { routes } = await import('../../src/routes.mjs');
  assert.ok(Array.isArray(routes));
  assert.deepEqual(
    routes.map((r) => `${r.method} ${r.path}`).sort(),
    ['DELETE /todos/:id', 'GET /summary', 'GET /todos', 'GET /todos/:id', 'PATCH /todos/:id', 'POST /todos', 'POST /todos/import'],
  );
  for (const r of routes) assert.equal(typeof r.handler, 'function', `${r.method} ${r.path}`);
});

test('hidden DEMO-206: every route answers as before', () =>
  withApi(async (call) => {
    assert.deepEqual(await call('GET', '/todos/1'), [200, { id: 1, title: 'item 1', done: false, due_date: '2026-03-01' }]);
    assert.deepEqual((await call('GET', '/todos'))[1].map((t) => t.id), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual((await call('GET', '/todos?overdue=true'))[1].map((t) => t.id), [1]);
    assert.deepEqual(await call('POST', '/todos', { title: ' eight ' }), [201, { id: 8, title: 'eight', done: false, due_date: null }]);
    assert.deepEqual(await call('PATCH', '/todos/8', { done: true, due_date: '2026-04-01' }), [200, { id: 8, title: 'eight', done: true, due_date: '2026-04-01' }]);
    assert.deepEqual(await call('GET', '/summary'), [200, { total: 8, done: 1, open: 7, overdue: 1, due_today: 0 }]);
    assert.deepEqual(await call('DELETE', '/todos/8'), [204, undefined]);
    assert.deepEqual(await call('DELETE', '/todos/8'), NOT_FOUND);
    assert.deepEqual(await call('GET', '/todos/8'), NOT_FOUND);
    assert.deepEqual(await call('POST', '/todos/import', { items: [{ title: 'nine' }] }), [201, [{ id: 9, title: 'nine', done: false, due_date: null }]]);
  }));

test('hidden DEMO-206: an id is decimal digits without leading zeros; anything else is not a route', () =>
  withApi(async (call) => {
    for (const path of ['/todos/007', '/todos/07', '/todos/7.0', '/todos/1e0', '/todos/0x7', '/todos/+7', '/todos/%207', '/todos/0', '/todos/-1']) {
      assert.deepEqual(await call('GET', path), NOT_FOUND, `GET ${path}`);
      assert.deepEqual(await call('PATCH', path, { done: true }), NOT_FOUND, `PATCH ${path}`);
      assert.deepEqual(await call('DELETE', path), NOT_FOUND, `DELETE ${path}`);
    }
    const after = (await call('GET', '/todos'))[1];
    assert.equal(after.length, 7, 'nothing was deleted');
    assert.ok(after.every((t) => t.done === false), 'nothing was changed');
  }));

test('hidden DEMO-206: a path that is not a route answers 404 whatever the method', () =>
  withApi(async (call) => {
    for (const path of ['/', '/nope', '/todos/', '/todos/1/', '/todos/abc', '/todos/1/done', '/summary/', '/todos/import/x', '/Todos', '/todos.json']) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        assert.deepEqual(await call(method, path, method === 'GET' || method === 'DELETE' ? undefined : {}), NOT_FOUND, `${method} ${path}`);
      }
    }
  }));

test('hidden DEMO-206: a route asked with a method it does not have answers 405', () =>
  withApi(async (call) => {
    const cases = [
      ['PUT', '/todos'], ['PATCH', '/todos'], ['DELETE', '/todos'],
      ['GET', '/todos/import'], ['PUT', '/todos/import'], ['PATCH', '/todos/import'], ['DELETE', '/todos/import'],
      ['POST', '/summary'], ['PUT', '/summary'], ['DELETE', '/summary'],
      ['POST', '/todos/1'], ['PUT', '/todos/1'], ['POST', '/todos/999'], ['PUT', '/todos/999'],
    ];
    for (const [method, path] of cases) {
      assert.deepEqual(await call(method, path, method === 'GET' || method === 'DELETE' ? undefined : {}), NOT_ALLOWED, `${method} ${path}`);
    }
    assert.equal((await call('GET', '/todos'))[1].length, 7, 'nothing was deleted or added');
  }));

test('hidden DEMO-206: bodies are checked before the item is looked up; queries only matter on the list', () =>
  withApi(async (call) => {
    assert.deepEqual(await call('PATCH', '/todos/999', '{bad'), [400, { error: 'request body must be JSON' }]);
    assert.deepEqual(await call('PATCH', '/todos/999', { done: true }), NOT_FOUND);
    assert.deepEqual(await call('PATCH', '/todos/1', { done: 'yes' }), [400, { error: 'done must be true or false' }]);
    assert.deepEqual(await call('POST', '/todos', '{bad'), [400, { error: 'request body must be JSON' }]);
    assert.deepEqual(await call('POST', '/todos', { title: '' }), [400, { error: 'title must be a non-empty string' }]);
    assert.deepEqual(await call('POST', '/todos/import', {}), [400, { error: 'items must be a list' }]);
    assert.deepEqual(await call('POST', '/todos/import', { items: [{ title: 'ok' }, { title: ' ' }] }), [400, { error: 'item 2: title must be a non-empty string' }]);
    assert.deepEqual(await call('GET', '/todos?page=2'), [400, { error: 'unknown query parameter: page' }]);
    assert.equal((await call('GET', '/summary?page=2'))[0], 200);
    assert.equal((await call('GET', '/todos/1?page=2'))[0], 200);
    assert.deepEqual(await call('POST', '/todos', { title: 'next' }), [201, { id: 8, title: 'next', done: false, due_date: null }], 'refused requests used up no id');
  }));

test('hidden DEMO-206: headers are what they were', () =>
  withApi(async (call, base) => {
    const ok = await fetch(`${base}/todos/1`);
    const body = await ok.text();
    assert.equal(ok.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(ok.headers.get('content-length'), String(Buffer.byteLength(body)));
    for (const res of [await fetch(`${base}/nope`), await fetch(`${base}/summary`, { method: 'POST' }), await fetch(`${base}/todos?page=2`)]) {
      assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    }
    const gone = await fetch(`${base}/todos/1`, { method: 'DELETE' });
    assert.deepEqual([gone.status, gone.headers.get('content-type'), await gone.text()], [204, null, '']);
  }));
