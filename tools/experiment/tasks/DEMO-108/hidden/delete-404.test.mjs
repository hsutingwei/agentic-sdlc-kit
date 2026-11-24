import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('hidden DEMO-108: DELETE answers 404 for unknown ids', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const del = async (id) => (await fetch(`${base}/todos/${id}`, { method: 'DELETE' })).status;
  try {
    const item = await (await fetch(`${base}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x' }) })).json();
    assert.equal(await del(999), 404);
    assert.equal(await del(item.id), 204);
    assert.equal(await del(item.id), 404, 'a second delete finds nothing');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
