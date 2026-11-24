import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { validateContract } from '../../core/validate.mjs';
import { registerProject } from '../lib/registry.mjs';
import { appendEvent, eventsDir, makeEvent } from '../lib/store.mjs';
import { deriveTasks, endTask, escalateTask, loadTasks, startTask, toContract, updateTask, verifyTask } from '../lib/tasks.mjs';

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
  assert.throws(() => endTask(sb.env, { taskId: 'DEMO-001', outcome: 'abandoned' }), /has ended/);
  assert.throws(() => verifyTask(sb.env, { taskId: 'DEMO-001', check: 'unit', result: 'pass', executor: 'script' }), /has ended/);
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

test('a damaged task record line stops task changes and names the place', (t) => {
  const { sb, root } = setup(t, 'task-damaged');
  start(sb, root);
  const dir = path.join(eventsDir(sb.env), new Date().toISOString().slice(0, 7));
  appendFileSync(path.join(dir, '_manual.jsonl'), '{"event":"task.en\n');
  // A damaged hook stream does not matter for task checks.
  appendFileSync(path.join(dir, 'some-session.jsonl'), 'torn\n');

  assert.throws(
    () => verifyTask(sb.env, { taskId: 'DEMO-001', check: 'unit', result: 'pass', executor: 'script', cwd: root }),
    (err) => err.exitCode === 2 && /1 damaged line\(s\): events\/\d{4}-\d{2}\/_manual\.jsonl:2\b/.test(err.message),
  );
  const r = runAsdk(sb, ['task', 'end', 'DEMO-001', '--outcome', 'abandoned']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /_manual\.jsonl:2/);
  // Listing still works: it reads, it does not change anything.
  assert.equal(runAsdk(sb, ['task', 'list']).status, 0);
});

test('blocked and resumed: a blocked task stays open and the blocked time is kept', (t) => {
  const { sb, root } = setup(t, 'task-block');
  const at = (m) => new Date(Date.UTC(2026, 10, 2, 9, m));
  start(sb, root, { now: at(0) });
  assert.throws(() => updateTask(sb.env, { taskId: 'DEMO-001', state: 'resumed', reason: 'x' }), /is not blocked/);
  updateTask(sb.env, { taskId: 'DEMO-001', state: 'blocked', reason: '等規格確認', waitingOn: 'human', now: at(10) });
  assert.throws(() => updateTask(sb.env, { taskId: 'DEMO-001', state: 'blocked', reason: 'x' }), /already blocked/);
  // Still open: verify works while blocked.
  verifyTask(sb.env, { taskId: 'DEMO-001', check: 'unit', result: 'pass', executor: 'script', cwd: root, now: at(15) });
  updateTask(sb.env, { taskId: 'DEMO-001', state: 'resumed', reason: '已確認', now: at(40) });
  updateTask(sb.env, { taskId: 'DEMO-001', state: 'blocked', reason: 'quota', waitingOn: 'quota', now: at(50) });
  endTask(sb.env, { taskId: 'DEMO-001', outcome: 'deferred', now: at(70) });

  const task = loadTasks(sb.env).get('DEMO-001');
  assert.deepEqual(task.blocks, [
    { from: at(10).toISOString(), to: at(40).toISOString(), reason: '等規格確認', waiting_on: 'human' },
    { from: at(50).toISOString(), to: at(70).toISOString(), reason: 'quota', waiting_on: 'quota' },
  ]);
  assert.equal(toContract(task).status, 'ended');
});

test('update and escalate validate their input', (t) => {
  const { sb, root } = setup(t, 'task-update-validate');
  start(sb, root);
  assert.throws(() => updateTask(sb.env, { taskId: 'DEMO-001', state: 'paused', reason: 'x' }), /--state must be one of/);
  assert.throws(() => updateTask(sb.env, { taskId: 'DEMO-001', state: 'blocked', reason: ' ' }), /--reason is required/);
  assert.throws(() => updateTask(sb.env, { taskId: 'DEMO-001', state: 'blocked', reason: 'x', waitingOn: 'boss' }), /--waiting-on must be one of/);
  assert.throws(() => updateTask(sb.env, { taskId: 'DEMO-001', state: 'resumed', reason: 'x', waitingOn: 'human' }), /only goes with --state blocked/);
  assert.throws(() => escalateTask(sb.env, { taskId: 'DEMO-001', kind: 'panic', reason: 'x' }), /--kind must be one of/);
  assert.throws(() => escalateTask(sb.env, { taskId: 'DEMO-002', kind: 'takeover', reason: 'x' }), /has not been started/);
});

test('asdk task update and escalate', (t) => {
  const { sb, root } = setup(t, 'task-update-cli');
  start(sb, root);
  let r = runAsdk(sb, ['task', 'update', 'DEMO-001', '--state', 'blocked', '--reason', 'waiting for review', '--waiting-on', 'human']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /DEMO-001 blocked \(waiting on human\)/);
  r = runAsdk(sb, ['task', 'escalate', 'DEMO-001', '--kind', 'repeated_failure', '--reason', 'G1 failed three times']);
  assert.equal(r.status, 0, r.stderr);
  r = runAsdk(sb, ['task', 'list']);
  assert.match(r.stdout, /^DEMO-001\tdemo-api\tblocked/m);
  assert.equal(runAsdk(sb, ['task', 'update', 'DEMO-001', '--state', 'resumed']).status, 2);
  assert.equal(loadTasks(sb.env).get('DEMO-001').escalations[0].kind, 'repeated_failure');
});

test('an event from a clock a few milliseconds behind still belongs to its task', () => {
  const start = makeEvent({ source: 'cli', event: 'task.start', task_id: 'DEMO-001', project_id: 'demo-api', data: { type: 'feature', risk: 'low' } }, new Date('2026-11-02T09:00:00.010Z'));
  const hook = makeEvent({ source: 'hook', event: 'Stop', session_id: 's-1', task_id: 'DEMO-001', project_id: 'demo-api' }, new Date('2026-11-02T09:00:00.004Z'));
  const { tasks, orphans } = deriveTasks([hook, start]);
  assert.deepEqual([...tasks.get('DEMO-001').sessions], ['s-1']);
  assert.deepEqual(orphans, []);
});
