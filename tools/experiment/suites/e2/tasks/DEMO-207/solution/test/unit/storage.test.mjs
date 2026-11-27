import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, persist, serialize, StorageError } from '../../src/storage.mjs';
import { createStore } from '../../src/todos.mjs';

function tempFile(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'demo-api 資料 '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'data', 'todos.json');
}

test('a snapshot survives serialize and parse', () => {
  const store = createStore();
  store.add({ title: '買牛奶', due_date: '2026-03-01' });
  store.add({ title: 'b' });
  store.remove(2);
  const snapshot = store.snapshot();
  assert.deepEqual(parse(serialize(snapshot)), snapshot);
  assert.deepEqual(JSON.parse(serialize(snapshot)), { version: 1, next_id: 3, items: [{ id: 1, title: '買牛奶', done: false, due_date: '2026-03-01', repeat: null, repeat_day: null }] });
});

test('a data file that cannot be read as version 1 is refused', () => {
  const item = { id: 1, title: 'a', done: false, due_date: null };
  const file = (over) => JSON.stringify({ version: 1, next_id: 2, items: [item], ...over });
  assert.deepEqual(parse(file({})).items, [{ ...item, repeat: null, repeat_day: null }], 'a file from before items could repeat');
  const monthly = { ...item, due_date: '2026-02-28', repeat: 'monthly', repeat_day: 31 };
  assert.deepEqual(parse(file({ items: [monthly] })).items, [monthly]);
  for (const bad of [
    '{ not json',
    'null',
    file({ version: 2 }),
    file({ items: 'none' }),
    file({ next_id: 1 }),
    file({ items: [item, item] }),
    file({ items: [{ ...item, done: 'no' }] }),
    file({ items: [{ ...item, due_date: '2026-02-30' }] }),
    file({ items: [{ ...item, id: 0 }] }),
    file({ items: [{ ...item, repeat: 'weekly' }] }),
    file({ items: [{ ...item, repeat: 'monthly', repeat_day: 31 }] }),
    file({ items: [{ ...item, due_date: '2026-02-28', repeat: 'monthly' }] }),
    file({ items: [{ ...item, due_date: '2026-02-28', repeat: 'monthly', repeat_day: 32 }] }),
  ]) {
    assert.throws(() => parse(bad), StorageError, bad);
  }
});

test('the store is saved after a change and loaded again', async (t) => {
  const file = tempFile(t);
  const store = createStore();
  const saving = persist(store, file);
  assert.equal(existsSync(file), false, 'nothing is written before the first change');
  store.add({ title: '寫測試' });
  await saving.flush();
  store.update(1, { done: true });
  await saving.flush();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).items[0].done, true);

  const again = createStore();
  persist(again, file).stop();
  assert.deepEqual(again.list(), store.list());
  assert.equal(again.add({ title: 'next' }).id, 2);

  saving.stop();
  store.remove(1);
  await saving.flush();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).items.length, 1, 'nothing is saved after stop()');
});

test('a data file that cannot be read stops the start and is left as it is', (t) => {
  const file = tempFile(t);
  persist(createStore(), file).stop(); // creates the folder
  writeFileSync(file, '{ "version": 9 }');
  assert.throws(() => persist(createStore(), file), StorageError);
  assert.equal(readFileSync(file, 'utf8'), '{ "version": 9 }');
});

test('a write that fails is reported', async (t) => {
  const file = tempFile(t);
  const errors = [];
  const store = createStore();
  const saving = persist(store, file, {
    write: async () => {
      throw new Error('disk full');
    },
    onError: (err) => errors.push(err.message),
  });
  store.add({ title: 'a' });
  await saving.flush();
  assert.deepEqual(errors, ['disk full']);
});
