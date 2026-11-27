// HTTP layer: JSON in and out, node:http only. README.md has the contract.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { today } from './dates.mjs';
import { page, parseQuery, select } from './query.mjs';
import { persist } from './storage.mjs';
import { summarize } from './summary.mjs';
import { createStore, ValidationError } from './todos.mjs';

const MAX_BODY = 64 * 1024;

function send(res, status, body, headers = {}) {
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(json), ...headers });
  res.end(json);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ValidationError('request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ValidationError('request body must be JSON');
  }
}

/**
 * @param {object} [options]
 * @param {ReturnType<typeof createStore>} [options.store]
 * @param {() => Date} [options.now] the clock that says what today is
 */
export function createServer({ store = createStore(), now = () => new Date() } = {}) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/todos') {
        if (req.method === 'GET') {
          const filter = parseQuery(url.searchParams);
          const all = store.list();
          return send(res, 200, page(select(all, filter, today(now())), filter), { 'x-total-count': String(all.length) });
        }
        if (req.method === 'POST') return send(res, 201, store.add(await readJson(req)));
        return send(res, 405, { error: 'method not allowed' });
      }
      if (url.pathname === '/todos/import') {
        if (req.method === 'POST') return send(res, 201, store.addMany((await readJson(req))?.items));
        return send(res, 405, { error: 'method not allowed' });
      }
      if (url.pathname === '/summary') {
        if (req.method === 'GET') return send(res, 200, summarize(store.list(), today(now())));
        return send(res, 405, { error: 'method not allowed' });
      }
      const match = /^\/todos\/([1-9][0-9]*)$/.exec(url.pathname);
      if (!match) return send(res, 404, { error: 'not found' });
      const id = Number(match[1]);
      if (req.method === 'GET') {
        const todo = store.get(id);
        return todo ? send(res, 200, todo) : send(res, 404, { error: 'not found' });
      }
      if (req.method === 'PATCH') {
        const todo = store.update(id, await readJson(req));
        return todo ? send(res, 200, todo) : send(res, 404, { error: 'not found' });
      }
      if (req.method === 'DELETE') return store.remove(id) ? send(res, 204) : send(res, 404, { error: 'not found' });
      return send(res, 405, { error: 'method not allowed' });
    } catch (err) {
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
      return send(res, 500, { error: 'internal error' });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 3000);
  const store = createStore();
  // With DATA_FILE the items are loaded from that file and saved to it after every change.
  if (process.env.DATA_FILE) persist(store, process.env.DATA_FILE);
  createServer({ store }).listen(port, '127.0.0.1', () => console.log(`demo-api listening on http://127.0.0.1:${port}`));
}
