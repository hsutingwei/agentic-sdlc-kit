// Task lifecycle: start -> verify, block/resume, escalate (any number, in any order) -> end.
// A blocked task is still open: it can be verified, escalated and ended.
//
// Task state is never stored on its own; it is derived from the event log every
// time, so the log stays the single source of truth. Checks before a change read
// only the manual stream, where every task record is written; hook streams only
// add sessions and sub-agents, which reports need and checks do not.

import { AsdkError, ruleError, usageError } from '../../core/errors.mjs';
import { headSha } from '../../core/git.mjs';
import { validateContract } from '../../core/validate.mjs';
import { withCollectorLock } from './locks.mjs';
import { resolveProject } from './registry.mjs';
import { appendEvent, MANUAL_STREAM, makeEvent, readEvents } from './store.mjs';

export const TASK_TYPES = ['bugfix', 'feature', 'refactor', 'test', 'docs', 'config', 'investigation'];
export const RISKS = ['low', 'medium', 'high', 'critical'];
export const CHECKS = ['build', 'unit', 'integration', 'ui', 'acceptance'];
export const RESULTS = ['pass', 'fail', 'error'];
export const EXECUTORS = ['script', 'human'];
export const OUTCOMES = ['accepted', 'rejected', 'abandoned', 'deferred'];
export const COMPLETED_BY = ['ai', 'ai_with_human_fixes', 'human'];
export const UPDATE_STATES = ['blocked', 'resumed'];
export const WAITING_ON = ['human', 'ai', 'external', 'quota', 'other'];
export const ESCALATION_KINDS = ['takeover', 'repeated_failure', 'risk_decision'];

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
        blocks: [], // { from, to?, reason, waiting_on? }
        escalations: [], // { ts, kind, reason }
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
      case 'task.block':
        if (t.status !== 'active') {
          t.flags.add('unexpected_block');
          break;
        }
        t.status = 'blocked';
        t.blocks.push({ from: e.ts, reason: d.reason, waiting_on: d.waiting_on });
        break;
      case 'task.resume':
        if (t.status !== 'blocked') {
          t.flags.add('unexpected_resume');
          break;
        }
        t.status = 'active';
        t.blocks.at(-1).to = e.ts;
        break;
      case 'task.escalate':
        t.escalations.push({ ts: e.ts, kind: d.kind, reason: d.reason });
        break;
      case 'task.end':
        if (t.status === 'ended') {
          t.flags.add('duplicate_task_end');
          break;
        }
        if (t.status === 'blocked') t.blocks.at(-1).to = e.ts; // ending also ends the block
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

/** Every task with its sessions and sub-agents, for listing and reports. */
export function loadTasks(env) {
  return deriveTasks(readEvents(env).events).tasks;
}

/**
 * Task records from the manual stream only: enough to check a change, and fast however many hook events exist.
 * Refuses when a line there is damaged: it could be a hidden task start or end, and a check that cannot
 * see it would allow a change it should refuse.
 */
export function loadTaskRecords(env) {
  const { events, damaged } = readEvents(env, { streams: [MANUAL_STREAM] });
  if (damaged.length > 0) {
    const where = damaged.slice(0, 5).map((d) => `events/${d.file}:${d.line}`);
    throw new AsdkError(
      `task records have ${damaged.length} damaged line(s): ${where.join(', ')}${damaged.length > 5 ? ', …' : ''}. ` +
        'A damaged line can hide a task start or end, so task changes are refused until it is repaired or moved to another file.',
      2,
    );
  }
  return deriveTasks(events).tasks;
}

/** A task that has started and not ended (active or blocked). */
function openTask(env, taskId) {
  if (!TASK_ID.test(taskId ?? '')) throw usageError(`invalid task id "${taskId}" (expected something like DEMO-001)`);
  const t = loadTaskRecords(env).get(taskId);
  if (!t) throw ruleError(`task ${taskId} has not been started`);
  if (t.status === 'ended') throw ruleError(`task ${taskId} has ended`);
  return t;
}

function checkReason(reason) {
  if (typeof reason !== 'string' || reason.trim() === '') throw usageError('--reason is required');
  if (reason.length > 256) throw usageError('--reason must be at most 256 characters');
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

  return withCollectorLock(env, 'tasks', () => {
    const existing = loadTaskRecords(env).get(taskId);
    if (existing) throw ruleError(`task ${taskId} already exists (${existing.status}); use a new task id`);
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
  });
}

export function verifyTask(env, { taskId, check, result, executor, sha, gate, cwd, source = 'cli', now }) {
  oneOf(check, CHECKS, '--check');
  oneOf(result, RESULTS, '--result');
  oneOf(executor, EXECUTORS, '--executor');
  if (check === 'acceptance' && executor !== 'human') throw ruleError('acceptance can only be recorded by a human (--executor human)');
  const commit = sha ?? (cwd ? headSha(cwd, env) : null);
  if (commit && !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) throw usageError(`--sha must be a full commit hash`);

  return withCollectorLock(env, 'tasks', () => {
    const t = openTask(env, taskId);
    return appendEvent(
      env,
      makeEvent({ source, event: 'task.verify', project_id: t.project_id, task_id: taskId, data: { check, result, executor, sha: commit ?? undefined, gate } }, now),
    );
  });
}

export function endTask(env, { taskId, outcome, completedBy, now }) {
  oneOf(outcome, OUTCOMES, '--outcome');
  if (completedBy !== undefined) oneOf(completedBy, COMPLETED_BY, '--completed-by');
  if (outcome === 'accepted' && completedBy === undefined) throw usageError('--completed-by is required when the outcome is accepted');
  return withCollectorLock(env, 'tasks', () => {
    const t = openTask(env, taskId);
    return appendEvent(
      env,
      makeEvent({ source: 'cli', event: 'task.end', project_id: t.project_id, task_id: taskId, data: { outcome, completed_by: completedBy } }, now),
    );
  });
}

/** Marks an open task blocked (with what it waits on) or resumes a blocked one. */
export function updateTask(env, { taskId, state, reason, waitingOn, now }) {
  oneOf(state, UPDATE_STATES, '--state');
  checkReason(reason);
  if (waitingOn !== undefined) {
    if (state !== 'blocked') throw usageError('--waiting-on only goes with --state blocked');
    oneOf(waitingOn, WAITING_ON, '--waiting-on');
  }
  return withCollectorLock(env, 'tasks', () => {
    const t = openTask(env, taskId);
    if (state === 'blocked' && t.status === 'blocked') throw ruleError(`task ${taskId} is already blocked`);
    if (state === 'resumed' && t.status !== 'blocked') throw ruleError(`task ${taskId} is not blocked`);
    return appendEvent(
      env,
      makeEvent(
        { source: 'cli', event: state === 'blocked' ? 'task.block' : 'task.resume', project_id: t.project_id, task_id: taskId, data: { reason, waiting_on: waitingOn } },
        now,
      ),
    );
  });
}

/** Records that a human had to step in: took over, after repeated failures, or to decide on a risk. */
export function escalateTask(env, { taskId, kind, reason, now }) {
  oneOf(kind, ESCALATION_KINDS, '--kind');
  checkReason(reason);
  return withCollectorLock(env, 'tasks', () => {
    const t = openTask(env, taskId);
    return appendEvent(env, makeEvent({ source: 'cli', event: 'task.escalate', project_id: t.project_id, task_id: taskId, data: { kind, reason } }, now));
  });
}
