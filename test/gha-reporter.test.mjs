import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import githubAnnotations, { annotation } from '../tools/gha-reporter.mjs';

const cwd = path.resolve('repo-root');
const failure = (extra = {}) => ({
  name: 'rows, carry: numbers',
  file: path.join(cwd, 'collector', 'test', 'report.test.mjs'),
  line: 12,
  details: { error: { failureType: 'testCodeFailure', cause: { message: 'Expected 2\n  actual 3 (100%)' } } },
  ...extra,
});

test('a failing test becomes an escaped ::error annotation with file and line', () => {
  assert.equal(
    annotation(failure(), cwd),
    '::error file=collector/test/report.test.mjs,line=12,title=rows%2C carry%3A numbers::Expected 2%0A  actual 3 (100%25)\n',
  );
});

test('parents failing only because of a subtest are skipped', () => {
  assert.equal(annotation(failure({ details: { error: { failureType: 'subtestsFailed' } } }), cwd), null);
});

test('the reporter yields only failures', async () => {
  async function* events() {
    yield { type: 'test:pass', data: { name: 'ok' } };
    yield { type: 'test:fail', data: failure({ file: undefined }) };
  }
  const out = [];
  for await (const line of githubAnnotations(events())) out.push(line);
  assert.equal(out.length, 1);
  assert.match(out[0], /^::error title=rows%2C carry%3A numbers::Expected 2/);
});
