// asdk session list|set-project

import { parse } from '../../core/cli.mjs';
import { usageError } from '../../core/errors.mjs';
import { deriveSessions, setSessionProject } from '../lib/sessions.mjs';
import { readEvents } from '../lib/store.mjs';

const USAGE = {
  list: 'asdk session list [--project <id>] [--json]',
  set: 'asdk session set-project <session-id> <project-id> [--reason <text>]',
};

const agentSummary = (agents) =>
  Object.entries(agents)
    .map(([type, n]) => `${type}×${n}`)
    .join(',') || '-';

export async function runSession(argv, { env, out, err }) {
  const [sub, ...rest] = argv;
  if (sub === 'list') {
    const { values } = parse(rest, { project: { type: 'string' }, json: { type: 'boolean' } }, { usage: USAGE.list });
    let sessions = deriveSessions(readEvents(env).events);
    if (values.project) sessions = sessions.filter((s) => s.project_id === values.project);
    if (values.json) {
      out(JSON.stringify(sessions));
      return 0;
    }
    out(['session', 'project', 'source', 'first', 'last', 'events', 'tools', 'failed', 'subagents', 'tasks'].join('\t'));
    for (const s of sessions) {
      out(
        [
          s.session_id,
          s.project_id ?? '-',
          s.project_source + (s.mixed_projects ? '*' : ''),
          s.first_ts ?? '-',
          s.last_ts ?? '-',
          s.events,
          s.tool_calls,
          s.tool_failures,
          agentSummary(s.agents),
          s.task_ids.join(',') || '-',
        ].join('\t'),
      );
    }
    if (sessions.some((s) => s.mixed_projects)) out('* events of this session resolved to more than one project');
    return 0;
  }
  if (sub === 'set-project') {
    const { values, positionals } = parse(rest, { reason: { type: 'string' } }, { positionals: 2, usage: USAGE.set });
    if (positionals.length !== 2) throw usageError(`usage: ${USAGE.set}`);
    const [sessionId, projectId] = positionals;
    setSessionProject(env, { sessionId, projectId, reason: values.reason });
    const known = deriveSessions(readEvents(env).events).some((s) => s.session_id === sessionId && s.events > 0);
    out(`session ${sessionId} -> ${projectId} (manual)`);
    if (!known) err(`note: no hook events recorded for session ${sessionId} yet; the override applies to them when they arrive`);
    return 0;
  }
  throw usageError(`usage: ${USAGE.list}\n       ${USAGE.set}`);
}
