import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, LimitError } from '../../src/todos.mjs';

test('DEMO-207: at most 100 items; deleting makes room', () => {
  const store = createStore();
  for (let i = 0; i < 100; i++) store.add({ title: `item ${i}` });
  assert.throws(() => store.add({ title: 'one too many' }), LimitError);
  assert.equal(store.list().length, 100);
  store.remove(1);
  assert.equal(store.add({ title: 'room again' }).title, 'room again');
});
