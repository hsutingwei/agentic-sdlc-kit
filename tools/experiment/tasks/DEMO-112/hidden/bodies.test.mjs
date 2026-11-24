import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

test('hidden DEMO-112: 413 over 16 KB, 415 without JSON, 400 for bad JSON', async () => {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, type) => fetch(`${base}/todos`, { method: 'POST', headers: type ? { 'content-type': type } : {}, body });
  try {
    const ok = await post(JSON.stringify({ title: 'x' }), 'Application/JSON; charset=UTF-8');
    assert.equal(ok.status, 201);
    const big = await post(JSON.stringify({ title: 'x'.repeat(17 * 1024) }), 'application/json');
    assert.deepEqual([big.status, await big.json()], [413, { error: 'request body too large' }]);
    const bare = await post(JSON.stringify({ title: 'y' }), 'application/json');
    assert.equal(bare.status, 201);
    assert.equal((await post(JSON.stringify({ title: 'x' }), 'text/plain')).status, 415);
    assert.equal((await post(JSON.stringify({ title: 'x' }), 'application/x-www-form-urlencoded')).status, 415);
    assert.equal((await post('{nope', 'application/json')).status, 400);
    const patch = await fetch(`${base}/todos/1`, { method: 'PATCH', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ done: true }) });
    assert.equal(patch.status, 415);
    const patchOk = await fetch(`${base}/todos/1`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done: true }) });
    assert.equal(patchOk.status, 200);
    assert.equal((await fetch(`${base}/todos/1`, { method: 'DELETE' })).status, 204);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
