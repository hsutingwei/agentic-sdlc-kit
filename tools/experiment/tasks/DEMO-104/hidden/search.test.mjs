import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('hidden DEMO-104: title search', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (q) => {
    const res = await fetch(`${base}/todos?q=${encodeURIComponent(q)}`);
    return { status: res.status, titles: res.status === 200 ? (await res.json()).map((t) => t.title) : null };
  };
  try {
    for (const title of ['Buy MILK', 'milkshake recipe', 'Call 媽媽', 'water plants']) {
      await fetch(`${base}/todos`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
    }
    assert.deepEqual((await get('milk')).titles, ['Buy MILK', 'milkshake recipe']);
    assert.deepEqual((await get('  Milk ')).titles, ['Buy MILK', 'milkshake recipe']);
    assert.deepEqual((await get('媽媽')).titles, ['Call 媽媽']);
    assert.deepEqual((await get('coffee')).titles, []);
    assert.equal((await get('')).titles.length, 4);
    assert.equal((await get('x'.repeat(101))).status, 400);
    assert.equal((await get('x'.repeat(100))).status, 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
