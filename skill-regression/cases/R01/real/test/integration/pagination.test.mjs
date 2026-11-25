import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const title of ['a', 'b', 'c', 'd', 'e']) await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title }) });
});

after(() => new Promise((resolve) => server.close(resolve)));

const get = async (query) => {
  const res = await fetch(`${base}/todos${query}`);
  const body = await res.json();
  return { status: res.status, titles: res.status === 200 ? body.map((t) => t.title) : null };
};

test('DEMO-201 AC1: limit and offset pick one page', async () => {
  assert.deepEqual((await get('?limit=2')).titles, ['a', 'b']);
  assert.deepEqual((await get('?limit=2&offset=2')).titles, ['c', 'd']);
  assert.deepEqual((await get('?offset=4')).titles, ['e']);
  assert.deepEqual((await get('?limit=10&offset=3')).titles, ['d', 'e']);
  assert.deepEqual((await get('?offset=9007199254740993')).titles, []);
});

test('DEMO-201 AC2: other values answer 400; no parameters return everything', async () => {
  for (const query of ['?limit=0', '?limit=101', '?limit=x', '?offset=-1', '?offset=1.5', '?limit=2&limit=3', '?offset=1&offset=1']) assert.equal((await get(query)).status, 400, query);
  assert.deepEqual((await get('')).titles, ['a', 'b', 'c', 'd', 'e']);
});
