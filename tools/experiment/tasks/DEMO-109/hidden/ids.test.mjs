import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/todos.mjs';

test('hidden DEMO-109: ids are never reused and nothing is overwritten', () => {
  const store = createStore();
  store.add({ title: 'one' });
  store.add({ title: 'two' });
  store.remove(1);
  const three = store.add({ title: 'three' });
  assert.equal(three.id, 3);
  assert.deepEqual(store.list().map((t) => t.title), ['two', 'three']);
  store.remove(3);
  store.remove(2);
  assert.equal(store.add({ title: 'four' }).id, 4);
  assert.throws(() => store.add({ title: '' }));
  assert.equal(store.add({ title: 'five' }).id, 5, 'refused items use no id');
});
