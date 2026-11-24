// HTTP layer: /todos and /todos/:id, JSON in and out. Uses node:http only.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createStore, ValidationError } from './todos.mjs';

const MAX_BODY = 16 * 1024;

/** A refusal with its own status code, answered as { error }. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

const hasBody = (req) => Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
const isJson = (req) => /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '');

async function readJson(req) {
  if (hasBody(req) && !isJson(req)) throw new HttpError(415, 'content-type must be application/json');
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) throw new HttpError(413, 'request body too large');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'request body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ValidationError('request body must be JSON');
  }
}

export function createServer(store = createStore()) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/todos') {
        if (req.method === 'GET') return send(res, 200, store.list());
        if (req.method === 'POST') return send(res, 201, store.add(await readJson(req)));
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
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
      return send(res, 500, { error: 'internal error' });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 3000);
  createServer().listen(port, '127.0.0.1', () => console.log(`demo-api listening on http://127.0.0.1:${port}`));
}
