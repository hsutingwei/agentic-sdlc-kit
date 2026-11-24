#!/usr/bin/env node
// asdk - command line entry point of agentic-sdlc-kit.
// Each command lives in its module; this file only dispatches.

import { AsdkError } from '../core/errors.mjs';

const COMMANDS = {
  project: { load: () => import('../collector/cli/project.mjs'), fn: 'runProject', help: 'register and list projects' },
  resolve: { load: () => import('../collector/cli/project.mjs'), fn: 'runResolve', help: 'show which project a path belongs to' },
  session: { load: () => import('../collector/cli/session.mjs'), fn: 'runSession', help: 'list sessions and override their project' },
  health: { load: () => import('../collector/cli/health.mjs'), fn: 'runHealth', help: 'check that recording works on this machine' },
  enable: { load: () => import('../collector/cli/recording.mjs'), fn: 'runEnable', help: 'resume recording hook events' },
  disable: { load: () => import('../collector/cli/recording.mjs'), fn: 'runDisable', help: 'pause recording without uninstalling hooks' },
  task: { load: () => import('../collector/cli/task.mjs'), fn: 'runTask', help: 'start, verify and end tasks' },
  human: { load: () => import('../collector/cli/human.mjs'), fn: 'runHuman', help: 'time spent by a person on a task' },
  'push-check': { load: () => import('../collector/cli/push-check.mjs'), fn: 'runPushCheck', help: 'compare pushes to the main branch with gate passes' },
  quota: { load: () => import('../collector/cli/quota.mjs'), fn: 'runQuota', help: 'quota snapshots, plan changes and status' },
  report: { load: () => import('../collector/cli/report.mjs'), fn: 'runReport', help: 'write tasks.csv and summary.md' },
  usage: { load: () => import('../collector/cli/usage.mjs'), fn: 'runUsage', help: 'token usage by model and agent type' },
  wt: { load: () => import('../orchestration/cli/wt.mjs'), fn: 'runWt', help: 'create and finish a task worktree' },
  gate: { load: () => import('../governance/gate/cli.mjs'), fn: 'runGateCommand', help: 'run a configured gate and record the result' },
  profile: { load: () => import('../governance/profiles/cli.mjs'), fn: 'runProfile', help: 'model, effort and verifiers per role for a plan' },
  verify: { load: () => import('../governance/verify/cli.mjs'), fn: 'runVerifyCommand', help: 'run the app, drive scenarios and keep the evidence' },
  harvest: { load: () => import('../adapters/claude-code/harvest-cli.mjs'), fn: 'runHarvest', help: 'collect token usage from Claude Code transcripts' },
  hooks: { load: () => import('../adapters/claude-code/cli.mjs'), fn: 'runHooks', help: 'install, uninstall or inspect the Claude Code hooks' },
  hook: { load: () => import('../adapters/claude-code/hook.mjs'), fn: 'runHook', help: 'Claude Code hook entry (reads the payload from stdin)', neverFail: true },
};

function usage() {
  const lines = ['usage: asdk <command> [options]', '', 'commands:'];
  for (const [name, c] of Object.entries(COMMANDS)) lines.push(`  ${name.padEnd(10)}${c.help}`);
  return lines.join('\n');
}

const [name, ...rest] = process.argv.slice(2);
const ctx = {
  env: process.env,
  cwd: process.cwd(),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

if (!name || name === 'help' || name === '--help' || name === '-h') {
  ctx.out(usage());
} else if (!Object.hasOwn(COMMANDS, name)) {
  ctx.err(`asdk: unknown command "${name}"\n${usage()}`);
  process.exitCode = 2;
} else {
  const command = COMMANDS[name];
  try {
    const mod = await command.load();
    process.exitCode = (await mod[command.fn](rest, ctx)) ?? 0;
  } catch (err) {
    if (command.neverFail) {
      process.exitCode = 0; // hooks must never block the agent tool
    } else if (err instanceof AsdkError) {
      ctx.err(`asdk ${name}: ${err.message}`);
      process.exitCode = err.exitCode;
    } else {
      throw err;
    }
  }
}
