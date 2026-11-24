import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/todos.mjs';

test('a title changed later is trimmed like a new one', () => {
  const store = createStore();
  store.add({ title: 'milk' });
  assert.equal(store.update(1, { title: '  milk  ' }).title, 'milk');
});
