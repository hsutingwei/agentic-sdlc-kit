// E1 after the runs: hidden tests and a reviewer agent on the commit of every run,
// with the scripted agent and the scripted reviewer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createSandbox } from './helpers/sandbox.mjs';
import { git } from '../core/git.mjs';
import { loadTasks } from '../collector/lib/tasks.mjs';
import { main } from '../tools/experiment/e1.mjs';
import { reviewerAgainstHidden, writeAnalysis } from '../tools/experiment/lib/analyze.mjs';
import { buildPlan, runStates, savePlan } from '../tools/experiment/lib/plan.mjs';
import { agentReviewRun, checkRun, committedRuns, pendingAgentReviews, pendingChecks, reviewBase } from '../tools/experiment/lib/retro.mjs';
import { pendingReviews } from '../tools/experiment/lib/review.mjs';
import { executeRun } from '../tools/experiment/lib/run.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-claude.mjs');
const claude = { command: process.execPath, args: [FAKE] };
const REVIEWER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-reviewer.mjs');
const reviewer = { command: process.execPath, args: [REVIEWER] };
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

test('one reviewer agent reviews the commit of each run, merged or not, and records nothing in the run', async (t) => {
  const { sb, dir, run, metricsEnv } = setup(t, 'e1-retro-review');
  run('r01', 'DEMO-101', 'pro', 'solve'); // low: merged by the runner
  run('r02', 'DEMO-102', 'ultra', 'solve'); // medium: not merged
  run('r03', 'DEMO-109', 'max', 'shallow');
  run('r04', 'DEMO-108', 'pro', 'solve');
  const seen = sb.join('reviewer-args.jsonl');
  const env = (mode) => ({ ...sb.env, FAKE_REVIEW_MODE: mode, FAKE_REVIEW_ARGS_FILE: seen });
  const state = (r) => runStates(dir).get(r);
  const repoOf = (r) => path.join(dir, 'runs', r, 'demo-api');
  const rev = (r, ref) => git(['rev-parse', ref], { cwd: repoOf(r), env: sb.env });

  // A merged change is compared with dev as it was before the merge, an unmerged one with dev.
  assert.equal(state('r01').merged, true);
  assert.equal(reviewBase(repoOf('r01'), sb.env, state('r01').head_sha), rev('r01', `${state('r01').merge_sha}^1`));
  assert.equal(reviewBase(repoOf('r02'), sb.env, state('r02').head_sha), rev('r02', 'dev'));
  assert.deepEqual(pendingAgentReviews(dir).map((s) => s.run), ['r01', 'r02', 'r03', 'r04']);

  const before = { dev: rev('r02', 'dev'), checks: loadTasks(metricsEnv('r02')).get('DEMO-102').verifications.length };
  const merged = agentReviewRun(dir, state('r01'), { baseEnv: env('accept'), claude: reviewer }).agent_review;
  assert.deepEqual([merged.status, merged.decision, merged.act_on, merged.model, merged.effort, merged.cost_usd], ['done', 'accept', 0, 'sonnet', 'high', 0.02]);
  assert.deepEqual(merged.quota, { seven_day: 21 });
  assert.match(merged.reviewer_sha256, /^[0-9a-f]{64}$/);
  const proved = agentReviewRun(dir, state('r02'), { baseEnv: env('prove'), claude: reviewer }).agent_review;
  assert.deepEqual([proved.decision, proved.stated, proved.act_on, proved.proven, proved.consider, proved.noted], ['concerns', 'concerns', 1, 1, 1, 1]);

  // The same reviewer whatever profile made the change, and a packet with the whole change.
  const calls = readFileSync(seen, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.deepEqual([c.args[c.args.indexOf('--model') + 1], c.args[c.args.indexOf('--effort') + 1]], ['sonnet', 'high']);
    assert.ok(c.diff > 0, 'the diff is not empty, also for the merged change');
  }
  const kept = JSON.parse(readFileSync(path.join(dir, 'runs', 'r02', 'agent-review', 'result.json'), 'utf8'));
  assert.equal(kept.final.findings.find((f) => f.id === 'F1').proven, true);
  assert.equal(JSON.stringify(state('r02').agent_review).includes('The list is wrong'), false, 'the log holds numbers, not findings');
  assert.equal(rev('r02', 'dev'), before.dev, 'nothing is merged');
  assert.equal(loadTasks(metricsEnv('r02')).get('DEMO-102').verifications.length, before.checks, 'no review is recorded in the run');
  assert.equal(state('r02').stage, 'review');

  // An answer that is no verdict is a result; a run that could not finish is tried again.
  assert.equal(agentReviewRun(dir, state('r03'), { baseEnv: env('garbage'), claude: reviewer }).agent_review.status, 'invalid');
  const failed = agentReviewRun(dir, state('r04'), { baseEnv: env('error'), claude: reviewer }).agent_review;
  assert.deepEqual([failed.status, failed.decision], ['failed', null]);
  assert.deepEqual(pendingAgentReviews(dir).map((s) => s.run), ['r04']);

  const lines = [];
  const e1 = (args) => main(args, { out: (l) => lines.push(l), baseEnv: env('accept'), output: new PassThrough() });
  assert.equal(await e1(['agent-review', dir, '--claude', REVIEWER, '--limit', '0']), 0);
  assert.deepEqual(lines, ['4 of 4 run(s) reviewed: 1 accepted, 3 left for a person']);
  assert.equal(await e1(['agent-review', dir, '--claude', REVIEWER, '--model', 'haiku', '--effort', 'low', '--no-prove']), 0);
  assert.match(lines.at(-2), /^r04 DEMO-108: accept, 0 act_on \(0 proven\), \d+ s, list price USD 0\.02$/);
  assert.equal(lines.at(-1), '4 of 4 run(s) reviewed: 2 accepted, 2 left for a person');
  assert.deepEqual([state('r04').agent_review.model, state('r04').agent_review.effort], ['haiku', 'low']);
  assert.deepEqual(pendingAgentReviews(dir), []);
  await e1(['status', dir]);
  assert.match(lines.at(-1), /last quota seen: seven_day 21%/, 'the quota check reads what the reviewer runs reported');
});

