import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches } from '../../src/search.mjs';

test('a search ignores letter case', () => {
  assert.equal(matches('Quarterly Report', 'report'), true);
  assert.equal(matches('quarterly report', 'REPORT'), true);
  assert.equal(matches('été à Paris', 'ÉTÉ'), true);
  assert.equal(matches('Quarterly Report', 'budget'), false);
});

test('a search ignores the Unicode form', () => {
  const composed = String.fromCodePoint(0xe9); // é as one code point
  const decomposed = `e${String.fromCodePoint(0x301)}`; // e and a combining accent
  assert.equal(matches(`caf${decomposed}`, `caf${composed}`), true);
  assert.equal(matches(`caf${composed}`, `caf${decomposed}`), true);
});

test('a search finds CJK text', () => {
  assert.equal(matches('買牛奶', '牛奶'), true);
  assert.equal(matches('買牛奶', '豆漿'), false);
});
