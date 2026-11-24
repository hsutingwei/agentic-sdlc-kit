// Token usage from Claude Code transcripts (docs/spike, finding 7).
//
// - One API response is written as several `assistant` records that share
//   message.id and requestId, each repeating the usage. They count once; when the
//   copies differ, the largest value of each counter is kept.
// - Tool results (in `user` records) are reduced to a count and a byte size.
// - Only numbers, model names, reasoning effort, ids and times are kept: no text,
//   no tool input, no paths. Record types the kit does not use are skipped; an
//   assistant record without the expected fields is counted as unparsed, so a
//   format change shows up in the data quality instead of as silent zeros.

import { createHash } from 'node:crypto';

const COUNTERS = {
  input_tokens: 'input_tokens',
  output_tokens: 'output_tokens',
  cache_creation_input_tokens: 'cache_write_tokens',
  cache_read_input_tokens: 'cache_read_tokens',
};

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const short = (s, max) => (typeof s === 'string' && s.length > 0 && s.length <= max ? s : undefined);
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const sizeOf = (content) => (typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : Buffer.byteLength(JSON.stringify(content ?? ''), 'utf8'));

/** A stable, non-reversible id for one API response. */
export const responseId = (messageId, requestId) => createHash('sha256').update(`${messageId}\u0000${requestId ?? ''}`).digest('hex').slice(0, 20);

/**
 * Parses one transcript file.
 * @returns {{ messages: Map<string, object>, versions: Set<string>, lines: number, bad_lines: number,
 *   unparsed: number, tool_results: { count: number, bytes: number } }}
 */
export function parseTranscript(text) {
  const out = { messages: new Map(), versions: new Set(), lines: 0, bad_lines: 0, unparsed: 0, tool_results: { count: 0, bytes: 0 } };
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    out.lines++;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      out.bad_lines++;
      continue;
    }
    if (!r || typeof r !== 'object') {
      out.bad_lines++;
      continue;
    }
    const version = short(r.version, 32);
    if (version && /^[0-9][0-9A-Za-z.+-]*$/.test(version)) out.versions.add(version);

    if (r.type === 'assistant') {
      const m = r.message;
      if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.usage || typeof m.usage !== 'object' || Number.isNaN(Date.parse(r.timestamp))) {
        out.unparsed++;
        continue;
      }
      const id = responseId(m.id, r.requestId);
      const seen = out.messages.get(id);
      const row = seen ?? {
        id,
        ts: new Date(Date.parse(r.timestamp)).toISOString(),
        model: short(m.model, 100) ?? 'unknown',
        input_tokens: 0,
        output_tokens: 0,
        cache_write_tokens: 0,
        cache_read_tokens: 0,
      };
      if (!seen) {
        const effort = short(r.effort, 16);
        if (effort && /^[a-z]+$/.test(effort)) row.effort = effort;
        if (typeof r.agentId === 'string' && ID.test(r.agentId)) row.agent_id = r.agentId;
        out.messages.set(id, row);
      }
      for (const [from, to] of Object.entries(COUNTERS)) row[to] = Math.max(row[to], count(m.usage[from]));
      continue;
    }

    if (r.type === 'user' && Array.isArray(r.message?.content)) {
      for (const item of r.message.content) {
        if (item?.type !== 'tool_result') continue;
        out.tool_results.count++;
        out.tool_results.bytes += sizeOf(item.content);
      }
    }
  }
  return out;
}

/** The parts of a sub-agent's .meta.json the kit keeps: its type and model, never its description. */
export function parseAgentMeta(text) {
  try {
    const meta = JSON.parse(text);
    return { agent_type: short(meta?.agentType, 100), model: short(meta?.model, 100) };
  } catch {
    return {};
  }
}
