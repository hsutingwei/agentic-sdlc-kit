// Claude Code hook entry: `asdk hook`, registered for every hook event.
//
// Reads the hook payload from stdin and records METADATA ONLY. Fields are
// copied from an allowlist; fields that hold prompt text, tool input, tool
// output or answers are reduced to their size. The hook never fails: any error
// is written to collector-errors.log (without payload content) and the process
// exits 0, so a recording problem can never block the agent.

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { dataPath } from '../../collector/lib/paths.mjs';
import { loadConfig, recordsUnregistered, resolveProject } from '../../collector/lib/registry.mjs';
import { isRecordingDisabled } from '../../collector/lib/recording.mjs';
import { readWorktreeMarker } from '../../collector/lib/state.mjs';
import { appendEvent, makeEvent } from '../../collector/lib/store.mjs';

const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const ID = /^[A-Za-z0-9._-]{1,128}$/;

// Copied as they are when they are short scalars.
const SCALAR_FIELDS = ['tool_name', 'tool_use_id', 'prompt_id', 'permission_mode', 'source', 'reason', 'duration_ms', 'stop_hook_active', 'is_interrupt'];

// Reduced to a size: these carry content.
const SIZE_FIELDS = {
  prompt: 'prompt_chars',
  tool_input: 'tool_input_bytes',
  tool_response: 'tool_response_bytes',
  last_assistant_message: 'last_message_chars',
  error: 'error_chars', // PostToolUseFailure: the message can quote paths or file content
};

const sizeOf = (value) => (typeof value === 'string' ? [...value].length : Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8'));

/** Maps a Claude Code hook payload to a kit event, or returns null when it cannot be attributed to an event name. */
export function payloadToEvent(payload, { env = process.env, cwd = process.cwd(), now, config } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const name = payload.hook_event_name;
  if (typeof name !== 'string' || !EVENT_NAME.test(name)) return null;

  const data = {};
  for (const key of SCALAR_FIELDS) {
    const v = payload[key];
    if (typeof v === 'number' || typeof v === 'boolean') data[key] = v;
    else if (typeof v === 'string' && v.length <= 256) data[key] = v;
  }
  for (const [key, as] of Object.entries(SIZE_FIELDS)) {
    if (payload[key] !== undefined && payload[key] !== null) data[as] = sizeOf(payload[key]);
  }
  // Reasoning effort arrives as { level } on tool and stop events.
  const effort = payload.effort?.level;
  if (typeof effort === 'string' && effort.length <= 32) data.effort = effort;
  if (payload.tool_input && typeof payload.tool_input === 'object' && typeof payload.tool_input.file_path === 'string') {
    data.file_count = 1; // the path itself is not recorded
  }

  const where = typeof payload.cwd === 'string' && payload.cwd !== '' ? payload.cwd : cwd;
  const project = resolveProject(where, { env, config: config ?? loadConfig(env) });
  const marker = project.project_id && project.worktree ? readWorktreeMarker(env, project.project_id, project.worktree) : null;

  const agent = typeof payload.agent_id === 'string' && ID.test(payload.agent_id) ? { id: payload.agent_id } : undefined;
  if (agent && typeof payload.agent_type === 'string' && payload.agent_type.length <= 100) agent.type = payload.agent_type;

  return makeEvent(
    {
      source: 'hook',
      event: name,
      tool: 'claude-code',
      session_id: typeof payload.session_id === 'string' && ID.test(payload.session_id) ? payload.session_id : undefined,
      project_id: project.project_id,
      project_source: project.project_source,
      task_id: marker?.task_id,
      worktree: project.worktree ?? undefined,
      agent,
      data: Object.keys(data).length ? data : undefined,
    },
    now,
  );
}

function logError(env, message) {
  try {
    const file = dataPath(env, 'collector-errors.log');
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} hook: ${message}\n`);
  } catch {
    // Nowhere left to report; stay silent rather than disturb the agent.
  }
}

// Claude Code closes stdin after writing the payload. If it ever does not, the
// hook gives up instead of holding the agent until Claude Code's own timeout.
export const STDIN_TIMEOUT_MS = 5000;

class StdinTimeout extends Error {}

function readStdin(stdin, timeoutMs) {
  if (stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => {
      stdin.destroy();
      reject(new StdinTimeout());
    }, timeoutMs);
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      text += chunk;
    });
    stdin.on('end', () => {
      clearTimeout(timer);
      resolve(text);
    });
    stdin.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function stdinTimeout(env) {
  // Only tests shorten the wait.
  const ms = Number(env.AGENTIC_HOOK_STDIN_TIMEOUT_MS);
  return Number.isInteger(ms) && ms > 0 ? ms : STDIN_TIMEOUT_MS;
}

export async function runHook(_argv, { env, cwd, stdin = process.stdin }) {
  try {
    let raw;
    try {
      raw = await readStdin(stdin, stdinTimeout(env));
    } catch (err) {
      if (!(err instanceof StdinTimeout)) throw err;
      logError(env, `no payload: stdin stayed open for ${stdinTimeout(env)} ms`);
      return 0;
    }
    // Disabled: the payload was still read, so Claude Code never writes into a closed pipe.
    if (isRecordingDisabled(env)) return 0;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      // The parser's own message can quote the input, so log a fixed text.
      logError(env, `payload is not valid JSON (${raw.length} chars)`);
      return 0;
    }
    const config = loadConfig(env);
    const event = payloadToEvent(payload, { env, cwd, config });
    if (!event) {
      logError(env, 'payload has no usable hook_event_name');
      return 0;
    }
    if (event.project_id === null && !recordsUnregistered(config)) return 0;
    appendEvent(env, event, event.session_id ?? 'no-session');
  } catch (err) {
    logError(env, err instanceof Error ? err.message : 'unknown error');
  }
  return 0;
}
