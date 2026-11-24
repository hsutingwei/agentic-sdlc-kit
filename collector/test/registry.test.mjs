import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { configPath, loadConfig, normalizePath, registerProject, resolveProject, worktreeRoot } from '../lib/registry.mjs';

test('a missing config is an empty registry', (t) => {
  const sb = createSandbox(t, 'reg-empty');
  assert.deepEqual(loadConfig(sb.env).projects, []);
});

test('a damaged config is refused, never replaced', (t) => {
  const sb = createSandbox(t, 'reg-bad');
  mkdirSync(path.dirname(configPath(sb.env)), { recursive: true });
  writeFileSync(configPath(sb.env), '{ "projects": [ oops');
  assert.throws(() => loadConfig(sb.env), /not valid JSON/);
  assert.throws(() => registerProject(sb.env, { id: 'demo-api', root: sb.root }), /not valid JSON/);
  assert.equal(readFileSync(configPath(sb.env), 'utf8'), '{ "projects": [ oops');
});

test('registerProject validates and replaces entries by id', (t) => {
  const sb = createSandbox(t, 'reg-add');
  assert.throws(() => registerProject(sb.env, { id: 'Demo API', root: sb.root }), /invalid project id/);
  assert.throws(() => registerProject(sb.env, { id: 'demo-api', root: 'relative/path' }), /absolute/);
  assert.throws(() => registerProject(sb.env, { id: 'demo-api', root: sb.root, copyFiles: ['../x'] }), /relative/);
  registerProject(sb.env, { id: 'demo-api', root: sb.root });
  registerProject(sb.env, { id: 'demo-api', root: sb.home, copyFiles: ['.claude/settings.local.json'] });
  const projects = loadConfig(sb.env).projects;
  assert.equal(projects.length, 1);
  assert.equal(projects[0].root, sb.home);
  assert.deepEqual(projects[0].worktree_copy_files, ['.claude/settings.local.json']);
});

test('the longest matching root wins', (t) => {
  const sb = createSandbox(t, 'reg-longest');
  const outer = sb.join('工作 區', 'demo-api');
  const inner = path.join(outer, 'packages', 'demo-web');
  mkdirSync(inner, { recursive: true });
  registerProject(sb.env, { id: 'demo-api', root: outer });
  registerProject(sb.env, { id: 'demo-web', root: inner });
  assert.equal(resolveProject(path.join(inner, 'src'), { env: sb.env }).project_id, 'demo-web');
  assert.equal(resolveProject(path.join(outer, 'src'), { env: sb.env }).project_id, 'demo-api');
  assert.equal(resolveProject(`${outer}-old`, { env: sb.env }).project_id, null);
  assert.equal(resolveProject(sb.home, { env: sb.env }).project_source, 'none');
});

test('Windows paths compare without case or separator differences', { skip: process.platform !== 'win32' }, (t) => {
  const sb = createSandbox(t, 'reg-case');
  const root = sb.join('Demo-API');
  mkdirSync(root);
  registerProject(sb.env, { id: 'demo-api', root });
  assert.equal(normalizePath(root.toUpperCase()), normalizePath(root));
  assert.equal(resolveProject(root.toLowerCase().replace(/\\/g, '/'), { env: sb.env }).project_id, 'demo-api');
});

test('a worktree outside the root is traced back through the git common directory', (t) => {
  const sb = createSandbox(t, 'reg-wt');
  const root = makeRepo(sb, sb.join('示範 專案'));
  registerProject(sb.env, { id: 'demo-api', root });
  const wt = sb.join('wt', 'demo-api', 'DEMO-001');
  git(sb, root, 'worktree', 'add', '-q', '-b', 'feat/DEMO-001', wt);

  assert.deepEqual(resolveProject(path.join(wt), { env: sb.env }), {
    project_id: 'demo-api',
    project_source: 'git-common-dir',
    root,
    worktree: 'DEMO-001',
  });
  assert.equal(resolveProject(root, { env: sb.env }).worktree, null);
});

test('worktree root defaults to ~/wt and honours ~ in config', (t) => {
  const sb = createSandbox(t, 'reg-wtroot');
  assert.equal(worktreeRoot(sb.env, { projects: [] }), path.join(sb.home, 'wt'));
  assert.equal(worktreeRoot(sb.env, { projects: [], worktrees: { root: '~/trees' } }), path.join(sb.home, 'trees'));
});

test('asdk project add, project list and resolve', (t) => {
  const sb = createSandbox(t, 'reg-cli');
  const root = sb.join('示範 專案');
  mkdirSync(path.join(root, 'src'), { recursive: true });

  const add = runAsdk(sb, ['project', 'add', 'demo-api', root]);
  assert.equal(add.status, 0, add.stderr);
  assert.match(runAsdk(sb, ['project', 'list']).stdout, /^demo-api\t/);

  const resolved = runAsdk(sb, ['resolve', '--json'], { cwd: path.join(root, 'src') });
  assert.equal(JSON.parse(resolved.stdout).project_id, 'demo-api');
  assert.equal(runAsdk(sb, ['resolve'], { cwd: sb.home }).stdout.trim(), 'none');

  assert.equal(runAsdk(sb, ['project', 'add', 'Bad Id', root]).status, 2);
  assert.equal(runAsdk(sb, ['nope']).status, 2);
  assert.match(runAsdk(sb, ['help']).stdout, /usage: asdk/);

  const removed = runAsdk(sb, ['project', 'remove', 'demo-api']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(runAsdk(sb, ['project', 'list']).stdout, '');
  assert.equal(runAsdk(sb, ['project', 'remove', 'demo-api']).status, 2);
});
