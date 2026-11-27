import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError } from '../../src/todos.mjs';

test('add, list, get, update and remove', () => {
  const store = createStore();
  const a = store.add({ title: '  寫測試  ' });
  assert.deepEqual(a, { id: 1, title: '寫測試', done: false, due_date: null, repeat: null, repeat_day: null });
  store.add({ title: 'review', due_date: '2026-03-01' });
  assert.equal(store.list().length, 2);
  assert.deepEqual(store.update(1, { done: true }), { id: 1, title: '寫測試', done: true, due_date: null, repeat: null, repeat_day: null });
  assert.equal(store.get(1).done, true);
  assert.deepEqual(store.update(2, { due_date: null }), { id: 2, title: 'review', done: false, due_date: null, repeat: null, repeat_day: null });
  assert.equal(store.remove(1), true);
  assert.equal(store.get(1), null);
  assert.equal(store.update(9, { done: true }), null);
  assert.equal(store.remove(9), false);
});

test('titles, done and due dates are validated', () => {
  const store = createStore();
  assert.throws(() => store.add({}), ValidationError);
  assert.throws(() => store.add(null), ValidationError);
  assert.throws(() => store.add({ title: '   ' }), ValidationError);
  assert.throws(() => store.add({ title: '字'.repeat(201) }), ValidationError);
  assert.throws(() => store.add({ title: 'x', due_date: '2026-02-30' }), /due_date must be a date/);
  assert.throws(() => store.add({ title: 'x', due_date: '1/2/2026' }), ValidationError);
  const first = store.add({ title: '字'.repeat(200) });
  assert.equal(first.title.length, 200);
  assert.equal(first.id, 1, 'rejected items must not use up ids');
  assert.throws(() => store.update(1, { done: 'yes' }), ValidationError);
  assert.throws(() => store.update(1, { due_date: 'soon' }), ValidationError);
});

test('callers cannot mutate stored items', () => {
  const store = createStore();
  const todo = store.add({ title: 'x' });
  todo.title = 'changed';
  store.list()[0].done = true;
  assert.deepEqual(store.get(todo.id), { id: 1, title: 'x', done: false, due_date: null, repeat: null, repeat_day: null });
});

test('addMany adds every item or none', () => {
  const store = createStore();
  const added = store.addMany([{ title: 'a' }, { title: ' b ', done: true, due_date: '2026-01-31' }]);
  assert.deepEqual(added, [
    { id: 1, title: 'a', done: false, due_date: null, repeat: null, repeat_day: null },
    { id: 2, title: 'b', done: true, due_date: '2026-01-31', repeat: null, repeat_day: null },
  ]);
  assert.throws(() => store.addMany([{ title: 'c' }, { title: '' }]), /item 2: title must be a non-empty string/);
  assert.throws(() => store.addMany({ title: 'c' }), /items must be a list/);
  assert.equal(store.list().length, 2);
  assert.equal(store.add({ title: 'd' }).id, 3, 'a refused import uses up no id');
});

test('listeners hear every change and nothing else; a snapshot rebuilds the store', () => {
  const store = createStore();
  let calls = 0;
  const stop = store.onChange(() => calls++);
  store.add({ title: 'a' });
  store.update(1, { done: true });
  store.addMany([{ title: 'b' }, { title: 'c' }]);
  store.remove(2);
  assert.equal(calls, 4);
  store.remove(2);
  store.update(9, {});
  store.addMany([]);
  assert.throws(() => store.add({ title: '' }));
  assert.equal(calls, 4);

  const copy = createStore();
  copy.restore(store.snapshot());
  assert.deepEqual(copy.list(), store.list());
  assert.equal(copy.add({ title: 'd' }).id, 4);
  stop();
  store.add({ title: 'e' });
  assert.equal(calls, 4);
});
