import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, git, makeRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { validateContract } from '../../core/validate.mjs';
import { registerProject } from '../lib/registry.mjs';
import { appendEvent, makeEvent } from '../lib/store.mjs';
import { deriveTasks, endTask, loadTasks, startTask, toContract, verifyTask } from '../lib/tasks.mjs';

function setup(t, label) {
  const sb = createSandbox(t, label);
  const root = makeRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root });
  return { sb, root };
}

const start = (sb, root, extra = {}) =>
  startTask(sb.env, { taskId: 'DEMO-001', cwd: root, type: 'feature', risk: 'low', title: '加上到期日', estimateHours: 6, ...extra });

test('a full lifecycle derives a valid task record', (t) => {
  const { sb, root } = setup(t, 'task-life');
  start(sb, root);
  verifyTask(sb.env, { taskId: 'DEMO-001', check: 'unit', result: 'fail', executor: 'script', cwd: root });
  verifyTask(sb.env, { taskId: 'DEMO-001', check: 'unit', result: 'pass', executor: 'script', cwd: root });
  endTask(sb.env, { taskId: 'DEMO-001', outcome: 'accepted', completedBy: 'ai_with_human_fixes' });

  const task = loadTasks(sb.env).get('DEMO-001');
  assert.equal(task.status, 'ended');
  assert.deepEqual(task.verifications.map((v) => v.result), ['fail', 'pass']);
  assert.equal(task.verifications[0].sha, git(sb, root, 'rev-parse', 'HEAD').trim());
  const view = toContract(task);
  assert.deepEqual(validateContract('task', view).errors, []);
  assert.equal(view.title, '加上到期日');
});

test('start needs a registered project, a valid id and enums, and refuses duplicates', (t) => {
  const { sb, root } = setup(t, 'task-start');
  assert.throws(() => start(sb, sb.home), /not inside a registered project/);
  assert.throws(() => start(sb, root, { taskId: 'demo-1' }), /invalid task id/);
  assert.throws(() => start(sb, root, { type: 'chore' }), /--type must be one of/);
  assert.throws(() => start(sb, root, { estimateHours: -1 }), /estimate_hours/);
  start(sb, root);
  assert.throws(() => start(sb, root), /already exists/);
  const manual = startTask(sb.env, { taskId: 'DEMO-002', projectId: 'demo-api', type: 'docs', risk: 'low' });
  assert.equal(manual.project_source, 'manual');
});

test('verify and end enforce the lifecycle rules', (t) => {
  const { sb, root } = setup(t, 'task-rules');
  assert.throws(() => verifyTask(sb.env, { taskId: 'DEMO-001', check: 'unit', result: 'pass', executor: 'script' }), /has not been started/);
  start(sb, root);
  assert.throws(() => verifyTask(sb.env, { taskId: 'DEMO-001', check: 'acceptance', result: 'pass', executor: 'script' }), /only be recorded by a human/);
  verifyTask(sb.env, { taskId: 'DEMO-001', check: 'acceptance', result: 'pass', executor: 'human', sha: 'a'.repeat(40) });
  assert.throws(() => verifyTask(sb.env, { taskId: 'DEMO-001', check: 'unit', result: 'pass', executor: 'script', sha: 'abc' }), /full commit hash/);
  assert.throws(() => endTask(sb.env, { taskId: 'DEMO-001', outcome: 'accepted' }), /--completed-by is required/);
  endTask(sb.env, { taskId: 'DEMO-001', outcome: 'abandoned' });
  assert.throws(() => endTask(sb.env, { taskId: 'DEMO-001', outcome: 'abandoned' }), /is ended/);
  assert.throws(() => verifyTask(sb.env, { taskId: 'DEMO-001', check: 'unit', result: 'pass', executor: 'script' }), /is ended/);
});

test('duplicate starts and events without a start are flagged, not lost', () => {
  const ev = (event, extra = {}) => ({ schema_version: 1, ts: '2026-11-02T00:00:00.000Z', source: 'cli', event, task_id: 'DEMO-001', ...extra });
  const { tasks, orphans } = deriveTasks([
    ev('task.verify', { data: { check: 'unit', result: 'pass', executor: 'script' } }),
    ev('task.start', { data: { type: 'feature', risk: 'low' } }),
    ev('task.start', { data: { type: 'feature', risk: 'low' } }),
    ev('SessionStart', { source: 'hook', session_id: 's-1' }),
    ev('SubagentStart', { source: 'hook', session_id: 's-1', agent: { id: 'a-1' } }),
  ]);
  const t = tasks.get('DEMO-001');
  assert.ok(t.flags.has('duplicate_task_start'));
  assert.equal(orphans.length, 1);
  assert.equal(t.sessions.size, 1);
  assert.equal(t.agents.size, 1);
});

test('asdk task commands', (t) => {
  const { sb, root } = setup(t, 'task-cli');
  const ok = (args) => {
    const r = runAsdk(sb, args, { cwd: root });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  assert.match(ok(['task', 'start', 'DEMO-001', '--type', 'feature', '--risk', 'low', '--estimate', '6']), /started DEMO-001 \(demo-api\)/);
  assert.match(ok(['task', 'verify', 'DEMO-001', '--check', 'unit', '--result', 'pass', '--executor', 'script']), /recorded unit pass/);
  assert.match(ok(['task', 'end', 'DEMO-001', '--outcome', 'accepted', '--completed-by', 'ai']), /ended DEMO-001: accepted/);
  assert.match(ok(['task', 'list']), /DEMO-001\tdemo-api\tended\taccepted/);
  assert.equal(JSON.parse(ok(['task', 'list', '--json']))[0].completed_by, 'ai');

  assert.equal(runAsdk(sb, ['task', 'start', 'DEMO-002', '--risk', 'low'], { cwd: root }).status, 2);
  assert.equal(runAsdk(sb, ['task', 'start', 'DEMO-002', '--type', 'feature', '--risk', 'low', '--estimate', 'soon'], { cwd: root }).status, 2);
  const notStarted = runAsdk(sb, ['task', 'end', 'DEMO-009', '--outcome', 'abandoned'], { cwd: root });
  assert.equal(notStarted.status, 1);
  assert.match(notStarted.stderr, /has not been started/);
});

test('hook events of other tasks do not leak into a task', (t) => {
  const { sb, root } = setup(t, 'task-iso');
  start(sb, root);
  appendEvent(sb.env, makeEvent({ source: 'hook', event: 'SessionStart', session_id: 's-9', task_id: 'DEMO-002' }), 's-9');
  assert.equal(loadTasks(sb.env).get('DEMO-001').sessions.size, 0);
});
