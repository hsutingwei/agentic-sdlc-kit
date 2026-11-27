import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { persist, serialize } from '../../src/storage.mjs';
import { createStore } from '../../src/todos.mjs';

function tempFile(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'demo-api hidden 資料 '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'todos.json');
}

/** A write the test finishes by hand. `most()` is the largest number of writes in flight at once. */
function slowWriter() {
  const calls = [];
  let active = 0;
  let most = 0;
  const write = (text) =>
    new Promise((resolve, reject) => {
      active++;
      most = Math.max(most, active);
      const end = (settle) => (value) => {
        active--;
        settle(value);
      };
      calls.push({ text, resolve: end(resolve), reject: end(reject) });
    });
  return { calls, write, most: () => most };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until `check()` holds, for at most two seconds. */
async function until(check, what) {
  for (let i = 0; i < 200 && !check(); i++) await sleep(10);
  assert.ok(check(), `timed out waiting for: ${what}`);
}
/** `promise`, or a failure when it has not settled after two seconds. */
function within(promise, what) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for: ${what}`)), 2000);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
const titles = (text) => JSON.parse(text).items.map((item) => item.title);

test('hidden DEMO-204: a slow first write cannot overtake a later one', async (t) => {
  const { calls, write, most } = slowWriter();
  const store = createStore();
  const saving = persist(store, tempFile(t), { write });
  store.add({ title: 'a' });
  await until(() => calls.length >= 1, 'the first write');
  store.add({ title: 'b' });
  await sleep(50);
  assert.equal(calls.length, 1, 'a write started while another was in flight');
  calls[0].resolve();
  await until(() => calls.length >= 2, 'the write of the second change');
  assert.deepEqual(titles(calls[1].text), ['a', 'b']);
  calls[1].resolve();
  await within(saving.flush(), 'flush()');
  assert.equal(most(), 1);
  assert.deepEqual(titles(calls.at(-1).text), ['a', 'b'], 'the last write holds the latest state');
});

test('hidden DEMO-204: changes made during a write are saved by one write, not one each', async (t) => {
  const { calls, write, most } = slowWriter();
  const store = createStore();
  const saving = persist(store, tempFile(t), { write });
  store.add({ title: 'first' });
  await until(() => calls.length >= 1, 'the first write');
  for (const title of ['b', 'c', 'd', 'e', 'f']) store.add({ title });
  store.remove(2);
  await sleep(50);
  assert.equal(calls.length, 1);
  calls[0].resolve();
  await until(() => calls.length >= 2, 'the write of what changed meanwhile');
  calls[1].resolve();
  await within(saving.flush(), 'flush()');
  await sleep(50);
  assert.equal(calls.length, 2, 'six changes during one write are one more write');
  assert.deepEqual(titles(calls[1].text), ['first', 'c', 'd', 'e', 'f']);
  assert.equal(most(), 1);
});

test('hidden DEMO-204: flush() waits for the writes and resolves when there are none', async (t) => {
  const { calls, write } = slowWriter();
  const store = createStore();
  const saving = persist(store, tempFile(t), { write });
  await within(saving.flush(), 'flush()'); // nothing to write
  store.add({ title: 'a' });
  await until(() => calls.length >= 1, 'the first write');
  store.add({ title: 'b' });
  let flushed = false;
  const done = saving.flush().then(() => {
    flushed = true;
  });
  await sleep(50);
  assert.equal(flushed, false, 'flush() resolved while a write was in flight');
  calls[0].resolve();
  await until(() => calls.length >= 2, 'the second write');
  await sleep(50);
  assert.equal(flushed, false, 'flush() resolved before the last change was written');
  calls[1].resolve();
  await within(done, 'flush()');
  assert.equal(flushed, true);
});

test('hidden DEMO-204: a failed write is reported once and later changes are still saved', async (t) => {
  const { calls, write } = slowWriter();
  const errors = [];
  const store = createStore();
  const saving = persist(store, tempFile(t), { write, onError: (err) => errors.push(err.message) });
  store.add({ title: 'a' });
  await until(() => calls.length >= 1, 'the first write');
  calls[0].reject(new Error('disk full'));
  await within(saving.flush(), 'flush()'); // must resolve, not reject
  assert.deepEqual(errors, ['disk full']);

  store.add({ title: 'b' });
  await until(() => calls.length >= 2, 'a write after the failed one');
  store.add({ title: 'c' });
  calls[1].reject(new Error('still full'));
  await until(() => calls.length >= 3, 'a write of the change made during the failed one');
  assert.deepEqual(titles(calls[2].text), ['a', 'b', 'c']);
  calls[2].resolve();
  await within(saving.flush(), 'flush()');
  assert.deepEqual(errors, ['disk full', 'still full'], 'each failure is reported once');
});

test('hidden DEMO-204: on a real disk, many quick changes end with the last state; stop() ends the saving', async (t) => {
  const file = tempFile(t);
  const store = createStore();
  const saving = persist(store, file);
  for (let i = 0; i < 40; i++) store.add({ title: `項目 ${i}` });
  for (let i = 1; i <= 40; i += 2) store.remove(i);
  store.update(2, { done: true });
  await within(saving.flush(), 'flush()');
  assert.equal(readFileSync(file, 'utf8'), serialize(store.snapshot()));

  const again = createStore();
  persist(again, file).stop();
  assert.deepEqual(again.list(), store.list());

  const saved = readFileSync(file, 'utf8');
  saving.stop();
  store.add({ title: 'after stop' });
  await within(saving.flush(), 'flush()');
  assert.equal(readFileSync(file, 'utf8'), saved);
});
