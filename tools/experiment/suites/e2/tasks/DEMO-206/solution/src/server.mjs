// HTTP layer: JSON in and out, node:http only. The routes are in routes.mjs;
// README.md has the contract.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { today } from './dates.mjs';
import { findRoute } from './routes.mjs';
import { persist } from './storage.mjs';
import { createStore, ValidationError } from './todos.mjs';

const MAX_BODY = 64 * 1024;

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(json) });
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
      const found = findRoute(req.method, url.pathname);
      if (!found.route) return send(res, found.status, { error: found.status === 405 ? 'method not allowed' : 'not found' });
      const [status, body] = await found.route.handler({ store, day: today(now()), query: url.searchParams, id: found.id, body: () => readJson(req) });
      return send(res, status, body);
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
