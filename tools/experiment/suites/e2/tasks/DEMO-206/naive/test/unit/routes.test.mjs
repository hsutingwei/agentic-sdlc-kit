import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRoute, routes } from '../../src/routes.mjs';

test('the table has the routes of the README', () => {
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`), ['GET /todos', 'POST /todos', 'POST /todos/import', 'GET /summary', 'GET /todos/:id', 'PATCH /todos/:id', 'DELETE /todos/:id']);
});

test('a request finds its entry, with the id as a number', () => {
  assert.equal(findRoute('GET', '/todos').route.path, '/todos');
  assert.deepEqual([findRoute('PATCH', '/todos/42').route.path, findRoute('PATCH', '/todos/42').id], ['/todos/:id', 42]);
  assert.equal(findRoute('POST', '/todos/import').route.path, '/todos/import');
});

test('a path that is not a route is 404; a route without the method is 405', () => {
  for (const path of ['/', '/nope', '/todos/', '/todos/1/', '/summary/']) assert.deepEqual(findRoute('GET', path), { status: 404 }, path);
  for (const [method, path] of [['PUT', '/todos'], ['POST', '/summary'], ['POST', '/todos/1'], ['PUT', '/todos/import']]) {
    assert.deepEqual(findRoute(method, path), { status: 405 }, `${method} ${path}`);
  }
});
