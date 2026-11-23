// Thin, shell-free wrapper around the git CLI shared by every module.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

export function headSha(cwd, env) {
  const r = tryGit(['rev-parse', '--verify', '-q', 'HEAD'], { cwd, env });
  return r.ok ? r.stdout.trim() : null;
}

/** True when the working tree has no staged, unstaged or untracked changes. */
export function isClean(cwd, env) {
  return git(['status', '--porcelain', '--untracked-files=all'], { cwd, env }) === '';
}
