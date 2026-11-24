import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as todos from '../../src/todos.mjs';

test('hidden DEMO-106: TodoStore class with private state', () => {
  const { TodoStore, createStore, ValidationError } = todos;
  assert.equal(typeof TodoStore, 'function', 'TodoStore is exported');
  const store = createStore();
  assert.ok(store instanceof TodoStore);
  assert.ok(new TodoStore() instanceof TodoStore);
  assert.deepEqual(Object.keys(store), [], 'no public state');
  for (const m of ['list', 'get', 'add', 'update', 'remove']) assert.equal(typeof TodoStore.prototype[m], 'function', m);

  assert.throws(() => store.add({ title: ' ' }), ValidationError);
  const a = store.add({ title: ' a ' });
  assert.deepEqual(a, { id: 1, title: 'a', done: false });
  a.done = true;
  assert.equal(store.get(1).done, false);
  assert.deepEqual(store.update(1, { done: true }), { id: 1, title: 'a', done: true });
  assert.equal(store.remove(1), true);
  assert.equal(store.add({ title: 'b' }).id, 2, 'ids are not reused');
  assert.equal(new TodoStore().add({ title: 'c' }).id, 1, 'stores do not share state');
});
