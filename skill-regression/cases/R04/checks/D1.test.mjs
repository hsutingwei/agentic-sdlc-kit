import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('D1: POST /todos/count answers 405', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/todos/count`, { method: 'POST', body: '{}' });
    await res.arrayBuffer();
    assert.equal(res.status, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
