import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('D2: PUT on an unknown id answers 404 and creates nothing', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/todos/7`, { method: 'PUT', body: JSON.stringify({ title: 'ghost' }) });
    await res.arrayBuffer();
    assert.equal(res.status, 404);
    assert.deepEqual(await (await fetch(`${base}/todos`)).json(), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
