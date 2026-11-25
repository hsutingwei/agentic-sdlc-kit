import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/todos.mjs';

test('D1: the 101st item is refused', () => {
  const store = createStore();
  for (let i = 0; i < 100; i++) store.add({ title: `item ${i}` });
  assert.throws(() => store.add({ title: 'one too many' }));
  assert.equal(store.list().length, 100);
});
