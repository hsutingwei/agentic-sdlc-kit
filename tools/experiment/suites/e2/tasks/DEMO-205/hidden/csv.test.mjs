import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from '../../src/server.mjs';

const HEADER = 'id,title,done,due_date\r\n';
const TAIL = ',false,\r\n';

async function withApi(items, fn) {
  const server = createServer({ now: () => new Date('2026-03-10T12:00:00Z') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  if (items.length > 0) {
    const res = await fetch(`${base}/todos/import`, { method: 'POST', body: JSON.stringify({ items }) });
    assert.equal(res.status, 201);
  }
  const csv = async (query = '') => {
    const res = await fetch(`${base}/todos.csv${query}`);
    assert.equal(res.status, 200);
    return Buffer.from(await res.arrayBuffer()).toString('utf8');
  };
  try {
    return await fn(csv, base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

/** The title field of the export of one item with this title, as it is written in the file. */
const titleField = (title) =>
  withApi([{ title }], async (csv) => {
    const text = await csv();
    assert.ok(text.startsWith(`${HEADER}1,`) && text.endsWith(TAIL), JSON.stringify(text));
    return text.slice(HEADER.length + 2, text.length - TAIL.length);
  });
const titleFields = async (...titles) => {
  const fields = [];
  for (const title of titles) fields.push(await titleField(title));
  return fields;
};

test('hidden DEMO-205: the header, one line per item in id order, CRLF, UTF-8 without a byte order mark', () =>
  withApi([{ title: '買牛奶', due_date: '2026-03-01' }, { title: 'plain', done: true }, { title: 'later', due_date: '2026-04-01' }], async (csv, base) => {
    const res = await fetch(`${base}/todos.csv`);
    assert.equal(res.headers.get('content-type').toLowerCase().replaceAll(' ', ''), 'text/csv;charset=utf-8');
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a byte order mark');
    assert.equal(bytes.toString('utf8'), `${HEADER}1,買牛奶,false,2026-03-01\r\n2,plain,true,\r\n3,later,false,2026-04-01\r\n`);
  }));

test('hidden DEMO-205: an empty list is the header line alone', () => withApi([], async (csv) => assert.equal(await csv(), HEADER)));

test('hidden DEMO-205: commas and double quotes are quoted; nothing else is', async () => {
  assert.deepEqual(await titleFields('a, b', 'say "hi"', '"', "it's fine", 'a;b c', '買牛奶，兩瓶'), ['"a, b"', '"say ""hi"""', '""""', "it's fine", 'a;b c', '買牛奶，兩瓶']);
});

test('hidden DEMO-205: line feeds and carriage returns inside a title are quoted', async () => {
  assert.deepEqual(await titleFields('two\nlines', 'dos\r\nlines', 'old\rmac'), ['"two\nlines"', '"dos\r\nlines"', '"old\rmac"']);
});

test('hidden DEMO-205: titles that start like a formula get an apostrophe', async () => {
  assert.deepEqual(await titleFields('=1+1', '+886 912', '-5 degrees', '@home', 'a=b', '1-2'), ["'=1+1", "'+886 912", "'-5 degrees", "'@home", 'a=b', '1-2']);
});

test('hidden DEMO-205: the apostrophe comes before the quoting', async () => {
  assert.deepEqual(await titleFields('=SUM(A1,B1)', '@a "b"', '-x\ny'), [`"'=SUM(A1,B1)"`, `"'@a ""b"""`, `"'-x\ny"`]);
});

test('hidden DEMO-205: the filters of the list, their errors, and 405 for other methods', () =>
  withApi([{ title: 'Quarterly Report', due_date: '2026-03-01' }, { title: 'done', done: true }, { title: 'later', due_date: '2026-04-01' }], async (csv, base) => {
    assert.equal(await csv('?done=true'), `${HEADER}2,done,true,\r\n`);
    assert.equal(await csv('?overdue=true'), `${HEADER}1,Quarterly Report,false,2026-03-01\r\n`);
    assert.equal(await csv('?q=REPORT&done=false'), `${HEADER}1,Quarterly Report,false,2026-03-01\r\n`);
    assert.equal(await csv('?q=nothing'), HEADER);
    for (const bad of ['?done=yes', '?overdue=false', '?page=2']) {
      const res = await fetch(`${base}/todos.csv${bad}`);
      const same = await fetch(`${base}/todos${bad}`);
      assert.deepEqual([res.status, await res.json()], [400, await same.json()], bad);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await fetch(`${base}/todos.csv`, { method, body: method === 'DELETE' ? undefined : '{}' });
      assert.deepEqual([res.status, await res.json()], [405, { error: 'method not allowed' }], method);
    }
    assert.equal((await fetch(`${base}/todos`)).status, 200, 'the JSON list is still there');
  }));

test('hidden DEMO-205: the README lists the route', () => {
  assert.match(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), /\/todos\.csv/);
});
