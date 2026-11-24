// Gate runner. Gates and their steps are configuration (.asdk/gates.json in the
// project), not code: names, steps and the check a gate verifies can all change
// without touching the kit.
//
// A run is bound to the commit it verified (head_sha), records whether the tree
// was clean, writes a gate-summary file, appends a gate.run event, and can record
// the result on the task as a script verification.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { usageError } from '../../core/errors.mjs';
import { git, headSha, isClean, repoInfo, tryGit } from '../../core/git.mjs';
import { validateContract } from '../../core/validate.mjs';
import { dataPath } from '../../collector/lib/paths.mjs';
import { resolveProject } from '../../collector/lib/registry.mjs';
import { readWorktreeMarker } from '../../collector/lib/state.mjs';
import { appendEvent, makeEvent } from '../../collector/lib/store.mjs';
import { CHECKS, loadTaskRecords, verifyTask } from '../../collector/lib/tasks.mjs';
import { denySyncCheck, referencesCheck } from './checks.mjs';
import { changedPaths, higherRisk, loadRiskPaths, pathMinimum } from './risk.mjs';

const CONFIG_FILE = path.join('.asdk', 'gates.json');
const KINDS = ['lint', 'build', 'unit', 'integration', 'ui', 'static'];
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const BUILTINS = { 'syntax-check': syntaxCheck, 'clean-tree': cleanTree, references: referencesCheck, 'deny-sync': denySyncCheck };
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function loadGateConfig(top) {
  const file = path.join(top, CONFIG_FILE);
  if (!existsSync(file)) throw usageError(`no gate configuration at ${CONFIG_FILE}`);
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    throw usageError(`${CONFIG_FILE} is not valid JSON: ${err.message}`);
  }
  const fail = (msg) => {
    throw usageError(`${CONFIG_FILE}: ${msg}`);
  };
  if (!config || typeof config.gates !== 'object') fail('"gates" must be an object');
  if (config.runner_id !== undefined && !NAME.test(config.runner_id)) fail('"runner_id" has invalid characters');
  for (const [name, gate] of Object.entries(config.gates)) {
    if (!NAME.test(name)) fail(`gate name "${name}" has invalid characters`);
    if (gate.verifies !== undefined && !CHECKS.includes(gate.verifies)) fail(`gate ${name}: "verifies" must be one of ${CHECKS.join(', ')}`);
    if (!Array.isArray(gate.steps) || gate.steps.length === 0) fail(`gate ${name}: "steps" must be a non-empty array`);
    for (const step of gate.steps) {
      if (typeof step.name !== 'string' || step.name === '') fail(`gate ${name}: every step needs a name`);
      if (!KINDS.includes(step.kind)) fail(`gate ${name}, step "${step.name}": kind must be one of ${KINDS.join(', ')}`);
      const hasRun = Array.isArray(step.run) && step.run.length > 0 && step.run.every((a) => typeof a === 'string');
      const hasBuiltin = typeof step.builtin === 'string' && Object.hasOwn(BUILTINS, step.builtin);
      if (hasRun === hasBuiltin) fail(`gate ${name}, step "${step.name}": needs exactly one of "run" (argv array) or a known "builtin"`);
    }
  }
  const push = config.push_check;
  if (push !== undefined) {
    if (!push || typeof push !== 'object') fail('"push_check" must be an object');
    if (!Object.hasOwn(config.gates, push.gate ?? '')) fail('push_check: "gate" must name a configured gate');
    for (const key of ['remote', 'branch']) {
      if (push[key] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(push[key])) fail(`push_check: "${key}" has invalid characters`);
    }
    if (push.runners !== undefined && (!Array.isArray(push.runners) || !push.runners.every((r) => NAME.test(r)))) fail('push_check: "runners" must be a list of runner ids');
  }
  return config;
}

/** The push check settings of a gate configuration, with defaults; null when not configured. */
export function pushCheckConfig(config) {
  const push = config.push_check;
  if (!push) return null;
  return { remote: push.remote ?? 'origin', branch: push.branch ?? 'main', gate: push.gate, runners: push.runners ?? null };
}

/** Child environment for gate steps: an outer node --test must not capture the step's own test run. */
function stepEnv(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (k.toUpperCase() === 'NODE_TEST_CONTEXT') delete out[k];
  return out;
}

