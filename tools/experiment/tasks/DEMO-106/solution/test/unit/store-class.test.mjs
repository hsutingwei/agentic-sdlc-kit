import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, TodoStore } from '../../src/todos.mjs';

test('createStore returns a TodoStore without public state', () => {
  const store = createStore();
  assert.ok(store instanceof TodoStore);
  assert.deepEqual(Object.keys(store), []);
  store.add({ title: 'x' });
  assert.equal(new TodoStore().list().length, 0, 'stores do not share state');
});