test('the analysis sets the reviewer agent against the hidden tests, without any review by a person', async (t) => {
  // The analysis reads task and profile from the plan, so this plan is written out.
  const sb = createSandbox(t, 'e1-retro-analysis');
  const dir = sb.join('實驗 E1');
  const planned = [
    ['r01', 'DEMO-101', 'pro', 'solve'],
    ['r02', 'DEMO-109', 'pro', 'shallow'], // the hidden tests fail
    ['r03', 'DEMO-102', 'max', 'solve'],
    ['r04', 'DEMO-108', 'ultra', 'solve'],
    ['r05', 'DEMO-110', 'ultra', 'shallow'], // the hidden tests fail
  ].map(([run, task, profile, mode]) => ({ run, task, profile, repeat: 1, pilot: false, mode }));
  savePlan(dir, { seed: 5, pilot: 'DEMO-101', runs: planned.map(({ mode, ...r }) => r) });
  for (const { mode, ...r } of planned) executeRun(dir, r, { baseEnv: { ...sb.env, FAKE_CLAUDE_MODE: mode }, claude });
  for (const s of pendingChecks(dir)) checkRun(dir, s, { baseEnv: sb.env });
  const review = (r, mode) => agentReviewRun(dir, runStates(dir).get(r), { baseEnv: { ...sb.env, FAKE_REVIEW_MODE: mode }, claude: reviewer });
  review('r01', 'accept');
  review('r02', 'accept'); // slips through
  review('r03', 'prove'); // held with a proven finding, though the hidden tests pass
  review('r04', 'garbage');
  review('r05', 'prove'); // caught

  const { rows, profiles, files } = writeAnalysis(dir);
  assert.deepEqual(rows.map((r) => `${r.run} ${r.hidden_tests} ${r.reviewer_status} ${r.reviewer_decision} ${r.decision}`), [
    'r01 pass done accept null',
    'r02 fail done accept null',
    'r03 pass done concerns null',
    'r04 pass invalid null null',
    'r05 fail done concerns null',
  ]);
  assert.deepEqual(reviewerAgainstHidden(rows), {
    changes: 5,
    accepted_pass: 1,
    accepted_fail: 1,
    held_pass: 1,
    held_pass_proven: 1,
    held_fail: 1,
    no_verdict_pass: 1,
    no_verdict_fail: 0,
    for_a_person: 3,
    settings: ['sonnet at high effort'],
    cost_usd_total: 0.1,
    wall_s_median: rows.map((r) => r.reviewer_wall_s).sort((a, b) => a - b)[2],
  });
  const pro = profiles.find((p) => p.profile === 'pro');
  assert.deepEqual([pro.runs, pro.hidden_checked, pro.hidden_passed, pro.reviewer_reviewed, pro.reviewer_accepted, pro.accepted, pro.reviews_timed], [2, 2, 1, 2, 2, 0, 0]);

  const summary = readFileSync(files.summary, 'utf8');
  assert.match(summary, /Runs finished: 5 of 5 planned/);
  assert.match(summary, /Hidden tests run on 5, reviewer agent on 5, reviewed by a person 0\./);
  assert.match(summary, /\| Reviewer accepts \| 1 \| 1 \|\n\| Reviewer does not accept \| 1 \| 1 \|\n\| No usable verdict \| 1 \| 0 \|/);
  assert.match(summary, /A person would look at 3 of 5 change\(s\)/);
  assert.match(summary, /Not accepted although the hidden tests pass: 1, 1 of them with a proven finding\./);
  assert.match(summary, /\| pro \| 2 \| 1 of 2 \| 2 of 2 \| 0 \|/);
  assert.match(summary, /\| DEMO-109 \| \w+ \| – \| – \| H✗ R:accept \|/);
  assert.match(summary, /\| DEMO-108 \| \w+ \| H✓ R:none \| – \| – \|/);
  const runsCsv = readFileSync(files.runs, 'utf8');
  assert.match(runsCsv, /hidden_tests,reviewer_status,reviewer_decision,reviewer_act_on,reviewer_proven/);
  assert.doesNotMatch(`${runsCsv}${summary}`, /The list is wrong|suspected problem/, 'no finding text is published');

  // A person's review of one run still counts, next to the rest.
  const input = new PassThrough();
  input.end(['', 'a', '', 'q'].join('\n') + '\n');
  await main(['review', dir], { out: () => {}, baseEnv: sb.env, input, output: new PassThrough() });
  const after = writeAnalysis(dir);
  assert.equal(after.rows.filter((r) => r.decision === 'accept').length, 1);
  assert.match(readFileSync(after.files.summary, 'utf8'), /reviewed by a person 1\./);
});
