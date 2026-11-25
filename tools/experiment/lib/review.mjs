// The person's part of an E1 run: a blind review.
//
// Runs waiting for review are shown in a seeded order of their own, without the
// profile, so the reviewer cannot tell which setting produced the change. The kit
// times the review (human timer, activity review); the decision is recorded as a
// review and, when accepted, as the acceptance, both on the exact commit. An
// accepted change is merged if it was not already, its hidden tests are run, and
// the task ends; token usage is harvested last.

import path from 'node:path';
import { git } from '../../../core/git.mjs';
import { harvestSessions, sessionsOfTask } from '../../../adapters/claude-code/harvest-cli.mjs';
import { startHuman, stopHuman } from '../../../collector/lib/human.mjs';
import { readEvents } from '../../../collector/lib/store.mjs';
import { endTask, verifyTask } from '../../../collector/lib/tasks.mjs';
import { finishWorktree } from '../../../orchestration/lib/worktree.mjs';
import { loadTask, runHidden } from './catalogue.mjs';
import { loadPlan, logRun, runDir, runStates, seeded } from './plan.mjs';
import { runEnv, writeShims } from './run.mjs';

// What the terminal shows; the diff file always has the whole change.
const MAX_SCREEN_CHARS = 200000;
const MAX_LINE_CHARS = 300;
const KEEP_LINE_CHARS = 200;

/** The change as the terminal shows it: very long lines shortened, the whole capped. */
export function screenDiff(diff) {
  const lines = diff.split('\n').map((line) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, KEEP_LINE_CHARS)} … (${line.length - KEEP_LINE_CHARS} more characters, whole line in the diff file)` : line));
  const text = lines.join('\n');
  return text.length > MAX_SCREEN_CHARS ? `${text.slice(0, MAX_SCREEN_CHARS)}\n… (cut at ${MAX_SCREEN_CHARS} characters; the whole change is in the diff file)` : text;
}

/** Runs waiting for review, in the blind order. */
export function pendingReviews(dir) {
  const plan = loadPlan(dir);
  const states = runStates(dir);
  const rand = seeded(plan.seed + 1);
  const order = new Map(plan.runs.map((r) => [r.run, rand()]));
  return [...states.values()].filter((s) => s.stage === 'review').sort((a, b) => order.get(a.run) - order.get(b.run));
}

function context(dir, state, baseEnv) {
  const folder = runDir(dir, state.run);
  return {
    task: loadTask(state.task),
    repo: path.join(folder, 'demo-api'),
    env: runEnv(baseEnv, { metrics: path.join(folder, 'metrics'), bin: writeShims(dir) }),
  };
}

/** What the reviewer sees: the brief, what the gate said, and the change. Never the profile. */
export function reviewMaterial(dir, state, { baseEnv = process.env } = {}) {
  const { task, repo, env } = context(dir, state, baseEnv);
  let range = null;
  if (state.merged && state.merge_sha) range = [`${state.merge_sha}^1`, state.merge_sha];
  else if (state.head_sha) range = [`dev...${state.head_sha}`];
  const diff = range ? git(['diff', '--stat', '--patch', ...range], { cwd: repo, env }) : '';
  return {
    title: task.brief.title,
    goal: task.brief.goal,
    criteria: task.brief.acceptance_criteria,
    gate: state.gate_failed ? 'failed twice; nothing can be merged' : state.first_gate === 'pass' ? 'passed' : 'passed after one retry',
    merged: state.merged === true,
    diff,
    screen: screenDiff(diff),
    can_accept: !state.gate_failed && Boolean(state.head_sha),
  };
}

/** Starts the review timer. */
export function beginReview(dir, state, { baseEnv = process.env, now } = {}) {
  const { env } = context(dir, state, baseEnv);
  startHuman(env, { taskId: state.task, activity: 'review', switchTask: true, now });
}

/** Stops the timer without a decision; the time spent so far still counts when the review resumes. */
export function pauseReview(dir, state, { baseEnv = process.env, now } = {}) {
  const { env } = context(dir, state, baseEnv);
  stopHuman(env, { taskId: state.task, now });
}

/**
 * Leaves a finished review's time out of the analysis, for example when the timer
 * kept running long after the decision; the decision and its checks still count.
 * The reason stays in the experiment log and is not published.
 */
export function excludeReviewTime(dir, run, reason, { now = () => new Date() } = {}) {
  const state = runStates(dir).get(run);
  if (!state) throw new Error(`no run ${run} in this experiment`);
  if (state.stage !== 'done') throw new Error(`run ${run} has not been reviewed yet`);
  if (!reason || !String(reason).trim()) throw new Error('give a reason');
  const record = { run, review_time_excluded: String(reason).trim().slice(0, 300) };
  logRun(dir, record, now());
  return record;
}

/**
 * Records the decision, then merges, checks and ends the task.
 * @param {{ decision: 'accept' | 'reject', note?: string }} verdict
 */
export function completeReview(dir, state, { decision, note }, { baseEnv = process.env, now = () => new Date() } = {}) {
  if (decision !== 'accept' && decision !== 'reject') throw new Error('decision must be accept or reject');
  const { task, repo, env } = context(dir, state, baseEnv);
  const material = reviewMaterial(dir, state, { baseEnv });
  if (decision === 'accept' && !material.can_accept) throw new Error('this run cannot be accepted: its gate failed twice');

  const timer = stopHuman(env, { taskId: task.id, now: now() });
  const minutes = (now().getTime() - Date.parse(timer.since)) / 60000;
  const sha = state.head_sha ?? undefined;
  if (sha) verifyTask(env, { taskId: task.id, check: 'review', result: decision === 'accept' ? 'pass' : 'fail', executor: 'human', sha, now: now() });

  let merged = state.merged === true;
  let hidden = null;
  if (decision === 'accept') {
    verifyTask(env, { taskId: task.id, check: 'acceptance', result: 'pass', executor: 'human', sha, now: now() });
    if (!merged) {
      const finish = finishWorktree(env, { taskId: task.id });
      if (!finish.merged) throw new Error(`the accepted change could not be merged: ${finish.reason}`);
      merged = true;
    }
    hidden = runHidden(env, { task, repo, ref: 'dev' });
  }
  endTask(env, { taskId: task.id, outcome: decision === 'accept' ? 'accepted' : 'rejected', completedBy: decision === 'accept' ? 'ai' : undefined, now: now() });
  const harvest = harvestSessions(env, sessionsOfTask(readEvents(env).events, task.id));

  const record = {
    run: state.run,
    stage: 'done',
    decision,
    review_minutes: Math.round(minutes * 100) / 100,
    merged,
    hidden: hidden ? { result: hidden.result, passed: hidden.passed, failed: hidden.failed } : null,
    escaped_defects: hidden && hidden.result !== 'pass' ? 1 : 0,
    harvested: harvest.filter((h) => h.status === 'harvested' || h.status === 'unchanged').length,
    ...(note ? { note: String(note).slice(0, 500) } : {}),
  };
  logRun(dir, record, now());
  return record;
}
