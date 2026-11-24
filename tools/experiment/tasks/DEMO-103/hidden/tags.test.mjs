import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError } from '../../src/todos.mjs';

test('hidden DEMO-103: tags are normalised', () => {
  const store = createStore();
  assert.deepEqual(store.add({ title: 'a' }).tags, []);
  assert.deepEqual(store.add({ title: 'b', tags: [' home ', 'work', 'home', '家'] }).tags, ['home', 'work', '家']);
  assert.deepEqual(store.add({ title: 'c', tags: ['字'.repeat(30)] }).tags, ['字'.repeat(30)]);
  assert.deepEqual(store.add({ title: 'd', tags: ['a', 'b', 'c', 'd', 'e', 'a'] }).tags, ['a', 'b', 'c', 'd', 'e']);
});

test('hidden DEMO-103: bad tags are refused and change nothing', () => {
  const store = createStore();
  for (const bad of ['home', [1], [''], ['   '], ['a', 'b', 'c', 'd', 'e', 'f'], ['x'.repeat(31)], null]) {
    assert.throws(() => store.add({ title: 'x', tags: bad }), ValidationError, JSON.stringify(bad));
  }
  const item = store.add({ title: 'y', tags: ['keep'] });
  assert.equal(item.id, 1, 'refused items use no id');
  assert.deepEqual(store.update(item.id, { tags: ['new', ' new '] }).tags, ['new']);
  assert.throws(() => store.update(item.id, { tags: [42] }), ValidationError);
  assert.deepEqual(store.get(item.id).tags, ['new']);
  const copy = store.get(item.id);
  copy.tags.push('mutated');
  assert.deepEqual(store.get(item.id).tags, ['new'], 'callers cannot change stored tags');
});
