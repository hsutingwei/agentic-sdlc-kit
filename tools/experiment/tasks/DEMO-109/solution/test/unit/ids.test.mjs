import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/todos.mjs';

test('after a delete, a new item gets a new id and replaces nothing', () => {
  const store = createStore();
  store.add({ title: 'one' });
  store.add({ title: 'two' });
  store.remove(1);
  assert.equal(store.add({ title: 'three' }).id, 3);
  assert.deepEqual(store.list().map((t) => t.title), ['two', 'three']);
});