function syntaxCheck({ cwd, env }) {
  const files = git(['ls-files', '-z', '--', '*.js', '*.mjs', '*.cjs'], { cwd, env }).split('\0').filter(Boolean);
  const failed = [];
  for (const file of files) {
    const r = spawnSync(process.execPath, ['--check', file], { cwd, env, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) failed.push(`${file}\n${r.stderr.trim()}`);
  }
  return { status: failed.length ? 1 : 0, output: failed.length ? failed.join('\n\n') : `${files.length} files OK` };
}

/** A release gate verifies exactly what is committed: any uncommitted or untracked file fails it. */
function cleanTree({ cwd, env }) {
  const changes = git(['status', '--porcelain', '--untracked-files=all'], { cwd, env }).split(/\r?\n/).filter(Boolean);
  if (changes.length === 0) return { status: 0, output: 'working tree clean' };
  const list = changes.slice(0, 20).join('\n');
  return { status: 1, output: `${changes.length} uncommitted or untracked file(s); commit or remove them, then run the gate again:\n${list}` };
}

function runStep(step, { cwd, env }) {
  if (step.builtin) {
    const r = BUILTINS[step.builtin]({ cwd, env });
    return { result: r.status === 0 ? 'pass' : 'fail', exit_code: r.status, output: r.output };
  }
  const [cmd, ...args] = step.run;
  const r = spawnSync(cmd === 'node' ? process.execPath : cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: step.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (r.error) return { result: 'error', exit_code: null, output: `could not run ${cmd}: ${r.error.message}` };
  return { result: r.status === 0 ? 'pass' : 'fail', exit_code: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

/**
 * Runs one gate in the repository that contains `cwd`.
 * @returns {{ summary: object, file: string, outputs: Record<string, string>, risk_matches: Array<{ path: string, risk: string, reason?: string }> }}
 */
export function runGate(env, { gate, cwd, taskId, record = false, runner, now = () => new Date() }) {
  const repo = repoInfo(cwd, env);
  if (!repo) throw usageError('not inside a git repository');
  const top = repo.toplevel;
  const config = loadGateConfig(top);
  const gateConfig = config.gates[gate];
  if (!gateConfig) throw usageError(`unknown gate "${gate}" (configured: ${Object.keys(config.gates).join(', ')})`);

  const project = resolveProject(top, { env });
  if (!project.project_id) throw usageError('this repository is not a registered project; run "asdk project add"');

  let task = null;
  const id = taskId ?? (project.worktree ? readWorktreeMarker(env, project.project_id, project.worktree)?.task_id : undefined);
  if (id) {
    task = loadTaskRecords(env).get(id) ?? null;
    if (!task) throw usageError(`task ${id} has not been started`);
  }
  if (record && !task) throw usageError('--record needs a task: pass --task or run inside a task worktree');
  if (record && !gateConfig.verifies) throw usageError(`gate ${gate} has no "verifies" check to record`);

  const head = headSha(top, env);
  if (!head) throw usageError('the repository has no commits yet');
  const baseBranch = config.integration_branch ?? 'dev';
  const base = tryGit(['rev-parse', '--verify', '-q', `refs/heads/${baseBranch}`], { cwd: top, env });
  const runnerId = runner ?? config.runner_id ?? 'local';
  if (!NAME.test(runnerId)) throw usageError(`invalid runner id "${runnerId}"`);
  const riskRules = loadRiskPaths(top);
  const minimum = pathMinimum(riskRules, changedPaths(top, env, { base: base.ok ? base.stdout.trim() : null, head }));

  const startedAt = now();
  const treeClean = isClean(top, env);
  const childEnv = stepEnv(env);
  const steps = [];
  const outputs = {};
  let stopped = false;
  for (const step of gateConfig.steps) {
    if (stopped) {
      steps.push({ name: step.name, kind: step.kind, result: 'skipped', duration_ms: 0, exit_code: null });
      continue;
    }
    const t0 = Date.now();
    const r = runStep(step, { cwd: top, env: childEnv });
    steps.push({ name: step.name, kind: step.kind, result: r.result, duration_ms: Date.now() - t0, exit_code: r.exit_code });
    outputs[step.name] = r.output;
    if (r.result !== 'pass') stopped = true;
  }
  const result = steps.some((s) => s.result === 'error') ? 'error' : steps.some((s) => s.result === 'fail') ? 'fail' : 'pass';
  const finishedAt = now();

  const declared = task?.risk;
  const summary = {
    schema_version: 1,
    gate,
    project_id: project.project_id,
    ...(task ? { task_id: task.task_id } : {}),
    head_sha: head,
    base_branch: baseBranch,
    ...(base.ok ? { base_sha: base.stdout.trim() } : {}),
    tree_clean: treeClean,
    // Changed paths can raise the declared risk, never lower it.
    risk: { ...(declared ? { declared } : {}), path_minimum: minimum.risk, effective: declared ? higherRisk(declared, minimum.risk) : minimum.risk },
    steps,
    result,
    runner: { id: runnerId },
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  };
  const check = validateContract('gate-summary', summary);
  if (!check.valid) throw new Error(`internal error: gate summary is invalid at ${check.errors[0].path}: ${check.errors[0].message}`);

  const file = dataPath(env, 'gates', project.project_id, head, `${gate}-${stamp(finishedAt)}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);

  appendEvent(
    env,
    makeEvent(
      {
        source: 'gate',
        event: 'gate.run',
        project_id: project.project_id,
        project_source: project.project_source,
        task_id: task?.task_id,
        worktree: project.worktree ?? undefined,
        data: { gate, result, head_sha: head, tree_clean: treeClean, runner: runnerId },
      },
      finishedAt,
    ),
  );
  if (record) {
    verifyTask(env, { taskId: task.task_id, check: gateConfig.verifies, result, executor: 'script', sha: head, gate, source: 'gate', now: finishedAt });
  }
  return { summary, file, outputs, risk_matches: minimum.matches };
}
