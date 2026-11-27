// E1 after the runs: what each change is worth without a person reading it.
//
// For every run that left a commit, the task's hidden tests run on that exact
// commit: the answer key of the experiment. Then one reviewer agent, the same for
// every run whatever profile made the change, reviews that commit as
// `asdk review run` would: a sterile run on a packet, its findings proven, the
// brief's scope checked. Nothing is merged and nothing is recorded in the run's
// own metrics, so the runs stay as the agents left them; the results go to the
// experiment log and do not change the run's stage. The reviewer's answer stays
// in the run folder (agent-review/) and is never copied into the repository.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { git, tryGit } from '../../../core/git.mjs';
import { loadTaskRecords } from '../../../collector/lib/tasks.mjs';
import { loadProfiles, resolveRole } from '../../../governance/profiles/profiles.mjs';
import { checksAt, INSTRUCTIONS } from '../../../governance/review/packet.mjs';
import { reviewOnce } from '../../../governance/review/run.mjs';
import { loadTask, runHidden } from './catalogue.mjs';
import { logRun, runDir, runStates } from './plan.mjs';
import { runEnv, writeShims } from './run.mjs';

// One reviewer setting for every change, so the reviewer is not what differs between profiles.
export const REVIEWER_PROFILE = 'max';
const REVIEWER_TIMEOUT_MS = 10 * 60000;

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

/** The commit a run's change is compared with: dev, or dev as it was before the change was merged. */
export function reviewBase(repo, env, head) {
  const dev = git(['rev-parse', 'refs/heads/dev'], { cwd: repo, env });
  if (!tryGit(['merge-base', '--is-ancestor', head, dev], { cwd: repo, env }).ok) return dev;
  const LF = String.fromCharCode(10);
  for (const line of git(['rev-list', '--first-parent', '--parents', dev], { cwd: repo, env }).split(LF)) {
    const [, first, ...others] = line.trim().split(' ');
    if (others.includes(head)) return first;
  }
  throw new Error(`${head.slice(0, 12)} is on dev without a merge commit, so its change cannot be told apart`);
}

/**
 * Runs whose commit has no reviewer verdict yet. An answer that is not a usable
 * verdict is a result and stays; a run that could not finish is tried again.
 */
export function pendingAgentReviews(dir) {
  return committedRuns(dir).filter((s) => s.agent_review?.sha !== s.head_sha || s.agent_review.status === 'failed');
}

/** One reviewer agent on the run's commit; logs numbers and keeps the answer in the run folder. */
export function agentReviewRun(dir, state, { baseEnv = process.env, claude, model, effort, prove = true, now = () => new Date() } = {}) {
  const { task, folder, repo, env } = runContext(dir, state, baseEnv);
  const sha = state.head_sha;
  const base = reviewBase(repo, env, sha);
  const role = resolveRole(loadProfiles(null).profiles[REVIEWER_PROFILE], 'reviewer', state.risk?.effective ?? task.brief.risk);
  const settings = { model: model ?? role.model, effort: effort ?? role.effort };
  const record = loadTaskRecords(env).get(task.id);
  const out = path.join(folder, 'agent-review');
  rmSync(out, { recursive: true, force: true }); // what an unfinished attempt left
  mkdirSync(out, { recursive: true });
  const once = reviewOnce(env, {
    dir: path.join(out, 'run'),
    repo,
    sha,
    base,
    taskId: task.id,
    checks: record ? checksAt(env, { task: record, sha }) : undefined,
    language: 'en',
    claude,
    ...settings,
    prove,
    timeoutMs: REVIEWER_TIMEOUT_MS,
  });
  const a = once.answer;
  const findings = once.final?.findings ?? [];
  const count = (pick) => findings.filter(pick).length;
  const review = {
    sha,
    base,
    status: once.status,
    ...(once.problem ? { problem: String(once.problem).slice(0, 200) } : {}),
    decision: once.final?.decision ?? null,
    stated: once.verdict?.decision ?? null,
    act_on: count((f) => f.class === 'act_on'),
    proven: count((f) => f.proven),
    by_kit: count((f) => f.by === 'kit'),
    consider: count((f) => f.class === 'consider'),
    noted: count((f) => f.class === 'noted'),
    outside_scope: once.final?.scope?.outside.length ?? 0,
    ...settings,
    reviewer_sha256: createHash('sha256').update(readFileSync(INSTRUCTIONS)).digest('hex'),
    claude_version: a.loaded?.version ?? null,
    cost_usd: a.cost_usd ?? 0,
    wall_ms: a.wall_ms,
    quota: Object.fromEntries((a.windows ?? []).map((w) => [w.name, w.used_pct])),
  };
  writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ...review, verdict: once.verdict, proofs: once.proofs, final: once.final, usage: a.usage }, null, 2));
  const logged = { run: state.run, agent_review: review };
  logRun(dir, logged, now());
  return logged;
}
