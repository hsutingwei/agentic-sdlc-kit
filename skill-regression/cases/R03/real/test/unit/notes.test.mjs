import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError } from '../../src/todos.mjs';

test('DEMO-203 AC1: a note of up to 500 characters', () => {
  const store = createStore();
  assert.equal(store.add({ title: 'a', note: '字'.repeat(500) }).note.length, 500);
  assert.throws(() => store.add({ title: 'b', note: '字'.repeat(501) }), ValidationError);
  assert.throws(() => store.add({ title: 'c', note: 42 }), ValidationError);
  assert.throws(() => store.update(1, { note: ['x'] }), ValidationError);
  assert.equal(store.update(1, { note: 'short' }).note, 'short');
});

test('DEMO-203 AC2: the note field is there only with a note', () => {
  const store = createStore();
  assert.equal('note' in store.add({ title: 'plain' }), false);
  store.update(1, { note: 'remember' });
  store.update(1, { note: null });
  assert.equal('note' in store.get(1), false);
});
