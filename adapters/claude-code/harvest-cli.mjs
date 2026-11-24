// asdk harvest --session <id> | --task <ID> | --all

import { parse } from '../../core/cli.mjs';
import { ruleError, usageError } from '../../core/errors.mjs';
import { deriveSessions } from '../../collector/lib/sessions.mjs';
import { readEvents } from '../../collector/lib/store.mjs';
import { deriveTasks } from '../../collector/lib/tasks.mjs';
import { harvestSession } from './harvest.mjs';

const USAGE = 'asdk harvest --session <id> | --task <ID> | --all  [--json]';

/** Session ids that recorded at least one event of the task. */
export function sessionsOfTask(events, taskId) {
  const task = deriveTasks(events).tasks.get(taskId);
  if (!task) throw ruleError(`task ${taskId} has not been started`);
  return [...task.sessions].sort();
}

export function harvestSessions(env, sessionIds) {
  return sessionIds.map((id) => {
    try {
      return harvestSession(env, id);
    } catch (err) {
      return { session_id: id, status: 'failed', error: err.message };
    }
  });
}

export async function runHarvest(argv, { env, out }) {
  const { values } = parse(argv, { session: { type: 'string' }, task: { type: 'string' }, all: { type: 'boolean' }, json: { type: 'boolean' } }, { usage: USAGE });
  const chosen = ['session', 'task', 'all'].filter((k) => values[k] !== undefined);
  if (chosen.length !== 1) throw usageError(`usage: ${USAGE}`);

  let ids;
  if (values.session) ids = [values.session];
  else {
    const { events } = readEvents(env);
    ids = values.task ? sessionsOfTask(events, values.task) : deriveSessions(events).map((s) => s.session_id);
  }
  const results = harvestSessions(env, ids);
  if (values.json) out(JSON.stringify(results));
  else {
    if (results.length === 0) out('no sessions to harvest');
    for (const r of results) {
      const detail = r.status === 'failed' ? r.error : r.status === 'missing' ? 'no transcript found' : `${r.messages} response(s)${r.unparsed ? `, ${r.unparsed} unreadable record(s)` : ''}`;
      out(`${r.session_id}\t${r.status}\t${detail}`);
    }
  }
  return results.some((r) => r.status === 'failed') ? 1 : 0;
}
