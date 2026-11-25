import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/todos.mjs';

test('D1: 500 Chinese characters fit in a note', () => {
  assert.equal(createStore().add({ title: 'a', note: '字'.repeat(500) }).note.length, 500);
});
