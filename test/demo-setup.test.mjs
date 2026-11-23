import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, git, runNode } from './helpers/sandbox.mjs';
import { loadConfig } from '../collector/lib/registry.mjs';
import { ASDK_BIN, HOOK_EVENTS } from '../tools/lib/demo.mjs';

const SETUP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'demo-setup.mjs');

test('demo-setup creates a separate repo on dev with local hook settings and registers it', (t) => {
  const sb = createSandbox(t, 'demo-setup');
  const target = sb.join('工作 區', 'demo-api');
  const r = runNode(SETUP, [target], { env: sb.env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /registered as: {3}demo-api/);

  assert.equal(git(sb, target, 'branch', '--show-current').trim(), 'dev');
  assert.equal(git(sb, target, 'branch', '--list', 'main').trim(), 'main');
  assert.equal(git(sb, target, 'log', '-1', '--format=%an <%ae>').trim(), 'Demo Dev <dev@example.invalid>');
  assert.equal(git(sb, target, 'status', '--porcelain').trim(), '', 'local settings must be ignored');

  const settings = JSON.parse(readFileSync(path.join(target, '.claude', 'settings.local.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings.hooks), HOOK_EVENTS);
  assert.ok(settings.hooks.Stop[0].hooks[0].command.includes(ASDK_BIN.split(path.sep).join('/')));

  const [project] = loadConfig(sb.env).projects;
  assert.deepEqual(project.worktree_copy_files, ['.claude/settings.local.json']);
});

test('demo-setup refuses a non-empty directory', (t) => {
  const sb = createSandbox(t, 'demo-setup-busy');
  const target = sb.join('busy');
  mkdirSync(target);
  writeFileSync(path.join(target, 'keep.txt'), 'mine\n');
  const r = runNode(SETUP, [target], { env: sb.env });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is not empty/);
  assert.equal(readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'mine\n');
});
