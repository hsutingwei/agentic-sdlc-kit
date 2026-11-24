import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError } from '../../src/todos.mjs';

test('hidden DEMO-107: PATCH titles are trimmed and still validated', () => {
  const store = createStore();
  store.add({ title: 'x' });
  assert.equal(store.update(1, { title: '  牛奶 milk \t' }).title, '牛奶 milk');
  assert.equal(store.get(1).title, '牛奶 milk');
  assert.throws(() => store.update(1, { title: '   ' }), ValidationError);
  assert.throws(() => store.update(1, { title: 'x'.repeat(201) }), ValidationError);
});
