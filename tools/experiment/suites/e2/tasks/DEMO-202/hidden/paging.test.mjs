import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from '../../src/server.mjs';

// Twelve items: odd ids are open, even ids done; ids 3, 6, 9 and 12 have "report" in the title.
async function withApi(fn) {
  const server = createServer({ now: () => new Date('2026-03-10T12:00:00Z') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const items = Array.from({ length: 12 }, (_, i) => ({ title: (i + 1) % 3 === 0 ? `Report ${i + 1}` : `item ${i + 1}`, done: (i + 1) % 2 === 0 }));
  assert.equal((await fetch(`${base}/todos/import`, { method: 'POST', body: JSON.stringify({ items }) })).status, 201);
  const list = async (query) => {
    const res = await fetch(`${base}/todos${query}`);
    const body = await res.json();
    return { status: res.status, total: res.headers.get('x-total-count'), ids: res.status === 200 ? body.map((t) => t.id) : undefined, error: body.error };
  };
  try {
    return await fn(list, base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const page = (ids, total) => ({ status: 200, total: String(total), ids, error: undefined });

test('hidden DEMO-202: limit and offset page the list in id order, each also alone', () =>
  withApi(async (list) => {
    assert.deepEqual(await list('?limit=5'), page([1, 2, 3, 4, 5], 12));
    assert.deepEqual(await list('?limit=5&offset=5'), page([6, 7, 8, 9, 10], 12));
    assert.deepEqual(await list('?offset=10&limit=5'), page([11, 12], 12));
    assert.deepEqual(await list('?offset=9'), page([10, 11, 12], 12));
    assert.deepEqual(await list('?limit=100&offset=0'), page([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 12));
    assert.deepEqual(await list('?limit=1&offset=11'), page([12], 12));
  }));

test('hidden DEMO-202: the page is cut after the filters', () =>
  withApi(async (list) => {
    assert.deepEqual((await list('?done=false&limit=2&offset=1')).ids, [3, 5]);
    assert.deepEqual((await list('?q=report&limit=2')).ids, [3, 6]);
    assert.deepEqual((await list('?q=report&done=true&offset=1')).ids, [12]);
  }));

test('hidden DEMO-202: X-Total-Count is the number of items that pass the filters', () =>
  withApi(async (list) => {
    assert.equal((await list('')).total, '12');
    assert.equal((await list('?limit=1')).total, '12');
    assert.equal((await list('?done=false')).total, '6');
    assert.equal((await list('?done=false&limit=2&offset=1')).total, '6');
    assert.equal((await list('?q=report&limit=1')).total, '4');
    assert.equal((await list('?q=nothing')).total, '0');
  }));

test('hidden DEMO-202: an offset past the end is an empty list with the count', () =>
  withApi(async (list) => {
    assert.deepEqual(await list('?offset=12'), page([], 12));
    assert.deepEqual(await list('?offset=5000&limit=10'), page([], 12));
    assert.deepEqual(await list('?done=true&offset=6'), page([], 6));
  }));

test('hidden DEMO-202: numbers out of range answer 400 and name the parameter', () =>
  withApi(async (list) => {
    for (const [query, name] of [['?limit=0', 'limit'], ['?limit=101', 'limit'], ['?limit=-1', 'limit'], ['?offset=-1', 'offset'], ['?limit=1.5', 'limit'], ['?offset=2.5', 'offset'], ['?limit=abc', 'limit']]) {
      const res = await list(query);
      assert.equal(res.status, 400, query);
      assert.match(res.error, new RegExp(name), query);
    }
  }));

test('hidden DEMO-202: anything but decimal digits, an empty value or a repeated parameter answers 400', () =>
  withApi(async (list) => {
    for (const [query, name] of [['?limit=1e2', 'limit'], ['?offset=1e1', 'offset'], ['?limit=', 'limit'], ['?offset=', 'offset'], ['?limit=0x10', 'limit'], ['?limit=%205', 'limit'], ['?limit=5&limit=5', 'limit'], ['?offset=1&offset=2', 'offset'], ['?limit=10&offset=', 'offset']]) {
      const res = await list(query);
      assert.equal(res.status, 400, query);
      assert.match(res.error, new RegExp(name), query);
    }
  }));

test('hidden DEMO-202: without limit and offset the body is unchanged; the other routes too', () =>
  withApi(async (list, base) => {
    const all = await (await fetch(`${base}/todos`)).json();
    assert.equal(all.length, 12);
    assert.deepEqual(all[0], { id: 1, title: 'item 1', done: false, due_date: null });
    assert.equal((await list('?page=2')).status, 400);
    assert.equal((await fetch(`${base}/todos/3`)).status, 200);
    assert.equal((await (await fetch(`${base}/summary`)).json()).total, 12);
  }));

test('hidden DEMO-202: the README describes limit, offset and the header', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  for (const word of [/\blimit\b/, /\boffset\b/, /x-total-count/i]) assert.match(readme, word);
});
