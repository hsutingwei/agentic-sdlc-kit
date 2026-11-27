import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../src/csv.mjs';

const item = (id, title, over = {}) => ({ id, title, done: false, due_date: null, ...over });
const lines = (todos) => toCsv(todos).split('\r\n');

test('a header line, one line per item, CRLF after every line', () => {
  assert.equal(toCsv([]), 'id,title,done,due_date\r\n');
  assert.equal(
    toCsv([item(1, '買牛奶', { due_date: '2026-03-01' }), item(2, 'b', { done: true })]),
    'id,title,done,due_date\r\n1,買牛奶,false,2026-03-01\r\n2,b,true,\r\n',
  );
});

test('fields with a comma, a quote or a line break are quoted', () => {
  assert.equal(lines([item(1, 'a, b')])[1], '1,"a, b",false,');
  assert.equal(lines([item(1, 'say "hi"')])[1], '1,"say ""hi""",false,');
  assert.equal(toCsv([item(1, 'two\nlines')]), 'id,title,done,due_date\r\n1,"two\nlines",false,\r\n');
  assert.equal(toCsv([item(1, 'two\r\nlines')]), 'id,title,done,due_date\r\n1,"two\r\nlines",false,\r\n');
});

test('a title that looks like a formula gets an apostrophe', () => {
  assert.equal(lines([item(1, '=1+1')])[1], "1,'=1+1,false,");
  assert.equal(lines([item(1, '+x')])[1], "1,'+x,false,");
  assert.equal(lines([item(1, '-x')])[1], "1,'-x,false,");
  assert.equal(lines([item(1, '@x')])[1], "1,'@x,false,");
  assert.equal(lines([item(1, 'a=b')])[1], '1,a=b,false,');
});
