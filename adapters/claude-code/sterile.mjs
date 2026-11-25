// A sterile headless Claude Code run: no CLAUDE.md, memory, skills, hooks, MCP servers
// or session file, only the tools named, started in a folder outside any repository.
// The flags are the ones the spike confirmed on a subscription (docs/spike, finding 4).
// Hooks do not fire in such a run, so its usage comes from the JSON result.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
 * Runs `claude -p` sterile in `cwd` and reads its JSON result.
 * @returns {{ ok: boolean, problem?: string, text?: string, exit: number | null, timed_out: boolean, wall_ms: number,
 *             cost_usd?: number, num_turns?: number, duration_ms?: number, usage?: Record<string, object> }}
 */
export function runSterile({ claude, cwd, prompt, model, effort, tools = ['Read'], env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const args = [...claude.args, '-p', prompt, '--output-format', 'json', '--tools', tools.join(','), ...STERILE_ARGS];
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  const t0 = Date.now();
  const r = spawnSync(claude.command, args, { cwd, env: sterileEnv(env), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const base = { exit: r.status, timed_out: r.error?.code === 'ETIMEDOUT', wall_ms: Date.now() - t0 };
  if (r.error && !base.timed_out) return { ...base, ok: false, problem: `could not start ${claude.command}: ${r.error.message}` };
  if (base.timed_out) return { ...base, ok: false, problem: `no answer within ${Math.round(timeoutMs / 1000)} s` };
  let result;
  try {
    result = JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '');
  } catch {
    return { ...base, ok: false, problem: `the output was not a JSON result (exit ${r.status}): ${(r.stderr || r.stdout).trim().slice(0, 300)}` };
  }
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
    ok: result.is_error !== true && typeof result.result === 'string',
    text: typeof result.result === 'string' ? result.result : undefined,
    cost_usd: result.total_cost_usd,
    num_turns: result.num_turns,
    duration_ms: result.duration_ms,
    usage,
  };
  if (!out.ok) out.problem = `the run ended with an error (${result.subtype ?? 'unknown'})`;
  return out;
}
