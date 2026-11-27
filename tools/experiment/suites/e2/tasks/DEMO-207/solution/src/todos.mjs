// In-memory todo store with input validation.

import { dayOf, isDate, monthLater } from './dates.mjs';

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

function validateRepeat(value) {
  if (value !== null && value !== 'monthly') throw new ValidationError('repeat must be "monthly" or null');
  return value;
}

/** The repeat fields of an item: `repeat_day` is the day of the month its series keeps. */
function repeating(repeat, dueDate, day) {
  if (repeat === null) return { repeat: null, repeat_day: null };
  if (dueDate === null) throw new ValidationError('a repeating item needs a due date');
  return { repeat, repeat_day: day ?? dayOf(dueDate) };
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
      const repeat = repeating(input.repeat === undefined ? null : validateRepeat(input.repeat), dueDate);
      const todo = { id: nextId++, title, done: false, due_date: dueDate, ...repeat };
      items.set(todo.id, todo);
      changed();
      return copy(todo);
    },

    /** Adds several items, or none of them when one is not valid. */
    addMany(inputs) {
      if (!Array.isArray(inputs)) throw new ValidationError('items must be a list');
      const ready = inputs.map((input, i) => {
        try {
          const fields = {
            title: validateTitle(input?.title),
            done: input.done === undefined ? false : validateDone(input.done),
            due_date: input.due_date === undefined ? null : validateDueDate(input.due_date),
          };
          return { ...fields, ...repeating(input.repeat === undefined ? null : validateRepeat(input.repeat), fields.due_date) };
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
      if (patch?.repeat !== undefined) next.repeat = validateRepeat(patch.repeat);
      // The series keeps its day unless repeat was just set or the due date was changed.
      const keepDay = todo.repeat !== null && next.due_date === todo.due_date;
      Object.assign(next, repeating(next.repeat, next.due_date, keepDay ? todo.repeat_day : undefined));
      items.set(id, next);
      if (next.repeat !== null && !todo.done && next.done) {
        const following = { id: nextId++, title: next.title, done: false, due_date: monthLater(next.due_date, next.repeat_day), repeat: next.repeat, repeat_day: next.repeat_day };
        items.set(following.id, following);
      }
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
