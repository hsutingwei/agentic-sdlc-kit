import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

let server;
let base;

before(async () => {
  server = createServer({ now: () => new Date('2026-03-10T12:00:00Z') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  await fetch(`${base}/todos/import`, { method: 'POST', body: JSON.stringify({ items: [{ title: '買牛奶, 兩瓶', due_date: '2026-03-01' }, { title: 'done', done: true }] }) });
});

after(() => new Promise((resolve) => server.close(resolve)));

test('GET /todos.csv is the list as CSV, with the filters of the list', async () => {
  const res = await fetch(`${base}/todos.csv`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.toString('utf8'), 'id,title,done,due_date\r\n1,"買牛奶, 兩瓶",false,2026-03-01\r\n2,done,true,\r\n');
  assert.notEqual(bytes[0], 0xef, 'no byte order mark');
  assert.equal(await (await fetch(`${base}/todos.csv?done=true`)).text(), 'id,title,done,due_date\r\n2,done,true,\r\n');
  assert.equal(await (await fetch(`${base}/todos.csv?overdue=true`)).text(), 'id,title,done,due_date\r\n1,"買牛奶, 兩瓶",false,2026-03-01\r\n');
});

test('bad parameters answer 400 and other methods 405', async () => {
  const bad = await fetch(`${base}/todos.csv?page=2`);
  assert.deepEqual([bad.status, await bad.json()], [400, { error: 'unknown query parameter: page' }]);
  assert.equal((await fetch(`${base}/todos.csv`, { method: 'POST', body: '{}' })).status, 405);
  assert.equal((await fetch(`${base}/todos.csv`, { method: 'DELETE' })).status, 405);
});
