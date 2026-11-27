import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isDate, today } from '../../src/dates.mjs';
import { parseQuery, select } from '../../src/query.mjs';
import { summarize } from '../../src/summary.mjs';
import { ValidationError } from '../../src/todos.mjs';

const DAY = '2026-03-10';
const todos = [
  { id: 1, title: 'Quarterly Report', done: false, due_date: '2026-03-01', priority: 'high' },
  { id: 2, title: '買牛奶', done: true, due_date: '2026-03-01', priority: 'high' },
  { id: 3, title: 'report the bug', done: false, due_date: '2026-04-01', priority: 'normal' },
  { id: 4, title: 'no date', done: false, due_date: null, priority: 'normal' },
];
const ids = (query) => select(todos, parseQuery(new URLSearchParams(query)), DAY).map((t) => t.id);

test('dates are real calendar dates in UTC', () => {
  assert.equal(isDate('2028-02-29'), true);
  for (const bad of ['2026-02-29', '2026-13-01', '2026-1-1', '20260101', '', null, 20260101]) assert.equal(isDate(bad), false, String(bad));
  assert.equal(today(new Date('2026-03-10T23:59:59Z')), '2026-03-10');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('the list filters by done, overdue and title', () => {
  assert.deepEqual(ids(''), [1, 2, 3, 4]);
  assert.deepEqual(ids('done=true'), [2]);
  assert.deepEqual(ids('done=false'), [1, 3, 4]);
  assert.deepEqual(ids('overdue=true'), [1], 'done items and items without a date are never overdue');
  assert.deepEqual(ids('q=report'), [1, 3]);
  assert.deepEqual(ids('q=report&overdue=true'), [1]);
  assert.deepEqual(ids('q=%E7%89%9B%E5%A5%B6'), [2]);
  assert.deepEqual(ids('q=++'), [1, 2, 3, 4], 'a search of spaces only is no search');
  assert.deepEqual(ids('priority=high'), [1, 2]);
  assert.deepEqual(ids('priority=high&done=false'), [1]);
  assert.deepEqual(ids('priority=low'), []);
});

test('query parameters are validated', () => {
  for (const bad of ['done=yes', 'overdue=false', 'page=2', 'priority=urgent', 'priority=']) {
    assert.throws(() => parseQuery(new URLSearchParams(bad)), ValidationError, bad);
  }
});

test('the summary counts items', () => {
  assert.deepEqual(summarize(todos, DAY), { total: 4, done: 1, open: 3, overdue: 1, due_today: 0, high_open: 1 });
  assert.equal(summarize(todos, '2026-04-01').due_today, 1);
  assert.deepEqual(summarize([], DAY), { total: 0, done: 0, open: 0, overdue: 0, due_today: 0, high_open: 0 });
});
