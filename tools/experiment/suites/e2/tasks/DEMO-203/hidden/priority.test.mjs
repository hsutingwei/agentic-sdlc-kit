import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../../src/server.mjs';
import { parse, persist, serialize, StorageError } from '../../src/storage.mjs';
import { createStore } from '../../src/todos.mjs';

async function withApi(fn) {
  const server = createServer({ now: () => new Date('2026-03-10T12:00:00Z') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, route, body) => {
    const res = await fetch(base + route, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  try {
    return await fn(call);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function tempFile(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'demo-api hidden 資料 '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'todos.json');
}
const V1 = JSON.stringify({
  version: 1,
  next_id: 4,
  items: [
    { id: 1, title: '舊資料', done: false, due_date: null },
    { id: 3, title: 'older', done: true, due_date: '2026-03-01' },
  ],
});

test('hidden DEMO-203: POST and PATCH take a priority; without one an item is normal', () =>
  withApi(async (call) => {
    const plain = await call('POST', '/todos', { title: 'plain' });
    assert.deepEqual([plain.status, plain.body.priority], [201, 'normal']);
    const high = await call('POST', '/todos', { title: 'urgent thing', priority: 'high', due_date: '2026-03-01' });
    assert.deepEqual([high.status, high.body.priority, high.body.due_date], [201, 'high', '2026-03-01']);
    assert.equal((await call('PATCH', '/todos/1', { priority: 'low' })).body.priority, 'low');
    assert.equal((await call('PATCH', '/todos/1', { done: true })).body.priority, 'low', 'another change keeps the priority');
    assert.equal((await call('GET', '/todos/1')).body.priority, 'low');
    assert.deepEqual((await call('GET', '/todos')).body.map((t) => t.priority), ['low', 'high']);
  }));

test('hidden DEMO-203: any other priority answers 400 and changes nothing', () =>
  withApi(async (call) => {
    await call('POST', '/todos', { title: 'one' });
    for (const bad of ['urgent', 'High', 'NORMAL', '', 1, true]) {
      assert.equal((await call('POST', '/todos', { title: 'x', priority: bad })).status, 400, `POST ${JSON.stringify(bad)}`);
      assert.equal((await call('PATCH', '/todos/1', { priority: bad })).status, 400, `PATCH ${JSON.stringify(bad)}`);
    }
    assert.equal((await call('GET', '/todos/1')).body.priority, 'normal');
    assert.equal((await call('POST', '/todos', { title: 'two' })).body.id, 2, 'a refused item uses up no id');
  }));

test('hidden DEMO-203: the import takes a priority too, and gives normal without one', () =>
  withApi(async (call) => {
    const res = await call('POST', '/todos/import', { items: [{ title: 'a' }, { title: 'b', priority: 'high' }, { title: 'c', priority: 'low', done: true }] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.map((t) => t.priority), ['normal', 'high', 'low']);
    assert.deepEqual((await call('GET', '/todos')).body.map((t) => t.priority), ['normal', 'high', 'low']);
    const bad = await call('POST', '/todos/import', { items: [{ title: 'd' }, { title: 'e', priority: 'urgent' }] });
    assert.equal(bad.status, 400);
    assert.equal((await call('GET', '/todos')).body.length, 3, 'a refused import adds nothing');
  }));

test('hidden DEMO-203: the priority filter and high_open', () =>
  withApi(async (call) => {
    await call('POST', '/todos', { title: 'a', priority: 'high' });
    await call('POST', '/todos', { title: 'b', priority: 'high' });
    await call('POST', '/todos', { title: 'c' });
    await call('POST', '/todos', { title: 'report d', priority: 'low' });
    await call('PATCH', '/todos/2', { done: true });
    const ids = async (query) => (await call('GET', `/todos${query}`)).body.map((t) => t.id);
    assert.deepEqual(await ids('?priority=high'), [1, 2]);
    assert.deepEqual(await ids('?priority=high&done=false'), [1]);
    assert.deepEqual(await ids('?priority=normal'), [3]);
    assert.deepEqual(await ids('?priority=low&q=report'), [4]);
    assert.deepEqual(await ids('?priority=low&done=true'), []);
    for (const bad of ['?priority=urgent', '?priority=', '?priority=HIGH']) assert.equal((await call('GET', `/todos${bad}`)).status, 400, bad);
    const summary = (await call('GET', '/summary')).body;
    assert.deepEqual([summary.total, summary.open, summary.high_open], [4, 3, 1]);
    await call('PATCH', '/todos/3', { priority: 'high' });
    assert.equal((await call('GET', '/summary')).body.high_open, 2);
  }));

test('hidden DEMO-203: the file is written as version 2 with priorities, and read back', () => {
  const store = createStore();
  store.add({ title: '買牛奶', priority: 'high' });
  store.add({ title: 'b' });
  const text = serialize(store.snapshot());
  const data = JSON.parse(text);
  assert.equal(data.version, 2);
  assert.deepEqual(data.items.map((t) => [t.id, t.priority]), [[1, 'high'], [2, 'normal']]);
  const again = createStore();
  again.restore(parse(text));
  assert.deepEqual(again.list(), store.list());
});

test('hidden DEMO-203: a version 1 file loads with normal priorities and is not touched until a change', async (t) => {
  const file = tempFile(t);
  writeFileSync(file, V1);
  const store = createStore();
  const saving = persist(store, file);
  assert.deepEqual(store.list().map((item) => [item.id, item.title, item.done, item.due_date, item.priority]), [
    [1, '舊資料', false, null, 'normal'],
    [3, 'older', true, '2026-03-01', 'normal'],
  ]);
  await saving.flush();
  assert.equal(readFileSync(file, 'utf8'), V1, 'loading alone must not rewrite the file');

  assert.equal(store.add({ title: 'new', priority: 'high' }).id, 4);
  await saving.flush();
  const data = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(data.version, 2);
  assert.deepEqual(data.items.map((item) => [item.id, item.priority]), [[1, 'normal'], [3, 'normal'], [4, 'high']]);
  saving.stop();

  const again = createStore();
  persist(again, file).stop();
  assert.deepEqual(again.list(), store.list());
});

test('hidden DEMO-203: other versions and bad priorities are refused, and the file is left as it is', (t) => {
  const item = { id: 1, title: 'a', done: false, due_date: null, priority: 'low' };
  const v2 = (over) => JSON.stringify({ version: 2, next_id: 2, items: [item], ...over });
  assert.equal(parse(v2({})).items[0].priority, 'low');
  const bad = [
    v2({ version: 3 }),
    v2({ version: 0 }),
    v2({ version: '2' }),
    JSON.stringify({ next_id: 2, items: [] }),
    v2({ items: [{ id: 1, title: 'a', done: false, due_date: null }] }),
    v2({ items: [{ ...item, priority: 'urgent' }] }),
    v2({ items: [{ ...item, priority: null }] }),
  ];
  for (const text of bad) {
    assert.throws(() => parse(text), StorageError, text);
    const file = tempFile(t);
    writeFileSync(file, text);
    assert.throws(() => persist(createStore(), file), StorageError, text);
    assert.equal(readFileSync(file, 'utf8'), text);
    assert.equal(existsSync(`${file}.tmp`), false);
  }
});

test('hidden DEMO-203: the README describes the priority, the filter, high_open and version 2', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  for (const word of [/priority/i, /high_open/, /version\W{0,4}2/i]) assert.match(readme, word);
});
