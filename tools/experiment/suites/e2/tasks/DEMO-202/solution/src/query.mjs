// The list query: which items GET /todos returns.
//
//   done=true|false   only items that are, or are not, done
//   overdue=true      only items that are not done and were due before today (UTC)
//   q=<text>          only items whose title contains the text
//   limit=<1-100>     at most this many of the items that pass the filters
//   offset=<0-...>    after skipping this many of them

import { matches } from './search.mjs';
import { ValidationError } from './todos.mjs';

const FLAGS = { true: true, false: false };
const NUMBERS = {
  limit: { min: 1, max: 100, range: 'from 1 to 100' },
  offset: { min: 0, max: Number.MAX_SAFE_INTEGER, range: 'of 0 or more' },
};
const DIGITS = /^[0-9]+$/;

/** A number written in decimal digits only, inside its range; anything else is refused. */
function wholeNumber(name, value) {
  const { min, max, range } = NUMBERS[name];
  const n = DIGITS.test(value) ? Number(value) : NaN;
  if (!(n >= min && n <= max)) throw new ValidationError(`${name} must be a whole number ${range}, in decimal digits`);
  return n;
}

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
    } else if (Object.hasOwn(NUMBERS, name)) {
      if (filter[name] !== undefined) throw new ValidationError(`${name} must be given once at most`);
      filter[name] = wholeNumber(name, value);
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
    if (filter.overdue && (todo.done || todo.due_date === null || todo.due_date >= day)) return false;
    if (filter.q && !matches(todo.title, filter.q)) return false;
    return true;
  });
}

/** The page of `todos` (already filtered) that the filter's offset and limit ask for. */
export function page(todos, filter) {
  const start = filter.offset ?? 0;
  return todos.slice(start, filter.limit === undefined ? undefined : start + filter.limit);
}
