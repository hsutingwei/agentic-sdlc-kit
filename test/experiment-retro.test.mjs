// E1 after the runs: hidden tests on the commit of every run, without a review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './helpers/sandbox.mjs';
import { git } from '../core/git.mjs';
import { loadTasks } from '../collector/lib/tasks.mjs';
import { main } from '../tools/experiment/e1.mjs';
import { buildPlan, runStates, savePlan } from '../tools/experiment/lib/plan.mjs';
import { checkRun, committedRuns, pendingChecks } from '../tools/experiment/lib/retro.mjs';
import { pendingReviews } from '../tools/experiment/lib/review.mjs';
import { executeRun } from '../tools/experiment/lib/run.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const claude = { command: process.execPath, args: [FAKE] };
const TASKS = Array.from({ length: 12 }, (_, i) => `DEMO-${101 + i}`);

function setup(t, label) {
  const sb = createSandbox(t, label);
  const dir = sb.join('實驗 E1');
  savePlan(dir, buildPlan({ tasks: TASKS, seed: 5, pilot: 'DEMO-101' }));
  const run = (run, task, profile, mode) => executeRun(dir, { run, task, profile, repeat: 1, pilot: false }, { baseEnv: { ...sb.env, FAKE_CLAUDE_MODE: mode }, claude });
  const metricsEnv = (r) => ({ ...sb.env, AGENTIC_METRICS_HOME: path.join(dir, 'runs', r, 'metrics') });
  return { sb, dir, run, metricsEnv };
}

test('the hidden tests run on the commit of each run, merged or not, and change nothing else', async (t) => {
  const { sb, dir, run, metricsEnv } = setup(t, 'e1-retro-check');
  run('r01', 'DEMO-101', 'pro', 'solve'); // low: merged by the runner
  run('r02', 'DEMO-102', 'max', 'solve'); // medium: not merged
  run('r03', 'DEMO-109', 'ultra', 'shallow'); // passes the gates, not the hidden tests
  run('r04', 'DEMO-110', 'pro', 'break'); // the gate failed twice; its commit is still checked
  assert.deepEqual(pendingChecks(dir).map((s) => s.run), ['r01', 'r02', 'r03', 'r04']);

  const repo = path.join(dir, 'runs', 'r02', 'demo-api');
  const before = { dev: git(['rev-parse', 'dev'], { cwd: repo, env: sb.env }), worktrees: git(['worktree', 'list'], { cwd: repo, env: sb.env }), events: loadTasks(metricsEnv('r02')).get('DEMO-102').verifications.length };
  const first = checkRun(dir, pendingChecks(dir)[1], { baseEnv: sb.env });
  assert.deepEqual([first.run, first.hidden_check.result, first.hidden_check.failed], ['r02', 'pass', 0]);
  assert.ok(first.hidden_check.passed > 0);
  assert.equal(git(['rev-parse', 'dev'], { cwd: repo, env: sb.env }), before.dev, 'nothing is merged');
  assert.equal(git(['worktree', 'list'], { cwd: repo, env: sb.env }), before.worktrees, 'no checkout is left behind');
  assert.equal(loadTasks(metricsEnv('r02')).get('DEMO-102').verifications.length, before.events, 'nothing is recorded in the run');

  const lines = [];
  assert.equal(await main(['check', dir], { out: (l) => lines.push(l), baseEnv: sb.env, output: new PassThrough() }), 0);
  assert.equal(lines.filter((l) => /^r0\d DEMO-\d+: hidden tests/.test(l)).length, 3, 'r02 was already checked');
  assert.match(lines.at(-1), /^4 run\(s\) checked: 2 pass their hidden tests, 2 fail$/);
  const states = runStates(dir);
  assert.deepEqual(['r01', 'r02', 'r03', 'r04'].map((r) => states.get(r).hidden_check.result), ['pass', 'pass', 'fail', 'fail']);
  assert.equal(states.get('r03').hidden_check.sha, states.get('r03').head_sha);
  assert.deepEqual(pendingChecks(dir), []);

  // The runs still wait for whatever comes next: their stage has not moved.
  assert.equal(committedRuns(dir).length, 4);
  assert.deepEqual(pendingReviews(dir).map((s) => s.run).sort(), ['r01', 'r02', 'r03', 'r04']);
  lines.length = 0;
  await main(['check', dir], { out: (l) => lines.push(l), baseEnv: sb.env, output: new PassThrough() });
  assert.deepEqual(lines, ['4 run(s) checked: 2 pass their hidden tests, 2 fail'], 'a second check runs nothing again');
});
