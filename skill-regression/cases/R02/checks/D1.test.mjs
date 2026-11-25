import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('D1: DELETE /todos without done=true answers 405 and removes nothing', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const created = await (await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title: 'finished' }) })).json();
    await (await fetch(`${base}/todos/${created.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })).arrayBuffer();
    const res = await fetch(`${base}/todos`, { method: 'DELETE' });
    await res.arrayBuffer();
    assert.equal(res.status, 405);
    assert.equal((await (await fetch(`${base}/todos`)).json()).length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
