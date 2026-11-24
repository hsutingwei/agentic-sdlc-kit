// HTTP layer: /todos and /todos/:id, JSON in and out. Uses node:http only.

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { readJson, send } from './http.mjs';
import { createStore, ValidationError } from './todos.mjs';

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
      if (err instanceof ValidationError) return send(res, 400, { error: err.message });
      return send(res, 500, { error: 'internal error' });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 3000);
  createServer().listen(port, '127.0.0.1', () => console.log(`demo-api listening on http://127.0.0.1:${port}`));
}
