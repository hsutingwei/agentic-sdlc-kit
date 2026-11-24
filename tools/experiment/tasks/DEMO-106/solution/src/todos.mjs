// In-memory todo store with input validation.

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

const copy = (todo) => ({ ...todo });

export class TodoStore {
  #items = new Map();
  #nextId = 1;

  list() {
    return [...this.#items.values()].map(copy);
  }

  get(id) {
    const todo = this.#items.get(id);
    return todo ? copy(todo) : null;
  }

  add(input) {
    const title = validateTitle(input?.title); // validate first: a rejected item must not use up an id
    const todo = { id: this.#nextId++, title, done: false };
    this.#items.set(todo.id, todo);
    return copy(todo);
  }

  update(id, patch) {
    const todo = this.#items.get(id);
    if (!todo) return null;
    const next = { ...todo };
    if (patch?.title !== undefined) next.title = validateTitle(patch.title);
    if (patch?.done !== undefined) {
      if (typeof patch.done !== 'boolean') throw new ValidationError('done must be true or false');
      next.done = patch.done;
    }
    this.#items.set(id, next);
    return copy(next);
  }

  remove(id) {
    return this.#items.delete(id);
  }
}

export function createStore() {
  return new TodoStore();
}
