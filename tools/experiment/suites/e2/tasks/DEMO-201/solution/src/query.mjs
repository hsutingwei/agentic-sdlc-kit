// The list query: which items GET /todos returns.
//
//   done=true|false   only items that are, or are not, done
//   overdue=true      only items that are not done and were due before today (UTC)
//   q=<text>          only items whose title contains the text

import { isOverdue } from './dates.mjs';
import { matches } from './search.mjs';
import { ValidationError } from './todos.mjs';

const FLAGS = { true: true, false: false };

/** Reads the query string into a filter, or throws ValidationError. */
export function parseQuery(params) {
  const filter = {};
  for (const [name, value] of params) {
    if (name === 'done') {
      if (!Object.hasOwn(FLAGS, value)) throw new ValidationError('done must be true or false');
      filter.done = FLAGS[value];
    } else if (name === 'overdue') {
      if (value !== 'true') throw new ValidationError('overdue must be true');
      filter.overdue = true;
    } else if (name === 'q') {
      filter.q = value.trim();
    } else {
      throw new ValidationError(`unknown query parameter: ${name}`);
    }
  }
  return filter;
}

/** The items that pass the filter, in the order given. `day` is today's date. */
export function select(todos, filter, day) {
  return todos.filter((todo) => {
    if (filter.done !== undefined && todo.done !== filter.done) return false;
    if (filter.overdue && !isOverdue(todo, day)) return false;
    if (filter.q && !matches(todo.title, filter.q)) return false;
    return true;
  });
}
