import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, ValidationError } from '../src/todos.mjs';

test('AC1: due_date accepts YYYY-MM-DD and rejects anything else', () => {
  const store = createStore();
  assert.equal(store.add({ title: 'a', due_date: '2026-11-30' }).due_date, '2026-11-30');
  for (const bad of ['2026-02-30', '30/11/2026', '2026-11-30T00:00:00Z', 20261130]) {
    assert.throws(() => store.add({ title: 'b', due_date: bad }), ValidationError, String(bad));
  }
  assert.equal(store.update(1, { due_date: '2026-12-01' }).due_date, '2026-12-01');
  assert.throws(() => store.update(1, { due_date: 'soon' }), ValidationError);
});

test('AC2: overdue lists open items due before today', () => {
  const store = createStore();
  store.add({ title: 'late', due_date: '2026-11-01' });
  store.add({ title: 'late but done', due_date: '2026-11-01' });
  store.update(2, { done: true });
  store.add({ title: 'due today', due_date: '2026-11-23' });
  store.add({ title: 'no date' });
  assert.deepEqual(store.list({ overdue: true, today: '2026-11-23' }).map((t) => t.title), ['late']);
  assert.equal(store.list({ today: '2026-11-23' }).length, 4);
});

test('AC3: items without a due date have due_date null', () => {
  assert.equal(createStore().add({ title: 'x' }).due_date, null);
});
