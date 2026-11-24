// One git worktree per task, branched from the integration branch.
//
//   wt new     create <worktree root>/<project>/<TASK-ID> on a new task branch
//   wt finish  rebase onto the latest integration branch, run the gate there,
//              merge with --no-ff, remove the worktree and the branch
//
// The gate runs on the rebased commit, and the merge only happens while the
// integration branch is still an ancestor of that commit, so the merged tree is
// exactly the tree the gate verified.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ruleError, usageError } from '../../core/errors.mjs';
import { git, headSha, isClean, tryGit } from '../../core/git.mjs';
import { findProject, loadConfig, worktreeRoot } from '../../collector/lib/registry.mjs';
import { readWorktreeMarker, removeWorktreeMarker, writeWorktreeMarker } from '../../collector/lib/state.mjs';
import { appendEvent, makeEvent } from '../../collector/lib/store.mjs';
import { loadTaskRecords } from '../../collector/lib/tasks.mjs';
import { loadGateConfig, runGate } from '../../governance/gate/gate.mjs';
import { mergeRule, reviewStatus } from '../../governance/gate/policy.mjs';
import { changedPaths, higherRisk, loadRiskPaths, pathMinimum } from '../../governance/gate/risk.mjs';
import { loadProfiles } from '../../governance/profiles/profiles.mjs';

const BRANCH_PREFIX = {
  feature: 'feat',
  bugfix: 'fix',
  refactor: 'refactor',
  test: 'test',
  docs: 'docs',
  config: 'chore',
  investigation: 'spike',
};

function activeTask(env, taskId) {
  const task = loadTaskRecords(env).get(taskId);
  if (!task) throw ruleError(`task ${taskId} has not been started`);
  if (task.status === 'ended') throw ruleError(`task ${taskId} has ended`);
  return task;
}

function projectOf(env, task) {
  const config = loadConfig(env);
  const project = findProject(config, task.project_id);
  if (!project) throw usageError(`project ${task.project_id} is not registered`);
  return { config, project, integration: project.integration_branch ?? 'dev' };
}

export function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

