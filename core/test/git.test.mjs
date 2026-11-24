import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createSandbox, git, makeRepo } from '../../test/helpers/sandbox.mjs';
import { locateRepo, repoInfo } from '../git.mjs';

const canon = (p) => {
  const real = realpathSync.native(p).replace(/\\/g, '/');
  return process.platform === 'win32' ? real.toLowerCase() : real;
};
const same = (a, b) => assert.equal(canon(a), canon(b));

function assertMatchesGit(sb, dir) {
  const fast = locateRepo(dir);
  const slow = repoInfo(dir, sb.env);
  assert.ok(fast && slow, `both find a repository at ${dir}`);
  same(fast.toplevel, slow.toplevel);
  same(fast.commonDir, slow.commonDir);
}

test('locateRepo agrees with git for a main checkout, a subdirectory and a linked worktree', (t) => {
  const sb = createSandbox(t, 'git-locate');
  const root = makeRepo(sb, sb.join('示範 專案'), { 'src/說明.md': '# x\n' });
  const wt = sb.join('wt', 'demo-api', 'DEMO-001');
  git(sb, root, 'worktree', 'add', '-q', '-b', 'feat/DEMO-001', wt);

  assertMatchesGit(sb, root);
  assertMatchesGit(sb, path.join(root, 'src'));
  assertMatchesGit(sb, wt);
  assertMatchesGit(sb, path.join(wt, 'src'));
});

test('a submodule-style .git file without commondir is its own repository', (t) => {
  const sb = createSandbox(t, 'git-submodule');
  const gitDir = sb.join('outer', '.git', 'modules', 'lib');
  mkdirSync(gitDir, { recursive: true });
  const sub = sb.join('outer', 'lib');
  mkdirSync(sub, { recursive: true });
  writeFileSync(path.join(sub, '.git'), 'gitdir: ../.git/modules/lib\n');
  const found = locateRepo(sub);
  same(found.toplevel, sub);
  same(found.commonDir, gitDir);
});

test('locateRepo returns null outside a repository and for unreadable .git files', (t) => {
  const sb = createSandbox(t, 'git-none');
  assert.equal(locateRepo(sb.join('不存在')), null);
  const dir = sb.join('壞的');
  mkdirSync(dir);
  writeFileSync(path.join(dir, '.git'), 'not a pointer\n');
  assert.equal(locateRepo(dir), null);
});
