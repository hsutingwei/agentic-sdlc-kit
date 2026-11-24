// Sessions as seen through recorded events, plus manual project overrides.
//
// Hook events name the project the working directory resolved to when each event
// was recorded. When that was wrong or missing (a session started outside any
// registered root, say), `session set-project` appends an override; recorded
// events are never rewritten. The latest override for a session wins.

import { usageError } from '../../core/errors.mjs';
import { findProject, loadConfig } from './registry.mjs';
import { appendEvent, makeEvent } from './store.mjs';

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
export const SET_PROJECT = 'session.set-project';

export function setSessionProject(env, { sessionId, projectId, reason, now }) {
  if (!SESSION_ID.test(sessionId ?? '')) throw usageError(`invalid session id "${sessionId}"`);
  if (!findProject(loadConfig(env), projectId)) throw usageError(`unknown project "${projectId}" (see asdk project list)`);
  if (reason !== undefined && reason.length > 256) throw usageError('--reason must be at most 256 characters');
  return appendEvent(
    env,
    makeEvent({ source: 'cli', event: SET_PROJECT, session_id: sessionId, project_id: projectId, project_source: 'manual', data: reason ? { reason } : undefined }, now),
  );
}

/**
 * Derives one record per session id, oldest first.
 * project_source is 'manual' when an override applies; otherwise the source of the
 * most common project among the session's hook events. `mixed_projects` is set when
 * hook events disagree (the session moved between projects).
 */
export function deriveSessions(events) {
  const sessions = new Map();
  const get = (id) => {
    if (!sessions.has(id)) {
      sessions.set(id, {
        session_id: id,
        first_ts: null,
        last_ts: null,
        events: 0,
        prompts: 0,
        tool_calls: 0,
        tool_failures: 0,
        agents: {},
        task_ids: new Set(),
        projectCounts: new Map(),
        override: null,
      });
    }
    return sessions.get(id);
  };

  for (const e of events) {
    if (!e.session_id) continue;
    const s = get(e.session_id);
    if (e.event === SET_PROJECT) {
      s.override = { project_id: e.project_id, ts: e.ts, reason: e.data?.reason };
      continue;
    }
    if (e.source !== 'hook') continue;
    s.events++;
    s.first_ts ??= e.ts;
    s.last_ts = e.ts;
    if (e.event === 'UserPromptSubmit') s.prompts++;
    if (e.event === 'PreToolUse') s.tool_calls++; // sub-agent calls share the parent's session id
    if (e.event === 'PostToolUseFailure') s.tool_failures++;
    if (e.event === 'SubagentStart') {
      const type = e.agent?.type ?? 'unknown';
      s.agents[type] = (s.agents[type] ?? 0) + 1;
    }
    if (e.task_id) s.task_ids.add(e.task_id);
    if (e.project_id) {
      const c = s.projectCounts.get(e.project_id) ?? { n: 0, source: e.project_source };
      c.n++;
      s.projectCounts.set(e.project_id, c);
    }
  }

  return [...sessions.values()]
    .map((s) => {
      let projectId = null;
      let source = 'none';
      let best = 0;
      for (const [id, c] of s.projectCounts) {
        if (c.n > best) [projectId, source, best] = [id, c.source, c.n];
      }
      const record = {
        session_id: s.session_id,
        project_id: s.override ? s.override.project_id : projectId,
        project_source: s.override ? 'manual' : source,
        first_ts: s.first_ts,
        last_ts: s.last_ts,
        events: s.events,
        prompts: s.prompts,
        tool_calls: s.tool_calls,
        tool_failures: s.tool_failures,
        agents: s.agents,
        task_ids: [...s.task_ids].sort(),
        mixed_projects: s.projectCounts.size > 1,
      };
      if (s.override) record.recorded_project_id = projectId;
      return record;
    })
    .sort((a, b) => ((a.first_ts ?? '') < (b.first_ts ?? '') ? -1 : 1));
}
