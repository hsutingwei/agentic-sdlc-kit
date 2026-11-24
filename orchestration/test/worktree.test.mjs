import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeDemoRepo, runAsdk } from '../../test/helpers/sandbox.mjs';
import { registerProject, resolveProject } from '../../collector/lib/registry.mjs';
import { readWorktreeMarker } from '../../collector/lib/state.mjs';
import { loadTasks, startTask, verifyTask } from '../../collector/lib/tasks.mjs';
import { finishWorktree, newWorktree, slugify } from '../lib/worktree.mjs';

const LOCAL = path.join('.claude', 'settings.local.json');

function setup(t, label) {
  const sb = createSandbox(t, label);
  const root = makeDemoRepo(sb, sb.join('示範 專案'));
  mkdirSync(path.join(root, '.claude'), { recursive: true });
  writeFileSync(path.join(root, LOCAL), '{"hooks":{}}\n'); // ignored by the demo's .gitignore
  registerProject(sb.env, { id: 'demo-api', root, copyFiles: [LOCAL.split(path.sep).join('/')] });
  startTask(sb.env, { taskId: 'DEMO-001', cwd: root, type: 'feature', risk: 'low' });
  return { sb, root };
}

function commitIn(sb, dir, rel, content, message = 'feat: change') {
  const file = path.join(dir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  git(sb, dir, 'add', '.');
  git(sb, dir, 'commit', '-q', '-m', message);
}

test('slugify keeps branch names short and safe', () => {
  assert.equal(slugify('Due Date: overdue filter!'), 'due-date-overdue-filter');
  assert.equal(slugify('到期日'), '');
  assert.equal(slugify('x'.repeat(60)).length, 40);
});

test('wt new creates a short-path worktree on a task branch and copies listed local files', (t) => {
  const { sb, root } = setup(t, 'wt-new');
  const wt = newWorktree(sb.env, { taskId: 'DEMO-001', slug: 'Due date' });
  assert.equal(wt.path, path.join(sb.home, 'wt', 'demo-api', 'DEMO-001'));
  assert.equal(wt.branch, 'feat/DEMO-001-due-date');
  assert.equal(git(sb, wt.path, 'branch', '--show-current').trim(), 'feat/DEMO-001-due-date');
  assert.equal(readFileSync(path.join(wt.path, LOCAL), 'utf8'), '{"hooks":{}}\n');
  assert.deepEqual(resolveProject(wt.path, { env: sb.env }).worktree, 'DEMO-001');
  assert.equal(readWorktreeMarker(sb.env, 'demo-api', 'DEMO-001').branch, wt.branch);
  assert.equal(loadTasks(sb.env).get('DEMO-001').branch, wt.branch);
  assert.throws(() => newWorktree(sb.env, { taskId: 'DEMO-001' }), /already has a worktree/);
  assert.throws(() => newWorktree(sb.env, { taskId: 'DEMO-404' }), /has not been started/);
  assert.equal(git(sb, root, 'branch', '--show-current').trim(), 'dev');
});

test('wt finish refuses dirty trees and empty branches', (t) => {
  const { sb } = setup(t, 'wt-guards');
  const wt = newWorktree(sb.env, { taskId: 'DEMO-001' });
  assert.throws(() => finishWorktree(sb.env, { taskId: 'DEMO-001' }), /no commits to merge/);
  writeFileSync(path.join(wt.path, 'src', 'extra.mjs'), 'export const x = 1;\n');
  assert.throws(() => finishWorktree(sb.env, { taskId: 'DEMO-001' }), /uncommitted changes/);
});

test('wt finish rebases, gates the rebased commit, merges --no-ff and cleans up', (t) => {
  const { sb, root } = setup(t, 'wt-finish');
  const wt = newWorktree(sb.env, { taskId: 'DEMO-001', slug: 'due-date' });
  commitIn(sb, wt.path, 'src/due.mjs', 'export const isOverdue = (d, today) => d < today;\n', 'feat: add isOverdue');
  const original = git(sb, wt.path, 'rev-parse', 'HEAD').trim();
  commitIn(sb, root, 'docs/notes.md', '# notes\n', 'docs: notes on dev'); // dev moves on meanwhile

  const result = finishWorktree(sb.env, { taskId: 'DEMO-001' });
  assert.equal(result.merged, true);
  assert.notEqual(result.head_sha, original, 'the gate must check the rebased commit');
  assert.equal(git(sb, root, 'rev-parse', 'HEAD^2').trim(), result.head_sha);
  assert.equal(git(sb, root, 'log', '-1', '--format=%s').trim(), 'Merge feat/DEMO-001-due-date (DEMO-001)');
  assert.equal(git(sb, root, 'rev-parse', `${result.merge_sha}^{tree}`).trim(), git(sb, root, 'rev-parse', `${result.head_sha}^{tree}`).trim());
  assert.equal(existsSync(wt.path), false);
  assert.equal(git(sb, root, 'branch', '--list', 'feat/*').trim(), '');
  assert.equal(readWorktreeMarker(sb.env, 'demo-api', 'DEMO-001'), null);
  const [v] = loadTasks(sb.env).get('DEMO-001').verifications;
  assert.deepEqual([v.result, v.sha, v.gate], ['pass', result.head_sha, 'G1']);
});

test('a failing gate keeps the worktree and does not merge', (t) => {
  const { sb, root } = setup(t, 'wt-gatefail');
  const wt = newWorktree(sb.env, { taskId: 'DEMO-001' });
  commitIn(sb, wt.path, 'test/unit/broken.test.mjs', "import { test } from 'node:test';\ntest('x', () => { throw new Error('no'); });\n");
  const devBefore = git(sb, root, 'rev-parse', 'dev').trim();
  const result = finishWorktree(sb.env, { taskId: 'DEMO-001' });
  assert.equal(result.merged, false);
  assert.equal(result.gate.summary.result, 'fail');
  assert.equal(git(sb, root, 'rev-parse', 'dev').trim(), devBefore);
  assert.ok(existsSync(wt.path));
  assert.equal(loadTasks(sb.env).get('DEMO-001').verifications[0].result, 'fail');
});

test('a rebase conflict is aborted and reported', (t) => {
  const { sb, root } = setup(t, 'wt-conflict');
  const wt = newWorktree(sb.env, { taskId: 'DEMO-001' });
  commitIn(sb, wt.path, 'README.md', 'branch version\n');
  commitIn(sb, root, 'README.md', 'dev version\n');
  assert.throws(() => finishWorktree(sb.env, { taskId: 'DEMO-001' }), /hit conflicts; the rebase was aborted/);
  assert.equal(git(sb, wt.path, 'status', '--porcelain').trim(), '');
  assert.equal(readFileSync(path.join(wt.path, 'README.md'), 'utf8'), 'branch version\n');
});

test('the main checkout must be on dev and clean to merge', (t) => {
  const { sb, root } = setup(t, 'wt-root');
  const wt = newWorktree(sb.env, { taskId: 'DEMO-001' });
  commitIn(sb, wt.path, 'src/a.mjs', 'export const a = 1;\n');
  git(sb, root, 'switch', '-q', 'main');
  assert.throws(() => finishWorktree(sb.env, { taskId: 'DEMO-001' }), /must be on dev/);
});

test('asdk wt new and wt finish', (t) => {
  const { sb, root } = setup(t, 'wt-cli');
  const created = runAsdk(sb, ['wt', 'new', 'DEMO-001', '--slug', 'due-date', '--json'], { cwd: root });
  assert.equal(created.status, 0, created.stderr);
  const wt = JSON.parse(created.stdout);
  commitIn(sb, wt.path, 'src/a.mjs', 'export const a = 1;\n');
  const finished = runAsdk(sb, ['wt', 'finish', 'DEMO-001'], { cwd: root });
  assert.equal(finished.status, 0, finished.stdout + finished.stderr);
  assert.match(finished.stdout, /result: pass/);
  assert.match(finished.stdout, /merged [0-9a-f]{12} as [0-9a-f]{12}/);
  assert.equal(runAsdk(sb, ['wt', 'finish', 'DEMO-001'], { cwd: root }).status, 1);
});

test('high risk needs an agent and a human review of the exact commit', (t) => {
  const { sb, root } = setup(t, 'wt-high');
  const wt = newWorktree(sb.env, { taskId: 'DEMO-001' });
  commitIn(sb, wt.path, '.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews a diff.\ntools: Read, Grep, Glob\n---\n\nReview it.\n', 'chore: add a reviewer agent');

  const first = finishWorktree(sb.env, { taskId: 'DEMO-001' });
  assert.deepEqual([first.merged, first.reason, first.risk.effective, first.gate.summary.gate], [false, 'reviews', 'high', 'G2']);
  assert.deepEqual(first.reviews.missing, ['1 agent review(s)', '1 human review(s)']);
  const sha = first.head_sha;

  verifyTask(sb.env, { taskId: 'DEMO-001', check: 'review', result: 'pass', executor: 'agent', sha });
  verifyTask(sb.env, { taskId: 'DEMO-001', check: 'review', result: 'fail', executor: 'agent', sha });
  const blocked = finishWorktree(sb.env, { taskId: 'DEMO-001' });
  assert.deepEqual([blocked.merged, blocked.reviews.blocked], [false, true]);

  verifyTask(sb.env, { taskId: 'DEMO-001', check: 'review', result: 'pass', executor: 'human', sha });
  const done = finishWorktree(sb.env, { taskId: 'DEMO-001' });
  assert.equal(done.merged, true);
  assert.equal(done.head_sha, sha, 'the reviewed commit is the merged one');
  assert.equal(git(sb, root, 'rev-parse', 'HEAD^2').trim(), sha);
});

test('a branch cannot loosen the rules it is judged by, and --gate cannot replace the policy gate', (t) => {
  const { sb } = setup(t, 'wt-rules');
  const wt = newWorktree(sb.env, { taskId: 'DEMO-001' });
  const gatesFile = path.join(wt.path, '.asdk', 'gates.json');
  const weakened = JSON.parse(readFileSync(gatesFile, 'utf8'));
  for (const risk of ['medium', 'high', 'critical']) weakened.merge_policy[risk] = { gate: 'G1' };
  commitIn(sb, wt.path, '.asdk/gates.json', JSON.stringify(weakened, null, 2), 'chore: relax the merge policy');

  const result = finishWorktree(sb.env, { taskId: 'DEMO-001' });
  assert.deepEqual([result.merged, result.risk.effective, result.gate.summary.gate], [false, 'high', 'G2']);
  assert.throws(() => finishWorktree(sb.env, { taskId: 'DEMO-001', gate: 'G1' }), /requires gate G2 for high risk/);
});

test('asdk wt finish explains which reviews are missing', (t) => {
  const { sb, root } = setup(t, 'wt-cli-review');
  const wt = newWorktree(sb.env, { taskId: 'DEMO-001' });
  commitIn(sb, wt.path, 'src/server.mjs', `${readFileSync(path.join(wt.path, 'src', 'server.mjs'), 'utf8')}// note\n`);
  const r = runAsdk(sb, ['wt', 'finish', 'DEMO-001'], { cwd: root });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /not merged: medium risk needs 1 review\(s\) by an agent or a human of [0-9a-f]{12} \(task without a profile: 1 verifier\)\./);
  assert.match(r.stdout, /asdk task verify DEMO-001 --check review --result pass\|fail --executor agent\|human --sha [0-9a-f]{40}/);
});

test('review counts set to "profile" follow the task profile', (t) => {
  const { sb, root } = setup(t, 'wt-profile');
  startTask(sb.env, { taskId: 'DEMO-002', cwd: root, type: 'feature', risk: 'medium', profile: 'ultra' });
  const wt = newWorktree(sb.env, { taskId: 'DEMO-002' });
  commitIn(sb, wt.path, 'src/a.mjs', 'export const a = 1;\n');
  const first = finishWorktree(sb.env, { taskId: 'DEMO-002' });
  assert.deepEqual([first.reason, first.profile, first.rule.reviews.any], ['reviews', 'ultra', 2]);
  verifyTask(sb.env, { taskId: 'DEMO-002', check: 'review', result: 'pass', executor: 'agent', sha: first.head_sha });
  assert.deepEqual(finishWorktree(sb.env, { taskId: 'DEMO-002' }).reviews.missing, ['1 review(s) by an agent or a human']);
  verifyTask(sb.env, { taskId: 'DEMO-002', check: 'review', result: 'pass', executor: 'agent', sha: first.head_sha });
  const r = runAsdk(sb, ['wt', 'finish', 'DEMO-002'], { cwd: root });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /merged /);
});
