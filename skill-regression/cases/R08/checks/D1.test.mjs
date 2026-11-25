import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/todos.mjs';

test('D1: an unknown field after a known one is refused and nothing changes', () => {
  const store = createStore();
  store.add({ title: 'keep' });
  assert.throws(() => store.update(1, { title: 'changed', colour: 'red' }));
  assert.equal(store.get(1).title, 'keep');
});
