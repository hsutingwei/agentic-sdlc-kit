import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../../src/server.mjs';
import { parse, persist } from '../../src/storage.mjs';
import { createStore } from '../../src/todos.mjs';

async function withApi(fn, store = createStore()) {
  const server = createServer({ store, now: () => new Date('2026-01-10T12:00:00Z') });
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
const monthly = (title, due_date) => ({ title, due_date, repeat: 'monthly' });
const titled = async (call, title) => (await call('GET', '/todos')).body.filter((t) => t.title === title);
/** Marks the open item with this title done, `times` times; returns the due dates the series went through. */
async function series(call, title, times) {
  for (let i = 0; i < times; i++) {
    const open = (await titled(call, title)).filter((t) => !t.done);
    assert.equal(open.length, 1, `one open item titled ${title}`);
    assert.equal((await call('PATCH', `/todos/${open[0].id}`, { done: true })).status, 200);
  }
  return (await titled(call, title)).map((t) => t.due_date);
}

test('hidden DEMO-207: repeat is null or monthly, on POST and PATCH', () =>
  withApi(async (call) => {
    assert.equal((await call('POST', '/todos', { title: 'plain' })).body.repeat, null);
    const rent = await call('POST', '/todos', monthly('rent', '2026-01-15'));
    assert.deepEqual([rent.status, rent.body.repeat, rent.body.due_date, rent.body.done], [201, 'monthly', '2026-01-15', false]);
    assert.equal((await call('PATCH', '/todos/2', { repeat: null })).body.repeat, null);
    assert.equal((await call('PATCH', '/todos/2', { repeat: 'monthly' })).body.repeat, 'monthly');
    assert.equal((await call('GET', '/todos/2')).body.repeat, 'monthly');
    for (const bad of ['weekly', 'Monthly', '', true, 1]) {
      assert.equal((await call('POST', '/todos', { title: 'x', due_date: '2026-01-15', repeat: bad })).status, 400, `POST ${JSON.stringify(bad)}`);
      assert.equal((await call('PATCH', '/todos/2', { repeat: bad })).status, 400, `PATCH ${JSON.stringify(bad)}`);
    }
    assert.equal((await call('POST', '/todos', { title: 'next' })).body.id, 3, 'a refused item uses up no id');
  }));

test('hidden DEMO-207: a repeating item needs a due date', () =>
  withApi(async (call) => {
    assert.equal((await call('POST', '/todos', { title: 'no date', repeat: 'monthly' })).status, 400);
    assert.equal((await call('POST', '/todos', { title: 'no date', repeat: 'monthly', due_date: null })).status, 400);
    await call('POST', '/todos', { title: 'plain' });
    assert.equal((await call('PATCH', '/todos/1', { repeat: 'monthly' })).status, 400);
    assert.equal((await call('PATCH', '/todos/1', { repeat: 'monthly', due_date: '2026-02-01' })).status, 200);
    assert.equal((await call('PATCH', '/todos/1', { due_date: null })).status, 400);
    const kept = (await call('GET', '/todos/1')).body;
    assert.deepEqual([kept.repeat, kept.due_date], ['monthly', '2026-02-01'], 'a refused change changes nothing');
    const freed = await call('PATCH', '/todos/1', { repeat: null, due_date: null });
    assert.deepEqual([freed.status, freed.body.repeat, freed.body.due_date], [200, null, null]);
  }));

test('hidden DEMO-207: marking a repeating item done creates the next one, once', () =>
  withApi(async (call) => {
    await call('POST', '/todos', monthly('付房租', '2026-03-05'));
    await call('POST', '/todos', { title: 'once', due_date: '2026-03-05' });
    const answer = await call('PATCH', '/todos/1', { done: true });
    assert.deepEqual([answer.status, answer.body.id, answer.body.done, answer.body.due_date], [200, 1, true, '2026-03-05'], 'the answer is the changed item');
    const rent = await titled(call, '付房租');
    assert.deepEqual(rent.map((t) => [t.done, t.due_date, t.repeat]), [[true, '2026-03-05', 'monthly'], [false, '2026-04-05', 'monthly']]);

    await call('PATCH', '/todos/1', { done: true });
    await call('PATCH', '/todos/1', { title: '付房租' });
    assert.equal((await titled(call, '付房租')).length, 2, 'an item that is done already creates nothing');
    await call('PATCH', '/todos/2', { done: true });
    assert.equal((await call('GET', '/todos')).body.length, 3, 'an item that does not repeat creates nothing');
    assert.deepEqual((await call('GET', '/summary')).body.total, 3);
  }));

test('hidden DEMO-207: December is followed by January of the next year', () =>
  withApi(async (call) => {
    await call('POST', '/todos', monthly('a', '2026-11-15'));
    assert.deepEqual(await series(call, 'a', 3), ['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15']);
  }));

test('hidden DEMO-207: a short month gives its last day', () =>
  withApi(async (call) => {
    await call('POST', '/todos', monthly('a', '2026-01-31'));
    assert.deepEqual(await series(call, 'a', 1), ['2026-01-31', '2026-02-28']);
    await call('POST', '/todos', monthly('leap', '2028-01-30'));
    assert.deepEqual(await series(call, 'leap', 1), ['2028-01-30', '2028-02-29']);
    await call('POST', '/todos', monthly('b', '2026-03-31'));
    assert.deepEqual(await series(call, 'b', 1), ['2026-03-31', '2026-04-30']);
  }));

test('hidden DEMO-207: after a short month the series goes back to its own day', () =>
  withApi(async (call) => {
    await call('POST', '/todos', monthly('a', '2026-01-31'));
    assert.deepEqual(await series(call, 'a', 5), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
    await call('POST', '/todos', monthly('b', '2026-01-29'));
    assert.deepEqual(await series(call, 'b', 2), ['2026-01-29', '2026-02-28', '2026-03-29']);
    await call('POST', '/todos', monthly('leap', '2028-01-31'));
    assert.deepEqual(await series(call, 'leap', 2), ['2028-01-31', '2028-02-29', '2028-03-31']);
  }));

test('hidden DEMO-207: the day of the series is set with repeat and again with a changed due date', () =>
  withApi(async (call) => {
    await call('POST', '/todos', monthly('moved', '2026-01-31'));
    await call('PATCH', '/todos/1', { due_date: '2026-02-15' });
    assert.deepEqual(await series(call, 'moved', 2), ['2026-02-15', '2026-03-15', '2026-04-15']);

    await call('POST', '/todos', { title: 'late', due_date: '2026-03-31' });
    const id = (await titled(call, 'late'))[0].id;
    await call('PATCH', `/todos/${id}`, { repeat: 'monthly' });
    assert.deepEqual(await series(call, 'late', 2), ['2026-03-31', '2026-04-30', '2026-05-31']);
  }));

test('hidden DEMO-207: the import takes repeat too', () =>
  withApi(async (call) => {
    const res = await call('POST', '/todos/import', { items: [monthly('imported', '2026-01-31'), { ...monthly('old', '2026-01-31'), done: true }, { title: 'plain' }] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.map((t) => t.repeat), ['monthly', 'monthly', null]);
    assert.equal((await call('GET', '/todos')).body.length, 3, 'an item imported as done creates nothing');
    assert.equal((await call('POST', '/todos/import', { items: [{ title: 'ok' }, { title: 'no date', repeat: 'monthly' }] })).status, 400);
    assert.equal((await call('POST', '/todos/import', { items: [{ title: 'ok' }, { ...monthly('x', '2026-01-31'), repeat: 'weekly' }] })).status, 400);
    assert.equal((await call('GET', '/todos')).body.length, 3, 'a refused import adds nothing');
    assert.deepEqual(await series(call, 'imported', 2), ['2026-01-31', '2026-02-28', '2026-03-31']);
  }));

test('hidden DEMO-207: repeat and the day of the series survive a restart from the data file', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'demo-api hidden 資料 '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'todos.json');

  const first = createStore();
  const saving = persist(first, file);
  first.add(monthly('rent', '2026-01-31'));
  await saving.flush();
  first.update(1, { done: true });
  await saving.flush();
  saving.stop();
  assert.deepEqual(first.list().map((item) => item.due_date), ['2026-01-31', '2026-02-28']);

  const second = createStore();
  const savingAgain = persist(second, file);
  assert.deepEqual(second.list().map((item) => [item.title, item.done, item.due_date, item.repeat]), [['rent', true, '2026-01-31', 'monthly'], ['rent', false, '2026-02-28', 'monthly']]);
  await withApi(async (call) => {
    assert.deepEqual(await series(call, 'rent', 1), ['2026-01-31', '2026-02-28', '2026-03-31']);
  }, second);
  await savingAgain.flush();
  savingAgain.stop();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).items.length, 3);
});

test('hidden DEMO-207: a data file from before this change still loads, its items not repeating', () => {
  const old = JSON.stringify({ version: 1, next_id: 3, items: [{ id: 1, title: '舊資料', done: false, due_date: '2026-01-31' }, { id: 2, title: 'b', done: true, due_date: null }] });
  const store = createStore();
  store.restore(parse(old));
  assert.deepEqual(store.list().map((item) => [item.id, item.title, item.repeat]), [[1, '舊資料', null], [2, 'b', null]]);
  store.update(1, { done: true });
  assert.equal(store.list().length, 2);
});

test('hidden DEMO-207: the README describes repeat', () => {
  assert.match(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), /repeat/i);
  assert.match(readFileSync(new URL('../../README.md', import.meta.url), 'utf8'), /monthly/i);
});
