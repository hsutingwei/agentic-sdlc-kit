import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const titles = async (q) => (await (await fetch(`${base}/todos?q=${encodeURIComponent(q)}`)).json()).map((t) => t.title);

test('q finds titles in any case, trims, and is limited', async () => {
  for (const title of ['Buy MILK', 'water plants']) await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title }) });
  assert.deepEqual(await titles(' milk '), ['Buy MILK']);
  assert.equal((await titles('')).length, 2);
  assert.equal((await fetch(`${base}/todos?q=${'x'.repeat(101)}`)).status, 400);
});
