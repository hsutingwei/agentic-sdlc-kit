import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';
import { createStore } from '../../src/todos.mjs';

// One store, looked at on two days: the 10th and the 11th of March 2026 (UTC).
async function onDay(store, iso, fn) {
  const server = createServer({ store, now: () => new Date(iso) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const get = async (path) => (await fetch(`http://127.0.0.1:${server.address().port}${path}`)).json();
  try {
    return await fn(get);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function filled() {
  const store = createStore();
  store.add({ title: 'yesterday', due_date: '2026-03-09' });
  store.add({ title: 'today', due_date: '2026-03-10' });
  store.add({ title: 'tomorrow', due_date: '2026-03-11' });
  store.add({ title: 'done yesterday', due_date: '2026-03-09' });
  store.update(4, { done: true });
  store.add({ title: 'no date' });
  return store;
}

test('hidden DEMO-201: the list does not show an item due today as overdue', async () => {
  const store = filled();
  const late = await onDay(store, '2026-03-10T00:00:00Z', (get) => get('/todos?overdue=true'));
  assert.deepEqual(late.map((t) => t.title), ['yesterday']);
  const lateAtNight = await onDay(store, '2026-03-10T23:59:59Z', (get) => get('/todos?overdue=true'));
  assert.deepEqual(lateAtNight.map((t) => t.title), ['yesterday']);
  const nextDay = await onDay(store, '2026-03-11T00:00:00Z', (get) => get('/todos?overdue=true'));
  assert.deepEqual(nextDay.map((t) => t.title), ['yesterday', 'today']);
});

test('hidden DEMO-201: the summary does not count an item due today as overdue', async () => {
  const store = filled();
  const today = await onDay(store, '2026-03-10T12:00:00Z', (get) => get('/summary'));
  assert.deepEqual([today.overdue, today.due_today], [1, 1]);
  const nextDay = await onDay(store, '2026-03-11T12:00:00Z', (get) => get('/summary'));
  assert.deepEqual([nextDay.overdue, nextDay.due_today], [2, 1]);
});
