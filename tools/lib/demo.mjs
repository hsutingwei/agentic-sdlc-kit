// Creates a throw-away demo repository from examples/demo-api, outside the kit's
// own repository, the way a user's real project would be set up.

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { usageError } from '../../core/errors.mjs';
import { copyDir } from '../../core/fs.mjs';
import { git } from '../../core/git.mjs';
import { registerProject } from '../../collector/lib/registry.mjs';
import { installHooks } from '../../adapters/claude-code/install.mjs';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMO_TEMPLATE = path.join(KIT_ROOT, 'examples', 'demo-api');
export const LOCAL_SETTINGS = '.claude/settings.local.json';

// The demo repository is fictional, so its commits use a fictional identity.
const DEMO_IDENTITY = { name: 'Demo Dev', email: 'dev@example.invalid' };

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

  // Hooks go into the demo's local settings, not the user's: running the demo
  // leaves ~/.claude alone. They point at this kit checkout, so they stay untracked.
  const { file: settings } = installHooks(env, { scope: 'local', project: dir });

  const project = registerProject(env, { id, root: dir, copyFiles: [LOCAL_SETTINGS] });
  return { root: project.root, id, settings };
}
