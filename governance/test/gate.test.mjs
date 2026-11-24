import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeDemoRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { validateContract } from '../../core/validate.mjs';
import { registerProject } from '../../collector/lib/registry.mjs';
import { readEvents } from '../../collector/lib/store.mjs';
import { loadTasks, startTask } from '../../collector/lib/tasks.mjs';
import { loadGateConfig, runGate } from '../gate/gate.mjs';

function setup(t, label) {
  const sb = createSandbox(t, label);
  const repo = makeDemoRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root: repo });
  return { sb, repo };
}

const writeGates = (repo, gates) => writeFileSync(path.join(repo, '.asdk', 'gates.json'), JSON.stringify({ schema_version: 1, gates }));

test('G1 passes on the demo and writes a valid summary and event', (t) => {
  const { sb, repo } = setup(t, 'gate-pass');
  const { summary, file } = runGate(sb.env, { gate: 'G1', cwd: repo });
  assert.equal(summary.result, 'pass', JSON.stringify(summary.steps));
  assert.deepEqual(validateContract('gate-summary', summary).errors, []);
  assert.equal(summary.head_sha, git(sb, repo, 'rev-parse', 'HEAD').trim());
  assert.equal(summary.base_sha, summary.head_sha); // dev is checked out
  assert.equal(summary.tree_clean, true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), summary);
  const [event] = readEvents(sb.env).events;
  assert.equal(event.event, 'gate.run');
  assert.equal(event.data.result, 'pass');
});

test('--record adds a script verification for the task at the verified commit', (t) => {
  const { sb, repo } = setup(t, 'gate-record');
  startTask(sb.env, { taskId: 'DEMO-001', cwd: repo, type: 'feature', risk: 'low' });
  const { summary } = runGate(sb.env, { gate: 'G1', cwd: repo, taskId: 'DEMO-001', record: true });
  assert.deepEqual(summary.risk, { declared: 'low', path_minimum: 'low', effective: 'low' });
  const [v] = loadTasks(sb.env).get('DEMO-001').verifications;
  assert.deepEqual({ check: v.check, result: v.result, executor: v.executor, sha: v.sha, gate: v.gate }, {
    check: 'unit',
    result: 'pass',
    executor: 'script',
    sha: summary.head_sha,
    gate: 'G1',
  });
  assert.throws(() => runGate(sb.env, { gate: 'G1', cwd: repo, record: true }), /--record needs a task/);
});

test('a failing step fails the gate and skips the rest; dirty trees are reported', (t) => {
  const { sb, repo } = setup(t, 'gate-fail');
  writeFileSync(path.join(repo, 'src', 'broken.mjs'), 'export const = ;\n');
  git(sb, repo, 'add', '.');
  git(sb, repo, 'commit', '-q', '-m', 'test: break syntax');
  writeFileSync(path.join(repo, 'notes.txt'), 'uncommitted\n');
  const { summary, outputs } = runGate(sb.env, { gate: 'G1', cwd: repo });
  assert.equal(summary.result, 'fail');
  assert.deepEqual(summary.steps.map((s) => s.result), ['fail', 'skipped', 'skipped']);
  assert.equal(summary.tree_clean, false);
  assert.match(outputs['syntax check'], /broken\.mjs/);
});

