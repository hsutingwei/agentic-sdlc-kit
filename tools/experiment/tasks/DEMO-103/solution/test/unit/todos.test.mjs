import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError } from '../../src/todos.mjs';

test('add, list, get, update and remove', () => {
  const store = createStore();
  const a = store.add({ title: '  寫測試  ' });
  assert.deepEqual(a, { id: 1, title: '寫測試', done: false, tags: [] });
  store.add({ title: 'review' });
  assert.equal(store.list().length, 2);
  assert.deepEqual(store.update(1, { done: true }), { id: 1, title: '寫測試', done: true, tags: [] });
  assert.equal(store.get(1).done, true);
  assert.equal(store.remove(1), true);
  assert.equal(store.get(1), null);
  assert.equal(store.update(9, { done: true }), null);
});

test('titles are validated', () => {
  const store = createStore();
  assert.throws(() => store.add({}), ValidationError);
  assert.throws(() => store.add({ title: '   ' }), ValidationError);
  assert.throws(() => store.add({ title: '字'.repeat(201) }), ValidationError);
  const first = store.add({ title: '字'.repeat(200) });
  assert.equal(first.title.length, 200);
  assert.equal(first.id, 1, 'rejected items must not use up ids');
  assert.throws(() => store.update(1, { done: 'yes' }), ValidationError);
});

test('callers cannot mutate stored items', () => {
  const store = createStore();
  const todo = store.add({ title: 'x', tags: ['a'] });
  todo.title = 'changed';
  todo.tags.push('b');
  store.list()[0].done = true;
  assert.deepEqual(store.get(todo.id), { id: 1, title: 'x', done: false, tags: ['a'] });
});

test('tags are trimmed, unique, limited and validated', () => {
  const store = createStore();
  assert.deepEqual(store.add({ title: 'a', tags: [' home ', 'home', 'work'] }).tags, ['home', 'work']);
  assert.throws(() => store.add({ title: 'b', tags: 'home' }), ValidationError);
  assert.throws(() => store.add({ title: 'b', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }), ValidationError);
  assert.throws(() => store.add({ title: 'b', tags: ['x'.repeat(31)] }), ValidationError);
  assert.deepEqual(store.update(1, { tags: [] }).tags, []);
});
