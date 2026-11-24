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

test('POST /todos/:id/toggle flips done; unknown ids 404, other methods 405', async () => {
  const item = await (await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title: 'x' }) })).json();
  const res = await fetch(`${base}/todos/${item.id}/toggle`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).done, true);
  assert.equal((await fetch(`${base}/todos/99/toggle`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${base}/todos/${item.id}/toggle`)).status, 405);
});
