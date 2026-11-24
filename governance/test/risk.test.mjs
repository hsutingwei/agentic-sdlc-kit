import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeDemoRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { validateContract } from '../../core/validate.mjs';
import { registerProject } from '../../collector/lib/registry.mjs';
import { startTask } from '../../collector/lib/tasks.mjs';
import { runGate } from '../gate/gate.mjs';
import { loadRiskPaths, pathMinimum } from '../gate/risk.mjs';

const RULES = [
  { paths: ['src/**'], risk: 'low' },
  { paths: ['src/server.mjs'], risk: 'medium', reason: 'public HTTP contract' },
  { paths: ['db/**', 'src/db/**'], risk: 'high' },
];

test('the highest matching rule decides each path, and low matches are not listed', () => {
  assert.deepEqual(pathMinimum(RULES, []), { risk: 'low', matches: [] });
  assert.deepEqual(pathMinimum(RULES, ['src/todos.mjs', 'README.md']), { risk: 'low', matches: [] });
  const r = pathMinimum(RULES, ['src/server.mjs', 'src/db/遷移 001.sql', 'test/x.mjs']);
  assert.equal(r.risk, 'high');
  assert.deepEqual(r.matches, [
    { path: 'src/server.mjs', risk: 'medium', reason: 'public HTTP contract' },
    { path: 'src/db/遷移 001.sql', risk: 'high' },
  ]);
});

test('risk-paths.json is optional but checked when present', (t) => {
  const sb = createSandbox(t, 'risk-load');
  const top = sb.join('專案');
  mkdirSync(path.join(top, '.asdk'), { recursive: true });
  assert.deepEqual(loadRiskPaths(top), []);
  const write = (value) => writeFileSync(path.join(top, '.asdk', 'risk-paths.json'), typeof value === 'string' ? value : JSON.stringify(value));
  write(`\uFEFF${JSON.stringify({ schema_version: 1, rules: RULES })}`);
  assert.equal(loadRiskPaths(top).length, 3);
  for (const [value, message] of [
    ['{', /not valid JSON/],
    [{ rules: {} }, /"rules" must be an array/],
    [{ rules: [{ paths: [], risk: 'low' }] }, /non-empty list/],
    [{ rules: [{ paths: ['../x'], risk: 'low' }] }, /repository-relative/],
    [{ rules: [{ paths: ['C:/x'], risk: 'low' }] }, /repository-relative/],
    [{ rules: [{ paths: ['x'], risk: 'severe' }] }, /"risk" must be one of/],
  ]) {
    write(value);
    assert.throws(() => loadRiskPaths(top), message);
  }
});

test('the gate raises a task risk from the paths its branch changed, never lowers it', (t) => {
  const sb = createSandbox(t, 'risk-gate');
  const repo = makeDemoRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root: repo });
  startTask(sb.env, { taskId: 'DEMO-001', cwd: repo, type: 'feature', risk: 'low' });
  startTask(sb.env, { taskId: 'DEMO-002', cwd: repo, type: 'feature', risk: 'high' });

  // On dev itself nothing differs from dev.
  assert.deepEqual(runGate(sb.env, { gate: 'G1', cwd: repo, taskId: 'DEMO-001' }).summary.risk, { declared: 'low', path_minimum: 'low', effective: 'low' });

  git(sb, repo, 'switch', '-q', '-c', 'feat/DEMO-001');
  writeFileSync(path.join(repo, 'src', 'server.mjs'), `${'// touched\n'}`, { flag: 'a' });
  git(sb, repo, 'commit', '-q', '-am', 'feat: touch the HTTP layer');
  const run = runGate(sb.env, { gate: 'G1', cwd: repo, taskId: 'DEMO-001' });
  assert.deepEqual(run.summary.risk, { declared: 'low', path_minimum: 'medium', effective: 'medium' });
  assert.deepEqual(validateContract('gate-summary', run.summary).errors, []);
  assert.deepEqual(run.risk_matches, [{ path: 'src/server.mjs', risk: 'medium', reason: 'public HTTP contract' }]);

  // A higher declared risk stays.
  assert.deepEqual(runGate(sb.env, { gate: 'G1', cwd: repo, taskId: 'DEMO-002' }).summary.risk, { declared: 'high', path_minimum: 'medium', effective: 'high' });

  // Without a task the paths alone decide, and the CLI says why.
  const out = runAsdk(sb, ['gate', 'run', 'G1'], { cwd: repo }).stdout;
  assert.match(out, /risk: medium by changed paths/);
  assert.match(out, /medium {3}src\/server\.mjs - public HTTP contract/);
  const raised = runAsdk(sb, ['gate', 'run', 'G1', '--task', 'DEMO-001'], { cwd: repo }).stdout;
  assert.match(raised, /risk: low raised to medium/);
});
