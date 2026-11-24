// Reading harvested usage (core contract `usage`) and adding it up. Tool-neutral:
// any adapter that writes usage/<session>.json is read the same way.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { validateContract } from '../../core/validate.mjs';
import { dataPath } from './paths.mjs';

const COUNTERS = ['input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_read_tokens'];
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

const empty = () => ({ responses: 0, input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0 });
const add = (into, m) => {
  into.responses++;
  for (const k of COUNTERS) into[k] += m[k];
};

/** The usage document of a session; null when not harvested; { invalid: true } when the file is damaged. */
export function readUsage(env, sessionId) {
  if (!SESSION_ID.test(sessionId)) return null;
  const file = dataPath(env, 'usage', `${sessionId}.json`);
  if (!existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    return validateContract('usage', doc).valid ? doc : { invalid: true, session_id: sessionId };
  } catch {
    return { invalid: true, session_id: sessionId };
  }
}

export function harvestedSessions(env) {
  const dir = dataPath(env, 'usage');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

/**
 * Totals over sessions, by model and by agent type ("main" for the session itself).
 * Sessions without usage are listed as missing; damaged files as invalid; records
 * the adapter could not read are counted, so a reader knows the totals are partial.
 */
export function summarizeUsage(env, sessionIds) {
  const summary = { sessions: 0, missing: [], invalid: [], unreadable_records: 0, total: empty(), by_model: {}, by_agent_type: {}, tool_results: { count: 0, bytes: 0 } };
  for (const id of sessionIds) {
    const doc = readUsage(env, id);
    if (!doc) {
      summary.missing.push(id);
      continue;
    }
    if (doc.invalid) {
      summary.invalid.push(id);
      continue;
    }
    summary.sessions++;
    const types = new Map(doc.sources.filter((s) => s.agent_id).map((s) => [s.agent_id, s.agent_type ?? 'unknown']));
    for (const s of doc.sources) summary.unreadable_records += s.bad_lines + s.unparsed;
    for (const m of doc.messages) {
      add(summary.total, m);
      add((summary.by_model[m.model] ??= empty()), m);
      const type = m.agent_id ? (types.get(m.agent_id) ?? 'unknown') : 'main';
      add((summary.by_agent_type[type] ??= empty()), m);
    }
    summary.tool_results.count += doc.tool_results.count;
    summary.tool_results.bytes += doc.tool_results.bytes;
  }
  return summary;
}
