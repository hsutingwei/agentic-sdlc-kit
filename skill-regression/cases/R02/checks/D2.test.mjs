import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/todos.mjs';

test('D2: removeDone answers how many items it removed', () => {
  const store = createStore();
  store.add({ title: 'open' });
  store.add({ title: 'also open' });
  store.add({ title: 'finished' });
  store.update(3, { done: true });
  assert.equal(store.removeDone(), 1);
});
