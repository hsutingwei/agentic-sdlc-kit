import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandbox } from './helpers/sandbox.mjs';
import { buildPlan, loadPlan, logRun, readLog, runStates, savePlan } from '../tools/experiment/lib/plan.mjs';

const TASKS = Array.from({ length: 12 }, (_, i) => `DEMO-${101 + i}`);
const REPEATS = ['DEMO-101', 'DEMO-108', 'DEMO-112'].map((task) => ({ task, profile: 'max', count: 2 }));

test('the plan: every task with every profile, the repeats, the pilot first, reproducible', () => {
  const plan = buildPlan({ tasks: TASKS, seed: 20261124, pilot: 'DEMO-102', repeats: REPEATS });
  assert.equal(plan.runs.length, 42);
  assert.deepEqual(new Set(plan.runs.map((r) => r.run)).size, 42);
  const pilot = plan.runs.slice(0, 3);
  assert.deepEqual(pilot.map((r) => r.task), ['DEMO-102', 'DEMO-102', 'DEMO-102']);
  assert.deepEqual(new Set(pilot.map((r) => r.profile)), new Set(['ultra', 'max', 'pro']));
  assert.ok(pilot.every((r) => r.pilot) && plan.runs.slice(3).every((r) => !r.pilot));
  for (const task of TASKS) {
    for (const profile of ['ultra', 'max', 'pro']) assert.ok(plan.runs.some((r) => r.task === task && r.profile === profile && r.repeat === 1), `${task} ${profile}`);
  }
  assert.equal(plan.runs.filter((r) => r.task === 'DEMO-108' && r.profile === 'max').length, 3);
  assert.deepEqual(buildPlan({ tasks: TASKS, seed: 20261124, pilot: 'DEMO-102', repeats: REPEATS }), plan);
  assert.notDeepEqual(buildPlan({ tasks: TASKS, seed: 7, pilot: 'DEMO-102', repeats: REPEATS }).runs, plan.runs);
  // Profiles are interleaved, not run in blocks.
  const firstTen = plan.runs.slice(3, 13).map((r) => r.profile);
  assert.ok(new Set(firstTen).size === 3, firstTen.join());
  assert.throws(() => buildPlan({ tasks: TASKS, seed: 1, pilot: 'DEMO-999' }), /not in the catalogue/);
});

test('a plan is saved once; the log is append-only and states are derived', (t) => {
  const sb = createSandbox(t, 'e1-plan');
  const dir = sb.join('實驗 E1');
  savePlan(dir, buildPlan({ tasks: TASKS, seed: 1, pilot: 'DEMO-101' }));
  assert.throws(() => savePlan(dir, buildPlan({ tasks: TASKS, seed: 2, pilot: 'DEMO-101' })), /never replaced/);
  assert.equal(loadPlan(dir).runs.length, 36);
  logRun(dir, { run: 'r01', stage: 'started', task: 'DEMO-101' });
  logRun(dir, { run: 'r01', stage: 'agent', attempts: 1 });
  logRun(dir, { run: 'r02', stage: 'started' });
  assert.equal(readLog(dir).length, 3);
  assert.deepEqual(
    (({ stage, task, attempts }) => ({ stage, task, attempts }))(runStates(dir).get('r01')),
    { stage: 'agent', task: 'DEMO-101', attempts: 1 },
  );
});
