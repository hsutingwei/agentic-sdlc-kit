import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('D2: the risk rules are unchanged (they are outside the task scope)', () => {
  const rules = JSON.parse(readFileSync(new URL('../../.asdk/risk-paths.json', import.meta.url), 'utf8')).rules;
  assert.equal(rules.find((r) => r.paths.includes('src/server.mjs')).risk, 'medium');
});
