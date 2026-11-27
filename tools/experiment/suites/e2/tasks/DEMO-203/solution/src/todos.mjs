// In-memory todo store with input validation.

import { isDate } from './dates.mjs';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const MAX_TITLE = 200;

function validateTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') throw new ValidationError('title must be a non-empty string');
  if ([...title].length > MAX_TITLE) throw new ValidationError(`title must be at most ${MAX_TITLE} characters`);
  return title.trim();
}

function validateDone(done) {
  if (typeof done !== 'boolean') throw new ValidationError('done must be true or false');
  return done;
}

function validateDueDate(value) {
  if (value !== null && !isDate(value)) throw new ValidationError('due_date must be a date like 2026-01-31, or null');
  return value;
}

export const PRIORITIES = ['low', 'normal', 'high'];
const DEFAULT_PRIORITY = 'normal';

function validatePriority(value) {
  if (!PRIORITIES.includes(value)) throw new ValidationError(`priority must be one of: ${PRIORITIES.join(', ')}`);
  return value;
}

const copy = (todo) => ({ ...todo });

export function createStore() {
  const items = new Map();
  let nextId = 1;
  const listeners = new Set();
  const changed = () => {
    for (const fn of listeners) fn();
  };
  const list = () => [...items.values()].map(copy);

  return {
    list,

    get(id) {
      const todo = items.get(id);
      return todo ? copy(todo) : null;
    },

    add(input) {
      const title = validateTitle(input?.title); // validate first: a rejected item must not use up an id
      const dueDate = input.due_date === undefined ? null : validateDueDate(input.due_date);
      const priority = input.priority === undefined ? DEFAULT_PRIORITY : validatePriority(input.priority);
      const todo = { id: nextId++, title, done: false, due_date: dueDate, priority };
      items.set(todo.id, todo);
      changed();
      return copy(todo);
    },

    /** Adds several items, or none of them when one is not valid. */
    addMany(inputs) {
      if (!Array.isArray(inputs)) throw new ValidationError('items must be a list');
      const ready = inputs.map((input, i) => {
        try {
          return {
            title: validateTitle(input?.title),
            done: input.done === undefined ? false : validateDone(input.done),
            due_date: input.due_date === undefined ? null : validateDueDate(input.due_date),
            priority: input.priority === undefined ? DEFAULT_PRIORITY : validatePriority(input.priority),
          };
        } catch (err) {
          if (err instanceof ValidationError) throw new ValidationError(`item ${i + 1}: ${err.message}`);
          throw err;
        }
      });
      const added = ready.map((fields) => {
        const todo = { id: nextId++, ...fields };
        items.set(todo.id, todo);
        return copy(todo);
      });
      if (added.length > 0) changed();
      return added;
    },

    update(id, patch) {
      const todo = items.get(id);
      if (!todo) return null;
      const next = { ...todo };
      if (patch?.title !== undefined) next.title = validateTitle(patch.title);
      if (patch?.done !== undefined) next.done = validateDone(patch.done);
      if (patch?.due_date !== undefined) next.due_date = validateDueDate(patch.due_date);
      if (patch?.priority !== undefined) next.priority = validatePriority(patch.priority);
      items.set(id, next);
      changed();
      return copy(next);
    },

    remove(id) {
      const removed = items.delete(id);
      if (removed) changed();
      return removed;
    },

    /** Everything needed to build the store again. */
    snapshot() {
      return { next_id: nextId, items: list() };
    },

    /** Replaces the content with a snapshot that was checked already. Listeners are not called. */
    restore(snapshot) {
      items.clear();
      for (const todo of snapshot.items) items.set(todo.id, copy(todo));
      nextId = snapshot.next_id;
    },

    /** Calls `fn` after every change. Returns a function that stops the calls. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
