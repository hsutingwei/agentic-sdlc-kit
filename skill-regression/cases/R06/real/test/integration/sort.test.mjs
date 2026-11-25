import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const title of ['b', 'B', 'a', 'b']) await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title }) });
});

after(() => new Promise((resolve) => server.close(resolve)));

const get = async (query) => {
  const res = await fetch(`${base}/todos${query}`);
  return { status: res.status, body: await res.json() };
};

test('DEMO-206 AC1: by title with plain string comparison, then by id', async () => {
  assert.deepEqual((await get('?sort=title')).body.map((t) => `${t.title}${t.id}`), ['B2', 'a3', 'b1', 'b4']);
  assert.deepEqual((await get('?sort=id')).body.map((t) => t.id), [1, 2, 3, 4]);
  assert.deepEqual((await get('')).body.map((t) => t.id), [1, 2, 3, 4]);
});

test('DEMO-206 AC2: other values and a repeated sort answer 400', async () => {
  for (const query of ['?sort=name', '?sort=', '?sort=TITLE', '?sort=title&sort=bogus', '?sort=id&sort=id']) assert.equal((await get(query)).status, 400, query);
});
