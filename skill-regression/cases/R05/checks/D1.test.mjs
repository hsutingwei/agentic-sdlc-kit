import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/todos.mjs';

test('D1: PUT without done gives done false, even when the item was finished', () => {
  const store = createStore();
  store.add({ title: 'first' });
  store.update(1, { done: true });
  assert.equal(store.replace(1, { title: 'again' }).done, false);
});
