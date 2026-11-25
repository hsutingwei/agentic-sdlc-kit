import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('D1: a page after the first starts at offset and holds limit items', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const title of ['a', 'b', 'c', 'd', 'e']) await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title }) });
    const page = await (await fetch(`${base}/todos?limit=2&offset=2`)).json();
    assert.deepEqual(page.map((t) => t.title), ['c', 'd']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
