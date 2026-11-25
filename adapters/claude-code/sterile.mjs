// A sterile headless Claude Code run: no CLAUDE.md, memory, skills, hooks, MCP servers
// or session file, only the tools named, started in a folder outside any repository.
// The flags are the ones the spike confirmed on a subscription (docs/spike, finding 4).
// Hooks do not fire in such a run, so its usage comes from the stream's result, and
// its init event shows what was loaded.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { windowsFromStreamJson } from './rate-limit.mjs';

export const STERILE_ARGS = ['--safe-mode', '--no-session-persistence', '--strict-mcp-config'];
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The Claude Code executable: an explicit path, else AGENTIC_CLAUDE, else the native
 * installer's location, else `claude` on PATH. A .mjs or .js file is run with node
 * (the tests use a scripted stand-in).
 * @returns {{ command: string, args: string[] }}
 */
export function findClaude(env = process.env, explicit) {
  const chosen = explicit ?? env.AGENTIC_CLAUDE ?? defaultClaude(env);
  return /\.m?js$/.test(chosen) ? { command: process.execPath, args: [chosen] } : { command: chosen, args: [] };
}

function defaultClaude(env) {
  const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
  const local = path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
  return existsSync(local) ? local : 'claude';
}

// Settings that would pick another model or effort than the one asked for, and the kit's own
// variables, are not passed on; the login (or an API key) is.
const DROPPED = /^(CLAUDE_CODE_|AGENTIC_|ANTHROPIC_(MODEL|SMALL_FAST_MODEL|DEFAULT_[A-Z]+_MODEL)$)/i;

export function sterileEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!DROPPED.test(k)) out[k] = v;
  return out;
}

/**
 * What Claude Code says it loaded (the stream's init event), checked against what a
 * sterile run must have: exactly the tools asked for and no MCP server. Skills and
 * built-in plugins are listed even then, but without the Skill or Agent tool they
 * cannot be used.
 */
export function checkInit(init, tools) {
  if (!init) return 'the run did not report what it loaded (no init event)';
  if (!Array.isArray(init.tools)) return 'the init event has no tool list';
  const extra = init.tools.filter((x) => !tools.includes(x));
  const missing = tools.filter((x) => !init.tools.includes(x));
  if (extra.length) return `not sterile: tools ${extra.join(', ')} were loaded too`;
  if (missing.length) return `tools ${missing.join(', ')} were not loaded`;
  if (Array.isArray(init.mcp_servers) && init.mcp_servers.length) return `not sterile: ${init.mcp_servers.length} MCP server(s) were loaded`;
  return null;
}

function readStream(text) {
  let init = null;
  let result = null;
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type === 'system' && o.subtype === 'init') init = o;
    else if (o.type === 'result') result = o;
  }
  return { init, result };
}

/**
 * Runs `claude -p` sterile in `cwd` with stream-json output and reads its init and result.
 * @returns {{ ok: boolean, problem?: string, text?: string, exit: number | null, timed_out: boolean, wall_ms: number,
 *             cost_usd?: number, num_turns?: number, duration_ms?: number, usage?: Record<string, object>,
 *             loaded?: { tools: string[], mcp_servers: number, skills: number, plugins: number, version?: string, model?: string },
 *             windows: object[] | null }}
 */
export function runSterile({ claude, cwd, prompt, model, effort, tools = ['Read'], env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const args = [...claude.args, '-p', prompt, '--output-format', 'stream-json', '--verbose', '--tools', tools.join(','), ...STERILE_ARGS];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  const t0 = Date.now();
  const r = spawnSync(claude.command, args, { cwd, env: sterileEnv(env), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const stdout = r.stdout ?? '';
  const base = { exit: r.status, timed_out: r.error?.code === 'ETIMEDOUT', wall_ms: Date.now() - t0, windows: windowsFromStreamJson(stdout) };
  if (r.error && !base.timed_out) return { ...base, ok: false, problem: `could not start ${claude.command}: ${r.error.message}` };
  if (base.timed_out) return { ...base, ok: false, problem: `no answer within ${Math.round(timeoutMs / 1000)} s` };
  const { init, result } = readStream(stdout);
  const loaded = init
    ? {
        tools: Array.isArray(init.tools) ? init.tools : [],
        mcp_servers: Array.isArray(init.mcp_servers) ? init.mcp_servers.length : 0,
        skills: Array.isArray(init.skills) ? init.skills.length : 0,
        plugins: Array.isArray(init.plugins) ? init.plugins.length : 0,
        version: init.claude_code_version,
        model: init.model,
      }
    : undefined;
  if (!result) return { ...base, loaded, ok: false, problem: `the output had no result (exit ${r.status}): ${(r.stderr || stdout).trim().slice(0, 300)}` };
  const usage = {};
  for (const [m, u] of Object.entries(result.modelUsage ?? {})) {
    usage[m] = {
      input_tokens: u.inputTokens ?? 0,
      output_tokens: u.outputTokens ?? 0,
      cache_write_tokens: u.cacheCreationInputTokens ?? 0,
      cache_read_tokens: u.cacheReadInputTokens ?? 0,
    };
  }
  const out = {
    ...base,
    loaded,
    ok: result.is_error !== true && typeof result.result === 'string',
    text: typeof result.result === 'string' ? result.result : undefined,
    cost_usd: result.total_cost_usd,
    num_turns: result.num_turns,
    duration_ms: result.duration_ms,
    usage,
  };
  if (!out.ok) out.problem = `the run ended with an error (${result.subtype ?? 'unknown'})`;
  const sterile = checkInit(init, tools);
  if (out.ok && sterile) {
    out.ok = false;
    out.problem = sterile;
  }
  return out;
}
