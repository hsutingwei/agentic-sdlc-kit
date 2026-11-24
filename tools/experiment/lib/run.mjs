// One E1 run: a fresh demo repository, the task's starting point, the profile,
// a headless Claude Code session in the task worktree, then the gate. A failed
// gate gets one retry with its output; a second failure is an escalation.
//
// What the agent and the person do is recorded by the kit itself in the run's
// own metrics folder; this module only drives the steps and appends to the
// experiment log. Prompts and answers stay in the run folder (agent-<n>.jsonl)
// and are never copied into the repository.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../../core/git.mjs';
import { applyToAgents } from '../../../adapters/claude-code/agents.mjs';
import { windowsFromStreamJson } from '../../../adapters/claude-code/rate-limit.mjs';
import { changePlan, recordSnapshot } from '../../../collector/lib/quota.mjs';
import { loadConfig, saveConfig } from '../../../collector/lib/registry.mjs';
import { escalateTask, startTask } from '../../../collector/lib/tasks.mjs';
import { finishWorktree, newWorktree } from '../../../orchestration/lib/worktree.mjs';
import { loadProfiles, resolveRole } from '../../../governance/profiles/profiles.mjs';
import { claudeArgs } from '../../../governance/profiles/profiles.mjs';
import { setupDemo } from '../../lib/demo.mjs';
import { loadTask, prepareBase } from './catalogue.mjs';
import { logRun, PLAN_OF, runDir } from './plan.mjs';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ASDK = path.join(KIT, 'bin', 'asdk.mjs');
export const ALLOWED_TOOLS = 'Read,Edit,Write,Glob,Grep,Agent,Bash(node:*),Bash(git:*),Bash(asdk:*)';
const AGENT_TIMEOUT_MS = 20 * 60 * 1000;
const GATE_TAIL_LINES = 40;
// Stop starting runs when a window is this full; the plan resumes later.
export const QUOTA_STOP = { five_hour: 80, seven_day: 90 };
const FICTIONAL = { GIT_AUTHOR_NAME: 'Demo Dev', GIT_AUTHOR_EMAIL: 'dev@example.invalid', GIT_COMMITTER_NAME: 'Demo Dev', GIT_COMMITTER_EMAIL: 'dev@example.invalid' };

// Reviewer agents arrive in P8, so in E1 the person's review is the one review every
// risk level needs: the gate still follows the risk, the verifier count does not.
export const E1_MERGE_POLICY = {
  low: { gate: 'G1' },
  medium: { gate: 'G2', reviews: { any: 1 } },
  high: { gate: 'G2', reviews: { human: 1 } },
  critical: { gate: 'G2', reviews: { human: 1 } },
};

/** `asdk` on the agent's PATH, for the verify skill: a shell script and a .cmd for Windows. */
export function writeShims(dir) {
  const bin = path.join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const node = process.execPath;
  writeFileSync(path.join(bin, 'asdk'), `#!/bin/sh\nexec "${node.split(path.sep).join('/')}" "${ASDK.split(path.sep).join('/')}" "$@"\n`, { mode: 0o755 });
  writeFileSync(path.join(bin, 'asdk.cmd'), `@"${node}" "${ASDK}" %*\r\n`);
  return bin;
}

/**
 * The environment of a run: the caller's, without Claude Code and kit settings that
 * would change the outcome, with the run's own metrics folder and the asdk shim.
 */
export function runEnv(baseEnv, { metrics, bin }) {
  const env = {};
  for (const [k, v] of Object.entries(baseEnv)) if (!/^(CLAUDE_CODE_|ANTHROPIC_|AGENTIC_)/i.test(k)) env[k] = v;
  env.AGENTIC_METRICS_HOME = metrics;
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = `${bin}${path.delimiter}${env[pathKey] ?? ''}`;
  return env;
}

function summarizeStream(text) {
  let result = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"result"')) continue;
    try {
      const o = JSON.parse(line);
      if (o.type === 'result') {
        result = {
          subtype: o.subtype,
          is_error: o.is_error === true,
          num_turns: o.num_turns,
          duration_ms: o.duration_ms,
          total_cost_usd: o.total_cost_usd,
          models: Object.keys(o.modelUsage ?? {}),
        };
      }
    } catch {
      // other output
    }
  }
  return result;
}

