// The blind review of E1 runs, after runs made with the scripted agent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './helpers/sandbox.mjs';
import { loadTasks } from '../collector/lib/tasks.mjs';
import { buildPlan, runStates, savePlan } from '../tools/experiment/lib/plan.mjs';
import { executeRun } from '../tools/experiment/lib/run.mjs';
import { beginReview, completeReview, pendingReviews, reviewMaterial } from '../tools/experiment/lib/review.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const claude = { command: process.execPath, args: [FAKE] };
const TASKS = Array.from({ length: 12 }, (_, i) => `DEMO-${101 + i}`);

function setup(t, label) {
  const sb = createSandbox(t, label);
  const dir = sb.join('實驗 E1');
  savePlan(dir, buildPlan({ tasks: TASKS, seed: 5, pilot: 'DEMO-101' }));
  const run = (run, task, profile, mode) => executeRun(dir, { run, task, profile, repeat: 1, pilot: false }, { baseEnv: { ...sb.env, FAKE_CLAUDE_MODE: mode }, claude });
  // A fixed clock, so review minutes are exact.
  let clock = Date.parse('2026-11-25T09:00:00Z');
  const now = () => new Date(clock);
  const tick = (minutes) => {
    clock += minutes * 60000;
  };
  const metricsEnv = (r) => ({ ...sb.env, AGENTIC_METRICS_HOME: path.join(dir, 'runs', r, 'metrics') });
  return { sb, dir, run, now, tick, metricsEnv, opts: { baseEnv: sb.env, now } };
}

test('accepting merges if needed, runs the hidden tests and ends the task; the profile stays hidden', (t) => {
  const { dir, run, now, tick, metricsEnv, opts } = setup(t, 'e1-review');
  run('r01', 'DEMO-101', 'pro', 'solve'); // low: merged by the runner
  run('r02', 'DEMO-102', 'max', 'solve'); // medium: waits for the review
  run('r03', 'DEMO-109', 'ultra', 'shallow'); // passes the gates, not the hidden tests
  const pending = pendingReviews(dir);
  assert.deepEqual(pending.map((s) => s.run).sort(), ['r01', 'r02', 'r03']);

  const byRun = Object.fromEntries(pending.map((s) => [s.run, s]));
  const material = reviewMaterial(dir, byRun.r02, opts);
  assert.equal(JSON.stringify(material).includes('max'), false, 'the profile is not shown');
  assert.equal(material.merged, false);
  assert.match(material.diff, /src\/server\.mjs/);
  assert.equal(material.criteria.length, 2);

  for (const [r, minutes] of [['r01', 3], ['r02', 5.5], ['r03', 2]]) {
    beginReview(dir, byRun[r], { ...opts, now: now() });
    tick(minutes);
    const done = completeReview(dir, byRun[r], { decision: 'accept' }, opts);
    assert.equal(done.review_minutes, minutes, r);
    assert.equal(done.merged, true, r);
  }
  const states = runStates(dir);
  assert.deepEqual([states.get('r01').escaped_defects, states.get('r02').escaped_defects, states.get('r03').escaped_defects], [0, 0, 1]);
  assert.equal(states.get('r03').hidden.result, 'fail');
  assert.deepEqual(pendingReviews(dir), []);

  const task = loadTasks(metricsEnv('r02')).get('DEMO-102');
  assert.deepEqual([task.status, task.outcome, task.completed_by], ['ended', 'accepted', 'ai']);
  assert.deepEqual(task.verifications.map((v) => `${v.check}:${v.result}:${v.executor}`).slice(-3), ['review:pass:human', 'acceptance:pass:human', 'integration:pass:script']);
});

test('a rejected change ends the task as rejected; a twice-failed gate cannot be accepted', (t) => {
  const { dir, run, now, tick, metricsEnv, opts } = setup(t, 'e1-review-reject');
  run('r01', 'DEMO-108', 'pro', 'solve');
  run('r02', 'DEMO-110', 'pro', 'break');
  const [a, b] = ['r01', 'r02'].map((r) => pendingReviews(dir).find((s) => s.run === r));

  beginReview(dir, a, { ...opts, now: now() });
  tick(4);
  const rejected = completeReview(dir, a, { decision: 'reject', note: '測試 不夠' }, opts);
  assert.deepEqual([rejected.decision, rejected.merged, rejected.hidden], ['reject', false, null]);
  assert.equal(loadTasks(metricsEnv('r01')).get('DEMO-108').outcome, 'rejected');

  assert.equal(reviewMaterial(dir, b, opts).can_accept, false);
  beginReview(dir, b, { ...opts, now: now() });
  assert.throws(() => completeReview(dir, b, { decision: 'accept' }, opts), /cannot be accepted/);
  tick(1);
  assert.equal(completeReview(dir, b, { decision: 'reject' }, opts).decision, 'reject');
});
