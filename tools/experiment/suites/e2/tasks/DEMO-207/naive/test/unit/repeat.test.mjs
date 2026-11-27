import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthLater } from '../../src/dates.mjs';
import { createStore, ValidationError } from '../../src/todos.mjs';

const open = (store) => store.list().filter((t) => !t.done);
/** The due dates a series goes through when its open item is marked done `times` times. */
function series(store, id, times) {
  const dates = [store.get(id).due_date];
  for (let i = 0; i < times; i++) {
    store.update(open(store).at(-1).id, { done: true });
    dates.push(open(store).at(-1).due_date);
  }
  return dates;
}

test('repeat is null or monthly, and needs a due date', () => {
  const store = createStore();
  assert.equal(store.add({ title: 'a' }).repeat, null);
  assert.equal(store.add({ title: 'rent', due_date: '2026-01-31', repeat: 'monthly' }).repeat, 'monthly');
  assert.throws(() => store.add({ title: 'x', repeat: 'weekly' }), /repeat must be "monthly" or null/);
  assert.throws(() => store.add({ title: 'x', repeat: 'monthly' }), /a repeating item needs a due date/);
  assert.throws(() => store.update(1, { repeat: 'monthly' }), ValidationError);
  assert.throws(() => store.update(2, { due_date: null }), ValidationError);
  assert.equal(store.update(2, { repeat: null, due_date: null }).repeat, null);
  assert.equal(store.add({ title: 'y' }).id, 3, 'a refused item uses up no id');
});

test('marking a repeating item done creates the next one, once', () => {
  const store = createStore();
  store.add({ title: 'rent', due_date: '2026-12-15', repeat: 'monthly' });
  assert.deepEqual(store.update(1, { done: true }), { id: 1, title: 'rent', done: true, due_date: '2026-12-15', repeat: 'monthly', repeat_day: 15 });
  assert.deepEqual(store.list()[1], { id: 2, title: 'rent', done: false, due_date: '2027-01-15', repeat: 'monthly', repeat_day: 15 });
  store.update(1, { done: true });
  store.update(1, { title: 'rent paid' });
  assert.equal(store.list().length, 2);
  store.add({ title: 'once', due_date: '2026-12-15' });
  store.update(3, { done: true });
  assert.equal(store.list().length, 3);
});

test('a short month gives its last day', () => {
  assert.equal(monthLater('2026-01-31', 31), '2026-02-28');
  assert.equal(monthLater('2028-01-31', 31), '2028-02-29');
  assert.equal(monthLater('2026-12-31', 31), '2027-01-31');
  const store = createStore();
  store.add({ title: 'rent', due_date: '2026-01-31', repeat: 'monthly' });
  assert.deepEqual(series(store, 1, 1), ['2026-01-31', '2026-02-28']);
  store.add({ title: 'gym', due_date: '2026-03-15', repeat: 'monthly' });
  assert.deepEqual(series(store, 3, 2), ['2026-03-15', '2026-04-15', '2026-05-15']);
});

test('the day of the series follows a changed due date and an import', () => {
  const store = createStore();
  store.add({ title: 'rent', due_date: '2026-01-31', repeat: 'monthly' });
  store.update(1, { due_date: '2026-02-15' });
  assert.deepEqual(series(store, 1, 1), ['2026-02-15', '2026-03-15']);
  const [imported, done] = store.addMany([{ title: 'gym', due_date: '2026-01-30', repeat: 'monthly' }, { title: 'old', due_date: '2026-01-31', repeat: 'monthly', done: true }]);
  assert.deepEqual([imported.repeat_day, done.repeat_day, store.list().length], [30, 31, 4], 'an item imported as done creates nothing');
  assert.throws(() => store.addMany([{ title: 'x', repeat: 'monthly' }]), /item 1: a repeating item needs a due date/);
});
