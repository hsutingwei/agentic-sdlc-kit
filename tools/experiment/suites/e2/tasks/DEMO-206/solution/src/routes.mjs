// The routes of the API, one entry each. README.md has the contract.
//
// A handler gets { store, day, query, id, body } and returns [status, body]:
// `day` is today's date, `query` the URLSearchParams, `id` the number in place of
// :id, and `body()` reads the JSON of the request.

import { parseQuery, select } from './query.mjs';
import { summarize } from './summary.mjs';

const NOT_FOUND = [404, { error: 'not found' }];
const itemOr404 = (todo) => (todo ? [200, todo] : NOT_FOUND);

export const routes = [
  { method: 'GET', path: '/todos', handler: ({ store, day, query }) => [200, select(store.list(), parseQuery(query), day)] },
  { method: 'POST', path: '/todos', handler: async ({ store, body }) => [201, store.add(await body())] },
  { method: 'POST', path: '/todos/import', handler: async ({ store, body }) => [201, store.addMany((await body())?.items)] },
  { method: 'GET', path: '/summary', handler: ({ store, day }) => [200, summarize(store.list(), day)] },
  { method: 'GET', path: '/todos/:id', handler: ({ store, id }) => itemOr404(store.get(id)) },
  // The body is read before the item is looked up: a body that is not JSON answers 400 for any id.
  { method: 'PATCH', path: '/todos/:id', handler: async ({ store, id, body }) => itemOr404(store.update(id, await body())) },
  { method: 'DELETE', path: '/todos/:id', handler: ({ store, id }) => (store.remove(id) ? [204] : NOT_FOUND) },
];

// :id is a positive whole number in decimal digits without leading zeros.
const ID = '([1-9][0-9]*)';
const matcher = (path) => new RegExp(`^${path.replace(':id', ID)}$`);

/**
 * The entry of `table` for a request, as { route, id }. When there is none:
 * { status: 405 } if the path is a route with other methods, { status: 404 } if not.
 */
export function findRoute(method, pathname, table = routes) {
  let pathKnown = false;
  for (const route of table) {
    const match = matcher(route.path).exec(pathname);
    if (!match) continue;
    if (route.method === method) return { route, id: match[1] === undefined ? undefined : Number(match[1]) };
    pathKnown = true;
  }
  return { status: pathKnown ? 405 : 404 };
}
