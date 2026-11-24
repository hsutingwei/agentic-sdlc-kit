import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError } from '../../src/todos.mjs';
import { createServer } from '../../src/server.mjs';

test('hidden DEMO-101: priority defaults, values and refusals', () => {
  const store = createStore();
  assert.equal(store.add({ title: 'a' }).priority, 'normal');
  for (const p of ['low', 'normal', 'high']) assert.equal(store.add({ title: p, priority: p }).priority, p);
  for (const bad of ['urgent', 'HIGH', '', 1, null]) assert.throws(() => store.add({ title: 'x', priority: bad }), ValidationError, String(bad));
  const item = store.add({ title: 'b' });
  assert.equal(store.update(item.id, { priority: 'high' }).priority, 'high');
  assert.throws(() => store.update(item.id, { priority: 'later' }), ValidationError);
  assert.equal(store.get(item.id).priority, 'high', 'a refused change changes nothing');
});

test('hidden DEMO-101: priority over HTTP', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const post = (body) => fetch(`${base}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const created = await post({ title: 'x', priority: 'high' });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).priority, 'high');
    assert.equal((await post({ title: 'y', priority: 'urgent' })).status, 400);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
