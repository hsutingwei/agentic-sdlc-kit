// E1 after the runs: what each change is worth without a person reading it.
//
// For every run that left a commit, the task's hidden tests run on that exact
// commit: the answer key of the experiment. Nothing is merged and nothing is
// recorded in the run's own metrics, so the runs stay as the agents left them;
// the result goes to the experiment log and does not change the run's stage.

import path from 'node:path';
import { loadTask, runHidden } from './catalogue.mjs';
import { logRun, runDir, runStates } from './plan.mjs';
import { runEnv, writeShims } from './run.mjs';

/** The task, repository and environment of a run. */
export function runContext(dir, state, baseEnv = process.env) {
  const folder = runDir(dir, state.run);
  return {
    task: loadTask(state.task),
    folder,
    repo: path.join(folder, 'demo-api'),
    env: runEnv(baseEnv, { metrics: path.join(folder, 'metrics'), bin: writeShims(dir) }),
  };
}

/** Runs that left a commit, in plan order. */
export function committedRuns(dir) {
  return [...runStates(dir).values()].filter((s) => s.head_sha && (s.stage === 'review' || s.stage === 'done')).sort((a, b) => (a.run < b.run ? -1 : 1));
}

/** Runs whose commit has not been checked against the hidden tests yet. */
export function pendingChecks(dir) {
  return committedRuns(dir).filter((s) => s.hidden_check?.sha !== s.head_sha);
}

/** Runs the hidden tests of the run's task on its commit and logs the result. */
export function checkRun(dir, state, { baseEnv = process.env, now = () => new Date() } = {}) {
  const { task, repo, env } = runContext(dir, state, baseEnv);
  const hidden = runHidden(env, { task, repo, ref: state.head_sha });
  const record = { run: state.run, hidden_check: { sha: state.head_sha, result: hidden.result, passed: hidden.passed, failed: hidden.failed } };
  logRun(dir, record, now());
  return record;
}
