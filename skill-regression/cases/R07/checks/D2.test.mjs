import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('D2: a full store answers 409', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    let status = 0;
    for (let i = 0; i < 102 && status !== 409 && status !== 400; i++) {
      const res = await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title: `item ${i}` }) });
      await res.arrayBuffer();
      status = res.status === 201 ? 0 : res.status;
    }
    assert.equal(status, 409);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
