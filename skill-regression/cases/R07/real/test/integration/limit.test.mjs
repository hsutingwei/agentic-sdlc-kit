import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('DEMO-207: the 101st item answers 409; bad input still answers 400', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => {
    const res = await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    for (let i = 0; i < 100; i++) assert.equal((await post({ title: `item ${i}` })).status, 201);
    const refused = await post({ title: 'one too many' });
    assert.equal(refused.status, 409);
    assert.deepEqual(refused.body, { error: 'too many items' });
    assert.equal((await post({ title: '' })).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