export function newWorktree(env, { taskId, slug, now }) {
  const task = activeTask(env, taskId);
  const { config, project, integration } = projectOf(env, task);
  if (readWorktreeMarker(env, project.id, taskId)) throw ruleError(`task ${taskId} already has a worktree`);

  const root = project.root;
  if (!tryGit(['rev-parse', '--verify', '-q', `refs/heads/${integration}`], { cwd: root, env }).ok) {
    throw usageError(`the integration branch "${integration}" does not exist in ${root}`);
  }
  const suffix = slugify(slug);
  const branch = `${BRANCH_PREFIX[task.type] ?? 'task'}/${taskId}${suffix ? `-${suffix}` : ''}`;
  if (tryGit(['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { cwd: root, env }).ok) throw ruleError(`branch ${branch} already exists`);

  // Short, predictable paths: Windows tools still trip over long ones.
  const wtPath = path.join(worktreeRoot(env, config), project.id, taskId);
  if (existsSync(wtPath)) throw ruleError(`${wtPath} already exists`);
  mkdirSync(path.dirname(wtPath), { recursive: true });
  const baseSha = git(['rev-parse', `refs/heads/${integration}`], { cwd: root, env });
  git(['worktree', 'add', '-q', '-b', branch, wtPath, integration], { cwd: root, env });

  // Untracked local files (for example hook settings) do not follow a new
  // worktree; copy only the ones the project lists explicitly.
  const copied = [];
  for (const rel of project.worktree_copy_files ?? []) {
    const from = path.join(root, rel);
    const to = path.join(wtPath, rel);
    if (existsSync(from) && !existsSync(to)) {
      mkdirSync(path.dirname(to), { recursive: true });
      copyFileSync(from, to);
      copied.push(rel);
    }
  }

  writeWorktreeMarker(env, { task_id: taskId, project_id: project.id, slot: taskId, path: wtPath, branch, integration });
  appendEvent(
    env,
    makeEvent(
      {
        source: 'orchestrator',
        event: 'wt.new',
        project_id: project.id,
        task_id: taskId,
        worktree: taskId,
        data: { branch, base_branch: integration, base_sha: baseSha, copied_files: copied.length },
      },
      now,
    ),
  );
  return { path: wtPath, branch, slot: taskId, copied };
}

/**
 * Rebases the task branch, runs the gate on the rebased commit and merges it when
 * everything the merge policy asks for that commit's effective risk is there.
 *
 * The policy, gates and risk rules are read from the main checkout, which must be
 * on the integration branch: a branch cannot loosen the rules it is judged by.
 *
 * @returns {{ merged: boolean, reason?: 'gate' | 'reviews', gate: object, risk: object, rule: object | null,
 *             reviews?: object, head_sha?: string, merge_sha?: string }}
 */
export function finishWorktree(env, { taskId, gate: requested, now }) {
  const task = activeTask(env, taskId);
  const { project, integration } = projectOf(env, task);
  const marker = readWorktreeMarker(env, project.id, taskId);
  if (!marker || !existsSync(marker.path)) throw ruleError(`task ${taskId} has no worktree`);
  const { path: wtPath, branch } = marker;
  const root = project.root;

  if (!isClean(wtPath, env)) throw ruleError(`the worktree has uncommitted changes; commit or discard them first (${wtPath})`);
  const ahead = Number(git(['rev-list', '--count', `${integration}..${branch}`], { cwd: root, env }));
  if (ahead === 0) throw ruleError(`branch ${branch} has no commits to merge`);
  if (git(['branch', '--show-current'], { cwd: root, env }) !== integration) {
    throw ruleError(`the main checkout must be on ${integration} to merge (${root})`);
  }
  if (!isClean(root, env)) throw ruleError(`the main checkout has uncommitted changes (${root})`);

  const rebase = tryGit(['rebase', '-q', integration], { cwd: wtPath, env });
  if (!rebase.ok) {
    tryGit(['rebase', '--abort'], { cwd: wtPath, env });
    throw ruleError(`rebasing ${branch} onto ${integration} hit conflicts; the rebase was aborted. Resolve them in ${wtPath} and run wt finish again`);
  }
  const verified = headSha(wtPath, env);

  // Effective risk of the rebased branch, by the integration branch's rules.
  const changed = changedPaths(wtPath, env, { base: git(['rev-parse', `refs/heads/${integration}`], { cwd: root, env }), head: verified });
  const minimum = pathMinimum(loadRiskPaths(root), changed).risk;
  const effective = higherRisk(task.risk, minimum);
  // Review counts set to "profile" follow the task's plan profile (ADR-0008).
  const profile = task.profile ? loadProfiles(root).profiles[task.profile] : undefined;
  const rule = mergeRule(loadGateConfig(root), effective, profile?.verifiers[effective]);
  if (rule && requested && requested !== rule.gate) {
    throw ruleError(`the merge policy requires gate ${rule.gate} for ${effective} risk; --gate ${requested} cannot replace it`);
  }
  const gate = rule?.gate ?? requested ?? 'G1';

  const run = runGate(env, { gate, cwd: wtPath, taskId, record: true, rulesFrom: root, now: now ? () => now : undefined });
  const outcome = { gate: run, risk: run.summary.risk, rule, profile: task.profile ?? null, head_sha: verified };
  if (run.summary.result !== 'pass') return { merged: false, reason: 'gate', ...outcome };
  if (rule) {
    const reviews = reviewStatus(loadTaskRecords(env).get(taskId).verifications, verified, rule.reviews);
    if (!reviews.ok) return { merged: false, reason: 'reviews', reviews, ...outcome };
  }

  if (!tryGit(['merge-base', '--is-ancestor', integration, verified], { cwd: root, env }).ok) {
    throw ruleError(`${integration} moved after the gate ran; run wt finish again so the gate checks the merge result`);
  }
  const merge = tryGit(['merge', '--no-ff', '-q', '-m', `Merge ${branch} (${taskId})`, verified], { cwd: root, env });
  if (!merge.ok) {
    tryGit(['merge', '--abort'], { cwd: root, env });
    throw ruleError(`merging into ${integration} failed: ${merge.stderr.trim()}`);
  }
  const mergeSha = headSha(root, env);

  git(['worktree', 'remove', wtPath], { cwd: root, env });
  git(['branch', '-q', '-d', branch], { cwd: root, env });
  removeWorktreeMarker(env, project.id, taskId);
  appendEvent(
    env,
    makeEvent(
      {
        source: 'orchestrator',
        event: 'wt.finish',
        project_id: project.id,
        task_id: taskId,
        worktree: taskId,
        data: { branch, gate, risk: run.summary.risk.effective, head_sha: verified, merge_sha: mergeSha, integration },
      },
      now,
    ),
  );
  return { merged: true, ...outcome, merge_sha: mergeSha };
}
