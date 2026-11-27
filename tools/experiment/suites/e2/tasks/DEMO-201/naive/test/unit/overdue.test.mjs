import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, select } from '../../src/query.mjs';

const todos = [
  { id: 1, title: 'due on the 10th', done: false, due_date: '2026-03-10' },
  { id: 2, title: 'done, due on the 9th', done: true, due_date: '2026-03-09' },
];
const overdue = (day) => select(todos, parseQuery(new URLSearchParams('overdue=true')), day).map((t) => t.id);

test('an item is listed as overdue from the day after it is due', () => {
  assert.deepEqual(overdue('2026-03-10'), [], 'due today is not overdue');
  assert.deepEqual(overdue('2026-03-11'), [1]);
});
