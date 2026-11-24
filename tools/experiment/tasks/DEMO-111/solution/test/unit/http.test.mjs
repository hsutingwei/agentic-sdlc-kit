import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { MAX_BODY, readJson, send } from '../../src/http.mjs';
import { ValidationError } from '../../src/todos.mjs';

function fakeResponse() {
  const res = { status: null, headers: null, body: '' };
  res.writeHead = (status, headers) => {
    res.status = status;
    res.headers = headers ?? null;
    return res;
  };
  res.end = (body = '') => {
    res.body = body;
  };
  return res;
}

test('send writes JSON with its length, or nothing at all', () => {
  const res = fakeResponse();
  send(res, 200, { 標題: 'x' });
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-length'], Buffer.byteLength(res.body));
  const empty = fakeResponse();
  send(empty, 204);
  assert.deepEqual([empty.status, empty.headers, empty.body], [204, null, '']);
});

test('readJson parses, limits and refuses', async () => {
  assert.deepEqual(await readJson(Readable.from([Buffer.from('{"a":1}')])), { a: 1 });
  assert.deepEqual(await readJson(Readable.from([])), {});
  await assert.rejects(readJson(Readable.from([Buffer.from('{bad')])), ValidationError);
  await assert.rejects(readJson(Readable.from([Buffer.alloc(MAX_BODY + 1, 32)])), /too large/);
});
