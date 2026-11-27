import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page, parseQuery } from '../../src/query.mjs';
import { ValidationError } from '../../src/todos.mjs';

const parse = (query) => parseQuery(new URLSearchParams(query));
const items = [1, 2, 3, 4, 5];

test('limit and offset are read as whole numbers in their range', () => {
  assert.deepEqual(parse('limit=1&offset=0'), { limit: 1, offset: 0 });
  assert.deepEqual(parse('limit=100'), { limit: 100 });
  for (const bad of ['limit=0', 'limit=101', 'limit=-1', 'limit=1.5', 'limit=abc', 'offset=-1', 'offset=abc']) {
    assert.throws(() => parse(bad), (err) => err instanceof ValidationError && err.message.startsWith(bad.split('=')[0]), bad);
  }
});

test('a page is cut from the filtered items', () => {
  assert.deepEqual(page(items, {}), items);
  assert.deepEqual(page(items, { limit: 2 }), [1, 2]);
  assert.deepEqual(page(items, { offset: 3 }), [4, 5]);
  assert.deepEqual(page(items, { limit: 2, offset: 4 }), [5]);
  assert.deepEqual(page(items, { limit: 2, offset: 9 }), []);
});
