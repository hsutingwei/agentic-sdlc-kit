import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  const items = Array.from({ length: 7 }, (_, i) => ({ title: `item ${i + 1}`, done: i % 2 === 1 }));
  await fetch(`${base}/todos/import`, { method: 'POST', body: JSON.stringify({ items }) });
});

after(() => new Promise((resolve) => server.close(resolve)));

const list = async (query) => {
  const res = await fetch(`${base}/todos${query}`);
  return { status: res.status, total: res.headers.get('x-total-count'), ids: res.status === 200 ? (await res.json()).map((t) => t.id) : await res.json() };
};

test('pages come after the filters, and the header counts what passes them', async () => {
  assert.deepEqual(await list(''), { status: 200, total: '7', ids: [1, 2, 3, 4, 5, 6, 7] });
  assert.deepEqual(await list('?limit=3&offset=2'), { status: 200, total: '7', ids: [3, 4, 5] });
  assert.deepEqual(await list('?done=false&limit=2&offset=1'), { status: 200, total: '4', ids: [3, 5] });
  assert.deepEqual(await list('?done=true&offset=5'), { status: 200, total: '3', ids: [] });
});

test('a bad limit or offset answers 400', async () => {
  const bad = await list('?limit=0');
  assert.equal(bad.status, 400);
  assert.match(bad.ids.error, /^limit/);
  assert.equal((await list('?offset=-1')).status, 400);
});
