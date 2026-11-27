import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../../src/server.mjs';

const E_ACUTE = String.fromCodePoint(0xe9); // é as one code point
const E_AND_MARK = `e${String.fromCodePoint(0x301)}`; // e followed by a combining acute accent
const TITLES = ['Quarterly Report', 'été à Paris', `caf${E_AND_MARK} au lait`, `Caf${E_ACUTE} noir`, 'ＡＢＣ商事 １２３', 'abc 123 plain', '買牛奶'];

async function withApi(fn) {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const title of TITLES) {
    const res = await fetch(`${base}/todos`, { method: 'POST', body: JSON.stringify({ title }) });
    assert.equal(res.status, 201);
  }
  const search = async (q) => (await (await fetch(`${base}/todos?q=${encodeURIComponent(q)}`)).json()).map((t) => t.title);
  try {
    return await fn(search);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('hidden DEMO-208: letter case is ignored, in the query and in the title', () =>
  withApi(async (search) => {
    assert.deepEqual(await search('Report'), ['Quarterly Report']);
    assert.deepEqual(await search('QUARTERLY'), ['Quarterly Report']);
    assert.deepEqual(await search('ÉTÉ'), ['été à Paris']);
    assert.deepEqual(await search('À paris'), ['été à Paris']);
    assert.deepEqual(await search('budget'), []);
  }));

test('hidden DEMO-208: composed and decomposed characters match each other', () =>
  withApi(async (search) => {
    const both = [`caf${E_AND_MARK} au lait`, `Caf${E_ACUTE} noir`];
    assert.deepEqual(await search(`caf${E_ACUTE}`), both);
    assert.deepEqual(await search(`CAF${E_AND_MARK}`), both);
  }));

test('hidden DEMO-208: full-width letters and digits match half-width ones', () =>
  withApi(async (search) => {
    const both = ['ＡＢＣ商事 １２３', 'abc 123 plain'];
    assert.deepEqual(await search('abc'), both);
    assert.deepEqual(await search('ＡＢＣ'), both);
    assert.deepEqual(await search('123'), both);
    assert.deepEqual(await search('１２３'), both);
  }));

test('hidden DEMO-208: titles come back as they were entered; CJK searches work', () =>
  withApi(async (search) => {
    assert.deepEqual(await search(''), TITLES, 'no title was changed by storing or searching');
    assert.deepEqual(await search('牛奶'), ['買牛奶']);
    assert.deepEqual(await search('商事'), ['ＡＢＣ商事 １２３']);
    assert.deepEqual(await search('豆漿'), []);
  }));
