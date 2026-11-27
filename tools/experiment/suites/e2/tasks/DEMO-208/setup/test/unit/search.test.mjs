import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches } from '../../src/search.mjs';

test('a search ignores the letter case of the title', () => {
  assert.equal(matches('Quarterly Report', 'report'), true);
  assert.equal(matches('Quarterly Report', 'budget'), false);
});

test('a search finds CJK text', () => {
  assert.equal(matches('買牛奶', '牛奶'), true);
  assert.equal(matches('買牛奶', '豆漿'), false);
});
