// Task lifecycle: start -> verify (any number) -> end.
//
// Task state is never stored on its own; it is derived from the event log every
// time, so the log stays the single source of truth. (A local state cache and
// lock files for concurrent writers come in a later phase.)

import { ruleError, usageError } from '../../core/errors.mjs';
import { headSha } from '../../core/git.mjs';
import { validateContract } from '../../core/validate.mjs';
import { resolveProject } from './registry.mjs';
import { appendEvent, makeEvent, readEvents } from './store.mjs';

export const TASK_TYPES = ['bugfix', 'feature', 'refactor', 'test', 'docs', 'config', 'investigation'];
export const RISKS = ['low', 'medium', 'high', 'critical'];
export const CHECKS = ['build', 'unit', 'integration', 'ui', 'acceptance'];
export const RESULTS = ['pass', 'fail', 'error'];
export const EXECUTORS = ['script', 'human'];
export const OUTCOMES = ['accepted', 'rejected', 'abandoned', 'deferred'];
export const COMPLETED_BY = ['ai', 'ai_with_human_fixes', 'human'];

const TASK_ID = /^[A-Z][A-Z0-9]*-[0-9]+$/;

/**
 * Folds events into task records, keyed by task id.
 * Records keep raw facts plus data-quality flags; they are not the contract shape (see toContract).
 */
export function deriveTasks(events) {
  const tasks = new Map();
  const orphans = [];
  for (const e of events) {
    if (!e.task_id) continue;
    let t = tasks.get(e.task_id);
    if (e.event === 'task.start') {
      if (t) {
        t.flags.add('duplicate_task_start');
        continue;
      }
      const d = e.data ?? {};
      t = {
        task_id: e.task_id,
        project_id: e.project_id ?? null,
        type: d.type,
        risk: d.risk,
        title: d.title,
        estimate_hours: d.estimate_hours,
        fixes: d.fixes ? String(d.fixes).split(',') : [],
        status: 'active',
        started_at: e.ts,
        ended_at: undefined,
        outcome: undefined,
        completed_by: undefined,
        branch: undefined,
        worktree: undefined,
        verifications: [],
        gate_runs: [],
        sessions: new Set(),
        agents: new Set(),
        flags: new Set(),
      };
      tasks.set(e.task_id, t);
      continue;
    }
    if (!t) {
      orphans.push(e);
      continue;
    }
    const d = e.data ?? {};
    switch (e.event) {
      case 'task.verify':
        t.verifications.push({ ts: e.ts, check: d.check, result: d.result, executor: d.executor, sha: d.sha, gate: d.gate });
        break;
      case 'task.end':
        if (t.status === 'ended') {
          t.flags.add('duplicate_task_end');
          break;
        }
        t.status = 'ended';
        t.ended_at = e.ts;
        t.outcome = d.outcome;
        t.completed_by = d.completed_by;
        break;
      case 'wt.new':
        t.branch = d.branch;
        t.worktree = e.worktree;
        break;
      case 'gate.run':
        t.gate_runs.push({ ts: e.ts, gate: d.gate, result: d.result, sha: d.head_sha });
        break;
      default:
        if (e.source === 'hook') {
          if (e.session_id) t.sessions.add(e.session_id);
          if (e.event === 'SubagentStart' && e.agent?.id) t.agents.add(e.agent.id);
        }
    }
  }
  return { tasks, orphans };
}

/** The `task` contract view of a derived record. */
export function toContract(t) {
  const view = {
    schema_version: 1,
    task_id: t.task_id,
    project_id: t.project_id,
    title: t.title,
    type: t.type,
    risk: t.risk,
    status: t.status,
    estimate_hours: t.estimate_hours,
    fixes: t.fixes.length ? t.fixes : undefined,
    branch: t.branch,
    worktree: t.worktree,
    started_at: t.started_at,
    ended_at: t.ended_at,
    outcome: t.outcome,
    completed_by: t.completed_by,
  };
  for (const [k, v] of Object.entries(view)) if (v === undefined) delete view[k];
  return view;
}

export function loadTasks(env) {
  return deriveTasks(readEvents(env).events).tasks;
}

function activeTask(env, taskId) {
  if (!TASK_ID.test(taskId ?? '')) throw usageError(`invalid task id "${taskId}" (expected something like DEMO-001)`);
  const t = loadTasks(env).get(taskId);
  if (!t) throw ruleError(`task ${taskId} has not been started`);
  if (t.status !== 'active') throw ruleError(`task ${taskId} is ${t.status}`);
  return t;
}

const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw usageError(`${label} must be one of: ${allowed.join(', ')}`);
};

export function startTask(env, { taskId, cwd, projectId, type, risk, title, estimateHours, fixes = [], now }) {
  if (!TASK_ID.test(taskId ?? '')) throw usageError(`invalid task id "${taskId}" (expected something like DEMO-001)`);
  oneOf(type, TASK_TYPES, '--type');
  oneOf(risk, RISKS, '--risk');

  let project = { project_id: projectId ?? null, project_source: projectId ? 'manual' : 'none' };
  if (!projectId) project = resolveProject(cwd, { env });
  if (!project.project_id) throw usageError('not inside a registered project; run "asdk project add" or pass --project');

  const existing = loadTasks(env).get(taskId);
  if (existing) throw ruleError(`task ${taskId} already exists (${existing.status}); use a new task id`);

  const draft = toContract({
    task_id: taskId,
    project_id: project.project_id,
    title,
    type,
    risk,
    status: 'active',
    estimate_hours: estimateHours,
    fixes,
    started_at: (now ?? new Date()).toISOString(),
  });
  const check = validateContract('task', draft);
  if (!check.valid) throw usageError(`invalid task: ${check.errors[0].path} ${check.errors[0].message}`);

  return appendEvent(
    env,
    makeEvent(
      {
        source: 'cli',
        event: 'task.start',
        project_id: project.project_id,
        project_source: project.project_source,
        task_id: taskId,
        data: { type, risk, title, estimate_hours: estimateHours, fixes: fixes.length ? fixes.join(',') : undefined },
      },
      now,
    ),
  );
}

export function verifyTask(env, { taskId, check, result, executor, sha, gate, cwd, source = 'cli', now }) {
  oneOf(check, CHECKS, '--check');
  oneOf(result, RESULTS, '--result');
  oneOf(executor, EXECUTORS, '--executor');
  if (check === 'acceptance' && executor !== 'human') throw ruleError('acceptance can only be recorded by a human (--executor human)');
  const t = activeTask(env, taskId);
  const commit = sha ?? (cwd ? headSha(cwd, env) : null);
  if (commit && !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) throw usageError(`--sha must be a full commit hash`);

  return appendEvent(
    env,
    makeEvent({ source, event: 'task.verify', project_id: t.project_id, task_id: taskId, data: { check, result, executor, sha: commit ?? undefined, gate } }, now),
  );
}

export function endTask(env, { taskId, outcome, completedBy, now }) {
  oneOf(outcome, OUTCOMES, '--outcome');
  if (completedBy !== undefined) oneOf(completedBy, COMPLETED_BY, '--completed-by');
  if (outcome === 'accepted' && completedBy === undefined) throw usageError('--completed-by is required when the outcome is accepted');
  const t = activeTask(env, taskId);
  return appendEvent(
    env,
    makeEvent({ source: 'cli', event: 'task.end', project_id: t.project_id, task_id: taskId, data: { outcome, completed_by: completedBy } }, now),
  );
}
