// In-memory todo store with input validation.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const MAX_TITLE = 200;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') throw new ValidationError('title must be a non-empty string');
  if ([...title].length > MAX_TITLE) throw new ValidationError(`title must be at most ${MAX_TITLE} characters`);
  return title.trim();
}

function validateDueDate(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !DATE.test(value)) throw new ValidationError('due_date must be a date in YYYY-MM-DD format');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ValidationError('due_date must be a real calendar date');
  }
  return value;
}

const copy = (todo) => ({ ...todo });
const todayUtc = () => new Date().toISOString().slice(0, 10);

export function createStore() {
  const items = new Map();
  let nextId = 1;

  return {
    list({ overdue = false, today = todayUtc() } = {}) {
      const all = [...items.values()];
      const picked = overdue ? all.filter((t) => !t.done && t.due_date !== null && t.due_date < today) : all;
      return picked.map(copy);
    },

    get(id) {
      const todo = items.get(id);
      return todo ? copy(todo) : null;
    },

    add(input) {
      const title = validateTitle(input?.title); // validate first: a rejected item must not use up an id
      const dueDate = validateDueDate(input?.due_date);
      const todo = { id: nextId++, title, done: false, due_date: dueDate };
      items.set(todo.id, todo);
      return copy(todo);
    },

    update(id, patch) {
      const todo = items.get(id);
      if (!todo) return null;
      const next = { ...todo };
      if (patch?.title !== undefined) next.title = validateTitle(patch.title);
      if (patch?.done !== undefined) {
        if (typeof patch.done !== 'boolean') throw new ValidationError('done must be true or false');
        next.done = patch.done;
      }
      if (patch?.due_date !== undefined) next.due_date = validateDueDate(patch.due_date);
      items.set(id, next);
      return copy(next);
    },

    remove(id) {
      return items.delete(id);
    },
  };
}
