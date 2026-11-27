// The task catalogue. Tasks come in suites, one per experiment; a task id belongs
// to one suite only. E1's tasks are in tools/experiment/tasks/<TASK-ID>/, E2's
// in tools/experiment/suites/e2/tasks/<TASK-ID>/:
//
//   brief.json   the task brief the agent gets (core contract task-brief)
//   setup/       files laid over the demo before the task starts, for example a
//                planted bug; committed on dev as the task's starting point
//   hidden/      tests the agent never sees, run after the merge: a failure is an
//                escaped defect
//   solution/    a reference solution, used only to prove the task can be done
//                and that its hidden tests tell a solution from the start
//   naive/       E2 only: the files of a half-done version, laid over the
//                reference solution; it passes the gates and fails hidden tests,
//                which is what makes the task hard for a stated reason
//
// The catalogue is fictional, like everything else in the demo.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../../core/git.mjs';
import { validateContract } from '../../../core/validate.mjs';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// `tasks` holds the suite's task folders. `base`, when a suite has one, is laid over
// the demo before a task's own setup: the starting point all its tasks share.
export const SUITES = {
  e1: { tasks: path.join(HERE, 'tasks'), base: null },
  // E2 starts from a larger demo: more modules, a data file, more of an HTTP contract.
  e2: { tasks: path.join(HERE, 'suites', 'e2', 'tasks'), base: path.join(HERE, 'suites', 'e2', 'base') },
};
const PARTS = ['setup', 'solution', 'naive', 'hidden'];

function suite(name) {
  if (!Object.hasOwn(SUITES, name)) throw new Error(`unknown suite "${name}"; there are: ${Object.keys(SUITES).join(', ')}`);
  return SUITES[name];
}

function filesUnder(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const abs = path.join(dir, name);
      return statSync(abs).isDirectory() ? filesUnder(abs, base) : [{ rel: path.relative(base, abs).split(path.sep).join('/'), abs }];
    });
}

/** The files a suite lays over the demo before any of its tasks: none for a suite without a base. */
export function baseFiles(suiteName) {
  const { base } = suite(suiteName);
  return base ? filesUnder(base) : [];
}

export function listTaskIds(suiteName = 'e1') {
  const { tasks } = suite(suiteName);
  if (!existsSync(tasks)) return [];
  return readdirSync(tasks).filter((d) => existsSync(path.join(tasks, d, 'brief.json'))).sort();
}

export function loadTask(id) {
  const suiteName = Object.keys(SUITES).find((name) => existsSync(path.join(SUITES[name].tasks, id, 'brief.json')));
  if (!suiteName) throw new Error(`no task ${id} in any suite`);
  const dir = path.join(SUITES[suiteName].tasks, id);
  const brief = JSON.parse(readFileSync(path.join(dir, 'brief.json'), 'utf8'));
  const check = validateContract('task-brief', brief);
  if (!check.valid) throw new Error(`${id}/brief.json: ${check.errors[0].path} ${check.errors[0].message}`);
  if (brief.task_id !== id) throw new Error(`${id}/brief.json names task ${brief.task_id}`);
  const task = { id, dir, brief, suite: suiteName, base: baseFiles(suiteName) };
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

/** Puts the brief, the suite's base and the setup files on dev as one commit: the task's starting point. */
export function prepareBase(env, { task, repo }) {
  const briefFile = path.join(repo, 'briefs', `${task.id}.json`);
  mkdirSync(path.dirname(briefFile), { recursive: true });
  writeFileSync(briefFile, `${JSON.stringify(task.brief, null, 2)}\n`);
  applyOverlay(task.base, repo);
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
