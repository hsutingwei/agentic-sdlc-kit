// Test sandbox: a throw-away directory tree with a fake home, so no test can
// read or write the developer's real ~/.claude, ~/.agentic-metrics or git config.
//
// Directory names deliberately contain CJK characters and spaces: every path
// handling bug on Windows or POSIX should surface in the ordinary test run.

import { cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Variables a parent git process (for example a pre-commit hook that runs the
// tests) would leak into children and redirect their git commands elsewhere.
const LEAKY_GIT_VARS = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
]);

export const SANDBOX_GIT_USER = { name: 'Demo Dev', email: 'dev@example.invalid' };

/**
 * Creates a sandbox and, when a node:test context is given, removes it after the test.
 * @param {import('node:test').TestContext | undefined} t
 * @param {string} label short ASCII label that ends up in the directory name
 */
export function createSandbox(t, label = 'sandbox') {
  // realpath expands Windows 8.3 short names (RUNNER~1), so paths compare equal
  // to what child processes report.
  const base = realpathSync.native(os.tmpdir());
  const root = mkdtempSync(path.join(base, `asdk 測試 ${label}-`));
  const home = path.join(root, '使用者 家目錄');
  mkdirSync(home, { recursive: true });

  const gitConfig = path.join(home, '.gitconfig');
  writeFileSync(
    gitConfig,
    [
      '[user]',
      `\tname = ${SANDBOX_GIT_USER.name}`,
      `\temail = ${SANDBOX_GIT_USER.email}`,
      '[init]',
      '\tdefaultBranch = main',
      '[core]',
      '\tautocrlf = false',
      '',
    ].join('\n'),
  );

  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const upper = key.toUpperCase();
    // NODE_TEST_CONTEXT is set by the outer `node --test`; a nested `node --test`
    // that inherits it reports to the outer runner instead of printing results.
    if (LEAKY_GIT_VARS.has(upper) || upper.startsWith('AGENTIC_') || upper === 'NODE_TEST_CONTEXT') continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    AGENTIC_METRICS_HOME: path.join(home, '.agentic-metrics'),
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  });

  const sandbox = {
    root,
    home,
    env,
    join: (...parts) => path.join(root, ...parts),
    cleanup() {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
  if (t && typeof t.after === 'function') t.after(() => sandbox.cleanup());
  return sandbox;
}

/**
 * Runs a command without a shell and returns its exit status and UTF-8 output.
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
export function run(command, args, { cwd, env, input } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Runs a Node script with the current Node binary. */
export function runNode(script, args = [], options = {}) {
  return run(process.execPath, [script, ...args], options);
}

export const ASDK = fileURLToPath(new URL('../../bin/asdk.mjs', import.meta.url));

/** Runs the asdk CLI with the sandbox environment. */
export function runAsdk(sandbox, args, { cwd = sandbox.root, input, env = sandbox.env } = {}) {
  return runNode(ASDK, args, { cwd, env, input });
}

/** Creates a git repository with one commit on main. */
export function makeRepo(sandbox, dir, files = { 'README.md': '# demo\n' }) {
  mkdirSync(dir, { recursive: true });
  git(sandbox, dir, 'init', '-q');
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  git(sandbox, dir, 'add', '.');
  git(sandbox, dir, 'commit', '-q', '-m', 'chore: initial commit');
  return dir;
}

export const DEMO_TEMPLATE = fileURLToPath(new URL('../../examples/demo-api', import.meta.url));

/** Copies examples/demo-api into `dir` as a git repository with main and dev; leaves dev checked out. */
export function makeDemoRepo(sandbox, dir) {
  cpSync(DEMO_TEMPLATE, dir, { recursive: true });
  git(sandbox, dir, 'init', '-q');
  git(sandbox, dir, 'add', '.');
  git(sandbox, dir, 'commit', '-q', '-m', 'chore: initial demo-api');
  git(sandbox, dir, 'switch', '-q', '-c', 'dev');
  return dir;
}

/** Runs git inside the sandbox and throws with its stderr when it fails. */
export function git(sandbox, cwd, ...args) {
  const result = run('git', args, { cwd, env: sandbox.env });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${result.stderr}`);
  }
  return result.stdout;
}
