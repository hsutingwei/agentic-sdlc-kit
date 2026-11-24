// Creates a throw-away demo repository from examples/demo-api, outside the kit's
// own repository, the way a user's real project would be set up.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usageError } from '../../core/errors.mjs';
import { copyDir } from '../../core/fs.mjs';
import { git } from '../../core/git.mjs';
import { registerProject } from '../../collector/lib/registry.mjs';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMO_TEMPLATE = path.join(KIT_ROOT, 'examples', 'demo-api');
export const ASDK_BIN = path.join(KIT_ROOT, 'bin', 'asdk.mjs');

export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd'];
export const LOCAL_SETTINGS = '.claude/settings.local.json';

// The demo repository is fictional, so its commits use a fictional identity.
const DEMO_IDENTITY = { name: 'Demo Dev', email: 'dev@example.invalid' };

/** The hook command Claude Code runs; forward slashes work in every shell Claude Code uses. */
export function hookCommand() {
  return `node "${ASDK_BIN.split(path.sep).join('/')}" hook`;
}

export function hookSettings() {
  const entry = [{ matcher: '*', hooks: [{ type: 'command', command: hookCommand() }] }];
  return { hooks: Object.fromEntries(HOOK_EVENTS.map((e) => [e, entry])) };
}

export function setupDemo(env, { target, id = 'demo-api' }) {
  const dir = path.resolve(target);
  if (existsSync(dir) && readdirSync(dir).length > 0) throw usageError(`${dir} is not empty`);
  copyDir(DEMO_TEMPLATE, dir);

  const g = (...args) => git(args, { cwd: dir, env });
  g('init', '-q', '-b', 'main');
  g('config', 'user.name', DEMO_IDENTITY.name);
  g('config', 'user.email', DEMO_IDENTITY.email);
  g('add', '.');
  g('commit', '-q', '-m', 'chore: initial demo-api');
  g('switch', '-q', '-c', 'dev');

  // Hook settings point at this kit checkout, so they stay local and untracked.
  const settings = path.join(dir, ...LOCAL_SETTINGS.split('/'));
  mkdirSync(path.dirname(settings), { recursive: true });
  writeFileSync(settings, `${JSON.stringify(hookSettings(), null, 2)}\n`);

  const project = registerProject(env, { id, root: dir, copyFiles: [LOCAL_SETTINGS] });
  return { root: project.root, id, settings };
}
