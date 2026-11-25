import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError } from '../../src/todos.mjs';

test('DEMO-208 AC1: unknown fields are refused and nothing changes', () => {
  const store = createStore();
  store.add({ title: 'keep' });
  for (const patch of [{ colour: 'red' }, { title: 'changed', colour: 'red' }, { done: true, priority: 1 }]) {
    assert.throws(() => store.update(1, patch), (err) => err instanceof ValidationError && /^unknown field (colour|priority)$/.test(err.message), JSON.stringify(patch));
  }
  assert.deepEqual(store.get(1), { id: 1, title: 'keep', done: false });
});

test('DEMO-208 AC2: title and done still work', () => {
  const store = createStore();
  store.add({ title: 'a' });
  assert.deepEqual(store.update(1, { title: 'b', done: true }), { id: 1, title: 'b', done: true });
});
