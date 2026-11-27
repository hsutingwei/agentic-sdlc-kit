// Keeps the store in a JSON data file:
//
//   { "version": 1, "next_id": 3, "items": [{ "id": 1, "title": "...", "done": false, "due_date": null }] }
//
// A repeating item also has "repeat": "monthly" and "repeat_day", the day of the
// month its series keeps. Files written before items could repeat have neither;
// their items do not repeat.
//
// A file this program cannot read is never replaced: loading throws StorageError
// and nothing is written.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDate } from './dates.mjs';

export const VERSION = 1;

export class StorageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StorageError';
  }
}

function validRepeat(item) {
  if (item.repeat === undefined || item.repeat === null) return true;
  return item.repeat === 'monthly' && item.due_date !== null && Number.isInteger(item.repeat_day) && item.repeat_day >= 1 && item.repeat_day <= 31;
}

function validItem(item) {
  return (
    Number.isInteger(item?.id) &&
    item.id > 0 &&
    typeof item.title === 'string' &&
    item.title.trim() !== '' &&
    typeof item.done === 'boolean' &&
    (item.due_date === null || isDate(item.due_date)) &&
    validRepeat(item)
  );
}

/** Turns the text of a data file into a snapshot for the store, or throws StorageError. */
export function parse(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new StorageError('the data file is not JSON');
  }
  if (data === null || typeof data !== 'object' || data.version !== VERSION) {
    throw new StorageError(`the data file is not of version ${VERSION}`);
  }
  if (!Array.isArray(data.items)) throw new StorageError('the data file has no list of items');
  const ids = new Set();
  for (const item of data.items) {
    if (!validItem(item) || ids.has(item.id)) throw new StorageError(`the data file has an item that is not valid (id ${JSON.stringify(item?.id)})`);
    ids.add(item.id);
  }
  if (!Number.isInteger(data.next_id) || data.next_id <= Math.max(0, ...ids)) throw new StorageError('the data file has a next_id that is not above every id');
  return {
    next_id: data.next_id,
    items: data.items.map(({ id, title, done, due_date, repeat, repeat_day }) => ({ id, title, done, due_date, repeat: repeat ?? null, repeat_day: repeat ? repeat_day : null })),
  };
}

/** The text of the data file for a snapshot of the store. */
export function serialize(snapshot) {
  return `${JSON.stringify({ version: VERSION, next_id: snapshot.next_id, items: snapshot.items }, null, 2)}\n`;
}

/** A function that replaces the content of `file`: written beside it first, then renamed over it. */
export function fileWriter(file) {
  return async (text) => {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, text);
    await rename(tmp, file);
  };
}

/**
 * Loads `file` into `store` (no file: the store stays as it is) and saves the
 * store after every change.
 *
 * @param {object} [options]
 * @param {(text: string) => Promise<void>} [options.write] replaces the content of the file
 * @param {(err: Error) => void} [options.onError] told about a write that failed
 * @returns {{ flush(): Promise<void>, stop(): void }} `flush` resolves when nothing
 *   is left to write; `stop` ends the saving
 */
export function persist(store, file, { write = fileWriter(file), onError = (err) => console.error(`saving ${file} failed: ${err.message}`) } = {}) {
  if (existsSync(file)) store.restore(parse(readFileSync(file, 'utf8')));
  else mkdirSync(path.dirname(file), { recursive: true });

  const writing = new Set();
  const stop = store.onChange(() => {
    const one = Promise.resolve()
      .then(() => write(serialize(store.snapshot())))
      .catch(onError)
      .finally(() => writing.delete(one));
    writing.add(one);
  });

  return {
    async flush() {
      while (writing.size > 0) await Promise.all([...writing]);
    },
    stop,
  };
}
