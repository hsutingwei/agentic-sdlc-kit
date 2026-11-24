import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox, makeRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { deriveHumanTime } from '../lib/human-time.mjs';
import { adjustHuman, humanStatus, startHuman, stopHuman } from '../lib/human.mjs';
import { registerProject } from '../lib/registry.mjs';
import { makeEvent } from '../lib/store.mjs';
import { endTask, startTask } from '../lib/tasks.mjs';

const at = (min) => new Date(Date.UTC(2026, 10, 2, 9, 0) + min * 60000);

function setup(t, label) {
  const sb = createSandbox(t, label);
  const root = makeRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root });
  for (const id of ['DEMO-001', 'DEMO-002']) startTask(sb.env, { taskId: id, cwd: root, type: 'feature', risk: 'low', estimateHours: 6, now: at(0) });
  return { sb, root };
}

test('timed periods add up per task and per activity', (t) => {
  const { sb } = setup(t, 'human-sum');
  startHuman(sb.env, { taskId: 'DEMO-001', activity: 'spec', now: at(0) });
  stopHuman(sb.env, { taskId: 'DEMO-001', now: at(20) });
  startHuman(sb.env, { taskId: 'DEMO-001', activity: 'review', now: at(60) });
  stopHuman(sb.env, { now: at(75) });
  adjustHuman(sb.env, { taskId: 'DEMO-001', minutes: 10, activity: 'review', reason: '忘了計時的審查', now: at(80) });

  const { open, tasks } = humanStatus(sb.env);
  assert.equal(open, null);
  const rec = tasks.get('DEMO-001');
  assert.equal(rec.minutes, 45);
  assert.deepEqual(rec.by_activity, { spec: 20, review: 25 });
  assert.equal(rec.periods.length, 2);
  assert.equal(rec.adjustments[0].reason, '忘了計時的審查');
  assert.deepEqual([...rec.flags], []);
});

test('one timer at a time; --switch moves it to another task', (t) => {
  const { sb } = setup(t, 'human-one');
  startHuman(sb.env, { taskId: 'DEMO-001', now: at(0) });
  assert.throws(() => startHuman(sb.env, { taskId: 'DEMO-001', now: at(1) }), /already running since/);
  assert.throws(() => startHuman(sb.env, { taskId: 'DEMO-002', now: at(1) }), /running since .*--switch/);
  const { stopped } = startHuman(sb.env, { taskId: 'DEMO-002', activity: 'fix', switchTask: true, now: at(30) });
  assert.equal(stopped.task_id, 'DEMO-001');
  assert.throws(() => stopHuman(sb.env, { taskId: 'DEMO-001', now: at(40) }), /running timer is for DEMO-002/);
  stopHuman(sb.env, { now: at(40) });
  assert.throws(() => stopHuman(sb.env, { now: at(41) }), /no human timer is running/);

  const { tasks } = humanStatus(sb.env);
  assert.equal(tasks.get('DEMO-001').minutes, 30);
  assert.deepEqual(tasks.get('DEMO-002').by_activity, { fix: 10 });
});

test('ending a task stops its timer and marks it; long sessions are marked', (t) => {
  const { sb } = setup(t, 'human-end');
  startHuman(sb.env, { taskId: 'DEMO-001', activity: 'acceptance', now: at(0) });
  endTask(sb.env, { taskId: 'DEMO-001', outcome: 'accepted', completedBy: 'ai', now: at(15) });
  startHuman(sb.env, { taskId: 'DEMO-002', now: at(20) });
  stopHuman(sb.env, { now: at(20 + 9 * 60) });

  const { open, tasks } = humanStatus(sb.env);
  assert.equal(open, null);
  assert.equal(tasks.get('DEMO-001').minutes, 15);
  assert.deepEqual([...tasks.get('DEMO-001').flags], ['human_timer_auto_stopped']);
  assert.deepEqual([...tasks.get('DEMO-002').flags], ['long_human_session']);
  assert.throws(() => startHuman(sb.env, { taskId: 'DEMO-001' }), /has ended/);
});

test('adjustments are checked and work after the task ended', (t) => {
  const { sb } = setup(t, 'human-adjust');
  startHuman(sb.env, { taskId: 'DEMO-001', now: at(0) });
  stopHuman(sb.env, { now: at(30) });
  endTask(sb.env, { taskId: 'DEMO-001', outcome: 'abandoned', now: at(31) });
  assert.throws(() => adjustHuman(sb.env, { taskId: 'DEMO-001', minutes: -31, reason: 'x' }), /cannot take the total below 0/);
  adjustHuman(sb.env, { taskId: 'DEMO-001', minutes: -30, reason: '其實是在開會' });
  assert.equal(humanStatus(sb.env).tasks.get('DEMO-001').minutes, 0);
  for (const minutes of [0, Number.NaN, 24 * 60 + 1]) {
    assert.throws(() => adjustHuman(sb.env, { taskId: 'DEMO-001', minutes, reason: 'x' }), /--minutes/);
  }
  assert.throws(() => adjustHuman(sb.env, { taskId: 'DEMO-001', minutes: 5, reason: '' }), /--reason is required/);
  assert.throws(() => adjustHuman(sb.env, { taskId: 'DEMO-009', minutes: 5, reason: 'x' }), /has not been started/);
  assert.throws(() => startHuman(sb.env, { taskId: 'DEMO-002', activity: 'meeting' }), /--activity must be one of/);
});

test('unexpected sequences are flagged, not trusted', () => {
  const ev = (event, task, min, data) => makeEvent({ source: 'cli', event, task_id: task, project_id: 'demo-api', data }, at(min));
  const { tasks } = deriveHumanTime([
    ev('human.stop', 'DEMO-001', 0),
    ev('human.start', 'DEMO-001', 10, { activity: 'review' }),
    ev('human.stop', 'DEMO-001', 5),
  ]);
  const rec = tasks.get('DEMO-001');
  assert.ok(rec.flags.has('unpaired_human_stop'));
  assert.ok(rec.flags.has('clock_went_back'));
  assert.equal(rec.minutes, 0);
});

test('asdk human start, stop, adjust, status and task list', (t) => {
  const { sb } = setup(t, 'human-cli');
  let r = runAsdk(sb, ['human', 'start', 'DEMO-001', '--activity', 'review']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /timing DEMO-001 \(review\)/);
  r = runAsdk(sb, ['human', 'status', '--json']);
  assert.equal(JSON.parse(r.stdout).open.task_id, 'DEMO-001');
  assert.equal(runAsdk(sb, ['human', 'start', 'DEMO-002']).status, 1);
  assert.equal(runAsdk(sb, ['human', 'start', 'DEMO-002', '--switch']).status, 0);
  assert.equal(runAsdk(sb, ['human', 'stop']).status, 0);
  r = runAsdk(sb, ['human', 'adjust', 'DEMO-001', '--minutes', '25', '--reason', 'review before timing', '--activity', 'review']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(runAsdk(sb, ['human', 'adjust', 'DEMO-001', '--minutes', 'ten', '--reason', 'x']).status, 2);
  r = runAsdk(sb, ['task', 'list']);
  assert.match(r.stdout, /^DEMO-001\tdemo-api\tactive\t-\thuman 25 min\tescalations 0$/m);
  r = runAsdk(sb, ['human', 'status']);
  assert.match(r.stdout, /^no timer running$/m);
  assert.match(r.stdout, /^DEMO-001\t25 min\treview 25 min/m);
});
