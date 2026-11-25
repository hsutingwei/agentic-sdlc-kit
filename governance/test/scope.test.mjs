import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeCheck } from '../gate/scope.mjs';

const brief = (allowed, forbidden) => ({ scope: { allowed_paths: allowed, ...(forbidden ? { forbidden_paths: forbidden } : {}) } });

test('files inside the allowed paths are in scope', () => {
  const r = scopeCheck(brief(['src/**', 'test/**']), ['src/server.mjs', 'test/unit/a.test.mjs', 'src/deep/x/y.mjs']);
  assert.deepEqual(r.outside, []);
  assert.equal(r.changed, 3);
});

test('a forbidden path wins over an allowed one', () => {
  const r = scopeCheck(brief(['**'], ['.asdk/**', 'briefs/**']), ['src/a.mjs', '.asdk/risk-paths.json', 'briefs/DEMO-001.json']);
  assert.deepEqual(r.outside, [
    { path: '.asdk/risk-paths.json', reason: 'forbidden', glob: '.asdk/**' },
    { path: 'briefs/DEMO-001.json', reason: 'forbidden', glob: 'briefs/**' },
  ]);
});

test('a file no allowed path covers is outside, including a deleted one', () => {
  // changedPaths lists deleted files too; the check only sees paths
  const r = scopeCheck(brief(['src/**']), ['src/a.mjs', 'README.md', 'docs/old.md']);
  assert.deepEqual(
    r.outside.map((o) => [o.path, o.reason]),
    [
      ['README.md', 'not_allowed'],
      ['docs/old.md', 'not_allowed'],
    ],
  );
});

test('paths with Chinese characters, spaces and backslashes', () => {
  const r = scopeCheck(brief(['文件/**', 'src/*.mjs'], ['文件/草稿 1/**']), ['文件/說明.md', '文件/草稿 1/a.md', 'src\\b.mjs', 'src/sub/c.mjs']);
  assert.deepEqual(
    r.outside.map((o) => [o.path, o.reason]),
    [
      ['文件/草稿 1/a.md', 'forbidden'],
      ['src/sub/c.mjs', 'not_allowed'],
    ],
  );
});

test('no forbidden paths and no changes', () => {
  const r = scopeCheck(brief(['src/**']), []);
  assert.deepEqual(r, { allowed_paths: ['src/**'], forbidden_paths: [], changed: 0, outside: [] });
});
