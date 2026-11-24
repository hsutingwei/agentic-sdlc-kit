// Thin, shell-free wrapper around the git CLI shared by every module.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { AsdkError } from './errors.mjs';

/** Runs git and returns { ok, status, stdout, stderr } without throwing on a non-zero exit. */
export function tryGit(args, { cwd, env = process.env, input } = {}) {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    env,
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new AsdkError(`could not run git: ${result.error.message}`, 2);
  return { ok: result.status === 0, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Runs git and returns trimmed stdout; throws AsdkError with git's message on failure. */
export function git(args, options = {}) {
  const r = tryGit(args, options);
  if (!r.ok) throw new AsdkError(`git ${args[0]} failed: ${r.stderr.trim() || `exit ${r.status}`}`, 1);
  return r.stdout.trim();
}

/** Top level, common directory and HEAD of the repository containing `cwd`, or null outside git. */
export function repoInfo(cwd, env) {
  if (!existsSync(cwd)) return null;
  const r = tryGit(['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'], { cwd, env });
  if (!r.ok) return null;
  const [toplevel, commonDir] = r.stdout.trim().split(/\r?\n/);
  return { toplevel, commonDir };
}

/**
 * The same answer as repoInfo, found by reading `.git` entries instead of running git.
 * Used on the hook path, which runs for every tool call and must stay fast.
 *
 * - `.git` directory: a main checkout; the common directory is that directory.
 * - `.git` file pointing at a git dir that holds a `commondir` file: a linked
 *   worktree; the common directory is resolved from that file.
 * - `.git` file without `commondir` (a submodule): its own top level, and its git
 *   dir as the common directory.
 * Returns null outside a repository or when a `.git` file cannot be read.
 */
export function locateRepo(cwd) {
  let dir = path.resolve(cwd);
  if (!existsSync(dir)) return null;
  for (;;) {
    const dotGit = path.join(dir, '.git');
    let stat = null;
    try {
      stat = statSync(dotGit);
    } catch {
      // not here; keep walking up
    }
    if (stat?.isDirectory()) return { toplevel: dir, commonDir: dotGit };
    if (stat?.isFile()) {
      try {
        const match = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
        if (!match) return null;
        const gitDir = path.resolve(dir, match[1]);
        const commondirFile = path.join(gitDir, 'commondir');
        if (!existsSync(commondirFile)) return { toplevel: dir, commonDir: gitDir };
        return { toplevel: dir, commonDir: path.resolve(gitDir, readFileSync(commondirFile, 'utf8').trim()) };
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function headSha(cwd, env) {
  const r = tryGit(['rev-parse', '--verify', '-q', 'HEAD'], { cwd, env });
  return r.ok ? r.stdout.trim() : null;
}

/** True when the working tree has no staged, unstaged or untracked changes. */
export function isClean(cwd, env) {
  return git(['status', '--porcelain', '--untracked-files=all'], { cwd, env }) === '';
}
