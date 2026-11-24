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

test('DELETE answers 204 once, then 404', async () => {
  const item = await (await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title: 'x' }) })).json();
  assert.equal((await fetch(`${base}/todos/${item.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await fetch(`${base}/todos/${item.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await fetch(`${base}/todos/77`, { method: 'DELETE' })).status, 404);
});
