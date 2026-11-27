import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOverdue } from '../../src/dates.mjs';
import { parseQuery, select } from '../../src/query.mjs';
import { summarize } from '../../src/summary.mjs';

const todos = [
  { id: 1, title: 'due on the 10th', done: false, due_date: '2026-03-10' },
  { id: 2, title: 'done, due on the 9th', done: true, due_date: '2026-03-09' },
  { id: 3, title: 'no date', done: false, due_date: null },
];
const overdue = (day) => select(todos, parseQuery(new URLSearchParams('overdue=true')), day).map((t) => t.id);

test('an item is overdue from the day after it is due', () => {
  assert.equal(isOverdue(todos[0], '2026-03-09'), false);
  assert.equal(isOverdue(todos[0], '2026-03-10'), false, 'due today is not overdue');
  assert.equal(isOverdue(todos[0], '2026-03-11'), true);
  assert.equal(isOverdue(todos[1], '2026-03-11'), false);
  assert.equal(isOverdue(todos[2], '2026-03-11'), false);
});

test('the list and the summary agree on the day an item is due and the day after', () => {
  assert.deepEqual(overdue('2026-03-10'), []);
  assert.deepEqual(overdue('2026-03-11'), [1]);
  assert.deepEqual(summarize(todos, '2026-03-10'), { total: 3, done: 1, open: 2, overdue: 0, due_today: 1 });
  assert.deepEqual(summarize(todos, '2026-03-11'), { total: 3, done: 1, open: 2, overdue: 1, due_today: 0 });
});
