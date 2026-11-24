// asdk human start|stop|adjust|status: time a person spends on a task.

import { ruleError, usageError } from '../../core/errors.mjs';
import { ACTIVITIES, deriveHumanTime } from './human-time.mjs';
import { withCollectorLock } from './locks.mjs';
import { appendEvent, MANUAL_STREAM, makeEvent, readEvents } from './store.mjs';
import { loadManualEvents, loadTaskRecords, openTask } from './tasks.mjs';

const MAX_ADJUST_MINUTES = 24 * 60;

const oneOf = (value, allowed, label) => {
  if (!allowed.includes(value)) throw usageError(`${label} must be one of: ${allowed.join(', ')}`);
};

const human = (event, task, data, now) => makeEvent({ source: 'cli', event, project_id: task.project_id, task_id: task.task_id, data }, now);

/** Starts the one human timer. With `switchTask`, a timer running on another task is stopped first. */
export function startHuman(env, { taskId, activity = 'other', switchTask = false, now }) {
  oneOf(activity, ACTIVITIES, '--activity');
  return withCollectorLock(env, 'tasks', () => {
    const task = openTask(env, taskId);
    const { open } = deriveHumanTime(loadManualEvents(env));
    let stopped = null;
    if (open) {
      if (open.task_id === taskId) throw ruleError(`a timer for ${taskId} is already running since ${open.since}`);
      if (!switchTask) throw ruleError(`a timer for ${open.task_id} is running since ${open.since}; stop it, or pass --switch to stop it and start this one`);
      const other = loadTaskRecords(env).get(open.task_id);
      stopped = appendEvent(env, human('human.stop', other ?? { task_id: open.task_id, project_id: null }, undefined, now));
    }
    const started = appendEvent(env, human('human.start', task, { activity }, now));
    return { started, stopped };
  });
}

/** Stops the running timer; `taskId`, when given, must be the task it runs on. */
export function stopHuman(env, { taskId, now } = {}) {
  return withCollectorLock(env, 'tasks', () => {
    const { open } = deriveHumanTime(loadManualEvents(env));
    if (!open) throw ruleError('no human timer is running');
    if (taskId && open.task_id !== taskId) throw ruleError(`the running timer is for ${open.task_id}, not ${taskId}`);
    const task = loadTaskRecords(env).get(open.task_id) ?? { task_id: open.task_id, project_id: null };
    const event = appendEvent(env, human('human.stop', task, undefined, now));
    return { event, since: open.since, activity: open.activity };
  });
}

/** Adds a correction in minutes (negative to take time off). Works on ended tasks; the total never goes below 0. */
export function adjustHuman(env, { taskId, minutes, activity = 'other', reason, now }) {
  if (!Number.isFinite(minutes) || minutes === 0 || Math.abs(minutes) > MAX_ADJUST_MINUTES) {
    throw usageError(`--minutes must be a non-zero number of minutes, at most ${MAX_ADJUST_MINUTES} either way`);
  }
  oneOf(activity, ACTIVITIES, '--activity');
  if (typeof reason !== 'string' || reason.trim() === '') throw usageError('--reason is required');
  if (reason.length > 256) throw usageError('--reason must be at most 256 characters');
  return withCollectorLock(env, 'tasks', () => {
    const task = loadTaskRecords(env).get(taskId);
    if (!task) throw ruleError(`task ${taskId} has not been started`);
    const current = deriveHumanTime(loadManualEvents(env)).tasks.get(taskId)?.minutes ?? 0;
    if (current + minutes < 0) throw ruleError(`${taskId} has ${Math.round(current)} recorded minute(s); an adjustment cannot take the total below 0`);
    return appendEvent(env, human('human.adjust', task, { minutes, activity, reason }, now));
  });
}

/** The running timer, if any, and the recorded minutes per task. Reading only, so damaged lines are skipped, not refused. */
export function humanStatus(env) {
  return deriveHumanTime(readEvents(env, { streams: [MANUAL_STREAM] }).events);
}
