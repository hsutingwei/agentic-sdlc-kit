// The E1 task catalogue: tools/experiment/tasks/<TASK-ID>/
//
//   brief.json   the task brief the agent gets (core contract task-brief)
//   setup/       files laid over the demo before the task starts, for example a
//                planted bug; committed on dev as the task's starting point
//   hidden/      tests the agent never sees, run after the merge: a failure is an
//                escaped defect
//   solution/    a reference solution, used only to prove the task can be done
//                and that its hidden tests tell a solution from the start
//
// The catalogue is fictional, like everything else in the demo.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../../core/git.mjs';
import { validateContract } from '../../../core/validate.mjs';

export const TASKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tasks');
const PARTS = ['setup', 'solution', 'hidden'];

function filesUnder(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const abs = path.join(dir, name);
      return statSync(abs).isDirectory() ? filesUnder(abs, base) : [{ rel: path.relative(base, abs).split(path.sep).join('/'), abs }];
    });
}

export function listTaskIds() {
  return readdirSync(TASKS_DIR).filter((d) => existsSync(path.join(TASKS_DIR, d, 'brief.json'))).sort();
}

export function loadTask(id) {
  const dir = path.join(TASKS_DIR, id);
  const brief = JSON.parse(readFileSync(path.join(dir, 'brief.json'), 'utf8'));
  const check = validateContract('task-brief', brief);
  if (!check.valid) throw new Error(`${id}/brief.json: ${check.errors[0].path} ${check.errors[0].message}`);
  if (brief.task_id !== id) throw new Error(`${id}/brief.json names task ${brief.task_id}`);
  const task = { id, dir, brief };
  for (const part of PARTS) task[part] = filesUnder(path.join(dir, part));
  if (task.hidden.length === 0) throw new Error(`${id}: no hidden tests`);
  if (task.solution.length === 0) throw new Error(`${id}: no reference solution`);
  return task;
}

/** Copies overlay files into `repo` at their relative paths. */
export function applyOverlay(files, repo) {
  for (const f of files) {
    const to = path.join(repo, f.rel);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(f.abs, to);
  }
  return files.map((f) => f.rel);
}

const fictional = { GIT_AUTHOR_NAME: 'Demo Dev', GIT_AUTHOR_EMAIL: 'dev@example.invalid', GIT_COMMITTER_NAME: 'Demo Dev', GIT_COMMITTER_EMAIL: 'dev@example.invalid' };

/** Puts the brief and the setup files on dev as one commit: the task's starting point. */
export function prepareBase(env, { task, repo }) {
  const briefFile = path.join(repo, 'briefs', `${task.id}.json`);
  mkdirSync(path.dirname(briefFile), { recursive: true });
  writeFileSync(briefFile, `${JSON.stringify(task.brief, null, 2)}\n`);
  applyOverlay(task.setup, repo);
  const genv = { ...env, ...fictional };
  git(['add', '-A'], { cwd: repo, env: genv });
  git(['commit', '-q', '-m', `chore: starting point for ${task.id}`], { cwd: repo, env: genv });
  return git(['rev-parse', 'HEAD'], { cwd: repo, env: genv });
}

/** Commits `files` on the current branch of `repo`, as the fictional demo identity. */
export function commitOverlay(env, { repo, files, message }) {
  applyOverlay(files, repo);
  const genv = { ...env, ...fictional };
  git(['add', '-A'], { cwd: repo, env: genv });
  git(['commit', '-q', '-m', message], { cwd: repo, env: genv });
  return git(['rev-parse', 'HEAD'], { cwd: repo, env: genv });
}

/**
 * Runs the task's hidden tests against `ref` of `repo` in a throw-away worktree, so
 * nothing is left in the repository.
 * @returns {{ result: 'pass' | 'fail', passed: number, failed: number, output: string }}
 */
export function runHidden(env, { task, repo, ref = 'dev' }) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'asdk-hidden-'));
  const wt = path.join(tmp, 'tree');
  git(['worktree', 'add', '-q', '--detach', wt, ref], { cwd: repo, env });
  try {
    const placed = applyOverlay(
      task.hidden.map((f) => ({ ...f, rel: `test/hidden/${f.rel}` })),
      wt,
    );
    const childEnv = { ...env };
    for (const k of Object.keys(childEnv)) if (k.toUpperCase() === 'NODE_TEST_CONTEXT') delete childEnv[k];
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...placed], { cwd: wt, env: childEnv, encoding: 'utf8', timeout: 120000, windowsHide: true });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const count = (name) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(output)?.[1] ?? 0);
    const passed = count('pass');
    const failed = count('fail') + count('cancelled');
    return { result: r.status === 0 && failed === 0 && passed > 0 ? 'pass' : 'fail', passed, failed, output };
  } finally {
    git(['worktree', 'remove', '--force', wt], { cwd: repo, env });
    rmSync(tmp, { recursive: true, force: true });
  }
}
