import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError } from '../../src/todos.mjs';

test('DEMO-205 AC1: PUT replaces the item, done defaults to false', () => {
  const store = createStore();
  store.add({ title: 'first' });
  store.update(1, { done: true });
  assert.deepEqual(store.replace(1, { title: 'second' }), { id: 1, title: 'second', done: false });
  assert.deepEqual(store.replace(1, { title: 'third', done: true }), { id: 1, title: 'third', done: true });
  assert.throws(() => store.replace(1, { title: '' }), ValidationError);
  assert.throws(() => store.replace(1, { title: 'x', done: 'yes' }), ValidationError);
});

test('DEMO-205 AC2: an unknown id answers null and creates nothing', () => {
  const store = createStore();
  assert.equal(store.replace(7, { title: 'ghost' }), null);
  assert.equal(store.list().length, 0);
});
