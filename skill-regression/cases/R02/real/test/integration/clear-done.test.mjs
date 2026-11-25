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

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
};

test('DEMO-202: finished items are cleared in one request; other requests remove nothing', async () => {
  const ids = [];
  for (const title of ['open', 'finished', 'also finished']) ids.push((await call('POST', '/todos', { title })).body.id);
  await call('PATCH', `/todos/${ids[1]}`, { done: true });
  await call('PATCH', `/todos/${ids[2]}`, { done: true });

  // AC2
  for (const query of ['', '?done=false', '?done=yes', '?done=true&done=true']) assert.equal((await call('DELETE', `/todos${query}`)).status, 405, query);
  assert.equal((await call('GET', '/todos')).body.length, 3);

  // AC1
  const cleared = await call('DELETE', '/todos?done=true');
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.body, { deleted: 2 });
  assert.deepEqual((await call('GET', '/todos')).body.map((t) => t.title), ['open']);
});
