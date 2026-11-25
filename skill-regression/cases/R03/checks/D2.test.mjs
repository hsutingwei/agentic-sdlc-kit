import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/todos.mjs';

test('D2: PATCH with note null removes the field', () => {
  const store = createStore();
  store.add({ title: 'a', note: 'remember' });
  store.update(1, { note: null });
  assert.equal('note' in store.get(1), false);
});
