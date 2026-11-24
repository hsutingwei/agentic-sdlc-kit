import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './helpers/sandbox.mjs';
import { makeSample } from '../tools/lib/sample.mjs';

const COMMITTED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'sample-report');
const FILES = ['summary.md', 'tasks.csv', 'verifications.csv', 'usage.csv'];

test('examples/sample-report is exactly what tools/make-sample.mjs produces', (t) => {
  const sb = createSandbox(t, 'sample');
  const out = sb.join('範例 報表');
  const report = makeSample(out);
  for (const f of FILES) {
    assert.ok(readFileSync(path.join(out, f)).equals(readFileSync(path.join(COMMITTED, f))), `${f} differs: run node tools/make-sample.mjs`);
  }
  // The sample is meant to show every grade.
  const grades = new Set(report.rows.map((r) => r.data_quality));
  assert.deepEqual([...grades].sort(), ['Complete', 'Missing', 'Partial']);
});

test('the sample is fictional: only demo ids and neutral paths', () => {
  const text = FILES.map((f) => readFileSync(path.join(COMMITTED, f), 'utf8')).join('\n');
  const projects = new Set(text.match(/\bdemo-[a-z]+\b/g));
  assert.deepEqual([...projects].sort(), ['demo-api', 'demo-web']);
  assert.deepEqual([...new Set(text.match(/\b[A-Z]+-\d{3}\b/g))].every((id) => id.startsWith('DEMO-')), true);
  assert.doesNotMatch(text, /[A-Za-z]:\|\/Users\/|@(?!example\.invalid)[a-z0-9-]+\.[a-z]/i);
});