test('G2 adds the integration tests and G3 refuses an unclean tree', (t) => {
  const { sb, repo } = setup(t, 'gate-g2g3');
  const g2 = runGate(sb.env, { gate: 'G2', cwd: repo }).summary;
  assert.equal(g2.result, 'pass', JSON.stringify(g2.steps));
  assert.deepEqual(g2.steps.map((s) => s.name), ['syntax check', 'rules from mistakes', 'agent references', 'deny rules in sync', 'unit tests', 'integration tests']);
  assert.equal(runGate(sb.env, { gate: 'G3', cwd: repo }).summary.result, 'pass');

  // An untracked file is enough: G3 verifies only what is committed.
  writeFileSync(path.join(repo, '筆記 草稿.txt'), 'not committed\n');
  const { summary, outputs } = runGate(sb.env, { gate: 'G3', cwd: repo });
  assert.equal(summary.result, 'fail');
  assert.deepEqual(summary.steps.map((s) => s.result), ['fail', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
  assert.match(outputs['clean tree'], /1 uncommitted or untracked file/);

  // A failing HTTP test fails G2 but not G1.
  writeFileSync(path.join(repo, 'test', 'integration', 'fails.test.mjs'), "import { test } from 'node:test';\ntest('x', () => { throw new Error('boom'); });\n");
  assert.equal(runGate(sb.env, { gate: 'G1', cwd: repo }).summary.result, 'pass');
  assert.equal(runGate(sb.env, { gate: 'G2', cwd: repo }).summary.result, 'fail');
});

test('a command that cannot start is an error, not a failure', (t) => {
  const { sb, repo } = setup(t, 'gate-error');
  writeGates(repo, { G1: { verifies: 'unit', steps: [{ name: 'missing tool', kind: 'unit', run: ['asdk-no-such-command-xyz'] }] } });
  const { summary } = runGate(sb.env, { gate: 'G1', cwd: repo });
  assert.equal(summary.result, 'error');
  assert.equal(summary.steps[0].exit_code, null);
});

test('gate names, runner ids and steps come from configuration', (t) => {
  const { sb, repo } = setup(t, 'gate-config');
  writeGates(repo, { 'quick.v2': { steps: [{ name: 'unit', kind: 'unit', run: ['node', '--test'] }] } });
  const { summary } = runGate(sb.env, { gate: 'quick.v2', cwd: repo, runner: 'ci_windows' });
  assert.equal(summary.gate, 'quick.v2');
  assert.equal(summary.runner.id, 'ci_windows');
  assert.throws(() => runGate(sb.env, { gate: 'G1', cwd: repo }), /unknown gate "G1" \(configured: quick\.v2\)/);
});

test('invalid configuration is rejected with a precise message', (t) => {
  const { repo } = setup(t, 'gate-badcfg');
  const bad = (gates, pattern) => {
    writeGates(repo, gates);
    assert.throws(() => loadGateConfig(repo), pattern);
  };
  bad({ G1: { steps: [] } }, /non-empty array/);
  bad({ G1: { steps: [{ name: 'x', kind: 'deploy', run: ['node'] }] } }, /kind must be one of/);
  bad({ G1: { steps: [{ name: 'x', kind: 'unit' }] } }, /exactly one of/);
  bad({ G1: { steps: [{ name: 'x', kind: 'unit', builtin: 'nope' }] } }, /exactly one of/);
  bad({ G1: { verifies: 'acceptance-ish', steps: [{ name: 'x', kind: 'unit', run: ['node'] }] } }, /"verifies" must be one of/);
  bad({ 'G 1': { steps: [{ name: 'x', kind: 'unit', run: ['node'] }] } }, /invalid characters/);
});

test('asdk gate run and gate list', (t) => {
  const { sb, repo } = setup(t, 'gate-cli');
  assert.match(runAsdk(sb, ['gate', 'list'], { cwd: repo }).stdout, /^G1\tFast gate/);
  const ok = runAsdk(sb, ['gate', 'run', 'G1'], { cwd: path.join(repo, 'src') });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /PASS {4}syntax check/);
  assert.match(ok.stdout, /result: pass/);

  writeFileSync(path.join(repo, 'test', 'unit', 'fails.test.mjs'), "import { test } from 'node:test';\ntest('x', () => { throw new Error('boom'); });\n");
  const failed = runAsdk(sb, ['gate', 'run', 'G1'], { cwd: repo });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /FAIL {4}unit tests/);
  assert.match(failed.stdout, /last \d+ lines of "unit tests"/);

  assert.equal(runAsdk(sb, ['gate', 'run', 'G9'], { cwd: repo }).status, 2);
  assert.equal(runAsdk(sb, ['gate', 'run', 'G1'], { cwd: sb.home }).status, 2);
});
