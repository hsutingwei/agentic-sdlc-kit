// `asdk harvest`: token usage of Claude Code sessions, from their transcripts, into
// ~/.agentic-metrics/usage/<session>.json (core contract `usage`).
//
// The files are derived: deleting usage/ and harvesting again rebuilds them. The
// same transcripts always give the same bytes (no harvest time inside, sorted
// output), and a file is only rewritten when its content changes.
//
// A session's transcripts are found by their file names, so no path is ever
// recorded: <projects>/<any>/<session>.jsonl for the main session and
// <projects>/<any>/<session>/subagents/agent-<id>.jsonl (+ .meta.json) for
// sub-agents. A session that moved directories can appear more than once; the
// de-duplication by response id absorbs that.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';
import { validateContract } from '../../core/validate.mjs';
import { dataPath } from '../../collector/lib/paths.mjs';
import { projectsDir } from './paths.mjs';
import { parseAgentMeta, parseTranscript } from './transcript.mjs';

const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;
const AGENT_FILE = /^agent-([A-Za-z0-9._-]{1,120})\.jsonl$/;

export const usageFile = (env, sessionId) => dataPath(env, 'usage', `${sessionId}.json`);

function checkSessionId(sessionId) {
  if (!SESSION_ID.test(sessionId ?? '') || /^\.+$/.test(sessionId)) throw usageError(`invalid session id "${sessionId}"`);
}

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Transcript files of a session: { main: string[], agents: { id, file, meta? }[] }. */
export function findTranscripts(env, sessionId) {
  checkSessionId(sessionId);
  const root = projectsDir(env);
  const found = { main: [], agents: [] };
  if (!isDir(root)) return found;
  for (const project of readdirSync(root).sort()) {
    const dir = path.join(root, project);
    if (!isDir(dir)) continue;
    const main = path.join(dir, `${sessionId}.jsonl`);
    if (existsSync(main)) found.main.push(main);
    const subDir = path.join(dir, sessionId, 'subagents');
    if (!isDir(subDir)) continue;
    for (const name of readdirSync(subDir).sort()) {
      const m = AGENT_FILE.exec(name);
      if (!m) continue;
      const metaFile = path.join(subDir, `agent-${m[1]}.meta.json`);
      found.agents.push({ id: m[1], file: path.join(subDir, name), meta: existsSync(metaFile) ? metaFile : undefined });
    }
  }
  return found;
}

/** Builds the usage document of one session, or null when no transcript exists. */
export function buildUsage(env, sessionId) {
  const files = findTranscripts(env, sessionId);
  if (files.main.length === 0 && files.agents.length === 0) return null;

  const messages = new Map();
  const versions = new Set();
  const sources = [];
  const toolResults = { count: 0, bytes: 0 };
  const take = (parsed, agentId) => {
    for (const v of parsed.versions) versions.add(v);
    toolResults.count += parsed.tool_results.count;
    toolResults.bytes += parsed.tool_results.bytes;
    for (const [id, row] of parsed.messages) {
      const r = agentId && !row.agent_id ? { ...row, agent_id: agentId } : row;
      const seen = messages.get(id);
      if (!seen) {
        messages.set(id, r);
        continue;
      }
      for (const k of ['input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_read_tokens']) seen[k] = Math.max(seen[k], r[k]);
    }
  };

  for (const file of files.main) {
    const parsed = parseTranscript(readFileSync(file, 'utf8'));
    take(parsed);
    sources.push({ kind: 'main', lines: parsed.lines, bad_lines: parsed.bad_lines, unparsed: parsed.unparsed });
  }
  for (const agent of files.agents) {
    const parsed = parseTranscript(readFileSync(agent.file, 'utf8'));
    take(parsed, agent.id);
    const meta = agent.meta ? parseAgentMeta(readFileSync(agent.meta, 'utf8')) : {};
    const source = { kind: 'subagent', agent_id: agent.id, agent_type: meta.agent_type, model: meta.model, lines: parsed.lines, bad_lines: parsed.bad_lines, unparsed: parsed.unparsed };
    for (const k of Object.keys(source)) if (source[k] === undefined) delete source[k];
    sources.push(source);
  }

  const rows = [...messages.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
  // A fixed key order keeps the file byte-stable.
  const ordered = rows.map((m) => {
    const out = { id: m.id, ts: m.ts, model: m.model };
    if (m.effort) out.effort = m.effort;
    if (m.agent_id) out.agent_id = m.agent_id;
    return { ...out, input_tokens: m.input_tokens, output_tokens: m.output_tokens, cache_write_tokens: m.cache_write_tokens, cache_read_tokens: m.cache_read_tokens };
  });
  return {
    schema_version: 1,
    tool: 'claude-code',
    session_id: sessionId,
    tool_versions: [...versions].sort(),
    sources,
    messages: ordered,
    tool_results: toolResults,
  };
}

/**
 * Harvests one session.
 * @returns {{ session_id: string, status: 'harvested'|'unchanged'|'missing', messages?: number, unparsed?: number }}
 */
export function harvestSession(env, sessionId) {
  const doc = buildUsage(env, sessionId);
  if (!doc) return { session_id: sessionId, status: 'missing' };
  const check = validateContract('usage', doc);
  if (!check.valid) throw usageError(`harvested usage of ${sessionId} is invalid: ${check.errors[0].path} ${check.errors[0].message}`);

  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const file = usageFile(env, sessionId);
  const unparsed = doc.sources.reduce((n, s) => n + s.unparsed + s.bad_lines, 0);
  const summary = { session_id: sessionId, messages: doc.messages.length, unparsed };
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return { ...summary, status: 'unchanged' };
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
  return { ...summary, status: 'harvested' };
}
