import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('D2: limit=0 answers 400', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/todos?limit=0`);
    await res.arrayBuffer();
    assert.equal(res.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
