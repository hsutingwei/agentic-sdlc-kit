import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('D1: sort=title uses code-point order, so "B" comes before "a"', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const title of ['a', 'B']) await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title }) });
    const list = await (await fetch(`${base}/todos?sort=title`)).json();
    assert.deepEqual(list.map((t) => t.title), ['B', 'a']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