/** Runs the agent once in the worktree; returns what the run and the quota looked like. */
function runAgent(ctx, { attempt, prompt }) {
  const { claude, env, wt, dir, run, profileArgs } = ctx;
  const args = [...claude.args, '-p', prompt, ...profileArgs, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--allowedTools', ALLOWED_TOOLS];
  const t0 = Date.now();
  const r = spawnSync(claude.command, args, { cwd: wt, env, encoding: 'utf8', timeout: AGENT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  const stream = r.stdout ?? '';
  writeFileSync(path.join(runDir(dir, run), `agent-${attempt}.jsonl`), stream);
  const windows = windowsFromStreamJson(stream);
  if (windows?.length) recordSnapshot(env, { windows, source: 'stream-json' });
  return {
    attempt,
    exit: r.status,
    timed_out: r.error?.code === 'ETIMEDOUT',
    wall_ms: Date.now() - t0,
    result: summarizeStream(stream),
    quota: Object.fromEntries((windows ?? []).map((w) => [w.name, w.used_pct])),
  };
}

function gateTail(finish) {
  const failed = finish.gate.summary.steps.find((s) => s.result === 'fail' || s.result === 'error');
  const lines = (finish.gate.outputs[failed?.name] ?? '').trimEnd().split(/\r?\n/).slice(-GATE_TAIL_LINES);
  return `${failed ? `step "${failed.name}" ${failed.result}` : 'the gate failed'}:\n${lines.join('\n')}`;
}

/**
 * Executes one planned run up to the point where a person has to review it.
 * @returns {object} the last log record of the run
 */
export function executeRun(dir, planned, { baseEnv = process.env, claude, now = () => new Date() }) {
  const { run, profile } = planned;
  const task = loadTask(planned.task);
  const folder = runDir(dir, run);
  const metrics = path.join(folder, 'metrics');
  mkdirSync(folder, { recursive: true });
  const env = runEnv(baseEnv, { metrics, bin: writeShims(dir) });
  const log = (record) => {
    const full = { run, ...record };
    logRun(dir, full, now());
    return full;
  };
  log({ stage: 'started', task: task.id, profile, repeat: planned.repeat, pilot: planned.pilot });

  // A fresh demo, with worktrees inside the run folder rather than ~/wt.
  const repo = path.join(folder, 'demo-api');
  setupDemo(env, { target: repo });
  const config = loadConfig(env);
  config.worktrees = { root: path.join(folder, 'wt') };
  saveConfig(env, config);
  prepareBase(env, { task, repo });

  // The plan the profile belongs to, the profile's model and effort in the agent files,
  // and the experiment's merge policy, committed as the setup of this run.
  changePlan(env, { plan: PLAN_OF[profile] });
  const profiles = loadProfiles(repo);
  const chosen = profiles.profiles[profile];
  applyToAgents(repo, (role) => (Object.hasOwn(chosen.roles, role) ? resolveRole(chosen, role, task.brief.risk) : null));
  const gatesFile = path.join(repo, '.asdk', 'gates.json');
  const gates = JSON.parse(readFileSync(gatesFile, 'utf8'));
  gates.merge_policy = E1_MERGE_POLICY;
  writeFileSync(gatesFile, `${JSON.stringify(gates, null, 2)}\n`);
  git(['commit', '-q', '-am', `chore: E1 setup (${profile} profile, merge policy)`], { cwd: repo, env: { ...env, ...FICTIONAL } });

  startTask(env, {
    taskId: task.id,
    cwd: repo,
    type: task.brief.type,
    risk: task.brief.risk,
    title: task.brief.title,
    estimateHours: task.brief.estimate_hours,
    profile,
    profileSource: 'manual',
  });
  const wt = newWorktree(env, { taskId: task.id, slug: task.brief.title }).path;
  const ctx = { claude, env, wt, dir, run, profileArgs: claudeArgs(resolveRole(chosen, 'planner', task.brief.risk)) };

  const attempts = [];
  attempts.push(runAgent(ctx, { attempt: 1, prompt: `Use the implementer sub-agent to implement briefs/${task.id}.json. Wait until it has finished, then reply with its agent report.` }));
  const tryFinish = () => {
    try {
      return finishWorktree(env, { taskId: task.id });
    } catch (err) {
      return { merged: false, reason: 'error', error: err.message };
    }
  };
  let finish = tryFinish();
  if (finish.reason === 'gate' || finish.reason === 'error') {
    const why = finish.reason === 'gate' ? gateTail(finish) : finish.error;
    attempts.push(
      runAgent(ctx, {
        attempt: 2,
        prompt: `wt finish did not merge your work on briefs/${task.id}.json. Use the implementer sub-agent again to fix it, commit, and reply with its agent report.\n\n${why}`,
      }),
    );
    finish = tryFinish();
  }

  const quota = attempts.at(-1).quota;
  const base = {
    attempts,
    first_gate: attempts.length === 1 && finish.reason !== 'gate' && finish.reason !== 'error' ? 'pass' : 'fail',
    risk: finish.risk ?? null,
    head_sha: finish.head_sha ?? null,
    quota,
  };
  if (finish.reason === 'gate' || finish.reason === 'error') {
    escalateTask(env, { taskId: task.id, kind: 'repeated_failure', reason: 'the gate failed twice in the E1 run' });
    return log({ stage: 'review', ...base, merged: false, gate_failed: true, note: finish.error });
  }
  return log({ stage: 'review', ...base, merged: finish.merged === true, merge_sha: finish.merge_sha ?? null, gate_failed: false });
}

/** Whether quota allows another run, from the latest window percentages seen. */
export function quotaAllows(quota = {}) {
  const over = Object.entries(QUOTA_STOP).filter(([w, limit]) => (quota[w] ?? 0) >= limit);
  return { ok: over.length === 0, over: over.map(([w]) => `${w} ${quota[w]}% (stop at ${QUOTA_STOP[w]}%)`) };
}

export const readStream = (dir, run, attempt) => readFileSync(path.join(runDir(dir, run), `agent-${attempt}.jsonl`), 'utf8');
